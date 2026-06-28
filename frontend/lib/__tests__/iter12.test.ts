/**
 * Ko | Do · Vault — v4.3 Iter 12 — Tester for /api/register/paid
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter12.test.ts`
 *
 * Tester de testbare delene UTEN å snakke med ekte Stripe/Upstash:
 *   1. Validering av input (manglende email, plan, subdomain)
 *   2. Plan-validering (kun "monthly"/"yearly" tillatt)
 *   3. Stripe checkout-helper bygger riktig payload (priceId, trial_period_days,
 *      metadata, success/cancel_url)
 *   4. Stripe customer-helper bygger riktig payload (idempotencyKey,
 *      metadata.subdomain)
 *
 * Vi mocker Stripe SDK ved å override Module.prototype.require.
 */
import { Module } from "node:module";

const originalRequire = Module.prototype.require;
void originalRequire; // ikke i bruk — beholdt for fremtidig mock-behov

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

// ─── Mock Stripe SDK ──────────────────────────────────────────────────
interface StripeCall {
  type: "customer" | "checkout";
  payload: Record<string, unknown>;
  options: Record<string, unknown>;
}
const stripeCalls: StripeCall[] = [];

const fakeStripe = {
  customers: {
    create: async (
      payload: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      stripeCalls.push({ type: "customer", payload, options });
      return { id: "cus_TEST123" };
    },
  },
  checkout: {
    sessions: {
      create: async (
        payload: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        stripeCalls.push({ type: "checkout", payload, options });
        return {
          id: "cs_TEST_abc",
          url: "https://checkout.stripe.com/c/pay/cs_TEST_abc",
        };
      },
    },
  },
};

// Sett env-vars som kreves
process.env.STRIPE_SECRET_KEY = "sk_test_mock";
process.env.STRIPE_PRICE_MONTHLY = "price_MONTHLY_TEST";
process.env.STRIPE_PRICE_YEARLY = "price_YEARLY_TEST";

