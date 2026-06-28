"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — InvitesSection (D-056)
 *
 * Brukes i TenantDetailCard når customerType === "b2b" og tenantPrefix er satt.
 * Lister alle invitasjoner for parent, lar admin opprette nye, kopiere lenker,
 * sende på nytt og slette.
 */
import { useEffect, useState } from "react";
import {
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Upload,
  X,
} from "lucide-react";
import type { InviteRecord, InviteStatus } from "@/lib/platform/invite-types";

interface InvitesSectionProps {
  parentTenant: string;     // tenantPrefix til parent ("am")
  parentSubdomain: string;  // for visning
  maxLicenses: number | null;
  activeLicenses: number | null;
}

type CreateState = {
  open: boolean;
  subdomain: string;        // auto-prefilled med "<prefix>-"
  email: string;
  firstName: string;
  lastName: string;
  locale: "no" | "sv" | "da" | "en";
  busy: boolean;
  error: string | null;
};

const EMPTY_CREATE: Omit<CreateState, "subdomain"> = {
  open: false,
  email: "",
  firstName: "",
  lastName: "",
  locale: "no",
  busy: false,
  error: null,
};

export function InvitesSection({
  parentTenant,
  parentSubdomain: _parentSubdomain,
  maxLicenses,
  activeLicenses,
}: InvitesSectionProps) {
  void _parentSubdomain; // reservert for fremtidig visning
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [create, setCreate] = useState<CreateState>({
    ...EMPTY_CREATE,
    subdomain: `${parentTenant}-`,
  });

  // ─── Batch CSV-import (D-056 utvidelse) ────────────────────────────────
  // Klient-side parser. Ingen backend-endring — looper POST /api/admin/invites.
  type BatchRow = {
    line: number;
    subdomain: string;
    email: string;
    firstName?: string;
    lastName?: string;
    locale?: "no" | "sv" | "da" | "en";
    status: "pending" | "ok" | "skipped" | "error";
    message?: string;
  };
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchCsv, setBatchCsv] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  function parseCsv(csv: string): BatchRow[] {
    const VALID_LOCALES = new Set(["no", "sv", "da", "en"]);
    const rows: BatchRow[] = [];
    const lines = csv.split(/\r?\n/);
    let lineNum = 0;
    for (const raw of lines) {
      lineNum++;
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) continue; // kommentarer
      // header-rad (forventer "subdomain" som første kolonne)
      if (lineNum === 1 && /^subdomain/i.test(line)) continue;
      const cols = line.split(",").map((c) => c.trim());
      const [subdomain, email, firstName, lastName, locale] = cols;
      const row: BatchRow = {
        line: lineNum,
        subdomain: (subdomain ?? "").toLowerCase(),
        email: (email ?? "").toLowerCase(),
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        locale:
          locale && VALID_LOCALES.has(locale)
            ? (locale as "no" | "sv" | "da" | "en")
            : undefined,
        status: "pending",
      };
      // klient-side basisvalidering (server validerer fortsatt fullt)
      if (!row.subdomain) {
        row.status = "error";
        row.message = "subdomain mangler";
      } else if (!row.subdomain.startsWith(parentTenant + "-")) {
        row.status = "error";
        row.message = `må starte med "${parentTenant}-"`;
      }
      rows.push(row);
    }
    return rows;
  }

  function previewBatch() {
    setBatchRows(parseCsv(batchCsv));
  }

  async function runBatch() {
    if (batchRunning) return;
    const parsed = parseCsv(batchCsv);
    setBatchRows(parsed);
    setBatchRunning(true);
    // Sekvensiell — gir admin tydelig progress og unngår å treffe rate-limits
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      if (row.status === "error") continue;
      try {
        const res = await fetch("/api/admin/invites", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subdomain: row.subdomain,
            parentTenant,
            email: row.email || undefined,
            firstName: row.firstName,
            lastName: row.lastName,
            locale: row.locale,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        if (res.ok) {
          row.status = "ok";
        } else {
          row.status = "error";
          row.message = body.detail || body.error || `HTTP ${res.status}`;
        }
      } catch (e) {
        row.status = "error";
        row.message = e instanceof Error ? e.message : "network_error";
      }
      // Trigger re-render per rad så Mike ser progresjonen
      setBatchRows([...parsed]);
    }
    setBatchRunning(false);
    await refresh();
  }

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/admin/invites?parentTenant=${encodeURIComponent(parentTenant)}`,
        { credentials: "same-origin" },
      );
      const body = (await res.json()) as
        | { invites: InviteRecord[] }
        | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `HTTP ${res.status}`);
      }
      setInvites(body.invites);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentTenant]);

  function buildInviteUrl(token: string): string {
    // Vis full URL i UI — uten admin.-prefiks
    if (typeof window === "undefined") return `/invite?token=${token}`;
    const host = window.location.host.replace(/^admin\./, "");
    return `${window.location.protocol}//${host}/invite?token=${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(buildInviteUrl(token));
      setJustCopied(token);
      setTimeout(() => setJustCopied((cur) => (cur === token ? null : cur)), 1500);
    } catch {
      /* clipboard kan feile i iframe — ignorer */
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (create.busy) return;
    setCreate((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain: create.subdomain.toLowerCase().trim(),
          parentTenant,
          email: create.email.trim() || undefined,
          firstName: create.firstName.trim() || undefined,
          lastName: create.lastName.trim() || undefined,
          locale: create.locale,
        }),
      });
      const body = (await res.json()) as
        | { invite: InviteRecord; inviteUrl: string }
        | { error: string; detail?: string };
      if (!res.ok || "error" in body) {
        const msg =
          ("error" in body && (body.detail || body.error)) || `HTTP ${res.status}`;
        setCreate((s) => ({ ...s, busy: false, error: msg }));
        return;
      }
      setCreate({ ...EMPTY_CREATE, subdomain: `${parentTenant}-` });
      await refresh();
    } catch (e) {
      setCreate((s) => ({
        ...s,
        busy: false,
        error: e instanceof Error ? e.message : "create_failed",
      }));
    }
  }

  async function onResend(token: string) {
    setActionBusy(token);
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "resend_failed");
    } finally {
      setActionBusy(null);
    }
  }

  async function onDelete(token: string) {
    setActionBusy(token);
    try {
      const res = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setListError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setActionBusy(null);
    }
  }

  const licenseTagAvail = `${activeLicenses ?? 0}${
    maxLicenses != null ? "/" + maxLicenses : ""
  } lisenser i bruk`;

  return (
    <div
      data-testid="tenant-invites-section"
      className="space-y-3 mb-5 pb-5 border-b border-white/10"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
            Invitasjoner (D-056)
          </span>
          <span className="text-[10px] text-white/40">{licenseTagAvail}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="tenant-invites-batch-btn"
            onClick={() => {
              setBatchOpen((b) => !b);
              setBatchRows([]);
            }}
            title="Importer flere fra CSV"
            className="text-xs px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/85 flex items-center gap-1 transition"
          >
            {batchOpen ? <X className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
            {batchOpen ? "Lukk batch" : "Batch CSV"}
          </button>
          <button
            type="button"
            data-testid="tenant-invites-new-btn"
            onClick={() =>
              setCreate((s) => ({
                ...EMPTY_CREATE,
                subdomain: `${parentTenant}-`,
                open: !s.open,
              }))
            }
            className="text-xs px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1 transition"
          >
            {create.open ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {create.open ? "Avbryt" : "Ny invitasjon"}
          </button>
        </div>
      </div>

      {batchOpen && (
        <div
          data-testid="tenant-invites-batch-form"
          className="p-3 rounded-lg bg-black/30 border border-white/10 space-y-2"
        >
          <div className="text-[10px] uppercase text-white/55 font-mono">
            CSV — én rad per ansatt
          </div>
          <p className="text-[10px] text-white/40 leading-relaxed font-mono">
            Kolonner: subdomain, email, firstName?, lastName?, locale?<br />
            Eksempel: <span className="text-white/60">{parentTenant}-nils,nils@firma.no,Nils,Hansen,no</span><br />
            Linjer som starter med # ignoreres. Header-rad (subdomain,...) godtas.
          </p>
          <textarea
            data-testid="tenant-invites-batch-csv"
            value={batchCsv}
            onChange={(e) => setBatchCsv(e.target.value)}
            placeholder={`${parentTenant}-nils,nils@firma.no\n${parentTenant}-kim,kim@firma.no,Kim,Lie,no\n${parentTenant}-lars,lars@firma.no`}
            rows={6}
            spellCheck={false}
            className="w-full px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-xs text-white font-mono focus:border-blue-500 focus:outline-none resize-y"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="tenant-invites-batch-preview"
              onClick={previewBatch}
              disabled={batchRunning || !batchCsv.trim()}
              className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-xs font-medium transition"
            >
              Forhåndsvis
            </button>
            <button
              type="button"
              data-testid="tenant-invites-batch-run"
              onClick={runBatch}
              disabled={batchRunning || !batchCsv.trim()}
              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium transition flex items-center gap-1.5"
            >
              {batchRunning && <Loader2 className="h-3 w-3 animate-spin" />}
              {batchRunning ? "Oppretter…" : "Opprett alle"}
            </button>
            {batchRows.length > 0 && (
              <span className="text-[10px] text-white/55 font-mono">
                {batchRows.filter((r) => r.status === "ok").length} ok ·{" "}
                {batchRows.filter((r) => r.status === "error").length} feil ·{" "}
                {batchRows.filter((r) => r.status === "pending").length} venter
              </span>
            )}
          </div>
          {batchRows.length > 0 && (
            <ul
              data-testid="tenant-invites-batch-results"
              className="space-y-1 max-h-60 overflow-y-auto text-[11px] font-mono"
            >
              {batchRows.map((r) => (
                <li
                  key={r.line}
                  data-testid={`tenant-invites-batch-row-${r.line}`}
                  className={`flex items-center gap-2 px-2 py-1 rounded ${
                    r.status === "ok"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : r.status === "error"
                      ? "bg-red-500/10 text-red-300"
                      : "bg-white/5 text-white/55"
                  }`}
                >
                  <span className="w-6 text-right text-white/40">{r.line}.</span>
                  <span className="truncate flex-1">
                    {r.subdomain}
                    {r.email ? ` · ${r.email}` : ""}
                  </span>
                  <span className="text-[10px] uppercase">
                    {r.status === "ok"
                      ? "ok"
                      : r.status === "error"
                      ? r.message ?? "feil"
                      : "venter"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {create.open && (
        <form
          onSubmit={onCreate}
          data-testid="tenant-invites-create-form"
          className="p-3 rounded-lg bg-black/30 border border-white/10 space-y-2"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-white/55 font-mono">
                Subdomene (start med {parentTenant}-)
              </span>
              <input
                data-testid="tenant-invites-subdomain"
                value={create.subdomain}
                onChange={(e) =>
                  setCreate((s) => ({ ...s, subdomain: e.target.value }))
                }
                placeholder={`${parentTenant}-nils`}
                className="px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-white/55 font-mono">
                E-post (valgfritt)
              </span>
              <input
                data-testid="tenant-invites-email"
                type="email"
                value={create.email}
                onChange={(e) =>
                  setCreate((s) => ({ ...s, email: e.target.value }))
                }
                placeholder="nils@firma.no"
                className="px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-white/55 font-mono">
                Fornavn (valgfritt)
              </span>
              <input
                data-testid="tenant-invites-firstname"
                value={create.firstName}
                onChange={(e) =>
                  setCreate((s) => ({ ...s, firstName: e.target.value }))
                }
                className="px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-white/55 font-mono">
                Etternavn (valgfritt)
              </span>
              <input
                data-testid="tenant-invites-lastname"
                value={create.lastName}
                onChange={(e) =>
                  setCreate((s) => ({ ...s, lastName: e.target.value }))
                }
                className="px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase text-white/55 font-mono">
                Språk
              </span>
              <select
                data-testid="tenant-invites-locale"
                value={create.locale}
                onChange={(e) =>
                  setCreate((s) => ({
                    ...s,
                    locale: e.target.value as "no" | "sv" | "da" | "en",
                  }))
                }
                className="px-2 py-1.5 rounded-md bg-black/40 border border-white/15 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="no">Norsk</option>
                <option value="sv">Svenska</option>
                <option value="da">Dansk</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
          {create.error && (
            <div
              data-testid="tenant-invites-create-error"
              className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
            >
              {create.error}
            </div>
          )}
          <button
            type="submit"
            data-testid="tenant-invites-create-submit"
            disabled={create.busy}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center gap-1.5"
          >
            {create.busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {create.busy ? "Oppretter…" : "Opprett invitasjon"}
          </button>
        </form>
      )}

      {listError && (
        <div
          data-testid="tenant-invites-list-error"
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
        >
          {listError}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-white/55">
          <Loader2 className="h-3 w-3 animate-spin" />
          Laster invitasjoner…
        </div>
      )}

      {!loading && invites.length === 0 && (
        <div
          data-testid="tenant-invites-empty"
          className="text-xs text-white/40 italic"
        >
          Ingen invitasjoner ennå.
        </div>
      )}

      {!loading && invites.length > 0 && (
        <ul
          data-testid="tenant-invites-list"
          className="space-y-1.5"
        >
          {invites.map((inv) => (
            <li
              key={inv.token}
              data-testid={`tenant-invites-row-${inv.subdomain}`}
              className="flex items-center justify-between gap-2 p-2 rounded-md bg-black/30 border border-white/5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-white/85 truncate">
                  {inv.subdomain}
                </span>
                <InviteStatusBadge status={inv.status} />
                <span className="text-[10px] text-white/40 truncate">
                  {formatDate(inv.createdAt)}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {inv.status === "pending" && (
                  <button
                    type="button"
                    data-testid={`tenant-invites-copy-${inv.subdomain}`}
                    onClick={() => void copyLink(inv.token)}
                    title="Kopier lenke"
                    className="p-1.5 rounded-md hover:bg-white/10 text-white/65 hover:text-white transition"
                  >
                    {justCopied === inv.token ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {inv.status !== "used" && (
                  <button
                    type="button"
                    data-testid={`tenant-invites-resend-${inv.subdomain}`}
                    onClick={() => void onResend(inv.token)}
                    disabled={actionBusy === inv.token}
                    title="Send på nytt"
                    className="p-1.5 rounded-md hover:bg-white/10 text-white/65 hover:text-white transition disabled:opacity-40"
                  >
                    {actionBusy === inv.token ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {inv.status !== "used" && (
                  <button
                    type="button"
                    data-testid={`tenant-invites-delete-${inv.subdomain}`}
                    onClick={() => void onDelete(inv.token)}
                    disabled={actionBusy === inv.token}
                    title="Slett"
                    className="p-1.5 rounded-md hover:bg-red-500/20 text-white/65 hover:text-red-300 transition disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteStatusBadge({ status }: { status: InviteStatus }) {
  const map: Record<InviteStatus, { label: string; cls: string }> = {
    pending: { label: "pending", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
    used: { label: "used", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
    expired: { label: "expired", cls: "bg-white/5 text-white/45 border-white/15" },
  };
  const s = map[status];
  return (
    <span
      className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
