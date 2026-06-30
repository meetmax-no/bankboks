"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-087, 2026-06-27) — Konsoll Fakturering-fane
 * D-141 (2026-02): utvidet med fakturahistorikk-kort (gjenbruker InvoiceHistoryCard).
 *
 * Plan, neste fornyelse, lisens-bruk + fakturahistorikk for org-en.
 * Synlig for alle admin-roller — ingen PII per ansatt, kun org-aggregat.
 */
import { useLocale } from "@/lib/i18n-context";
import { formatShortDate } from "@/lib/format-date";
import { SeatProgressBar } from "../SeatProgressBar";
import { InvoiceHistoryCard } from "@/components/platform/InvoiceHistoryCard";

type Props = {
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  maxLicenses: number | null;
  activeLicenses: number | null;
  pendingLicenses: number | null;
  plan: string;
  /**
   * D-141 (2026-02): stripeCustomerId fra parent-tenant. Brukes for å
   * vise fakturahistorikk-kortet. Hvis null/undefined viser kortet en
   * "ingen Stripe-customer registrert"-melding.
   */
  stripeCustomerId?: string | null;
};

export function KonsollBillingTab(props: Props) {
  const { t, locale } = useLocale();

  return (
    <div className="space-y-5">
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-billing-section"
      >
        <SectionTitle>{t("am_admin_account.billing_heading")}</SectionTitle>
        <p className="text-[11px] text-white/45 mt-1 mb-4">
          {t("am_admin_settings.billing_section_help")}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm items-start">
          <Field
            label={t("am_admin_account.plan_label")}
            value={props.plan}
            mono
          />
          <Field
            label={t("am_admin_account.next_billing_label")}
            value={
              props.nextBillingDate
                ? formatShortDate(props.nextBillingDate, locale)
                : props.trialEndsAt
                  ? `${t("am_admin_account.trial_until")} ${formatShortDate(
                      props.trialEndsAt,
                      locale,
                    )}`
                  : "—"
            }
            mono
          />
          {/* D-105 (2026-06-28): bruker felles <SeatProgressBar> i stedet
              for inline tekst-teller. Aktive + pending / max med progress-
              bar og fargekodede labels. */}
          <div>
            <dt className="text-white/45 text-[10px] uppercase tracking-wide mb-1">
              {t("am_admin_account.seats_label")}
            </dt>
            <SeatProgressBar
              activeSeats={props.activeLicenses ?? 0}
              pendingSeats={props.pendingLicenses ?? 0}
              maxSeats={props.maxLicenses}
              compact
            />
          </div>
        </dl>
      </section>

      {/* D-141 (2026-02): per-org fakturahistorikk — gjenbruker
          InvoiceHistoryCard via am-admin-endpoint. Vises kun hvis
          stripeCustomerId er satt på parent-tenant. */}
      <InvoiceHistoryCard
        endpoint="/api/am-admin/invoices"
        stripeCustomerId={props.stripeCustomerId ?? null}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.12em]">
      {children}
    </h3>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-white/45 text-[10px] uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className={`text-white/85 text-sm ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
