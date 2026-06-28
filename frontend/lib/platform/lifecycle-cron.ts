/**
 * Ko | Do · Vault — v4.3 Iter 17 (2026-06-13) — Lifecycle Sweep (Cron)
 *
 * Ren logikk-modul for daglig lifecycle-sweep. Eksponerer pure functions
 * som tar `tenant + now` og returnerer planlagte handlinger. Selve
 * I/O (lese tenants, skrive status, sende mail, slette) gjøres i
 * `/api/cron/lifecycle-sweep/route.ts` som kaller disse funksjonene.
 *
 * Designprinsipper:
 *   - PURE: ingen side-effekter, deterministisk, lett å teste
 *   - D-069: ALLE statusendringer går via `canAutoLock` / `canAutoDelete`
 *   - D-075: 28-dagers vindu fra `lockedAt` til hard delete
 *   - D-070-revisjon: hard delete kjøres via `deleteTenant()` som
 *     automatisk bevarer Stripe customer for betalte tenants
 *
 * Tidsplan (Iter 17 endelig vedtak 2026-06-13):
 *   Dag 0 (trialEndsAt passerer) → lås umiddelbart (Action.LOCK)
 *   Dag -5 før trial-utløp → A1 reminder (Action.WARN_TRIAL_T5)
 *   Dag 21 etter lock (= 7 dager før delete) → ÉN A3-varsel (Action.WARN_A3)
 *   Dag 28 etter lock → hard delete (Action.DELETE)
 *
 * Hver tenant kan kun motta ÉN A3-varsel pga `lifecycleWarningsSentAt.t7`
 * idempotensesjekk (feltnavnet beholdes som anker selv om t3/t1-variantene
 * er strøket — endring av feltnavn ville bryte eksisterende records).
 */
import type { TenantRecord } from "./tenant-types";
import { canAutoLock, canAutoDelete } from "./lifecycle-guard";
import { computeB2BBillingState } from "./b2b-billing";

export type LifecycleAction =
  | { type: "LOCK"; reason: string; fromCancel: boolean }
  | { type: "WARN_TRIAL_T5"; daysUntilTrialEnd: number }
  | { type: "WARN_A3"; daysUntilDelete: number }
  | { type: "DELETE"; lockedDays: number }
  | {
      type: "B2B_GRACE_LOCK";
      reason: string;
      /** ISO timestamp da grace-perioden utløp (= nextBillingDate + 7d). */
      graceExpiredAt: string;
    }
  | { type: "NOOP"; reason: string };

export interface SweepConfig {
  /** Hvor mange dager etter lock før hard delete. Default 28 (D-075). */
  lockToDeleteDays: number;
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  lockToDeleteDays: 28,
};

/**
 * Avgjør én handling for én tenant. Returnerer aldri to actions —
 * høyest-prioritert action vinner i denne rekkefølgen:
 *   1. DELETE (hvis dag ≥ N)
 *   2. WARN_T1 (dag N-1) > WARN_T3 (dag N-3) > WARN_T7 (dag N-7)
 *   3. LOCK (trial utløpt)
 *   4. NOOP (ingenting å gjøre)
 *
 * `now` injiseres for testbarhet.
 */
export function decideAction(
  tenant: TenantRecord,
  now: Date,
  config: SweepConfig = DEFAULT_SWEEP_CONFIG,
): LifecycleAction {
  // ─── 1. Locked-tenants: vurder varsel + sletting ──────────────────
  if (tenant.status === "locked" && tenant.lockedAt) {
    const lockedAt = new Date(tenant.lockedAt);
    const daysLocked = daysBetween(lockedAt, now);

    // Dag ≥ 28 → DELETE (D-069-guard sjekkes likevel av kallsiden)
    if (daysLocked >= config.lockToDeleteDays) {
      const guard = canAutoDelete(tenant);
      if (!guard.allowed) {
        return { type: "NOOP", reason: `auto-delete blokkert: ${guard.reason}` };
      }
      return { type: "DELETE", lockedDays: daysLocked };
    }

    // Iter 17 endelig vedtak (2026-06-13): ÉN A3-varsel, kun på dag 21
    // etter lock (T-7 = 7 dager før hard delete på dag 28). Tidligere
    // T-3/T-1-varianter er fjernet — én mail er nok for å gi bruker
    // forsvarlig varslingstid uten å spamme. Idempotensesjekk via
    // lifecycleWarningsSentAt.t7 (feltet beholdes som idempotens-anker
    // selv om vi ikke lenger har t3/t1 i logikken).
    if (daysLocked === 21 && !tenant.lifecycleWarningsSentAt?.t7) {
      return { type: "WARN_A3", daysUntilDelete: 7 };
    }

    return {
      type: "NOOP",
      reason: `locked dag ${daysLocked}/${config.lockToDeleteDays}, ingen varsel skyldes`,
    };
  }

  // ─── 2. Trial-tenants: lås umiddelbart hvis utløpt, ellers vurder T-5 ─
  if (tenant.status === "trial" && tenant.trialEndsAt) {
    const trialEndsAt = new Date(tenant.trialEndsAt);
    if (now >= trialEndsAt) {
      const guard = canAutoLock(tenant);
      if (!guard.allowed) {
        return { type: "NOOP", reason: `auto-lock blokkert: ${guard.reason}` };
      }
      return {
        type: "LOCK",
        reason: `trial utløp ${trialEndsAt.toISOString()}, ingen aktivt abonnement`,
        fromCancel: false,
      };
    }
    // Iter 17 full pakke: T-5 reminder
    const daysUntilEnd = daysBetween(now, trialEndsAt);
    if (daysUntilEnd === 5 && !tenant.trialReminderT5SentAt) {
      return { type: "WARN_TRIAL_T5", daysUntilTrialEnd: 5 };
    }
    return {
      type: "NOOP",
      reason: `trial — ${daysUntilEnd} dag(er) igjen`,
    };
  }

  // ─── 3. B2B parent: grace-lock når nextBillingDate + 7d har passert ─
  // (Iter 20.4 · 2026-06-26 · D-080) Når parent.nextBillingDate + grace
  // har passert uten ny `invoice.paid` → lås parent (cron-route gjør
  // cascade-lock av children separat).
  if (
    tenant.customerType === "b2b" &&
    tenant.parentTenant === null &&
    tenant.status === "active"
  ) {
    const billingState = computeB2BBillingState(tenant, now);
    if (billingState.phase === "expired") {
      const guard = canAutoLock(tenant);
      if (!guard.allowed) {
        return {
          type: "NOOP",
          reason: `B2B grace-lock blokkert: ${guard.reason}`,
        };
      }
      return {
        type: "B2B_GRACE_LOCK",
        reason: `B2B grace utløp: nextBillingDate=${tenant.nextBillingDate ?? "?"}, grace+7d passert`,
        graceExpiredAt: billingState.graceEndsAt ?? now.toISOString(),
      };
    }
  }

  // ─── 4. Alle andre statuser (active/cancelled/deleted/pending/etc) ─
  return { type: "NOOP", reason: `status='${tenant.status}' — sweep gjør ingenting` };
}

/**
 * Antall hele dager mellom to datoer. Bruker UTC-midnatt for å unngå
 * sommer/vinter-tidsdrift.
 */
export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86400000;
  const fromUtc = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const toUtc = Date.UTC(
    to.getUTCFullYear(),
    to.getUTCMonth(),
    to.getUTCDate(),
  );
  return Math.floor((toUtc - fromUtc) / MS_PER_DAY);
}
