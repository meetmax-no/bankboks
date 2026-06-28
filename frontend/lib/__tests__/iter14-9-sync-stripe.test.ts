/**
 * Ko | Do · Vault — v4.3 Iter 14.9 — Tester for POST /api/admin/tenants/[subdomain]/sync-stripe
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter14-9-sync-stripe.test.ts`
 *
 * Tester to-trinns flow (Mike-krav):
 *   1. dryRun=1 + endringer → returnerer { proposed, reasons }, INGEN skriving til Upstash
 *   2. dryRun=false + endringer → SKRIVER til Upstash, returnerer { after }
 *   3. Ingen endringer → proposed=null uansett dryRun, ingen skriving
 *   4. Ingen stripeCustomerId → 409
 *   5. Tenant finnes ikke → 404
 *
 * Mocker @upstash/redis OG stripe-SDK (subscriptions.list).
 */
import { Module } from "node:module";

const originalRequire = Module.prototype.require;

// ─── Mock @upstash/redis ──────────────────────────────────────────────
const mockStore = new Map<string, unknown>();
const mockSet = new Set<string>();
let writeCount = 0;

const fakeRedis = {
  async get<T>(k: string) {
    return (mockStore.get(k) ?? null) as T | null;
  },
  async set(k: string, v: unknown) {
    writeCount += 1;
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

// ─── Mock Stripe SDK ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSubscriptions: any[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeStripeCtor: any = function () {
  return {
    subscriptions: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async list(_args: unknown) {
        return { data: mockSubscriptions };
      },
    },
  };
};

(Module.prototype as unknown as { require: typeof originalRequire }).require =
  function (this: NodeJS.Module, id: string) {
    if (id === "@upstash/redis") {
      return { Redis: function () { return fakeRedis; } };
    }
    if (id === "stripe") {
      return { __esModule: true, default: fakeStripeCtor };
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

function makeReq(subdomain: string, opts: { dryRun?: boolean; query?: boolean } = {}) {
  const url = opts.query && opts.dryRun
    ? `http://test/api/admin/tenants/${subdomain}/sync-stripe?dryRun=1`
    : `http://test/api/admin/tenants/${subdomain}/sync-stripe`;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: opts.dryRun && !opts.query ? JSON.stringify({ dryRun: true }) : undefined,
  });
}

