/**
 * Ko | Do · Vault — v4.3 Iter 12 — Stripe SDK singleton
 *
 * Initialiserer Stripe-klienten én gang per Node-prosess. Throw-on-load
 * hvis STRIPE_SECRET_KEY mangler — fail-fast er bedre enn å oppdage feilen
 * midt i en checkout-flyt.
 *
 * apiVersion er pinned til Stripe Node SDK v22.x sin innebygde type-versjon.
 * Hvis vi senere migrerer til en nyere SDK må vi sjekke at types matcher.
 *
 * Node runtime kun — Stripe SDK fungerer ikke i Edge runtime.
 */
import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY mangler i miljøvariabler. " +
        "Sett den i Vercel project settings.",
    );
  }

  _stripe = new Stripe(key, {
    // Stripe Node v22.2.0 sin innebygde API-versjon. Hvis vi oppgraderer
    // SDK må vi sjekke at typene fortsatt matcher.
    apiVersion: "2026-05-27.dahlia",
    typescript: true,
    appInfo: {
      name: "Ko | Do · Vault",
      version: "4.3.0",
    },
  });

  return _stripe;
}

/**
 * Henter price-ID basert på plan-navn. Begge er satt som env-vars av Mike
 * i Iter 11. Hvis env mangler kaster vi — det betyr at /api/register/paid
 * faller fast før vi snakker med Stripe.
 */
export function getPriceIdForPlan(plan: "monthly" | "yearly"): string {
  const envKey =
    plan === "monthly" ? "STRIPE_PRICE_MONTHLY" : "STRIPE_PRICE_YEARLY";
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(
      `${envKey} mangler i miljøvariabler. Sett price-IDen i Vercel.`,
    );
  }
  return priceId;
}

/**
 * B2B-priser (Iter 20.4 · 2026-06-26). Egne Stripe Price IDer for per-seat-
 * pris. Mike oppretter Subscription manuelt i Stripe Dashboard og setter
 * quantity = parent.maxLicenses. Webhook plukker opp `subscription.created`
 * / `invoice.paid` og oppdaterer parent.plan + parent.nextBillingDate.
 *
 * Prismatrise (per seat, NOK):
 *   - semiannual: 522 kr/seat per 6 mnd (87 kr/seat × 6)
 *   - yearly:    1 044 kr/seat per år   (87 kr/seat × 12)
 */
export function getB2BPriceId(billing: "semiannual" | "yearly"): string {
  const envKey =
    billing === "semiannual"
      ? "STRIPE_PRICE_B2B_SEMIANNUAL"
      : "STRIPE_PRICE_B2B_YEARLY";
  const priceId = process.env[envKey];
  if (!priceId) {
    throw new Error(
      `${envKey} mangler i miljøvariabler. Sett B2B price-IDen i Vercel.`,
    );
  }
  return priceId;
}
