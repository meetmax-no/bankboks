/**
 * Ko | Do · Vault — Iter 20.4 (2026-06-26) — B2B fakturerings-fase-beregning
 *
 * Pure-logic modul som tar `tenant + now` og returnerer hvilken fakturerings-
 * fase parent-tenanten er i. Ingen side-effekter, deterministisk, lett å teste.
 *
 * Brukes av:
 *   - `/api/tenant/status` (legger på parent-info for B2B children)
 *   - `/api/am-admin/auth/me` (gir am-admin-UI nok info til å rendre banner)
 *   - `lib/platform/lifecycle-cron.ts` (avgjør B2B_GRACE_LOCK-action)
 *   - `/api/am-admin/invites` POST (blokkerer ny invitasjon i grace)
 *
 * Spec-grunnlag (Mike 2026-06-26, blokker-svar):
 *   1=A: parent får status="trial" + trialEndsAt=+45d ved admin-create (B2B)
 *   2=A: Mike lager faktura manuelt i Stripe — vi reagerer kun på webhook
 *   3=C: Stripe er sannhet, vi cacher `nextBillingDate` i DB for cron-effekt
 *   4=B: blokker "+ Ny invitasjon" i grace, men eksisterende ansatte fungerer
 *   5=A: 2 nye Stripe Price IDs som env-vars (semiannual 522 kr, yearly 1 044 kr per seat)
 *
 * Faser:
 *   - "n/a"         — ikke et B2B-parent, eller har ikke kjørt faktura ennå
 *   - "trial"       — status="trial" (45-dagers gratis prøve)
 *   - "active"      — status="active" + neste faktura mer enn 7 dager unna
 *   - "pre_expiry"  — status="active" + 0–7 dager til neste faktura (amber banner)
 *   - "grace"       — status="active" + neste faktura passert, < 7 dager
 *   - "expired"     — neste faktura + 7d passert (skal låses av cron)
 *   - "locked"      — status="locked" (cron har låst, child-tenants cascade-låst)
 */
import type { TenantRecord } from "./tenant-types";

/** 7 dager grace-periode fra `nextBillingDate` til hard lock. */
export const B2B_GRACE_DAYS = 7;

/** 7 dager pre-utløp-varsel før `nextBillingDate`. */
export const B2B_PRE_EXPIRY_WARN_DAYS = 7;

/** Antall ms per dag (UTC). */
const MS_PER_DAY = 86_400_000;

export type B2BBillingPhase =
  | "n/a"
  | "trial"
  | "active"
  | "pre_expiry"
  | "grace"
  | "expired"
  | "locked";

export type B2BBillingState = {
  phase: B2BBillingPhase;
  /** Dager igjen til neste fakturering (positive). Kun satt i "active"/"pre_expiry". */
  daysUntilNextBilling: number | null;
  /** Dager igjen av grace-perioden (positive). Kun satt i "grace". */
  daysUntilLock: number | null;
  /** Dager igjen av trial (positive). Kun satt i "trial". */
  daysUntilTrialEnd: number | null;
  /** Beregnet timestamp: nextBillingDate + B2B_GRACE_DAYS. Null hvis ikke beregnbart. */
  graceEndsAt: string | null;
};

/**
 * Beregn antall hele dager mellom to datoer (UTC-midnatt). Negative tall hvis
 * `to` er før `from`. Bruker UTC for å unngå sommer/vinter-drift.
 */
function daysBetween(from: Date, to: Date): number {
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

/**
 * Avgjør B2B-fakturerings-fase for én tenant. Pure — kalles fra cron,
 * webhooks og API-ruter likt.
 *
 * NB: Funksjonen er ren — den endrer ikke tenant. Selve mutasjonene gjøres
 * i kallsiden (cron-route eller webhook-handler).
 */
export function computeB2BBillingState(
  tenant: TenantRecord,
  now: Date,
): B2BBillingState {
  // Kun B2B parent-tenants er relevante. Children og B2C får "n/a".
  // Child er kjent fra parentTenant !== null.
  if (tenant.customerType !== "b2b" || tenant.parentTenant !== null) {
    return makeState("n/a");
  }

  // Trial-fase: status="trial" + trialEndsAt satt
  if (tenant.status === "trial" && tenant.trialEndsAt) {
    const trialEnd = new Date(tenant.trialEndsAt);
    const daysLeft = daysBetween(now, trialEnd);
    if (daysLeft >= 0) {
      return makeState("trial", { daysUntilTrialEnd: daysLeft });
    }
    // Trial utløpt men status ikke flippet ennå — cron fikser snart.
    // Returner "trial" med 0 dager — UI viser "utløper i dag".
    return makeState("trial", { daysUntilTrialEnd: 0 });
  }

  // Allerede låst (cron har gjort jobben sin)
  if (tenant.status === "locked") {
    return makeState("locked");
  }

  // Aktiv: trenger nextBillingDate for å avgjøre under-fase
  if (tenant.status === "active") {
    if (!tenant.nextBillingDate) {
      // Aktiv uten kjent neste-faktura (Stripe har ikke sendt invoice.paid
      // ennå) — vis som "active" uten dato.
      return makeState("active");
    }
    const billingDate = new Date(tenant.nextBillingDate);
    const graceEndDate = new Date(billingDate.getTime() + B2B_GRACE_DAYS * MS_PER_DAY);
    const graceEndsAt = graceEndDate.toISOString();

    // Etter grace utløp — skal låses av cron (men er ikke ennå)
    if (now >= graceEndDate) {
      return makeState("expired", { graceEndsAt });
    }

    // I grace — neste faktura passert, men ikke nok til lock
    if (now >= billingDate) {
      const daysUntilLock = daysBetween(now, graceEndDate);
      return makeState("grace", { daysUntilLock, graceEndsAt });
    }

    // Pre-utløp: 7 dager eller mindre til neste faktura
    const daysUntilNextBilling = daysBetween(now, billingDate);
    if (daysUntilNextBilling <= B2B_PRE_EXPIRY_WARN_DAYS) {
      return makeState("pre_expiry", { daysUntilNextBilling, graceEndsAt });
    }

    return makeState("active", { daysUntilNextBilling, graceEndsAt });
  }

  // Andre statuser (suspended, cancelled, deleted, pending, ...) —
  // ikke i scope for B2B-billing-logikk. Returner "n/a" så UI ignorerer.
  return makeState("n/a");
}

function makeState(
  phase: B2BBillingPhase,
  overrides: Partial<Omit<B2BBillingState, "phase">> = {},
): B2BBillingState {
  return {
    phase,
    daysUntilNextBilling: null,
    daysUntilLock: null,
    daysUntilTrialEnd: null,
    graceEndsAt: null,
    ...overrides,
  };
}

/**
 * True hvis am-admin skal blokkeres fra å opprette nye invitasjoner.
 * Per blokker-svar 4=B: grace + expired = blokkert. trial/active/pre_expiry
 * tillates fortsatt (de er over-7-dager-fra-utløp eller har lisens).
 */
export function shouldBlockNewInvites(state: B2BBillingState): boolean {
  return state.phase === "grace" || state.phase === "expired";
}

/**
 * True hvis ansatte skal se diskret toast ved innlogging.
 * Per spec: kun grace-fasen, ikke pre_expiry (ansatte skal ikke skremmes
 * unødig av at faktura nærmer seg).
 */
export function shouldShowEmployeeGraceToast(state: B2BBillingState): boolean {
  return state.phase === "grace" || state.phase === "expired";
}
