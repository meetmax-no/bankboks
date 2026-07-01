"use client";
/**
 * Ko | Do · Vault — D-145 (2026-02) — ConnectivityTestCard
 *
 * En-klikks-verktøy for Mike-admin til å verifisere at
 * `<subdomain>.kodovault.no` faktisk er nåbar via HTTPS. Umiddelbart
 * grønt/rødt-signal — spesielt nyttig for B2B-parents hvor D-144
 * admin-host-attach kan feile failsoft.
 *
 * Plassering:
 *   - TenantViewer "Oversikt"-fanen (alle B2B-parents)
 *   - TenantViewer "Lisens & B2B"-fanen rett over CreateOrgAdminCard
 *
 * Backend: POST /api/admin/tenants/[subdomain]/test-connectivity
 */
import { useState } from "react";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

type ConnectivityStatus =
  | "ok"
  | "unreachable"
  | "tls_error"
  | "http_error"
  | "timeout";

interface ConnectivityResult {
  host: string;
  url: string;
  status: ConnectivityStatus;
  httpStatus: number | null;
  responseTimeMs: number;
  error?: string;
}

export function ConnectivityTestCard({
  subdomain,
  compact = false,
}: {
  subdomain: string;
  /**
   * Compact-modus rendrer knappen inline uten kort-container. Brukes
   * f.eks. inne i eksisterende kort/seksjoner der vi vil ha bare
   * knapp+resultat uten dobbel-ramme.
   */
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectivityResult | null>(null);

  const runTest = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}/test-connectivity`,
        { method: "POST", credentials: "include" },
      );
      const data = (await res.json()) as ConnectivityResult;
      setResult(data);
    } catch (e) {
      setResult({
        host: `${subdomain}.kodovault.no`,
        url: `https://${subdomain}.kodovault.no`,
        status: "unreachable",
        httpStatus: null,
        responseTimeMs: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <button
      onClick={runTest}
      disabled={busy}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-100 text-xs disabled:opacity-50"
      data-testid={`connectivity-test-btn-${subdomain}`}
    >
      {busy ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("connectivity_test.testing")}
        </>
      ) : (
        <>
          <Wifi className="h-3.5 w-3.5" />
          {t("connectivity_test.button")}
        </>
      )}
    </button>
  );

  const resultBadge = result && (
    <ResultBadge result={result} />
  );

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {button}
        {resultBadge}
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 mb-5"
      data-testid={`connectivity-test-card-${subdomain}`}
    >
      <div className="flex items-start gap-3 mb-2">
        <div className="w-8 h-8 shrink-0 rounded-lg bg-sky-500/15 border border-sky-400/30 flex items-center justify-center">
          <Wifi className="h-4 w-4 text-sky-300" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium tracking-tight">
            {t("connectivity_test.heading")}
          </h3>
          <p className="text-[11px] text-white/50 mt-0.5">
            {t("connectivity_test.description").replace(
              "{host}",
              `${subdomain}.kodovault.no`,
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap mt-3">
        {button}
        {resultBadge}
      </div>
    </div>
  );
}

function ResultBadge({ result }: { result: ConnectivityResult }) {
  const { t } = useLocale();
  const isOk = result.status === "ok";

  const colorClasses = isOk
    ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-100"
    : "bg-red-500/15 border-red-400/40 text-red-100";

  const statusLabel = isOk
    ? t("connectivity_test.status_ok")
    : t(`connectivity_test.status_${result.status}`);

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${colorClasses}`}
      data-testid={`connectivity-test-result-${result.status}`}
    >
      {isOk ? (
        <Wifi className="h-3.5 w-3.5" />
      ) : (
        <WifiOff className="h-3.5 w-3.5" />
      )}
      <span className="font-medium">{statusLabel}</span>
      {result.httpStatus !== null && (
        <span className="font-mono opacity-70">
          HTTP {result.httpStatus}
        </span>
      )}
      <span className="font-mono opacity-70">
        {result.responseTimeMs}ms
      </span>
    </div>
  );
}
