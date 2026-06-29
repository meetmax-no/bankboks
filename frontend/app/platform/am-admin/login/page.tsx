"use client";
/**
 * Ko | Do · Vault — Iter 20.2 — am-admin login-side
 *
 * Rute: `/platform/am-admin/login` på `<prefix>-admin.kodovault.no`.
 * Public (middleware lar den passere uten gyldig session).
 *
 * Enkel epost + passord-form med rate-limit-håndtering og
 * suspendert-konto-melding. Ved suksess: redirect til `/platform/am-admin`.
 */
import { Suspense, useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n-context";
import {
  loadKonsollBgPreference,
  KONSOLL_BG_DEFAULT,
  type KonsollBgPreference,
} from "@/lib/platform/konsoll-bg-preference";
import { findGradient } from "@/lib/settings/background-gradients";

function getPrefixFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.host.toLowerCase().split(":")[0];
  if (host.endsWith("-admin.kodovault.no")) {
    return host.slice(0, -"-admin.kodovault.no".length);
  }
  return null;
}

function LoginForm() {
  const params = useSearchParams();
  const { t } = useLocale();
  const fallbackPrefix = params.get("orgAdminPrefix");

  const [prefix, setPrefix] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [bgPref, setBgPref] = useState<KonsollBgPreference>(KONSOLL_BG_DEFAULT);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrefix(getPrefixFromHost() ?? fallbackPrefix);
    // D-114: hydrer bg-pref fra localStorage (samme nøkkel som innlogget
    // dashbord). Brukere som har vært innlogget før får samme bilde tilbake.
    setBgPref(loadKonsollBgPreference());
  }, [fallbackPrefix]);

  // D-114: hent firmanavn via public branding-endpoint så bruker ser
  // HVILKEN org de logger inn på (ikke bare prefix-koden).
  useEffect(() => {
    if (!prefix) return;
    let cancelled = false;
    void fetch(`/api/am-admin/branding/${encodeURIComponent(prefix)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { companyName?: string | null } | null) => {
        if (!cancelled && data?.companyName) {
          setCompanyName(data.companyName);
        }
      })
      .catch(() => {
        /* graciøst — fall tilbake til prefix-visning */
      });
    return () => {
      cancelled = true;
    };
  }, [prefix]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const url = fallbackPrefix
          ? `/api/am-admin/auth/login?orgAdminPrefix=${encodeURIComponent(fallbackPrefix)}`
          : "/api/am-admin/auth/login";
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        // Iter 20.9 (Mike 2026-06-27): Parse body trygt — hvis serveren
        // returnerer 500 med ikke-JSON (Vercel edge-error, runtime-crash),
        // skal vi ikke maske ekte status som "nettverksfeil".
        let data: { error?: string; detail?: string } = {};
        try {
          data = await res.json();
        } catch {
          // Body var ikke gyldig JSON — typisk Vercel HTML-feil-side.
        }
        if (!res.ok) {
          const fallback = `${res.status} ${res.statusText || "Server-feil"}`;
          setError(
            data.detail || data.error || fallback || t("am_admin.login_failed_default"),
          );
          return;
        }
        // Suksess — naviger til dashbord. Iter 20.9 (D-097c, Mike 2026-06-28):
        // På am-admin-host (mm-admin.kodovault.no/…) er brukeren ALLEREDE
        // på "/" (clean URL fra middleware-rewrite). `router.push("/")`
        // ville bare ha hit Next.js sin client-cache for login-RSC og IKKE
        // re-evaluert middleware med den nye cookien — resultat: skjemaet
        // henger til en manuell cmd+R refresher. Hard navigasjon tvinger
        // server-roundtrip og middleware rewriter til dashbordet.
        if (fallbackPrefix) {
          // Dev/preview-host: query-param-fallback, behold path eksplisitt.
          window.location.assign(
            `/platform/am-admin?orgAdminPrefix=${encodeURIComponent(fallbackPrefix)}`,
          );
        } else {
          window.location.assign("/");
        }
        return;
      } catch {
        setError(t("am_admin.login_network_error"));
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, fallbackPrefix, t],
  );

  // D-114: beregn bg fra preference (samme mønster som dashbord linje 159-174)
  const bg = (() => {
    const url = bgPref.fixedUrl;
    if (!url) {
      const aurora = findGradient("aurora");
      return { kind: "gradient" as const, css: aurora?.css ?? "#0b0e14" };
    }
    if (url.startsWith("gradient:")) {
      const gid = url.slice("gradient:".length);
      const g = findGradient(gid);
      return { kind: "gradient" as const, css: g?.css ?? "#0b0e14" };
    }
    return { kind: "photo" as const, url };
  })();
  const overlay = bgPref.overlay ?? 0.05;

  return (
    <main
      className="relative min-h-screen text-white/90 flex items-center justify-center p-6 overflow-hidden"
      style={bg.kind === "gradient" ? { background: bg.css } : { background: "#0b0e14" }}
      data-testid="am-admin-login-page"
    >
      {bg.kind === "photo" && (
        <div className="fixed inset-0 z-0" aria-hidden="true">
          <Image
            key={`konsoll-login-bg-${bg.url}`}
            src={bg.url}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{ background: `rgba(0,0,0,${overlay})` }}
          />
        </div>
      )}
      <div className="relative z-10 w-full max-w-md">
        <header className="mb-8 text-center">
          <h1
            className="text-3xl font-semibold tracking-tight mb-2"
            data-testid="am-admin-login-company"
          >
            {companyName ?? t("am_admin.dashboard_title")}
          </h1>
          <p className="text-sm text-white/55">
            {prefix ? (
              <>
                {t("am_admin.login_intro_with_prefix")}
                <span className="font-mono text-white/80">{prefix}</span>
              </>
            ) : (
              t("am_admin.login_intro_no_prefix")
            )}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white/[0.03] border border-white/10 rounded-2xl p-6"
          data-testid="am-admin-login-form"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-white/65 mb-1.5"
            >
              {t("am_admin.login_email_label")}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm"
              data-testid="am-admin-login-email"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-white/65 mb-1.5"
            >
              {t("am_admin.login_password_label")}
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm"
              data-testid="am-admin-login-password"
            />
          </div>

          {error && (
            <div
              className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2"
              data-testid="am-admin-login-error"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="w-full py-2.5 rounded-lg bg-white text-[#0b0e14] font-medium text-sm hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            data-testid="am-admin-login-submit"
          >
            {submitting ? t("am_admin.login_submitting") : t("am_admin.login_submit_btn")}
          </button>
        </form>

        <footer className="mt-6 text-center text-xs text-white/40">
          {t("am_admin.login_footer")}
        </footer>
      </div>
    </main>
  );
}

export default function AmAdminLoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0b0e14] text-white/55 flex items-center justify-center text-sm">
          …
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