async function runTests() {
  const { POST } = await import(
    "../../app/api/admin/tenants/[subdomain]/sync-stripe/route"
  );
  const { putTenant, getTenant, createTenant } = await import(
    "../platform/tenant-store"
  );

  async function seedTenant(args: {
    subdomain: string;
    status: "pending" | "active" | "locked";
    stripeCustomerId: string | null;
    stripeSubscriptionId?: string | null;
    plan?: "monthly" | "yearly";
  }) {
    const rec = await createTenant(
      {
        subdomain: args.subdomain,
        email: `${args.subdomain}@example.com`,
        customerType: "b2c",
        plan: args.plan ?? "monthly",
        status: args.status,
      },
      "self",
    );
    await putTenant({
      ...rec,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId ?? null,
    });
  }

  function makeParams(subdomain: string) {
    return { params: Promise.resolve({ subdomain }) };
  }

  // ─── Test 1: dry-run + endringer → ingen skriving ──────────────────
  console.log("\nTest 1: dryRun=1 + endringer → IKKE skrive, returner proposed");
  mockStore.clear();
  mockSet.clear();
  writeCount = 0;
  await seedTenant({
    subdomain: "tenant-pending",
    status: "pending",
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: null,
    plan: "monthly",
  });
  const writesAfterSeed = writeCount;
  mockSubscriptions = [
    {
      id: "sub_active_1",
      status: "active",
      items: { data: [{ price: { id: "price_MONTHLY_TEST" } }] },
    },
  ];
  const res1 = await POST(makeReq("tenant-pending", { dryRun: true, query: true }), makeParams("tenant-pending"));
  const body1 = (await res1.json()) as {
    ok: boolean;
    dryRun: boolean;
    synced: boolean;
    proposed: { status: string; stripeSubscriptionId: string | null } | null;
    reasons: string[];
  };
  assert(res1.status === 200, "200 OK");
  assert(body1.ok === true, "ok=true");
  assert(body1.dryRun === true, "dryRun=true i respons");
  assert(body1.synced === false, "synced=false (dry-run)");
  assert(body1.proposed?.status === "active", "proposed.status = active");
  assert(
    body1.proposed?.stripeSubscriptionId === "sub_active_1",
    "proposed.stripeSubscriptionId = sub_active_1",
  );
  assert(body1.reasons.length > 0, "reasons inneholder forklaringer");
  assert(
    writeCount === writesAfterSeed,
    `INGEN skriving til Upstash (writeCount: ${writeCount}, før: ${writesAfterSeed})`,
  );
  const t1 = await getTenant("tenant-pending");
  assert(t1?.status === "pending", "tenant.status fortsatt 'pending' i Upstash");
  assert(
    t1?.stripeSubscriptionId === null,
    "tenant.stripeSubscriptionId fortsatt null",
  );

  // ─── Test 2: apply (dryRun=false) → SKRIVER ────────────────────────
  console.log("\nTest 2: dryRun=false + endringer → SKRIVER til Upstash");
  const writesBeforeApply = writeCount;
  const res2 = await POST(makeReq("tenant-pending"), makeParams("tenant-pending"));
  const body2 = (await res2.json()) as {
    ok: boolean;
    dryRun: boolean;
    synced: boolean;
    after: { status: string; stripeSubscriptionId: string | null } | null;
  };
  assert(res2.status === 200, "200 OK");
  assert(body2.dryRun === false, "dryRun=false i respons");
  assert(body2.synced === true, "synced=true");
  assert(body2.after?.status === "active", "after.status = active");
  assert(
    body2.after?.stripeSubscriptionId === "sub_active_1",
    "after.stripeSubscriptionId = sub_active_1",
  );
  assert(writeCount > writesBeforeApply, "Upstash ble skrevet til");
  const t2 = await getTenant("tenant-pending");
  assert(t2?.status === "active", "tenant.status NÅ 'active' i Upstash");

  // ─── Test 3: Ingen endringer (Stripe og tenant matcher allerede) ──
  console.log("\nTest 3: Stripe matcher allerede → proposed=null, ingen skriving");
  mockStore.clear();
  mockSet.clear();
  writeCount = 0;
  await seedTenant({
    subdomain: "tenant-synced",
    status: "active",
    stripeCustomerId: "cus_test_3",
    stripeSubscriptionId: "sub_match",
    plan: "monthly",
  });
  const writes3 = writeCount;
  mockSubscriptions = [
    {
      id: "sub_match",
      status: "active",
      items: { data: [{ price: { id: "price_MONTHLY_TEST" } }] },
    },
  ];
  const res3 = await POST(
    makeReq("tenant-synced", { dryRun: true, query: true }),
    makeParams("tenant-synced"),
  );
  const body3 = (await res3.json()) as {
    ok: boolean;
    proposed: unknown;
    synced: boolean;
  };
  assert(res3.status === 200, "200 OK");
  assert(body3.proposed === null, "proposed=null (ingen endringer)");
  assert(body3.synced === false, "synced=false");
  assert(writeCount === writes3, "INGEN skriving");

  // ─── Test 4: Ingen stripeCustomerId → 409 ──────────────────────────
  console.log("\nTest 4: tenant uten stripeCustomerId → 409");
  mockStore.clear();
  mockSet.clear();
  writeCount = 0;
  await seedTenant({
    subdomain: "no-stripe",
    status: "pending",
    stripeCustomerId: null,
  });
  const res4 = await POST(makeReq("no-stripe"), makeParams("no-stripe"));
  assert(res4.status === 409, "409 Conflict");
  const body4 = (await res4.json()) as { error: string };
  assert(body4.error === "no_stripe_customer", "error=no_stripe_customer");

  // ─── Test 5: Tenant finnes ikke → 404 ──────────────────────────────
  console.log("\nTest 5: tenant finnes ikke → 404");
  mockStore.clear();
  const res5 = await POST(makeReq("ghost"), makeParams("ghost"));
  assert(res5.status === 404, "404 Not Found");

  // ─── Test 6: body { dryRun: true } virker også (ikke bare query) ──
  console.log("\nTest 6: body { dryRun: true } støttes (i tillegg til ?dryRun=1)");
  mockStore.clear();
  mockSet.clear();
  writeCount = 0;
  await seedTenant({
    subdomain: "body-dry",
    status: "pending",
    stripeCustomerId: "cus_body",
    plan: "monthly",
  });
  const writes6 = writeCount;
  mockSubscriptions = [
    {
      id: "sub_body",
      status: "active",
      items: { data: [{ price: { id: "price_MONTHLY_TEST" } }] },
    },
  ];
  const res6 = await POST(makeReq("body-dry", { dryRun: true }), makeParams("body-dry"));
  const body6 = (await res6.json()) as { dryRun: boolean; synced: boolean };
  assert(body6.dryRun === true, "dryRun=true (fra body)");
  assert(body6.synced === false, "synced=false");
  assert(writeCount === writes6, "INGEN skriving");

  // ─── Resultat ──────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`Iter 14.9 sync-stripe — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
