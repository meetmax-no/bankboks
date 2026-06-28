/**
 * Ko | Do · Vault — v4.3 Iter 12.5 — Tester for POST /api/billing/create-checkout
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter12-5-create-checkout.test.ts`
 *
 * Tester (mocked Stripe + Upstash):
 *   1. Scenario A: status="trial" + før trialEndsAt → trial_end pinnet
 *   2. Scenario B: status="locked" → INGEN trial_end (immediate billing)
 *   3. Scenario B (variant): status="trial" men trialEndsAt passert → B
 *   4. Scenario C: status="pending" → trial_period_days: 30
 *   5. JIT customer opprettes hvis stripeCustomerId mangler
 *   6. JIT customer hoppes hvis stripeCustomerId allerede satt
 *   7. invalid_plan / missing_plan / invalid_host / tenant_not_found
 *   8. invalid_status: active → 409
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

// ─── Mock Stripe SDK ──────────────────────────────────────────────────
type StripeCall = { fn: string; args: unknown };
let stripeCalls: StripeCall[] = [];
let nextCustomerId = "cus_mock";
let nextSessionUrl = "https://stripe.test/checkout/x";
let nextSessionId = "cs_mock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeStripeCtor: any = function () {
  return {
    customers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async create(args: any) {
        stripeCalls.push({ fn: "customers.create", args });
        return { id: nextCustomerId };
      },
    },
    checkout: {
      sessions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async create(args: any) {
          stripeCalls.push({ fn: "checkout.sessions.create", args });
          return { id: nextSessionId, url: nextSessionUrl };
        },
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

function makeReq(opts: {
  host?: string;
  body?: unknown;
}) {
  const host = opts.host ?? "terje.kodovault.no";
  const headers = new Headers({
    "content-type": "application/json",
    host,
    origin: `https://${host}`,
  });
  return new Request(`https://${host}/api/billing/create-checkout`, {
    method: "POST",
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
}

async function runTests() {
  const { POST } = await import(
    "../../app/api/billing/create-checkout/route"
  );
  const { putTenant, createTenant, getTenant } = await import(
    "../platform/tenant-store"
  );

  async function seed(args: {
    subdomain: string;
    status: "trial" | "locked" | "pending" | "active";
    stripeCustomerId?: string | null;
    trialEndsAt?: string;
    plan?: "monthly" | "yearly" | "trial" | "free";
  }) {
    const rec = await createTenant(
      {
        subdomain: args.subdomain,
        email: `${args.subdomain}@example.com`,
        customerType: "b2c",
        plan: args.plan ?? "trial",
        status: args.status,
      },
      "self",
    );
    await putTenant({
      ...rec,
      stripeCustomerId: args.stripeCustomerId ?? null,
      trialEndsAt: args.trialEndsAt ?? rec.trialEndsAt,
    });
  }

  function reset() {
    mockStore.clear();
    mockSet.clear();
    stripeCalls = [];
    nextCustomerId = "cus_mock";
    nextSessionUrl = "https://stripe.test/checkout/x";
    nextSessionId = "cs_mock";
  }

  // ─── Test 1: Scenario A — trial, før trialEndsAt ───────────────────
  console.log("\nTest 1: status=trial, før trialEndsAt → Scenario A (trial_end pinnet)");
  reset();
  const futureTrial = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  await seed({
    subdomain: "alice",
    status: "trial",
    stripeCustomerId: "cus_existing_A",
    trialEndsAt: futureTrial,
  });
  const res1 = await POST(makeReq({ host: "alice.kodovault.no", body: { plan: "monthly" } }));
  const body1 = (await res1.json()) as { ok: boolean; scenario: string; url: string };
  assert(res1.status === 200, "200 OK");
  assert(body1.ok === true, "ok=true");
  assert(body1.scenario === "A", "scenario=A");
  const checkoutCallA = stripeCalls.find((c) => c.fn === "checkout.sessions.create");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const argsA = checkoutCallA?.args as any;
  assert(
    argsA?.subscription_data?.trial_end === Math.floor(new Date(futureTrial).getTime() / 1000),
    "trial_end pinnet til trialEndsAt",
  );
  assert(
    !("trial_period_days" in (argsA?.subscription_data ?? {})),
    "INGEN trial_period_days (kun trial_end)",
  );
  assert(argsA?.metadata?.scenario === "A", "metadata.scenario=A");
  assert(argsA?.customer === "cus_existing_A", "bruker eksisterende customer");
  // Customer-create skal IKKE være kalt
  assert(
    !stripeCalls.some((c) => c.fn === "customers.create"),
    "customers.create IKKE kalt (eksisterende customer)",
  );

  // ─── Test 2: Scenario B — locked ───────────────────────────────────
  console.log("\nTest 2: status=locked → Scenario B (immediate billing)");
  reset();
  await seed({
    subdomain: "bob",
    status: "locked",
    stripeCustomerId: "cus_existing_B",
  });
  const res2 = await POST(makeReq({ host: "bob.kodovault.no", body: { plan: "yearly" } }));
  const body2 = (await res2.json()) as { scenario: string };
  assert(res2.status === 200, "200 OK");
  assert(body2.scenario === "B", "scenario=B");
  const checkoutCallB = stripeCalls.find((c) => c.fn === "checkout.sessions.create");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const argsB = checkoutCallB?.args as any;
  assert(
    !("trial_end" in (argsB?.subscription_data ?? {})),
    "INGEN trial_end (immediate billing)",
  );
  assert(
    !("trial_period_days" in (argsB?.subscription_data ?? {})),
    "INGEN trial_period_days",
  );
  assert(argsB?.metadata?.scenario === "B", "metadata.scenario=B");
  assert(argsB?.line_items?.[0]?.price === "price_YEARLY_TEST", "yearly price");

  // ─── Test 3: Scenario B variant — trial men trialEndsAt passert ────
  console.log("\nTest 3: status=trial men trialEndsAt passert → Scenario B");
  reset();
  const pastTrial = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  await seed({
    subdomain: "charlie",
    status: "trial",
    stripeCustomerId: "cus_existing_C",
    trialEndsAt: pastTrial,
  });
  const res3 = await POST(makeReq({ host: "charlie.kodovault.no", body: { plan: "monthly" } }));
  const body3 = (await res3.json()) as { scenario: string };
  assert(body3.scenario === "B", "scenario=B (trial utløpt)");

  // ─── Test 4: Scenario C — pending ──────────────────────────────────
  // NB: default.json har trialDays=0 (Mike satte det globalt 06.06),
  // så Scenario C utelater trial_period_days helt.
  console.log("\nTest 4: status=pending → Scenario C (default trialDays=0 → ingen trial)");
  reset();
  await seed({
    subdomain: "dora",
    status: "pending",
    stripeCustomerId: "cus_existing_C",
  });
  const res4 = await POST(makeReq({ host: "dora.kodovault.no", body: { plan: "monthly" } }));
  const body4 = (await res4.json()) as { scenario: string };
  assert(res4.status === 200, "200 OK");
  assert(body4.scenario === "C", "scenario=C");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const argsC = stripeCalls.find((c) => c.fn === "checkout.sessions.create")?.args as any;
  assert(
    argsC?.subscription_data?.trial_period_days === undefined,
    "trial_period_days utelatt (default=0)",
  );
  assert(argsC?.metadata?.scenario === "C", "metadata.scenario=C");

  // ─── Test 5: JIT customer opprettes hvis stripeCustomerId mangler ──
  console.log("\nTest 5: JIT customer opprettes hvis stripeCustomerId=null");
  reset();
  nextCustomerId = "cus_just_created";
  const futureTrial5 = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
  await seed({
    subdomain: "ellen",
    status: "trial",
    stripeCustomerId: null,
    trialEndsAt: futureTrial5,
  });
  const res5 = await POST(makeReq({ host: "ellen.kodovault.no", body: { plan: "monthly" } }));
  assert(res5.status === 200, "200 OK");
  assert(
    stripeCalls.some((c) => c.fn === "customers.create"),
    "customers.create kalt",
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args5 = stripeCalls.find((c) => c.fn === "checkout.sessions.create")?.args as any;
  assert(args5?.customer === "cus_just_created", "checkout bruker nyopprettet customer");
  // Customer-ID skal være persistert
  const t5 = await getTenant("ellen");
  assert(t5?.stripeCustomerId === "cus_just_created", "stripeCustomerId lagret i Upstash");

  // ─── Test 6: Validering ────────────────────────────────────────────
  console.log("\nTest 6: validering — missing_plan / invalid_plan / invalid_host / 404");
  reset();
  const res6a = await POST(makeReq({ body: {} }));
  assert(res6a.status === 400 && (await res6a.json()).error === "missing_plan", "missing_plan → 400");

  reset();
  const res6b = await POST(makeReq({ body: { plan: "lifetime" } }));
  assert(res6b.status === 400 && (await res6b.json()).error === "invalid_plan", "invalid_plan → 400");

  reset();
  const res6c = await POST(makeReq({ host: "kodovault.no", body: { plan: "monthly" } }));
  assert(res6c.status === 400 && (await res6c.json()).error === "invalid_host", "root-host → invalid_host");

  reset();
  const res6d = await POST(makeReq({ host: "admin.kodovault.no", body: { plan: "monthly" } }));
  assert(res6d.status === 400 && (await res6d.json()).error === "invalid_host", "admin-host → invalid_host");

  reset();
  const res6e = await POST(makeReq({ host: "ghost.kodovault.no", body: { plan: "monthly" } }));
  assert(res6e.status === 404 && (await res6e.json()).error === "tenant_not_found", "ukjent tenant → 404");

  // ─── Test 7: Status=active → 409 ───────────────────────────────────
  console.log("\nTest 7: status=active → 409 invalid_status");
  reset();
  await seed({
    subdomain: "frank",
    status: "active",
    stripeCustomerId: "cus_active",
    plan: "monthly",
  });
  const res7 = await POST(makeReq({ host: "frank.kodovault.no", body: { plan: "yearly" } }));
  const body7 = (await res7.json()) as { error: string };
  assert(res7.status === 409, "409 Conflict");
  assert(body7.error === "invalid_status", "error=invalid_status");

  // ─── Resultat ──────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`Iter 12.5 create-checkout — ${passed} passed, ${failed} failed`);
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
