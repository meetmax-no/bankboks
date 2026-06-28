/**
 * Ko | Do · Vault — v4.3 Iter 19.7 — GET /api/billing/subscription
 *
 * Henter LIVE abonnement-info direkte fra Stripe for tenanten som spør.
 * Brukes av Settings-panelet til å vise "Mitt abonnement"-kortet:
 *   - Plan + pris + valuta
 *   - Status (active/trialing/past_due/canceled/...)
 *   - Neste betaling (current_period_end)
 *   - Cancel-at-period-end + cancel_at
 *   - Trial-end hvis aktiv trial
 *   - Betalingsmetode (kort-merke + last4) hvis tilgjengelig
 *
 * Identitet (D-046): subdomain bestemmes av host eller `?_tenant=`.
 * Tenant-poden rewriter dette til admin via D-071 (`/api/billing/*`).
 *
 * Bytte fra `/api/billing/checkout-info` (cache-basert):
 *   - checkout-info leser fra Upstash → rask, men kan være stale hvis
 *     webhook er forsinket eller mistet
 *   - dette endepunktet kaller Stripe direkte → alltid friskt, men en
 *     ekstra rundtur (~150-300ms). Egnet for "vis info når Settings åpnes"
 *     hvor brukeren er villig til å vente litt for fersk data.
 *
 * Side-effekt: hvis Stripe-data avviker fra tenant-recorden (cancel-felter,
 * status mappet til active/locked), oppdaterer vi Upstash slik at neste
 * paywall-check / SettingsPanel-rendering blir konsistent. Dette gjør
 * endepunktet til en "free webhook backstop".
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant, appendProvisioningEvent } from "@/lib/platform/tenant-store";
import { getStripeClient } from "@/lib/stripe/client";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import type { Plan, TenantRecord } from "@/lib/platform/tenant-types";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuccessResponse {
  ok: true;
  /**
   * Stripe-status. Ulik tenant.status (vår interne lifecycle). Vi viser
   * vår status til bruker når mulig, men returnerer også Stripe-status
   * for debug + edge cases (paused, incomplete_expired osv).
   */
  stripeStatus:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | "paused"
    | "no_subscription";
  plan: Plan | null;
  /** Beløp i øre (NOK)/cent — major-unit konvertering gjøres i frontend. */
  amount: number | null;
  currency: string | null;
  interval: "month" | "year" | null;
  /** ISO 8601 — start på inneværende fakturaperiode. */
  currentPeriodStart: string | null;
  /** ISO 8601 — slutt på inneværende periode = neste fakturadato. */
  currentPeriodEnd: string | null;
  /** ISO 8601 — slutt på trial hvis i trialing-modus. */
  trialEnd: string | null;
  /** Bruker har bedt om kansellering ved periodens slutt (Stripe Portal). */
  cancelAtPeriodEnd: boolean;
  /** ISO 8601 — når kanselleringen faktisk trer i kraft. */
  cancelEffectiveAt: string | null;
  /** Kort-merke + last4 hvis Stripe default_payment_method er kort. */
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

interface ErrorResponse {
  ok: false;
  error:
    | "invalid_host"
    | "tenant_not_found"
    | "no_stripe_customer"
    | "stripe_error";
  detail?: string;
}

