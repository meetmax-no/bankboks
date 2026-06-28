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
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/lib/i18n-context";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrefix(getPrefixFromHost() ?? fallbackPrefix);
  }, [fallbackPrefix]);

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

  return (
    <main
      className="min-h-screen bg-[#0b0e14] text-white/90 flex items-center justify-center p-6"
      data-testid="am-admin-login-page"
    >
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">
            {t("am_admin.dashboard_title")}
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
