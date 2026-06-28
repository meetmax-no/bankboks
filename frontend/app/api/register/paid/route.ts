/**
 * Ko | Do · Vault — v4.3 Iter 12 — POST /api/register/paid
 *
 * Public endpoint. Betalt registrering frem til Stripe Checkout.
 *
 * Flyt (per v4.3-SPEC Flyt 2):
 *   1. Rate-limit (bucket "register", DELT med /api/register — D-048)
 *   2. Parse + valider input (samme felt som /api/register PLUS plan)
 *   3. Verifiser Turnstile-token
 *   4. Valider subdomain (format + ikke reservert + ikke tatt)
 *   5. Reserver subdomenet: opprett TenantRecord {
 *        status: "pending",
 *        pendingExpiresAt: now + 30min,
 *        plan: "monthly" | "yearly"
 *      }
 *      MERK: vi provisjonerer IKKE Vercel/Upstash her — det skjer i Iter 13
 *      via Stripe-webhook (`checkout.session.completed`).
 *   6. JIT Stripe customer (D-049 — opprett aldri ved trial-registrering)
 *   7. Lagre `stripeCustomerId` på TenantRecord
 *   8. Opprett Stripe Checkout session (Scenario C, trial_period_days: 30)
 *   9. Returner { ok: true, url: session.url }
 *
 * Per D-049: Stripe customer opprettes JIT — aldri på trial-registrering.
 *            For betalt registrering trenger vi customer NÅ fordi
 *            Stripe Checkout krever en customer-referanse i subscription-mode.
 *
 * Node runtime (Stripe SDK krever Node).
 */
import { NextResponse } from "next/server";
import { isSubdomainAvailable } from "@/lib/platform/subdomain";
import { createTenant, getTenant, putTenant } from "@/lib/platform/tenant-store";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_REGISTER,
} from "@/lib/platform/rate-limit";
import { verifyTurnstileToken } from "@/lib/platform/turnstile";
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
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 minutter (per v4.3-SPEC)

interface RegisterPaidRequestBody {
  subdomain?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  plan?: PaidPlan;
  lifecycleEmails?: boolean;
  locale?: "no" | "sv" | "da" | "en";
  turnstileToken?: string;
}

interface RegisterPaidErrorResponse {
  ok: false;
  error:
    | "rate_limited"
    | "invalid_json"
    | "missing_email"
    | "invalid_email"
    | "missing_subdomain"
    | "invalid_subdomain"
    | "reserved_subdomain"
    | "subdomain_taken"
    | "missing_locale"
    | "invalid_locale"
    | "missing_plan"
    | "invalid_plan"
    | "missing_turnstile"
    | "turnstile_failed"
    | "stripe_error"
    | "internal_error";
  detail?: string;
}

interface RegisterPaidSuccessResponse {
  ok: true;
  subdomain: string;
  url: string;
  sessionId: string;
}

