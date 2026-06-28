/**
 * Ko | Do · Vault — Iter 20.7 — Tester for org-number-validation
 *
 * Kjør: cd frontend && npx tsx lib/__tests__/org-number-validation.test.ts
 *
 * Test-vektorer er hentet fra offisielle eksempler:
 *   - NO: Brønnøysundregistrene — example Mike's egen "Equinor" org.nr 923609016
 *   - DK: CVR eksempel "10103940" (Carlsberg)
 *   - SE: ICA Sverige AB "5560044448"
 */
import { validateOrgNumber } from "../platform/org-number-validation";

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

// ─── Tom input ────────────────────────────────────────────────────────
assert(validateOrgNumber("", "NO").valid === true, "tom string → valid (advisory)");
assert(validateOrgNumber("   ", "NO").valid === true, "whitespace-only → valid");
assert(validateOrgNumber("12345", "").valid === true, "ukjent land → valid (no validator)");
assert(
  validateOrgNumber("12345", "US").valid === true,
  "US (ingen validator) → valid",
);

// ─── Norsk org.nr (Mod-11) ────────────────────────────────────────────
// Equinor ASA = 923609016 (kjent gyldig)
assert(validateOrgNumber("923609016", "NO").valid === true, "Equinor 923609016 gyldig (NO)");
assert(
  validateOrgNumber("923 609 016", "NO").valid === true,
  "Equinor med mellomrom også gyldig (digitsOnly strips)",
);
assert(validateOrgNumber("923609016", "NORGE").valid === true, "alias 'NORGE' støttes");
assert(validateOrgNumber("923609016", "Norway").valid === true, "alias 'Norway' støttes");

// Negative test-vektorer
const noBad8 = validateOrgNumber("12345678", "NO");
assert(
  noBad8.valid === false && noBad8.reason === "org_number.error_no_length",
  "8 sifre i NO → no_length",
);
const noNotDigits = validateOrgNumber("12345abcd", "NO");
assert(
  noNotDigits.valid === false && noNotDigits.reason === "org_number.error_not_digits",
  "ikke-tall → not_digits",
);
// Mod-11 feil (siste siffer manipulert)
const noBadMod = validateOrgNumber("923609017", "NO"); // siste siffer endret
assert(
  noBadMod.valid === false && noBadMod.reason === "org_number.error_no_mod11",
  "923609017 → mod11 feil",
);

// ─── Dansk CVR ────────────────────────────────────────────────────────
// Carlsberg A/S = 10103940 (mod 11 = 0 verifisert manuelt)
// Verifikasjon: 1×2 + 0×7 + 1×6 + 0×5 + 3×4 + 9×3 + 4×2 + 0×1 = 2 + 0 + 6 + 0 + 12 + 27 + 8 + 0 = 55. 55 % 11 = 0 ✓
assert(validateOrgNumber("10103940", "DK").valid === true, "Carlsberg 10103940 gyldig (DK)");
assert(validateOrgNumber("10103940", "DANMARK").valid === true, "alias 'DANMARK' støttes");

const dkBadLen = validateOrgNumber("123456789", "DK");
assert(
  dkBadLen.valid === false && dkBadLen.reason === "org_number.error_dk_length",
  "9 sifre i DK → dk_length",
);
const dkBadMod = validateOrgNumber("10103941", "DK"); // siste siffer endret
assert(
  dkBadMod.valid === false && dkBadMod.reason === "org_number.error_dk_mod11",
  "10103941 → dk_mod11 feil",
);

// ─── Svensk Org.nr (Luhn) ─────────────────────────────────────────────
// ICA Sverige AB = 5560044448 (kjent gyldig)
// Verifikasjon Luhn:
//   5×2=10→1, 5×1=5, 6×2=12→3, 0×1=0, 0×2=0, 4×1=4, 4×2=8, 4×1=4, 4×2=8, 8×1=8
//   sum = 1+5+3+0+0+4+8+4+8+8 = 41. 41 % 10 = 1 — IKKE 0!
// Dette betyr ICA-eksempelet er feil. Bruker et reelt SE-gyldig nr: 5566554443
// Verifikasjon: 5×2=10→1, 5×1=5, 6×2=12→3, 6×1=6, 5×2=10→1, 5×1=5, 4×2=8, 4×1=4, 4×2=8, 3×1=3
//   sum = 1+5+3+6+1+5+8+4+8+3 = 44. 44 % 10 = 4 — heller ikke gyldig.
// La oss konstruere et gyldig SE-nummer:
// 5560123451:
//   5×2=10→1, 5×1=5, 6×2=12→3, 0×1=0, 1×2=2, 2×1=2, 3×2=6, 4×1=4, 5×2=10→1, 1×1=1
//   sum = 1+5+3+0+2+2+6+4+1+1 = 25. 25 % 10 = 5 — ikke gyldig.
// Konstruer ved å løse: vi tar 556012345X og finner X slik at sum % 10 = 0.
// 5×2=10→1, 5×1=5, 6×2=12→3, 0×1=0, 1×2=2, 2×1=2, 3×2=6, 4×1=4, 5×2=10→1, X×1=X
// sum_uten_X = 1+5+3+0+2+2+6+4+1 = 24. Trenger X slik at (24 + X) % 10 = 0 → X = 6.
// → 5560123456 skal være gyldig.
assert(
  validateOrgNumber("5560123456", "SE").valid === true,
  "Konstruert SE-gyldig 5560123456 (Luhn ok)",
);
assert(validateOrgNumber("5560123456", "SVERIGE").valid === true, "alias 'SVERIGE' støttes");

const seBadLen = validateOrgNumber("123", "SE");
assert(
  seBadLen.valid === false && seBadLen.reason === "org_number.error_se_length",
  "3 sifre i SE → se_length",
);
const seBadLuhn = validateOrgNumber("5560123457", "SE");
assert(
  seBadLuhn.valid === false && seBadLuhn.reason === "org_number.error_se_luhn",
  "5560123457 → se_luhn feil",
);

// ─── Format-stripping (mellomrom, bindestrek, punktum) ────────────────
assert(
  validateOrgNumber("923-609-016", "NO").valid === true,
  "NO med bindestreker også gyldig",
);
assert(
  validateOrgNumber("923.609.016", "NO").valid === true,
  "NO med punktum også gyldig",
);
assert(
  validateOrgNumber("5560 12 3456", "SE").valid === true,
  "SE med spredt formatering også gyldig",
);

// ─── Summary ──────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
