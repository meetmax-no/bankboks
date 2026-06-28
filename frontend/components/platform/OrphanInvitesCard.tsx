"use client";

/**
 * Ko | Do · Vault — D-094 (2026-06-28) — Orphan invites liste/sletting.
 *
 * Søster-komponent til OrgAdminListCard. Lister ALLE invites (pending/used/
 * expired) på tvers av prefiks, med orphan-flagg.
 *
 * Orphan-årsaker:
 *   - "parent_missing":  tenant:<prefix>-admin finnes ikke
 *   - "predates_parent": invite.createdAt < parent.createdAt
 *                        (parent ble re-opprettet etter at invite-en var laget)
 *
 * API:
 *   GET  /api/admin/orphan-invites/all
 *   POST /api/admin/orphan-invites/bulk-delete  { tokens: [...] }
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";

type InviteRow = {
  token: string;
  subdomain: string;
  parentPrefix: string;
  parentSubdomain: string;
  parentExists: boolean;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  status: "pending" | "used" | "expired";
  isOrphan: boolean;
  orphanReason: "parent_missing" | "link_broken" | "link_missing" | "child_missing" | null;
  createdAt: string;
  expiresAt: string;
  parentTenantCreatedAt: string | null;
};

type Summary = { total: number; orphanCount: number };

type DeleteResult = { deletedCount: number; errors: string[] };

type OrphanFilter = "all" | "parent_missing" | "link_broken" | "link_missing" | "child_missing";

const ORPHAN_REASON_LABEL: Record<
  NonNullable<InviteRow["orphanReason"]>,
  { text: string; cls: string }
> = {
  parent_missing: { text: "Parent slettet", cls: "text-rose-300" },
  link_broken: { text: "Link brutt (re-opprettet)", cls: "text-amber-300" },
  link_missing: { text: "Mangler link (legacy)", cls: "text-white/55" },
  child_missing: { text: "Child-vault slettet", cls: "text-rose-300" },
};

const STATUS_LABEL: Record<InviteRow["status"], string> = {
  pending: "Pending",
  used: "Brukt",
  expired: "Utløpt",
};

export function OrphanInvitesCard() {
  const [rows, setRows] = useState<InviteRow[]>([]);
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
      const r = await fetch("/api/admin/orphan-invites/all");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as {
        invites: InviteRow[];
        summary: Summary;
      };
      setRows(data.invites);
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

  const toggle = (token: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
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
          .map((r) => r.token),
      ),
    );
  };

  const selectAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.token)));
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    setLastResult(null);
    try {
      const tokens = Array.from(selected);
      const r = await fetch("/api/admin/orphan-invites/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens }),
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
    (r) => selected.has(r.token) && r.isOrphan,
  ).length;
  const selectedNonOrphans = selectedCount - selectedOrphans;
  const filteredOrphanCount =
    orphanFilter === "all"
      ? rows.filter((r) => r.isOrphan).length
      : rows.filter((r) => r.orphanReason === orphanFilter).length;

  return (
    <div
      data-testid="orphan-invites-card"
      className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center flex-shrink-0">
          <Mail className="h-5 w-5 text-amber-200" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-white">
            Invites · oversikt og rydding
          </h3>
          <p className="text-xs text-white/55 mt-0.5 leading-relaxed">
            Alle invites på tvers av prefiks. Orphans dekker invites uten
            parent-tenant (parent slettet), invites eldre enn dagens parent
            (parent re-opprettet etter slett), og «Brukt»-invites der child-
            vaulten er slettet i ettertid (D-101).
          </p>
        </div>
        <button
          data-testid="orphan-invites-reload-btn"
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
            data-testid="orphan-invites-summary-total"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/80"
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-300" />
            {summary.total} invites
          </span>
          {summary.orphanCount > 0 && (
            <span
              data-testid="orphan-invites-summary-orphans"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-200"
            >
              <AlertTriangle className="h-3 w-3" />
              {summary.orphanCount} orphans
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
        <div className="text-xs text-white/55">Ingen invites registrert.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-xs">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-8">
                  <input
                    data-testid="orphan-invites-select-all"
                    type="checkbox"
                    checked={selected.size === rows.length && rows.length > 0}
                    onChange={selectAll}
                    className="accent-amber-400"
                  />
                </th>
                <th className="text-left px-3 py-2 font-medium">Subdomain</th>
                <th className="text-left px-3 py-2 font-medium">Parent</th>
                <th className="text-left px-3 py-2 font-medium">E-post</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Orphan</th>
                <th className="text-left px-3 py-2 font-medium">Opprettet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSel = selected.has(r.token);
                return (
                  <tr
                    key={r.token}
                    data-testid={`orphan-invite-row-${r.token}`}
                    onClick={() => toggle(r.token)}
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
                        onChange={() => toggle(r.token)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-amber-400"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-white/80">
                      {r.subdomain}
                    </td>
                    <td className="px-3 py-2 font-mono text-white/60">
                      {r.parentExists ? (
                        r.parentSubdomain
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          {r.parentSubdomain}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white/80">{r.email ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.status === "pending"
                            ? "bg-amber-500/20 text-amber-200"
                            : r.status === "used"
                              ? "bg-emerald-500/20 text-emerald-200"
                              : "bg-white/10 text-white/55"
                        }`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.isOrphan && r.orphanReason ? (
                        <span
                          className={`text-[10px] ${ORPHAN_REASON_LABEL[r.orphanReason].cls}`}
                          title={`parent.createdAt=${r.parentTenantCreatedAt ?? "(null)"}`}
                        >
                          {ORPHAN_REASON_LABEL[r.orphanReason].text}
                        </span>
                      ) : (
                        <span className="text-white/40">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-white/55 text-[10px]">
                      {new Date(r.createdAt).toLocaleDateString("no-NO")}
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
          <div className="flex items-center gap-2">
            <button
              data-testid="orphan-invites-select-orphans-btn"
              onClick={selectAllOrphans}
              disabled={!summary || summary.orphanCount === 0 || deleting}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Velg alle orphans
            </button>
            <span className="text-xs text-white/55">
              {selectedCount} valgt
              {selectedOrphans > 0 ? ` (${selectedOrphans} orphans)` : ""}
              {selectedNonOrphans > 0 ? ` (${selectedNonOrphans} aktive)` : ""}
            </span>
          </div>
          <button
            data-testid="orphan-invites-delete-btn"
            onClick={() => setConfirmOpen(true)}
            disabled={selectedCount === 0 || deleting}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-rose-500 hover:bg-rose-400 disabled:bg-white/10 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Slett valgte ({selectedCount})
          </button>
        </div>
      )}

      {error && (
        <div
          data-testid="orphan-invites-error"
          className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {error}
        </div>
      )}
      {lastResult && (
        <div
          data-testid="orphan-invites-success"
          className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-100 space-y-1"
        >
          <div className="font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Slettet {lastResult.deletedCount} invite
            {lastResult.deletedCount === 1 ? "" : "s"}
          </div>
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
          data-testid="orphan-invites-confirm-modal"
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
                Slette {selectedCount} invite{selectedCount === 1 ? "" : "s"}?
              </h3>
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              Sletter selve invite-recorden og fjerner fra parent-indeksen.
              Operasjonen kan IKKE angres.
            </p>
            {selectedNonOrphans > 0 && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  {selectedNonOrphans} av valgte er IKKE orphans. Disse er
                  fortsatt gyldige invites — du sletter en aktiv invitasjon.
                </span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                data-testid="orphan-invites-confirm-cancel"
                onClick={() => setConfirmOpen(false)}
                disabled={deleting}
                className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
              >
                Avbryt
              </button>
              <button
                data-testid="orphan-invites-confirm-delete"
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
