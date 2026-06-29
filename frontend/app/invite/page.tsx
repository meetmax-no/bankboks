"use client";

/**
 * Ko | Do · Vault — v4.3 (D-115, 2026-06-29) — /invite
 *
 * Public landingsside for ansatt-invitasjoner. Leser `?token=<uuid>`,
 * validerer mot /api/invite/validate, viser skjema og kaller
 * /api/invite/accept.
 *
 * D-115 (2026-06-29) — endringer:
 *   1. Branding: henter `companyName` via `/api/am-admin/branding/[prefix]`
 *      og viser den i headeren. STRENGT påkrevd — hvis endepunktet ikke
 *      returnerer et navn, viser vi en feilmelding (ingen prefix-fallback).
 *   2. Default-gradient (aurora) som bakgrunn — slik at siden ikke ser
 *      ut som en kontekstløs svart side.
 *   3. ProvisioningTracker (mode="public") settes inn MELLOM submit og
 *      welcome-b2b. Tidligere redirectet vi til `/welcome-b2b/...` umiddel-
 *      bart, men Vercel/Upstash-pod kunne fortsatt være under bygging —
 *      "Fortsett →"-knappen der ledet da til 404/wrong_pod. Nå venter vi
 *      til `vault_live` (eller `provisioning_failed`) før vi går videre.
 *
 * Subdomenet er låst (kan ikke endres av ansatt — det er forhåndsdefinert
 * av admin). E-post er forhåndsutfylt hvis admin satte den ved
 * invitasjons-opprettelse. Master-passord settes ved første innlogging
 * på <subdomain>.kodovault.no (zero-knowledge, D-001).
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { LocaleRadioGroup } from "@/components/platform/LocaleRadioGroup";
import { ProvisioningTracker } from "@/components/platform/ProvisioningTracker";
import { findGradient } from "@/lib/settings/background-gradients";

interface InvitePayload {
  token: string;
  subdomain: string;
  parentTenant: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  locale: "no" | "sv" | "da" | "en" | null;
  expiresAt: string;
}

type ValidateState =
  | { state: "loading" }
  | { state: "ok"; invite: InvitePayload }
  | { state: "error"; error: string };

type BrandingState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; companyName: string }
  | { state: "error"; error: string };

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "Invitasjonslenken mangler en token.",
  not_found: "Invitasjonslenken er ugyldig.",
  expired:
    "Invitasjonslenken er utløpt. Kontakt din administrator for en ny invitasjon.",
  already_used: "Denne invitasjonslenken er allerede brukt.",
  rate_limited: "For mange forsøk. Vent et minutt og prøv igjen.",
  parent_not_found: "Bedriftens konto er ikke lenger aktiv. Kontakt administrator.",
  subdomain_taken:
    "Dette subdomenet er ikke lenger tilgjengelig. Kontakt din administrator for en ny invitasjon.",
  max_licenses_reached:
    "Alle lisenser er i bruk. Kontakt din administrator.",
  invalid_email: "Ugyldig e-postadresse.",
  internal_error: "Noe gikk galt. Prøv igjen senere.",
  branding_missing:
    "Vi fant ikke firmaprofilen for denne invitasjonen. Kontakt din administrator.",
  provisioning_failed:
    "Klargjøring av din vault feilet. Ko | Do-teamet er varslet — vent noen minutter og prøv igjen, eller kontakt din administrator.",
};

function errMsg(code: string | undefined): string {
  if (!code) return ERROR_MESSAGES.internal_error;
  return ERROR_MESSAGES[code] ?? `Feil: ${code}`;
}

// D-115: default-gradient brukes på hele siden så den aldri er en bar svart
// flate. Samme aurora-gradient som am-admin-login (D-114).
const DEFAULT_GRADIENT_CSS =
  findGradient("aurora")?.css ?? "#0a0e1a";

export default function InvitePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <InvitePageInner />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: DEFAULT_GRADIENT_CSS }}
    >
      <Loader2 className="h-6 w-6 animate-spin text-white/55" />
    </div>
  );
}

function InvitePageInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [validate, setValidate] = useState<ValidateState>({ state: "loading" });
  const [branding, setBranding] = useState<BrandingState>({ state: "idle" });
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [locale, setLocale] = useState<"no" | "sv" | "da" | "en" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // D-115: "provisioning" = vi har postet /invite/accept og venter på at
  // vault'en blir live. "failed" = vault_live kom aldri — vi viser en feil.
  const [phase, setPhase] = useState<
    "form" | "provisioning" | "failed"
  >("form");

  useEffect(() => {
    if (!token) {
      setValidate({ state: "error", error: "missing_token" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/invite/validate?token=${encodeURIComponent(token)}`,
          { credentials: "omit" },
        );
        const body = (await res.json()) as
          | { ok: true; invite: InvitePayload }
          | { ok: false; error: string };
        if (cancelled) return;
        if (!body.ok) {
          setValidate({ state: "error", error: body.error });
          return;
        }
        setValidate({ state: "ok", invite: body.invite });
        setEmail(body.invite.email ?? "");
        setFirstName(body.invite.firstName ?? "");
        setLastName(body.invite.lastName ?? "");
        setLocale(null);
      } catch (e) {
        if (cancelled) return;
        setValidate({
          state: "error",
          error: e instanceof Error ? e.message : "internal_error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // D-115: hent branding (firmanavn) så snart vi vet parentTenant.
  // STRENGT — ingen fallback til prefix-koden, fordi prefix er teknisk og
  // ikke noe sluttbrukere skal se i et velkomst-flow.
  useEffect(() => {
    if (validate.state !== "ok") return;
    const parent = validate.invite.parentTenant;
    let cancelled = false;
    setBranding({ state: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/am-admin/branding/${encodeURIComponent(parent)}`,
          { credentials: "omit" },
        );
        if (cancelled) return;
        if (!res.ok) {
          setBranding({ state: "error", error: "branding_missing" });
          return;
        }
        const body = (await res.json()) as { companyName?: string | null };
        const name = body?.companyName?.trim();
        if (!name) {
          setBranding({ state: "error", error: "branding_missing" });
          return;
        }
        setBranding({ state: "ok", companyName: name });
      } catch {
        if (cancelled) return;
        setBranding({ state: "error", error: "branding_missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || validate.state !== "ok") return;
    if (locale === null) {
      setSubmitError("Velg språk for kommunikasjon før du fortsetter.");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          email: email.trim().toLowerCase(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          locale,
        }),
      });
      const body = (await res.json()) as
        | { ok: true; subdomain: string }
        | { ok: false; error: string };
      if (!body.ok) {
        setSubmitError(errMsg(body.error));
        return;
      }
      // D-115: i stedet for å redirecte til /welcome-b2b umiddelbart
      // (som tidligere ledet til 404 fordi Vercel-podden ikke var live
      // ennå), bytter vi til "provisioning"-fasen og lar
      // ProvisioningTracker polle /api/status. Redirect skjer først når
      // `vault_live` registreres (onDone(true) under).
      setPhase("provisioning");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "internal_error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleProvisioningDone(success: boolean) {
    if (!success) {
      setPhase("failed");
      return;
    }
    if (validate.state !== "ok" || locale === null) return;
    const parent = validate.invite.parentTenant;
    const sub = validate.invite.subdomain;
    const target = `/welcome-b2b/${encodeURIComponent(sub)}?parent=${encodeURIComponent(parent)}&locale=${encodeURIComponent(locale)}`;
    window.location.href = target;
  }

  const companyName =
    branding.state === "ok" ? branding.companyName : null;

  return (
    <div
      className="min-h-screen text-white flex items-center justify-center px-4 py-10"
      style={{ background: DEFAULT_GRADIENT_CSS }}
      data-testid="invite-page"
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-7 shadow-2xl">
          {/* Header — viser firmanavn (når branding lastet) ELLER en
              uthevet «laster» / feil-melding. Aldri prefix-kode. */}
          <header className="mb-5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45 font-mono mb-1">
              Ko | Do · Vault
            </p>
            <h1
              className="text-xl font-semibold leading-tight"
              data-testid="invite-page-title"
            >
              {companyName ?? (
                <span className="inline-flex items-center gap-2 text-white/55">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Henter firmaprofil…
                </span>
              )}
            </h1>
            {companyName && (
              <p className="text-sm text-white/55 mt-1">
                Aktiver din konto
              </p>
            )}
          </header>

          {/* Validering av token kjører parallelt med branding-fetch. */}
          {validate.state === "loading" && (
            <div
              className="flex items-center gap-2 text-white/65 text-sm"
              data-testid="invite-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Verifiserer invitasjonslenke…
            </div>
          )}

          {validate.state === "error" && (
            <div
              data-testid="invite-error"
              className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{errMsg(validate.error)}</span>
            </div>
          )}

          {/* Branding-feil = streng stopp. Vi viser IKKE skjemaet hvis vi
              ikke kan vise hvilken firma-konto invitasjonen gjelder. */}
          {validate.state === "ok" && branding.state === "error" && (
            <div
              data-testid="invite-branding-error"
              className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{errMsg(branding.error)}</span>
            </div>
          )}

          {/* SKJERM 1: Skjema — kun når token er OK, branding er OK og vi
              ikke har sendt skjemaet ennå. */}
          {validate.state === "ok" &&
            branding.state === "ok" &&
            phase === "form" && (
              <form
                onSubmit={onSubmit}
                className="space-y-4"
                data-testid="invite-form"
              >
                <div>
                  <label className="block text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5">
                    Subdomene (låst)
                  </label>
                  <div
                    data-testid="invite-subdomain-locked"
                    className="font-mono text-sm px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-white/85"
                  >
                    {validate.invite.subdomain}.kodovault.no
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="invite-email"
                    className="block text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5"
                  >
                    E-post
                  </label>
                  <input
                    id="invite-email"
                    data-testid="invite-email-input"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-sm text-white placeholder-white/30 focus:border-blue-500 focus:outline-none transition"
                    placeholder="navn@firma.no"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="invite-firstname"
                      className="block text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5"
                    >
                      Fornavn
                    </label>
                    <input
                      id="invite-firstname"
                      data-testid="invite-firstname-input"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-sm text-white placeholder-white/30 focus:border-blue-500 focus:outline-none transition"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="invite-lastname"
                      className="block text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5"
                    >
                      Etternavn
                    </label>
                    <input
                      id="invite-lastname"
                      data-testid="invite-lastname-input"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-sm text-white placeholder-white/30 focus:border-blue-500 focus:outline-none transition"
                    />
                  </div>
                </div>

                <LocaleRadioGroup
                  label="Velg språk på mail og kommunikasjon fra oss"
                  value={locale}
                  onChange={setLocale}
                  disabled={submitting}
                />

                <p className="text-xs text-white/45 leading-relaxed">
                  Master-passord settes ved første innlogging på{" "}
                  <span className="font-mono text-white/65">
                    {validate.invite.subdomain}.kodovault.no
                  </span>
                  .
                </p>

                {submitError && (
                  <div
                    data-testid="invite-submit-error"
                    className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
                  >
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{submitError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="invite-submit-btn"
                  disabled={submitting || !email.trim()}
                  className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-not-allowed text-white text-sm font-medium transition flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? "Oppretter konto…" : "Aktiver konto"}
                </button>
              </form>
            )}

          {/* MELLOM-SKJERM: provisjonering — venter på vault_live før vi
              går videre til /welcome-b2b. ProvisioningTracker har sin egen
              "Åpne vault"-knapp, men den får aldri vist seg her fordi
              `handleProvisioningDone` redirecter umiddelbart når
              `onDone(true)` fyrer. */}
          {validate.state === "ok" && phase === "provisioning" && (
            <div data-testid="invite-provisioning">
              <p className="text-sm text-white/75 mb-4 leading-relaxed">
                Vi setter opp din vault. Dette tar typisk 1–3 minutter — du
                blir sendt videre automatisk så snart alt er klart.
              </p>
              <ProvisioningTracker
                subdomain={validate.invite.subdomain}
                mode="public"
                onDone={handleProvisioningDone}
              />
            </div>
          )}

          {/* Mislykket provisjonering — bruker kan ikke gjøre noe selv,
              men vi viser tydelig hva som skjedde og hva som skal til. */}
          {phase === "failed" && (
            <div
              data-testid="invite-provisioning-failed"
              className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{errMsg("provisioning_failed")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
