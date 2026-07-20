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
  Check,
  CheckCircle2,
  Loader2,
  Wrench,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Mode =
  | "skip-existing"
  | "merge"
  | "overwrite-all"
  | "cascade-from-parent"
  | "smart-merge";

interface MigrationRow {
  subdomain: string;
  action: string;
  reason?: string;
}

interface PathConflict {
  path: string;
  sensitive: boolean;
  defaultValue: unknown;
  tenantsMissing: number;
  tenantsMatchingDefault: number;
  tenantsInConflict: number;
  conflictingSubdomains: string[];
}

interface MigrationSummary {
  dryRun: boolean;
  mode: Mode;
  total: number;
  migrated: number;
  merged: number;
  overwritten: number;
  cascaded: number;
  skipped: number;
  errors: number;
  rows: MigrationRow[];
  conflicts?: PathConflict[];
  smartMerged?: number;
}

const MODE_LABELS: Record<Mode, string> = {
  merge: "Merge (tenant-wins) — legacy",
  "smart-merge": "Smart-merge (konflikt-analyse) — anbefalt",
  "skip-existing": "Skip eksisterende (recovery)",
  "overwrite-all": "Overskriv ALLE ⚠",
  "cascade-from-parent": "Re-cascade SA-mal til alle ansatte",
};

const MODE_DESC: Record<Mode, string> = {
  merge:
    "Legger til nye felter fra default.json i alle tenants. Tenants egne endringer bevares (tenant-wins for ALT).",
  "smart-merge":
    "Analyserer konflikter per path og lar deg velge policy én gang per path (default vs tenant). Skalerer til 50-75 tenants. Sensitive paths (brand, backgrounds, categories) er default på tenant-wins.",
  "skip-existing":
    "Bygger client-config fra default for tenants som ennå ikke har en. Eksisterende tenants røres ikke.",
  "overwrite-all":
    "Sletter alle tenant-endringer og restarter fra default.json. Tenant.notes audit-logges.",
  "cascade-from-parent":
    "Overskriver ALLE eksisterende ansatte med ferskt snapshot av sin SuperAdmin-mal. Bruk når SA endrer branding/priser midt i en periode. Filtreres til én SA via prefix.",
};

const ACTION_STYLE: Record<string, string> = {
  migrated: "bg-emerald-500/10 text-emerald-300",
  merged: "bg-emerald-500/10 text-emerald-300",
  smart_merged: "bg-emerald-500/10 text-emerald-300",
  overwritten: "bg-amber-500/10 text-amber-300",
  cascaded: "bg-emerald-500/10 text-emerald-300",
  skipped: "bg-white/5 text-white/55",
  would_migrate: "bg-blue-500/10 text-blue-300",
  would_merge: "bg-blue-500/10 text-blue-300",
  would_smart_merge: "bg-blue-500/10 text-blue-300",
  would_overwrite: "bg-amber-500/10 text-amber-300",
  would_cascade: "bg-blue-500/10 text-blue-300",
  error: "bg-red-500/10 text-red-300",
};

