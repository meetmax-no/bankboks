"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 13.7 — /billing/upgrade
 *
 * Siden trial-brukere ser når de vil konvertere til betalt plan.
 * Tilgjengelig hele trial-perioden — bruker kan oppgradere på dag 0
 * eller dag 29.
 *
 * Flyt:
 *   1. Hent tenant-info via GET /api/billing/checkout-info (Iter 13.5)
 *   2. Render <CheckoutChoice mode="upgrade" daysRemaining={...} />
 *   3. Bruker velger plan → CheckoutChoice POST'er til create-checkout
 *      og redirecter til Stripe Checkout-URL
 *
 * Error-håndtering:
 *   - tenant_not_found / invalid_host → "Ugyldig adresse"
 *   - invalid_status (active/cancelled) → "Du er allerede aktivert" + lenke
 *   - missing_host (skal ikke skje i prod) → generisk feil
 *
 * Ko | Do-tema: mørk bakgrunn (#0a0a0a) + amber accent (samme som /platform/register).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { CheckoutChoice } from "@/components/billing/CheckoutChoice";
import { useLocale } from "@/lib/i18n-context";

interface CheckoutInfo {
  ok: true;
  status: "trial" | "locked";
  trialEndsAt: string | null;
  daysRemaining: number;
  hasStripeCustomer: boolean;
  plan: string;
  pricing: {
    monthly: number;
    yearly: number;
    currency: string;
  };
}

interface ErrorState {
  code: string;
  detail?: string;
}

export default function BillingUpgradePage() {
  const { t } = useLocale();
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  // Vis "Avbrutt"-banner hvis bruker kom tilbake fra Stripe uten å fullføre
  // (cancel_url i create-checkout peker til /billing/upgrade?cancelled=1).
  const [showCancelledBanner, setShowCancelledBanner] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("cancelled") === "1") {
        setShowCancelledBanner(true);
        // Fjern query-param fra URL uten å reload, så refresh ikke triggerer banner igjen.
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/checkout-info", {
          method: "GET",
          credentials: "same-origin",
        });
        const data = (await res.json().catch(() => ({}))) as
          | CheckoutInfo
          | { ok: false; error: string; detail?: string };
        if (cancelled) return;
        if (!res.ok || !("ok" in data) || !data.ok) {
          const errBody = data as { error?: string; detail?: string };
          setError({ code: errBody.error ?? `http_${res.status}`, detail: errBody.detail });
          return;
        }
        setInfo(data);
      } catch (e) {
        if (cancelled) return;
        setError({
          code: "network_error",
          detail: e instanceof Error ? e.message : undefined,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4 py-12"
      data-testid="billing-upgrade-page"
    >
      <div className="w-full max-w-2xl">
        {/* Tilbake-link — vault-en bor på samme subdomain på "/" */}
        <Link
          href="/"
          data-testid="billing-upgrade-back-to-vault"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white/85 transition mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("billing_upgrade.back_to_vault")}
        </Link>

        {/* Cancelled-banner — vises hvis bruker kom tilbake fra Stripe uten å fullføre */}
        {showCancelledBanner && (
          <div
            data-testid="billing-upgrade-cancelled-banner"
            className="mb-6 rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 flex items-start gap-3"
          >
            <span className="text-amber-300 text-lg leading-none mt-0.5">↩</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-100">
                {t("billing_upgrade.cancelled_title")}
              </div>
              <div className="text-xs text-amber-200/70 mt-0.5">
                {t("billing_upgrade.cancelled_body")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCancelledBanner(false)}
              className="text-amber-200/60 hover:text-amber-100 text-sm leading-none"
              aria-label={t("billing_upgrade.cancelled_close_aria")}
            >
              ×
            </button>
          </div>
        )}

        {/* Loading */}
        {!info && !error && (
          <div
            data-testid="billing-upgrade-loading"
            className="flex items-center justify-center gap-3 text-white/55 py-12"
          >
            <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
            {t("billing_upgrade.loading")}
          </div>
        )}

        {/* Error */}
        {error && <ErrorBlock error={error} t={t} />}

        {/* Success — render CheckoutChoice */}
        {info && (
          <CheckoutChoice
            mode={info.status === "locked" ? "paywall" : "upgrade"}
            daysRemaining={info.daysRemaining}
            pricing={info.pricing}
          />
        )}
      </div>
    </main>
  );
}

function ErrorBlock({
  error,
  t,
}: {
  error: ErrorState;
  t: (key: string) => string;
}) {
  const isInvalidStatus = error.code === "invalid_status";
  const isTenantNotFound = error.code === "tenant_not_found";
  const isInvalidHost = error.code === "invalid_host";

  let title = t("billing_upgrade.error_generic_title");
  let message = t("billing_upgrade.error_generic_body");
  let action: { href: string; label: string } | null = null;

  if (isInvalidStatus) {
    title = t("billing_upgrade.error_invalid_status_title");
    message = t("billing_upgrade.error_invalid_status_body");
    action = {
      href: "/",
      label: t("billing_upgrade.error_invalid_status_action"),
    };
  } else if (isTenantNotFound) {
    title = t("billing_upgrade.error_tenant_not_found_title");
    message = t("billing_upgrade.error_tenant_not_found_body");
    action = {
      href: "https://kodovault.no/platform/register",
      label: t("billing_upgrade.error_tenant_not_found_action"),
    };
  } else if (isInvalidHost) {
    title = t("billing_upgrade.error_invalid_host_title");
    message = t("billing_upgrade.error_invalid_host_body");
  }

  return (
    <div
      data-testid="billing-upgrade-error"
      className="rounded-xl border border-rose-400/30 bg-rose-950/40 p-6"
    >
      <div className="flex items-start gap-3 mb-3">
        <ShieldAlert className="h-5 w-5 text-rose-300 mt-0.5 flex-shrink-0" />
        <div>
          <h1 className="text-xl font-semibold text-rose-100 mb-1">{title}</h1>
          <p className="text-sm text-white/65 leading-relaxed">{message}</p>
        </div>
      </div>
      {error.detail ? (
        <div className="mt-3 text-xs font-mono text-rose-300/60 break-all">
          {error.code} — {error.detail}
        </div>
      ) : (
        <div className="mt-3 text-xs font-mono text-rose-300/60 break-all">
          {error.code}
        </div>
      )}
      {action && (
        <div className="mt-4">
          <Link
            href={action.href}
            data-testid="billing-upgrade-error-action"
            className="inline-flex items-center h-10 px-4 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-100 text-sm font-medium transition"
          >
            {action.label}
          </Link>
        </div>
      )}
    </div>
  );
}
