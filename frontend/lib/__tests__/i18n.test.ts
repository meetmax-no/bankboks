/**
 * Offline sanity-test for i18n-kjernen (lib/i18n.ts).
 *
 * Dekker:
 *   - translate() med direkte treff
 *   - translate() fallback til norsk når locale mangler nøkkel
 *   - translate() siste-utvei: returnerer key når INGEN locale har den
 *   - isValidLocale() type-guard
 *   - matchNavigatorLocale() for alle 3 språk + ikke-støttede
 *   - resolveInitialLocale() med full deteksjons-kjede
 *
 * Kjør med:  npx tsx /app/frontend/lib/__tests__/i18n.test.ts
 */

import {
  DEFAULT_LOCALE,
  DICTS,
  isValidLocale,
  matchNavigatorLocale,
  resolveInitialLocale,
  translate,
  LOCALES,
} from "../i18n";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

// ───── Konstanter ─────
assert(DEFAULT_LOCALE === "no", "DEFAULT_LOCALE er 'no'");
assert(LOCALES.length === 4, "LOCALES har 4 språk");
assert(LOCALES.includes("no"), "no i LOCALES");
assert(LOCALES.includes("sv"), "sv i LOCALES");
assert(LOCALES.includes("da"), "da i LOCALES");
assert(LOCALES.includes("en"), "en i LOCALES");

// ───── isValidLocale ─────
assert(isValidLocale("no") === true, "isValidLocale('no') = true");
assert(isValidLocale("sv") === true, "isValidLocale('sv') = true");
assert(isValidLocale("da") === true, "isValidLocale('da') = true");
assert(isValidLocale("en") === true, "isValidLocale('en') = true");
assert(isValidLocale("nb") === false, "isValidLocale('nb') = false (kun ISO-kodene vi støtter)");
assert(isValidLocale(null) === false, "isValidLocale(null) = false");
assert(isValidLocale(undefined) === false, "isValidLocale(undefined) = false");
assert(isValidLocale(42) === false, "isValidLocale(42) = false");

// ───── matchNavigatorLocale ─────
assert(matchNavigatorLocale("nb-NO") === "no", "nb-NO → no");
assert(matchNavigatorLocale("nn-NO") === "no", "nn-NO → no (nynorsk dekkes)");
assert(matchNavigatorLocale("no") === "no", "'no' → no");
assert(matchNavigatorLocale("sv-SE") === "sv", "sv-SE → sv");
assert(matchNavigatorLocale("sv-FI") === "sv", "sv-FI (svensktalende Finland) → sv");
assert(matchNavigatorLocale("da-DK") === "da", "da-DK → da");
assert(matchNavigatorLocale("en-US") === "en", "en-US → en");
assert(matchNavigatorLocale("en-GB") === "en", "en-GB → en");
assert(matchNavigatorLocale("en") === "en", "en → en");
assert(matchNavigatorLocale("de-DE") === null, "de-DE → null");
assert(matchNavigatorLocale("fi-FI") === null, "fi-FI → null (finsk ikke skandinavisk)");
assert(matchNavigatorLocale("") === null, "tom streng → null");
assert(matchNavigatorLocale(null) === null, "null → null");
assert(matchNavigatorLocale(undefined) === null, "undefined → null");

// ───── translate() med fallback-kjede ─────

// Vi setter inn test-nøkler direkte i DICTS for å kontrollere fallback
// uten å være avhengig av at no.json/sv.json/da.json/en.json er fylt ut.
DICTS.no["test.only_no"] = "Kun norsk";
DICTS.no["test.all_three"] = "Norsk verdi";
DICTS.sv["test.all_three"] = "Svenska värdet";
DICTS.da["test.all_three"] = "Danska værdi";
DICTS.en["test.all_three"] = "English value";
DICTS.sv["test.only_sv"] = "Bara svenska";

// 1. Direkte treff
assert(translate("test.all_three", "no") === "Norsk verdi", "direkte: no → 'Norsk verdi'");
assert(translate("test.all_three", "sv") === "Svenska värdet", "direkte: sv → 'Svenska värdet'");
assert(translate("test.all_three", "da") === "Danska værdi", "direkte: da → 'Danska værdi'");
assert(translate("test.all_three", "en") === "English value", "direkte: en → 'English value'");

