/**
 * Ko | Do · Vault — v4.3 Iter 1 — Unit tests for tenant-crypto
 *
 * Kjør: cd /app/frontend && npx tsx lib/__tests__/tenant-crypto.test.ts
 */
import { randomBytes } from "node:crypto";
import {
  decryptPayload,
  encryptPayload,
  type EncryptedBlob,
} from "../platform/tenant-crypto";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

console.log("tenant-crypto.test.ts");
console.log("─".repeat(60));

// Sett en deterministisk nøkkel for testene.
process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// ─── Roundtrip ──────────────────────────────────────────────────────
const payload = {
  subdomain: "terje",
  email: "terje@example.no",
  customerType: "b2c" as const,
  nested: { a: 1, b: [true, false, null] },
};
const blob = encryptPayload(payload);
assert(blob.v === 1, "blob har schema-versjon 1");
assert(typeof blob.iv === "string" && blob.iv.length > 0, "blob har iv");
assert(typeof blob.ct === "string" && blob.ct.length > 0, "blob har ct");
assert(typeof blob.tag === "string" && blob.tag.length > 0, "blob har tag");

const decrypted = decryptPayload<typeof payload>(blob);
assert(decrypted.subdomain === "terje", "roundtrip bevarer subdomain");
assert(decrypted.email === "terje@example.no", "roundtrip bevarer email");
assert(decrypted.nested.a === 1, "roundtrip bevarer nested.a");
assert(
  JSON.stringify(decrypted.nested.b) === JSON.stringify([true, false, null]),
  "roundtrip bevarer array med blandet type",
);

// ─── Hver kryptering gir unik IV (probabilistisk) ──────────────────
const b1 = encryptPayload({ x: 1 });
const b2 = encryptPayload({ x: 1 });
assert(b1.iv !== b2.iv, "to krypteringer av samme payload har ulik IV");
assert(b1.ct !== b2.ct, "to krypteringer av samme payload har ulik ciphertext");

// ─── Tampering med ciphertext oppdages ─────────────────────────────
const tamperedCt: EncryptedBlob = { ...blob, ct: blob.ct.slice(0, -4) + "AAAA" };
let threw = false;
try {
  decryptPayload(tamperedCt);
} catch {
  threw = true;
}
assert(threw, "tampered ciphertext kaster ved decrypt");

// ─── Tampering med auth-tag oppdages ───────────────────────────────
const tamperedTag: EncryptedBlob = {
  ...blob,
  tag: blob.tag.slice(0, -4) + "AAAA",
};
threw = false;
try {
  decryptPayload(tamperedTag);
} catch {
  threw = true;
}
assert(threw, "tampered auth-tag kaster ved decrypt");

// ─── Feil nøkkel kaster ────────────────────────────────────────────
const originalKey = process.env.CENTRAL_ENCRYPTION_KEY;
process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
threw = false;
try {
  decryptPayload(blob);
} catch {
  threw = true;
}
assert(threw, "feil nøkkel kaster ved decrypt");
process.env.CENTRAL_ENCRYPTION_KEY = originalKey;

// ─── Manglende nøkkel kaster ───────────────────────────────────────
delete process.env.CENTRAL_ENCRYPTION_KEY;
threw = false;
try {
  encryptPayload({ x: 1 });
} catch (err) {
  threw = err instanceof Error && err.message.includes("CENTRAL_ENCRYPTION_KEY mangler");
}
assert(threw, "manglende nøkkel kaster med tydelig melding");

// ─── Ugyldig nøkkel-format kaster ──────────────────────────────────
process.env.CENTRAL_ENCRYPTION_KEY = "for-kort";
threw = false;
try {
  encryptPayload({ x: 1 });
} catch (err) {
  threw =
    err instanceof Error && err.message.includes("64 hex-tegn");
}
assert(threw, "ugyldig nøkkel-format kaster med tydelig melding");

// ─── Ukjent schema-versjon kaster ──────────────────────────────────
process.env.CENTRAL_ENCRYPTION_KEY = originalKey;
threw = false;
try {
  decryptPayload({ ...blob, v: 99 } as unknown as EncryptedBlob);
} catch {
  threw = true;
}
assert(threw, "ukjent schema-versjon kaster ved decrypt");

console.log("─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
