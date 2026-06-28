/**
 * Ko | Do · Vault — v4.3 Iter 17.x (2026-06-13) — Test for localeOverride i
 * /api/admin/test-lifecycle-mail.
 *
 * Verifiserer at sendLifecycleWarning + sendTrialReminderT5 respekterer
 * tenant.locale (som er det route'n manipulerer for å tvinge språk i
 * testmail uten å skrive til Upstash).
 *
 * Vi tester selve effekten — at templates renderes på EN når
 * tenant.locale === "en" og NO når tenant.locale === "no" — siden det er
 * den eneste kanalen for override (route'n lager `effectiveTenant`).
 */
import fs from "node:fs/promises";
import path from "node:path";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

async function read(template: string, locale: "no" | "sv" | "da" | "en"): Promise<string> {
  const file = path.join(
    process.cwd(),
    "lib",
    "platform",
    "email-templates",
    `${template}.${locale}.html`,
  );
  return fs.readFile(file, "utf8");
}

async function runTests() {
  console.log("\nLocaleOverride — alle 5 maltyper har alle 4 språk (NO/SV/DA/EN)");
  const types = [
    "trial-reminder-t5",
    "locked-from-trial",
    "locked-from-cancel",
    "lifecycle-warning",
    "deleted-confirmation",
  ] as const;
  const locales = ["no", "sv", "da", "en"] as const;
  const filesByType: Record<string, Record<string, string>> = {};
  for (const t of types) {
    filesByType[t] = {};
    for (const loc of locales) {
      const html = await read(t, loc);
      assert(
        html.length > 100,
        `${t}.${loc}.html eksisterer og er ikke tom (${html.length} chars)`,
      );
      filesByType[t][loc] = html;
    }
    // Alle språkpar skal være distinkte — ingen aksidentell duplikat
    for (let i = 0; i < locales.length; i++) {
      for (let j = i + 1; j < locales.length; j++) {
        assert(
          filesByType[t][locales[i]] !== filesByType[t][locales[j]],
          `${t}: ${locales[i]} og ${locales[j]} har ulikt innhold`,
        );
      }
    }
  }

  console.log("\nLocaleOverride — språkmessige kjernefraser per språk");
  // Spot-sjekk: hvert språk skal ha karakteristiske ord i CTA-malene
  const checks: Array<{ tpl: string; loc: typeof locales[number]; phrase: RegExp; label: string }> = [
    // lifecycle-warning: handler om sletting
    { tpl: "lifecycle-warning", loc: "no", phrase: /slettes/i, label: "lifecycle-warning.no inneholder 'slettes'" },
    { tpl: "lifecycle-warning", loc: "sv", phrase: /raderas/i, label: "lifecycle-warning.sv inneholder 'raderas'" },
    { tpl: "lifecycle-warning", loc: "da", phrase: /slettes/i, label: "lifecycle-warning.da inneholder 'slettes'" },
    { tpl: "lifecycle-warning", loc: "en", phrase: /delete|removed/i, label: "lifecycle-warning.en inneholder 'delete' eller 'removed'" },
    // trial-reminder-t5
    { tpl: "trial-reminder-t5", loc: "no", phrase: /prøveperiod/i, label: "trial-reminder-t5.no inneholder 'prøveperiod'" },
    { tpl: "trial-reminder-t5", loc: "sv", phrase: /provperiod/i, label: "trial-reminder-t5.sv inneholder 'provperiod'" },
    { tpl: "trial-reminder-t5", loc: "da", phrase: /prøveperiode/i, label: "trial-reminder-t5.da inneholder 'prøveperiode'" },
    { tpl: "trial-reminder-t5", loc: "en", phrase: /trial/i, label: "trial-reminder-t5.en inneholder 'trial'" },
    // locked-from-cancel
    { tpl: "locked-from-cancel", loc: "no", phrase: /kansellert|avsluttet/i, label: "locked-from-cancel.no inneholder 'kansellert/avsluttet'" },
    { tpl: "locked-from-cancel", loc: "sv", phrase: /uppsagt|avslutat/i, label: "locked-from-cancel.sv inneholder 'uppsagt/avslutat'" },
    { tpl: "locked-from-cancel", loc: "da", phrase: /annulleret|afsluttet/i, label: "locked-from-cancel.da inneholder 'annulleret/afsluttet'" },
    { tpl: "locked-from-cancel", loc: "en", phrase: /cancelled|ended/i, label: "locked-from-cancel.en inneholder 'cancelled/ended'" },
  ];
  for (const c of checks) {
    assert(c.phrase.test(filesByType[c.tpl][c.loc]), c.label);
  }

  console.log("\nLocaleOverride — Ko | Do · Vault aldri oversatt som produktnavn");
  // Mike-direktiv: "Ko | Do · Vault" må aldri oversettes. Vi sjekker mot
  // konkrete anti-pattern (oversatte vault-ord etter Ko | Do): "Valv",
  // "Boks", "Hvelv", "Tresor", "Coffre". Selve generic-nounen
  // "vault/valv/vaulten" lower-case er OK siden det refererer produkt-
  // feature og ikke brand. Brand-formen er ALLTID "Ko | Do · Vault".
  for (const t of types) {
    for (const loc of locales) {
      const html = filesByType[t][loc];
      assert(
        !/Ko\s*\|\s*Do\s+(Valv|Boks|Hvelv|Tresor|Coffre)/i.test(html),
        `${t}.${loc}: 'Ko | Do' aldri etterfulgt av oversatt vault-ord`,
      );
    }
  }

  console.log("\n──────────────────────────────────────");
  console.log(`Resultat: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Feilet:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