export async function GET(req: Request) {
  // ─── 1. Subdomain ────────────────────────────────────────────────────
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("_tenant")?.trim().toLowerCase();
  let subdomain = tenantParam ?? "";
  if (!subdomain) {
    const host = req.headers.get("host") ?? "";
    const m = host.toLowerCase().match(/^([^.]+)\.kodovault\./);
    subdomain = m?.[1] ?? "";
  }
  if (!subdomain || !isValidSubdomainFormat(subdomain)) {
    return err("invalid_host", undefined, 400);
  }

  // ─── 2. Hent tenant ──────────────────────────────────────────────────
  const tenant = await getTenant(subdomain);
  if (!tenant) return err("tenant_not_found", undefined, 404);
  if (!tenant.stripeCustomerId) {
    // Trial/pending uten Stripe-konto — returner tom respons så UI'et
    // bare skjuler kortet uten å vise feilmelding.
    const empty: SuccessResponse = {
      ok: true,
      stripeStatus: "no_subscription",
      plan: tenant.plan ?? null,
      amount: null,
      currency: null,
      interval: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      cancelEffectiveAt: null,
      paymentMethod: null,
    };
    return NextResponse.json(empty, { status: 200 });
  }

  // ─── 3. Stripe API ───────────────────────────────────────────────────
  const stripe = getStripeClient();
  let subscriptions: Stripe.ApiList<Stripe.Subscription>;
  try {
    subscriptions = await stripe.subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: "all",
      limit: 10,
      expand: ["data.default_payment_method"],
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err("stripe_error", detail, 502);
  }

  // Prioriter aktive/trialing over forfalt/kansellert
  const sorted = [...subscriptions.data].sort((a, b) => statusRank(a.status) - statusRank(b.status));
  const primary = sorted[0];

  if (!primary) {
    const empty: SuccessResponse = {
      ok: true,
      stripeStatus: "no_subscription",
      plan: tenant.plan ?? null,
      amount: null,
      currency: null,
      interval: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      cancelEffectiveAt: null,
      paymentMethod: null,
    };
    return NextResponse.json(empty, { status: 200 });
  }

  // Trekk ut pris-info fra første line-item
  const item = primary.items.data[0];
  const price = item?.price;
  const amount = price?.unit_amount ?? null;
  const currency = price?.currency?.toUpperCase() ?? null;
  const interval =
    price?.recurring?.interval === "month" || price?.recurring?.interval === "year"
      ? price.recurring.interval
      : null;
  const planFromPrice = priceIdToPlan(price?.id);

  // current_period_end/start ligger på item i nyere API-versjoner og på
  // subscription i eldre — sjekk begge for å være robust.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const primAny = primary as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemAny = (item ?? {}) as any;
  const currentPeriodEndUnix: number | null =
    typeof itemAny.current_period_end === "number"
      ? itemAny.current_period_end
      : typeof primAny.current_period_end === "number"
        ? primAny.current_period_end
        : null;
  const currentPeriodStartUnix: number | null =
    typeof itemAny.current_period_start === "number"
      ? itemAny.current_period_start
      : typeof primAny.current_period_start === "number"
        ? primAny.current_period_start
        : null;
  const cancelAtUnix: number | null =
    typeof primAny.cancel_at === "number" ? primAny.cancel_at : null;
  const trialEndUnix: number | null =
    typeof primAny.trial_end === "number" ? primAny.trial_end : null;

  // Stripe Dahlia (2026-05-27): `cancel_at_period_end` er deprecated. Nyere
  // kanselleringer (inkl. Customer Portal i visse konfig) setter `cancel_at`
  // direkte til en future timestamp uten å sette `cancel_at_period_end=true`.
  // Begge mekanismer signaliserer SAMME UX-intensjon: "aktivt nå, kansellert
  // senere". Vi behandler dem som ett — flagg true hvis enten er satt.
  const legacyFlag = primAny.cancel_at_period_end === true;
  const cancelFlag = legacyFlag || cancelAtUnix !== null;
  const cancelEffectiveAt = cancelAtUnix
    ? new Date(cancelAtUnix * 1000).toISOString()
    : null;

  console.log(
    `[billing/subscription] ${tenant.subdomain} stripe-status=${primary.status} ` +
      `cancel_at_period_end=${primAny.cancel_at_period_end} cancel_at=${primAny.cancel_at} ` +
      `→ cancelFlag=${cancelFlag}`,
  );

  // Betalingsmetode — Stripe returnerer default_payment_method som expanded
  // PaymentMethod-objekt hvis vi ba om expand. Eldre subs kan ha
  // default_source i stedet, men vi ignorerer dem (kort-betaling via
  // Checkout/Portal lagrer alltid via payment_method).
  let paymentMethod: SuccessResponse["paymentMethod"] = null;
  const dpm = primary.default_payment_method;
  if (dpm && typeof dpm !== "string" && dpm.card) {
    paymentMethod = {
      brand: dpm.card.brand,
      last4: dpm.card.last4,
      expMonth: dpm.card.exp_month,
      expYear: dpm.card.exp_year,
    };
  }

  // ─── 4. Backstop: synk tenant-recorden hvis Stripe avviker ──────────
  // Holder cache-en (paywall, banner, settings-knapp) konsistent uten å
  // vente på neste webhook.
  await maybeSyncTenant(tenant, {
    stripeStatus: primary.status,
    cancelFlag,
    cancelEffectiveAt,
    plan: planFromPrice,
  });

  const response: SuccessResponse = {
    ok: true,
    stripeStatus: primary.status as SuccessResponse["stripeStatus"],
    plan: planFromPrice ?? tenant.plan ?? null,
    amount,
    currency,
    interval,
    currentPeriodStart: currentPeriodStartUnix
      ? new Date(currentPeriodStartUnix * 1000).toISOString()
      : null,
    currentPeriodEnd: currentPeriodEndUnix
      ? new Date(currentPeriodEndUnix * 1000).toISOString()
      : null,
    trialEnd: trialEndUnix ? new Date(trialEndUnix * 1000).toISOString() : null,
    cancelAtPeriodEnd: cancelFlag,
    cancelEffectiveAt,
    paymentMethod,
  };
  return NextResponse.json(response, { status: 200 });
}

