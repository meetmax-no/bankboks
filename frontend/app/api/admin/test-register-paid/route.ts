/**
 * Ko | Do · Vault — v4.3 Iter 14 — Admin test-endpoint for Stripe-flyten
 *
 * Bypasser Turnstile + rate-limit fordi admin-cookien er sterk auth
 * (middleware matcher /api/admin/* og krever gyldig HMAC-signert session
 * cookie satt etter vault-unlock).
 *
 * Brukes av "Test Stripe-flyt"-knappen i admin-modulen for å verifisere
 * e2e-flyt uten å sette opp Cloudflare Turnstile på admin-siden.
 *
 * Genererer:
 *   - subdomain: "stripe-test-<random6>"
 *   - email:     "stripe-test+<random6>@kodovault.no"
 *
 * Setter `lifecycleEmails: false` så test-tenant ikke spammer e-postene
 * når dag-25/30/37-cron fyrer (Iter 15+).
 *
 * Setter `notes`-felt med "STRIPE_TEST" så Mike kan se i admin-listen at
 * det er et test-objekt.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { createTenant, getTenant, putTenant } from "@/lib/platform/tenant-store";
import {
  createCustomerJIT,
  createCheckoutSessionScenarioC,
  type PaidPlan,
} from "@/lib/stripe/checkout";
import { getTrialDays } from "@/lib/platform/client-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PENDING_TTL_MS = 30 * 60 * 1000;

interface TestPaidRequestBody {
  plan?: PaidPlan;
}

export async function POST(req: Request) {
  let body: TestPaidRequestBody;
  try {
    body = (await req.json()) as TestPaidRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = body.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    return NextResponse.json(
      { error: "invalid_plan", detail: "plan må være 'monthly' eller 'yearly'" },
      { status: 400 },
    );
  }

  // Generer random subdomain + email. 6 base36 = ~36^6 = 2 mrd kombinasjoner
  // — kollisjon med eksisterende tenant er praktisk umulig, men vi sjekker.
  const random = Math.random().toString(36).slice(2, 8);
  const subdomain = `stripe-test-${random}`;
  const email = `stripe-test+${random}@kodovault.no`;

  try {
    // Opprett TenantRecord (pending, b2c, lifecycleEmails=false)
    const record = await createTenant(
      {
        subdomain,
        email,
        customerType: "b2c",
        firstName: "Stripe",
        lastName: "Test",
        plan,
        status: "pending",
        lifecycleEmails: false,
        notes: "STRIPE_TEST — opprettet via admin-test-knapp",
      },
      "admin",
    );

    // Sett pendingExpiresAt = now + 30min
    const pendingExpiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    await putTenant({ ...record, pendingExpiresAt });

    // JIT Stripe customer
    let stripeCustomerId: string;
    try {
      const customer = await createCustomerJIT({
        subdomain: record.subdomain,
        email: record.email,
        firstName: record.firstName ?? undefined,
        lastName: record.lastName ?? undefined,
        tenantCreatedAt: record.createdAt,
      });
      stripeCustomerId = customer.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[admin/test-register-paid] customer failed:", err);
      return NextResponse.json(
        { error: "stripe_error", stage: "customer", detail: msg },
        { status: 502 },
      );
    }

    // Lagre customer-ID
    const t1 = (await getTenant(record.subdomain)) ?? record;
    await putTenant({ ...t1, stripeCustomerId });

    // Opprett Checkout-session
    const baseUrl = getBaseUrl(req);
    try {
      const trialDays = await getTrialDays(record.subdomain);
      const session = await createCheckoutSessionScenarioC({
        customerId: stripeCustomerId,
        plan,
        subdomain: record.subdomain,
        baseUrl,
        trialDays,
      });
      if (!session.url) {
        return NextResponse.json(
          { error: "stripe_error", detail: "session uten URL" },
          { status: 502 },
        );
      }
      return NextResponse.json({
        ok: true,
        subdomain: record.subdomain,
        email: record.email,
        plan,
        url: session.url,
        sessionId: session.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[admin/test-register-paid] checkout failed:", err);
      return NextResponse.json(
        { error: "stripe_error", stage: "checkout", detail: msg },
        { status: 502 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[admin/test-register-paid] createTenant failed:", err);
    return NextResponse.json(
      { error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}

function getBaseUrl(req: Request): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://admin.kodovault.no";
}