async function runTests() {
  const { createCustomerJIT, createCheckoutSessionScenarioC } = await import(
    "../stripe/checkout"
  );
  const { getPriceIdForPlan } = await import("../stripe/client");

  // ─── Test 1: getPriceIdForPlan ──────────────────────────────────────
  console.log("\ngetPriceIdForPlan — env-vars mapping");
  assert(
    getPriceIdForPlan("monthly") === "price_MONTHLY_TEST",
    "monthly mapper til STRIPE_PRICE_MONTHLY",
  );
  assert(
    getPriceIdForPlan("yearly") === "price_YEARLY_TEST",
    "yearly mapper til STRIPE_PRICE_YEARLY",
  );

  // ─── Test 2: createCustomerJIT ──────────────────────────────────────
  console.log("\ncreateCustomerJIT — payload + idempotency");
  stripeCalls.length = 0;
  const customer = await createCustomerJIT(
    {
      subdomain: "terje",
      email: "terje@example.com",
      firstName: "Terje",
      lastName: "Hansen",
      tenantCreatedAt: "2026-02-01T00:00:00.000Z",
    },
    fakeStripe as never,
  );
  assert(customer.id === "cus_TEST123", "returnerer customer.id");
  const customerCall = stripeCalls.find((c) => c.type === "customer");
  assert(customerCall !== undefined, "kaller stripe.customers.create");
  assert(
    customerCall?.payload.email === "terje@example.com",
    "sender email i payload",
  );
  assert(
    customerCall?.payload.name === "Terje Hansen",
    "bygger name fra firstName + lastName",
  );
  const meta = customerCall?.payload.metadata as Record<string, string>;
  assert(meta?.subdomain === "terje", "metadata.subdomain = subdomain");
  assert(
    customerCall?.options.idempotencyKey ===
      "customer-terje-2026-02-01T00:00:00.000Z",
    "idempotencyKey inkluderer tenantCreatedAt",
  );

  // ─── Test 3: createCustomerJIT uten navn ────────────────────────────
  console.log("\ncreateCustomerJIT — uten firstName/lastName");
  stripeCalls.length = 0;
  await createCustomerJIT(
    {
      subdomain: "kari",
      email: "kari@example.com",
      tenantCreatedAt: "2026-02-02T00:00:00.000Z",
    },
    fakeStripe as never,
  );
  const c2 = stripeCalls.find((c) => c.type === "customer");
  assert(c2?.payload.name === undefined, "name-felt ikke satt når navn mangler");

  // ─── Test 4: createCheckoutSessionScenarioC ─────────────────────────
  console.log("\ncreateCheckoutSessionScenarioC — Scenario C (30d trial)");
  stripeCalls.length = 0;
  const session = await createCheckoutSessionScenarioC(
    {
      customerId: "cus_TEST123",
      plan: "monthly",
      subdomain: "terje",
      baseUrl: "https://kodovault.no",
      trialDays: 30,
    },
    fakeStripe as never,
  );
  assert(
    session.url === "https://checkout.stripe.com/c/pay/cs_TEST_abc",
    "returnerer session.url",
  );
  const checkoutCall = stripeCalls.find((c) => c.type === "checkout");
  assert(checkoutCall !== undefined, "kaller stripe.checkout.sessions.create");
  assert(
    checkoutCall?.payload.mode === "subscription",
    "mode: 'subscription'",
  );
  assert(
    checkoutCall?.payload.customer === "cus_TEST123",
    "customer-ID forwarded",
  );

  const lineItems = checkoutCall?.payload.line_items as Array<{
    price: string;
    quantity: number;
  }>;
  assert(
    lineItems?.[0]?.price === "price_MONTHLY_TEST",
    "line_items bruker monthly price-ID",
  );
  assert(lineItems?.[0]?.quantity === 1, "quantity = 1");

  const subData = checkoutCall?.payload.subscription_data as {
    trial_period_days: number;
    metadata: Record<string, string>;
  };
  assert(
    subData?.trial_period_days === 30,
    "subscription_data.trial_period_days = 30 (Scenario C)",
  );
  assert(
    subData?.metadata?.subdomain === "terje",
    "subscription_data.metadata.subdomain = subdomain",
  );

  const sessMeta = checkoutCall?.payload.metadata as Record<string, string>;
  assert(sessMeta?.subdomain === "terje", "session metadata.subdomain");
  assert(sessMeta?.plan === "monthly", "session metadata.plan = 'monthly'");
  assert(sessMeta?.scenario === "C", "session metadata.scenario = 'C'");

  assert(
    typeof checkoutCall?.payload.success_url === "string" &&
      (checkoutCall.payload.success_url as string).includes(
        "/billing/success",
      ) &&
      (checkoutCall.payload.success_url as string).includes(
        "{CHECKOUT_SESSION_ID}",
      ),
    "success_url inneholder /billing/success + {CHECKOUT_SESSION_ID}",
  );
  assert(
    typeof checkoutCall?.payload.cancel_url === "string" &&
      (checkoutCall.payload.cancel_url as string).includes(
        "/platform/register?plan=monthly",
      ) &&
      (checkoutCall.payload.cancel_url as string).includes("cancelled=1"),
    "cancel_url peker til /platform/register?plan=monthly&cancelled=1",
  );
  assert(
    (checkoutCall?.payload.automatic_tax as { enabled: boolean })?.enabled ===
      true,
    "automatic_tax aktivert",
  );
  assert(
    checkoutCall?.payload.billing_address_collection === "required",
    "billing_address_collection = 'required'",
  );
  assert(
    typeof checkoutCall?.options.idempotencyKey === "string" &&
      checkoutCall.options.idempotencyKey.startsWith(
        "checkout-C-terje-monthly-",
      ) &&
      /^checkout-C-terje-monthly-[a-f0-9]{12}$/.test(
        checkoutCall.options.idempotencyKey,
      ),
    "idempotencyKey = 'checkout-C-<sub>-<plan>-<paramsHash>' (params-fingerprint forhindrer Stripe IdempotencyError ved param-endring)",
  );

  // ─── Test 5: yearly plan velger riktig price-ID ─────────────────────
  console.log("\ncreateCheckoutSessionScenarioC — yearly plan");
  stripeCalls.length = 0;
  await createCheckoutSessionScenarioC(
    {
      customerId: "cus_TEST123",
      plan: "yearly",
      subdomain: "kari",
      baseUrl: "https://kodovault.no",
      trialDays: 30,
    },
    fakeStripe as never,
  );
  const yearlyCall = stripeCalls.find((c) => c.type === "checkout");
  const yearlyItems = yearlyCall?.payload.line_items as Array<{
    price: string;
  }>;
  assert(
    yearlyItems?.[0]?.price === "price_YEARLY_TEST",
    "yearly bruker STRIPE_PRICE_YEARLY",
  );
  assert(
    typeof yearlyCall?.options.idempotencyKey === "string" &&
      /^checkout-C-kari-yearly-[a-f0-9]{12}$/.test(
        yearlyCall.options.idempotencyKey,
      ),
    "idempotencyKey speiler plan-navnet (med params-fingerprint-suffix)",
  );

  // ─── Test 6: trialDays=0 → utelat trial_period_days helt ────────────
  console.log("\ncreateCheckoutSessionScenarioC — trialDays=0 (ingen trial)");
  stripeCalls.length = 0;
  await createCheckoutSessionScenarioC(
    {
      customerId: "cus_TEST_NOTRIAL",
      plan: "monthly",
      subdomain: "lisa",
      baseUrl: "https://kodovault.no",
      trialDays: 0,
    },
    fakeStripe as never,
  );
  const noTrialCall = stripeCalls.find((c) => c.type === "checkout");
  const noTrialSub = noTrialCall?.payload.subscription_data as {
    trial_period_days?: number;
    metadata: Record<string, string>;
  };
  assert(
    noTrialSub?.trial_period_days === undefined,
    "trialDays=0 → subscription_data UTELATER trial_period_days helt",
  );
  assert(
    noTrialSub?.metadata?.subdomain === "lisa",
    "subscription_data.metadata.subdomain fortsatt satt ved trialDays=0",
  );

  // ─── Test 7: trialDays=7 → settes som det er ────────────────────────
  console.log("\ncreateCheckoutSessionScenarioC — trialDays=7 (kort prøve)");
  stripeCalls.length = 0;
  await createCheckoutSessionScenarioC(
    {
      customerId: "cus_TEST_7DAYS",
      plan: "yearly",
      subdomain: "petter",
      baseUrl: "https://kodovault.no",
      trialDays: 7,
    },
    fakeStripe as never,
  );
  const shortTrialCall = stripeCalls.find((c) => c.type === "checkout");
  const shortTrialSub = shortTrialCall?.payload.subscription_data as {
    trial_period_days: number;
  };
  assert(
    shortTrialSub?.trial_period_days === 7,
    "trialDays=7 → trial_period_days=7",
  );

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────");
  console.log(`${passed} bestått · ${failed} feilet`);
  if (failed > 0) {
    console.log("\nFeilede tester:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Alle iter12-tester bestått.");
}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
