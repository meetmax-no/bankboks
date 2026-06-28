"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 18.5 — In-vault upgrade-banner (D-050)
 *
 * Vises i vault-en (etter master-unlock) når tenanten er i trial-status og
 * det er 1–5 dager igjen. Lenker til /billing/upgrade (Iter 13.7).
 *
 * Identitet: subdomain bestemmes av host (vault-en kjører på <sub>.kodovault.no).
 * Bruker /api/billing/checkout-info som er D-071-rewritet til admin.
 *
 * Eskalering (D-001-ånd — ingen falsk trygghet):
 *   - 3–5 dager: AMBER + Sparkles  (vennlig påminnelse)
 *   - 1–2 dager: RØD + AlertTriangle (urgent)
 *   - 0 dager:   skjult — Iter 19 paywall tar over når status === "locked"
 *
 *   daysRemaining-semantikk fra route.ts:
 *     0  = trialEndsAt har ALLEREDE passert (race-vindu før webhook låser)
 *     1  = 0–24 t igjen
 *     2  = 24–48 t igjen
 *     3+ = ≥ 2 dager igjen
 *
 * Dismiss: kun in-memory state. Banneret unmountes naturlig ved vault-lock
 * (parent har `vault.status === "unlocked"`-betingelse), så X-knappen
 * skjuler kun for resten av denne unlock-økten. Ved neste pålogging
 * remountes komponenten og banneret vises igjen.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface CheckoutInfoOk {
  ok: true;
  status: "trial" | "locked";
  daysRemaining: number;
}

export function UpgradeBanner() {
  const { t } = useLocale();
  const [info, setInfo] = useState<CheckoutInfoOk | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip helt på admin-host — endepunktet returnerer 400 invalid_host
    // (admin er ikke en tenant). NEXT_PUBLIC_CLIENT_CONFIG settes kun
    // ved tenant-provisjonering, så fravær = admin-host.
    if (!process.env.NEXT_PUBLIC_CLIENT_CONFIG) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/checkout-info");
        if (!res.ok || aborted) return;
        const data = (await res.json()) as
          | CheckoutInfoOk
          | { ok: false };
        if (!aborted && "ok" in data && data.ok) setInfo(data);
      } catch {
        // Stille feil — banner skjuler seg, ingen falsk alarm. Bruker er
        // allerede inni vault-en og master-unlock har skjedd; oppgrade-
        // varsel er ikke kritisk nok til å rope om manglende internett.
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  if (dismissed) return null;
  if (!info) return null;
  if (info.status !== "trial") return null;
  // 0 dager = trial er passert (race-vindu før webhook låser).
  // Paywall (Iter 19) tar over når status === "locked" — vi viser ingen
  // banner i mellomtiden for å unngå motstridende UX-signaler.
  if (info.daysRemaining === 0) return null;
  if (info.daysRemaining > 5) return null;

  function dismiss() {
    setDismissed(true);
  }

  const message =
    info.daysRemaining === 1
      ? t("upgrade_banner.expires_within_24h")
      : t("upgrade_banner.expires_in_days").replace(
          "{n}",
          String(info.daysRemaining),
        );

  // Visuell eskalering — 2 nivåer:
  //   urgent (1–2 dager) : rød + AlertTriangle
  //   warn   (3–5 dager) : amber + Sparkles
  const urgent = info.daysRemaining <= 2;
  const styles = urgent
    ? {
        container: "border-rose-400/40 bg-rose-500/10",
        iconWrap: "bg-rose-500/15 border-rose-400/40",
        icon: "text-rose-300",
        text: "text-rose-100",
        cta: "bg-rose-400 hover:bg-rose-300",
        dismiss:
          "text-rose-200/70 hover:text-rose-100 hover:bg-rose-500/10",
        Icon: AlertTriangle,
      }
    : {
        container: "border-amber-400/30 bg-amber-500/10",
        iconWrap: "bg-amber-500/15 border-amber-400/30",
        icon: "text-amber-300",
        text: "text-amber-100",
        cta: "bg-amber-400 hover:bg-amber-300",
        dismiss:
          "text-amber-200/70 hover:text-amber-100 hover:bg-amber-500/10",
        Icon: Sparkles,
      };

  const { Icon } = styles;

  return (
    <div
      data-testid="upgrade-banner"
      data-urgency={urgent ? "high" : "normal"}
      data-days-remaining={info.daysRemaining}
      className={`w-full max-w-2xl mb-4 rounded-xl border p-3 sm:p-4 flex items-start sm:items-center gap-3 ${styles.container}`}
    >
      <div className={`rounded-full border p-1.5 shrink-0 ${styles.iconWrap}`}>
        <Icon className={`h-4 w-4 ${styles.icon}`} />
      </div>
      <p
        data-testid="upgrade-banner-text"
        className={`flex-1 min-w-0 text-sm ${styles.text}`}
      >
        {message}
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href="/billing/upgrade"
          data-testid="upgrade-banner-cta"
          className={`h-9 px-4 rounded-md text-neutral-900 text-sm font-semibold transition inline-flex items-center ${styles.cta}`}
        >
          {t("upgrade_banner.cta")}
        </a>
        <button
          type="button"
          aria-label={t("upgrade_banner.dismiss")}
          data-testid="upgrade-banner-dismiss"
          onClick={dismiss}
          className={`h-9 w-9 rounded-md transition inline-flex items-center justify-center ${styles.dismiss}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
