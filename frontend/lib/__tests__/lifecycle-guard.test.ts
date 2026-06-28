/**
 * Ko | Do · Vault — v4.3 D-069 (2026-06-04) — Lifecycle Guard tester
 */
import {
  canAutoCancel,
  canAutoDelete,
  canAutoLock,
  isAutoDeletable,
  isAutoLockable,
} from "../platform/lifecycle-guard";
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

function makeTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    subdomain: "test",
    customerType: "b2c",
    email: "x@y.no",
    contactEmail: null,
    contactName: null,
    contactPhone: null,
    firstName: null,
    lastName: null,
    companyName: null,
    orgNumber: null,
    vatNumber: null,
    companyStreet: null,
    companyPostalCode: null,
    companyCity: null,
    companyCountry: null,
    billingStreet: null,
    billingPostalCode: null,
    billingCity: null,
    billingCountry: null,
    billingEmail: null,
    billingReference: null,
    adminSubdomain: null,
    plan: "trial",
    status: "trial",
    emailPreferences: {
      transactional: true,
      lifecycle: true,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    trialEndsAt: "2026-02-01T00:00:00.000Z",
    lockedAt: null,
    cancelledAt: null,
    deletedAt: null,
    suspendedAt: null,
    pendingExpiresAt: null,
    cancelAtPeriodEnd: false,
    cancelEffectiveAt: null,
    parentTenant: null,
    lifecycleWarningsSentAt: { t7: null, t3: null, t1: null },
    trialReminderT5SentAt: null,
    lockedNotificationSentAt: null,
    deletedNotificationSentAt: null,
    tenantPrefix: null,
    activeLicenses: 0,
    maxLicenses: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeInvoiceId: null,
    configGenerated: false,
    vercelProjectId: null,
    upstashDatabaseId: null,
    vaultLive: false,
    vaultLiveAt: null,
    createdBy: "self",
    locale: "no",
    notes: null,
    provisioningLog: [],
    welcomeEmailSentAt: null,
    nextBillingDate: null,
    parentLockedAt: null,
    ...overrides,
  };
}

async function runTests() {
  console.log("\ncanAutoLock — free-plan beskyttet");
  const free = makeTenant({ plan: "free" });
  assert(canAutoLock(free).allowed === false, "free → ikke lockable");
  assert(
    (canAutoLock(free).reason ?? "").includes("D-069"),
    "reason refererer D-069",
  );

  console.log("\ncanAutoLock — andre planer kan låses");
  for (const plan of ["trial", "monthly", "yearly"] as const) {
    assert(
      canAutoLock(makeTenant({ plan })).allowed === true,
      `${plan} → lockable`,
    );
  }

  console.log("\ncanAutoCancel — free-plan beskyttet");
  assert(
    canAutoCancel(makeTenant({ plan: "free" })).allowed === false,
    "free → ikke cancellable",
  );
  assert(
    canAutoCancel(makeTenant({ plan: "monthly" })).allowed === true,
    "monthly → cancellable",
  );

  console.log("\ncanAutoDelete — free OG admin-opprettede beskyttet");
  assert(
    canAutoDelete(makeTenant({ plan: "free" })).allowed === false,
    "free → ikke deletable",
  );
  assert(
    canAutoDelete(makeTenant({ plan: "trial", createdBy: "admin" })).allowed ===
      false,
    "trial + createdBy=admin → ikke deletable",
  );
  assert(
    canAutoDelete(makeTenant({ plan: "monthly", createdBy: "self" })).allowed ===
      true,
    "monthly + createdBy=self → deletable",
  );

  console.log("\nPredicates — filter-bruk");
  const tenants = [
    makeTenant({ subdomain: "a", plan: "free" }),
    makeTenant({ subdomain: "b", plan: "trial" }),
    makeTenant({ subdomain: "c", plan: "monthly" }),
    makeTenant({ subdomain: "d", plan: "trial", createdBy: "admin" }),
  ];
  const lockable = tenants.filter(isAutoLockable);
  assert(
    lockable.length === 3 && lockable.every((t) => t.plan !== "free"),
    "isAutoLockable filtrerer ut free",
  );
  const deletable = tenants.filter(isAutoDeletable);
  assert(
    deletable.length === 2 &&
      deletable.some((t) => t.subdomain === "b") &&
      deletable.some((t) => t.subdomain === "c"),
    "isAutoDeletable filtrerer ut free + admin-opprettet",
  );

  console.log("\n─────────────────────────────────────────");
  console.log(`${passed} bestått · ${failed} feilet`);
  if (failed > 0) {
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Alle D-069-tester bestått.");
}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
