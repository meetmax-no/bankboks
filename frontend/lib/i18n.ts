/**
 * Ko | Do · Vault — i18n-kjerne (D-036)
 *
 * Egen lett i18n-løsning. Ingen eksterne dependencies.
 * Denne filen er ren TypeScript (ingen React, ingen JSX) — kan importeres
 * fra tester og util-kode. React-laget bor i `i18n-context.tsx`.
 *
 * Designprinsipper:
 *  - Flat nøkkel-struktur med dot-notation:  "auth.unlock_title"
 *  - Fallback-kjede:                          dict[locale][key] ?? dict.no[key] ?? key
 *  - Norsk (no) er kanonisk referansespråk
 *  - Tre språk i fase 1:                      no, sv, da (ISO 639-1, IKKE landkoder)
 *  - Locale lagres i localStorage som "kodo-locale"
 *  - Auto-detect via navigator.language KUN hvis det matcher no/sv/da
 *  - Tenant-default fra `defaultLocale` i clients/<name>.json
 *
 * Locale-deteksjons-rekkefølge (per ROADMAP § v4.2):
 *   1. localStorage["kodo-locale"]
 *   2. tenant defaultLocale (fra useAppConfig)
 *   3. navigator.language slice(0,2) hvis matcher no/sv/da
 *   4. Hard fallback: "no"
 */

import noDict from "./locales/no.json";
import svDict from "./locales/sv.json";
import daDict from "./locales/da.json";
import enDict from "./locales/en.json";

// ────────────────────────────────────────────────────────────────────
// Typer + konstanter
// ────────────────────────────────────────────────────────────────────

export type Locale = "no" | "sv" | "da" | "en";

export const LOCALES: readonly Locale[] = ["no", "sv", "da", "en"] as const;
export const DEFAULT_LOCALE: Locale = "no";
export const STORAGE_KEY = "kodo-locale";

/** Metadata om hvert språk (flagg-emoji + visnings-navn — for LanguagePicker). */
export const LOCALE_META: Record<Locale, { flag: string; label: string; nativeLabel: string }> = {
  no: { flag: "🇳🇴", label: "Norsk", nativeLabel: "Norsk" },
  sv: { flag: "🇸🇪", label: "Svensk", nativeLabel: "Svenska" },
  da: { flag: "🇩🇰", label: "Dansk", nativeLabel: "Dansk" },
  en: { flag: "🇬🇧", label: "Engelsk", nativeLabel: "English" },
};

type Dict = Record<string, string>;

/**
 * Ordbøker — flate strenger. JSON-filene kan inneholde `_meta`-feltet
 * (objekt) som vi filtrerer bort så ingen forsøker å t("_meta").
 */
const RAW_DICTS: Record<Locale, Record<string, unknown>> = {
  no: noDict as Record<string, unknown>,
  sv: svDict as Record<string, unknown>,
  da: daDict as Record<string, unknown>,
  en: enDict as Record<string, unknown>,
};

function flatten(raw: Record<string, unknown>): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(raw)) {
    // Skipp alle underscore-prefiks-nøkler (_meta, _section_new_keys, etc.)
    // — disse er markører/metadata i JSON-filen, ikke ekte i18n-nøkler.
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

export const DICTS: Record<Locale, Dict> = {
  no: flatten(RAW_DICTS.no),
  sv: flatten(RAW_DICTS.sv),
  da: flatten(RAW_DICTS.da),
  en: flatten(RAW_DICTS.en),
};

// ────────────────────────────────────────────────────────────────────
// Pure translate-funksjon (kan brukes utenfor React)
// ────────────────────────────────────────────────────────────────────

/**
 * Slå opp en nøkkel i ordboken for valgt locale.
 *
 * Fallback-kjede (per D-036):
 *   1. dict[locale][key]   — direkte treff
 *   2. dict.no[key]        — norsk referanse
 *   3. key                 — siste utvei: returner nøkkelen selv (synlig i UI så agent ser den mangler)
 */
export function translate(key: string, locale: Locale): string {
  const exact = DICTS[locale]?.[key];
  if (exact !== undefined) return exact;
  const fallback = DICTS[DEFAULT_LOCALE]?.[key];
  if (fallback !== undefined) return fallback;
  return key;
}

/**
 * Hook-vennlig oversettelse for kode utenfor React-treet
 * (f.eks. inne i hooks som useVault/useCards/useIds, eller andre util-funksjoner
 * som ikke kan kalle useLocale()).
 *
 * Leser aktiv locale fra localStorage; faller til DEFAULT_LOCALE under SSR
 * eller hvis localStorage er utilgjengelig. Dette er trygt fordi hooks-kall
 * skjer i client-runtime etter mount.
 *
 * Use case: throw new Error(tHook("vault.error_not_found_on_server"))
 * — feilmeldingen kommer da på brukerens valgte språk når den eventuelt
 * fanges av komponent-koden og rendres som toast.
 */
export function tHook(key: string): string {
  return translate(key, readStoredLocale() ?? DEFAULT_LOCALE);
}

// ────────────────────────────────────────────────────────────────────
// Locale-deteksjon
// ────────────────────────────────────────────────────────────────────

export function isValidLocale(x: unknown): x is Locale {
  return typeof x === "string" && (LOCALES as readonly string[]).includes(x);
}

/**
 * Match navigator.language ("nb-NO", "sv-SE", "da-DK", "en-US"...) mot våre
 * tre språk. Norsk dekker både "nb" og "nn" og "no".
 */
export function matchNavigatorLocale(navLang: string | undefined | null): Locale | null {
  if (!navLang) return null;
  const lower = navLang.toLowerCase();
  if (lower.startsWith("nb") || lower.startsWith("nn") || lower.startsWith("no")) return "no";
  if (lower.startsWith("sv")) return "sv";
  if (lower.startsWith("da")) return "da";
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * Hent lagret locale fra localStorage. Returnerer null hvis ikke satt eller
 * ugyldig. Safe for SSR (sjekker typeof window).
 */
export function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isValidLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Skriv locale til localStorage. Safe for SSR.
 */
export function writeStoredLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* localStorage kan være avslått — ignorer */
  }
}

/**
 * Resolverer initial locale per ROADMAP § v4.2-kjeden.
 * Brukes både i LocaleProvider og i tester.
 */
export function resolveInitialLocale(opts: {
  stored?: Locale | null;
  tenantDefault?: Locale | null;
  navLanguage?: string | null;
}): Locale {
  if (opts.stored && isValidLocale(opts.stored)) return opts.stored;
  if (opts.tenantDefault && isValidLocale(opts.tenantDefault)) return opts.tenantDefault;
  const nav = matchNavigatorLocale(opts.navLanguage);
  if (nav) return nav;
  return DEFAULT_LOCALE;
}
