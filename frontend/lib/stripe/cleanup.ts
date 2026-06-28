/**
 * Ko | Do · Vault — v4.3 Iter 14.5 + Iter 17 (D-070-revisjon 2026-06-13) —
 * Stripe-rydding ved tenant-sletting.
 *
 * Brukes av `deleteTenant`-kaskaden i `lib/platform/delete-tenant.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════
 * D-070 REVIDERT 2026-06-13 — Bevaringsregel for Stripe-customers
 * ═══════════════════════════════════════════════════════════════════
 *
 * Stripe customer-objektet representerer kjøperen i en transaksjon.
 * Norsk bokføringsloven krever 5 års bevaring av faktura-customer-
 * koblingen for revisjonsformål.
 *
 * Derfor: `stripe.customers.del()` kalles KUN for tenants som ALDRI har
 * hatt en betalt transaksjon (ren trial som ikke konverterte, eller
 * pending/orphan-cleanup fra Iter 14.8-B). Betalte tenants får sitt
 * customer-objekt BEVART i Stripe — TenantRecord slettes hos oss, men
 * customer lever videre frikoblet med `metadata.subdomain` som ghost-
 * referanse (fortsatt søkbart i Stripe Dashboard for revisjon).
 *
 * Markører for "har betalt" (OR-relasjon):
 *   1. PRIMÆR  — `tenant.stripeSubscriptionId !== null`
 *      Autoritativt felt satt av webhook `customer.subscription.created`
 *      (Iter 13). Brukes også av D-076 write-block. Nulles aldri.
 *   2. DEFENSIV — provisioningLog inneholder `status_change`-event med
 *      detail som starter med `"invoice.paid"`. Fanger edge cases der
 *      stripeSubscriptionId av en eller annen grunn er borte (manuell
 *      admin-override, fremtidig migrasjon).
 *
 * Status-verdier som returneres:
 *   - `"ok"`         — customer faktisk slettet hos Stripe
 *   - `"preserved"`  — customer bevart fordi tenant har betalt (D-070)
 *   - `"skipped"`    — ingen stripeCustomerId å forholde seg til
 *   - `"failed"`     — Stripe API-feil (ikke 404 — det er idempotent OK)
 *
 * `"preserved"` skiller seg fra `"skipped"`: førstnevnte er en AKTIV,
 * bevisst beslutning loggført for revisjon; sistnevnte betyr "ingenting
 * å gjøre fra start av".
 *
 * Node runtime.
 */
import type Stripe from "stripe";
import { getStripeClient } from "./client";
import type { TenantRecord } from "@/lib/platform/tenant-types";

export type StripeCleanupStatus = "ok" | "failed" | "skipped" | "preserved";

export interface StripeCleanupResult {
  status: StripeCleanupStatus;
  detail?: string;
}

/**
 * Avgjør om en tenant har hatt minst én betalt transaksjon hos Stripe.
 * Brukes til å beslutte om customer-objektet skal bevares (D-070).
 *
 * Eksportert for testbarhet og for at admin-UI kan vise samme beslutning
 * (badge / advarsel "vil bevares" i delete-confirm-dialogen).
 */
export function tenantHasPaidHistory(
  tenant: Pick<TenantRecord, "stripeSubscriptionId" | "provisioningLog">,
): boolean {
  if (tenant.stripeSubscriptionId !== null) return true;
  // Defensiv: skann logg for invoice.paid-events. Detail-feltet er fri
  // tekst i `status_change`-stage'en, så vi sjekker prefiks.
  return (tenant.provisioningLog ?? []).some(
    (e) =>
      e.stage === "status_change" &&
      typeof e.detail === "string" &&
      e.detail.startsWith("invoice.paid"),
  );
}

/**
 * Slett Stripe customer hvis tenant aldri har betalt — ellers bevar.
 *
 * @param customerId  — Stripe customer-ID (eller null hvis ingen customer
 *                      er JIT-opprettet ennå → returnerer "skipped").
 * @param options     — bevaringsbeslutning. `hasPaidHistory: true` =>
 *                      ikke kall del(), returner "preserved".
 * @param stripeClient — optional for testbarhet (DI-mønster).
 */
export async function deleteStripeCustomer(
  customerId: string | null,
  options: { hasPaidHistory: boolean },
  stripeClient?: Pick<Stripe, "customers">,
): Promise<StripeCleanupResult> {
  if (!customerId) {
    return { status: "skipped", detail: "ingen stripeCustomerId" };
  }

  // D-070 (revidert 2026-06-13): bevar customer for betalte tenants
  if (options.hasPaidHistory) {
    return {
      status: "preserved",
      detail:
        "betalt tenant — customer beholdes for revisjonsspor (bokføringsloven, 5 år)",
    };
  }

  try {
    const stripe = stripeClient ?? getStripeClient();
    await stripe.customers.del(customerId);
    return { status: "ok" };
  } catch (err) {
    // Stripe SDK kaster `Stripe.errors.StripeError` med .code/.statusCode.
    // 404 (allerede slettet) → idempotent OK.
    const stripeErr = err as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    if (stripeErr.statusCode === 404 || stripeErr.code === "resource_missing") {
      return { status: "ok", detail: "allerede slettet (404)" };
    }
    const msg = stripeErr.message ?? String(err);
    console.error("[deleteStripeCustomer] failed:", msg);
    return { status: "failed", detail: msg };
  }
}
