"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Config-verktøy (D-060)
 *
 * Permanent admin-verktøy plassert i TenantViewer-toolbaren. Tre modi:
 *
 *   skip-existing  : recovery — kun migrer tenants UTEN egen client-config
 *   merge          : deep merge default → tenant, tenant-wins (DEFAULT)
 *   overwrite-all  : full reset (krever bekreftelse)
 *
 * Dry-run alltid mulig først. Resultat-tabell viser per-tenant action.
 */
import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Wrench,
  X,
} from "lucide-react";

type Mode = "skip-existing" | "merge" | "overwrite-all";

interface MigrationRow {
  subdomain: string;
  action: string;
  reason?: string;
}

interface MigrationSummary {
  dryRun: boolean;
  mode: Mode;
  total: number;
  migrated: number;
  merged: number;
  overwritten: number;
  skipped: number;
  errors: number;
  rows: MigrationRow[];
}

const MODE_LABELS: Record<Mode, string> = {
  merge: "Merge (tenant-wins) — anbefalt",
  "skip-existing": "Skip eksisterende (recovery)",
  "overwrite-all": "Overskriv ALLE ⚠",
};

const MODE_DESC: Record<Mode, string> = {
  merge:
    "Legger til nye felter fra default.json i alle tenants. Tenants egne endringer bevares.",
  "skip-existing":
    "Bygger client-config fra default for tenants som ennå ikke har en. Eksisterende tenants røres ikke.",
  "overwrite-all":
    "Sletter alle tenant-endringer og restarter fra default.json. Tenant.notes audit-logges.",
};

const ACTION_STYLE: Record<string, string> = {
  migrated: "bg-emerald-500/10 text-emerald-300",
  merged: "bg-emerald-500/10 text-emerald-300",
  overwritten: "bg-amber-500/10 text-amber-300",
  skipped: "bg-white/5 text-white/55",
  would_migrate: "bg-blue-500/10 text-blue-300",
  would_merge: "bg-blue-500/10 text-blue-300",
  would_overwrite: "bg-amber-500/10 text-amber-300",
  error: "bg-red-500/10 text-red-300",
};

export function ConfigToolsButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("merge");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (busy) return;
    if (!dryRun && mode === "overwrite-all") {
      const total = result?.total ?? "alle";
      if (
        !window.confirm(
          `OVERSKRIV ${total} tenants med default.json?\n\n` +
            `Dette sletter ALLE per-tenant endringer i client-config.\n` +
            `Action audit-logges i tenant.notes.\n\nFortsette?`,
        )
      ) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    if (dryRun) setResult(null);
    try {
      const res = await fetch(
        `/api/admin/migrate-client-configs?mode=${encodeURIComponent(mode)}`,
        {
          method: dryRun ? "GET" : "POST",
          credentials: "same-origin",
        },
      );
      const body = (await res.json()) as MigrationSummary | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `HTTP ${res.status}`);
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="config-tools-toggle-btn"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1.5 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1.5 transition"
        title="Bulk-administrer client-configs"
      >
        <Wrench className="h-3 w-3" />
        Config-verktøy
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="config-tools-toggle-btn"
        onClick={() => {
          setOpen(false);
          setResult(null);
          setError(null);
        }}
        className="text-xs px-2 py-1.5 rounded-md bg-purple-500/20 text-purple-200 border border-purple-500/40 flex items-center gap-1.5 transition"
      >
        <X className="h-3 w-3" />
        Lukk
      </button>
      <div
        data-testid="config-tools-panel"
        className="absolute right-0 top-full mt-1.5 z-20 w-[480px] p-4 rounded-lg bg-neutral-900 border border-white/15 shadow-2xl space-y-3"
      >
        <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
          Client-config bulk-verktøy
        </div>

        {/* Modus-selector */}
        <fieldset className="space-y-1.5">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <label
              key={m}
              className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition ${
                mode === m
                  ? "bg-white/10 border border-white/20"
                  : "bg-black/30 border border-transparent hover:bg-black/40"
              }`}
            >
              <input
                type="radio"
                data-testid={`config-tools-mode-${m}`}
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setResult(null);
                }}
                className="mt-0.5"
              />
              <span className="flex-1">
                <span className="text-xs font-mono text-white/90">
                  {MODE_LABELS[m]}
                </span>
                <span className="block text-[10px] text-white/55 mt-0.5">
                  {MODE_DESC[m]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Action-knapper */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="config-tools-dry-run-btn"
            onClick={() => void run(true)}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Dry-run
          </button>
          <button
            type="button"
            data-testid="config-tools-run-btn"
            onClick={() => void run(false)}
            disabled={busy}
            className={`text-xs px-3 py-1.5 rounded-md disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition ${
              mode === "overwrite-all"
                ? "bg-red-600 hover:bg-red-500"
                : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Kjør
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            data-testid="config-tools-error"
            className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
          >
            <AlertCircle className="h-3 w-3 inline mr-1" />
            {error}
          </div>
        )}

        {/* Resultat */}
        {result && (
          <div data-testid="config-tools-result" className="space-y-2">
            <div className="text-[10px] font-mono text-white/65 flex items-center gap-3 flex-wrap">
              {result.dryRun ? (
                <span className="text-blue-300">DRY-RUN</span>
              ) : (
                <span className="text-emerald-300 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  UTFØRT
                </span>
              )}
              <span>{result.total} totalt</span>
              {result.migrated > 0 && (
                <span className="text-emerald-300">
                  {result.migrated} migrert
                </span>
              )}
              {result.merged > 0 && (
                <span className="text-emerald-300">
                  {result.merged} merget
                </span>
              )}
              {result.overwritten > 0 && (
                <span className="text-amber-300">
                  {result.overwritten} overskrevet
                </span>
              )}
              {result.skipped > 0 && (
                <span className="text-white/55">
                  {result.skipped} hoppet over
                </span>
              )}
              {result.errors > 0 && (
                <span className="text-red-300">{result.errors} feil</span>
              )}
            </div>
            <ul className="max-h-60 overflow-y-auto space-y-1">
              {result.rows.map((row, i) => (
                <li
                  key={i}
                  data-testid={`config-tools-row-${row.subdomain}`}
                  className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] font-mono ${
                    ACTION_STYLE[row.action] ?? "bg-white/5 text-white/55"
                  }`}
                >
                  <span className="flex-1 truncate">{row.subdomain}</span>
                  <span className="text-[10px] uppercase">{row.action}</span>
                  {row.reason && (
                    <span
                      className="text-[10px] text-white/40 truncate max-w-[180px]"
                      title={row.reason}
                    >
                      {row.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-[10px] text-white/40 leading-relaxed pt-1 border-t border-white/10 flex items-start gap-1">
          <ChevronDown className="h-3 w-3 mt-0.5 flex-shrink-0" />
          Hver mutasjon appender notis til tenant.notes for audit-trail.
          Tenants ser endringer innen 30 sek (browser-cache).
        </div>
      </div>
    </div>
  );
}
