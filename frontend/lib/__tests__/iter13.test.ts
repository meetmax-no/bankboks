/**
 * Ko | Do · Vault — v4.3 Iter 13 — Tester for Stripe webhook event-handlers
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter13.test.ts`
 *
 * Tester:
 *   - findSubdomainFromEvent (lookup-kjede: direct → invoice → lines → customer-fallback)
 *   - priceIdToPlan
 *   - handleInvoicePaymentFailed → D-069 canAutoLock-guard (free-plan blokkert)
 *   - handleSubscriptionDeleted → D-069 canAutoCancel-guard (free-plan blokkert)
 *
 * Vi mocker @upstash/redis via Module-require-override (samme mønster som
 * delete-tenant.test.ts). Vi mocker IKKE Stripe SDK — vi tester kun
 * handler-logikk som ikke kaller Stripe API.
 */
import { Module } from "node:module";

const originalRequire = Module.prototype.require;

// ─── Mock @upstash/redis ──────────────────────────────────────────────
const mockStore = new Map<string, unknown>();
const mockSet = new Set<string>();
const fakeRedis = {
  async get<T>(k: string) {
    return (mockStore.get(k) ?? null) as T | null;
  },
  async set(k: string, v: unknown) {
    mockStore.set(k, v);
    return "OK";
  },
  async del(k: string) {
    return mockStore.delete(k) ? 1 : 0;
  },
  async exists(k: string) {
    return mockStore.has(k) ? 1 : 0;
  },
  async sadd(_k: string, ...v: string[]) {
    let added = 0;
    for (const item of v) {
      if (!mockSet.has(item)) {
        mockSet.add(item);
        added += 1;
      }
    }
    return added;
  },
  async srem(_k: string, ...v: string[]) {
    let removed = 0;
    for (const item of v) {
      if (mockSet.delete(item)) removed += 1;
    }
    return removed;
  },
  async smembers(_k: string) {
    return Array.from(mockSet);
  },
};

(Module.prototype as unknown as { require: typeof originalRequire }).require =
  function (this: NodeJS.Module, id: string) {
    if (id === "@upstash/redis") {
      return { Redis: function () { return fakeRedis; } };
    }
    return originalRequire.call(this, id);
  } as typeof originalRequire;

// Env-vars
process.env.CENTRAL_KV_REST_API_URL = "https://mock.upstash.io";
process.env.CENTRAL_KV_REST_API_TOKEN = "mock-token";
process.env.CENTRAL_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";
process.env.STRIPE_SECRET_KEY = "sk_test_mock";
process.env.STRIPE_PRICE_MONTHLY = "price_MONTHLY_TEST";
process.env.STRIPE_PRICE_YEARLY = "price_YEARLY_TEST";

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

