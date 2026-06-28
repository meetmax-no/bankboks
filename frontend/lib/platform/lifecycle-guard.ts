/**
 * Ko | Do · Vault — v4.3 D-069 (2026-06-04) — Lifecycle Guard
 *
 * Sentral autoritativ regel for hva automatiske livssyklus-mekanismer
 * (cron-jobber, webhooks, Stripe-events) får lov til å gjøre med en
 * tenant. Mike kan ALLTID overstyre manuelt fra admin-UI — guarden
 * gjelder kun automatisk endring av status/sletting.
 *
 * **Hovedregel:** plan === "free" → ALDRI auto-lock, ALDRI auto-cancel,
 * ALDRI auto-delete. Free-kontoer er evigvarende testkontoer/venner-kontoer
 * som kun Mike kan endre status på manuelt.
 *
 * Bruk:
 *   - Trial-cron (Iter 13+): `if (!canAutoLock(tenant)) continue;`
 *   - Stripe webhook payment_failed: samme sjekk
 *   - GDPR delete-cron: `if (!canAutoDelete(tenant)) continue;`
 *
 * Returnerer `{ allowed: false, reason: "..." }` slik at caller kan
 * logge avvisningen til provisioningLog hvis ønskelig.
 */
import type { TenantRecord } from "./tenant-types";

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Returnerer false hvis automatisk lock IKKE er tillatt.
 * Per D-069: plan="free" er beskyttet mot all auto-lock.
 */
export function canAutoLock(tenant: TenantRecord): GuardDecision {
  if (tenant.plan === "free") {
    return {
      allowed: false,
      reason: "free-plan er evigvarende — auto-lock blokkert (D-069)",
    };
  }
  return { allowed: true };
}

/**
 * Returnerer false hvis automatisk cancel IKKE er tillatt.
 */
export function canAutoCancel(tenant: TenantRecord): GuardDecision {
  if (tenant.plan === "free") {
    return {
      allowed: false,
      reason: "free-plan er evigvarende — auto-cancel blokkert (D-069)",
    };
  }
  return { allowed: true };
}

/**
 * Returnerer false hvis automatisk delete IKKE er tillatt.
 * Free-plans + tenants opprettet av admin er ALDRI auto-slettet.
 */
export function canAutoDelete(tenant: TenantRecord): GuardDecision {
  if (tenant.plan === "free") {
    return {
      allowed: false,
      reason: "free-plan er evigvarende — auto-delete blokkert (D-069)",
    };
  }
  if (tenant.createdBy === "admin") {
    return {
      allowed: false,
      reason:
        "admin-opprettet tenant er beskyttet mot auto-delete — krever manuell sletting (D-069)",
    };
  }
  return { allowed: true };
}

/**
 * Predicate-versjoner for filter-bruk i cron-løkker:
 *   const candidates = tenants.filter(isAutoLockable);
 */
export const isAutoLockable = (t: TenantRecord): boolean =>
  canAutoLock(t).allowed;
export const isAutoCancellable = (t: TenantRecord): boolean =>
  canAutoCancel(t).allowed;
export const isAutoDeletable = (t: TenantRecord): boolean =>
  canAutoDelete(t).allowed;
