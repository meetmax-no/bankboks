/**
 * Ko | Do · Vault — v4.3 Iter 13.5 — GET /api/billing/checkout-info
 *
 * Public endpoint. Brukes av:
 *   • /billing/upgrade-siden (Iter 13.7)         — upgrade-banner viser daysRemaining
 *   • /platform/register-banner (Iter 14.7)      — sjekk om pending fortsatt er gyldig
 *   • In-vault upgrade-banner (Iter 18.5)        — daysRemaining ≤ 5 → vis amber banner
 *   • Betalingsvegg (Iter 19)                    — Skjerm 7-info
 *
 * Identitet: subdomain hentes fra `host`-header per D-046.
 * Ingen auth — kun subdomain-basert (informasjonen er ikke sensitiv;
 * status/daysRemaining gir ikke tilgang til vault-data).
 *
 * Suksess (200):
 *   { ok: true, status, trialEndsAt, daysRemaining, hasStripeCustomer, plan }
 *
 * Feil-responser:
 *   400 missing_host         — ingen host-header
 *   400 invalid_host         — admin/root/www/api/localhost/kodovault.no
 *   404 tenant_not_found     — subdomain finnes ikke i Upstash
 *   400 invalid_status       — tenant er ikke "trial" eller "locked"
 *
 * Node runtime (Upstash SDK).
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { getLifecycle, getPricing } from "@/lib/platform/client-config-store";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import type { TenantStatus } from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorCode =
  | "missing_host"
  | "invalid_host"
  | "tenant_not_found"
  | "invalid_status";

interface SuccessResponse {
  ok: true;
  status: Extract<TenantStatus, "trial" | "locked" | "active" | "cancelled">;
  trialEndsAt: string | null;
  daysRemaining: number;
  hasStripeCustomer: boolean;
  plan: string;
  pricing: {
    monthly: number;
    yearly: number;
    currency: string;
  };
  /**
   * D-075 + D-076 (2026-06-13). Kun satt når status === "locked".
   * Brukes av paywall-overlayet (Iter 19) til å vise når data blir slettet.
   */
  lockedAt: string | null;
  deletionScheduledAt: string | null;
  /**
   * Iter 19.6 (2026-06-13). true når bruker har bedt om kansellering ved
   * periodens slutt i Stripe Customer Portal. Abonnementet er fortsatt
   * aktivt frem til `cancelEffectiveAt`. Brukes av Settings-UI til å
   * vise "Aktiv frem til <dato>" i stedet for bare "Aktiv".
   */
  cancelAtPeriodEnd: boolean;
  cancelEffectiveAt: string | null;
}

interface ErrorResponse {
  ok: false;
  error: ErrorCode;
  detail?: string;
}

export async function GET(req: Request) {
  // ─── 1. Subdomain — query-param FØRST, så host (D-046 + D-071) ─────
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

  // ─── 2. Hent tenant ───────────────────────────────────────────────────
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return err("tenant_not_found", `subdomain: ${subdomain}`, 404);
  }

  // ─── 3. Valider status — alle "ekte" lifecycle-statuser tillatt ──────
  // Iter 19.5: utvidet fra kun trial/locked til også active/cancelled så
  // Settings → "Administrer abonnement" kan rute basert på status uten
  // ekstra endepunkt. Pending/deleted/provisioning_failed/invoice_failed
  // avvises fortsatt — de er ikke vault-tilstander.
  if (
    tenant.status !== "trial" &&
    tenant.status !== "locked" &&
    tenant.status !== "active" &&
    tenant.status !== "cancelled"
  ) {
    return err(
      "invalid_status",
      `status "${tenant.status}" støttes ikke (kun trial/locked/active/cancelled)`,
      400,
    );
  }

  // ─── 4. Beregn daysRemaining + hent pricing ──────────────────────────
  // Hvis trialEndsAt ikke er satt (skal ikke skje for trial-status, men
  // locked-tenants kan teoretisk mangle det etter manuell admin-handling)
  // → returner 0 dager.
  const daysRemaining = computeDaysRemaining(tenant.trialEndsAt);
  const pricing = await getPricing(subdomain);

  // ─── 5. Retention-dato for locked-tenants (D-075 + Iter 19) ─────────
  // Beregnes server-side så frontend slipper å vite om lifecycle-config.
  let deletionScheduledAt: string | null = null;
  if (tenant.status === "locked" && tenant.lockedAt) {
    const lifecycle = await getLifecycle(subdomain);
    const lockedAtMs = new Date(tenant.lockedAt).getTime();
    if (!Number.isNaN(lockedAtMs)) {
      const deletionMs =
        lockedAtMs + lifecycle.lockToDeleteDays * 24 * 60 * 60 * 1000;
      deletionScheduledAt = new Date(deletionMs).toISOString();
    }
  }

  const response: SuccessResponse = {
    ok: true,
    status: tenant.status,
    trialEndsAt: tenant.trialEndsAt ?? null,
    daysRemaining,
    hasStripeCustomer: Boolean(tenant.stripeCustomerId),
    plan: tenant.plan,
    pricing: {
      monthly: pricing.monthly,
      yearly: pricing.yearly,
      currency: pricing.currency,
    },
    lockedAt: tenant.lockedAt ?? null,
    deletionScheduledAt,
    cancelAtPeriodEnd: tenant.cancelAtPeriodEnd === true,
    cancelEffectiveAt: tenant.cancelEffectiveAt ?? null,
  };
  return NextResponse.json(response, { status: 200 });
}

/**
 * Trekker subdomain ut av host-header. Avviser admin/root/www/api.
 *
 * Eksempler:
 *   terje.kodovault.no       → "terje"
 *   terje.kodovault.no:443   → "terje"
 *   admin.kodovault.no       → null
 *   kodovault.no             → null  (root)
 *   localhost                → null
 *
 * Identisk logikk som i `/api/billing/create-checkout`. Duplisert med
 * vilje — to call sites er ikke nok til å rettferdiggjøre abstraksjon.
 * Hvis en tredje route trenger samme logikk, flytt til en shared helper.
 */
function subdomainFromHost(host: string): string | null {
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;
  if (hostname === "localhost" || hostname === "127.0.0.1") return null;
  const parts = hostname.split(".");
  if (parts.length < 2) return null;
  const sub = parts[0];
  if (!sub) return null;
  if (sub === "admin" || sub === "www" || sub === "api") return null;
  if (sub === "kodovault") return null;
  return sub;
}

/**
 * Beregner antall hele dager frem til `trialEndsAt`. Returnerer 0 hvis
 * datoen er passert eller ikke satt. Aldri negativ.
 */
function computeDaysRemaining(trialEndsAt: string | null | undefined): number {
  if (!trialEndsAt) return 0;
  const end = new Date(trialEndsAt).getTime();
  if (Number.isNaN(end)) return 0;
  const diff = end - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function err(error: ErrorCode, detail: string | undefined, status: number): NextResponse {
  const body: ErrorResponse = { ok: false, error };
  if (detail) body.detail = detail;
  return NextResponse.json(body, { status });
}