export async function POST(req: Request) {
  // ─── 1. Rate-limit (bucket "register", delt med trial-endepunktet) ───
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_REGISTER);
  if (!rl.allowed) {
    return errorResponse(
      "rate_limited",
      `Maks ${RATE_LIMIT_REGISTER.limit} registreringer per IP per 24 timer.`,
      429,
      {
        "Retry-After": String(rl.resetSeconds),
        "X-RateLimit-Limit": String(RATE_LIMIT_REGISTER.limit),
        "X-RateLimit-Remaining": String(rl.remaining),
      },
    );
  }

  // ─── 2. Parse + valider input ────────────────────────────────────────
  let body: RegisterPaidRequestBody;
  try {
    body = (await req.json()) as RegisterPaidRequestBody;
  } catch {
    return errorResponse("invalid_json", undefined, 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email) return errorResponse("missing_email", undefined, 400);
  if (!EMAIL_RX.test(email)) {
    return errorResponse("invalid_email", undefined, 400);
  }

  const subdomain = body.subdomain?.trim().toLowerCase() ?? "";
  if (!subdomain) return errorResponse("missing_subdomain", undefined, 400);

  // Iter 19.9 Fase 2: Obligatorisk locale-valg.
  if (body.locale === undefined || body.locale === null) {
    return errorResponse("missing_locale", undefined, 400);
  }
  if (
    body.locale !== "no" &&
    body.locale !== "sv" &&
    body.locale !== "da" &&
    body.locale !== "en"
  ) {
    return errorResponse(
      "invalid_locale",
      `locale='${body.locale}' støttes ikke (kun no/sv/da/en)`,
      400,
    );
  }

  const plan = body.plan;
  if (!plan) return errorResponse("missing_plan", undefined, 400);
  if (plan !== "monthly" && plan !== "yearly") {
    return errorResponse("invalid_plan", undefined, 400);
  }

  // ─── 3. Verifiser Turnstile ──────────────────────────────────────────
  if (process.env.TURNSTILE_SECRET_KEY) {
    if (!body.turnstileToken) {
      return errorResponse("missing_turnstile", undefined, 400);
    }
    const ts = await verifyTurnstileToken(body.turnstileToken, ip);
    if (!ts.ok) {
      return errorResponse(
        "turnstile_failed",
        (ts.codes ?? []).join(", ") || undefined,
        400,
      );
    }
  }

  // ─── 4. Valider subdomain ────────────────────────────────────────────
  let availability;
  try {
    availability = await isSubdomainAvailable(subdomain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[register/paid] isSubdomainAvailable failed:", err);
    return errorResponse("internal_error", msg, 500);
  }
  if (!availability.available) {
    if (availability.reason === "invalid_format") {
      return errorResponse("invalid_subdomain", undefined, 400);
    }
    if (availability.reason === "reserved") {
      return errorResponse("reserved_subdomain", undefined, 400);
    }
    if (availability.reason === "taken") {
      return errorResponse("subdomain_taken", undefined, 409);
    }
  }

  // ─── 5. Reserver subdomain (status="pending", expiresAt=+30min) ──────
  const input: CreateTenantInput = {
    subdomain,
    email,
    customerType: "b2c",
    firstName: body.firstName?.trim() || undefined,
    lastName: body.lastName?.trim() || undefined,
    plan,
    status: "pending",
    lifecycleEmails: body.lifecycleEmails ?? true,
    locale: body.locale,
  };

  let stripeCustomerId: string | null = null;
  let stripeSessionUrl: string | null = null;
  let stripeSessionId: string | null = null;

  try {
    const record = await createTenant(input, "self");

    // Sett pendingExpiresAt eksplisitt (createTenant defaulter til null).
    const pendingExpiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    await putTenant({ ...record, pendingExpiresAt });

    // ─── 6. JIT Stripe customer (D-049) ────────────────────────────────
    try {
      const customer = await createCustomerJIT({
        subdomain: record.subdomain,
        email: record.email,
        firstName: record.firstName ?? undefined,
        lastName: record.lastName ?? undefined,
        tenantCreatedAt: record.createdAt,
        // D-112: tax_id_data auto-utledet hvis NO/DK/SE + gyldig orgnr
        companyCountry: record.companyCountry,
        orgNumber: record.orgNumber,
      });
      stripeCustomerId = customer.id;
    } catch (stripeErr) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "unknown stripe error";
      console.error("[register/paid] createCustomerJIT failed:", stripeErr);
      return errorResponse("stripe_error", `customer: ${msg}`, 502);
    }

    // ─── 7. Lagre stripeCustomerId ─────────────────────────────────────
    const t1 = await getTenant(record.subdomain);
    if (t1) {
      await putTenant({ ...t1, stripeCustomerId });
    }

    // ─── 8. Opprett Checkout session (Scenario C — trial fra config) ──
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
        return errorResponse(
          "stripe_error",
          "checkout session uten URL",
          502,
        );
      }
      stripeSessionUrl = session.url;
      stripeSessionId = session.id;
    } catch (stripeErr) {
      const msg =
        stripeErr instanceof Error ? stripeErr.message : "unknown stripe error";
      console.error("[register/paid] createCheckoutSession failed:", stripeErr);
      return errorResponse("stripe_error", `checkout: ${msg}`, 502);
    }

    // ─── 9. Suksess ────────────────────────────────────────────────────
    const response: RegisterPaidSuccessResponse = {
      ok: true,
      subdomain: record.subdomain,
      url: stripeSessionUrl,
      sessionId: stripeSessionId,
    };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[register/paid] createTenant failed:", err);
    if (msg.includes("finnes allerede") || msg.includes("already exists")) {
      return errorResponse("subdomain_taken", msg, 409);
    }
    return errorResponse("internal_error", msg, 500);
  }
}

/**
 * Henter base-URL fra request-headers — aldri hardkodet (per platform-prinsipp).
 * Foretrekker `origin`-headeren (satt av nettleseren); faller tilbake til
 * `x-forwarded-proto`+`host` (Vercel-ingress).
 */
function getBaseUrl(req: Request): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://kodovault.no";
}

function errorResponse(
  error: RegisterPaidErrorResponse["error"],
  detail: string | undefined,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  const body: RegisterPaidErrorResponse = { ok: false, error };
  if (detail) body.detail = detail;
  return NextResponse.json(body, { status, headers });
}