export function ConfigToolsButton() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("smart-merge");
  // D-128: scope-toggler for skip/merge/overwrite-all. B2B-ansatte er
  // ALDRI inkludert i disse — de styres via cascade-from-parent.
  const [includeB2C, setIncludeB2C] = useState(true);
  const [includeSA, setIncludeSA] = useState(false);
  const [parentScope, setParentScope] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // D-149 (2026-02): policy-map for smart-merge. Nøkkel = path,
  // verdi = "default" (default vinner) eller "tenant" (tenant vinner).
  // Sensitive paths er default på "tenant"; alt annet på "default".
  const [policies, setPolicies] = useState<Record<string, "default" | "tenant">>({});

  // D-149 (2026-02): styled confirm-dialog replaces browser-default
  // window.confirm() which er stygt og ikke matcher branding.
  type ConfirmState = {
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    variant: "default" | "destructive";
    onConfirm: () => void;
  };
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  function setPolicyForPath(path: string, winner: "default" | "tenant") {
    setPolicies((prev) => ({ ...prev, [path]: winner }));
  }

  function bulkSetPolicies(paths: string[], winner: "default" | "tenant") {
    setPolicies((prev) => {
      const next = { ...prev };
      for (const p of paths) next[p] = winner;
      return next;
    });
  }

  async function run(dryRun: boolean) {
    if (busy) return;
    // D-128: minst én scope-toggle må være på for de tre destruktive modusene.
    if (
      mode !== "cascade-from-parent" &&
      !includeB2C &&
      !includeSA
    ) {
      setError(
        "Velg minst én av 'Inkluder B2C' eller 'Inkluder SA' for å kjøre denne modusen.",
      );
      return;
    }

    // D-149: smart-merge pre-check: krever dry-run først
    if (!dryRun && mode === "smart-merge" && !result?.conflicts) {
      setError("Kjør «Dry-run» først for å analysere konflikter og velge policies.");
      return;
    }

    // D-149 (2026-02): destruktive modi krever styled confirm-dialog.
    // Smart-merge uten «default vinner»-policies er ikke destruktivt —
    // hopper over confirm i det tilfellet (samme oppførsel som legacy merge).
    const defaultWinCount =
      mode === "smart-merge"
        ? Object.values(policies).filter((v) => v === "default").length
        : 0;
    const needsConfirm =
      !dryRun &&
      (mode === "overwrite-all" ||
        mode === "cascade-from-parent" ||
        (mode === "smart-merge" && defaultWinCount > 0));

    if (needsConfirm) {
      const total = result?.total ?? "alle";
      let title: string;
      let description: React.ReactNode;
      let confirmLabel: string;
      let variant: "default" | "destructive" = "default";

      if (mode === "overwrite-all") {
        title = `Overskriv ${total} tenants?`;
        description = (
          <>
            <p>
              Dette sletter <strong>ALLE</strong> per-tenant endringer i client-config
              og restarter fra <code>default.json</code>.
            </p>
            <p className="mt-2 text-white/60">
              Alle endringer audit-logges i <code>tenant.notes</code>.
            </p>
          </>
        );
        confirmLabel = "Overskriv alle";
        variant = "destructive";
      } else if (mode === "cascade-from-parent") {
        const scope = parentScope.trim()
          ? `SA '${parentScope.trim()}'`
          : "ALLE SA-organisasjoner";
        title = `Re-cascade SA-mal til ${total}?`;
        description = (
          <>
            <p>
              Overskriver alle ansattes lokale client-config med ferskt snapshot
              fra {scope}.
            </p>
            <p className="mt-2 text-white/60">
              Alle endringer audit-logges i <code>tenant.notes</code>.
            </p>
          </>
        );
        confirmLabel = "Re-cascade";
      } else {
        // smart-merge med default-vinn-paths
        title = `Smart-merge ${total} tenants?`;
        description = (
          <>
            <p>
              {defaultWinCount} path(s) satt til «default vinner». Sensitive
              paths (brand/backgrounds/categories/_meta) er default på «tenant
              vinner» — dobbeltsjekk at du ikke har endret dem uten intensjon.
            </p>
            <p className="mt-2 text-white/60">
              Alle endringer audit-logges i <code>tenant.notes</code>.
            </p>
          </>
        );
        confirmLabel = "Kjør smart-merge";
      }

      setConfirmState({
        open: true,
        title,
        description,
        confirmLabel,
        variant,
        onConfirm: () => {
          setConfirmState(null);
          void executeRun(dryRun);
        },
      });
      return;
    }

    void executeRun(dryRun);
  }

  async function executeRun(dryRun: boolean) {
    setBusy(true);
    setError(null);
    if (dryRun) setResult(null);
    try {
      const params = new URLSearchParams({ mode });
      if (mode === "cascade-from-parent") {
        if (parentScope.trim()) {
          params.set("parent", parentScope.trim().toLowerCase());
        }
      } else {
        params.set("includeB2C", includeB2C ? "true" : "false");
        params.set("includeSA", includeSA ? "true" : "false");
      }
      const res = await fetch(
        `/api/admin/migrate-client-configs?${params.toString()}`,
        {
          method: dryRun ? "GET" : "POST",
          credentials: "same-origin",
          // D-149: smart-merge trenger policies i body ved kjør
          ...(mode === "smart-merge" && !dryRun
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ policies }),
              }
            : {}),
        },
      );
      const body = (await res.json()) as MigrationSummary | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `HTTP ${res.status}`);
      }
      setResult(body);
      // D-149: hvis smart-merge dry-run — populer policies med defaults
      // (sensitive → tenant, alt annet → default) hvis brukeren ikke har
      // satt policy allerede.
      if (
        mode === "smart-merge" &&
        dryRun &&
        "conflicts" in body &&
        body.conflicts
      ) {
        setPolicies((prev) => {
          const next = { ...prev };
          for (const c of body.conflicts ?? []) {
            if (c.tenantsInConflict === 0) continue;
            if (!(c.path in next)) {
              next[c.path] = c.sensitive ? "tenant" : "default";
            }
          }
          return next;
        });
      }
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
    <>
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

      {/* D-149 (2026-02): Full modal med backdrop. Klikk-utenfor lukker
          IKKE — kun X-knapp/Lukk-knapp. Beskytter policy-valg fra
          utilsiktet lukking. */}
      <div
        data-testid="config-tools-modal-backdrop"
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
      >
        <div
          data-testid="config-tools-panel"
          className="w-full max-w-[1200px] my-4 rounded-xl bg-neutral-900 border border-white/15 shadow-2xl flex flex-col max-h-[calc(100vh-3rem)]"
        >
          {/* Header — sticky */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10 flex-shrink-0">
            <div className="text-xs uppercase tracking-wide text-white/70 font-mono">
              Client-config bulk-verktøy
            </div>
            <button
              type="button"
              data-testid="config-tools-close-btn"
              onClick={() => {
                setOpen(false);
                setResult(null);
                setError(null);
                setPolicies({});
              }}
              className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-white/70 hover:text-white transition"
              aria-label="Lukk"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body — grid med sticky venstre-kolonne */}
          <div className="grid grid-cols-[340px_1fr] gap-0 overflow-hidden flex-1">
            {/* ═══ VENSTRE KOLONNE — sticky ═══════════════════════════ */}
            <div className="border-r border-white/10 overflow-y-auto p-5 space-y-5 self-start sticky top-0">
              {/* Modus-selector */}
              <fieldset className="space-y-1.5">
                <legend className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-2">
                  Modus
                </legend>
                {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                  <label
                    key={m}
                    className={`flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer transition border ${
                      mode === m
                        ? "bg-white/10 border-white/20"
                        : "bg-black/30 border-transparent hover:bg-black/40"
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
                        setPolicies({});
                      }}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full border-2 transition ${
                        mode === m
                          ? "border-violet-400 bg-violet-500"
                          : "border-white/30"
                      }`}
                    />
                    <span className="flex-1">
                      <span className="text-xs font-mono text-white/90 block">
                        {MODE_LABELS[m]}
                      </span>
                      <span className="block text-[10px] text-white/55 mt-0.5 leading-relaxed">
                        {MODE_DESC[m]}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {/* Scope-toggler (D-128) — skjult i cascade-modus */}
              {mode !== "cascade-from-parent" && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
                    Hvem skal treffes?
                  </div>
                  <label
                    className={`flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer transition border ${
                      includeB2C
                        ? "bg-blue-500/10 border-blue-500/40"
                        : "bg-black/30 border-transparent hover:bg-black/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid="config-tools-include-b2c-toggle"
                      checked={includeB2C}
                      onChange={(e) => {
                        setIncludeB2C(e.target.checked);
                        setResult(null);
                      }}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border-2 transition flex items-center justify-center ${
                        includeB2C
                          ? "border-blue-400 bg-blue-500"
                          : "border-white/30"
                      }`}
                    >
                      {includeB2C && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">
                      <span className="text-xs font-mono text-white/90 block">
                        Inkluder B2C-tenants
                      </span>
                      <span className="block text-[10px] text-white/55 mt-0.5">
                        Privat-kunder med ekte Vercel-prosjekt. Standard valg.
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex items-start gap-2 px-3 py-2 rounded-md cursor-pointer transition border ${
                      includeSA
                        ? "bg-purple-500/10 border-purple-500/40"
                        : "bg-black/30 border-transparent hover:bg-black/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid="config-tools-include-sa-toggle"
                      checked={includeSA}
                      onChange={(e) => {
                        setIncludeSA(e.target.checked);
                        setResult(null);
                      }}
                      className="sr-only"
                    />
                    <span
                      className={`mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded border-2 transition flex items-center justify-center ${
                        includeSA
                          ? "border-purple-400 bg-purple-500"
                          : "border-white/30"
                      }`}
                    >
                      {includeSA && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">
                      <span className="text-xs font-mono text-white/90 block">
                        Inkluder SA (B2B parent-tenants)
                      </span>
                      <span className="block text-[10px] text-white/55 mt-0.5 leading-relaxed">
                        <code>&lt;prefix&gt;-admin</code>-malene. Slå på når du vil treffe SA-konfig.
                      </span>
                    </span>
                  </label>
                  <div className="text-[10px] text-amber-300/80 leading-relaxed px-1">
                    ℹ B2B-ansatte treffes ALDRI av disse modusene. Bruk «Re-cascade» for å oppdatere ansatte fra sin SA.
                  </div>
                </div>
              )}

              {/* Parent-scope — kun cascade-modus */}
              {mode === "cascade-from-parent" && (
                <div className="px-3 py-2 rounded-md bg-emerald-500/5 border border-emerald-500/30 space-y-1.5">
                  <label
                    htmlFor="config-tools-parent-scope"
                    className="text-[10px] uppercase tracking-wide text-emerald-300 font-mono block"
                  >
                    SA-prefix å cascade fra (valgfri)
                  </label>
                  <input
                    id="config-tools-parent-scope"
                    data-testid="config-tools-parent-scope"
                    type="text"
                    value={parentScope}
                    onChange={(e) => {
                      setParentScope(e.target.value);
                      setResult(null);
                    }}
                    placeholder="f.eks. mm (uten -admin)"
                    className="w-full text-xs font-mono px-3 py-1.5 rounded-md bg-white/5 border border-white/15 focus:border-white/30 text-white placeholder:text-white/30 outline-none"
                  />
                  <p className="text-[10px] text-white/55 leading-relaxed">
                    Tom = re-cascade ALLE SA-organisasjoner. Skriv f.eks.{" "}
                    <code>mm</code> for å bare oppdatere ansatte under{" "}
                    <code>mm-admin</code>.
                  </p>
                </div>
              )}

              {/* Action-knapper */}
              <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  data-testid="config-tools-dry-run-btn"
                  onClick={() => void run(true)}
                  disabled={busy}
                  className="flex-1 text-xs px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-medium flex items-center justify-center gap-1.5 transition"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  Dry-run
                </button>
                <button
                  type="button"
                  data-testid="config-tools-run-btn"
                  onClick={() => void run(false)}
                  disabled={busy}
                  className={`flex-1 text-xs px-3 py-2 rounded-md disabled:opacity-50 text-white font-medium flex items-center justify-center gap-1.5 transition ${
                    mode === "overwrite-all"
                      ? "bg-red-600 hover:bg-red-500"
                      : mode === "cascade-from-parent"
                        ? "bg-emerald-600 hover:bg-emerald-500"
                        : "bg-violet-600 hover:bg-violet-500"
                  }`}
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  Kjør
                </button>
              </div>

              {/* Error — flyttet til høyre kolonne (mer synlig) */}

              {/* Audit-info */}
              <div className="text-[10px] text-white/40 leading-relaxed pt-2 border-t border-white/10">
                Hver mutasjon appender notis til tenant.notes for audit-trail.
                Tenants ser endringer innen 30 sek (browser-cache).
              </div>
            </div>

            {/* ═══ HØYRE KOLONNE — konflikt-tabell + resultater ═══════ */}
            <div className="overflow-y-auto p-5 space-y-4">
              {/* Feilmelding — alltid synlig øverst */}
              {error && (
                <div
                  data-testid="config-tools-error"
                  className="rounded-md bg-red-500/15 border border-red-500/50 px-4 py-3 flex items-start gap-2.5"
                >
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-300" />
                  <div className="text-sm text-red-100 leading-relaxed">
                    {error}
                  </div>
                </div>
              )}

              {!result && !error && (
                <div className="text-center py-16">
                  <div className="text-sm text-white/45 font-mono">
                    Kjør «Dry-run» for å se hva som vil skje.
                  </div>
                  <div className="text-[11px] text-white/30 mt-2 max-w-md mx-auto">
                    Ingen endringer skrives før du klikker «Kjør».
                    Smart-merge viser en konflikt-tabell der du kan velge policy per path.
                  </div>
                </div>
              )}

              {result && (
                <>
                  {/* Sammendrag */}
                  <div className="text-xs font-mono text-white/70 flex items-center gap-3 flex-wrap pb-3 border-b border-white/10">
                    {result.dryRun ? (
                      <span className="text-blue-300 uppercase tracking-wide">DRY-RUN</span>
                    ) : (
                      <span className="text-emerald-300 flex items-center gap-1 uppercase tracking-wide">
                        <CheckCircle2 className="h-3 w-3" />
                        UTFØRT
                      </span>
                    )}
                    <span className="text-white/90">{result.total} totalt</span>
                    {result.migrated > 0 && <span className="text-emerald-300">{result.migrated} migrert</span>}
                    {result.merged > 0 && <span className="text-emerald-300">{result.merged} merget</span>}
                    {(result.smartMerged ?? 0) > 0 && <span className="text-emerald-300">{result.smartMerged} smart-merget</span>}
                    {result.overwritten > 0 && <span className="text-amber-300">{result.overwritten} overskrevet</span>}
                    {result.cascaded > 0 && <span className="text-emerald-300">{result.cascaded} re-cascaded</span>}
                    {result.skipped > 0 && <span className="text-white/55">{result.skipped} hoppet over</span>}
                    {result.errors > 0 && <span className="text-red-300">{result.errors} feil</span>}
                  </div>

                  {/* Sensitive-seksjon øverst (kun ved smart-merge dry-run) */}
                  {result.conflicts && result.conflicts.some((c) => c.sensitive && c.tenantsInConflict > 0) && (
                    <div
                      data-testid="smart-merge-sensitive-section"
                      className="rounded-md bg-amber-500/[0.08] border border-amber-500/40 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2 text-amber-200 text-xs font-semibold">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Sensitive paths med konflikt
                      </div>
                      <div className="text-[11px] text-amber-100/75 leading-relaxed">
                        Følgende paths er tenant-eide (branding/backgrounds/kategorier). Default = «tenant vinner». Endre bare hvis du bevisst vil overskrive.
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {result.conflicts
                          .filter((c) => c.sensitive && c.tenantsInConflict > 0)
                          .map((c) => {
                            const policy = policies[c.path] ?? "tenant";
                            return (
                              <div
                                key={`sens-${c.path}`}
                                className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-black/30 border border-amber-500/20"
                              >
                                <span className="font-mono text-[11px] text-amber-100/90 truncate">
                                  {c.path}
                                </span>
                                <div className="inline-flex rounded overflow-hidden border border-white/15 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setPolicyForPath(c.path, "default")}
                                    className={`px-2 py-0.5 text-[10px] font-mono transition ${
                                      policy === "default"
                                        ? "bg-red-500/40 text-red-100"
                                        : "bg-transparent text-white/40 hover:text-white/70"
                                    }`}
                                  >
                                    default
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPolicyForPath(c.path, "tenant")}
                                    className={`px-2 py-0.5 text-[10px] font-mono transition border-l border-white/15 ${
                                      policy === "tenant"
                                        ? "bg-amber-500/30 text-amber-100"
                                        : "bg-transparent text-white/40 hover:text-white/70"
                                    }`}
                                  >
                                    tenant
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* Konflikt-tabell */}
                  {result.conflicts && result.conflicts.length > 0 && (
                    <div
                      data-testid="smart-merge-conflict-table"
                      className="border border-white/10 rounded-md overflow-hidden flex flex-col"
                    >
                      <div className="px-3 py-2 bg-white/5 flex items-center justify-between gap-2 border-b border-white/10">
                        <span className="text-[10px] uppercase tracking-wide text-white/65 font-mono">
                          Path-basert konflikt-analyse ({result.conflicts.filter((c) => c.tenantsInConflict > 0).length} med konflikt)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="smart-merge-bulk-default"
                            onClick={() =>
                              bulkSetPolicies(
                                (result.conflicts ?? [])
                                  .filter((c) => c.tenantsInConflict > 0 && !c.sensitive)
                                  .map((c) => c.path),
                                "default",
                              )
                            }
                            className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-200 border border-blue-500/30 font-mono"
                            title="Sett alle ikke-sensitive konflikter til 'default vinner'"
                          >
                            Alle → default
                          </button>
                          <button
                            type="button"
                            data-testid="smart-merge-bulk-tenant"
                            onClick={() =>
                              bulkSetPolicies(
                                (result.conflicts ?? [])
                                  .filter((c) => c.tenantsInConflict > 0)
                                  .map((c) => c.path),
                                "tenant",
                              )
                            }
                            className="text-[10px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/75 border border-white/20 font-mono"
                            title="Sett alle konflikter til 'tenant vinner'"
                          >
                            Alle → tenant
                          </button>
                        </div>
                      </div>
                      <div className="overflow-y-auto">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 bg-neutral-900 border-b border-white/10 z-10">
                            <tr className="text-left text-[10px] uppercase tracking-wide text-white/45">
                              <th className="px-3 py-1.5 font-medium">Path</th>
                              <th className="px-2 py-1.5 font-medium text-center" title="Uten (auto-legges til)">
                                ➕
                              </th>
                              <th className="px-2 py-1.5 font-medium text-center" title="Match default">
                                ✓
                              </th>
                              <th className="px-2 py-1.5 font-medium text-center" title="I konflikt">
                                ⚠
                              </th>
                              <th className="px-3 py-1.5 font-medium text-right">Policy</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(result.conflicts ?? []).map((c) => {
                              const hasConflict = c.tenantsInConflict > 0;
                              const policy = policies[c.path] ?? (c.sensitive ? "tenant" : "default");
                              return (
                                <tr
                                  key={c.path}
                                  data-testid={`conflict-row-${c.path}`}
                                  className={`border-b border-white/5 ${
                                    hasConflict
                                      ? c.sensitive
                                        ? "bg-amber-500/[0.04]"
                                        : ""
                                      : "opacity-45"
                                  }`}
                                >
                                  <td className="px-3 py-1.5 font-mono text-white/85">
                                    {c.sensitive && (
                                      <span
                                        className="text-amber-400 mr-1"
                                        title="Sensitiv path — default på tenant-wins"
                                      >
                                        ⚠
                                      </span>
                                    )}
                                    {c.path}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-white/50">
                                    {c.tenantsMissing || "·"}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-emerald-400/70">
                                    {c.tenantsMatchingDefault || "·"}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    {hasConflict ? (
                                      <span className="text-amber-300 font-mono">
                                        {c.tenantsInConflict}
                                      </span>
                                    ) : (
                                      <span className="text-white/30">·</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right">
                                    {hasConflict ? (
                                      <div className="inline-flex rounded overflow-hidden border border-white/15">
                                        <button
                                          type="button"
                                          data-testid={`policy-${c.path}-default`}
                                          onClick={() => setPolicyForPath(c.path, "default")}
                                          className={`px-2 py-0.5 text-[10px] font-mono transition ${
                                            policy === "default"
                                              ? "bg-blue-500/30 text-blue-200"
                                              : "bg-transparent text-white/45 hover:text-white/70"
                                          }`}
                                        >
                                          default
                                        </button>
                                        <button
                                          type="button"
                                          data-testid={`policy-${c.path}-tenant`}
                                          onClick={() => setPolicyForPath(c.path, "tenant")}
                                          className={`px-2 py-0.5 text-[10px] font-mono transition border-l border-white/15 ${
                                            policy === "tenant"
                                              ? "bg-white/20 text-white/85"
                                              : "bg-transparent text-white/45 hover:text-white/70"
                                          }`}
                                        >
                                          tenant
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-white/30 font-mono">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Tenant-liste (resultater per rad) */}
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
                      Tenants behandlet
                    </div>
                    <ul className="space-y-1">
                      {result.rows.map((row, i) => (
                        <li
                          key={i}
                          data-testid={`config-tools-row-${row.subdomain}`}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono ${
                            ACTION_STYLE[row.action] ?? "bg-white/5 text-white/55"
                          }`}
                        >
                          <span className="flex-1 truncate">{row.subdomain}</span>
                          <span className="text-[10px] uppercase">{row.action}</span>
                          {row.reason && (
                            <span
                              className="text-[10px] text-white/40 truncate max-w-[240px]"
                              title={row.reason}
                            >
                              {row.reason}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* D-149: Styled confirm-dialog for destruktive modi. Erstatter
          browser-default window.confirm() som ikke matcher branding. */}
      {confirmState && (
        <ConfirmDialog
          open={confirmState.open}
          title={confirmState.title}
          description={confirmState.description}
          confirmLabel={confirmState.confirmLabel}
          variant={confirmState.variant}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  );
}
