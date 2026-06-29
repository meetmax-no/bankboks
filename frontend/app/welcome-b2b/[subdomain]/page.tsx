"use client";
/**
 * Ko | Do · Vault — Iter 20.6 / D-119 (2026-06-29) — B2B Velkomstskjerm
 *
 * `/welcome-b2b/[subdomain]?parent=<prefix>&locale=<no|sv|da|en>`
 *
 * Vises ETTER `/invite/accept` (per user-svar 1=A: enkel, ikke hybrid)
 * og FØR redirect til ansatt sitt subdomene der de setter master-passord.
 *
 * Formålet er et tillitsbyggende øyeblikk:
 *   1. Forklare zero-knowledge — arbeidsgiver ser IKKE passordene dine
 *   2. Forklare hva am-admin KAN se (admin-notater de selv skriver)
 *   3. Påpeke at master-passord ikke er gjenopprettbart
 *   4. Påpeke at backup tilhører ansatte, ikke arbeidsgiver
 *
 * Pure static (ingen DB-lookup). Leser `parent`/`locale` fra URL.
 * Subdomenet kommer fra route-param.
 *
 * D-119 (2026-06-29): Aurora-gradient som bakgrunn (matcher /invite +
 * am-admin-login for konsistent identitet på public touch-points).
 */
import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n-context";
import {
  ShieldCheck,
  EyeOff,
  KeyRound,
  Download,
  ArrowRight,
} from "lucide-react";
import { findGradient } from "@/lib/settings/background-gradients";

const DEFAULT_GRADIENT_CSS =
  findGradient("aurora")?.css ?? "#0a0e1a";

type SupportedLocale = "no" | "sv" | "da" | "en";

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return value === "no" || value === "sv" || value === "da" || value === "en";
}

const PREFIX_RX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const SUBDOMAIN_RX = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export default function WelcomeB2BPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = use(params);
  const searchParams = useSearchParams();
  const parent = searchParams.get("parent") ?? "";
  const urlLocale = searchParams.get("locale");
  const { t, setLocale } = useLocale();

  // Synk URL-locale med kontekst (slik at neste mount viser riktig språk
  // også på subdomenet etter redirect). useEffect — IKKE useMemo —
  // siden dette er en side-effekt (setLocale), ikke en memoization.
  // Per iter18 MEDIUM-fix.
  useEffect(() => {
    if (isSupportedLocale(urlLocale)) {
      setLocale(urlLocale);
    }
  }, [urlLocale, setLocale]);

  // Validering — vi viser kun en feilskjerm hvis input er åpenbart feil.
  const validSubdomain = SUBDOMAIN_RX.test(subdomain.toLowerCase());
  const validParent = parent === "" || PREFIX_RX.test(parent.toLowerCase());

  if (!validSubdomain || !validParent) {
    return (
      <main
        className="min-h-screen text-white flex items-center justify-center px-4"
        style={{ background: DEFAULT_GRADIENT_CSS }}
        data-testid="welcome-b2b-invalid"
      >
        <div className="max-w-md text-center">
          <p className="text-rose-300 text-sm">
            {t("welcome_b2b.error_invalid_url")}
          </p>
        </div>
      </main>
    );
  }

  function handleContinue() {
    const host = window.location.host.replace(/^www\./, "");
    const proto = window.location.protocol;
    // Iter18 HIGH-fix: tidligere brukte vi `host.replace(/^[^.]+\./, '')`
    // for å hente root, men det brakk på apex (`kodovault.no` →
    // `kodovault.no.replace('kodovault.', '')` = `no`). Vi sjekker nå
    // eksplisitt om vi er på et kodovault.no-domain (apex eller noen
    // subdomain) og hardkoder root.
    if (host === "kodovault.no" || host.endsWith(".kodovault.no")) {
      window.location.href = `${proto}//${subdomain}.kodovault.no`;
    } else {
      // Lokalt utviklings-/preview-fallback — gå til "/" på samme host
      window.location.href = "/";
    }
  }

  const bullets: Array<{
    icon: typeof ShieldCheck;
    titleKey: string;
    bodyKey: string;
  }> = [
    {
      icon: EyeOff,
      titleKey: "welcome_b2b.bullet1_title",
      bodyKey: "welcome_b2b.bullet1_body",
    },
    {
      icon: ShieldCheck,
      titleKey: "welcome_b2b.bullet2_title",
      bodyKey: "welcome_b2b.bullet2_body",
    },
    {
      icon: KeyRound,
      titleKey: "welcome_b2b.bullet3_title",
      bodyKey: "welcome_b2b.bullet3_body",
    },
    {
      icon: Download,
      titleKey: "welcome_b2b.bullet4_title",
      bodyKey: "welcome_b2b.bullet4_body",
    },
  ];

  return (
    <main
      className="min-h-screen text-white py-12 px-4"
      style={{ background: DEFAULT_GRADIENT_CSS }}
      data-testid="welcome-b2b-page"
    >
      <div className="max-w-xl mx-auto">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-wider text-indigo-300/85 mb-2">
            {t("welcome_b2b.eyebrow")}
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight">
            {t("welcome_b2b.heading")}
          </h1>
          {parent && (
            <p
              className="mt-3 text-sm text-white/65"
              data-testid="welcome-b2b-parent-line"
            >
              {t("welcome_b2b.invited_by_prefix")}{" "}
              <span className="text-white font-medium">{parent}</span>
              {". "}
              {t("welcome_b2b.invited_by_suffix")}
            </p>
          )}
        </header>

        <section
          className="space-y-4 mb-8"
          data-testid="welcome-b2b-bullets"
        >
          {bullets.map((b, i) => {
            const Icon = b.icon;
            return (
              <div
                key={i}
                className="flex gap-3 bg-white/[0.03] border border-white/10 rounded-xl p-4"
                data-testid={`welcome-b2b-bullet-${i + 1}`}
              >
                <Icon
                  className="h-5 w-5 text-indigo-300 flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-sm font-medium text-white">
                    {t(b.titleKey)}
                  </h2>
                  <p className="mt-1 text-xs text-white/65 leading-relaxed">
                    {t(b.bodyKey)}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        <button
          onClick={handleContinue}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors"
          data-testid="welcome-b2b-continue-btn"
        >
          {t("welcome_b2b.btn_continue")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>

        <p
          className="text-xs text-white/40 text-center mt-4"
          data-testid="welcome-b2b-next-step"
        >
          {t("welcome_b2b.next_step_hint")}
        </p>
      </div>
    </main>
  );
}
