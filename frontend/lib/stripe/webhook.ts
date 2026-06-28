/**
 * Ko | Do · Vault — v4.3 Iter 13 — Stripe webhook signaturverifisering
 *
 * Stripe webhook-events MÅ verifiseres FØR vi rører noe. Hvis signaturen
 * ikke matcher → 400 og logg avvisningen. Signaturen baseres på rå
 * request-body (NIKKEL parsert JSON), og en delt secret som ligger i
 * `STRIPE_WEBHOOK_SECRET` (satt av Mike i Iter 11).
 *
 * Vi eksponerer to funksjoner:
 *   - verifyAndParseWebhook(rawBody, signature, stripeClient?)
 *     Returnerer en gyldig Stripe.Event eller kaster ved feil signatur.
 *   - getWebhookSecret() — fail-fast hvis env mangler.
 *
 * `stripeClient` er optional for testbarhet — i tester kan vi sende inn
 * en mock med `webhooks.constructEvent`.
 */
import type Stripe from "stripe";
import { getStripeClient } from "./client";

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET mangler i miljøvariabler. " +
        "Sett den i Vercel project settings (Iter 11).",
    );
  }
  return secret;
}

/**
 * Verifiser signatur og parse event. Stripe SDK gjør HMAC-SHA256 internt.
 * Kaster `Stripe.errors.StripeSignatureVerificationError` ved feil signatur.
 *
 * VIKTIG: `rawBody` MÅ være den uparsede request-body som string/Buffer.
 * Hvis du har gjort `await req.json()` først, er JSON re-serialisert og
 * signaturen vil ikke matche.
 */
export function verifyAndParseWebhook(
  rawBody: string,
  signature: string,
  stripeClient?: Pick<Stripe, "webhooks">,
): Stripe.Event {
  const stripe = stripeClient ?? getStripeClient();
  const secret = getWebhookSecret();
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