async function runTests() {
  const {
    handleInvoicePaymentFailed,
    handleSubscriptionDeleted,
    handleInvoicePaid,
    handleSubscriptionUpdated,
  } = await import("../stripe/event-handlers");
  const { putTenant, getTenant, createTenant } = await import(
    "../platform/tenant-store"
  );

  // Hjelpefunksjon: opprett en test-tenant direkte i mock-Upstash
  async function seedTenant(overrides: {
    subdomain: string;
    plan?: "trial" | "monthly" | "yearly" | "free";
    status?:
      | "active"
      | "trial"
      | "locked"
      | "cancelled"
      | "deleted"
      | "pending"
      | "provisioning_failed"
      | "invoice_failed";
    lockedAt?: string;
  }) {
    const record = await createTenant(
      {
        subdomain: overrides.subdomain,
        email: `${overrides.subdomain}@example.com`,
        customerType: "b2c",
        plan: overrides.plan ?? "monthly",
        status: overrides.status ?? "active",
      },
      "self",
    );
    if (overrides.lockedAt) {
      await putTenant({ ...record, lockedAt: overrides.lockedAt });
    }
    return record;
  }

  // ─── Test 1: D-069 canAutoLock blokkerer payment_failed for free ────
  console.log("\nhandleInvoicePaymentFailed — D-069 free-plan blokk");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({ subdomain: "free-tenant", plan: "free", status: "active" });
  const r1 = await handleInvoicePaymentFailed({
    id: "evt_test_1",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_test_1",
        metadata: { subdomain: "free-tenant" },
        customer: "cus_test",
        lines: { data: [] },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r1.ok === true, "returnerer ok=true (D-069 er silent skip, ikke feil)");
  assert(
    r1.detail?.includes("D-069 blokkert") === true,
    "detail nevner D-069-blokk",
  );
  const t1 = await getTenant("free-tenant");
  assert(t1?.status === "active", "free-tenant status forblir 'active'");
  assert(t1?.lockedAt === null, "lockedAt forblir null");

  // ─── Test 2: payment_failed låser betalt tenant ─────────────────────
  console.log("\nhandleInvoicePaymentFailed — monthly tenant låses");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({
    subdomain: "monthly-tenant",
    plan: "monthly",
    status: "active",
  });
  const r2 = await handleInvoicePaymentFailed({
    id: "evt_test_2",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_test_2",
        metadata: { subdomain: "monthly-tenant" },
        customer: "cus_test_2",
        lines: { data: [] },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r2.ok === true, "returnerer ok=true");
  assert(r2.detail === "locked", "detail = 'locked'");
  const t2 = await getTenant("monthly-tenant");
  assert(t2?.status === "locked", "status flippet til 'locked'");
  assert(t2?.lockedAt !== null, "lockedAt er satt");

  // ─── Test 3: D-069 canAutoCancel blokkerer for free ─────────────────
  console.log("\nhandleSubscriptionDeleted — D-069 free-plan blokk");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({
    subdomain: "free-cancel",
    plan: "free",
    status: "active",
  });
  const r3 = await handleSubscriptionDeleted({
    id: "evt_test_3",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_3",
        metadata: { subdomain: "free-cancel" },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r3.ok === true, "returnerer ok=true (silent skip)");
  assert(
    r3.detail?.includes("D-069 blokkert") === true,
    "detail nevner D-069-blokk",
  );
  const t3 = await getTenant("free-cancel");
  assert(t3?.status === "active", "free-cancel status forblir 'active'");
  assert(t3?.cancelledAt === null, "cancelledAt forblir null");

  // ─── Test 4: subscription.deleted låser betalt tenant (Iter 17 spor B) ─
  // Iter 17-revisjon: handleSubscriptionDeleted setter nå status="locked"
  // (med cancelledAt=now) i stedet for status="cancelled". Dette aktiverer
  // 28-dagers grace-perioden før hard delete (sammen med B1-mailen
  // "Abonnementet er kansellert — kontoen er låst").
  console.log("\nhandleSubscriptionDeleted — monthly tenant låses (Iter 17 spor B)");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({
    subdomain: "monthly-cancel",
    plan: "monthly",
    status: "active",
  });
  const r4 = await handleSubscriptionDeleted({
    id: "evt_test_4",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_4",
        metadata: { subdomain: "monthly-cancel" },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(
    r4.ok === true && (r4.detail?.includes("locked") ?? false),
    `detail inneholder 'locked' (faktisk: '${r4.detail}')`,
  );
  const t4 = await getTenant("monthly-cancel");
  assert(t4?.status === "locked", `status flippet til 'locked' (faktisk: '${t4?.status}')`);
  assert(t4?.cancelledAt !== null, "cancelledAt er satt");

  // ─── Test 5: invoice.paid flytter locked → active ───────────────────
  console.log("\nhandleInvoicePaid — locked tenant flippes til active");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({
    subdomain: "recovered",
    plan: "monthly",
    status: "locked",
    lockedAt: new Date().toISOString(),
  });
  const r5 = await handleInvoicePaid({
    id: "evt_test_5",
    type: "invoice.paid",
    data: {
      object: {
        id: "in_test_5",
        metadata: { subdomain: "recovered" },
        customer: "cus_test_5",
        lines: { data: [] },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r5.ok === true && r5.detail === "paid", "detail = 'paid'");
  const t5 = await getTenant("recovered");
  assert(t5?.status === "active", "status flippet locked → active");
  assert(t5?.lockedAt === null, "lockedAt nullstilt");
  assert(t5?.stripeInvoiceId === "in_test_5", "stripeInvoiceId lagret");

  // ─── Test 6: subscription.updated synkroniserer plan-bytte ──────────
  console.log("\nhandleSubscriptionUpdated — plan-bytte monthly → yearly");
  mockStore.clear();
  mockSet.clear();
  await seedTenant({
    subdomain: "plan-bytte",
    plan: "monthly",
    status: "active",
  });
  const r6 = await handleSubscriptionUpdated({
    id: "evt_test_6",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_test_6",
        metadata: { subdomain: "plan-bytte" },
        items: {
          data: [{ price: { id: "price_YEARLY_TEST" } }],
        },
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r6.ok === true, "subscription.updated returnerer ok=true");
  const t6 = await getTenant("plan-bytte");
  assert(t6?.plan === "yearly", "plan oppdatert monthly → yearly");

  // ─── Test 7: subdomain mangler i metadata → ok=false ────────────────
  console.log("\nhandleSubscriptionDeleted — subdomain mangler");
  const r7 = await handleSubscriptionDeleted({
    id: "evt_test_7",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_test_7",
        metadata: {},
        // ingen customer-felt heller, så fallback-lookup vil ikke trigge
      },
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  assert(r7.ok === false, "ok=false når subdomain mangler");
  assert(
    r7.detail?.includes("subdomain mangler") === true,
    "detail nevner manglende subdomain",
  );

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────");
  console.log(`${passed} bestått · ${failed} feilet`);
  if (failed > 0) {
    console.log("\nFeilede tester:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Alle iter13-tester bestått.");
}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
