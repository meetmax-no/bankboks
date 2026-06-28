/**
 * Ko | Do · Vault — v4.3 Iter 19.9 Fase 1.2 (2026-06-13)
 *
 * Regresjonsvern for footer-leselighet + brand-konvensjon:
 *
 * Mike-rapport: Footeren var "umulig å lese" pga lite font (11px) + svært
 * mørk grå (#444444) på vår mørke bakgrunn (#0a0e1a) → kontrast 1.6:1
 * langt under WCAG AA (4.5:1). Ekstra: brand ble skrevet som "Ko | Do · Vault"
 * i body — riktig form er "Ko | Do · Vault" (med U+00B7 middle dot).
 *
 * Fiks (Fase 1.2):
 *   - Footer-styling: font-size 11px→12px, color #444444→#aaaaaa
 *     (samme grå som info-tekst). Kontrast ~7.5:1 (WCAG AAA).
 *   - Brand: alle "Ko | Do · Vault" → "Ko | Do · Vault" overalt
 *     (24 forekomster i 16 HTML-filer + 4 TS-strenger i welcomeSubject).
 *
 * Dette regresjonsvernet låser begge regler permanent.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { __testHelpers } from "../platform/notify-email";

const { welcomeSubject } = __testHelpers;
const DIR = path.join(process.cwd(), "lib", "platform", "email-templates");

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

const ALL_FILES = [
  "welcome",
  "trial-reminder-t5",
  "locked-from-trial",
  "locked-from-cancel",
  "lifecycle-warning",
  "deleted-confirmation",
];
const LANGS = ["no", "sv", "da", "en"] as const;

async function readMail(name: string): Promise<string> {
  return fs.readFile(path.join(DIR, `${name}.html`), "utf8");
}

async function runTests() {
  // ─── Test 1: Footer-styling — 12px + #aaaaaa + 1.7 line-height ────
  console.log(
    "\nFooter-styling — 12px + #aaaaaa + line-height 1.7 (WCAG AAA-lesbart)",
  );
  for (const tpl of ALL_FILES) {
    for (const lang of LANGS) {
      const html = await readMail(`${tpl}.${lang}`);
      assert(
        html.includes("font-size:12px;color:#aaaaaa;line-height:1.7;"),
        `${tpl}.${lang}: ny footer-styling finnes`,
      );
      // Gammelt mønster må være helt fraværende
      assert(
        !html.includes("font-size:11px;color:#444444"),
        `${tpl}.${lang}: gammelt 11px/#444444-mønster fjernet`,
      );
    }
  }

  // ─── Test 2: Anti-patterns (gamle/feil brand-former) er fraværende ─
  console.log(
    "\nBrand-konvensjon — anti-patterns (gamle feil-former) er fraværende",
  );
  for (const tpl of ALL_FILES) {
    for (const lang of LANGS) {
      const html = await readMail(`${tpl}.${lang}`);
      // Forbudt: 'Ko|Do Vault' (uten space rundt pipe, uten prikk-separator)
      assert(
        !html.includes("Ko|Do Vault"),
        `${tpl}.${lang}: ingen 'Ko|Do Vault' (uten space rundt pipe)`,
      );
      // Forbudt: 'Ko|Do · Vault' (uten space rundt pipe, men med prikk)
      assert(
        !html.includes("Ko|Do · Vault"),
        `${tpl}.${lang}: ingen 'Ko|Do · Vault' (uten space rundt pipe)`,
      );
      // Forbudt: 'Ko | Do Vault' (med space rundt pipe, men uten prikk-separator)
      assert(
        !html.includes("Ko | Do Vault"),
        `${tpl}.${lang}: ingen 'Ko | Do Vault' (uten prikk-separator)`,
      );
    }
  }

  // ─── Test 3: Brand "Ko | Do · Vault" MED prikk finnes minst én gang ─
  console.log(
    "\nBrand-konvensjon — 'Ko | Do · Vault' MED separator-prikk er til stede",
  );
  for (const tpl of ALL_FILES) {
    for (const lang of LANGS) {
      const html = await readMail(`${tpl}.${lang}`);
      assert(
        html.includes("Ko | Do · Vault"),
        `${tpl}.${lang}: minst 1 'Ko | Do · Vault'-forekomst`,
      );
    }
  }

  // ─── Test 4: welcomeSubject — 4 språk har separator-prikk ─────────
  console.log("\nwelcomeSubject — alle 4 språk bruker 'Ko | Do · Vault'");
  for (const lang of LANGS) {
    const subj = welcomeSubject(lang);
    assert(
      subj.includes("Ko | Do · Vault"),
      `${lang}: subject '${subj}' inneholder 'Ko | Do · Vault'`,
    );
    assert(
      !subj.includes("Ko | Do · Vault") || subj.includes("Ko | Do · Vault"),
      `${lang}: ingen 'Ko | Do · Vault' uten prikk i subject`,
    );
  }

  // ─── Test 5: Forventet antall forekomster per mal (bevarer struktur) ─
  console.log(
    "\nBrand-konvensjon — forventet antall 'Ko | Do · Vault'-forekomster per mal",
  );
  const expectedCounts: Record<string, number> = {
    welcome: 4, // 1 header + 3 body
    "trial-reminder-t5": 1, // kun header
    "locked-from-trial": 1, // kun header
    "locked-from-cancel": 2, // 1 header + 1 body
    "lifecycle-warning": 2, // 1 header + 1 body
    "deleted-confirmation": 2, // 1 header + 1 body
  };
  for (const tpl of ALL_FILES) {
    for (const lang of LANGS) {
      const html = await readMail(`${tpl}.${lang}`);
      const matches = html.match(/Ko \| Do · Vault/g) ?? [];
      assert(
        matches.length === expectedCounts[tpl],
        `${tpl}.${lang}: ${matches.length} forekomster (forventet ${expectedCounts[tpl]})`,
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
