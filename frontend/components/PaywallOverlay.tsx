"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 19 — In-vault paywall (D-075 + D-076)
 *
 * Vises POST-unlock når tenant.status === "locked". Dekker DashboardShell
 * og blokkerer all interaksjon med vault-data. Bruker må enten:
 *   1. Betale via Stripe (gjenbruker <CheckoutChoice mode="paywall" />)
 *   2. Klikke "Ikke min konto" — tømmer localStorage og navigerer bort
 *
 * Data er garantert trygge:
 *   - Krypterte blobs ligger urørt i tenant-Upstash
 *   - Slettes først ved `lockedAt + lockToDeleteDays` (D-075)
 *   - Server-side write-block (D-076) hindrer teknisk omgåelse
 *
 * Tone (per Mike): varm, ikke straffende. Vi tar vare på data, ikke
 * straffer brukeren for å glemme betaling.
 */
import { useEffect, useState } from "react";
import { CheckoutChoice } from "@/components/billing/CheckoutChoice";

interface CheckoutInfo {
  ok: true;
  status: "trial" | "locked";
  daysRemaining: number;
  trialEndsAt: string | null;
  lockedAt: string | null;
  deletionScheduledAt: string | null;
  pricing: { monthly: number; yearly: number; currency: string };
}

interface Props {
  children: React.ReactNode;
  /**
   * Callback når paywall trigges/oppheves. Brukt av parent for å
   * disable AppHeader-menyer mens vault er låst.
   */
  onPaywallActiveChange?: (active: boolean) => void;
}

export function PaywallOverlay({ children, onPaywallActiveChange }: Props) {
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Skip helt på admin-host — endepunktet returnerer 400 invalid_host
    // (admin er ikke en tenant). NEXT_PUBLIC_CLIENT_CONFIG settes kun
    // ved tenant-provisjonering, så fravær = admin-host. Sett checked=true
    // direkte så paywall ikke blokkerer rendring på admin.
    if (!process.env.NEXT_PUBLIC_CLIENT_CONFIG) {
      setChecked(true);
      return;
    }
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/checkout-info");
        if (aborted) return;
        if (!res.ok) {
          // Tenant er ikke trial/locked (kanskje "active") — passthrough
          setChecked(true);
          return;
        }
        const data = (await res.json()) as CheckoutInfo | { ok: false };
        if (!aborted && "ok" in data && data.ok) setInfo(data);
        if (!aborted) setChecked(true);
      } catch {
        // Nettverksfeil — fail-open, vis vault
        if (!aborted) setChecked(true);
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // Locked-tilstand → vis paywall.
  // ALSO når trial er funksjonelt utløpt men status ennå ikke flippet til
  // "locked" (Iter 17 cron mangler per 2026-06-13 → kan vare ubestemt tid).
  // Write-block (D-076) trigges fortsatt kun på literal "locked" — defensivt
  // andre-lag. UI signalerer korrekt, server-side enforcement kommer når
  // Iter 17 lander.
  const isExpired =
    info !== null &&
    (info.status === "locked" ||
      (info.status === "trial" && info.daysRemaining === 0));

  // Rapporter status til parent (AppHeader trenger å disable knapper).
  // MERK: Denne useEffect-en MÅ stå FØR enhver conditional return — ellers
  // bryter vi Rules of Hooks (React error #310 i prod, "rendered more hooks
  // than previous render" i dev). `checked` styrer hvorvidt vi faktisk
  // sender en aktiv verdi til parent.
  useEffect(() => {
    if (checked) onPaywallActiveChange?.(isExpired);
  }, [isExpired, checked, onPaywallActiveChange]);

  // Vis ikke noe før vi har sjekket — unngår flash av vault før paywall
  if (!checked) {
    return (
      <div className="w-full flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-white/15 border-t-white/55 animate-spin" />
      </div>
    );
  }

  if (isExpired) {
    return <PaywallContent info={info} />;
  }

  // Trial eller active → normal vault
  return <>{children}</>;
}

function PaywallContent({ info }: { info: CheckoutInfo }) {
  const deletionDate = info.deletionScheduledAt
    ? formatDate(info.deletionScheduledAt)
    : null;

  function handleNotMyAccount() {
    if (typeof window === "undefined") return;
    // Tøm vault-relatert localStorage så ingen state-rester henger igjen
    try {
      window.localStorage.clear();
    } catch {
      /* private-mode etc */
    }
    window.location.assign("https://kodovault.no");
  }

  return (
    <div
      data-testid="paywall-overlay"
      data-locked-at={info.lockedAt ?? ""}
      className="w-full max-w-2xl flex flex-col items-center"
    >
      {/* Glass-container — matcher appens hovedkort-stil (D-023) */}
      <div className="w-full backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 sm:p-8 animate-slide-up">
        {/* CheckoutChoice eier headline/subline/ikon i paywall-mode (Iter 13.7) */}
        <CheckoutChoice
          mode="paywall"
          daysRemaining={info.daysRemaining}
          pricing={info.pricing}
        />

        {/* Retention-info — vises kun når status faktisk er "locked" og vi har
            en konkret slettedato. Skjult under trial-expired-vinduet før
            status flippes (lockedAt: null → deletionScheduledAt: null). */}
        {deletionDate && (
          <p
            data-testid="paywall-retention"
            className="mt-6 text-sm sm:text-base text-white/70 text-center"
          >
            Dataene dine oppbevares trygt til{" "}
            <span className="text-white font-semibold">{deletionDate}</span>.
          </p>
        )}
      </div>

      {/* Diskret utgang for bruker på feil identitet — utenfor card */}
      <button
        type="button"
        onClick={handleNotMyAccount}
        data-testid="paywall-not-my-account"
        className="mt-6 text-xs text-white/40 hover:text-white/70 transition"
      >
        ← Ikke min konto
      </button>
    </div>
  );
}

/**
 * Formaterer ISO-dato til norsk lesbar form. F.eks. "2026-07-25" → "25. juli 2026".
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
