/**
 * Ko | Do · Vault — v4.3 Iter 17.x (2026-06-13) — Regresjonsvern:
 * Stripe IdempotencyKey skal automatisk endre seg når params endrer seg.
 *
 * Bug-rapport: Mike klikket "Aktiver abonnement" i låst tilstand → fikk
 * `stripe_error — checkout: Keys for idempotent requests can only be
 * used with the same parameters they were first used with. Try using
 * a key other than 'checkout-B-olsen17-monthly'.`
 *
 * Rotårsak: Idempotency-keyen var statisk på (subdomain, plan).
 * `success_url` ble endret i Iter 19.7 (la til `?existing=1`) → Stripe
 * cachet gamle params under samme key i 24t → IdempotencyError.
 *
 * Fiks: Suffix idempotency-keyen med en SHA-1-fingerprint av faktiske
 * params. Endrede params → ny fingerprint → ny key → ingen kollisjon.
 *
 * Dette regresjonsvernet sikrer at:
 *   1. Scenario A, B og C bruker hver sin prefix (checkout-A/B/C)
 *   2. Endring av success_url genererer en NY idempotency-key
 *   3. Endring av customer-ID genererer en NY idempotency-key
 *   4. Identiske kall gir SAMME key (dobbeltklikk-beskyttelse virker)
 */
import {
  createCheckoutSessionScenarioA,
  createCheckoutSessionScenarioB,
  createCheckoutSessionScenarioC,
} from "../stripe/checkout";

// Mock Stripe-modulen lett — vi bryr oss bare om idempotencyKey-suffixen.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
process.env.STRIPE_PRICE_MONTHLY = "price_MONTHLY_TEST";
process.env.STRIPE_PRICE_YEARLY = "price_YEARLY_TEST";

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

type Call = { options: { idempotencyKey?: string } };

function makeFakeStripe(calls: Call[]) {
  return {
    checkout: {
      sessions: {
        create: (
          _payload: unknown,
          options: { idempotencyKey?: string },
        ): Promise<{ id: string; url: string }> => {
          calls.push({ options });
          return Promise.resolve({
            id: "cs_test_dummy",
            url: "https://checkout.stripe.com/x",
          });
        },
      },
    },
  };
}

async function run() {
  // ─── Test 1: Scenario A/B/C bruker ulike prefix ──────────────────────
  console.log("\nIdempotency — Scenario A/B/C har ulike prefix");
  const calls: Call[] = [];
  const stripe = makeFakeStripe(calls);
  const baseInput = {
    customerId: "cus_TEST",
    plan: "monthly" as const,
    subdomain: "olsen17",
    baseUrl: "https://olsen17.kodovault.no",
  };
  await createCheckoutSessionScenarioA(
    { ...baseInput, trialEndsAt: "2026-07-01T00:00:00Z" },
    stripe as never,
  );
  await createCheckoutSessionScenarioB(baseInput, stripe as never);
  await createCheckoutSessionScenarioC(
    { ...baseInput, trialDays: 30 },
    stripe as never,
  );
  assert(
    calls[0]?.options.idempotencyKey?.startsWith("checkout-A-olsen17-monthly-") ===
      true,
    "Scenario A: key starter med 'checkout-A-olsen17-monthly-'",
  );
  assert(
    calls[1]?.options.idempotencyKey?.startsWith("checkout-B-olsen17-monthly-") ===
      true,
    "Scenario B: key starter med 'checkout-B-olsen17-monthly-'",
  );
  assert(
    calls[2]?.options.idempotencyKey?.startsWith("checkout-C-olsen17-monthly-") ===
      true,
    "Scenario C: key starter med 'checkout-C-olsen17-monthly-'",
  );

  // Hash-suffix er 12 hex
  for (const c of calls) {
    assert(
      /-[a-f0-9]{12}$/.test(c.options.idempotencyKey ?? ""),
      `Key ender med 12-hex paramsFingerprint: ${c.options.idempotencyKey}`,
    );
  }

  // ─── Test 2: Identiske kall → SAMME key (dobbeltklikk-beskyttelse) ───
  console.log("\nIdempotency — identiske kall gir SAMME key");
  const callsA: Call[] = [];
  await createCheckoutSessionScenarioB(baseInput, makeFakeStripe(callsA) as never);
  await createCheckoutSessionScenarioB(baseInput, makeFakeStripe(callsA) as never);
  assert(
    callsA[0]?.options.idempotencyKey === callsA[1]?.options.idempotencyKey,
    `Samme params → samme key (${callsA[0]?.options.idempotencyKey})`,
  );

  // ─── Test 3: Endret success_url → NY key (HOVED-FIX) ────────────────
  console.log("\nIdempotency — endret baseUrl gir NY key (rotårsaks-fix)");
  const callsB: Call[] = [];
  const stripeB = makeFakeStripe(callsB);
  await createCheckoutSessionScenarioB(baseInput, stripeB as never);
  await createCheckoutSessionScenarioB(
    { ...baseInput, baseUrl: "https://olsen17.kodovault.no/v2" },
    stripeB as never,
  );
  assert(
    callsB[0]?.options.idempotencyKey !== callsB[1]?.options.idempotencyKey,
    "Endret baseUrl → ny key (forhindrer Stripe IdempotencyError)",
  );

  // ─── Test 4: Endret customerId → NY key ─────────────────────────────
  console.log("\nIdempotency — endret customer gir NY key");
  const callsC: Call[] = [];
  const stripeC = makeFakeStripe(callsC);
  await createCheckoutSessionScenarioB(baseInput, stripeC as never);
  await createCheckoutSessionScenarioB(
    { ...baseInput, customerId: "cus_OTHER" },
    stripeC as never,
  );
  assert(
    callsC[0]?.options.idempotencyKey !== callsC[1]?.options.idempotencyKey,
    "Endret customerId → ny key",
  );

  // ─── Test 5: Endret plan → NY key (semantisk forskjellig) ───────────
  console.log("\nIdempotency — monthly vs yearly gir NY key");
  const callsD: Call[] = [];
  const stripeD = makeFakeStripe(callsD);
  await createCheckoutSessionScenarioB(baseInput, stripeD as never);
  await createCheckoutSessionScenarioB(
    { ...baseInput, plan: "yearly" },
    stripeD as never,
  );
  assert(
    callsD[0]?.options.idempotencyKey !== callsD[1]?.options.idempotencyKey,
    "monthly vs yearly → ulike keys",
  );

  console.log("\n──────────────────────────────────────");
  console.log(`Resultat: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Feilet:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
