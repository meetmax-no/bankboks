import { webcrypto } from "node:crypto";
import { generatePassphrase } from "../passphrase-generator";
import { NB_WORDLIST } from "../wordlist-nb";

if (!(globalThis as { crypto?: Crypto }).crypto?.getRandomValues) {
  // @ts-expect-error test shim
  globalThis.crypto = webcrypto;
}

function assert(c: unknown, m: string) {
  if (!c) {
    console.error("FAIL:", m);
    process.exit(1);
  }
  console.log("OK:", m);
}

// 1. Default
const p1 = generatePassphrase();
const parts = p1.split("+");
assert(parts.length === 4, `default 4 ord (${parts.length})`);
assert(
  parts.every((w) => /^[A-Z][a-z]+$/.test(w)),
  `alle ord starter med stor bokstav: ${p1}`,
);
assert(!/[ÆØÅæøå]/.test(p1), `ingen Æ/Ø/Å: ${p1}`);

// 2. Custom
const p2 = generatePassphrase({ wordCount: 6, separator: "-" });
assert(p2.split("-").length === 6, `6 ord m/-: ${p2}`);

// 3. Lowercase
const p3 = generatePassphrase({
  wordCount: 3,
  separator: "_",
  capitalize: false,
});
assert(
  p3.split("_").every((w) => /^[a-z]+$/.test(w)),
  `lowercase: ${p3}`,
);

// 4. Wordlist sanity — ingen tomme/kort
assert(
  NB_WORDLIST.every((w) => w.length >= 2 && w.length <= 12),
  "alle ord 2-12 tegn",
);
assert(
  NB_WORDLIST.every((w) => /^[a-z]+$/.test(w)),
  "alle ord kun a-z",
);
assert(
  new Set(NB_WORDLIST).size === NB_WORDLIST.length,
  `ingen duplikater (${NB_WORDLIST.length} ord)`,
);

// 5. Distribusjon — pluk 5000 ord, sjekk at >50% av listen blir brukt
const seen = new Set<string>();
for (let i = 0; i < 5000; i++) {
  const phrase = generatePassphrase({
    wordCount: 1,
    separator: "+",
    capitalize: false,
  });
  seen.add(phrase);
}
const coverage = seen.size / NB_WORDLIST.length;
assert(coverage > 0.5, `>50% coverage etter 5000 pluk (${(coverage * 100).toFixed(1)}%)`);

console.log("\n✓ All passphrase tests passed");
