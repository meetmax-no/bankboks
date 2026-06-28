/**
 * Ko | Do · Vault — v4.3 Iter 19.9 Fase 1 (2026-06-13)
 *
 * Verifiserer at backend nå håndterer 4 språk (NO/SV/DA/EN) korrekt:
 *   1. resolveLocale() returnerer riktig språk per tenant.locale (inkl.
 *      robust fallback til 'no' ved ugyldig/manglende verdi)
 *   2. formatDateOnly() bruker Intl per språk (sv-SE, da-DK osv.) og gir
 *      naturlig datoformat
 *   3. formatDayWord() returnerer riktig dag-form per språk
 *   4. lifecycleReasonText() (A3) gir naturlig setning per språk for både
 *      trial-spor og cancel-spor
 *   5. Subject-helpers (welcomeSubject + lifecycleWarningSubject) gir
 *      riktig språk
 *   6. Alle 24 mal-filer (NO/SV/DA/EN × 6 typer) eksisterer og er valide
 *
 * Tester de internal helpers direkte via `__testHelpers`-eksport for å
 * unngå Resend-mocking. Mike's QA-fokus:
 *   - {{deleteDate}} riktig dansk/svensk datoformat
 *   - {{reasonText}} (trial vs cancel) naturlig på SV og DA
 */
import fs from "node:fs/promises";
import path from "node:path";
import { __testHelpers } from "../platform/notify-email";
import type { TenantRecord } from "../platform/tenant-types";

const {
  resolveLocale,
  formatDayWord,
  formatDateOnly,
  fallbackName,
  welcomeSubject,
  lifecycleReasonText,
  lifecycleWarningSubject,
} = __testHelpers;

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

async function readTemplate(name: string): Promise<string> {
  const file = path.join(
    process.cwd(),
    "lib",
    "platform",
    "email-templates",
    `${name}.html`,
  );
  return fs.readFile(file, "utf8");
}

