/**
 * Ko | Do · Vault — Iter 20.5c — Offline-tester for am-admin-notes-store
 *
 * Kjør:
 *   cd frontend && npx tsx lib/__tests__/am-admin-notes-store.test.ts
 *
 * Mocker `getCentralRedis()` med in-memory KV + SET + pipeline.
 *
 * Tester:
 *   - set/get/delete enkelt-notat
 *   - get returnerer null hvis ikke satt eller korrupt blob
 *   - setNote oppdaterer indeks
 *   - listNoteSubdomains returnerer alle subdomains med notater
 *   - deleteNote fjerner fra indeks
 *   - deleteAllNotes sletter både notater og indeks i én operasjon
 *   - validatePrefix + validateSubdomain
 */
import { createMpwVerifier, type MpwEnvelope } from "../platform/am-admin-mpw";

// ─── In-memory mock av Upstash Redis ──────────────────────────────────
type StoredValue = unknown;
const kv = new Map<string, StoredValue>();
const sets = new Map<string, Set<string>>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: StoredValue): Promise<"OK"> {
      kv.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<void> {
      kv.delete(key);
    },
    async exists(key: string): Promise<number> {
      return kv.has(key) ? 1 : 0;
    },
    async sadd(key: string, member: string): Promise<void> {
      let s = sets.get(key);
      if (!s) {
        s = new Set();
        sets.set(key, s);
      }
      s.add(member);
    },
    async srem(key: string, member: string): Promise<void> {
      sets.get(key)?.delete(member);
    },
    async smembers(key: string): Promise<string[]> {
      return Array.from(sets.get(key) ?? []);
    },
    pipeline() {
      const calls: Array<{ op: "del"; key: string }> = [];
      const api = {
        del(key: string) {
          calls.push({ op: "del", key });
          return api;
        },
        async exec(): Promise<unknown[]> {
          const results: unknown[] = [];
          for (const c of calls) {
            kv.delete(c.key);
            sets.delete(c.key);
            results.push(null);
          }
          return results;
        },
      };
      return api;
    },
  };
}

import { setCentralRedisForTests } from "../platform/central-upstash";
setCentralRedisForTests(makeMockRedis());

import {
  getNote,
  setNote,
  deleteNote,
  listNoteSubdomains,
  deleteAllNotes,
} from "../platform/am-admin-notes-store";

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
  sets.clear();
}

async function main(): Promise<void> {
  const prefix = "amlaw";
  const subA = "amlaw-kari";
  const subB = "amlaw-ola";
  const { envelope } = await createMpwVerifier("test-mpw-passord-42");

  // ─── 1. get returns null when not set ──────────────────────────
  clearAll();
  assert(
    (await getNote(prefix, subA)) === null,
    "getNote returnerer null når ikke satt",
  );
  assert(
    (await listNoteSubdomains(prefix)).length === 0,
    "listNoteSubdomains tom når ingen notater",
  );

  // ─── 2. set + get roundtrip ────────────────────────────────────
  await setNote(prefix, subA, envelope);
  const loaded = await getNote(prefix, subA);
  assert(loaded !== null, "getNote finner satt notat");
  assert(loaded?.cipher === envelope.cipher, "cipher matcher etter roundtrip");
  const indexed = await listNoteSubdomains(prefix);
  assert(indexed.length === 1 && indexed[0] === subA, "subdomain i indeks etter set");

  // ─── 3. Korrupt blob → null ────────────────────────────────────
  clearAll();
  kv.set(`org-admin-notes:${prefix}:${subA}`, { malformed: true });
  assert(
    (await getNote(prefix, subA)) === null,
    "getNote returnerer null ved korrupt blob",
  );

  // ─── 4. setNote overskriver + idempotent indeks ────────────────
  clearAll();
  await setNote(prefix, subA, envelope);
  const { envelope: env2 } = await createMpwVerifier("annet-passord");
  await setNote(prefix, subA, env2);
  const updated = await getNote(prefix, subA);
  assert(updated?.cipher === env2.cipher, "setNote overskriver eksisterende notat");
  const idx = await listNoteSubdomains(prefix);
  assert(idx.length === 1, "indeks forblir 1 etter overskriving (idempotent)");

  // ─── 5. deleteNote fjerner fra både blob og indeks ─────────────
  await deleteNote(prefix, subA);
  assert((await getNote(prefix, subA)) === null, "deleteNote fjerner blob");
  assert(
    (await listNoteSubdomains(prefix)).length === 0,
    "deleteNote fjerner fra indeks",
  );

  // ─── 6. deleteAllNotes — flere subdomains ──────────────────────
  clearAll();
  await setNote(prefix, subA, envelope);
  await setNote(prefix, subB, envelope);
  assert(
    (await listNoteSubdomains(prefix)).length === 2,
    "to subdomains i indeks før reset",
  );
  const deleted = await deleteAllNotes(prefix);
  assert(deleted === 2, "deleteAllNotes returnerer antall slettede notater");
  assert((await getNote(prefix, subA)) === null, "subA notat slettet");
  assert((await getNote(prefix, subB)) === null, "subB notat slettet");
  assert(
    (await listNoteSubdomains(prefix)).length === 0,
    "indeks tom etter deleteAllNotes",
  );

  // ─── 7. deleteAllNotes — idempotent når tom ────────────────────
  const deletedEmpty = await deleteAllNotes(prefix);
  assert(deletedEmpty === 0, "deleteAllNotes returnerer 0 når ingen notater");

  // ─── 8. Validering av prefix + subdomain ───────────────────────
  let threw = false;
  try {
    await getNote("BAD!!", subA);
  } catch {
    threw = true;
  }
  assert(threw, "getNote kaster på ugyldig prefix");

  threw = false;
  try {
    await setNote(prefix, "Bad Subdomain!!", envelope);
  } catch {
    threw = true;
  }
  assert(threw, "setNote kaster på ugyldig subdomain");

  threw = false;
  try {
    await setNote(prefix, subA, { malformed: true } as unknown as MpwEnvelope);
  } catch {
    threw = true;
  }
  assert(threw, "setNote kaster på ugyldig envelope");

  // ─── 9. Cross-org-isolasjon — indeks per prefix ────────────────
  clearAll();
  await setNote("amlaw", subA, envelope);
  await setNote("acme", "acme-alice", envelope);
  assert(
    (await listNoteSubdomains("amlaw")).length === 1,
    "amlaw-indeks isolert (1 entry)",
  );
  assert(
    (await listNoteSubdomains("acme")).length === 1,
    "acme-indeks isolert (1 entry)",
  );

  // ─── Summary ───────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
