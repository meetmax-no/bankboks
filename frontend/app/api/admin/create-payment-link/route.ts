/**
 * Ko | Do · Vault — v4.3 Iter 14.8 — Admin: opprett betalingslink for kunde
 *
 * Brukes når Mike snakker med en kunde (telefon, e-post) og vil gi dem
 * en direkte betalingslink i stedet for å sende dem gjennom det offentlige
 * /platform/register-skjemaet.
 *
 * Variant A1 (auto-provisjonering): når kunden betaler, fyrer Stripe
 * webhook `customer.subscription.created` → eksisterende handler i
 * `lib/stripe/event-handlers.ts` provisjonerer Upstash + Vercel + sender
 * velkomst automatisk. Mike trenger ikke gjøre noe etter at link er sendt.
 *
 * Forskjell fra `/api/register/paid` (public):
 *   - Bypasser Turnstile + rate-limit (admin-cookie = sterk auth)
 *   - Mike bestemmer kunde-data manuelt (subdomain, email, navn, plan,
 *     customerType)
 *   - createdBy = "admin"
 *   - lifecycleEmails = standard (kunde får dag-25/30/37/etc. e-poster)
 *
 * Forskjell fra `/api/admin/test-register-paid`:
 *   - Genererer IKKE auto subdomain/email — Mike spesifiserer alt
 *   - notes settes IKKE til "STRIPE_TEST" — dette er en ekte kunde
 *
 * Returnerer Checkout-URL'en — Mike kopierer og sender via valgfri kanal.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { isSubdomainAvailable } from "@/lib/platform/subdomain";
import { createTenant, getTenant, putTenant } from "@/lib/platform/tenant-store";
import {
  createCustomerJIT,
  createCheckoutSessionScenarioC,
  type PaidPlan,
} from "@/lib/stripe/checkout";
import { getTrialDays } from "@/lib/platform/client-config-store";
import type { CreateTenantInput } from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PENDING_TTL_MS = 30 * 60 * 1000;

interface PaymentLinkRequestBody {
  subdomain?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  plan?: PaidPlan;
  customerType?: "b2c" | "b2b";
  locale?: "no" | "sv" | "da" | "en";
  notes?: string;
  lifecycleEmails?: boolean;
}

export async function POST(req: Request) {
  let body: PaymentLinkRequestBody;
  try {
    body = (await req.json()) as PaymentLinkRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // ─── Valider input ──────────────────────────────────────────────────
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email || !EMAIL_RX.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const subdomain = body.subdomain?.trim().toLowerCase() ?? "";
  if (!subdomain) {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }

  const plan = body.plan;
  if (plan !== "monthly" && plan !== "yearly") {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }

  const customerType = body.customerType ?? "b2c";
  if (customerType !== "b2c" && customerType !== "b2b") {
    return NextResponse.json({ error: "invalid_customer_type" }, { status: 400 });
  }

  // Iter 19.9.7 locale-fix: server-side whitelist mot tampering. Klienten
  // har obligatorisk radio-knapp, men curl kan bypasse den.
  if (
    body.locale !== undefined &&
    !["no", "sv", "da", "en"].includes(body.locale as string)
  ) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  // ─── Sjekk at subdomain er ledig ────────────────────────────────────
  const availability = await isSubdomainAvailable(subdomain);
  if (!availability.available) {
    const status = availability.reason === "taken" ? 409 : 400;
    return NextResponse.json(
      { error: availability.reason, detail: `subdomain '${subdomain}' er ikke tilgjengelig` },
      { status },
    );
  }

  // ─── Opprett pending tenant ─────────────────────────────────────────
  const input: CreateTenantInput = {
    subdomain,
    email,
    customerType,
    firstName: body.firstName?.trim() || undefined,
    lastName: body.lastName?.trim() || undefined,
    plan,
    status: "pending",
    lifecycleEmails: body.lifecycleEmails ?? true,
    locale: body.locale,
    notes: body.notes?.trim() || undefined,
  };

  try {
    const record = await createTenant(input, "admin");
    const pendingExpiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    await putTenant({ ...record, pendingExpiresAt });

    // ─── JIT Stripe customer ────────────────────────────────────────
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
      console.error("[admin/create-payment-link] customer failed:", err);
      return NextResponse.json(
        { error: "stripe_error", stage: "customer", detail: msg },
        { status: 502 },
      );
    }

    const t1 = (await getTenant(record.subdomain)) ?? record;
    await putTenant({ ...t1, stripeCustomerId });

    // ─── Opprett Checkout-session ───────────────────────────────────
    try {
      const baseUrl = getBaseUrl(req);
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
        customerType,
        url: session.url,
        sessionId: session.id,
        expiresAt: pendingExpiresAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[admin/create-payment-link] checkout failed:", err);
      return NextResponse.json(
        { error: "stripe_error", stage: "checkout", detail: msg },
        { status: 502 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[admin/create-payment-link] createTenant failed:", err);
    if (msg.includes("finnes allerede") || msg.includes("already exists")) {
      return NextResponse.json({ error: "subdomain_taken", detail: msg }, { status: 409 });
    }
    return NextResponse.json({ error: "internal_error", detail: msg }, { status: 500 });
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
