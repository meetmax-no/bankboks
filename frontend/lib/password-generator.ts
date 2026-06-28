// Kryptografisk trygg passord-generator.
// Bruker Web Crypto API (crypto.getRandomValues) — samme entropikilde som
// resten av vault-appen. Ingen bias — vi kaster og prøver på nytt hvis
// random-byten ikke er i alphabetets range.

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Ekskluder lignende tegn (O, 0, l, 1, I) for bedre lesbarhet */
  excludeSimilar: boolean;
}

export const DEFAULT_GEN_OPTS: GeneratorOptions = {
  length: 12,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeSimilar: false,
};

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
// Klassiske "safe" symboler — unngår mellomrom, sitater, backtick og
// ikke-ASCII som kan gi problemer ved kopiering.
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>?/~";
const SIMILAR = /[O0oIl1|]/g;

function buildAlphabet(opts: GeneratorOptions): string {
  let a = "";
  if (opts.uppercase) a += UPPER;
  if (opts.lowercase) a += LOWER;
  if (opts.digits) a += DIGITS;
  if (opts.symbols) a += SYMBOLS;
  if (opts.excludeSimilar) a = a.replace(SIMILAR, "");
  return a;
}

/**
 * Genererer et passord med kryptografisk trygg random-kilde og bias-free
 * rejection-sampling mot alphabetet.
 */
export function generatePassword(
  opts: Partial<GeneratorOptions> = {},
): string {
  const o: GeneratorOptions = { ...DEFAULT_GEN_OPTS, ...opts };
  if (o.length < 1) return "";
  const alphabet = buildAlphabet(o);
  if (alphabet.length === 0) {
    throw new Error("Velg minst én tegntype");
  }

  // Maks verdi i 8-bit som fortsatt gir uniform fordeling.
  const maxByte = 256 - (256 % alphabet.length);

  const out: string[] = [];
  const buf = new Uint8Array(Math.max(16, o.length * 2));
  while (out.length < o.length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < o.length; i++) {
      if (buf[i] < maxByte) {
        out.push(alphabet[buf[i] % alphabet.length]);
      }
    }
  }

  // Garanter at minst ett tegn fra hver aktive kategori er med.
  // Hvis ikke: bytt ut et tilfeldig tegn med et fra den manglende kategorien.
  const required: string[] = [];
  if (o.uppercase) required.push(o.excludeSimilar ? UPPER.replace(SIMILAR, "") : UPPER);
  if (o.lowercase) required.push(o.excludeSimilar ? LOWER.replace(SIMILAR, "") : LOWER);
  if (o.digits) required.push(o.excludeSimilar ? DIGITS.replace(SIMILAR, "") : DIGITS);
  if (o.symbols) required.push(SYMBOLS);

  for (const cat of required) {
    if (!out.some((ch) => cat.includes(ch)) && o.length >= required.length) {
      const posBuf = new Uint32Array(1);
      const chBuf = new Uint32Array(1);
      crypto.getRandomValues(posBuf);
      crypto.getRandomValues(chBuf);
      out[posBuf[0] % out.length] = cat[chBuf[0] % cat.length];
    }
  }

  return out.join("");
}
