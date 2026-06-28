/**
 * Ko | Do · Vault — v4.3 Iter 12.5.1 — POST /api/admin/tenants/[subdomain]/test-checkout
 *
 * Admin-test-wrapper rundt Iter 12.5-logikken. Lar Mike trigge en
 * Stripe Checkout-session for hvilken som helst tenant fra admin-UI,
 * uten å måtte besøke tenant-subdomenet selv.
 *
 * Forskjell fra `/api/billing/create-checkout`:
 *   - Subdomain kommer fra URL-parameter (ikke host-header)
 *   - Returnerer success_url tilbake til admin (ikke til tenant-domenet)
 *   - INGEN rate-limit (admin-only, krever middleware-beskyttelse)
 *
 * Logikken (scenario A/B/C, JIT customer) er identisk.
 *
 * Body: { plan: "monthly" | "yearly" }
 * Response: { ok, url, sessionId, scenario }
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import {
  createCustomerJIT,
  createCheckoutSessionScenarioA,
  createCheckoutSessionScenarioB,
  createCheckoutSessionScenarioC,
  type PaidPlan,
} from "@/lib/stripe/checkout";
import { getTrialDays } from "@/lib/platform/client-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

interface Body {
  plan?: PaidPlan;
}

export async function POST(req: Request, { params }: Params) {
  const { subdomain } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const plan = body.plan;
  if (!plan) return NextResponse.json({ ok: false, error: "missing_plan" }, { status: 400 });
  if (plan !== "monthly" && plan !== "yearly") {
    return NextResponse.json({ ok: false, error: "invalid_plan" }, { status: 400 });
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: "tenant_not_found" }, { status: 404 });
  }

  // ─── Scenario-valg (samme logikk som /api/billing/create-checkout) ──
  const now = Date.now();
  let scenario: "A" | "B" | "C";
  if (tenant.status === "trial") {
    if (!tenant.trialEndsAt) {
      return NextResponse.json(
        { ok: false, error: "trial_data_missing" },
        { status: 500 },
      );
    }
    const trialEnd = new Date(tenant.trialEndsAt).getTime();
    if (Number.isNaN(trialEnd)) {
      return NextResponse.json(
        { ok: false, error: "trial_data_missing" },
        { status: 500 },
      );
    }
    scenario = now < trialEnd ? "A" : "B";
  } else if (tenant.status === "locked") {
    scenario = "B";
  } else if (tenant.status === "pending") {
    scenario = "C";
  } else {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_status",
        detail: `status "${tenant.status}" støttes ikke (kun trial/locked/pending)`,
      },
      { status: 409 },
    );
  }

  // ─── JIT customer ────────────────────────────────────────────────────
  let stripeCustomerId = tenant.stripeCustomerId;
  if (!stripeCustomerId) {
    try {
      const customer = await createCustomerJIT({
        subdomain: tenant.subdomain,
        email: tenant.email,
        firstName: tenant.firstName ?? undefined,
        lastName: tenant.lastName ?? undefined,
        tenantCreatedAt: tenant.createdAt,
        // D-112: tax_id_data auto-utledet hvis NO/DK/SE + gyldig orgnr
        companyCountry: tenant.companyCountry,
        orgNumber: tenant.orgNumber,
      });
      stripeCustomerId = customer.id;
      const fresh = (await getTenant(subdomain)) ?? tenant;
      await putTenant({ ...fresh, stripeCustomerId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return NextResponse.json(
        { ok: false, error: "stripe_error", detail: `customer: ${msg}` },
        { status: 502 },
      );
    }
  }

  // ─── Bygg checkout-session ───────────────────────────────────────────
  // baseUrl for redirects bruker tenant-subdomenet så success/cancel
  // havner på riktig sted (samme som create-checkout fra tenant-domain).
  const baseUrl = `https://${tenant.subdomain}.kodovault.no`;
  try {
    let session;
    if (scenario === "A") {
      session = await createCheckoutSessionScenarioA({
        customerId: stripeCustomerId,
        plan,
        subdomain: tenant.subdomain,
        baseUrl,
        trialEndsAt: tenant.trialEndsAt,
      });
    } else if (scenario === "B") {
      session = await createCheckoutSessionScenarioB({
        customerId: stripeCustomerId,
        plan,
        subdomain: tenant.subdomain,
        baseUrl,
      });
    } else {
      const trialDays = await getTrialDays(tenant.subdomain);
      session = await createCheckoutSessionScenarioC({
        customerId: stripeCustomerId,
        plan,
        subdomain: tenant.subdomain,
        baseUrl,
        trialDays,
      });
    }
    if (!session.url) {
      return NextResponse.json(
        { ok: false, error: "stripe_error", detail: "session uten URL" },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      scenario,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { ok: false, error: "stripe_error", detail: `checkout: ${msg}` },
      { status: 502 },
    );
  }
}
