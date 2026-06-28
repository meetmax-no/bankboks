/**
 * Ko | Do · Vault — D-088 (2026-06-27, Mike) — am-admin-pod-rydding guards
 *
 * Verifiserer at provision-vercel og provision-upstash short-circuiter for
 * B2B parent-tenants (`<prefix>-admin`) i stedet for å opprette egne Vercel-
 * prosjekter / Upstash-DB-er.
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/d088-am-admin-pod-skip.test.ts`
 */
import { randomBytes } from "node:crypto";

process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// Vi tester guarden som ren JS-logikk (pattern + customerType-sjekk),
// uavhengig av Next.js-runtime. Dette holder testen rask og fri for
// kompliserte mock-stubs.

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log("OK:", msg);
    passed++;
  } else {
    console.error("FAIL:", msg);
    failed++;
  }
}

// ─── Ren guard-logikk (kopiert fra route-handler) ──────────────────────
type TenantLike = {
  subdomain: string;
  customerType: "b2b" | "b2c";
  parentTenant: string | null;
};

function shouldSkipProvisioning(tenant: TenantLike): boolean {
  return (
    tenant.customerType === "b2b" &&
    tenant.parentTenant === null &&
    tenant.subdomain.endsWith("-admin")
  );
}

// ─── Cleanup-script regex-test ─────────────────────────────────────────
const ADMIN_POD_REGEX = /^kodo-kv-([a-z][a-z0-9-]{0,30}[a-z0-9])-admin$/;
const PROTECTED = new Set(["kodo-kv", "kodo-kv-admin", "kodo-kv-www"]);

function safeMatchesAdminPod(name: string): { match: boolean; prefix: string | null } {
  if (PROTECTED.has(name)) return { match: false, prefix: null };
  const m = ADMIN_POD_REGEX.exec(name);
  if (!m) return { match: false, prefix: null };
  if (m[1] === "admin") return { match: false, prefix: null };
  return { match: true, prefix: m[1] };
}

async function main(): Promise<void> {
  // ── 1. B2B parent (`mm-admin`) skal SKIPPES ──────────────────────
  assert(
    shouldSkipProvisioning({
      subdomain: "mm-admin",
      customerType: "b2b",
      parentTenant: null,
    }),
    "B2B parent 'mm-admin' identifiseres som skip-kandidat",
  );

  // ── 2. B2B child (`mm-kari`) skal IKKE skippes ────────────────────
  assert(
    !shouldSkipProvisioning({
      subdomain: "mm-kari",
      customerType: "b2b",
      parentTenant: "mm-admin",
    }),
    "B2B child 'mm-kari' (ansatt vault) skal provisioneres normalt",
  );

  // ── 3. B2C tenant skal IKKE skippes ───────────────────────────────
  assert(
    !shouldSkipProvisioning({
      subdomain: "ola",
      customerType: "b2c",
      parentTenant: null,
    }),
    "B2C tenant skal provisioneres normalt",
  );

  // ── 4. B2C tenant som tilfeldigvis ender på "-admin" — IKKE skip ──
  // Vi krever BÅDE customerType=b2b OG parentTenant=null OG -admin-suffiks.
  assert(
    !shouldSkipProvisioning({
      subdomain: "secret-admin",
      customerType: "b2c",
      parentTenant: null,
    }),
    "B2C tenant som ender på -admin skal IKKE skippes (rare edge case)",
  );

  // ── 5. Mike's super-admin (`admin`) — ikke b2b parent ─────────────
  assert(
    !shouldSkipProvisioning({
      subdomain: "admin",
      customerType: "b2c",
      parentTenant: null,
    }),
    "Mike's super-admin 'admin' (b2c) skal IKKE matches",
  );

  // ─── Cleanup-script regex ───────────────────────────────────────
  // ── 6. Match: kodo-kv-mm-admin ─────────────────────────────────
  assert(
    safeMatchesAdminPod("kodo-kv-mm-admin").match === true,
    "Cleanup-regex matcher kodo-kv-mm-admin",
  );

  // ── 7. Prefix extracted correctly ──────────────────────────────
  assert(
    safeMatchesAdminPod("kodo-kv-mm-admin").prefix === "mm",
    "Cleanup-regex henter ut prefix='mm'",
  );

  // ── 8. Match: kodo-kv-acme-corp-admin (lang prefix med bindestrek)
  assert(
    safeMatchesAdminPod("kodo-kv-acme-corp-admin").match === true,
    "Cleanup-regex aksepterer prefiks med bindestrek (acme-corp)",
  );

  // ── 9. PROTECTED — kodo-kv-admin (Mike's super-admin) skal IKKE match
  assert(
    safeMatchesAdminPod("kodo-kv-admin").match === false,
    "PROTECTED: kodo-kv-admin matches IKKE (super-admin beskyttet)",
  );

  // ── 10. PROTECTED — kodo-kv (root) skal IKKE match ──────────────
  assert(
    safeMatchesAdminPod("kodo-kv").match === false,
    "PROTECTED: kodo-kv (root) matches IKKE",
  );

  // ── 11. PROTECTED — kodo-kv-www skal IKKE match ────────────────
  assert(
    safeMatchesAdminPod("kodo-kv-www").match === false,
    "PROTECTED: kodo-kv-www matches IKKE",
  );

  // ── 12. IKKE match — employee vault (mm-kari) ──────────────────
  assert(
    safeMatchesAdminPod("kodo-kv-mm-kari").match === false,
    "Employee vault kodo-kv-mm-kari matches IKKE (mangler -admin-suffiks)",
  );

  // ── 13. IKKE match — random project (ikke kodo-kv-prefix) ──────
  assert(
    safeMatchesAdminPod("some-other-project").match === false,
    "Random Vercel-prosjekt (uten kodo-kv-prefiks) matches IKKE",
  );

  // ── 14. Edge: kodo-kv-A-admin (start med stor bokstav, regex case-sensitive)
  assert(
    safeMatchesAdminPod("kodo-kv-A-admin").match === false,
    "Case-sensitive — store bokstaver i prefix matches IKKE",
  );

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
