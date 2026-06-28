"use client";
/**
 * Ko | Do · Vault — Iter 20.4c (2026-06-26 · D-080) + 20.4e (i18n) — BillingStatusBanner
 *
 * Rendrer faktura-banner i am-admin dashbordet basert på billing-state fra
 * `/api/am-admin/auth/me`. Fem brukervendte faser (banner skjules for active/n/a):
 *
 *   - phase="trial"       → sky-blå info-banner (dager igjen)
 *   - phase="pre_expiry"  → amber advarsel (7d eller mindre til fakturering)
 *   - phase="grace"       → rød kritisk advarsel (forfalt, X dager til lock)
 *   - phase="expired"     → rød "kontoen låses snart"
 *   - phase="locked"      → mørk grå "kontoen er låst"
 *
 * Iter 20.4e: alle strenger via t()/locale-aware formatShortDate.
 */
import { useLocale } from "@/lib/i18n-context";
import { formatShortDate } from "@/lib/format-date";
import type { B2BBillingState } from "@/lib/platform/b2b-billing";

type Props = {
  state: B2BBillingState;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
};

export function BillingStatusBanner({
  state,
  trialEndsAt,
  nextBillingDate,
}: Props) {
  const { t, locale } = useLocale();

  if (state.phase === "active" || state.phase === "n/a") {
    return null;
  }

  if (state.phase === "trial") {
    const days = state.daysUntilTrialEnd ?? 0;
    return (
      <section
        className="bg-sky-500/[0.08] border border-sky-400/30 rounded-xl p-4"
        data-testid="billing-banner"
        data-phase="trial"
        role="status"
      >
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">📅</span>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-sky-200">
              {t("am_admin_billing.trial_title")}
            </h3>
            <p className="text-xs text-sky-100/75 mt-1">
              {days > 0
                ? (days === 1
                    ? t("am_admin_billing.trial_days_singular")
                    : t("am_admin_billing.trial_days_plural")
                  ).replace("{days}", String(days))
                : t("am_admin_billing.trial_today")}
              {t("am_admin_billing.trial_expires_on_prefix")}
              <span className="font-mono">{trialEndsAt ? formatShortDate(trialEndsAt, locale) : "—"}</span>
              {t("am_admin_billing.trial_expires_on_suffix")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "pre_expiry") {
    const days = state.daysUntilNextBilling ?? 0;
    const dayWord =
      days === 1
        ? t("am_admin_billing.day_singular")
        : t("am_admin_billing.day_plural");
    return (
      <section
        className="bg-amber-500/[0.10] border border-amber-400/30 rounded-xl p-4"
        data-testid="billing-banner"
        data-phase="pre_expiry"
        role="status"
      >
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">⏳</span>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-amber-200">
              {t("am_admin_billing.pre_expiry_title")}
            </h3>
            <p className="text-xs text-amber-100/80 mt-1">
              {t("am_admin_billing.pre_expiry_body_prefix")}
              <strong className="text-amber-100">
                {days} {dayWord}
              </strong>{" "}
              ({nextBillingDate ? formatShortDate(nextBillingDate, locale) : "—"})
              {t("am_admin_billing.pre_expiry_body_suffix")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "grace") {
    const days = state.daysUntilLock ?? 0;
    const dayWord =
      days === 1
        ? t("am_admin_billing.day_singular")
        : t("am_admin_billing.day_plural");
    return (
      <section
        className="bg-rose-500/[0.12] border border-rose-400/40 rounded-xl p-4"
        data-testid="billing-banner"
        data-phase="grace"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">⚠️</span>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-rose-200">
              {t("am_admin_billing.grace_title")}
            </h3>
            <p className="text-xs text-rose-100/85 mt-1">
              {t("am_admin_billing.grace_body_prefix")}
              {nextBillingDate ? formatShortDate(nextBillingDate, locale) : "—"}
              {t("am_admin_billing.grace_body_middle")}
              <strong className="text-rose-100">
                {days} {dayWord}
              </strong>
              {t("am_admin_billing.grace_body_suffix")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "expired") {
    return (
      <section
        className="bg-rose-500/[0.15] border border-rose-400/50 rounded-xl p-4"
        data-testid="billing-banner"
        data-phase="expired"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-start gap-3">
          <span className="text-xl" aria-hidden="true">🔒</span>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-rose-100">
              {t("am_admin_billing.expired_title")}
            </h3>
            <p className="text-xs text-rose-100/85 mt-1">
              {t("am_admin_billing.expired_body_prefix")}
              {nextBillingDate ? formatShortDate(nextBillingDate, locale) : "—"}
              {t("am_admin_billing.expired_body_suffix")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // phase === "locked"
  return (
    <section
      className="bg-white/[0.04] border border-white/15 rounded-xl p-4"
      data-testid="billing-banner"
      data-phase="locked"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden="true">🔒</span>
        <div className="flex-1">
          <h3 className="text-sm font-medium text-white/85">
            {t("am_admin_billing.locked_title")}
          </h3>
          <p className="text-xs text-white/65 mt-1">
            {t("am_admin_billing.locked_body_prefix")}
            <a
              href="mailto:kontakt@kodovault.no"
              className="text-sky-300 hover:underline"
            >
              kontakt@kodovault.no
            </a>
            {t("am_admin_billing.locked_body_suffix")}
          </p>
        </div>
      </div>
    </section>
  );
}
