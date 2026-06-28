"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /invite (D-056)
 *
 * Public landingsside for ansatt-invitasjoner. Leser `?token=<uuid>`,
 * validerer mot /api/invite/validate, viser skjema og kaller
 * /api/invite/accept.
 *
 * Subdomenet er låst (kan ikke endres av ansatt — det er forhåndsdefinert
 * av admin). E-post er forhåndsutfylt hvis admin satte den ved
 * invitasjons-opprettelse. Master-passord settes ved første innlogging
 * på <subdomain>.kodovault.no (zero-knowledge, D-001).
 *
 * Etter vellykket POST redirecter vi til <subdomain>.kodovault.no.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { LocaleRadioGroup } from "@/components/platform/LocaleRadioGroup";

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
};

function errMsg(code: string | undefined): string {
  if (!code) return ERROR_MESSAGES.internal_error;
  return ERROR_MESSAGES[code] ?? `Feil: ${code}`;
}

export default function InvitePage() {
  return (
    <Suspense fallback={<Fallback />}>
      <InvitePageInner />
    </Suspense>
  );
}

function Fallback() {
  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-white/55" />
    </div>
  );
}

function InvitePageInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [validate, setValidate] = useState<ValidateState>({ state: "loading" });
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [locale, setLocale] = useState<"no" | "sv" | "da" | "en" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || validate.state !== "ok") return;
    // Iter 19.9 Fase 2: blokker submit hvis locale ikke valgt
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
      setSuccess(true);
      // Iter 20.6: For B2B-invitasjoner (alle invites er per definisjon B2B
      // i Iter 20-arkitekturen), redirect via velkomstskjermen som forklarer
      // zero-knowledge-modellen og hva am-admin kan/ikke kan se. Skjermen
      // har en "Fortsett →"-knapp som tar dem videre til subdomenet der
      // de setter master-passord.
      if (validate.state === "ok") {
        const parent = validate.invite.parentTenant;
        const target = `/welcome-b2b/${encodeURIComponent(body.subdomain)}?parent=${encodeURIComponent(parent)}&locale=${encodeURIComponent(locale)}`;
        window.location.href = target;
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "internal_error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-7">
          <h1 className="text-xl font-mono mb-1" data-testid="invite-page-title">
            Ko | Do · Vault
          </h1>
          <p className="text-sm text-white/55 mb-5">Aktiver din konto</p>

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

          {validate.state === "ok" && !success && (
            <form onSubmit={onSubmit} className="space-y-4" data-testid="invite-form">
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

          {success && (
            <div
              data-testid="invite-success"
              className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300"
            >
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Konto opprettet. Sender deg til vault…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
