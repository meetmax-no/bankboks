/**
 * Ko | Do · Vault — locale-aware dato-formattering (v4.2 D-036 Iter 5)
 *
 * Erstatter hardkodede `toLocaleString("nb-NO", ...)`-kall slik at datoer
 * vises i brukerens valgte språk (NO/SV/DA).
 *
 * Mike-beslutning (D-036 edge-case 2026-05-28): KORTFORM alltid.
 *   - NO: 28.5.2026   (punktum-separert, Intl-default)
 *   - SV: 2026-05-28  (ISO-format — svensk konvensjon)
 *   - DA: 28.5.2026   (punktum-separert, Intl-default)
 *
 * For tid-stempler (created/updated/exportedAt): kortform dato + tt:mm.
 */

import type { Locale } from "./i18n";

/** Mapper vår intern locale (ISO 639-1) til BCP-47 språk-region. */
export function localeToBcp47(locale: Locale): string {
  switch (locale) {
    case "no":
      return "nb-NO";
    case "sv":
      return "sv-SE";
    case "da":
      return "da-DK";
    case "en":
      return "en-GB";
  }
}

/**
 * Kortform dato: "28.5.2026" (NO/DA) eller "2026-05-28" (SV).
 *
 * @param iso  — ISO 8601-streng (yyyy-mm-dd eller full timestamp). Returnerer
 *               input ufoREndret hvis ugyldig.
 * @param locale — aktiv UI-locale.
 */
export function formatShortDate(iso: string, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(d);
}

/**
 * Kortform dato + tid: "28.5.2026, 14:32" (NO/DA) eller "2026-05-28 14:32" (SV).
 * Brukes for created/updated/exportedAt-stempler.
 */
export function formatShortDateTime(iso: string, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/**
 * Lang form dato: "28. mai 2026" (NO), "28 maj 2026" (SV), "28. maj 2026" (DA).
 * Brukes der hvor månedsnavn gir bedre lesbarhet (settings-panelet o.l.).
 */
export function formatLongDate(iso: string, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Locale-aware streng-sammenligning (brukes til sortering av titler i
 * Cards/Ids/Vault-dashboards). æ/ø/å sorteres ulikt på sv vs no/da.
 */
export function localeCompare(
  a: string,
  b: string,
  locale: Locale,
): number {
  return a.localeCompare(b, localeToBcp47(locale));
}