async function runTests() {
  // ─── Test 1: resolveLocale ───────────────────────────────────────────
  console.log("\nresolveLocale — 4 språk + robust fallback");
  assert(
    resolveLocale({ locale: "no" } as TenantRecord) === "no",
    "tenant.locale='no' → 'no'",
  );
  assert(
    resolveLocale({ locale: "sv" } as TenantRecord) === "sv",
    "tenant.locale='sv' → 'sv'",
  );
  assert(
    resolveLocale({ locale: "da" } as TenantRecord) === "da",
    "tenant.locale='da' → 'da'",
  );
  assert(
    resolveLocale({ locale: "en" } as TenantRecord) === "en",
    "tenant.locale='en' → 'en'",
  );
  assert(
    resolveLocale({ locale: null } as unknown as TenantRecord) === "no",
    "tenant.locale=null → 'no' (siste forsvar)",
  );
  assert(
    resolveLocale({ locale: "fr" } as unknown as TenantRecord) === "no",
    "tenant.locale='fr' (ukjent) → 'no'",
  );

  // ─── Test 2: formatDayWord ───────────────────────────────────────────
  console.log("\nformatDayWord — riktig dag-form per språk + pluralis");
  assert(formatDayWord(1, "no") === "dag", "NO 1 → 'dag'");
  assert(formatDayWord(7, "no") === "dager", "NO 7 → 'dager'");
  assert(formatDayWord(1, "sv") === "dag", "SV 1 → 'dag'");
  assert(formatDayWord(7, "sv") === "dagar", "SV 7 → 'dagar'");
  assert(formatDayWord(1, "da") === "dag", "DA 1 → 'dag'");
  assert(formatDayWord(7, "da") === "dage", "DA 7 → 'dage'");
  assert(formatDayWord(1, "en") === "day", "EN 1 → 'day'");
  assert(formatDayWord(7, "en") === "days", "EN 7 → 'days'");

  // ─── Test 3: formatDateOnly — Intl per språk ─────────────────────────
  console.log("\nformatDateOnly — Intl gir naturlig dato-format per land");
  // 12. august 2026 (UTC)
  const iso = "2026-08-12T00:00:00.000Z";
  const noDate = formatDateOnly(iso, "no");
  const svDate = formatDateOnly(iso, "sv");
  const daDate = formatDateOnly(iso, "da");
  const enDate = formatDateOnly(iso, "en");
  assert(/12\.\s*august\s*2026/i.test(noDate), `NO: '${noDate}' (forventet '12. august 2026')`);
  assert(/12\s+augusti\s+2026/i.test(svDate), `SV: '${svDate}' (forventet '12 augusti 2026', ingen punktum)`);
  assert(/12\.\s*august\s*2026/i.test(daDate), `DA: '${daDate}' (forventet '12. august 2026')`);
  assert(/12\s+August\s+2026/i.test(enDate), `EN: '${enDate}' (forventet '12 August 2026')`);
  // null → "—"
  assert(formatDateOnly(null, "no") === "—", "null-input → '—'");

  // ─── Test 4: fallbackName ────────────────────────────────────────────
  console.log("\nfallbackName — naturlig tiltale når firstName mangler");
  assert(fallbackName("no") === "deg", "NO → 'deg'");
  assert(fallbackName("sv") === "där", "SV → 'där'");
  assert(fallbackName("da") === "der", "DA → 'der'");
  assert(fallbackName("en") === "there", "EN → 'there'");

  // ─── Test 5: welcomeSubject ──────────────────────────────────────────
  console.log("\nwelcomeSubject — riktig språk + 'Ko | Do · Vault' aldri oversatt");
  for (const loc of ["no", "sv", "da", "en"] as const) {
    const subj = welcomeSubject(loc);
    assert(subj.includes("Ko | Do · Vault"), `${loc}: subject inneholder 'Ko | Do · Vault'`);
    assert(subj.includes("🔐"), `${loc}: subject har låse-ikon`);
  }
  assert(welcomeSubject("sv").includes("är klart"), "SV: 'är klart'");
  assert(welcomeSubject("da").includes("er klar"), "DA: 'er klar'");
  assert(welcomeSubject("en").includes("is ready"), "EN: 'is ready'");

  // ─── Test 6: lifecycleReasonText — trial-spor (cancelledAt=null) ─────
  console.log("\nlifecycleReasonText — trial-spor: naturlige setninger");
  const lockedAtStr = "15. juli 2026"; // simulert formatDateOnly-output
  assert(
    lifecycleReasonText("no", false, lockedAtStr) ===
      `Prøveperioden din utløp ${lockedAtStr} og kontoen ble låst.`,
    "NO trial",
  );
  assert(
    lifecycleReasonText("sv", false, "15 juli 2026") ===
      "Din provperiod upphörde 15 juli 2026 och kontot låstes.",
    "SV trial",
  );
  assert(
    lifecycleReasonText("da", false, lockedAtStr) ===
      `Din prøveperiode udløb ${lockedAtStr} og kontoen blev låst.`,
    "DA trial",
  );
  assert(
    lifecycleReasonText("en", false, "15 July 2026") ===
      "Your trial ended on 15 July 2026 and the account was locked.",
    "EN trial",
  );

  // ─── Test 7: lifecycleReasonText — cancel-spor ───────────────────────
  console.log("\nlifecycleReasonText — cancel-spor: naturlige setninger");
  assert(
    lifecycleReasonText("no", true, lockedAtStr) ===
      `Abonnementet ditt ble kansellert ${lockedAtStr} og kontoen ble låst.`,
    "NO cancel",
  );
  assert(
    lifecycleReasonText("sv", true, "15 juli 2026") ===
      "Ditt abonnemang sades upp 15 juli 2026 och kontot låstes.",
    "SV cancel",
  );
  assert(
    lifecycleReasonText("da", true, lockedAtStr) ===
      `Dit abonnement blev annulleret ${lockedAtStr} og kontoen blev låst.`,
    "DA cancel",
  );
  assert(
    lifecycleReasonText("en", true, "15 July 2026") ===
      "Your subscription was cancelled on 15 July 2026 and the account was locked.",
    "EN cancel",
  );

  // ─── Test 8: lifecycleWarningSubject — dynamisk daysLeft+dayWord ─────
  console.log("\nlifecycleWarningSubject — dynamisk + riktig språk");
  assert(
    lifecycleWarningSubject("no", 7, "dager") === "Vault'en din slettes om 7 dager",
    "NO 7 dager",
  );
  assert(
    lifecycleWarningSubject("sv", 7, "dagar") === "Ditt valv raderas om 7 dagar",
    "SV 7 dagar",
  );
  assert(
    lifecycleWarningSubject("da", 7, "dage") === "Din vault slettes om 7 dage",
    "DA 7 dage",
  );
  assert(
    lifecycleWarningSubject("en", 7, "days") === "Your vault will be deleted in 7 days",
    "EN 7 days",
  );
  // 1-dag variant
  assert(
    lifecycleWarningSubject("sv", 1, formatDayWord(1, "sv")) === "Ditt valv raderas om 1 dag",
    "SV 1 dag (pluralis-helper konsistent)",
  );

  // ─── Test 9: Alle 24 mal-filer er gyldige ────────────────────────────
  console.log("\nMal-filer — alle 24 (NO/SV/DA/EN × 6 typer) er gyldige");
  const types = [
    "welcome",
    "trial-reminder-t5",
    "locked-from-trial",
    "locked-from-cancel",
    "lifecycle-warning",
    "deleted-confirmation",
  ];
  for (const t of types) {
    for (const loc of ["no", "sv", "da", "en"]) {
      const html = await readTemplate(`${t}.${loc}`);
      assert(html.length > 200, `${t}.${loc}.html er > 200 chars`);
      assert(html.includes(`lang="${loc}"`), `${t}.${loc}.html har lang="${loc}"`);
      assert(html.includes("Ko | Do · Vault"), `${t}.${loc}.html har 'Ko | Do · Vault'-prefix`);
      // Ko | Do · Vault må ALDRI oversettes som produktnavn — alle maler skal
      // referere brandet eksakt som "Ko | Do · Vault" eller "Ko | Do · Vault"
      assert(
        !/Ko\s*\|\s*Do\s+(Valv|Boks|Hvelv|Tresor|Coffre)/i.test(html),
        `${t}.${loc}.html: 'Ko | Do' aldri etterfulgt av oversatte ord for 'vault'`,
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
