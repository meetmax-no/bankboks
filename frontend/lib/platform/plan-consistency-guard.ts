/**
 * Ko | Do · Vault — D-130 (2026-02) — B2B/B2C plan-konsistens-vakt
 *
 * Pure helper som varsler (via `console.warn`) hvis en B2B parent-tenant
 * har en plan-verdi som hører til B2C-flyten. Skal IKKE blokkere requests
 * eller bryte betalingsflyten — kun logge så Mike kan søke i logger.
 *
 * Når trigges varselet:
 *   - tenant.customerType === "b2b"
 *   - tenant.parentTenant === null        (= parent-record, ikke child)
 *   - tenant.plan ∈ {"trial", "monthly", "yearly"}
 *
 * "trial" inkluderes (Mike-direktiv) fordi en B2B-parent som har konvertert
 * og er status=active fortsatt bør være på `b2b_*`-plan. Trial-fasen for B2B
 * er forventet, men en aktiv B2B-tenant skal aldri ha trial som plan.
 *
 * Hvem kaller:
 *   - /api/admin/tenants/[subdomain]/route.ts (PATCH)
 *   - lib/stripe/event-handlers.ts (handleSubscriptionCreated/Updated)
 *
 * Logg-format (stabilt prefix for grep/Sentry-alerts):
 *   [plan-consistency-guard] <context>: B2B parent '<subdomain>' has B2C
 *   plan='<plan>' (customerType=b2b, parentTenant=null, status=<status>)
 */
import type { TenantRecord } from "./tenant-types";

const B2C_PLAN_VALUES = ["trial", "monthly", "yearly"] as const;

export type PlanConsistencyContext =
  | "admin_patch"
  | "stripe_subscription_created"
  | "stripe_subscription_updated";

/**
 * Sjekk om tenanten matcher den uønskede tilstanden. Pure, deterministisk.
 * Eksportert for unit-test.
 */
export function isB2BWithB2CPlan(tenant: TenantRecord): boolean {
  if (tenant.customerType !== "b2b") return false;
  if (tenant.parentTenant !== null) return false;
  return (B2C_PLAN_VALUES as readonly string[]).includes(tenant.plan);
}

/**
 * Logg-only vakt. Ingen retur, ingen throw — kaller skal aldri merke at
 * sjekken kjørte (unntatt at en console.warn dukker opp i logger).
 *
 * Idempotent å kalle: trygt å kalle flere ganger pr request hvis tenant
 * lastes flere ganger (hver call gir én log-linje med kontekst).
 */
export function warnIfB2BHasB2CPlan(
  tenant: TenantRecord,
  context: PlanConsistencyContext,
): void {
  if (!isB2BWithB2CPlan(tenant)) return;
  console.warn(
    `[plan-consistency-guard] ${context}: B2B parent '${tenant.subdomain}' ` +
      `has B2C plan='${tenant.plan}' ` +
      `(customerType=${tenant.customerType}, parentTenant=null, ` +
      `status=${tenant.status}, tenantPrefix=${tenant.tenantPrefix ?? "null"})`,
  );
}
