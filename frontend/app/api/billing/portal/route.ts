/**
 * Ko | Do · Vault — v4.3 Iter 19.5 — Stripe Customer Portal
 *
 * GET /api/billing/portal
 *
 * Bruker (active/cancelled tenant) klikker "Administrer abonnement" i vault.
 * Vi oppretter en Stripe Customer Portal-session og redirecter (303) bruker
 * dit. Stripe håndterer kortbytte, fakturaer, oppsigelse, reactivation.
 * Når bruker er ferdig kommer de tilbake til `return_url` (vault root).
 *
 * Identitet (D-046): subdomain bestemmes av host. Tenant-poden rewriter
 * dette endepunktet til admin via D-071 (`beforeFiles` + `?_tenant=`).
 *
 * Stripe-portal aktiveres engangs i Stripe Dashboard →
 * Settings → Billing → Customer Portal. Se STRIPE_PORTAL_SETUP.md.
 *
 * Forutsetning: tenant.stripeCustomerId må være satt. Skal alltid være
 * tilfellet for status === "active" eller "cancelled" (satt under
 * /api/register/paid eller webhook).
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import { getStripeClient } from "@/lib/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ─── 1. Bestem subdomain — `?_tenant=` (rewritet) ELLER host ─────────
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("_tenant")?.trim().toLowerCase();
  let subdomain = tenantParam ?? "";
  if (!subdomain) {
    const host = req.headers.get("host") ?? "";
    const m = host.toLowerCase().match(/^([^.]+)\.kodovault\./);
    subdomain = m?.[1] ?? "";
  }
  if (!subdomain || !isValidSubdomainFormat(subdomain)) {
    return NextResponse.json(
      { ok: false, error: "invalid_host" },
      { status: 400 },
    );
  }

  // ─── 2. Slå opp tenant ───────────────────────────────────────────────
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "tenant_not_found" },
      { status: 404 },
    );
  }
  if (!tenant.stripeCustomerId && (tenant.status === "active" || tenant.status === "cancelled")) {
    return NextResponse.json(
      { ok: false, error: "no_stripe_customer" },
      { status: 409 },
    );
  }
  // Smart routing basert på status (Mike's spec 2026-06-13):
  //   active/cancelled → Stripe Customer Portal (selvbetjening)
  //   trial/locked     → /billing/upgrade (start/fortsett betaling)
  //   pending          → 409 (skjules i UI; ingen konto enda)
  if (tenant.status === "trial" || tenant.status === "locked") {
    return NextResponse.redirect(
      `https://${tenant.subdomain}.kodovault.no/billing/upgrade`,
      { status: 303 },
    );
  }
  if (tenant.status !== "active" && tenant.status !== "cancelled") {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_status",
        detail: `status "${tenant.status}" støttes ikke for portal`,
      },
      { status: 409 },
    );
  }

  // ─── 3. Lag portal-session og redirect ──────────────────────────────
  try {
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId!,
      return_url: `https://${tenant.subdomain}.kodovault.no/`,
    });
    // 303 → bruker browser navigerer rett til Stripe-URL
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: "stripe_error", detail },
      { status: 502 },
    );
  }
}
