/**
 * Ko | Do · Vault — v4.3 Iter 12 — Stripe customer + checkout helpers
 *
 * Eksporterer to funksjoner:
 *   - createCustomerJIT(tenant): just-in-time customer-opprettelse (D-049).
 *     Kalles første gang en tenant trenger en Stripe-relasjon. Idempotent
 *     via idempotencyKey = `customer-${subdomain}` så samme subdomain alltid
 *     gir samme customer selv ved retry.
 *
 *   - createCheckoutSessionScenarioC(customerId, plan, subdomain, baseUrl, trialDays):
 *     Scenario C per D-045 — ny bruker velger betalt plan direkte fra
 *     /register. Stripe gir N-dagers trial via `trial_period_days`, der N
 *     hentes fra tenant client-config (faller tilbake til default.json → 30).
 *     Bruker MÅ legge inn kort før trial starter (payment_method_collection
 *     defaulter til "always" når trial_period_days er satt).
 *
 * Metadata-strategi:
 *   - Customer: { subdomain } — for å spore tilbake til tenant
 *   - Session: { subdomain, plan } — for webhook (Iter 13) som leser dette
 *     fra `checkout.session.completed`-eventet
 *   - Subscription: { subdomain } — for webhooks som lytter på
 *     `customer.subscription.*` eventer
 *
 * Node runtime.
 */
import type Stripe from "stripe";
import crypto from "node:crypto";
import { getStripeClient, getPriceIdForPlan } from "./client";

/**
 * Beregner en kort, deterministisk hash (12 hex-tegn) av et Stripe-
 * paramsobjekt. Brukes som suffix på idempotency-keyer for å garantere
 * at ENDREDE params automatisk gir en NY key — Stripe's idempotency-
 * cache holder en key i 24 timer og kaster `IdempotencyError` hvis
 * samme key brukes med endrede parametre. Tidligere bug-symptom:
 * `Keys for idempotent requests can only be used with the same
 * parameters they were first used with. Try using a key other than
 * 'checkout-B-olsen17-monthly'.`
 *
 * JSON.stringify er deterministisk fordi vi konstruerer objektet i
 * samme rekkefølge hver gang. Hash-en er kun for fingeravtrykk —
 * krever ikke kryptografisk styrke, så SHA-1 trunkert til 12 hex
 * (48 bits) er rikelig (collision-sjanse <1 i 281 milliarder).
 */
function paramsFingerprint(params: object): string {
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(params))
    .digest("hex")
    .slice(0, 12);
}

export type PaidPlan = "monthly" | "yearly";

interface CustomerInput {
  subdomain: string;
  email: string;
  firstName?: string;
  lastName?: string;
  /**
   * Tenant.createdAt (ISO string). Inkluderes i idempotency-keyen så hver
   * ny tenant-registrering får unik nøkkel. Uten dette ble keyen
   * `customer-<subdomain>` gjenbrukt på tvers av sletting + re-opprettelse
   * av samme subdomain, og Stripe cacher den i 24t — selv etter manuell
   * sletting i Stripe-dashboard. Resultat: `IdempotencyError` ved retry
   * med endrede parametere (navn/e-post).
   */
  tenantCreatedAt: string;
}

/**
 * Just-in-time Stripe customer (D-049). Returnerer customer.id.
 *
 * Idempotent: kalt med samme subdomain to ganger returnerer SAMME customer
 * (Stripe garanterer idempotencyKey-replay i 24 timer). Etter 24 timer kan
 * en ny customer opprettes — caller må sjekke `tenant.stripeCustomerId`
 * først og kun kalle denne hvis null.
 *
 * `stripeClient` er optional for testbarhet — produksjonskode lar den være
 * undefined så vi bruker singleton fra getStripeClient().
 */
export async function createCustomerJIT(
  input: CustomerInput,
  stripeClient?: Pick<Stripe, "customers">,
): Promise<Stripe.Customer> {
  const stripe = stripeClient ?? getStripeClient();
  const name =
    [input.firstName, input.lastName].filter(Boolean).join(" ").trim() ||
    undefined;

  return stripe.customers.create(
    {
      email: input.email,
      ...(name ? { name } : {}),
      metadata: {
        subdomain: input.subdomain,
      },
    },
    {
      idempotencyKey: `customer-${input.subdomain}-${input.tenantCreatedAt}`,
    },
  );
}

interface CheckoutScenarioCInput {
  customerId: string;
  plan: PaidPlan;
  subdomain: string;
  /**
   * Base-URL for success/cancel-redirects. Bygges fra request-headers i
   * route-handleren — aldri hardkodet (D-001-style: omit defaults).
   * Eksempel: "https://kodovault.no"
   */
  baseUrl: string;
  /**
   * Antall trial-dager Stripe skal gi. Caller henter denne fra
   * `getTrialDays(subdomain)` (lib/platform/client-config-store) som faller
   * tilbake til default.json → 30 hvis ikke satt per tenant. Holdt
   * required (ikke optional) så caller alltid eksplisitt bestemmer.
   *
   * `0` = ingen trial, fakturer umiddelbart (Stripe-feltet utelates da
   * helt — Stripe krever min. 1 hvis det er satt).
   */
  trialDays: number;
}

