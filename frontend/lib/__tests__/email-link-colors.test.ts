/**
 * Ko | Do · Vault — v4.3 Iter 19.9 Fase 1.1 (2026-06-13)
 *
 * Regresjonsvern for differensiert lenke-fargestrategi:
 *
 * Mike's bug-rapport: Lenker i lifecycle-mailene renderet som blå på
 * mørk bakgrunn fordi `{{subdomain}}.kodovault.no` lå som ren tekst
 * og Gmail/Outlook/Apple Mail auto-detekterte URL-mønsteret → default
 * blå farge.
 *
 * Fiks: Alle 24 forekomster wrap'es nå i `<a>` med eksplisitt farge:
 *   - 20 footer-info-mentions (A1/A2/A3/B1/A4 linje 24) → GRAY (#aaaaaa)
 *     med text-decoration:none. Visuell info-styling, fortsatt klikkbar.
 *   - 4 A4 linje 35 "opprett ny vault"-invitasjoner → ORANGE (#f5a623)
 *     med text-decoration:underline. Brand-color, affordance for action.
 *   - 0 forekomster i welcome (steg 1-lenken var allerede orange-styled).
 *
 * Anti-regresjon:
 *   1. Ingen <a><a>...</a></a> nesting (bug fra første implementasjons-
 *      runde — regex matchet placeholder INNE i eksisterende anchors)
 *   2. Alle bare {{subdomain}}.kodovault.no SOM TEKST er wrap'et — Gmail
 *      kan ikke auto-overstyre når det allerede er en <a>-tag.
 */
import fs from "node:fs/promises";
import path from "node:path";

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

async function read(name: string): Promise<string> {
  return fs.readFile(path.join(DIR, `${name}.html`), "utf8");
}

const LANGS = ["no", "sv", "da", "en"] as const;
const FOOTER_INFO_TEMPLATES = [
  "trial-reminder-t5",
  "locked-from-trial",
  "locked-from-cancel",
  "lifecycle-warning",
  "deleted-confirmation",
];

async function runTests() {
  // ─── Test 1: Ingen nestet <a><a>...</a></a> noensteds ──────────────
  console.log("\nLenke-farger — ingen nestede <a><a>-tags noensteds (24 filer)");
  for (const tpl of [...FOOTER_INFO_TEMPLATES, "welcome"]) {
    for (const lang of LANGS) {
      const html = await read(`${tpl}.${lang}`);
      const nested = html.match(/<a[^>]*><a[^>]*>/g) ?? [];
      assert(
        nested.length === 0,
        `${tpl}.${lang}: 0 nestede <a><a> (faktisk: ${nested.length})`,
      );
    }
  }

  // ─── Test 2: Ingen bare {{subdomain}}.kodovault.no som ren tekst ───
  console.log(
    "\nLenke-farger — alle {{subdomain}}.kodovault.no er wrap'et i <a> (forhindrer auto-link)",
  );
  // En "bare" forekomst er en placeholder som IKKE er foran "https://"
  // (href-attributt) OG IKKE etterfulgt av "</a>" (allerede wrap'et tekst-content)
  for (const tpl of [...FOOTER_INFO_TEMPLATES, "welcome"]) {
    for (const lang of LANGS) {
      const html = await read(`${tpl}.${lang}`);
      // Hver match av placeholder skal være enten:
      //   (a) inni href="https://..."  ← preceded by `https://`
      //   (b) inni en allerede åpnet <a>... ← followed by `</a>`
      // Vi sjekker mot anti-pattern: ingen match som er IKKE-attr OG IKKE-anchored
      // Negativ lookbehind + negativ lookahead — om dette matcher noe, FEILER vi.
      const bare = html.match(
        /(?<!https:\/\/)\{\{subdomain\}\}\.kodovault\.no(?!["<])/g,
      );
      assert(
        bare === null,
        `${tpl}.${lang}: ingen bare placeholder som ren tekst (fant: ${bare?.length ?? 0})`,
      );
    }
  }

  // ─── Test 3: Footer-info (5 maltyper × 4 språk) har GRAY anchor ────
  console.log(
    "\nLenke-farger — footer-info i A1/A2/A3/B1/A4 har GRAY (#aaaaaa) anchor",
  );
  for (const tpl of FOOTER_INFO_TEMPLATES) {
    for (const lang of LANGS) {
      const html = await read(`${tpl}.${lang}`);
      // Hver mal skal ha minst ÉN gray anchor (footer-info)
      const grayAnchors = html.match(
        /<a href="https:\/\/\{\{subdomain\}\}\.kodovault\.no" style="color:#aaaaaa;text-decoration:none;">\{\{subdomain\}\}\.kodovault\.no<\/a>/g,
      );
      assert(
        grayAnchors !== null && grayAnchors.length >= 1,
        `${tpl}.${lang}: minst 1 gray anchor (#aaaaaa, no underline) finnes`,
      );
    }
  }

  // ─── Test 4: A4 linje 35 — orange anchor med understrek ────────────
  console.log(
    "\nLenke-farger — A4 'opprett ny vault'-invitasjon har ORANGE+underline",
  );
  for (const lang of LANGS) {
    const html = await read(`deleted-confirmation.${lang}`);
    const orange = html.match(
      /<a href="https:\/\/\{\{subdomain\}\}\.kodovault\.no" style="color:#f5a623;text-decoration:underline;">\{\{subdomain\}\}\.kodovault\.no<\/a>/g,
    );
    assert(
      orange !== null && orange.length === 1,
      `deleted-confirmation.${lang}: nøyaktig 1 orange+underline anchor (faktisk: ${orange?.length ?? 0})`,
    );
  }

  // ─── Test 5: welcome — KUN den eksisterende orange steg-1-lenken ──
  console.log(
    "\nLenke-farger — welcome har 0 gray anchors (steg-1-lenken er bevart orange)",
  );
  for (const lang of LANGS) {
    const html = await read(`welcome.${lang}`);
    const grayAnchors = html.match(
      /style="color:#aaaaaa;text-decoration:none;"[^>]*>\{\{subdomain\}\}\.kodovault\.no/g,
    );
    assert(
      grayAnchors === null,
      `welcome.${lang}: ingen gray anchors (placeholder-lenken var allerede orange)`,
    );
    // Den eksisterende orange steg-1-lenken må fortsatt være intakt:
    const stegEnLink = html.includes(
      'href="https://{{subdomain}}.kodovault.no" style="color:#f5a623;text-decoration:none;">{{subdomain}}.kodovault.no</a>',
    );
    assert(
      stegEnLink,
      `welcome.${lang}: original steg-1 orange anchor er bevart`,
    );
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