// ─── Helpers ───────────────────────────────────────────────────────────

function statusRank(s: Stripe.Subscription.Status): number {
  if (s === "active") return 0;
  if (s === "trialing") return 1;
  if (s === "past_due") return 2;
  if (s === "unpaid") return 3;
  if (s === "incomplete") return 4;
  if (s === "paused") return 5;
  if (s === "incomplete_expired") return 6;
  if (s === "canceled") return 7;
  return 8;
}

function priceIdToPlan(priceId: string | undefined | null): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}

/**
 * Backstop-sync: hvis Stripe sier noe annet enn tenant-recorden, oppdater.
 * Begrenset til felter som er trygt å overskrive (D-069-respekt):
 *   - cancelAtPeriodEnd / cancelEffectiveAt (alltid speil av Stripe)
 *   - plan (price kan ha endret seg ved plan-bytte)
 *   - status: KUN flipp pending → active hvis Stripe sier active. Vi rør
 *     ikke trial → locked (cron) eller locked → cancelled (manuelt).
 */
async function maybeSyncTenant(
  tenant: TenantRecord,
  data: {
    stripeStatus: Stripe.Subscription.Status;
    cancelFlag: boolean;
    cancelEffectiveAt: string | null;
    plan: Plan | null;
  },
): Promise<void> {
  const updates: Partial<TenantRecord> = {};

  if (data.cancelFlag !== tenant.cancelAtPeriodEnd) {
    updates.cancelAtPeriodEnd = data.cancelFlag;
  }
  if (data.cancelEffectiveAt !== tenant.cancelEffectiveAt) {
    updates.cancelEffectiveAt = data.cancelEffectiveAt;
  }
  if (data.plan && data.plan !== tenant.plan) {
    updates.plan = data.plan;
  }
  // Trygg status-flipp: pending → active hvis Stripe sier active.
  // Andre transisjoner overlater vi til webhook + lifecycle-cron.
  if (
    tenant.status === "pending" &&
    (data.stripeStatus === "active" || data.stripeStatus === "trialing")
  ) {
    updates.status = "active";
    updates.pendingExpiresAt = null;
  }

  if (Object.keys(updates).length === 0) return;

  // Race-trygg re-fetch + skriv
  const fresh = (await getTenant(tenant.subdomain)) ?? tenant;
  await putTenant({ ...fresh, ...updates });
  await appendProvisioningEvent(tenant.subdomain, {
    timestamp: new Date().toISOString(),
    stage: "status_change",
    status: "ok",
    detail: `subscription-info backstop-sync: ${Object.keys(updates).join(", ")}`,
  });
}

function err(
  code: ErrorResponse["error"],
  detail: string | undefined,
  status: number,
): NextResponse {
  const body: ErrorResponse = { ok: false, error: code };
  if (detail) body.detail = detail;
  return NextResponse.json(body, { status });
}
