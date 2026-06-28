/**
 * Ko | Do · Vault — v4.3 Iter 10 (D-068) — Tester for notify-email mal-rendering
 *
 * Tester at:
 *   - {{firstName}} og {{subdomain}} byttes ut korrekt
 *   - Locale-valg: en → engelsk, no/sv/da → norsk
 *   - Fallback firstName ("deg" / "there")
 *
 * Bruker fs.readFile direkte (samme som notify-email.ts).
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

async function loadAndRender(
  locale: "no" | "en",
  vars: Record<string, string>,
): Promise<string> {
  const file = path.join(
    process.cwd(),
    "lib",
    "platform",
    "email-templates",
    locale === "en" ? "welcome.en.html" : "welcome.no.html",
  );
  let html = await fs.readFile(file, "utf8");
  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }
  return html;
}

async function runTests() {
  console.log("\nwelcome.no.html — variable-erstatning");
  const no = await loadAndRender("no", {
    firstName: "Terje",
    subdomain: "terje",
  });
  assert(no.includes("Hei Terje"), "{{firstName}} erstattet (Hei Terje)");
  assert(
    no.includes("terje.kodovault.no"),
    "{{subdomain}} erstattet i lenker",
  );
  assert(!no.includes("{{"), "ingen gjenstående mustache-variabler");
  assert(
    no.includes("Din Ko | Do · Vault er klar"),
    "norsk subject-tekst i title",
  );

  console.log("\nwelcome.en.html — variable-erstatning");
  const en = await loadAndRender("en", {
    firstName: "Alice",
    subdomain: "acme",
  });
  assert(en.includes("Hi Alice"), "{{firstName}} erstattet (Hi Alice)");
  assert(en.includes("acme.kodovault.no"), "{{subdomain}} erstattet");
  assert(!en.includes("{{"), "ingen gjenstående mustache-variabler");
  assert(
    en.includes("Your Ko | Do · Vault is ready"),
    "engelsk subject-tekst i title",
  );

  console.log("\nFallback firstName");
  const noFallback = await loadAndRender("no", {
    firstName: "deg",
    subdomain: "x",
  });
  assert(noFallback.includes("Hei deg,"), "norsk fallback 'deg'");
  const enFallback = await loadAndRender("en", {
    firstName: "there",
    subdomain: "x",
  });
  assert(enFallback.includes("Hi there,"), "engelsk fallback 'there'");

  console.log("\n─────────────────────────────────────────");
  console.log(`${passed} bestått · ${failed} feilet`);
  if (failed > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Alle iter10-tester bestått.");
}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
