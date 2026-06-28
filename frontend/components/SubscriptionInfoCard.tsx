"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 19.7 — SubscriptionInfoCard
 *
 * Vises i SettingsPanel når tenant har et Stripe-abonnement. Henter LIVE
 * data fra Stripe via `/api/billing/subscription` første gang panelet
 * åpnes — gir bruker sannferdig info uten å vente på webhook-sync.
 *
 * Innhold:
 *   - Plan-navn + pris/intervall
 *   - Status-badge (Aktiv / Trial / Forfalt / Kansellert ved periodens slutt)
 *   - Neste betaling (current_period_end) — eller "Kanselleres <dato>"
 *   - Betalingsmetode (kort-merke + last4) hvis kjent
 *
 * Tilstander:
 *   - loading: skeleton-card
 *   - empty (no_subscription): vis ingenting (caller skjuler komponenten)
 *   - error: diskret feilmelding + retry-knapp
 */
import { useEffect, useState, type ReactNode } from "react";
import { CreditCard, Calendar, AlertCircle, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { formatLongDate } from "@/lib/format-date";

type StripeStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused"
  | "no_subscription";

interface SubscriptionInfo {
  ok: true;
  stripeStatus: StripeStatus;
  plan: "trial" | "monthly" | "yearly" | "free" | null;
  amount: number | null;
  currency: string | null;
  interval: "month" | "year" | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelEffectiveAt: string | null;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
}

interface Props {
  /** Åpnings-state fra SettingsPanel — vi fetcher kun når åpen. */
  open: boolean;
}

export function SubscriptionInfoCard({ open }: Props) {
  const { t, locale } = useLocale();
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/billing/subscription");
        if (aborted) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        const data = (await res.json()) as SubscriptionInfo;
        if (!aborted) {
          setInfo(data);
          setLoading(false);
        }
      } catch (e) {
        if (!aborted) {
          setError(e instanceof Error ? e.message : "network");
          setLoading(false);
        }
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open, reloadTick]);

  // Skjul helt hvis ingen abo finnes — caller bestemmer da om "Administrer
  // abonnement"-knappen skal vises (typisk: trial/pending uten Stripe).
  if (!loading && !error && info?.stripeStatus === "no_subscription") {
    return null;
  }

  if (loading) {
    return (
      <div
        data-testid="subscription-info-loading"
        className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/5 border border-white/10"
      >
        <Loader2 className="h-4 w-4 text-white/50 animate-spin" />
        <span className="text-sm text-white/55">
          {t("settings.subscription_info_loading")}
        </span>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div
        data-testid="subscription-info-error"
        className="flex items-center gap-3 px-3 py-3 rounded-xl bg-rose-500/5 border border-rose-400/20"
      >
        <AlertCircle className="h-4 w-4 text-rose-300 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-rose-200">
            {t("settings.subscription_info_error")}
          </div>
          {error && (
            <div className="text-[10px] text-rose-300/70 mt-0.5 font-mono">
              {error}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          className="text-[11px] text-rose-200 hover:text-rose-100 underline"
        >
          {t("settings.subscription_info_retry")}
        </button>
      </div>
    );
  }

  // Bygg pris-string: "199 NOK / md" eller "1990 NOK / år"
  const priceStr =
    info.amount !== null && info.currency && info.interval
      ? `${formatAmount(info.amount, info.currency)} ${info.currency} / ${
          info.interval === "month"
            ? t("settings.subscription_info_per_month")
            : t("settings.subscription_info_per_year")
        }`
      : null;

  const planName =
    info.plan === "monthly"
      ? t("settings.subscription_info_plan_monthly")
      : info.plan === "yearly"
        ? t("settings.subscription_info_plan_yearly")
        : info.plan === "trial"
          ? t("settings.subscription_info_plan_trial")
          : info.plan ?? "—";

  const nextChargeLabel = info.cancelAtPeriodEnd
    ? t("settings.subscription_info_cancels_at")
    : info.stripeStatus === "trialing" && info.trialEnd
      ? t("settings.subscription_info_trial_ends")
      : t("settings.subscription_info_next_charge");
  const nextChargeDate =
    info.cancelAtPeriodEnd && info.cancelEffectiveAt
      ? info.cancelEffectiveAt
      : info.stripeStatus === "trialing" && info.trialEnd
        ? info.trialEnd
        : info.currentPeriodEnd;

  return (
    <div
      data-testid="subscription-info-card"
      className="rounded-xl bg-white/5 border border-white/10 overflow-hidden"
    >
      {/* Topp-rad: plan + status-badge */}
      <div className="flex items-start justify-between gap-3 px-3 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
            <CreditCard className="h-3.5 w-3.5 text-white/80" />
          </div>
          <div className="min-w-0">
            <div
              data-testid="subscription-info-plan"
              className="text-sm font-medium text-white truncate"
            >
              {planName}
            </div>
            {priceStr && (
              <div
                data-testid="subscription-info-price"
                className="text-[11px] text-white/55 mt-0.5"
              >
                {priceStr}
              </div>
            )}
          </div>
        </div>
        <StatusBadge status={info.stripeStatus} cancelAtPeriodEnd={info.cancelAtPeriodEnd} />
      </div>

      {/* Detaljer-grid */}
      <dl className="grid grid-cols-1 gap-0 divide-y divide-white/5">
        {nextChargeDate && (
          <DetailRow
            testId="subscription-info-next-charge"
            icon={<Calendar className="h-3.5 w-3.5 text-white/55" />}
            label={nextChargeLabel}
            value={formatLongDate(nextChargeDate, locale)}
          />
        )}
        {info.paymentMethod && (
          <DetailRow
            testId="subscription-info-payment-method"
            icon={<CreditCard className="h-3.5 w-3.5 text-white/55" />}
            label={t("settings.subscription_info_payment_method")}
            value={
              <span className="font-mono">
                {capitalize(info.paymentMethod.brand)} ···· {info.paymentMethod.last4}
              </span>
            }
            sub={`${t("settings.subscription_info_expires")} ${pad2(info.paymentMethod.expMonth)}/${info.paymentMethod.expYear}`}
          />
        )}
      </dl>
    </div>
  );
}

function StatusBadge({
  status,
  cancelAtPeriodEnd,
}: {
  status: StripeStatus;
  cancelAtPeriodEnd: boolean;
}) {
  const { t } = useLocale();
  // Tre visuelle nivåer: positiv (emerald), advarsel (amber), feil (rose).
  // `label` er en lokalisert visningsstreng — IKKE StripeStatus-enum'en.
  let label: string = status;
  let cls = "bg-white/10 border-white/20 text-white/70";

  if (cancelAtPeriodEnd) {
    label = t("settings.subscription_status_cancels_at_end");
    cls = "bg-amber-400/15 border-amber-300/30 text-amber-200";
  } else if (status === "active") {
    label = t("settings.subscription_status_active");
    cls = "bg-emerald-400/15 border-emerald-300/30 text-emerald-200";
  } else if (status === "trialing") {
    label = t("settings.subscription_status_trialing");
    cls = "bg-sky-400/15 border-sky-300/30 text-sky-200";
  } else if (status === "past_due" || status === "unpaid") {
    label = t("settings.subscription_status_past_due");
    cls = "bg-amber-400/15 border-amber-300/30 text-amber-200";
  } else if (status === "canceled") {
    label = t("settings.subscription_status_canceled");
    cls = "bg-rose-500/15 border-rose-400/30 text-rose-200";
  } else if (status === "paused") {
    label = t("settings.subscription_status_paused");
    cls = "bg-amber-400/15 border-amber-300/30 text-amber-200";
  } else if (status === "incomplete" || status === "incomplete_expired") {
    label = t("settings.subscription_status_incomplete");
    cls = "bg-rose-500/15 border-rose-400/30 text-rose-200";
  }

  return (
    <span
      data-testid="subscription-info-status"
      data-status={status}
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

function DetailRow({
  testId,
  icon,
  label,
  value,
  sub,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between gap-3 px-3 py-2.5"
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-[11px] text-white/55 uppercase tracking-wider font-semibold">
          {label}
        </span>
      </div>
      <div className="text-right min-w-0">
        <div className="text-sm text-white truncate">{value}</div>
        {sub && <div className="text-[10px] text-white/45 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

/**
 * Stripe returnerer beløp i minor units (øre/cent). 19900 NOK-øre = 199 NOK.
 * Vi viser uten desimaler hvis beløpet er hele kroner, ellers med 2 desimaler.
 */
function formatAmount(minor: number, currency: string): string {
  // Most fiat: 2 decimals. Stripe har egne "zero-decimal currencies"
  // (JPY, KRW, etc.) — vi støtter primært NOK/EUR/USD/SEK/DKK for nå.
  const ZERO_DECIMAL = ["JPY", "KRW", "VND", "CLP", "ISK"];
  if (ZERO_DECIMAL.includes(currency.toUpperCase())) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(minor);
  }
  const major = minor / 100;
  // Hele kroner → ingen desimaler, ellers 2 desimaler
  if (Number.isInteger(major)) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(major);
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
