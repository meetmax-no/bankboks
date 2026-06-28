/**
 * Ko | Do · Vault — v4.3 Iter 13 — Stripe webhook
 *
 * URL: https://admin.kodovault.no/api/webhook (satt opp av Mike i Iter 11)
 *
 * Events vi lytter på (Stripe Dashboard-konfig):
 *   - customer.subscription.created   → provisjoner (Upstash + Vercel)
 *   - customer.subscription.updated   → synkroniser plan
 *   - customer.subscription.deleted   → status=cancelled (m/ D-069-guard)
 *   - invoice.paid                    → bekreft status=active
 *   - invoice.payment_failed          → status=locked + varsle Mike
 *                                       (m/ D-069-guard)
 *
 * Sekvens (Mike's krav):
 *   1. Verifiser Stripe-signatur FØR alt annet. Feil signatur → 400.
 *   2. Dispatch til riktig handler basert på event.type.
 *   3. Logg hvert steg til provisioningLog (handlers gjør dette selv).
 *   4. Returner 200 så snart som mulig. Handlers er fire-and-forget for
 *      varsler (Telegram/e-post).
 *
 * Per D-069: status-mutationer går gjennom canAutoLock/canAutoCancel
 * i handler-funksjonene. lint:d069 håndhever importene automatisk.
 *
 * Node runtime — Stripe SDK krever Node.
 */
import { NextResponse } from "next/server";
import {
  verifyAndParseWebhook,
} from "@/lib/stripe/webhook";
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleCheckoutSessionExpired,
  type HandlerResult,
} from "@/lib/stripe/event-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // ─── 1. Hent rå body + Stripe-signatur ──────────────────────────────
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();

  // ─── 2. Verifiser signatur FØR alt annet ────────────────────────────
  let event;
  try {
    event = verifyAndParseWebhook(rawBody, signature);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[webhook] signature verification failed:", msg);
    return NextResponse.json(
      { error: "invalid_signature", detail: msg },
      { status: 400 },
    );
  }

  // ─── 3. Dispatch ────────────────────────────────────────────────────
  let result: HandlerResult = { ok: true, detail: "ignored" };
  try {
    switch (event.type) {
      case "customer.subscription.created":
        result = await handleSubscriptionCreated(event);
        break;
      case "customer.subscription.updated":
        result = await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        result = await handleSubscriptionDeleted(event);
        break;
      case "invoice.paid":
        result = await handleInvoicePaid(event);
        break;
      case "invoice.payment_failed":
        result = await handleInvoicePaymentFailed(event);
        break;
      case "checkout.session.expired":
        result = await handleCheckoutSessionExpired(event);
        break;
      default:
        // Ukjent event-type — vi lyttet ikke på den, men returner 200
        // så Stripe ikke retry-er i evighet.
        console.log(`[webhook] ignored event.type=${event.type}`);
        result = { ok: true, detail: `ignored: ${event.type}` };
    }
  } catch (err) {
    // Handlers skal IKKE kaste, men hvis de gjør det, fang og returner 500
    // så Stripe retry-er (eksponentiell backoff i 3 dager).
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[webhook] handler for ${event.type} kastet:`, msg);
    return NextResponse.json(
      { error: "handler_failed", event: event.type, detail: msg },
      { status: 500 },
    );
  }

  // ─── 4. Suksess (200 til Stripe) ────────────────────────────────────
  return NextResponse.json({
    ok: result.ok,
    event: event.type,
    eventId: event.id,
    detail: result.detail,
  });
}