/**
 * Scenario A (D-045): trial-bruker konverterer FØR trialEndsAt.
 *
 * `subscription_data.trial_end` (UNIX-timestamp i sekunder) sørger for at
 * første Stripe-faktura settes EKSAKT på opprinnelig trialEndsAt — bruker
 * får ALDRI dobbeltbetalt for resterende trial-dager. Neste faktura:
 * trialEndsAt + 30d (monthly) / + 365d (yearly).
 *
 * Idempotency: `checkout-A-${subdomain}-${plan}`.
 */
interface CheckoutScenarioABInput {
  customerId: string;
  plan: PaidPlan;
  subdomain: string;
  baseUrl: string;
}

export async function createCheckoutSessionScenarioA(
  input: CheckoutScenarioABInput & { trialEndsAt: string },
  stripeClient?: Pick<Stripe, "checkout">,
): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient ?? getStripeClient();
  const priceId = getPriceIdForPlan(input.plan);
  const trialEndUnix = Math.floor(new Date(input.trialEndsAt).getTime() / 1000);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_end: trialEndUnix,
      metadata: { subdomain: input.subdomain },
    },
    metadata: {
      subdomain: input.subdomain,
      plan: input.plan,
      scenario: "A",
    },
    success_url: `${input.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&subdomain=${encodeURIComponent(input.subdomain)}&existing=1`,
    cancel_url: `${input.baseUrl}/billing/upgrade?cancelled=1`,
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    expand: ["customer"],
  };

  return stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout-A-${input.subdomain}-${input.plan}-${paramsFingerprint(sessionParams)}`,
  });
}

/**
 * Scenario B (D-045): trial utløpt, bruker møter betalingsvegg.
 *
 * INGEN `trial_end` — første faktura umiddelbart. Neste faktura: i dag + 30d
 * (monthly) / + 365d (yearly). Bruker kan bare velge betalt plan herfra
 * (admin-page redirecter til denne ved status="locked").
 *
 * Idempotency: `checkout-B-${subdomain}-${plan}`.
 */
export async function createCheckoutSessionScenarioB(
  input: CheckoutScenarioABInput,
  stripeClient?: Pick<Stripe, "checkout">,
): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient ?? getStripeClient();
  const priceId = getPriceIdForPlan(input.plan);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: input.customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { subdomain: input.subdomain },
    },
    metadata: {
      subdomain: input.subdomain,
      plan: input.plan,
      scenario: "B",
    },
    success_url: `${input.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&subdomain=${encodeURIComponent(input.subdomain)}&existing=1`,
    cancel_url: `${input.baseUrl}/billing/upgrade?cancelled=1`,
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    expand: ["customer"],
  };

  return stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout-B-${input.subdomain}-${input.plan}-${paramsFingerprint(sessionParams)}`,
  });
}

/**
 * Scenario C (D-045): ny bruker velger betalt plan direkte fra /register.
 * Stripe håndterer trial-perioden selv (lengde fra `pricing.trialDays` i
 * default.json eller per-tenant client-config). Bruker MÅ legge inn kort i Checkout.
 *
 * Idempotency: vi bruker `checkout-${subdomain}-${plan}` som idempotencyKey.
 * Stripe replay-er identisk session-respons hvis kall gjentas innen 24t —
 * samme session.url returneres, bruker havner på samme Stripe-side.
 *
 * `stripeClient` er optional for testbarhet — produksjonskode lar den være
 * undefined så vi bruker singleton fra getStripeClient().
 */
export async function createCheckoutSessionScenarioC(
  input: CheckoutScenarioCInput,
  stripeClient?: Pick<Stripe, "checkout">,
): Promise<Stripe.Checkout.Session> {
  const stripe = stripeClient ?? getStripeClient();
  const priceId = getPriceIdForPlan(input.plan);

  // Stripe krever `trial_period_days >= 1` hvis feltet er satt. Når Mike har
  // satt trialDays=0 i client-config betyr det "ingen trial, fakturer
  // umiddelbart" — vi utelater feltet helt for å unngå Stripe API-feil.
  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: {
      subdomain: input.subdomain,
    },
    ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
  };

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: input.customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: subscriptionData,
    metadata: {
      subdomain: input.subdomain,
      plan: input.plan,
      scenario: "C",
    },
    success_url: `${input.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}&subdomain=${encodeURIComponent(input.subdomain)}`,
    cancel_url: `${input.baseUrl}/platform/register?plan=${input.plan}&cancelled=1&sub=${encodeURIComponent(input.subdomain)}`,
    // Stripe samler tax automatisk hvis Stripe Tax er aktivert (Iter 11).
    automatic_tax: { enabled: true },
    // Krev billing-adresse for korrekt Stripe Tax-beregning.
    billing_address_collection: "required",
    // Customer ble JIT-opprettet uten adresse (vi har den ikke ennå).
    // Tillat Stripe å lagre adressen brukeren legger inn i Checkout
    // tilbake på customer-objektet — uten dette feiler `automatic_tax`
    // med "valid address on the Customer required".
    customer_update: {
      address: "auto",
      name: "auto",
    },
    // Ekspandér customer slik at vi har full kontekst hvis vi vil
    // logge / debugge på en partial failure i kall-stedet.
    expand: ["customer"],
  };

  return stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout-C-${input.subdomain}-${input.plan}-${paramsFingerprint(sessionParams)}`,
  });
}
