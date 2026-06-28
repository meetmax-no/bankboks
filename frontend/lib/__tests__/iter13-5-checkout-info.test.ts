/**
 * Ko | Do · Vault — v4.3 Iter 13.5 — Tester for GET /api/billing/checkout-info
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter13-5-checkout-info.test.ts`
 *
 * Tester (mocked Upstash):
 *   1. Trial-tenant (15 dager igjen) → 200 m/ daysRemaining=15
 *   2. Locked-tenant → 200 m/ daysRemaining=0 (trial passert)
 *   3. Active-tenant → 400 invalid_status
 *   4. Pending-tenant → 400 invalid_status
 *   5. Ukjent tenant → 404 tenant_not_found
 *   6. host=kodovault.no (root) → 400 invalid_host
 *   7. host=admin.kodovault.no → 400 invalid_host
 *   8. host=www.kodovault.no → 400 invalid_host
 *   9. host=localhost → 400 invalid_host
 *  10. Manglende host-header → 400 missing_host
 *  11. hasStripeCustomer reflekterer faktisk verdi
 *  12. trialEndsAt med passert dato → daysRemaining=0
 */
import { Module } from "node:module";

const originalRequire = Module.prototype.require;

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

process.env.CENTRAL_KV_REST_API_URL = "https://mock.upstash.io";
process.env.CENTRAL_KV_REST_API_TOKEN = "mock-token";
process.env.CENTRAL_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

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

function makeReq(host: string | null) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return new Request(
    `https://${host ?? "missing"}/api/billing/checkout-info`,
    { method: "GET", headers },
  );
}

