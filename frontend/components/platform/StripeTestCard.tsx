"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 14 — Admin-only test-kort for Stripe-flyten
 *
 * Lar Mike trigge en full e2e-Stripe-flyt direkte fra admin-modulen,
 * uten å gå via /register-skjemaet (som krever Cloudflare Turnstile).
 *
 * Klikk → POST /api/admin/test-register-paid → window.location = url
 * (Stripe Checkout). Etter Stripe Checkout redirecter Stripe tilbake til
 * /billing/success?subdomain=<auto-generert>&session_id=... der
 * provisjonerings-mellomsiden (Iter 14) tar over.
 *
 * Synlig kun via /platform/admin (middleware-beskyttet).
 */
import { useState } from "react";
import { CreditCard, Loader2, ExternalLink, AlertCircle } from "lucide-react";

type Plan = "monthly" | "yearly";

interface TestResponse {
  ok?: boolean;
  subdomain?: string;
  email?: string;
  plan?: Plan;
  url?: string;
  sessionId?: string;
  error?: string;
  detail?: string;
  stage?: string;
}

export function StripeTestCard() {
  const [busy, setBusy] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TestResponse | null>(null);

  async function runTest(plan: Plan) {
    setBusy(plan);
    setError(null);
    try {
      const res = await fetch("/api/admin/test-register-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json().catch(() => ({}))) as TestResponse;
      if (!res.ok || !body.ok || !body.url) {
        setError(
          `${body.error ?? `HTTP ${res.status}`}${body.stage ? ` (${body.stage})` : ""}${body.detail ? `: ${body.detail}` : ""}`,
        );
        setBusy(null);
        return;
      }
      setLastResult(body);
      // Liten delay så bruker rekker å se subdomain + email-info
      // før vi redirecter til Stripe.
      setTimeout(() => {
        window.location.href = body.url!;
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network_error");
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="stripe-test-card"
      className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/5 to-amber-500/0 backdrop-blur-xl p-5"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-full bg-amber-500/15 border border-amber-400/30 p-2 shrink-0">
          <CreditCard className="h-4 w-4 text-amber-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            data-testid="stripe-test-card-title"
            className="text-sm font-semibold tracking-tight text-amber-100"
          >
            Test Stripe-flyt (admin-only)
          </h3>
          <p className="text-xs text-white/60 mt-0.5 leading-relaxed">
            Oppretter en `stripe-test-*` tenant og redirecter til Stripe
            Checkout. Bypasser Turnstile + rate-limit. Bruk Stripe-testkort{" "}
            <span className="font-mono text-amber-200/90">
              4242 4242 4242 4242
            </span>{" "}
            (utgår fritt, CVC fritt) for å fullføre flyten.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="stripe-test-monthly-btn"
          disabled={busy !== null}
          onClick={() => runTest("monthly")}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 disabled:cursor-not-allowed text-black text-sm font-semibold transition"
        >
          {busy === "monthly" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          Test månedlig (115 kr/mnd)
        </button>

        <button
          type="button"
          data-testid="stripe-test-yearly-btn"
          disabled={busy !== null}
          onClick={() => runTest("yearly")}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-amber-400/40 hover:border-amber-300/60 hover:bg-amber-500/5 disabled:opacity-50 disabled:cursor-not-allowed text-amber-200 text-sm font-medium transition"
        >
          {busy === "yearly" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CreditCard className="h-4 w-4" />
          )}
          Test årlig (1 104 kr/år)
        </button>
      </div>

      {error && (
        <div
          data-testid="stripe-test-error"
          className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 flex items-start gap-2 text-xs text-rose-200"
        >
          <AlertCircle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
          <div className="font-mono break-all">{error}</div>
        </div>
      )}

      {lastResult?.ok && busy && (
        <div
          data-testid="stripe-test-redirecting"
          className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 flex items-start gap-2 text-xs text-emerald-200"
        >
          <ExternalLink className="h-4 w-4 text-emerald-300 shrink-0 mt-0.5" />
          <div>
            Opprettet:{" "}
            <span
              data-testid="stripe-test-result-subdomain"
              className="font-mono text-emerald-100"
            >
              {lastResult.subdomain}
            </span>{" "}
            ({lastResult.email}). Sender deg til Stripe Checkout…
          </div>
        </div>
      )}
    </div>
  );
}
