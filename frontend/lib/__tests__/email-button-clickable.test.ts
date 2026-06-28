/**
 * Ko | Do · Vault — Iter 17.x (oppdatert 2026-06-23) — Klikkbar e-postknapp
 *
 * Bug-fanger: Forhindrer regresjon av to separate iOS-/Apple Mail-bugs:
 *   - Padding-only-på-<td>-buggen (klikk i padding traff ikke <a>).
 *   - iOS Safari som åpner uten å navigere når lenker mangler target=_blank.
 *     Apple Mail rerendrer da klikket inn i samme mail-kontekst og
 *     navigeringen droppes. Gjelder ALLE https://-lenker — ikke kun CTA.
 *
 * Krav (alle CTA-mailer):
 *   1. `<a>` har display:inline-block (gjør padding klikkbar)
 *   2. `<a>` har padding (hele pillen er klikkflate, ikke bare tekst)
 *   3. `<a>` har target="_blank" (tvinger ny browser-kontekst på iOS)
 *   4. `<a>` har rel="noopener noreferrer" (sikkerhet for target="_blank")
 *   5. `<td>` rundt knappen har IKKE `padding:14px 32px` (gammelt mønster)
 *   6. ALLE https://-anker i mal-filene (CTA + tekstlenker + footer) har
 *      target="_blank" rel="noopener noreferrer" — mailto: er unntatt.
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

const CTA_TEMPLATES = [
  "welcome.no",
  "welcome.sv",
  "welcome.da",
  "welcome.en",
  "trial-reminder-t5.no",
  "trial-reminder-t5.sv",
  "trial-reminder-t5.da",
  "trial-reminder-t5.en",
  "locked-from-trial.no",
  "locked-from-trial.sv",
  "locked-from-trial.da",
  "locked-from-trial.en",
  "locked-from-cancel.no",
  "locked-from-cancel.sv",
  "locked-from-cancel.da",
  "locked-from-cancel.en",
  "lifecycle-warning.no",
  "lifecycle-warning.sv",
  "lifecycle-warning.da",
  "lifecycle-warning.en",
  // Iter 20.9 (D-081): B2B am-admin velkomstmail med CTA-knapp
  "org-admin-welcome.no",
  "org-admin-welcome.sv",
  "org-admin-welcome.da",
  "org-admin-welcome.en",
];

async function read(name: string): Promise<string> {
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
  console.log("\nE-postknapp — hele pillen må være klikkbar");

  for (const name of CTA_TEMPLATES) {
    const html = await read(name);

    // Finn ALLE ankere som peker mot vault-subdomenet og plukk det som
    // ser ut som en knapp (display:inline-block + padding). Velkomstmail
    // har også en kort tekst-lenke ("Gå til xxx.kodovault.no") som IKKE
    // er en knapp — den skal ikke testes mot knappe-kravene.
    //
    // Iter 20.9 (D-081): org-admin-welcome bruker `{{adminUrl}}`-placeholder
    // (full URL settes på send-tidspunkt) i stedet for `{{subdomain}}` —
    // begge mønstre aksepteres.
    const anchors = Array.from(
      html.matchAll(
        /<a href="(?:https:\/\/\{\{subdomain\}\}\.kodovault\.no[^"]*|\{\{adminUrl\}\})"[^>]*>/g,
      ),
    ).map((m) => m[0]);
    assert(
      anchors.length > 0,
      `${name}: minst ett <a href="...kodovault.no..."> finnes`,
    );
    const ctaTag = anchors.find((a) => /padding:14px 32px/.test(a));
    assert(
      ctaTag !== undefined,
      `${name}: knappe-anker med padding:14px 32px finnes`,
    );
    if (!ctaTag) continue;

    // target="_blank" KREVES — iOS Safari/Apple Mail åpner uten å
    // navigere når CTA-en mangler target. Tving ny browser-kontekst.
    assert(
      ctaTag.includes('target="_blank"'),
      `${name}: target="_blank" er satt (iOS-fix)`,
    );

    // rel="noopener noreferrer" KREVES sammen med target="_blank" for
    // å hindre vindu-leak og referrer-lekkasje til vault-subdomenet.
    assert(
      ctaTag.includes('rel="noopener noreferrer"'),
      `${name}: rel="noopener noreferrer" er satt (sikkerhet)`,
    );

    // display:inline-block — gjør padding klikkbar
    assert(
      ctaTag.includes("display:inline-block"),
      `${name}: <a> har display:inline-block`,
    );
  }

  console.log("\nE-postknapp — gammelt buggy mønster må være fraværende");
  for (const name of CTA_TEMPLATES) {
    const html = await read(name);
    assert(
      !html.includes(
        "background-color:#f5a623;border-radius:100px;padding:14px 32px",
      ),
      `${name}: gammelt <td>-mønster med padding er fjernet`,
    );
  }

  // ALLE https://-anker maa ha target="_blank" rel="noopener noreferrer"
  // (CTA + tekstlenker + footer). mailto: er ikke beroert.
  // deleted-confirmation er ikke i CTA_TEMPLATES, men den maa ogsaa
  // sjekkes. Vi skanner alle malfiler her.
  console.log("\nE-postlenker — ALLE https://-anker har target=_blank");
  const ALL_LOCALES = ["no", "sv", "da", "en"];
  const ALL_TYPES = [
    "welcome",
    "trial-reminder-t5",
    "locked-from-trial",
    "locked-from-cancel",
    "lifecycle-warning",
    "deleted-confirmation",
  ];
  for (const type of ALL_TYPES) {
    for (const locale of ALL_LOCALES) {
      const name = `${type}.${locale}`;
      const html = await read(name);
      const anchors = Array.from(
        html.matchAll(/<a (?<attrs>[^>]*?)href="https:\/\/[^"]+"[^>]*>/g),
      );
      let allOk = anchors.length > 0;
      for (const m of anchors) {
        const tag = m[0];
        if (
          !tag.includes('target="_blank"') ||
          !tag.includes('rel="noopener noreferrer"')
        ) {
          allOk = false;
          break;
        }
      }
      assert(
        allOk,
        `${name}: alle ${anchors.length} https-anker har target="_blank" rel="noopener noreferrer"`,
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
