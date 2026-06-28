/**
 * Ko | Do · Vault — Iter 20.5a — Offline-tester for am-admin MPW
 *
 * Kjør:
 *   cd frontend && npx tsx lib/__tests__/am-admin-mpw.test.ts
 *
 * Tester:
 *   - createMpwVerifier → verifyMpw roundtrip
 *   - verifyMpw avviser feil passord (returns null, kaster ikke)
 *   - encryptWithMpwKey/decryptWithMpwKey roundtripper UTF-8 + JSON
 *   - To verifier-envelopes for samme passord har UNIK salt/iv
 *   - To encrypt-kall med samme key har UNIK iv (AES-GCM-krav)
 *   - isMpwEnvelope type-guard avviser feil shapes
 *
 * Krypto-laget kjører i Node 20+ via globalThis.crypto.subtle —
 * ingen Upstash- eller env-avhengigheter.
 */
import {
  createMpwVerifier,
  verifyMpw,
  encryptWithMpwKey,
  decryptWithMpwKey,
  isMpwEnvelope,
  MPW_PBKDF2_ITERATIONS,
  type MpwEnvelope,
} from "../platform/am-admin-mpw";

if (typeof crypto === "undefined" || !crypto.subtle) {
  console.error("FAIL: Web Crypto API ikke tilgjengelig (krever Node 20+)");
  process.exit(1);
}

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

async function main(): Promise<void> {
  const password = "korrekt-batteri-stift-hest-42!";

  // ─── 1. Roundtrip ──────────────────────────────────────────────
  const setup = await createMpwVerifier(password);
  assert(isMpwEnvelope(setup.envelope), "createMpwVerifier produserer gyldig envelope");
  assert(setup.envelope.iterations === MPW_PBKDF2_ITERATIONS, "iterations matcher konstanten");
  assert(setup.envelope.version === 1, "envelope.version === 1");
  assert(setup.salt.length === 16, "salt er 16 bytes");

  const unlock = await verifyMpw(setup.envelope, password);
  assert(unlock !== null, "verifyMpw aksepterer riktig passord");

  // ─── 2. Feil passord ───────────────────────────────────────────
  const wrong = await verifyMpw(setup.envelope, password + "x");
  assert(wrong === null, "verifyMpw returnerer null på feil passord (kaster ikke)");

  // ─── 3. Encrypt/decrypt med session-nøkkel ─────────────────────
  if (!unlock) throw new Error("unlock null — kan ikke fortsette");
  const note = JSON.stringify({
    employeeId: "emp-123",
    note: "Backup-nøkkel ligger i safe på kontoret — æøå-test 🔐",
    updatedAt: new Date().toISOString(),
  });
  const noteEnv = await encryptWithMpwKey(note, unlock.key, unlock.salt);
  assert(isMpwEnvelope(noteEnv), "encryptWithMpwKey produserer gyldig envelope");
  const decoded = await decryptWithMpwKey(noteEnv, unlock.key);
  assert(decoded === note, "decryptWithMpwKey roundtripper UTF-8 + JSON nøyaktig");

  // ─── 4. Unik salt per setup ────────────────────────────────────
  const setup2 = await createMpwVerifier(password);
  assert(
    setup.envelope.salt !== setup2.envelope.salt,
    "to createMpwVerifier-kall produserer UNIK salt",
  );
  assert(
    setup.envelope.iv !== setup2.envelope.iv,
    "to createMpwVerifier-kall produserer UNIK iv",
  );

  // ─── 5. Unik iv per encrypt med samme key ──────────────────────
  const e1 = await encryptWithMpwKey("samme-payload", unlock.key, unlock.salt);
  const e2 = await encryptWithMpwKey("samme-payload", unlock.key, unlock.salt);
  assert(e1.iv !== e2.iv, "samme key + samme plaintext → UNIK iv (AES-GCM-krav)");
  assert(e1.cipher !== e2.cipher, "samme key + samme plaintext → UNIK ciphertext");

  // ─── 6. Verifier-envelope kan ikke dekrypteres med feil-derivet key ─
  const wrongSetup = await createMpwVerifier("annet-passord");
  const crossUnlock = await verifyMpw(setup.envelope, "annet-passord");
  assert(crossUnlock === null, "verifyMpw kan ikke krysse mellom orgs/passord");
  assert(isMpwEnvelope(wrongSetup.envelope), "wrongSetup-envelope er fortsatt gyldig");

  // ─── 7. isMpwEnvelope type-guard ───────────────────────────────
  assert(isMpwEnvelope(setup.envelope), "type-guard godtar ekte envelope");
  assert(!isMpwEnvelope(null), "type-guard avviser null");
  assert(!isMpwEnvelope(undefined), "type-guard avviser undefined");
  assert(!isMpwEnvelope({}), "type-guard avviser tom object");
  assert(!isMpwEnvelope("string"), "type-guard avviser primitive");
  assert(
    !isMpwEnvelope({ version: 2, salt: "x", iv: "x", cipher: "x", iterations: 1 }),
    "type-guard avviser ukjent version",
  );
  assert(
    !isMpwEnvelope({ version: 1, salt: 123, iv: "x", cipher: "x", iterations: 1 }),
    "type-guard avviser feil type på salt",
  );
  assert(
    !isMpwEnvelope({ version: 1, salt: "x", iv: "x", cipher: "x" } as Partial<MpwEnvelope>),
    "type-guard avviser manglende iterations",
  );

  // ─── 8. decryptWithMpwKey kaster ved tukling ───────────────────
  const tampered: MpwEnvelope = {
    ...noteEnv,
    cipher: noteEnv.cipher.slice(0, -4) + "AAAA",
  };
  let threw = false;
  try {
    await decryptWithMpwKey(tampered, unlock.key);
  } catch {
    threw = true;
  }
  assert(threw, "decryptWithMpwKey kaster på tuklet ciphertext (AES-GCM auth tag)");

  // ─── Summary ───────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
