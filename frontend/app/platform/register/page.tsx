"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 4 — /platform/register
 *
 * Public registreringsskjema for B2C trial-flyt (D-037).
 * Leser `?plan=<id>` fra URL (kommer fra plan-knappene på /platform/test).
 *
 * Felt:
 *   - Fornavn (påkrevd)
 *   - Etternavn (påkrevd)
 *   - E-post (påkrevd, validert med samme regex som server)
 *   - Subdomene (påkrevd, sanntidssjekk via /api/register/subdomain-check)
 *   - Lifecycle-eposter (default ✅, kan skrus av)
 *
 * **Iter 4 = INGEN API-kall ved submit.** Skjemaet samler kun inn data og
 * viser et resultat-panel som forhåndsviser hva Iter 7+ POST /api/register
 * vil sende. Iter 5 legger på Turnstile, Iter 6 rate-limit, Iter 7 selve
 * provisjoneringen.
 *
 * Per D-037: ingen e-postverifisering, ingen kortinfo, ingen Stripe. Stripe
 * kommer i Iter 11 og kobles til konverterings-flyten via Resend-e-poster.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import plansConfig from "@/lib/platform/plans.json";
import { TurnstileWidget } from "@/components/platform/TurnstileWidget";
import { ProvisioningTracker } from "@/components/platform/ProvisioningTracker";
import { LocaleRadioGroup, type Locale } from "@/components/platform/LocaleRadioGroup";

type PlanId = "trial" | "monthly" | "yearly" | "enterprise";

type SubdomainCheck =
  | { state: "idle" }
  | { state: "too_short" }
  | { state: "checking" }
  | { state: "available" }
  | {
      state: "unavailable";
      reason: "invalid_format" | "reserved" | "taken";
    };

import defaultClientConfig from "../../../public/clients/default.json";

const SUBDOMAIN_MIN_LENGTH = 3;

/**
 * Iter 14.7 — localStorage-nøkkel for "Fortsett der du slapp"-banner.
 * Lagres ved successful submit FØR Stripe-redirect. Sjekkes ved page-mount.
 * Holdes adskilt fra session/auth-state for å være eksplisitt rydding.
 */
const RESUME_STORAGE_KEY = "kodo:register:pending-session";

/**
 * Resume-vindu (minutter). Hentes fra `register.resumeWindowMinutes` i
 * default.json. Default: 60 min. Stripe-sessions utløper etter 24t, men
 * vi viser banner kun innenfor dette vinduet — eldre sessions skjules
 * så bruker ikke får falsk håp om å fortsette en for-lengst-død flyt.
 */
const RESUME_MAX_AGE_MIN: number = (() => {
  const raw = defaultClientConfig.register?.resumeWindowMinutes;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 60;
  const v = Math.floor(raw);
  return v >= 1 && v <= 24 * 60 ? v : 60;
})();

interface PendingSession {
  subdomain: string;
  plan: "monthly" | "yearly";
  savedAt: string; // ISO timestamp
}

function readPendingSession(): PendingSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSession;
    // Aldersjekk — drop hvis eldre enn RESUME_MAX_AGE_MIN
    const ageMs = Date.now() - new Date(parsed.savedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > RESUME_MAX_AGE_MIN * 60 * 1000) {
      window.localStorage.removeItem(RESUME_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
    return null;
  }
}

function savePendingSession(s: PendingSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* localStorage kvote / privacy-mode — ikke kritisk */
  }
}

function clearPendingSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  subdomain: string;
  lifecycleEmails: boolean;
}

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  subdomain: "",
  lifecycleEmails: true,
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  // Next.js 15 krever Suspense rundt komponenter som bruker
  // useSearchParams() — ellers feiler static prerendering ved build.
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterPageInner />
    </Suspense>
  );
}

function RegisterFallback() {
  return (
    <div
      data-testid="register-page-loading"
      className="min-h-screen w-full bg-neutral-950 text-white flex items-center justify-center"
    >
      <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
    </div>
  );
}

