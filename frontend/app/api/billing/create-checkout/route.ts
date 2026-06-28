/**
 * Ko | Do · Vault — v4.3 Iter 12.5 — POST /api/billing/create-checkout
 *
 * Public endpoint. Brukes av:
 *   • /billing/upgrade-siden (Iter 13.7)         — trial-user konverterer
 *   • betalingsvegg (Iter 19)                    — locked tenant betaler
 *
 * Identitet: subdomain hentes fra `host`-header per D-046.
 * Eksempel: terje.kodovault.no  →  subdomain "terje".
 *
 * Body: { plan: "monthly" | "yearly" }
 *
 * Velger scenario per D-045:
 *   - Scenario A: tenant.status === "trial" && now < trialEndsAt
 *                 (trial_end pinnes til opprinnelig trialEndsAt)
 *   - Scenario B: tenant.status === "locked"
 *                 (umiddelbar fakturering)
 *   - Scenario C: tenant.status === "pending"
 *                 (NB: ny bruker som ikke gikk via /api/register/paid —
 *                  vi gir samme trial som scenario C der — lengde
 *                  bestemmes av `pricing.trialDays` i config)
 *
 * Customer opprettes JIT (D-049) hvis stripeCustomerId mangler.
 *
 * Returnerer: { ok: true, url, sessionId, scenario }
 *
 * Node runtime (Stripe SDK).
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
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateCheckoutBody {
  plan?: PaidPlan;
}

type ErrorCode =
  | "invalid_json"
  | "missing_plan"
  | "invalid_plan"
  | "missing_host"
  | "invalid_host"
  | "tenant_not_found"
  | "invalid_status"
  | "trial_data_missing"
  | "stripe_error"
  | "internal_error";

interface ErrorResponse {
  ok: false;
  error: ErrorCode;
  detail?: string;
}

interface SuccessResponse {
  ok: true;
  url: string;
  sessionId: string;
  scenario: "A" | "B" | "C";
}

export async function POST(req: Request) {
  // ─── 1. Parse body ────────────────────────────────────────────────────
  let body: CreateCheckoutBody;
  try {
    body = (await req.json()) as CreateCheckoutBody;
  } catch {
    return err("invalid_json", undefined, 400);
  }

  const plan = body.plan;
  if (!plan) return err("missing_plan", undefined, 400);
  if (plan !== "monthly" && plan !== "yearly") {
    return err("invalid_plan", undefined, 400);
  }

  // ─── 2. Subdomain — query-param FØRST, så host (D-046 + D-071) ─────
  // Tenant-deploys rewriter til admin med `?_tenant=<sub>` (D-071).
  // Vercel kan overskrive x-forwarded-host, så vi stoler ikke på den.
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("_tenant")?.toLowerCase().trim();
  let subdomain: string | null = null;
  if (tenantParam) {
    // Valider format strikt — _tenant-param er user-controllable via URL,
    // selv om det settes av server-side rewrite. Aldri stol blindt.
    if (!isValidSubdomainFormat(tenantParam)) {
      return err("invalid_host", `_tenant "${tenantParam}" har ugyldig format`, 400);
    }
    subdomain = tenantParam;
  } else {
    const host = req.headers.get("host");
    if (!host) return err("missing_host", undefined, 400);
    subdomain = subdomainFromHost(host);
    if (!subdomain) {
      return err("invalid_host", `host "${host}" ga ingen gyldig tenant-subdomain`, 400);
    }
  }

  // ─── 3. Hent tenant ───────────────────────────────────────────────────
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return err("tenant_not_found", `subdomain: ${subdomain}`, 404);
  }

  // ─── 4. Velg scenario basert på status + trialEndsAt ──────────────────
  const now = Date.now();
  // Stripe krever at `trial_end` er minst 48 timer i fremtiden. Vi legger på
  // 1t buffer for å håndtere klokke-drift mellom server og Stripe.
  // Hvis trial er innenfor dette vinduet → fall tilbake til Scenario B
  // (umiddelbar fakturering) i stedet for å feile mot Stripe. Brukeren
  // "mister" de resterende dagene, men de var uansett få og alternativet
  // er en blokkert oppgradering.
  const STRIPE_MIN_TRIAL_BUFFER_MS = 49 * 60 * 60 * 1000;
  let scenario: "A" | "B" | "C";
  if (tenant.status === "trial") {
    if (!tenant.trialEndsAt) {
      return err("trial_data_missing", "trial uten trialEndsAt", 500);
    }
    const trialEnd = new Date(tenant.trialEndsAt).getTime();
    if (Number.isNaN(trialEnd)) {
      return err("trial_data_missing", "trialEndsAt parser-feil", 500);
    }
    // - trialEnd > now + 49t → Scenario A (pin trial_end til opprinnelig dato)
    // - 0 < trialEnd ≤ now + 49t → Scenario B (Stripe-safe fallback)
    // - trialEnd ≤ now → Scenario B (utløpt, webhook ikke rukket å låse)
    scenario = trialEnd - now > STRIPE_MIN_TRIAL_BUFFER_MS ? "A" : "B";
  } else if (tenant.status === "locked") {
    scenario = "B";
  } else if (tenant.status === "pending") {
    scenario = "C";
  } else {
    // active / cancelled / deleted / provisioning_failed / invoice_failed
    // → ingen ny checkout. Disse må håndteres via Stripe Customer Portal
    //   eller admin-handling (D-045 specifiserer ikke flere scenarier).
    return err(
      "invalid_status",
      `status "${tenant.status}" støttes ikke for create-checkout`,
      409,
    );
  }

  // ─── 5. JIT Stripe customer (D-049) ──────────────────────────────────
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
      // Persistér customer-ID med en gang så vi ikke leak-er flere
      // customers ved evt. retry. Re-fetch + write (race-trygt mot
      // webhook som kan skrive samtidig).
      const fresh = (await getTenant(subdomain)) ?? tenant;
      await putTenant({ ...fresh, stripeCustomerId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      console.error("[create-checkout] createCustomerJIT failed:", e);
      return err("stripe_error", `customer: ${msg}`, 502);
    }
  }

  // ─── 6. Bygg checkout-session basert på scenario ─────────────────────
  // baseUrl varierer med scenario:
  //   - A/B: tenant er allerede deployet og kallet kommer fra <sub>.kodovault.no
  //          → cancel_url skal tilbake til tenant /billing/upgrade.
  //   - C:   tenant er fortsatt pending (Vercel ikke ennå provisjonert) og
  //          kallet kommer fra admin.kodovault.no/platform/register. cancel_url
  //          MÅ tilbake til admin — /platform/register finnes ikke på tenant-
  //          domenet. I tillegg sikrer dette at idempotencyKey-en matcher den
  //          som /api/register/paid satte (samme baseUrl → samme params).
  const requestOrigin = getRequestOrigin(req);
  const baseUrl =
    scenario === "C"
      ? requestOrigin
      : `https://${tenant.subdomain}.kodovault.no`;
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
      return err("stripe_error", "checkout session uten URL", 502);
    }
    const response: SuccessResponse = {
      ok: true,
      url: session.url,
      sessionId: session.id,
      scenario,
    };
    return NextResponse.json(response, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("[create-checkout] createCheckoutSession failed:", e);
    return err("stripe_error", `checkout: ${msg}`, 502);
  }
}

/**
 * Trekker subdomain ut av host-header.
 *
 * Aksepterer:
 *   - terje.kodovault.no        →  "terje"
 *   - terje.kodovault.no:443    →  "terje"
 *   - terje.preview.emergentagent.com  →  "terje"  (kun for dev)
 *
 * Avviser admin/root og localhost.
 */
function subdomainFromHost(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;
  if (hostname === "localhost" || hostname === "127.0.0.1") return null;

  // Match xxx.kodovault.no (eller .preview.emergentagent.com for dev).
  // Tar første label som subdomain.
  const parts = hostname.split(".");
  if (parts.length < 2) return null;
  const sub = parts[0];
  if (!sub) return null;
  // Avvis admin/root/www/api.
  if (sub === "admin" || sub === "www" || sub === "api") return null;
  if (sub === "kodovault") return null; // bare-domenet kodovault.no
  return sub;
}

function err(
  error: ErrorCode,
  detail: string | undefined,
  status: number,
): NextResponse {
  const body: ErrorResponse = { ok: false, error };
  if (detail) body.detail = detail;
  return NextResponse.json(body, { status });
}

/**
 * Henter base-URL fra request-headers — samme logikk som `/api/register/paid`
 * for å garantere identiske Stripe-params ved samme idempotencyKey i
 * Scenario C (resume av pending tenant).
 */
function getRequestOrigin(req: Request): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://kodovault.no";
}
