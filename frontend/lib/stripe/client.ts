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

// D-131 (2026-02): `getB2BPriceId()` ble fjernet. Send-invoice-flyten brukte
// den til å hente recurring Stripe-prise-IDer for `invoiceItems.create` —
// men `invoiceItems` krever `type=one_time`, mens env-ID-ene er recurring
// (designet for subscriptions). Send-invoice bygger nå inline med `amount +
// currency` basert på D-127 `getB2BPricing()`. Env-vars-ene
// `STRIPE_PRICE_B2B_SEMIANNUAL` / `_YEARLY` beholdes fordi
// `priceIdToPlan()` i event-handlers.ts mapper dem til `b2b_*`-plan-verdier
// når en framtidig subscription opprettes manuelt i Stripe Dashboard.
