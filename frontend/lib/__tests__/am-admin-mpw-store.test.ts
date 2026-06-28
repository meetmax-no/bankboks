/**
 * Ko | Do · Vault — Iter 20.5a — Offline-tester for am-admin-mpw-store
 *
 * Kjør:
 *   cd frontend && npx tsx lib/__tests__/am-admin-mpw-store.test.ts
 *
 * Mocker `getCentralRedis()` med in-memory KV slik at vi tester store-
 * logikken uten ekte Upstash-tilkobling. Krypto-laget kjører ekte.
 *
 * Tester:
 *   - set + get roundtrip
 *   - get returnerer null hvis ikke satt
 *   - get returnerer null hvis lagret blob er korrupt (ikke MpwEnvelope)
 *   - delete er idempotent og fjerner verifier
 *   - has reflekterer set/delete
 *   - validatePrefix kaster på ugyldig prefix
 *   - set kaster ved ugyldig envelope (defensive)
 */
import { createMpwVerifier, type MpwEnvelope } from "../platform/am-admin-mpw";

// ─── In-memory mock av Upstash Redis ──────────────────────────────────
type StoredValue = unknown;
const kv = new Map<string, StoredValue>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(
      key: string,
      value: StoredValue,
      opts?: { nx?: boolean },
    ): Promise<"OK" | null> {
      if (opts?.nx) {
        if (kv.has(key)) return null;
        kv.set(key, value);
        return "OK";
      }
      kv.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<void> {
      kv.delete(key);
    },
    async exists(key: string): Promise<number> {
      return kv.has(key) ? 1 : 0;
    },
  };
}

import { setCentralRedisForTests } from "../platform/central-upstash";
setCentralRedisForTests(makeMockRedis());

import {
  getMpwVerifier,
  setMpwVerifier,
  setMpwVerifierIfAbsent,
  deleteMpwVerifier,
  hasMpwVerifier,
} from "../platform/am-admin-mpw-store";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log("OK:", msg);
    passed++;
  } else {
    console.error("FAIL:", msg);
    failed++;
  }
}

function clearAll(): void {
  kv.clear();
}

async function main(): Promise<void> {
  const prefix = "amlaw";

  // ─── 1. get returns null when not set ──────────────────────────
  clearAll();
  const empty = await getMpwVerifier(prefix);
  assert(empty === null, "getMpwVerifier returnerer null når ikke satt");
  assert((await hasMpwVerifier(prefix)) === false, "hasMpwVerifier false når ikke satt");

  // ─── 2. set + get roundtrip ────────────────────────────────────
  const { envelope } = await createMpwVerifier("test-mpw-passord-42");
  await setMpwVerifier(prefix, envelope);
  const loaded = await getMpwVerifier(prefix);
  assert(loaded !== null, "getMpwVerifier finner satt verifier");
  assert(loaded?.cipher === envelope.cipher, "cipher matcher etter roundtrip");
  assert(loaded?.salt === envelope.salt, "salt matcher etter roundtrip");
  assert(loaded?.iv === envelope.iv, "iv matcher etter roundtrip");
  assert(loaded?.iterations === envelope.iterations, "iterations matcher");
  assert(await hasMpwVerifier(prefix), "hasMpwVerifier true etter set");

  // ─── 3. corrupt blob → null ────────────────────────────────────
  clearAll();
  kv.set(`org-meta:${prefix}:mpw`, { malformed: true });
  const corrupt = await getMpwVerifier(prefix);
  assert(corrupt === null, "getMpwVerifier returnerer null ved korrupt blob");

  // ─── 4. delete er idempotent + fjerner verifier ────────────────
  clearAll();
  await deleteMpwVerifier(prefix); // ingen verifier — skal ikke kaste
  assert(true, "deleteMpwVerifier er idempotent når ingen verifier finnes");

  await setMpwVerifier(prefix, envelope);
  assert(await hasMpwVerifier(prefix), "verifier finnes før delete");
  await deleteMpwVerifier(prefix);
  assert((await hasMpwVerifier(prefix)) === false, "hasMpwVerifier false etter delete");
  assert((await getMpwVerifier(prefix)) === null, "getMpwVerifier null etter delete");

  // ─── 5. validatePrefix kaster på ugyldig prefix ────────────────
  let threw = false;
  try {
    await getMpwVerifier("INVALID!!");
  } catch {
    threw = true;
  }
  assert(threw, "getMpwVerifier kaster på ugyldig prefix");

  threw = false;
  try {
    await setMpwVerifier("1starts-with-digit", envelope);
  } catch {
    threw = true;
  }
  assert(threw, "setMpwVerifier kaster på ugyldig prefix (starter med siffer)");

  threw = false;
  try {
    await deleteMpwVerifier("-leading-dash");
  } catch {
    threw = true;
  }
  assert(threw, "deleteMpwVerifier kaster på ugyldig prefix (leading dash)");

  // ─── 6. set kaster ved ugyldig envelope ────────────────────────
  threw = false;
  try {
    await setMpwVerifier(prefix, { malformed: true } as unknown as MpwEnvelope);
  } catch {
    threw = true;
  }
  assert(threw, "setMpwVerifier kaster på ugyldig envelope");

  // ─── 7. Overskriving (reset etter Glemt MPW) ───────────────────
  clearAll();
  await setMpwVerifier(prefix, envelope);
  const { envelope: env2 } = await createMpwVerifier("nytt-passord-etter-reset");
  await setMpwVerifier(prefix, env2);
  const reloaded = await getMpwVerifier(prefix);
  assert(reloaded?.cipher === env2.cipher, "setMpwVerifier overskriver ved reset");
  assert(reloaded?.cipher !== envelope.cipher, "gammel verifier er borte");

  // ─── 8. setMpwVerifierIfAbsent — atomisk SETNX ─────────────────
  clearAll();
  const first = await setMpwVerifierIfAbsent(prefix, envelope);
  assert(first === true, "setMpwVerifierIfAbsent returnerer true når ingen verifier finnes");
  const stored = await getMpwVerifier(prefix);
  assert(stored?.cipher === envelope.cipher, "verifier lagret korrekt etter SETNX");

  // Andre kall — skal IKKE overskrive
  const { envelope: env3 } = await createMpwVerifier("annet-passord-2");
  const second = await setMpwVerifierIfAbsent(prefix, env3);
  assert(second === false, "setMpwVerifierIfAbsent returnerer false når verifier finnes");
  const afterSecond = await getMpwVerifier(prefix);
  assert(
    afterSecond?.cipher === envelope.cipher,
    "verifier IKKE overskrevet av andre SETNX-kall (TOCTOU-safe)",
  );

  // Etter delete kan SETNX igjen
  await deleteMpwVerifier(prefix);
  const third = await setMpwVerifierIfAbsent(prefix, env3);
  assert(third === true, "setMpwVerifierIfAbsent fungerer igjen etter delete");

  // Validerer envelope og prefix
  let threwNx = false;
  try {
    await setMpwVerifierIfAbsent("BAD!!", env3);
  } catch {
    threwNx = true;
  }
  assert(threwNx, "setMpwVerifierIfAbsent kaster på ugyldig prefix");

  threwNx = false;
  try {
    await setMpwVerifierIfAbsent(prefix, { malformed: true } as unknown as MpwEnvelope);
  } catch {
    threwNx = true;
  }
  assert(threwNx, "setMpwVerifierIfAbsent kaster på ugyldig envelope");

  // ─── Summary ───────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
