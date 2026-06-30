/**
 * Ko | Do · Vault — D-141 (2026-02) — Per-org fakturahistorikk for am-admin
 *
 * GET /api/am-admin/invoices?period=30d|90d|365d|all
 *
 * Returnerer fakturahistorikk for parent-tenant til innlogget am-admin
 * (super-admin og admin har lik tilgang — alle org-admins ser samme
 * org-fakturaer, det er ingen PII per ansatt her).
 *
 * Speiler shape og semantikk fra `/api/admin/tenants/[subdomain]/invoices`
 * (D-139) så frontend kan gjenbruke `InvoiceHistoryCard.tsx` uendret.
 *
 * Beskyttet av am-admin-session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { getStripeClient } from "@/lib/stripe/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Period = "30d" | "90d" | "365d" | "all";

function parsePeriod(req: NextRequest): Period {
  const p = req.nextUrl.searchParams.get("period");
  if (p === "30d" || p === "90d" || p === "365d" || p === "all") return p;
  return "90d";
}

function periodToSecondsAgo(p: Period): number | null {
  switch (p) {
    case "30d":
      return 30 * 24 * 60 * 60;
    case "90d":
      return 90 * 24 * 60 * 60;
    case "365d":
      return 365 * 24 * 60 * 60;
    case "all":
      return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (!parent) {
      return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
    }
    if (!parent.stripeCustomerId) {
      return NextResponse.json({
        invoices: [],
        summary: {
          count: 0,
          total_amount_minor: 0,
          total_tax_minor: 0,
          total_paid_minor: 0,
          currency: "nok",
        },
      });
    }

    const period = parsePeriod(req);
    const secondsAgo = periodToSecondsAgo(period);
    const created =
      secondsAgo === null
        ? undefined
        : { gte: Math.floor(Date.now() / 1000) - secondsAgo };

    const stripe = getStripeClient();
    const result = await stripe.invoices.list({
      customer: parent.stripeCustomerId,
      limit: 100,
      ...(created ? { created } : {}),
    });

    const invoices = result.data.map((inv) => {
      const taxAmount =
        inv.total_taxes?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ?? 0;
      return {
        id: inv.id,
        number: inv.number,
        created: inv.created,
        status: inv.status,
        amount_due_minor: inv.amount_due,
        amount_paid_minor: inv.amount_paid,
        total_minor: inv.total,
        tax_minor: taxAmount,
        currency: inv.currency,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
        paid_at: inv.status_transitions?.paid_at ?? null,
        collection_method: inv.collection_method,
        kodo_billing: (inv.metadata?.kodo_billing as string | undefined) ?? null,
        kodo_max_licenses:
          (inv.metadata?.kodo_max_licenses as string | undefined) ?? null,
      };
    });

    const billable = invoices.filter(
      (i) => i.status !== "void" && i.status !== "uncollectible",
    );
    const summary = {
      count: invoices.length,
      total_amount_minor: billable.reduce((s, i) => s + (i.total_minor ?? 0), 0),
      total_tax_minor: billable.reduce((s, i) => s + (i.tax_minor ?? 0), 0),
      total_paid_minor: invoices.reduce(
        (s, i) => s + (i.amount_paid_minor ?? 0),
        0,
      ),
      currency: invoices[0]?.currency ?? "nok",
      period,
    };

    return NextResponse.json({ invoices, summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[am-admin/invoices GET]", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
