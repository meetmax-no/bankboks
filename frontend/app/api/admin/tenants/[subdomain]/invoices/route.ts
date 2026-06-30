/**
 * Ko | Do · Vault — D-139 (2026-02) — Per-kunde fakturahistorikk
 *
 * GET /api/admin/tenants/[subdomain]/invoices?period=30d|90d|365d|all
 *
 * Lister Stripe-fakturaer for en tenant's customer-ID med datofilter
 * + sum-rad for regnskap/årsslutt-arbeid.
 *
 * Brukes av TenantViewer → "Stripe & Fakturaer"-tab. Kun B2B-parents
 * med `stripeCustomerId` har relevante fakturaer.
 *
 * Returnerer:
 *   {
 *     invoices: Array<{...}>,    // nyeste først
 *     summary: { count, total_amount_minor, total_tax_minor, total_paid_minor, currency }
 *   }
 *
 * Beløp er i minor units (øre for NOK) — frontend formaterer.
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { getStripeClient } from "@/lib/stripe/client";

type Period = "30d" | "90d" | "365d" | "all";

function parsePeriod(req: Request): Period {
  const { searchParams } = new URL(req.url);
  const p = searchParams.get("period");
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ subdomain: string }> },
) {
  const { subdomain } = await params;
  try {
    const tenant = await getTenant(subdomain);
    if (!tenant) {
      return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
    }
    if (!tenant.stripeCustomerId) {
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
      customer: tenant.stripeCustomerId,
      limit: 100,
      ...(created ? { created } : {}),
    });

    // Map til kompakt frontend-format
    const invoices = result.data.map((inv) => {
      const taxAmount =
        inv.total_taxes?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ?? 0;
      return {
        id: inv.id,
        number: inv.number,
        created: inv.created, // Unix timestamp
        status: inv.status, // "paid" | "open" | "void" | "uncollectible" | "draft"
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

    // Sum-rad: kun for fakturaer som ikke er voided/uncollectible
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
    console.error("[admin/tenants/.../invoices GET]", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
