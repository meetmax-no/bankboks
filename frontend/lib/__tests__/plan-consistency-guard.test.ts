/**
 * Ko | Do · Vault — D-130 (2026-02) — plan-konsistens-vakt-test
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/plan-consistency-guard.test.ts`
 *
 * Verifiserer:
 *  - isB2BWithB2CPlan() returnerer korrekt for alle (customerType, parentTenant, plan)-kombo
 *  - warnIfB2BHasB2CPlan() logger via console.warn med stabilt prefix
 *  - warnIfB2BHasB2CPlan() er no-op for gyldige kombo (B2C, B2B-children, B2B-parent med b2b_*-plan)
 */
import {
  isB2BWithB2CPlan,
  warnIfB2BHasB2CPlan,
} from "../platform/plan-consistency-guard";
import type { TenantRecord } from "../platform/tenant-types";

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

function makeRecord(
  overrides: Partial<TenantRecord> & {
    customerType: "b2b" | "b2c";
    parentTenant: string | null;
    plan: TenantRecord["plan"];
  },
): TenantRecord {
  const base: TenantRecord = {
    subdomain: "test",
    customerType: "b2c",
    firstName: null,
    lastName: null,
    email: "test@example.com",
    companyName: null,
    orgNumber: null,
    companyStreet: null,
    companyPostalCode: null,
    companyCity: null,
    companyCountry: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    billingStreet: null,
    billingPostalCode: null,
    billingCity: null,
    billingCountry: null,
    billingEmail: null,
    billingReference: null,
    adminSubdomain: null,
    tenantPrefix: null,
    maxLicenses: null,
    parentTenant: null,
    plan: "trial",
    status: "trial",
    emailPreferences: { transactional: true, lifecycle: true },
    createdAt: "2026-02-01T00:00:00Z",
    trialEndsAt: "2026-03-01T00:00:00Z",
    lockedAt: null,
    cancelledAt: null,
    deletedAt: null,
    suspendedAt: null,
    pendingExpiresAt: null,
    cancelAtPeriodEnd: false,
    cancelEffectiveAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeInvoiceId: null,
    nextBillingDate: null,
    parentLockedAt: null,
    configGenerated: false,
    vercelProjectId: null,
    upstashDatabaseId: null,
    vaultLive: false,
    vaultLiveAt: null,
    welcomeEmailSentAt: null,
    lifecycleWarningsSentAt: { t7: null, t3: null, t1: null },
    trialReminderT5SentAt: null,
    lockedNotificationSentAt: null,
    deletedNotificationSentAt: null,
    createdBy: "admin",
    locale: null,
    notes: null,
    provisioningLog: [],
  };
  return { ...base, ...overrides };
}

console.log("\n[1] isB2BWithB2CPlan — den uønskede tilstanden");
{
  const r1 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "trial" });
  assert(isB2BWithB2CPlan(r1), "B2B parent + plan=trial → true");

  const r2 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "monthly" });
  assert(isB2BWithB2CPlan(r2), "B2B parent + plan=monthly → true");

  const r3 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "yearly" });
  assert(isB2BWithB2CPlan(r3), "B2B parent + plan=yearly → true");
}

console.log("\n[2] isB2BWithB2CPlan — gyldige tilstander");
{
  const ok1 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "b2b_yearly" });
  assert(!isB2BWithB2CPlan(ok1), "B2B parent + plan=b2b_yearly → false (gyldig)");

  const ok2 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "b2b_semiannual" });
  assert(!isB2BWithB2CPlan(ok2), "B2B parent + plan=b2b_semiannual → false (gyldig)");

  const ok3 = makeRecord({ customerType: "b2b", parentTenant: null, plan: "free" });
  assert(!isB2BWithB2CPlan(ok3), "B2B parent + plan=free → false (gyldig — free er evig)");

  const ok4 = makeRecord({ customerType: "b2c", parentTenant: null, plan: "monthly" });
  assert(!isB2BWithB2CPlan(ok4), "B2C + plan=monthly → false (gyldig)");

  const ok5 = makeRecord({ customerType: "b2b", parentTenant: "mm", plan: "trial" });
  assert(
    !isB2BWithB2CPlan(ok5),
    "B2B child (parentTenant satt) + plan=trial → false (children følger parent)",
  );
}

console.log("\n[3] warnIfB2BHasB2CPlan — logger via console.warn");
{
  const originalWarn = console.warn;
  const logs: string[] = [];
  console.warn = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    const bad = makeRecord({
      customerType: "b2b",
      parentTenant: null,
      plan: "monthly",
      subdomain: "lisbeth-admin",
    });
    warnIfB2BHasB2CPlan(bad, "admin_patch");
    assert(logs.length === 1, "én log-linje skrevet");
    assert(
      logs[0].includes("[plan-consistency-guard]"),
      "log inneholder stabilt prefix '[plan-consistency-guard]'",
    );
    assert(logs[0].includes("admin_patch"), "log inneholder kontekst 'admin_patch'");
    assert(
      logs[0].includes("lisbeth-admin"),
      "log inneholder subdomain 'lisbeth-admin'",
    );
    assert(logs[0].includes("plan='monthly'"), "log inneholder plan-verdi");
    assert(
      logs[0].includes("customerType=b2b"),
      "log inneholder customerType=b2b",
    );

    logs.length = 0;
    const good = makeRecord({ customerType: "b2b", parentTenant: null, plan: "b2b_yearly" });
    warnIfB2BHasB2CPlan(good, "admin_patch");
    assert(logs.length === 0, "ingen log for gyldig B2B-tenant");

    logs.length = 0;
    const b2c = makeRecord({ customerType: "b2c", parentTenant: null, plan: "yearly" });
    warnIfB2BHasB2CPlan(b2c, "admin_patch");
    assert(logs.length === 0, "ingen log for B2C-tenant");
  } finally {
    console.warn = originalWarn;
  }
}

console.log("\n");
console.log(`Resultat: ${passed} passert, ${failed} feilet`);
if (failed > 0) {
  console.log("Feilet:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