// 2. Fallback til norsk når locale mangler nøkkel
assert(
  translate("test.only_no", "sv") === "Kun norsk",
  "fallback til no: sv mangler test.only_no → 'Kun norsk'",
);
assert(
  translate("test.only_no", "da") === "Kun norsk",
  "fallback til no: da mangler test.only_no → 'Kun norsk'",
);
assert(
  translate("test.only_no", "en") === "Kun norsk",
  "fallback til no: en mangler test.only_no → 'Kun norsk'",
);

// 3. Svensk-spesifikk nøkkel som mangler i norsk → faller til key selv
// (Edge case: en oversetter har lagt inn en nøkkel i sv som ikke finnes i no.
//  Per D-036 er no kanonisk, så slike skal aldri eksistere i prod. Men hvis
//  det skjer, må vi ikke krasje — returner key.)
assert(
  translate("test.only_sv", "no") === "test.only_sv",
  "no mangler test.only_sv → returnerer key (no er kanonisk, men feiler trygt)",
);
// Direkte sv-treff fungerer fortsatt
assert(
  translate("test.only_sv", "sv") === "Bara svenska",
  "sv har test.only_sv → 'Bara svenska'",
);

// 4. Helt ukjent nøkkel → returnerer key selv (siste utvei)
assert(
  translate("does.not.exist", "no") === "does.not.exist",
  "ukjent nøkkel returneres som key (siste utvei)",
);
assert(
  translate("does.not.exist", "sv") === "does.not.exist",
  "ukjent nøkkel returneres som key også på sv",
);

// ───── resolveInitialLocale() — full deteksjons-kjede ─────

// 1. Stored vinner over alt
assert(
  resolveInitialLocale({ stored: "sv", tenantDefault: "da", navLanguage: "no-NO" }) === "sv",
  "stored vinner: sv > tenant=da > nav=no",
);

// 2. Tenant default når stored mangler
assert(
  resolveInitialLocale({ stored: null, tenantDefault: "da", navLanguage: "sv-SE" }) === "da",
  "tenant vinner over nav når stored = null",
);

// 3. Navigator når stored + tenant mangler
assert(
  resolveInitialLocale({ stored: null, tenantDefault: null, navLanguage: "sv-SE" }) === "sv",
  "nav brukes når stored + tenant = null",
);

// 4. Hard fallback til "no" når ingenting matcher (tysk er ikke i scope)
assert(
  resolveInitialLocale({ stored: null, tenantDefault: null, navLanguage: "de-DE" }) === "no",
  "hard fallback: 'no' når ingenting matcher",
);
assert(
  resolveInitialLocale({}) === "no",
  "hard fallback: 'no' når alt mangler",
);

// 4b. Engelsk navigator velger 'en' nå når det er i scope
assert(
  resolveInitialLocale({ stored: null, tenantDefault: null, navLanguage: "en-US" }) === "en",
  "en-US matcher 'en'",
);
assert(
  resolveInitialLocale({ stored: null, tenantDefault: null, navLanguage: "en-GB" }) === "en",
  "en-GB matcher 'en'",
);

// 5. Ugyldig stored skal ignoreres
assert(
  resolveInitialLocale({
    stored: "fi" as unknown as null,
    tenantDefault: "sv",
    navLanguage: "en",
  }) === "sv",
  "ugyldig stored ignoreres, faller til tenant",
);

// 6. Ugyldig tenant skal ignoreres
assert(
  resolveInitialLocale({
    stored: null,
    tenantDefault: "fi" as unknown as null,
    navLanguage: "da-DK",
  }) === "da",
  "ugyldig tenant ignoreres, faller til nav",
);

// ───── format-date.ts (Iter 5 D-036) ─────
// Importeres lazy slik at testen forblir selvkontainert hvis filen ikke finnes.
import {
  formatShortDate,
  formatShortDateTime,
  formatLongDate,
  localeCompare,
  localeToBcp47,
} from "../format-date";