async function runTests() {
  const { GET } = await import("../../app/api/billing/checkout-info/route");
  const { putTenant, createTenant } = await import("../platform/tenant-store");

  async function seed(args: {
    subdomain: string;
    status: "trial" | "locked" | "pending" | "active";
    trialEndsAt?: string | null;
    stripeCustomerId?: string | null;
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
      trialEndsAt: args.trialEndsAt === undefined ? rec.trialEndsAt : (args.trialEndsAt ?? rec.trialEndsAt),
    });
  }

  function reset() {
    mockStore.clear();
    mockSet.clear();
  }

  // ─── Test 1: trial, 15 dager igjen ──────────────────────────────────
  console.log("\nTest 1: trial-tenant, 15 dager igjen → 200 daysRemaining=15");
  reset();
  const in15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000 - 1000).toISOString();
  await seed({
    subdomain: "alice",
    status: "trial",
    trialEndsAt: in15Days,
    stripeCustomerId: "cus_alice",
    plan: "trial",
  });
  const res1 = await GET(makeReq("alice.kodovault.no"));
  const body1 = (await res1.json()) as {
    ok: boolean;
    status: string;
    trialEndsAt: string;
    daysRemaining: number;
    hasStripeCustomer: boolean;
    plan: string;
    pricing: { monthly: number; yearly: number; currency: string };
  };
  assert(res1.status === 200, "200 OK");
  assert(body1.ok === true, "ok=true");
  assert(body1.status === "trial", "status=trial");
  assert(body1.daysRemaining === 15, `daysRemaining=15 (fikk ${body1.daysRemaining})`);
  assert(body1.trialEndsAt === in15Days, "trialEndsAt eksakt verdi");
  assert(body1.hasStripeCustomer === true, "hasStripeCustomer=true");
  assert(body1.plan === "trial", "plan=trial");
  assert(body1.pricing?.monthly === 115, `pricing.monthly=115 (fikk ${body1.pricing?.monthly})`);
  assert(body1.pricing?.yearly === 1104, `pricing.yearly=1104 (fikk ${body1.pricing?.yearly})`);
  assert(body1.pricing?.currency === "kr", `pricing.currency=kr (fikk ${body1.pricing?.currency})`);

  // ─── Test 2: locked, trial passert → daysRemaining=0 ───────────────
  console.log("\nTest 2: locked-tenant, trial passert → 200 daysRemaining=0");
  reset();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await seed({
    subdomain: "bob",
    status: "locked",
    trialEndsAt: past,
    stripeCustomerId: "cus_bob",
    plan: "trial",
  });
  const res2 = await GET(makeReq("bob.kodovault.no"));
  const body2 = (await res2.json()) as { status: string; daysRemaining: number };
  assert(res2.status === 200, "200 OK");
  assert(body2.status === "locked", "status=locked");
  assert(body2.daysRemaining === 0, "daysRemaining clampet til 0 (ikke negativ)");

  // ─── Test 3: active → 200 (Iter 19.5: gyldig status) ────────────────
  // Iter 19.5 utvidet checkout-info til å tillate active/cancelled så
  // Settings → "Administrer abonnement" kan rute på status. Active er
  // ikke lenger 400 invalid_status — den returnerer 200 med samme
  // shape som trial/locked, men med pricing-info for evt. plan-bytte.
  console.log("\nTest 3: active-tenant → 200 OK (Iter 19.5 utvidelse)");
  reset();
  await seed({
    subdomain: "carol",
    status: "active",
    stripeCustomerId: "cus_carol",
    plan: "monthly",
  });
  const res3 = await GET(makeReq("carol.kodovault.no"));
  const body3 = (await res3.json()) as { ok: boolean; status: string };
  assert(res3.status === 200, "200 OK (active er gyldig fra Iter 19.5)");
  assert(body3.ok === true, "ok=true");
  assert(body3.status === "active", "status=active speilet i body");

  // ─── Test 4: pending → 400 invalid_status ───────────────────────────
  console.log("\nTest 4: pending-tenant → 400 invalid_status");
  reset();
  await seed({
    subdomain: "dora",
    status: "pending",
    stripeCustomerId: null,
    plan: "monthly",
  });
  const res4 = await GET(makeReq("dora.kodovault.no"));
  const body4 = (await res4.json()) as { error: string };
  assert(res4.status === 400, "400 Bad Request");
  assert(body4.error === "invalid_status", "error=invalid_status");

  // ─── Test 5: ukjent tenant → 404 ────────────────────────────────────
  console.log("\nTest 5: ukjent tenant → 404 tenant_not_found");
  reset();
  const res5 = await GET(makeReq("ghost.kodovault.no"));
  const body5 = (await res5.json()) as { error: string };
  assert(res5.status === 404, "404 Not Found");
  assert(body5.error === "tenant_not_found", "error=tenant_not_found");

  // ─── Test 6-9: ugyldige hosts ───────────────────────────────────────
  console.log("\nTest 6-9: ugyldige hosts → 400 invalid_host");
  reset();
  for (const badHost of ["kodovault.no", "admin.kodovault.no", "www.kodovault.no", "api.kodovault.no", "localhost"]) {
    const res = await GET(makeReq(badHost));
    const body = (await res.json()) as { error: string };
    assert(
      res.status === 400 && body.error === "invalid_host",
      `${badHost} → 400 invalid_host`,
    );
  }

  // ─── Test 10: missing host ──────────────────────────────────────────
  console.log("\nTest 10: ingen host-header → 400 missing_host");
  reset();
  const res10 = await GET(makeReq(null));
  const body10 = (await res10.json()) as { error: string };
  assert(res10.status === 400, "400 Bad Request");
  assert(body10.error === "missing_host", "error=missing_host");

  // ─── Test 11: hasStripeCustomer=false ───────────────────────────────
  console.log("\nTest 11: tenant uten stripeCustomerId → hasStripeCustomer=false");
  reset();
  await seed({
    subdomain: "ellen",
    status: "trial",
    trialEndsAt: in15Days,
    stripeCustomerId: null,
  });
  const res11 = await GET(makeReq("ellen.kodovault.no"));
  const body11 = (await res11.json()) as { hasStripeCustomer: boolean };
  assert(body11.hasStripeCustomer === false, "hasStripeCustomer=false");

  // ─── Test 12: trialEndsAt netop passert → daysRemaining=0 ──────────
  console.log("\nTest 12: trialEndsAt akkurat passert → daysRemaining=0");
  reset();
  const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
  await seed({
    subdomain: "frank",
    status: "trial",
    trialEndsAt: oneSecondAgo,
    stripeCustomerId: "cus_frank",
  });
  const res12 = await GET(makeReq("frank.kodovault.no"));
  const body12 = (await res12.json()) as { daysRemaining: number };
  assert(body12.daysRemaining === 0, "daysRemaining=0 (ikke negativ, ikke 1)");

  // ─── Test 13: ?_tenant=<sub> har prioritet over host (D-071 rewrite) ─
  console.log("\nTest 13: ?_tenant=<sub> prioriteres (D-071 rewrite-arkitektur)");
  reset();
  await seed({
    subdomain: "ivar",
    status: "trial",
    trialEndsAt: in15Days,
    stripeCustomerId: "cus_ivar",
  });
  const reqRewrite = new Request(
    "https://admin.kodovault.no/api/billing/checkout-info?_tenant=ivar",
    {
      method: "GET",
      headers: new Headers({
        host: "admin.kodovault.no", // rewrite-destinasjon (skal IKKE brukes)
      }),
    },
  );
  const res13 = await GET(reqRewrite);
  const body13 = (await res13.json()) as { ok?: boolean; status?: string; error?: string };
  assert(res13.status === 200, `200 OK (fikk ${res13.status})`);
  assert(body13.ok === true, "ok=true (subdomain hentet fra ?_tenant=)");
  assert(body13.status === "trial", `status=trial (fikk ${body13.status})`);

  // ─── Test 14: tom _tenant-param → faller til host ──────────────────
  console.log("\nTest 14: tom ?_tenant= → faller til host-header");
  reset();
  await seed({
    subdomain: "lars",
    status: "trial",
    trialEndsAt: in15Days,
    stripeCustomerId: "cus_lars",
  });
  const reqEmpty = new Request("https://lars.kodovault.no/api/billing/checkout-info?_tenant=", {
    method: "GET",
    headers: new Headers({ host: "lars.kodovault.no" }),
  });
  const res14 = await GET(reqEmpty);
  const body14 = (await res14.json()) as { ok?: boolean; status?: string };
  assert(res14.status === 200, "200 OK");
  assert(body14.status === "trial", "subdomain hentet fra host");

  // ─── Test 15: ugyldig _tenant-format → 400 invalid_host ────────────
  console.log("\nTest 15: ?_tenant=<ugyldig> → 400 invalid_host");
  reset();
  const badTenants = [
    "AB", // for kort
    "..", // ugyldige tegn
    "-foo", // starter med bindestrek
    "foo-", // slutter med bindestrek
    "foo bar", // mellomrom
    "<script>alert(1)</script>", // XSS-forsøk
    "a".repeat(100), // for lang
  ];
  for (const bad of badTenants) {
    const r = new Request(
      `https://admin.kodovault.no/api/billing/checkout-info?_tenant=${encodeURIComponent(bad)}`,
      { method: "GET", headers: new Headers({ host: "admin.kodovault.no" }) },
    );
    const res = await GET(r);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    assert(
      res.status === 400 && body.error === "invalid_host",
      `"${bad.slice(0, 30)}" → 400 invalid_host (fikk ${res.status})`,
    );
  }

  // ─── Resultat ──────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`Iter 13.5 checkout-info — ${passed} passed, ${failed} failed`);
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
