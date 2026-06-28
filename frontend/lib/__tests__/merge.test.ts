/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Unit-tester for mergeTenantWithDefault (D-060)
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/merge.test.ts`
 */
import { mergeTenantWithDefault } from "../platform/tenant-config-builder";

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

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Primitiver: tenant-wins ─────────────────────────────────────────
console.log("\nPrimitiv-merge");
const r1 = mergeTenantWithDefault(
  { clipboardSec: 30, autoLockMin: 5 },
  { clipboardSec: 60, autoLockMin: 10, newFeature: true },
);
assert(r1.clipboardSec === 30, "tenant beholder clipboardSec=30");
assert(r1.autoLockMin === 5, "tenant beholder autoLockMin=5");
assert(r1.newFeature === true, "ny default 'newFeature' lagt til");

console.log("\nManglende felter i tenant fylles fra default");
const r2 = mergeTenantWithDefault({}, { a: 1, b: "x" });
assert(r2.a === 1 && r2.b === "x", "alle defaults lagt til");

console.log("\nManglende i default beholder tenants felt");
const r3 = mergeTenantWithDefault({ customField: "mike" }, {});
assert(r3.customField === "mike", "tenants custom-felt beholdes");

// ─── Nested objekter: rekursiv merge ─────────────────────────────────
console.log("\nNested objekter — deep merge, tenant-wins");
const r4 = mergeTenantWithDefault(
  { brand: { name: "Mike Custom" } },
  { brand: { name: "Ko | Do", logo: "v2.png" } },
);
const brand = r4.brand as Record<string, unknown>;
assert(brand.name === "Mike Custom", "brand.name tenant-wins");
assert(brand.logo === "v2.png", "brand.logo lagt til fra default");

console.log("\nDypt nested — 3 nivåer");
const r5 = mergeTenantWithDefault(
  { theme: { dark: { bg: "#000" } } },
  { theme: { dark: { bg: "#111", fg: "#fff" }, light: { bg: "#fff" } } },
);
const theme = r5.theme as Record<string, unknown>;
const dark = theme.dark as Record<string, unknown>;
assert(dark.bg === "#000", "tenant nested-verdi vinner");
assert(dark.fg === "#fff", "ny nested-felt fra default");
assert((theme.light as Record<string, unknown>).bg === "#fff", "ny nested-objekt fra default");

// ─── Arrays av {key, ...}: union-på-key ──────────────────────────────
console.log("\nArrays av keyed objekter — union-på-key");
const r6 = mergeTenantWithDefault(
  { categories: [{ key: "bank", label: "Bank Custom" }] },
  {
    categories: [
      { key: "bank", label: "Bank" },
      { key: "insurance", label: "Insurance" },
    ],
  },
);
const cats = r6.categories as Record<string, unknown>[];
assert(cats.length === 2, "union gir 2 elementer");
assert(
  cats.find((c) => c.key === "bank")?.label === "Bank Custom",
  "tenant-wins for kolliderende key",
);
assert(
  cats.find((c) => c.key === "insurance")?.label === "Insurance",
  "ny key fra default lagt til",
);

// ─── Primitive arrays: tenant-wins helt ──────────────────────────────
console.log("\nPrimitive arrays — tenant-wins");
const r7 = mergeTenantWithDefault(
  { tags: ["x", "y"] },
  { tags: ["a", "b", "c"] },
);
assert(jsonEq(r7.tags, ["x", "y"]), "tenant primitiv-array bevart helt");

// ─── Mixed arrays (ikke alle har key) → tenant-wins ──────────────────
console.log("\nMixed arrays — tenant-wins");
const r8 = mergeTenantWithDefault(
  { items: [{ id: 1 }, "string"] },
  { items: [{ key: "a" }, { key: "b" }] },
);
assert(jsonEq(r8.items, [{ id: 1 }, "string"]), "mixed array tenant-wins");

// ─── _meta — også deep merge ─────────────────────────────────────────
console.log("\n_meta — bevares av tenant");
const r9 = mergeTenantWithDefault(
  {
    _meta: {
      client: "testkonto22",
      createdAt: "2026-06-02",
      createdBy: "Ko | Do",
    },
  },
  { _meta: { client: "default", version: "2.0" } },
);
const meta = r9._meta as Record<string, unknown>;
assert(meta.client === "testkonto22", "_meta.client bevart");
assert(meta.createdAt === "2026-06-02", "_meta.createdAt bevart");
assert(meta.version === "2.0", "_meta.version lagt til fra default");

// ─── Type-mismatch: tenant-wins ──────────────────────────────────────
console.log("\nType-mismatch — tenant-wins");
const r10 = mergeTenantWithDefault(
  { value: "string-now" },
  { value: 42 },
);
assert(r10.value === "string-now", "tenant-type vinner ved mismatch");

// ─── Tom default ─────────────────────────────────────────────────────
console.log("\nTom default");
const r11 = mergeTenantWithDefault({ a: 1 }, {});
assert(jsonEq(r11, { a: 1 }), "tom default beholder tenant intakt");

// ─── Tom tenant ──────────────────────────────────────────────────────
console.log("\nTom tenant");
const r12 = mergeTenantWithDefault({}, { a: 1, b: { c: 2 } });
assert(jsonEq(r12, { a: 1, b: { c: 2 } }), "tom tenant = default");

// ─── Resultat ───────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
