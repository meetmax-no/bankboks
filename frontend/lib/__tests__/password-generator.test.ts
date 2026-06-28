// Offline sanity-test av password-generator (kryptografisk uniform).
import { webcrypto } from "node:crypto";
import { generatePassword, DEFAULT_GEN_OPTS } from "../password-generator";

if (!(globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
  // @ts-expect-error test shim
  globalThis.crypto = webcrypto;
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

// 1. Default: 12 tegn alle kategorier
const p1 = generatePassword();
assert(p1.length === 12, `default length 12 (fikk ${p1.length})`);
assert(/[A-Z]/.test(p1), "default inneholder store bokstaver");
assert(/[a-z]/.test(p1), "default inneholder små bokstaver");
assert(/[0-9]/.test(p1), "default inneholder tall");
assert(/[!@#$%^&*()\-_=+[\]{};:,.<>?/~]/.test(p1), "default inneholder symboler");

// 2. Kun tall
const p2 = generatePassword({
  ...DEFAULT_GEN_OPTS,
  uppercase: false,
  lowercase: false,
  symbols: false,
  length: 20,
});
assert(/^\d+$/.test(p2), `kun tall (fikk "${p2}")`);
assert(p2.length === 20, `length 20 (fikk ${p2.length})`);

// 3. Exclude similar fjerner 0/O/1/l/I
for (let i = 0; i < 50; i++) {
  const p = generatePassword({
    ...DEFAULT_GEN_OPTS,
    excludeSimilar: true,
    length: 40,
  });
  if (/[O0Il1]/.test(p)) {
    assert(false, `excludeSimilar lekkasje: ${p}`);
  }
}
assert(true, "excludeSimilar filtrerer 0/O/1/l/I i 50 runder");

// 4. Feil ved null kategorier
try {
  generatePassword({
    length: 10,
    uppercase: false,
    lowercase: false,
    digits: false,
    symbols: false,
    excludeSimilar: false,
  });
  assert(false, "skulle kastet");
} catch (e) {
  assert(e instanceof Error, "kaster Error når ingen kategorier valgt");
}

// 5. Uniformitetstest — svak sjekk at distribusjon ikke er skewed
const counts: Record<string, number> = {};
for (let i = 0; i < 10_000; i++) {
  const ch = generatePassword({
    ...DEFAULT_GEN_OPTS,
    length: 1,
    symbols: false,
    excludeSimilar: false,
  });
  counts[ch] = (counts[ch] || 0) + 1;
}
const alphabetSize = 26 + 26 + 10;
const expected = 10_000 / alphabetSize;
const maxDrift = Math.max(
  ...Object.values(counts).map((c) => Math.abs(c - expected)),
);
// Tillat opptil 5x expected (svært generøs — bare fang grove bugs)
assert(
  maxDrift < expected * 5,
  `distribusjon rimelig (max drift ${maxDrift}, expected ${expected})`,
);

console.log("\n✓ All password-generator tests passed");
