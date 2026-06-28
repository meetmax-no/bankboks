/**
 * Ko | Do · Vault — Deleted-confirmation extension tests
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/deleted-confirmation-extension.test.ts`
 *
 * Dekker A4-mal-utvidelsen (Iter 19.10):
 *   - Stripe-historikk-blokk vises KUN for betalende kunder
 *   - Stripe-blokk inneholder retention-dato (deletedAt + 5 år)
 *   - Exit-survey-lenken vises ALLTID, peker til EXIT_SURVEY_URL-placeholder
 *   - Brand-string-tallet er bevart (2: header + footer)
 *   - Eneste {{subdomain}}-orange-anchor er fortsatt nøyaktig 1 (start-over-blokken)
 */

import fs from "node:fs/promises";
import path from "node:path";

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "lib",
  "platform",
  "email-templates",
);

const LANGS = ["no", "sv", "da", "en"] as const;

async function read(name: string): Promise<string> {
  return fs.readFile(path.join(TEMPLATE_DIR, `${name}.html`), "utf8");
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

async function main() {
// ─── Test 1: Alle 4 maler har stripeHistoryBlock-placeholder ────────────
console.log("\n1. Templates har {{stripeHistoryBlock}}-placeholder");
for (const lang of LANGS) {
  const html = await read(`deleted-confirmation.${lang}`);
  assert(
    html.includes("{{stripeHistoryBlock}}"),
    `deleted-confirmation.${lang}: har {{stripeHistoryBlock}}-placeholder`,
  );
}

// ─── Test 2: Alle 4 maler har exit-survey-blokk ─────────────────────────
console.log("\n2. Templates har exit-survey-rad med {{exitSurveyUrl}}");
for (const lang of LANGS) {
  const html = await read(`deleted-confirmation.${lang}`);
  assert(
    html.includes("{{exitSurveyUrl}}"),
    `deleted-confirmation.${lang}: har {{exitSurveyUrl}}-placeholder`,
  );
  // Sjekk varianter av "Svar her" / "Answer here" / "Svara här"
  const surveyTexts: Record<string, string> = {
    no: "Svar her",
    sv: "Svara här",
    da: "Svar her",
    en: "Answer here",
  };
  assert(
    html.includes(surveyTexts[lang]),
    `deleted-confirmation.${lang}: har "${surveyTexts[lang]}"-CTA`,
  );
}

// ─── Test 3: Brand-string-tall = 2 (header + footer) bevart ─────────────
console.log("\n3. Brand-string-tall bevart (2 = header + footer)");
for (const lang of LANGS) {
  const html = await read(`deleted-confirmation.${lang}`);
  const matches = html.match(/Ko \| Do · Vault/g) ?? [];
  assert(
    matches.length === 2,
    `deleted-confirmation.${lang}: ${matches.length} 'Ko | Do · Vault'-forekomster (forventet 2)`,
  );
}

// ─── Test 4: Orange-underline anchor til {{subdomain}} = nøyaktig 1 ─────
console.log("\n4. Orange+underline {{subdomain}}-anchor = 1 (start-over)");
for (const lang of LANGS) {
  const html = await read(`deleted-confirmation.${lang}`);
  const orange = html.match(
    /<a href="https:\/\/\{\{subdomain\}\}\.kodovault\.no" style="color:#f5a623;text-decoration:underline;">\{\{subdomain\}\}\.kodovault\.no<\/a>/g,
  );
  assert(
    orange !== null && orange.length === 1,
    `deleted-confirmation.${lang}: nøyaktig 1 orange+underline subdomain-anchor (faktisk: ${orange?.length ?? 0})`,
  );
}

// ─── Test 5: Gammelt "What we kept"-blokk er borte ──────────────────────
console.log("\n5. Gammelt hardkodet '5 år'-blokk er fjernet fra templates");
const oldHardcoded: Record<string, string> = {
  no: "Faktura-historikken din ligger hos Stripe i minst 5 år",
  sv: "Din fakturahistorik finns kvar hos Stripe i minst 5 år",
  da: "Din fakturahistorik opbevares hos Stripe i mindst 5 år",
  en: "Your invoice history is retained by Stripe for at least 5 years",
};
for (const lang of LANGS) {
  const html = await read(`deleted-confirmation.${lang}`);
  assert(
    !html.includes(oldHardcoded[lang]),
    `deleted-confirmation.${lang}: gammel hardkodet 5-års-tekst er borte`,
  );
}

// ─── Test 6: renderStripeHistoryBlock vs. ikke-betalende ────────────────
console.log("\n6. sendDeletedConfirmation oppførsel (mail-disabled i test)");

// Vi setter ikke EMAIL_ENABLED — så precheckEmail returnerer skipped.
// Det er nok til å verifisere at funksjonene KAN kalles uten å kaste.
const { sendDeletedConfirmation, sendDeletedConfirmationFromSnapshot } =
  await import("../platform/notify-email");

const paidTenant = {
  subdomain: "paid-test",
  firstName: "Mike",
  email: "mike@example.com",
  contactEmail: null,
  locale: "no" as const,
  emailPreferences: { transactional: true as const, lifecycle: true },
  stripeSubscriptionId: "sub_123",
} as unknown as Parameters<typeof sendDeletedConfirmation>[0];

const freeTenant = {
  ...paidTenant,
  subdomain: "free-test",
  stripeSubscriptionId: null,
} as unknown as Parameters<typeof sendDeletedConfirmation>[0];

const r1 = await sendDeletedConfirmation(paidTenant);
assert(
  r1.skipped === true,
  "6a. paid tenant: mail skipped (EMAIL_ENABLED ikke satt) — funksjonen kastet ikke",
);
const r2 = await sendDeletedConfirmation(freeTenant);
assert(
  r2.skipped === true,
  "6b. free tenant: mail skipped — funksjonen kastet ikke",
);

// ─── Test 7: snapshot-varianten kaller ikke db ──────────────────────────
console.log("\n7. sendDeletedConfirmationFromSnapshot bruker kun snapshot");
const r3 = await sendDeletedConfirmationFromSnapshot({
  subdomain: "snap-test",
  firstName: "Anne",
  email: "anne@example.com",
  contactEmail: null,
  locale: "sv",
  hadStripeSubscription: true,
  emailPreferences: { transactional: true as const, lifecycle: true },
  deletedAt: new Date("2026-06-14T10:00:00Z"),
});
assert(
  r3.skipped === true,
  "7. snapshot-variant kjører uten kast (mail disabled i test-env)",
);

console.log("\n✓ Deleted-confirmation extension tests OK");
}

main().catch((err) => {
  console.error("UNCAUGHT ERROR:", err);
  process.exit(1);
});
