/**
 * Ko | Do · Vault — Postnummer → poststed live lookup
 *
 * D-105: én delt fetcher. Brukes via usePostnrAutofill-hook.
 *
 * Datakilder (begge gratis, ingen nøkkel, CORS-OK):
 *   - NO: Bring shippingguide API (clientUrl-param påkrevd)
 *   - DK: DataForsyningen (Danmarks offentlige adresseregister)
 *
 * Andre land → null (manuell input).
 */

const NO_POSTNR_RE = /^\d{4}$/;
const DK_POSTNR_RE = /^\d{4}$/;

export function isValidPostnr(country: string, postnr: string): boolean {
  const trimmed = postnr.trim();
  if (country === "NO") return NO_POSTNR_RE.test(trimmed);
  if (country === "DK") return DK_POSTNR_RE.test(trimmed);
  return false;
}

// Session-cache (per browser-tab) — Bring/DataForsyningen er stabile, ingen
// grunn til å re-fetche samme nøkkel på nytt.
const cache = new Map<string, string | null>();

export async function lookupPoststed(
  country: string,
  postnr: string,
): Promise<string | null> {
  const trimmed = postnr.trim();
  if (!isValidPostnr(country, trimmed)) return null;

  const key = `${country}:${trimmed}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    if (country === "NO") {
      const url =
        `https://api.bring.com/shippingguide/api/postalCode.json` +
        `?clientUrl=https://kodovault.no&pnr=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        cache.set(key, null);
        return null;
      }
      const data = await res.json();
      // { valid: true, result: "OSLO" } | { valid: false, ... }
      const city =
        data?.valid === true && typeof data.result === "string" && data.result
          ? (data.result as string)
          : null;
      cache.set(key, city);
      return city;
    }

    if (country === "DK") {
      const url = `https://api.dataforsyningen.dk/postnumre/${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        cache.set(key, null);
        return null;
      }
      const data = await res.json();
      // { nr: "2100", navn: "København Ø", ... }
      const city = typeof data?.navn === "string" ? (data.navn as string) : null;
      cache.set(key, city);
      return city;
    }
  } catch {
    // Nettverksfeil — ikke cache (kan være midlertidig)
    return null;
  }

  return null;
}
