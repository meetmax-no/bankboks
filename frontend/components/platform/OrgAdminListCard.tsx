"use client";

/**
 * Ko | Do · Vault — D-091 (2026-06-28) — Org-Admin liste/sletting (Test Tools).
 *
 * Mike's verktøy for å se og rydde ALLE org-admins på tvers av prefiks.
 * Orphans (admins uten matching parent-tenant) merkes tydelig.
 *
 * Plassert i admin → Test Tools-fanen. Krever super-admin-cookie (allerede
 * gated via middleware).
 *
 * API:
 *   GET  /api/admin/org-admins/all
 *   POST /api/admin/org-admins/bulk-delete  { items: [{tenantPrefix, adminId}] }
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";

type AdminRow = {
  id: string;
  tenantPrefix: string;
  parentSubdomain: string;
  parentExists: boolean;
  isOrphan: boolean;
  orphanReason: "parent_missing" | "link_broken" | "link_missing" | null;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  suspended: boolean;
  createdAt: string;
  parentTenantCreatedAt: string | null;
};

type OrphanFilter = "all" | "parent_missing" | "link_broken" | "link_missing";

const ORPHAN_LABEL: Record<
  Exclude<AdminRow["orphanReason"], null>,
  { text: string; cls: string }
> = {
  parent_missing: { text: "Parent slettet", cls: "text-rose-300" },
  link_broken: { text: "Link brutt (re-opprettet)", cls: "text-amber-300" },
  link_missing: { text: "Mangler link (legacy)", cls: "text-white/55" },
};

type Summary = { total: number; orphanCount: number; prefixCount: number };

type DeleteResult = {
  deletedCount: number;
  prefixesPurged: string[];
  errors: string[];
};

export function OrgAdminListCard() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DeleteResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [orphanFilter, setOrphanFilter] = useState<OrphanFilter>("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    setLastResult(null);
    try {
      const r = await fetch("/api/admin/org-admins/all");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { admins: AdminRow[]; summary: Summary };
      setRows(data.admins);
      setSummary(data.summary);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lasting feilet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOrphans = () => {
    const reason = orphanFilter === "all" ? null : orphanFilter;
    setSelected(
      new Set(
        rows
          .filter(
            (r) => r.isOrphan && (reason === null || r.orphanReason === reason),
          )
          .map((r) => r.id),
      ),
    );
  };

  const selectAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    setLastResult(null);
    try {
      const items = rows
        .filter((r) => selected.has(r.id))
        .map((r) => ({ tenantPrefix: r.tenantPrefix, adminId: r.id }));
      const r = await fetch("/api/admin/org-admins/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = (await r.json()) as DeleteResult & { error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
      setLastResult(data);
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sletting feilet");
    } finally {
      setDeleting(false);
    }
  };

  const selectedCount = selected.size;
  const selectedOrphans = rows.filter(
    (r) => selected.has(r.id) && r.isOrphan,
  ).length;
  const selectedActive = selectedCount - selectedOrphans;
  const filteredOrphanCount =
    orphanFilter === "all"
      ? rows.filter((r) => r.isOrphan).length
      : rows.filter((r) => r.orphanReason === orphanFilter).length;

  return (
    <div
      data-testid="org-admin-list-card"
      className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center flex-shrink-0">
          <Users className="h-5 w-5 text-amber-200" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-white">
            Org-admins · oversikt og rydding
          </h3>
          <p className="text-xs text-white/55 mt-0.5 leading-relaxed">
            Alle org-admins på tvers av prefiks. Orphans (parent-tenant
            slettet) er merket. Bulk-sletting bypasser last-super-admin-invariant
            og kjører full cascade (MPW, notater, invites) hvis et helt prefiks
            tømmes.
          </p>
        </div>
        <button
          data-testid="org-admin-list-reload-btn"
          onClick={load}
          disabled={loading || deleting}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Last på nytt
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span
            data-testid="org-admin-list-summary-total"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/80"
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-300" />
            {summary.total} admins · {summary.prefixCount} prefiks
          </span>
          {summary.orphanCount > 0 && (
            <span
              data-testid="org-admin-list-summary-orphans"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-200"
            >
              <AlertTriangle className="h-3 w-3" />
              {summary.orphanCount} orphans (parent slettet)
            </span>
          )}
        </div>
      )}

      {/* Tabell */}
      {loading && rows.length === 0 ? (
        <div className="text-xs text-white/55 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Laster …
        </div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-white/55">Ingen org-admins registrert.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-8">
                  <input
                    data-testid="org-admin-list-select-all"
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={selectAll}
                    className="accent-amber-400"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Prefix</th>
                <th className="text-left px-3 py-2 font-medium">Parent</th>
                <th className="text-left px-3 py-2 font-medium">Navn</th>
                <th className="text-left px-3 py-2 font-medium">E-post</th>
                <th className="text-left px-3 py-2 font-medium">Rolle</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Orphan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    data-testid={`org-admin-row-${r.id}`}
                    onClick={() => toggle(r.id)}
                    className={`border-t border-white/5 cursor-pointer transition ${
                      isSel
                        ? "bg-amber-400/10"
                        : r.isOrphan
                          ? "bg-amber-500/5 hover:bg-amber-500/10"
                          : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-white/80">
                      {r.tenantPrefix}
                    </td>
                    <td className="px-3 py-2 font-mono text-white/60">
                      {r.parentExists ? (
                        r.parentSubdomain
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-300">
                          <AlertTriangle className="h-3 w-3" />
                          {r.parentSubdomain}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="px-3 py-2 text-white/80">{r.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.role === "super-admin"
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-white/10 text-white/70"
                        }`}
                      >
                        {r.role}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.suspended ? (
                        <span className="text-rose-300">Suspended</span>
                      ) : (
                        <span className="text-white/60">Aktiv</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.isOrphan && r.orphanReason ? (
                        <span
                          className={`text-[10px] ${ORPHAN_LABEL[r.orphanReason].cls}`}
                          title={`parent.createdAt=${r.parentTenantCreatedAt ?? "(null)"}`}
                        >
                          {ORPHAN_LABEL[r.orphanReason].text}
                        </span>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action-rad */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              data-testid="org-admin-list-orphan-filter"
              value={orphanFilter}
              onChange={(e) => setOrphanFilter(e.target.value as OrphanFilter)}
              disabled={deleting}
              className="h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition outline-none focus:border-amber-400/50"
            >
              <option value="all">Alle orphan-typer</option>
              <option value="parent_missing">Parent slettet</option>
              <option value="link_broken">Link brutt (re-opprettet)</option>
              <option value="link_missing">Mangler link (legacy)</option>
            </select>
            <button
              data-testid="org-admin-list-select-orphans-btn"
              onClick={selectAllOrphans}
              disabled={filteredOrphanCount === 0 || deleting}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Velg ({filteredOrphanCount})
            </button>
            <span className="text-xs text-white/55">
              {selectedCount} valgt
              {selectedOrphans > 0 ? ` (${selectedOrphans} orphans)` : ""}
              {selectedActive > 0 ? ` (${selectedActive} aktive)` : ""}
            </span>
          </div>
          <button
            data-testid="org-admin-list-delete-btn"
            onClick={() => setConfirmOpen(true)}
            disabled={selectedCount === 0 || deleting}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-rose-500 hover:bg-rose-400 disabled:bg-white/10 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Slett valgte ({selectedCount})
          </button>
        </div>
      )}

      {/* Resultat / feil */}
      {error && (
        <div
          data-testid="org-admin-list-error"
          className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {error}
        </div>
      )}
      {lastResult && (
        <div
          data-testid="org-admin-list-success"
          className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-100 space-y-1"
        >
          <div className="font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Slettet {lastResult.deletedCount} admin
            {lastResult.deletedCount === 1 ? "" : "s"}
          </div>
          {lastResult.prefixesPurged.length > 0 && (
            <div>
              Full cascade-purge: {lastResult.prefixesPurged.join(", ")}
            </div>
          )}
          {lastResult.errors.length > 0 && (
            <div className="text-amber-200">
              Advarsler: {lastResult.errors.join("; ")}
            </div>
          )}
        </div>
      )}

      {/* Bekreftelses-modal */}
      {confirmOpen && (
        <div
          data-testid="org-admin-list-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !deleting && setConfirmOpen(false)}
        >
          <div
            className="max-w-md w-full rounded-2xl border border-rose-400/30 bg-neutral-900 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-rose-300" />
              </div>
              <h3 className="text-base font-semibold text-white">
                Slette {selectedCount} admin{selectedCount === 1 ? "" : "s"}?
              </h3>
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              Dette bypasser last-super-admin-invariant. Hvis alle admins for et
              prefiks slettes, kjøres full cascade (MPW, notater, invites).
              Operasjonen kan IKKE angres.
            </p>
            {selectedActive > 0 && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {selectedActive} av valgte admins har en AKTIV parent-tenant.
                  Disse vil miste alle innloggings-rettigheter.
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                data-testid="org-admin-list-confirm-cancel"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
                className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
              >
                Avbryt
              </button>
              <button
                data-testid="org-admin-list-confirm-delete"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Bekreft sletting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
