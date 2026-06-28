"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 13.7 — `<CheckoutChoice>`
 *
 * Delt UI-komponent som brukes av:
 *   • /billing/upgrade (Iter 13.7)        — frivillig oppgradering (mode="upgrade")
 *   • /billing/paywall (Iter 19)          — tvunget paywall (mode="paywall")
 *
 * Viser to plan-valg (månedlig/årlig), håndterer POST til
 * /api/billing/create-checkout, redirecter til Stripe Checkout-URL.
 *
 * Forskjellen mellom modes:
 *   - upgrade: amber/positiv tone, "Oppgrader nå"-CTA, viser daysRemaining
 *   - paywall: rød/seriøs tone, "Betal og fortsett"-CTA, viser "Vault låst"
 *
 * Pris-strengene er hardkodet i denne iterasjonen — flyttes til
 * client-config når Stripe-prising blir dynamisk (backlog).
 */
import { useEffect, useState } from "react";
import { Loader2, CreditCard, Sparkles, Lock } from "lucide-react";

export type CheckoutChoiceMode = "upgrade" | "paywall";

export interface CheckoutChoicePricing {
  monthly: number;
  yearly: number;
  currency: string;
}

interface Props {
  daysRemaining: number;
  mode: CheckoutChoiceMode;
  pricing: CheckoutChoicePricing;
}

interface PlanCardProps {
  plan: "monthly" | "yearly";
  price: string;
  badge?: string;
  description: string;
  busy: boolean;
  disabled: boolean;
  selected: boolean;
  onClick: () => void;
}

function PlanCard({
  plan,
  price,
  badge,
  description,
  busy,
  disabled,
  selected,
  onClick,
}: PlanCardProps) {
  const isYearly = plan === "yearly";
  return (
    <button
      type="button"
      data-testid={`checkout-choice-${plan}`}
      onClick={onClick}
      disabled={disabled}
      className={`relative w-full text-left rounded-xl border p-5 transition group disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? isYearly
            ? "border-violet-400/60 bg-violet-500/10"
            : "border-sky-400/60 bg-sky-500/10"
          : isYearly
            ? "border-violet-400/25 bg-violet-500/5 hover:border-violet-300/60 hover:bg-violet-500/10"
            : "border-sky-400/25 bg-sky-500/5 hover:border-sky-300/60 hover:bg-sky-500/10"
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-2 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
            isYearly
              ? "bg-violet-500 text-white"
              : "bg-sky-500 text-white"
          }`}
        >
          {badge}
        </span>
      )}
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          className={`text-base font-semibold ${
            isYearly ? "text-violet-200" : "text-sky-200"
          }`}
        >
          {isYearly ? "Årlig" : "Månedlig"}
        </span>
        {busy && selected && (
          <Loader2 className="h-4 w-4 animate-spin text-white/60" />
        )}
      </div>
      <div className="text-2xl font-bold text-white mb-1">{price}</div>
      <div className="text-xs text-white/55">{description}</div>
    </button>
  );
}

export function CheckoutChoice({ daysRemaining, mode, pricing }: Props) {
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bfcache-fix: ved `window.location.assign(stripeUrl)` navigeres siden bort,
  // men hvis bruker trykker browser-back gjenoppretter nettleseren komponenten
  // med busy-state frosset (f.eks. busy="monthly"). Knappen sitter da fast i
  // "Sender..."-tilstand uten en faktisk request i flight. Vi nullstiller på
  // `pageshow.persisted=true` så bruker kan klikke på nytt.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        setBusy(null);
        setError(null);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // Beregn besparelse: månedlig × 12 − årlig. Skjul badge hvis ≤ 0
  // (kan skje hvis admin endrer priser midlertidig).
  const yearlySavings = pricing.monthly * 12 - pricing.yearly;
  const monthlyEquivalentForYearly = Math.round(pricing.yearly / 12);

  async function start(plan: "monthly" | "yearly") {
    if (busy) return;
    setBusy(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        setError(
          `${data.error ?? `HTTP ${res.status}`}${data.detail ? ` — ${data.detail}` : ""}`,
        );
        setBusy(null);
        return;
      }
      // Redirect til Stripe (full navigasjon, ikke router.push)
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
      setBusy(null);
    }
  }

  // ─── Mode-spesifikk kopi ─────────────────────────────────────────────
  const isPaywall = mode === "paywall";

  const headline = isPaywall
    ? "Prøveperioden er over"
    : daysRemaining > 0
      ? `Prøveperioden utløper om ${daysRemaining} ${daysRemaining === 1 ? "dag" : "dager"}`
      : "Velg din plan";

  const subline = isPaywall
    ? "Alle dataene dine er trygge og venter på deg. Velg en plan for å låse opp vaulten igjen."
    : "Velg plan når du er klar. Du kan oppgradere når som helst i prøveperioden.";

  return (
    <div
      data-testid={`checkout-choice-${mode}`}
      className="w-full max-w-2xl mx-auto"
    >
      <div className="flex items-center gap-3 mb-3">
        {isPaywall ? (
          <Lock className="h-5 w-5 text-rose-300" />
        ) : (
          <Sparkles className="h-5 w-5 text-amber-300" />
        )}
        <h1
          className={`text-2xl sm:text-3xl font-semibold ${
            isPaywall ? "text-rose-100" : "text-amber-100"
          }`}
          data-testid="checkout-choice-headline"
        >
          {headline}
        </h1>
      </div>
      <p
        className="text-sm text-white/65 mb-8 leading-relaxed"
        data-testid="checkout-choice-subline"
      >
        {subline}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <PlanCard
          plan="monthly"
          price={`${pricing.monthly} ${pricing.currency}/mnd`}
          description="Faktureres månedlig. Avslutt når som helst."
          busy={busy === "monthly"}
          disabled={busy !== null}
          selected={busy === "monthly"}
          onClick={() => start("monthly")}
        />
        <PlanCard
          plan="yearly"
          price={`${pricing.yearly.toLocaleString("no-NO")} ${pricing.currency}/år`}
          badge={yearlySavings > 0 ? `Spar ${yearlySavings} ${pricing.currency}` : undefined}
          description={`Faktureres årlig. Tilsvarer ${monthlyEquivalentForYearly} ${pricing.currency}/mnd.`}
          busy={busy === "yearly"}
          disabled={busy !== null}
          selected={busy === "yearly"}
          onClick={() => start("yearly")}
        />
      </div>

      {error && (
        <div
          data-testid="checkout-choice-error"
          className="rounded-md border border-rose-400/40 bg-rose-950/60 p-3 text-sm text-rose-200 font-mono break-all mb-4"
        >
          {error}
        </div>
      )}

      <p className="text-xs text-white/40 flex items-center gap-1.5">
        <CreditCard className="h-3.5 w-3.5" />
        Trygg betaling via Stripe. Vi lagrer aldri kortdata.
      </p>
    </div>
  );
}
