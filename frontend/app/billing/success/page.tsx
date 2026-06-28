"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 14 — /billing/success
 *
 * Mellomsiden bruker lander på etter Stripe Checkout.
 *
 * To moduser:
 *   • Scenario C (ny tenant, ingen vault ennå):
 *       Webhook (Iter 13) starter provisjonering; vi viser
 *       ProvisioningTracker som poller `/api/status` hvert 2. sek og
 *       redirecter ved vault_live.
 *   • Scenario A/B (eksisterende tenant betaler ut av trial/locked):
 *       Vault er allerede deployet. Ingen provisjonering trengs.
 *       Vi viser en kort "velkommen tilbake"-melding og redirecter til
 *       vault-roten etter 2-3 sek.
 *
 * Skille via `?existing=1` query-param (settes av Stripe-checkout-builder
 * for scenario A/B i lib/stripe/checkout.ts). Vi kan IKKE bruke
 * /api/status på tenant-pod fordi den importerer sentral-Upstash
 * (D-071/D-077) — tenant-poder har ikke disse credentials.
 *
 * Når `?existing=1` → ingen tracker, ren welcome-back UX.
 * Når `?existing=1` mangler → tracker som før (scenario C, kjøres på
 * admin-domenet hvor sentral-Upstash er tilgjengelig).
 *
 * Flyt for tracker-modus:
 *   1. Les `subdomain` fra URL.
 *   2. Render ProvisioningTracker (mode="public") som poller
 *      `/api/status?subdomain=...` hvert 2. sek.
 *   3. Når `vaultLive: true` → auto-redirect etter 2 sek.
 *   4. `status: "provisioning_failed"` → redirect til /billing/error.
 *   5. >3 min uten resolve → redirect til /billing/error?reason=timeout.
 *
 * Ko | Do-tema: mørk bakgrunn (#0a0a0a) + amber accent (matcher
 * /platform/register).
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Sparkles, Loader2 } from "lucide-react";
import { ProvisioningTracker } from "@/components/platform/ProvisioningTracker";

// Maks 3 minutter — så redirecter vi til feilside. Vercel-bygget skal være
// ferdig innen 1-2 min normalt; 3 min er konservativt timeout-tak.
const TIMEOUT_MS = 3 * 60 * 1000;

// Liten delay mellom "live!" og redirect så bruker ser hva som skjer.
const REDIRECT_DELAY_MS = 2000;

function BillingSuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const subdomainParam = (params.get("subdomain") ?? "").toLowerCase().trim();
  const sessionId = params.get("session_id") ?? "";
  // Scenario A/B (eksisterende tenant betaler ut av trial/locked) setter
  // ?existing=1 i success_url. Da skipper vi tracker'en og viser ren
  // welcome-back UX. Se kommentar øverst.
  const isExisting = params.get("existing") === "1";

  const [redirecting, setRedirecting] = useState(false);

  // Auto-redirect ved vaultLive=true / failed / timeout (kun tracker-modus)
  const handleDone = useCallback(
    (success: boolean) => {
      if (success) {
        setRedirecting(true);
        setTimeout(() => {
          window.location.href = `https://${subdomainParam}.kodovault.no`;
        }, REDIRECT_DELAY_MS);
      } else {
        router.replace(
          `/billing/error?subdomain=${encodeURIComponent(subdomainParam)}&reason=provisioning_failed`,
        );
      }
    },
    [router, subdomainParam],
  );

  // 3-min timeout-vakt — kun aktiv i tracker-modus (scenario C)
  useEffect(() => {
    if (!subdomainParam || isExisting) return;
    const timer = setTimeout(() => {
      router.replace(
        `/billing/error?subdomain=${encodeURIComponent(subdomainParam)}&reason=timeout`,
      );
    }, TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [subdomainParam, router, isExisting]);

  // Eksisterende tenant — vault finnes allerede. Auto-redirect etter
  // 2.5 sek slik at bruker rekker å lese bekreftelsen.
  useEffect(() => {
    if (!subdomainParam || !isExisting) return;
    setRedirecting(true);
    const timer = setTimeout(() => {
      // Tenant er allerede på <sub>.kodovault.no når scenario A/B kjører,
      // så vi navigerer til roten av samme host. Bruker landet på
      // /billing/success?... — vi vil videre til "/".
      if (typeof window !== "undefined") {
        const target = `https://${subdomainParam}.kodovault.no/`;
        // window.location.assign for full reload (clear bfcache state)
        window.location.assign(target);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [subdomainParam, isExisting]);

  // Ugyldig URL — manglende subdomain
  if (!subdomainParam) {
    return (
      <div
        data-testid="billing-success-missing-subdomain"
        className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6"
      >
        <div className="max-w-md text-center space-y-4">
          <div className="text-2xl font-semibold text-amber-300">
            Mangler subdomene
          </div>
          <div className="text-white/70">
            URL-en til denne siden mangler nødvendig informasjon. Hvis du nettopp
            fullførte betaling, sjekk e-posten din for en bekreftelseslenke —
            eller kontakt support@kodovault.no.
          </div>
          <a
            data-testid="billing-success-contact-link"
            href="mailto:support@kodovault.no"
            className="inline-block text-amber-300 hover:text-amber-200 underline"
          >
            support@kodovault.no
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="billing-success-page"
      className="min-h-screen bg-[#0a0a0a] text-white"
    >
      {/* Diskret grain-texture (samme som /platform/register) */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' /></filter><rect width='100%' height='100%' filter='url(%23n)' /></svg>\")",
        }}
      />

      <div className="relative mx-auto max-w-2xl px-6 py-16 sm:py-24 space-y-8">
        {/* Header — varierer mellom welcome-back (eksisterende) og
            "vi setter opp" (ny tenant) */}
        <div className="space-y-3">
          <div
            data-testid="billing-success-header-icon"
            className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${
              isExisting
                ? "bg-emerald-500/10 border border-emerald-400/30"
                : "bg-amber-500/10 border border-amber-400/30"
            }`}
          >
            {isExisting ? (
              <CheckCircle2 className="h-6 w-6 text-emerald-300" />
            ) : (
              <Sparkles className="h-6 w-6 text-amber-300" />
            )}
          </div>
          <h1
            data-testid="billing-success-title"
            className="text-3xl sm:text-4xl font-semibold tracking-tight"
          >
            {isExisting
              ? "Takk! Abonnementet er aktivert"
              : "Takk for at du valgte Ko | Do · Vault"}
          </h1>
          <p
            data-testid="billing-success-subtitle"
            className="text-white/70 text-base sm:text-lg leading-relaxed"
          >
            {isExisting ? (
              <>
                Betalingen er bekreftet og full tilgang til vault'en din er
                gjenopprettet. Vi sender deg tilbake nå.
              </>
            ) : (
              <>
                Betalingen er bekreftet. Vi setter nå opp ditt private
                vault-miljø — dette tar typisk 1–2 minutter.
              </>
            )}
          </p>
        </div>

        {/* Provisjonering-tracker — KUN for ny tenant (scenario C).
            For eksisterende (A/B) er vault'en allerede klar; ingen
            polling, ingen central-Upstash-avhengighet på tenant-pod. */}
        {!isExisting && (
          <ProvisioningTracker
            subdomain={subdomainParam}
            mode="public"
            onDone={handleDone}
          />
        )}

        {/* Redirect-tilstand */}
        {redirecting && (
          <div
            data-testid="billing-success-redirecting"
            className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 flex items-center gap-3"
          >
            <Loader2 className="h-5 w-5 text-emerald-300 animate-spin shrink-0" />
            <div className="text-sm text-emerald-200">
              Sender deg til{" "}
              <span className="font-mono">
                {subdomainParam}.kodovault.no
              </span>
              …
            </div>
          </div>
        )}

        {/* Manuelt fallback-link for eksisterende — i tilfelle redirect
            blokkeres (popup-blocker o.l.) */}
        {isExisting && !redirecting && (
          <a
            data-testid="billing-success-manual-link"
            href={`https://${subdomainParam}.kodovault.no/`}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold transition"
          >
            <Sparkles className="h-4 w-4" />
            Åpne vault
          </a>
        )}

        {/* Diskret footer-info */}
        <div className="pt-8 text-xs text-white/40 space-y-1">
          {sessionId && (
            <div className="font-mono">Stripe session: {sessionId}</div>
          )}
          <div>
            Hvis noe går galt, kontakt{" "}
            <a
              href="mailto:support@kodovault.no"
              className="text-amber-300/70 hover:text-amber-300"
            >
              support@kodovault.no
            </a>
            .
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-amber-300 animate-spin" />
        </div>
      }
    >
      <BillingSuccessInner />
    </Suspense>
  );
}