function RegisterPageInner() {
  const { t, locale } = useLocale();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");

  // Valider plan-parameter mot plans.json. Ugyldig eller manglende → trial.
  // Enterprise er sales-driven (D-038) og hører ikke hjemme her — redirect-
  // hint i UI hvis noen prøver å nå /register?plan=enterprise.
  const planId: PlanId = useMemo(() => {
    const valid = plansConfig.plans.find(
      (p) => p.id === planParam && !p.contactOnly,
    );
    return (valid?.id as PlanId) ?? "trial";
  }, [planParam]);

  const isEnterpriseAttempt = planParam === "enterprise";
  const wasCancelled = searchParams.get("cancelled") === "1";
  const cancelledSub = searchParams.get("sub") ?? "";

  // Når Stripe redirecter til cancel_url frigjør vi subdomenet umiddelbart
  // ved å kalle kaskade-deleten. Uten dette ville subdomenet ligget reservert
  // i opptil en time før cleanup-cron rydder det.
  const [cancelStatus, setCancelStatus] = useState<
    "idle" | "cleaning" | "cleaned" | "failed"
  >("idle");

  useEffect(() => {
    if (!wasCancelled || !cancelledSub) return;
    // Rydd localStorage — bruker har valgt å avbryte denne sesjonen.
    clearPendingSession();
    let aborted = false;
    setCancelStatus("cleaning");
    (async () => {
      try {
        const res = await fetch("/api/register/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subdomain: cancelledSub }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (aborted) return;
        setCancelStatus(data.ok ? "cleaned" : "failed");
      } catch {
        if (!aborted) setCancelStatus("failed");
      }
    })();
    return () => {
      aborted = true;
    };
  }, [wasCancelled, cancelledSub]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Iter 19.9 Fase 2: Obligatorisk språkvalg ved registrering — starter HELT
  // TOMT, ingen pre-utfylling fra useLocale() eller browser. Submit blokkeres
  // til bruker har valgt eksplisitt.
  const [selectedLocale, setSelectedLocale] = useState<Locale | null>(null);
  const [emailValid, setEmailValid] = useState<"idle" | "valid" | "invalid">(
    "idle",
  );
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheck>({
    state: "idle",
  });
  const [submitted, setSubmitted] = useState(false);

  // Iter 14.7 — "Fortsett der du slapp"-banner. Sjekker localStorage ved mount
  // og verifiserer mot backend at tenant fortsatt er pending. Hvis ja → banner.
  type ResumeState =
    | { kind: "idle" }
    | { kind: "checking" }
    | { kind: "show"; session: PendingSession; daysRemaining: number }
    | { kind: "none" };
  const [resume, setResume] = useState<ResumeState>({ kind: "idle" });
  const [resumeBusy, setResumeBusy] = useState<"continue" | "cancel" | null>(null);
  // bfcache-fix: når nettleseren gjenoppretter siden fra back-forward-cache
  // (typisk når bruker trykker browser-back fra Stripe), kjører ikke useEffect
  // på nytt fordi komponenten aldri unmountes. Vi bumper denne tellern på
  // `pageshow` med persisted=true for å trigge resume-sjekken på nytt.
  const [bfcacheTick, setBfcacheTick] = useState(0);

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        // Bfcache-restore: nettleseren gjenoppretter ALL React-state, inkl.
        // transient busy-flags fra et `window.location.assign(stripeUrl)` som
        // navigerte siden bort. Vi nullstiller dem så bruker ikke sitter fast
        // i "Sender..."/spinner-tilstand uten en faktisk request i flight.
        setResumeBusy(null);
        setSubmitting(false);
        setBfcacheTick((t) => t + 1);
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    // Ikke vis banner hvis bruker akkurat avbrøt (de er allerede i cancel-flow).
    if (wasCancelled) {
      setResume({ kind: "none" });
      return;
    }
    const session = readPendingSession();
    if (!session) {
      setResume({ kind: "none" });
      return;
    }
    setResume({ kind: "checking" });
    let cancelled = false;
    (async () => {
      try {
        // Verifiser at tenant fortsatt er pending. Bruker ?_tenant= siden
        // /platform/register kan kjøre på root (kodovault.no), ikke tenant-sub.
        const res = await fetch(
          `/api/billing/checkout-info?_tenant=${encodeURIComponent(session.subdomain)}`,
          { method: "GET" },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          daysRemaining?: number;
        };
        if (cancelled) return;
        // checkout-info returnerer 400 invalid_status for pending — det betyr
        // tenant finnes men er pending. Det er den eneste situasjonen som
        // gir mening for banner. Andre statuser → drop localStorage.
        // BUG-NB: Iter 13.5-spec ekskluderer pending fra OK-respons. Vi tar
        // 400 invalid_status med detail som "pending" som signal om at
        // tenanten finnes. Dette må eventuelt utvides hvis API endres.
        if (!res.ok && data.status !== "pending") {
          // For pending må vi sjekke detail-feltet siden status ikke kommer.
          // Forenklet: hvis HTTP=400 og NOT_FOUND ikke er årsaken, antar vi pending.
          // (Vi prøver continue-knappen uansett — backend rejecter hvis ugyldig.)
          if (res.status === 404) {
            clearPendingSession();
            setResume({ kind: "none" });
            return;
          }
        }
        // Vis banner. daysRemaining er ikke tilgjengelig for pending, så vi
        // viser session-alder i stedet (savedAt + 25min vindu).
        setResume({
          kind: "show",
          session,
          daysRemaining: data.daysRemaining ?? 0,
        });
      } catch {
        if (!cancelled) {
          // Nettverksfeil → drop banner (ikke vis falsk hope).
          setResume({ kind: "none" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wasCancelled, bfcacheTick]);

  async function resumeContinue() {
    if (resume.kind !== "show") return;
    setResumeBusy("continue");
    try {
      const res = await fetch(
        `/api/billing/create-checkout?_tenant=${encodeURIComponent(resume.session.subdomain)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: resume.session.plan }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        // Fail-safe: rydd opp localStorage så bruker ikke sitter fast.
        clearPendingSession();
        setResume({ kind: "none" });
        setSubmitError(data.error ?? "Kunne ikke gjenopprette betaling — start på nytt");
        setResumeBusy(null);
        return;
      }
      window.location.assign(data.url);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Nettverksfeil");
      setResumeBusy(null);
    }
  }

  async function resumeCancel() {
    if (resume.kind !== "show") return;
    setResumeBusy("cancel");
    try {
      await fetch("/api/register/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subdomain: resume.session.subdomain }),
      });
    } catch {
      /* selv om cancel feiler — bruker har sagt drop. Rydd lokalt uansett. */
    }
    clearPendingSession();
    setResume({ kind: "none" });
    setResumeBusy(null);
  }

  // Iter 5 — Turnstile bot-filter. `null` = ikke verifisert ennå.
  // `token` = challenge-token fra Cloudflare; verifiseres server-side
  // ved submit. `error` = Cloudflare avviste eller widget krasjet.
  type TurnstileState =
    | { kind: "idle" }
    | { kind: "passed"; token: string }
    | { kind: "error" };
  const [turnstile, setTurnstile] = useState<TurnstileState>({ kind: "idle" });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sanntidssjekk på subdomene — 500ms debounce per spec.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");
  useEffect(() => {
    const trimmed = form.subdomain.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setSubdomainCheck({ state: "idle" });
      return;
    }
    if (trimmed.length < SUBDOMAIN_MIN_LENGTH) {
      // Klient-side: ikke kall API, vis kun "for kort"-melding.
      setSubdomainCheck({ state: "too_short" });
      return;
    }
    setSubdomainCheck({ state: "checking" });
    debounceRef.current = setTimeout(async () => {
      const query = trimmed;
      lastQueryRef.current = query;
      try {
        const res = await fetch(
          `/api/register/subdomain-check?subdomain=${encodeURIComponent(query)}`,
        );
        if (lastQueryRef.current !== query) return;
        const body = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          reason?: "invalid_format" | "reserved" | "taken";
        };
        if (body.available === true) {
          setSubdomainCheck({ state: "available" });
        } else if (body.reason) {
          setSubdomainCheck({ state: "unavailable", reason: body.reason });
        } else {
          setSubdomainCheck({ state: "idle" });
        }
      } catch {
        if (lastQueryRef.current !== query) return;
        setSubdomainCheck({ state: "idle" });
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [form.subdomain]);

  // I lokal dev uten Turnstile-konfig: tillat submit uten bot-token.
  // I prod hvor `NEXT_PUBLIC_TURNSTILE_SITE_KEY` er satt: krev token.
  const turnstileRequired = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  );
  const turnstilePassed =
    !turnstileRequired || turnstile.kind === "passed";

  const allValid =
    EMAIL_RX.test(form.email.trim()) &&
    subdomainCheck.state === "available" &&
    turnstilePassed &&
    selectedLocale !== null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!allValid || submitting) return;
    setSubmitError(null);

    // Iter 4-6 hadde to-stegs verifisering (separat /verify-turnstile-kall
    // før resultat-panel). Iter 7 endrer dette: vi sender Turnstile-token
    // direkte til /api/register som verifiserer den server-side som første
    // valideringssteg. For ikke-trial-planer (monthly/yearly) skal vi
    // i Iter 12+ heller sende til /api/register/paid → Stripe Checkout.
    //
    // Per nå støtter vi kun trial-registrering ende-til-ende. Monthly/
    // yearly faller fortsatt til stub-resultatpanelet (Iter 12 wires det).

    if (planId !== "trial") {
      // Enterprise håndteres tidligere via isEnterpriseAttempt-redirect.
      // Type-narrowing for TypeScript — på dette punkt er planId monthly|yearly.
      if (planId === "enterprise") return;
      const paidPlan: "monthly" | "yearly" = planId;
      // Iter 12.5 / 14.7: betalt plan → /api/register/paid → Stripe Checkout.
      // Ved suksess lagrer vi pending-session i localStorage så "Fortsett der
      // du slapp"-banneret kan vise hvis bruker kommer tilbake uten å fullføre.
      setSubmitting(true);
      try {
        const res = await fetch("/api/register/paid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subdomain: form.subdomain.trim().toLowerCase(),
            email: form.email.trim().toLowerCase(),
            firstName: form.firstName.trim() || undefined,
            lastName: form.lastName.trim() || undefined,
            lifecycleEmails: form.lifecycleEmails,
            locale: selectedLocale as Locale,
            plan: paidPlan,
            turnstileToken:
              turnstile.kind === "passed" ? turnstile.token : undefined,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          url?: string;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !body.ok || !body.url) {
          const errKey = body.error ?? "internal_error";
          setSubmitError(
            t(`register.api_error_${errKey}`) ||
              body.detail ||
              t("register.api_error_internal_error"),
          );
          if (errKey === "turnstile_failed" || errKey === "missing_turnstile") {
            setTurnstile({ kind: "error" });
          }
          setSubmitting(false);
          return;
        }
        // Lagre pending-session FØR redirect (window unloader vil avbryte
        // ellers). Banneret bruker dette ved retur.
        savePendingSession({
          subdomain: form.subdomain.trim().toLowerCase(),
          plan: paidPlan,
          savedAt: new Date().toISOString(),
        });
        window.location.assign(body.url);
        return;
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : "Nettverksfeil",
        );
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: form.subdomain.trim().toLowerCase(),
          email: form.email.trim().toLowerCase(),
          firstName: form.firstName.trim() || undefined,
          lastName: form.lastName.trim() || undefined,
          lifecycleEmails: form.lifecycleEmails,
          locale: selectedLocale as Locale,
          turnstileToken:
            turnstile.kind === "passed" ? turnstile.token : undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        subdomain?: string;
        trialEndsAt?: string;
      };
      if (!res.ok || !body.ok) {
        const errKey = body.error ?? "internal_error";
        setSubmitError(
          t(`register.api_error_${errKey}`) ||
            body.detail ||
            t("register.api_error_internal_error"),
        );
        // Hvis Turnstile feilet server-side, resett widget-state slik at
        // brukeren kan trigge en ny challenge.
        if (errKey === "turnstile_failed" || errKey === "missing_turnstile") {
          setTurnstile({ kind: "error" });
        }
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Nettverksfeil",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isEnterpriseAttempt) {
    return (
      <PageShell t={t}>
        <div
          data-testid="register-enterprise-redirect"
          className="rounded-2xl border border-violet-400/30 bg-violet-500/5 backdrop-blur-xl p-6 max-w-xl mx-auto text-center"
        >
          <h2 className="text-lg font-semibold mb-2">
            {t("register.enterprise_title")}
          </h2>
          <p className="text-sm text-white/70 mb-4">
            {t("register.enterprise_body")}
          </p>
          <a
            data-testid="register-enterprise-mailto"
            href="mailto:kontakt@kodovault.no?subject=Ko | Do · Vault — Enterprise"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition"
          >
            kontakt@kodovault.no
          </a>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell t={t}>
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 text-center">
          <div
            data-testid="register-plan-badge"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium mb-4"
            style={{
              backgroundColor: "#f5a623",
              color: "#0a0e1a",
              borderRadius: "100px",
            }}
          >
            {t(`register.plan_badge_${planId}`)}
          </div>
          <h2 className="text-3xl font-semibold tracking-tight mb-2">
            {t("register.heading")}
          </h2>
          <p className="text-sm text-white/55">{t("register.subheading")}</p>
        </div>

        {/* Iter 14.7 — "Fortsett der du slapp"-banner */}
        {resume.kind === "show" && (
          <div
            data-testid="register-resume-banner"
            className="mb-6 rounded-xl border border-sky-400/30 bg-sky-500/10 backdrop-blur-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
          >
            <div className="rounded-full bg-sky-500/15 border border-sky-400/30 p-1.5 shrink-0">
              <svg
                className="h-4 w-4 text-sky-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9zm0 0 4-4m-4 4 4 4"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sky-100">
                Uavsluttet betaling for{" "}
                <span className="font-mono">{resume.session.subdomain}</span>
              </div>
              <div className="text-xs text-sky-200/70 mt-0.5">
                Plan: {resume.session.plan === "monthly" ? "Månedlig" : "Årlig"}.
                Du kan fortsette der du slapp eller avbryte.
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                data-testid="register-resume-continue"
                onClick={resumeContinue}
                disabled={resumeBusy !== null}
                className="h-9 px-4 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 text-sm font-medium disabled:opacity-50 transition"
              >
                {resumeBusy === "continue" ? "Sender…" : "Fortsett til Stripe"}
              </button>
              <button
                type="button"
                data-testid="register-resume-cancel"
                onClick={resumeCancel}
                disabled={resumeBusy !== null}
                className="h-9 px-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-sm disabled:opacity-50 transition"
              >
                {resumeBusy === "cancel" ? "Avbryter…" : "Avbryt"}
              </button>
            </div>
          </div>
        )}

        {wasCancelled && (
          <div
            data-testid="register-cancelled-banner"
            className="mb-6 rounded-xl border border-amber-400/30 bg-amber-500/10 backdrop-blur-xl p-4 flex items-start gap-3"
          >
            <div className="rounded-full bg-amber-500/15 border border-amber-400/30 p-1.5 shrink-0">
              <svg
                className="h-4 w-4 text-amber-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div
                data-testid="register-cancelled-title"
                className="text-sm font-medium text-amber-100"
              >
                {t("register.cancelled_title")}
              </div>
              <div
                data-testid="register-cancelled-body"
                className="text-xs text-amber-200/75 mt-0.5"
              >
                {cancelStatus === "cleaning"
                  ? t("register.cancelled_cleaning")
                  : cancelStatus === "cleaned"
                    ? t("register.cancelled_cleaned")
                    : cancelStatus === "failed"
                      ? t("register.cancelled_failed")
                      : t("register.cancelled_body")}
              </div>
            </div>
          </div>
        )}

        <form
          onSubmit={onSubmit}
          data-testid="register-form"
          className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4"
        >
          {/* 1. Subdomain — primær-valget. Plassert øverst med ekstra rom.
              Layout: [input høyre-justert] [.kodovault.no plain tekst] —
              de er IKKE inni samme rounded-boks, men søsken-elementer på
              flex-rad slik at det visuelt leser som én adresse. */}
          <FieldLabel label={t("register.field_subdomain")} required>
            <div className="flex items-stretch gap-3">
              <div className="relative">
                <input
                  type="text"
                  required
                  autoFocus
                  value={form.subdomain}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      subdomain: e.target.value.toLowerCase(),
                    })
                  }
                  placeholder={t("register.field_subdomain_placeholder")}
                  data-testid="register-subdomain-input"
                  autoComplete="off"
                  maxLength={30}
                  className={`w-[20ch] font-mono rounded-lg bg-black/40 border pl-10 pr-3 py-3 text-base text-white text-right outline-none transition ${
                    subdomainCheck.state === "available"
                      ? "border-emerald-400/60 focus:border-emerald-300"
                      : subdomainCheck.state === "unavailable" ||
                        subdomainCheck.state === "too_short"
                      ? "border-rose-400/60 focus:border-rose-300"
                      : "border-white/15 focus:border-blue-300/60"
                  }`}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {subdomainCheck.state === "checking" && (
                    <Loader2 className="h-4 w-4 text-white/55 animate-spin" />
                  )}
                  {subdomainCheck.state === "available" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  )}
                  {(subdomainCheck.state === "unavailable" ||
                    subdomainCheck.state === "too_short") && (
                    <X className="h-4 w-4 text-rose-300" />
                  )}
                </div>
              </div>
              <div
                aria-hidden="true"
                className="flex items-center font-mono text-base text-white/55 select-none"
              >
                .kodovault.no
              </div>
            </div>
            <SubdomainBadge check={subdomainCheck} t={t} />

            {/* Tydelig URL-forhåndsvisning — kun synlig når subdomenet er ledig */}
            {subdomainCheck.state === "available" && (
              <div
                data-testid="register-url-preview"
                className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-400/30"
              >
                <div className="text-[10px] uppercase tracking-wide text-emerald-300/70 font-mono mb-1">
                  {t("register.url_preview_label")}
                </div>
                <div
                  data-testid="register-url-preview-value"
                  className="font-mono text-base text-emerald-100 font-medium break-all"
                >
                  https://{form.subdomain.trim()}.kodovault.no
                </div>
              </div>
            )}
          </FieldLabel>

          {/* 2. Navn + e-post */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FieldLabel label={t("register.field_first_name")}>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
                placeholder={t("register.field_first_name_placeholder")}
                data-testid="register-firstname-input"
                className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-300/60 transition"
              />
            </FieldLabel>

            <FieldLabel label={t("register.field_last_name")}>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) =>
                  setForm({ ...form, lastName: e.target.value })
                }
                placeholder={t("register.field_last_name_placeholder")}
                data-testid="register-lastname-input"
                className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2.5 text-sm text-white outline-none focus:border-blue-300/60 transition"
              />
            </FieldLabel>
          </div>

          <FieldLabel label={t("register.field_email")} required>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => {
                setForm({ ...form, email: e.target.value });
                if (emailValid !== "idle") setEmailValid("idle");
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v) setEmailValid("idle");
                else setEmailValid(EMAIL_RX.test(v) ? "valid" : "invalid");
              }}
              placeholder={t("register.field_email_placeholder")}
              data-testid="register-email-input"
              className={`w-full rounded-lg bg-black/40 border px-3 py-2.5 text-sm text-white outline-none transition ${
                emailValid === "valid"
                  ? "border-emerald-400/60 focus:border-emerald-300"
                  : emailValid === "invalid"
                  ? "border-rose-400/60 focus:border-rose-300"
                  : "border-white/15 focus:border-blue-300/60"
              }`}
            />
            {emailValid === "invalid" && (
              <p
                data-testid="register-email-error"
                className="text-[11px] text-rose-300 font-medium mt-1.5"
              >
                {t("register.error_invalid_email")}
              </p>
            )}
          </FieldLabel>

          {/* Iter 19.9 Fase 2 — Obligatorisk språkvalg.
              Starter HELT TOMT. Lagres til tenant.locale ved kontoopprettelse
              og er låst etter registrering (ikke knyttet til app-språk-toggle
              i Settings). Gjelder også /invite-siden for B2B. */}
          <LocaleRadioGroup
            label={t("register.field_locale") || "Velg språk på mail og kommunikasjon fra oss"}
            value={selectedLocale}
            onChange={setSelectedLocale}
            disabled={submitting}
          />

          {/* 3. Lifecycle-checkbox med transaksjonell info under (per D-047).
              Ingen border/boks — bare checkbox + label + dimmet hjelpetekst. */}
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                data-testid="register-lifecycle-checkbox"
                checked={form.lifecycleEmails}
                onChange={(e) =>
                  setForm({ ...form, lifecycleEmails: e.target.checked })
                }
                className="h-4 w-4 mt-0.5 accent-amber-400 flex-shrink-0"
              />
              <span className="text-sm text-white leading-snug">
                {t("register.lifecycle_label")}
              </span>
            </label>
            <p
              data-testid="register-transactional-note"
              className="text-[12px] font-light text-[#666666] leading-snug pl-7"
            >
              {t("register.transactional_note")}
            </p>
          </div>

          {submitError && (
            <p
              data-testid="register-submit-error"
              className="text-[11px] text-rose-300 font-medium text-center"
            >
              {submitError}
            </p>
          )}

          <button
            type="submit"
            data-testid="register-submit-btn"
            disabled={!allValid || submitting}
            className="w-full h-12 rounded-full bg-amber-400 hover:bg-amber-300 text-neutral-900 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(`register.submit_button_${planId}`)}
          </button>

          <p className="text-[10px] text-white/40 text-center pt-1">
            <span className="text-rose-400">*</span>{" "}
            {t("register.required_hint")}
          </p>

          {/* Turnstile bot-filter (Iter 5 revidert). Invisible/bakgrunnsmodus —
              tar ingen plass i UI. Bruker ser ikke "Verify you are human";
              Cloudflare verifiserer i bakgrunnen og leverer token via callback.
              Mike må sette widget mode = "Invisible" i Cloudflare dashboard. */}
          <div data-testid="register-turnstile-wrap">
            <TurnstileWidget
              onVerify={(token) => {
                setTurnstile({ kind: "passed", token });
                setSubmitError(null);
              }}
              onExpire={() => setTurnstile({ kind: "idle" })}
              onError={() => setTurnstile({ kind: "error" })}
              theme="dark"
            />
            {turnstile.kind === "error" && (
              <p
                data-testid="register-turnstile-error"
                className="text-[11px] text-rose-300 font-medium text-center mt-2"
              >
                {t("register.turnstile_error")}
              </p>
            )}
          </div>
        </form>

        {submitted && planId === "trial" ? (
          <ProvisioningTracker
            subdomain={form.subdomain.trim().toLowerCase()}
            mode="public"
            className="mt-6 animate-fade-in"
          />
        ) : submitted ? (
          <ResultPanel
            form={form}
            planId={planId}
            t={t}
            locale={locale}
          />
        ) : null}
      </div>
    </PageShell>
  );
}

function PageShell({
  t,
  children,
}: {
  t: (k: string) => string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="register-page"
      className="min-h-screen w-full bg-neutral-950 text-white"
    >
      <div className="border-b border-white/10 bg-neutral-950/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full bg-amber-400/10 border border-amber-300/30 p-2">
              <Sparkles className="h-4 w-4 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h1
                data-testid="register-title"
                className="text-sm font-semibold tracking-tight"
              >
                {t("register.title")}
              </h1>
              <p className="text-[10px] text-white/50">
                {t("register.subtitle")}
              </p>
            </div>
          </div>
          <Link
            data-testid="register-back-link"
            href="/platform/test"
            prefetch={false}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-white/80 hover:text-white transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("register.back_to_plans")}
          </Link>
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">{children}</div>
    </div>
  );
}

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5 block">
        {label}
        {required && (
          <span className="text-rose-400 ml-1" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function SubdomainBadge({
  check,
  t,
}: {
  check: SubdomainCheck;
  t: (k: string) => string;
}) {
  if (check.state === "idle") return null;
  if (check.state === "too_short") {
    return (
      <p
        data-testid="register-subdomain-status"
        data-state="too_short"
        className="text-[11px] text-rose-300 font-medium mt-1.5"
      >
        {t("register.error_too_short")}
      </p>
    );
  }
  if (check.state === "checking") {
    return (
      <p
        data-testid="register-subdomain-status"
        data-state="checking"
        className="text-[11px] text-white/55 mt-1.5"
      >
        {t("admin_tenants.subdomain_checking")}
      </p>
    );
  }
  if (check.state === "available") {
    return (
      <p
        data-testid="register-subdomain-status"
        data-state="available"
        className="text-[11px] text-emerald-300 font-medium mt-1.5"
      >
        {t("admin_tenants.subdomain_available")}
      </p>
    );
  }
  const msg =
    check.reason === "reserved"
      ? t("admin_tenants.error_reserved")
      : check.reason === "taken"
      ? t("admin_tenants.error_exists")
      : t("admin_tenants.error_invalid_subdomain");
  return (
    <p
      data-testid="register-subdomain-status"
      data-state="unavailable"
      data-reason={check.reason}
      className="text-[11px] text-rose-300 font-medium mt-1.5"
    >
      {msg}
    </p>
  );
}

function ResultPanel({
  form,
  planId,
  t,
  locale,
}: {
  form: FormState;
  planId: PlanId;
  t: (k: string) => string;
  locale: string;
}) {
  const bcp47 =
    locale === "no"
      ? "nb-NO"
      : locale === "sv"
      ? "sv-SE"
      : locale === "da"
      ? "da-DK"
      : "en-US";
  const now = new Date();
  return (
    <div
      data-testid="register-result-panel"
      className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 backdrop-blur-xl p-5 animate-fade-in"
    >
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
        <h3 className="text-sm font-semibold text-emerald-200">
          {t("register.result_title")}
        </h3>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_full_name")}
          </dt>
          <dd className="text-white">
            {form.firstName} {form.lastName}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_email")}
          </dt>
          <dd className="text-white font-mono">{form.email}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_subdomain")}
          </dt>
          <dd className="text-white font-mono">
            {form.subdomain}.kodovault.no
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_plan")}
          </dt>
          <dd className="text-white font-mono">{planId}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_lifecycle")}
          </dt>
          <dd className="text-white">
            {form.lifecycleEmails
              ? t("admin_tenants.lifecycle_on")
              : t("admin_tenants.lifecycle_off")}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_submitted_at")}
          </dt>
          <dd className="text-white font-mono">
            {now.toLocaleString(bcp47)}
          </dd>
        </div>
        <div className="flex flex-col sm:col-span-2">
          <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
            {t("register.result_next_step")}
          </dt>
          <dd className="text-white/85 font-mono break-all">
            POST /api/register {`{ ...payload above }`}
          </dd>
        </div>
      </dl>
      <p className="mt-4 pt-3 border-t border-emerald-400/20 text-[11px] text-white/55">
        {t("register.result_stub_note")}
      </p>
    </div>
  );
}

