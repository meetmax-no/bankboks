"use client";
/**
 * Ko | Do · Vault — D-149 (2026-02) — Analytics diagnose-verktøy
 *
 * Brukes fra Test Tools for å diagnostisere hvorfor dailyActivity er
 * tom/null på tvers av tenants. To testmoduser:
 *
 *   1) RPC self-test — kaller /api/admin/analytics/diagnose (GET). Verifiserer
 *      at admin-pod's INTERNAL_RPC_SECRET matcher /api/internal/bump-activity.
 *
 *   2) Manuell bump — kaller /api/admin/analytics/diagnose (POST) med
 *      subdomain + kind. Kaller bumpDailyActivity DIREKTE (ingen RPC).
 *      Verifiserer at central-Upstash-write-path fungerer.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2, RefreshCw, Zap } from "lucide-react";

type DiagResponse = Record<string, unknown>;

export function AnalyticsDiagnoseCard() {
  const [subdomain, setSubdomain] = useState("");
  const [kind, setKind] = useState<"unlocks" | "writes" | "reads">("reads");
  const [count, setCount] = useState<number>(1);
  const [rpcResult, setRpcResult] = useState<DiagResponse | null>(null);
  const [bumpResult, setBumpResult] = useState<DiagResponse | null>(null);
  const [busy, setBusy] = useState<"rpc" | "bump" | null>(null);

  async function runRpcSelfTest() {
    setBusy("rpc");
    setRpcResult(null);
    try {
      const res = await fetch(`/api/admin/analytics/diagnose`, {
        credentials: "include",
      });
      const data = (await res.json()) as DiagResponse;
      setRpcResult(data);
      if (res.ok && (data.ok as boolean)) {
        toast.success("RPC-pipeline OK");
      } else {
        toast.error("RPC-pipeline feiler — se detaljer");
      }
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  async function runManualBump() {
    if (!subdomain.trim()) {
      toast.error("Skriv inn subdomain først");
      return;
    }
    setBusy("bump");
    setBumpResult(null);
    try {
      const params = new URLSearchParams({
        subdomain: subdomain.trim().toLowerCase(),
        kind,
        count: String(count),
      });
      const res = await fetch(`/api/admin/analytics/diagnose?${params}`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as DiagResponse;
      setBumpResult(data);
      if (res.ok && (data.ok as boolean)) {
        toast.success(`Bumpet ${kind} × ${count} på ${subdomain}`);
      } else {
        toast.error(`Bump feilet: ${data.error as string}`);
      }
    } catch (e) {
      toast.error(`Feil: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4"
      data-testid="analytics-diagnose-card"
    >
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-medium">D-149 Analytics-diagnose</h3>
      </div>
      <p className="text-xs text-white/55">
        Bruk denne når SuperAdmin Analytics viser 0 aktivitet på tvers av
        tenants. Verifiserer om problemet ligger i RPC-pipeline eller
        central-write-path.
      </p>

      {/* RPC self-test */}
      <div className="space-y-2 pt-2 border-t border-white/10">
        <h4 className="text-xs uppercase tracking-wider text-white/45">
          1. RPC self-test
        </h4>
        <p className="text-[11px] text-white/50">
          Tester admin→admin RPC med gjeldende INTERNAL_RPC_SECRET.
        </p>
        <button
          onClick={runRpcSelfTest}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/15 hover:border-white/30 bg-white/[0.03] text-xs disabled:opacity-40"
          data-testid="diag-rpc-selftest-btn"
        >
          {busy === "rpc" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Kjør RPC self-test
        </button>
        {rpcResult && (
          <pre
            className="mt-2 text-[10px] font-mono bg-black/40 border border-white/10 rounded p-3 overflow-auto max-h-64"
            data-testid="diag-rpc-result"
          >
            {JSON.stringify(rpcResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Manuell bump */}
      <div className="space-y-2 pt-3 border-t border-white/10">
        <h4 className="text-xs uppercase tracking-wider text-white/45">
          2. Manuell bump (bypass RPC)
        </h4>
        <p className="text-[11px] text-white/50">
          Kaller bumpDailyActivity direkte fra admin-pod. Om dette virker →
          backend er OK og problemet er RPC fra tenant-pods.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            placeholder="subdomain (f.eks. annelise)"
            className="px-3 py-1.5 rounded-full border border-white/15 bg-white/[0.03] text-xs w-56 placeholder-white/30"
            data-testid="diag-bump-subdomain"
          />
          <select
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as "unlocks" | "writes" | "reads")
            }
            className="px-3 py-1.5 rounded-full border border-white/15 bg-white/[0.03] text-xs"
            data-testid="diag-bump-kind"
          >
            <option value="reads">reads</option>
            <option value="writes">writes</option>
            <option value="unlocks">unlocks</option>
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
            className="px-3 py-1.5 rounded-full border border-white/15 bg-white/[0.03] text-xs w-20"
            data-testid="diag-bump-count"
          />
          <button
            onClick={runManualBump}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-amber-100 text-xs disabled:opacity-40"
            data-testid="diag-bump-btn"
          >
            {busy === "bump" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Zap className="h-3 w-3" />
            )}
            Bump
          </button>
        </div>
        {bumpResult && (
          <pre
            className="mt-2 text-[10px] font-mono bg-black/40 border border-white/10 rounded p-3 overflow-auto max-h-64"
            data-testid="diag-bump-result"
          >
            {JSON.stringify(bumpResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
