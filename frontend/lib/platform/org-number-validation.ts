/**
 * Ko | Do · Vault — Iter 20.7 (2026-06-26) — Organisasjons-nummer validering
 *
 * Validering av nasjonalt organisasjons-/MVA-nummer basert på `country`:
 *   - NO: 9-sifret Mod-11 (Norsk std for org.nr)
 *   - DK: 8-sifret CVR (Mod-11 vekter 2,7,6,5,4,3,2,1 ev. uten kontroll-
 *         siffer alene — vi bruker offisiell CVR-mod-11)
 *   - SE: 10-sifret org.nr (Luhn / Mod-10 — siste siffer kontroll)
 *
 * Returnerer `{ valid, reason }`. `reason` peker til i18n-nøkkel for å
 * gi presis feilmelding ("må være 9 sifre", "mod-11 feil" osv.).
 *
 * `country === ""` eller ukjent → returnerer `valid: true` (vi vil ikke
 * tvinge validering hvis Mike ikke har valgt land ennå). Behold som
 * advisory.
 */

export type OrgValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

const OK: OrgValidationResult = { valid: true };

function digitsOnly(s: string): string {
  return s.replace(/[\s.-]/g, "");
}

function isAllDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

// ─── Norsk Org.nr (9 sifre, Mod-11) ───────────────────────────────────
// Vekter: 3, 2, 7, 6, 5, 4, 3, 2 — siste siffer = (11 - (sum % 11)) % 11.
// Hvis kontroll-siffer === 10 → ugyldig (ingen norsk org.nr ender på 10).
function validateNorway(raw: string): OrgValidationResult {
  const d = digitsOnly(raw);
  if (d.length === 0) return OK;
  if (!isAllDigits(d)) return { valid: false, reason: "org_number.error_not_digits" };
  if (d.length !== 9) return { valid: false, reason: "org_number.error_no_length" };
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * weights[i];
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  if (check === 10) return { valid: false, reason: "org_number.error_no_mod11" };
  if (check !== Number(d[8])) return { valid: false, reason: "org_number.error_no_mod11" };
  return OK;
}

// ─── Dansk CVR (8 sifre, Mod-11) ──────────────────────────────────────
// Vekter: 2, 7, 6, 5, 4, 3, 2, 1 — sum % 11 må være 0 (siste siffer er
// inkludert i sum med vekt 1). Offisiell CVR-spesifikasjon.
function validateDenmark(raw: string): OrgValidationResult {
  const d = digitsOnly(raw);
  if (d.length === 0) return OK;
  if (!isAllDigits(d)) return { valid: false, reason: "org_number.error_not_digits" };
  if (d.length !== 8) return { valid: false, reason: "org_number.error_dk_length" };
  const weights = [2, 7, 6, 5, 4, 3, 2, 1];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * weights[i];
  if (sum % 11 !== 0) return { valid: false, reason: "org_number.error_dk_mod11" };
  return OK;
}

// ─── Svensk Org.nr (10 sifre, Luhn/Mod-10) ────────────────────────────
// Format: XXXXXX-XXXX (10 sifre). Validering med Luhn-algoritmen:
//   - For hvert siffer alternativt vektet 2/1 (start med 2 fra venstre)
//   - Hvis produkt > 9, summer sifrene (eq. trekk 9)
//   - Total sum % 10 må være 0
function validateSweden(raw: string): OrgValidationResult {
  const d = digitsOnly(raw);
  if (d.length === 0) return OK;
  if (!isAllDigits(d)) return { valid: false, reason: "org_number.error_not_digits" };
  if (d.length !== 10) return { valid: false, reason: "org_number.error_se_length" };
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(d[i]);
    if (i % 2 === 0) {
      n = n * 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  if (sum % 10 !== 0) return { valid: false, reason: "org_number.error_se_luhn" };
  return OK;
}

/**
 * Hoved-validator. `country` er ISO-koden valgt i company-country-feltet
 * ("NO" / "SE" / "DK" / "" / annet).
 *
 * Tomt org.nr → valid (felt er valgfritt — server håndhever ikke krav).
 * Ukjent land → valid (vi har ikke validatorer for alle land).
 */
export function validateOrgNumber(
  orgNumber: string,
  country: string,
): OrgValidationResult {
  const trimmed = orgNumber.trim();
  if (trimmed === "") return OK;
  switch (country.toUpperCase()) {
    case "NO":
    case "NOR":
    case "NORGE":
    case "NORWAY":
      return validateNorway(trimmed);
    case "DK":
    case "DNK":
    case "DANMARK":
    case "DENMARK":
      return validateDenmark(trimmed);
    case "SE":
    case "SWE":
    case "SVERIGE":
    case "SWEDEN":
      return validateSweden(trimmed);
    default:
      // Ikke-støttede land — godta som-er (advisory only).
      return OK;
  }
}