const testIso = "2034-05-12T14:32:00Z";

assert(localeToBcp47("no") === "nb-NO", "localeToBcp47: no → nb-NO");
assert(localeToBcp47("sv") === "sv-SE", "localeToBcp47: sv → sv-SE");
assert(localeToBcp47("da") === "da-DK", "localeToBcp47: da → da-DK");
assert(localeToBcp47("en") === "en-GB", "localeToBcp47: en → en-GB");

// Kortform dato. Intl.DateTimeFormat-output varierer subtilt per Node-versjon,
// så vi tester invariantene: dato inneholder år+måned+dag-tall, og svensk
// bruker bindestrek mens NO/DA ikke gjør det.
const shortNo = formatShortDate(testIso, "no");
const shortSv = formatShortDate(testIso, "sv");
const shortDa = formatShortDate(testIso, "da");
const shortEn = formatShortDate(testIso, "en");
assert(shortNo.includes("2034") && shortNo.includes("5") && shortNo.includes("12"),
  `shortNo har 2034, 5, 12 — fikk '${shortNo}'`);
assert(shortSv.includes("2034") && shortSv.includes("05") && shortSv.includes("12"),
  `shortSv har ISO-form med 2034, 05, 12 — fikk '${shortSv}'`);
assert(shortSv.includes("-"),
  `shortSv bruker bindestrek (svensk konvensjon) — fikk '${shortSv}'`);
assert(!shortNo.includes("-"),
  `shortNo bruker IKKE bindestrek — fikk '${shortNo}'`);
assert(shortDa.includes("2034") && shortDa.includes("5") && shortDa.includes("12"),
  `shortDa har 2034, 5, 12 — fikk '${shortDa}'`);

// Lang form har månedsnavn på lokalt språk
const longNo = formatLongDate(testIso, "no");
const longSv = formatLongDate(testIso, "sv");
const longDa = formatLongDate(testIso, "da");
const longEn = formatLongDate(testIso, "en");
assert(longNo.toLowerCase().includes("mai"),
  `longNo har 'mai' (norsk) — fikk '${longNo}'`);
assert(longSv.toLowerCase().includes("maj"),
  `longSv har 'maj' (svensk) — fikk '${longSv}'`);
assert(longDa.toLowerCase().includes("maj"),
  `longDa har 'maj' (dansk) — fikk '${longDa}'`);
assert(longEn.toLowerCase().includes("may"),
  `longEn har 'May' (engelsk) — fikk '${longEn}'`);

// Engelsk shortDate skal inkludere år/måned/dag (en-GB-format)
assert(shortEn.includes("2034") && shortEn.includes("12"),
  `shortEn har 2034, 12 — fikk '${shortEn}'`);

// Dato + tid skal ha både datodel og klokkeslett
const dtNo = formatShortDateTime(testIso, "no");
assert(dtNo.match(/\d{1,2}[:.]\d{2}/),
  `formatShortDateTime inkluderer klokkeslett — fikk '${dtNo}'`);

// Tom og ugyldig input
assert(formatShortDate("", "no") === "", "tom string → tom string");
assert(formatShortDate("ikke-en-dato", "no") === "ikke-en-dato",
  "ugyldig input returneres uendret");

// localeCompare med æ/ø/å
const norskeOrd = ["æbler", "ørn", "åker", "banan"];
const sortedNo = [...norskeOrd].sort((a, b) => localeCompare(a, b, "no"));
const sortedSv = [...norskeOrd].sort((a, b) => localeCompare(a, b, "sv"));
// I norsk/dansk: b < æ < ø < å. I svensk: b < å (svensk har å før ä/ö, men
// æ er ikke i svensk så det sorteres etter standard Unicode). Vi sjekker bare
// at de er konsistente med locale, ikke nøyaktig rekkefølge.
assert(sortedNo[0] === "banan", `NO-sortering starter med 'banan' — fikk '${sortedNo[0]}'`);
assert(sortedSv[0] === "banan", `SV-sortering starter med 'banan' — fikk '${sortedSv[0]}'`);

console.log("\n✅ i18n.test.ts — alle assertions passert");
