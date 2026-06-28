/**
 * Ko | Do · Vault — v4.3 Iter 8 — Unit-tester for github-config + provision-retry
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter8.test.ts`
 *
 * Tester pure helpers — buildTenantConfig (mutering av _meta),
 * isRetryableStatus (HTTP-statuskode-classification), vercelProjectName.
 * Ekte fetch mot Vercel/GitHub testes via curl mot deploy.
 */
import { buildTenantConfig } from "../platform/tenant-config-builder";
import { isRetryableStatus } from "../platform/provision-retry";
import { vercelProjectName } from "../platform/vercel-provision";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

// ─── buildTenantConfig ──────────────────────────────────────────────────
console.log("\nbuildTenantConfig — mutering av _meta");
const template = {
  _meta: {
    client: "Michael Aagreen",
    createdAt: "2026-04-29",
    createdBy: "Ko | Do",
    notes: "Personlig vault",
  },
  defaultLocale: "no",
  brand: { name: "Ko | Do · Vault" },
  categories: [{ key: "bank", label: "Bank" }],
};
const fixedDate = new Date("2026-06-02T12:00:00Z");
const out = buildTenantConfig(template, "terje", fixedDate);

assert(
  (out._meta as Record<string, unknown>).client === "terje",
  "_meta.client settes til subdomain",
);
assert(
  (out._meta as Record<string, unknown>).createdAt === "2026-06-02T12:00:00.000Z",
  "_meta.createdAt settes til ISO 8601",
);
assert(
  (out._meta as Record<string, unknown>).createdBy === "Ko | Do · Vault provisioning (D-060)",
  "_meta.createdBy overskrives av provisjoneringen",
);
assert(
  (out._meta as Record<string, unknown>).notes === "Personlig vault",
  "_meta.notes bevares fra template",
);
assert(out.defaultLocale === "no", "defaultLocale bevares");
assert(
  JSON.stringify(out.brand) === JSON.stringify({ name: "Ko | Do · Vault" }),
  "brand-objekt bevares",
);
assert(
  Array.isArray(out.categories) && (out.categories as unknown[]).length === 1,
  "categories-array bevares",
);

console.log("\nbuildTenantConfig — uten eksisterende _meta");
const out2 = buildTenantConfig({ defaultLocale: "en" }, "lisbeth");
assert(
  (out2._meta as Record<string, unknown>).client === "lisbeth",
  "manglende template-_meta gir nytt _meta-objekt",
);
assert(out2.defaultLocale === "en", "andre felter bevares");

console.log("\nbuildTenantConfig — null/undefined _meta");
const out3 = buildTenantConfig(
  { _meta: null as unknown as Record<string, unknown>, brand: "x" },
  "kim",
);
assert(
  (out3._meta as Record<string, unknown>).client === "kim",
  "null _meta håndteres trygt",
);

// ─── isRetryableStatus ──────────────────────────────────────────────────
console.log("\nisRetryableStatus — retry-bare koder");
assert(isRetryableStatus(408), "408 timeout → retry");
assert(isRetryableStatus(429), "429 rate-limit → retry");
assert(isRetryableStatus(500), "500 → retry");
assert(isRetryableStatus(502), "502 → retry");
assert(isRetryableStatus(503), "503 → retry");
assert(isRetryableStatus(504), "504 → retry");
assert(isRetryableStatus(599), "599 → retry");

console.log("\nisRetryableStatus — IKKE retry-bare koder");
assert(!isRetryableStatus(200), "200 → ingen retry");
assert(!isRetryableStatus(201), "201 → ingen retry");
assert(!isRetryableStatus(400), "400 → ingen retry (klient-feil)");
assert(!isRetryableStatus(401), "401 → ingen retry (auth)");
assert(!isRetryableStatus(403), "403 → ingen retry");
assert(!isRetryableStatus(404), "404 → ingen retry");
assert(!isRetryableStatus(409), "409 conflict → ingen retry");
assert(!isRetryableStatus(422), "422 → ingen retry");
assert(!isRetryableStatus(600), "600 (utenfor 5xx) → ingen retry");

// ─── vercelProjectName ──────────────────────────────────────────────────
console.log("\nvercelProjectName");
assert(vercelProjectName("terje") === "kodo-kv-terje", "kodo-kv-prefix legges til");
assert(vercelProjectName("AM-NILS") === "kodo-kv-am-nils", "lowercase + bindestrek bevares");
assert(vercelProjectName("  terje  ") === "kodo-kv-terje", "whitespace trimmes");

// ─── Resultat ───────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
