"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-085, 2026-06-27) — EmployeeListSection
 *
 * Refaktor av Iter 20.3-patch til nye krav:
 *   1. Admin/super-admin (parent-record `<prefix>-admin`) FILTRERES BORT —
 *      en admin er ikke en ansatt.
 *   2. Header bruker companyName (ikke prefix) i description.
 *   3. "+ Ansatt"-knapp top-right åpner inline invite-form (gjenbruker
 *      OrgInvitesSection-mønsteret men inline i samme seksjon).
 *   4. Filter-input (søk på navn/e-post/subdomain).
 *   5. Sorterbare kolonner — klikk på header bytter asc/desc.
 *   6. Seats-infoboks top-right viser "X av Y ledige" lisenser.
 *
 * Statusmap fra Iter 20.3 beholdes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UserPlus, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";
import type { InviteRecord } from "@/lib/platform/invite-types";
import type { B2BBillingPhase } from "@/lib/platform/b2b-billing";
import { AdminNotesModal } from "./AdminNotesModal";
import { InlineInviteForm } from "./InlineInviteForm";
import { useMpw } from "./MpwContext";
import { SeatProgressBar } from "./SeatProgressBar";

// ─── Typer ─────────────────────────────────────────────────────────────
type Employee = {
  subdomain: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  contactEmail: string | null;
  locale: "no" | "sv" | "da" | "en" | null;
  status: string;
  createdAt: string;
};

type TenantListResponse = {
  prefix: string;
  count: number;
  tenants: Employee[];
};

type InviteListResponse = {
  prefix: string;
  invites: InviteRecord[];
};

type Row =
  | {
      kind: "tenant";
      subdomain: string;
      name: string;
      email: string;
      statusKey: string;
      createdAt: string;
    }
  | {
      kind: "invite";
      subdomain: string;
      name: string;
      email: string;
      statusKey: "pending" | "expired";
      token: string;
      mailSentAt: string | null;
      createdAt: string;
    };

type SortKey = "name" | "subdomain" | "status" | "createdAt";
type SortDir = "asc" | "desc";

type Props = {
  prefix: string;
  companyName: string | null;
  maxLicenses: number | null;
  billingPhase: B2BBillingPhase | null;
};

// ─── Status-mapping ────────────────────────────────────────────────────
const STATUS_I18N_KEY: Record<string, string> = {
  active: "am_admin_employees.status_active",
  trial: "am_admin_employees.status_trial",
  suspended: "am_admin_employees.status_suspended",
  locked: "am_admin_employees.status_locked",
  cancelled: "am_admin_employees.status_cancelled",
  deleted: "am_admin_employees.status_deleted",
  pending_invite: "am_admin_employees.status_invited",
  expired_invite: "am_admin_employees.status_invited_expired",
  pending: "am_admin_employees.status_invited",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  trial: "bg-sky-500/15 text-sky-200 border-sky-400/30",
  suspended: "bg-orange-500/15 text-orange-200 border-orange-400/30",
  locked: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  cancelled: "bg-white/10 text-white/55 border-white/20",
  deleted: "bg-white/5 text-white/40 border-white/10",
  pending_invite: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  expired_invite: "bg-white/10 text-white/40 border-white/15",
  pending: "bg-amber-500/15 text-amber-200 border-amber-400/30",
};

function formatName(first: string | null, last: string | null): string {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || "—";
}

// ─── Komponent ─────────────────────────────────────────────────────────
export function EmployeeListSection({
  prefix,
  companyName,
  maxLicenses,
  billingPhase,
}: Props) {
  const { t } = useLocale();
  const { isUnlocked } = useMpw();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<{
    subdomain: string;
    name: string;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [inviteOpen, setInviteOpen] = useState(false);

  const invitesBlocked =
    billingPhase === "grace" || billingPhase === "expired";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, iRes] = await Promise.all([
        fetch("/api/am-admin/tenants", { credentials: "include" }),
        fetch("/api/am-admin/invites", { credentials: "include" }),
      ]);
      if (!tRes.ok) throw new Error(`tenants HTTP ${tRes.status}`);
      if (!iRes.ok) throw new Error(`invites HTTP ${iRes.status}`);
      const tData = (await tRes.json()) as TenantListResponse;
      const iData = (await iRes.json()) as InviteListResponse;

      // Iter 20.9 (D-085): am-admin parent-record `<prefix>-admin` er
      // ikke en ansatt — filtreres bort fra listen.
      const adminParentSubdomain = `${prefix.toLowerCase()}-admin`;
      const tenantRows: Row[] = tData.tenants
        .filter(
          (e) => e.subdomain.toLowerCase() !== adminParentSubdomain,
        )
        .map((e) => ({
          kind: "tenant" as const,
          subdomain: e.subdomain,
          name: formatName(e.firstName, e.lastName),
          email: e.contactEmail || e.email,
          statusKey: e.status,
          createdAt: e.createdAt,
        }));

      const inviteRows: Row[] = iData.invites
        .filter((i) => i.status === "pending" || i.status === "expired")
        .map((i) => ({
          kind: "invite" as const,
          subdomain: i.subdomain,
          name: formatName(i.firstName ?? null, i.lastName ?? null),
          email: i.email ?? "(ingen e-post)",
          statusKey: i.status === "pending" ? "pending" : "expired",
          token: i.token,
          mailSentAt: i.mailSentAt ?? null,
          createdAt: i.createdAt,
        }));

      setRows([...tenantRows, ...inviteRows]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("am_admin_employees.fetch_failed"),
      );
    } finally {
      setLoading(false);
    }
  }, [prefix, t]);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("am-admin:invite-created", handler);
    return () => window.removeEventListener("am-admin:invite-created", handler);
  }, [refresh]);

  // ─── Filter + sort ──────────────────────────────────────────────────
  const filteredSorted = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(f) ||
            r.email.toLowerCase().includes(f) ||
            r.subdomain.toLowerCase().includes(f),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "subdomain":
          cmp = a.subdomain.localeCompare(b.subdomain);
          break;
        case "status":
          cmp = a.statusKey.localeCompare(b.statusKey);
          break;
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, filter, sortKey, sortDir]);

  // Seats: hybrid-modell per D-092 (2026-06-28, Mike).
  //   activeSeats  = aktive ansatte (tenant-rader, ikke deleted/cancelled)
  //   pendingSeats = pending-invites som ikke er utløpt (status="pending")
  // Cron+webhook holder også activeLicenses-feltet konsistent server-side,
  // men her teller vi klient-side fra liste-snapshot for å matche akkurat
  // hva brukeren ser uten ekstra API-runde.
  const activeSeats = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.kind === "tenant" &&
          r.statusKey !== "deleted" &&
          r.statusKey !== "cancelled",
      ).length,
    [rows],
  );
  const pendingSeats = useMemo(
    () =>
      rows.filter((r) => r.kind === "invite" && r.statusKey === "pending")
        .length,
    [rows],
  );
  const totalSeats = maxLicenses ?? 0;
  const hasCap = totalSeats > 0;
  const seatsFull = hasCap && activeSeats + pendingSeats >= totalSeats;

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  // ─── Handlinger ──────────────────────────────────────────────────────
  const handleSuspend = useCallback(
    async (subdomain: string, label: string) => {
      setBusy(`suspend:${subdomain}`);
      try {
        const res = await fetch(
          `/api/am-admin/tenants/${encodeURIComponent(subdomain)}/suspend`,
          { method: "POST", credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(
          t("am_admin_employees.toast_suspended").replace("{name}", label),
        );
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : t("am_admin_employees.alert_suspend_failed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const handleUnsuspend = useCallback(
    async (subdomain: string, label: string) => {
      setBusy(`unsuspend:${subdomain}`);
      try {
        const res = await fetch(
          `/api/am-admin/tenants/${encodeURIComponent(subdomain)}/unsuspend`,
          { method: "POST", credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(
          t("am_admin_employees.toast_unsuspended").replace("{name}", label),
        );
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : t("am_admin_employees.alert_unsuspend_failed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const handleDeleteTenant = useCallback(
    async (subdomain: string, label: string) => {
      if (
        !confirm(
          `${t("am_admin_employees.confirm_delete_tenant_prefix")}${subdomain}${t("am_admin_employees.confirm_delete_tenant_suffix")}`,
        )
      )
        return;
      setBusy(`delete:${subdomain}`);
      try {
        const res = await fetch(
          `/api/am-admin/tenants/${encodeURIComponent(subdomain)}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || `HTTP ${res.status}`);
        }
        toast.success(
          t("am_admin_employees.toast_deleted").replace("{name}", label),
        );
        await refresh();
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : t("am_admin_employees.alert_delete_failed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const handleResendInvite = useCallback(
    async (token: string, email: string) => {
      setBusy(`resend:${token}`);
      try {
        const res = await fetch(
          `/api/am-admin/invites/${encodeURIComponent(token)}`,
          { method: "POST", credentials: "include" },
        );
        const data = await res.json();
        if (res.ok && data.mailSent) {
          toast.success(
            t("am_admin_employees.toast_invite_resent").replace(
              "{email}",
              email,
            ),
          );
        } else {
          const reason =
            data.reason ||
            data.error ||
            t("am_admin_employees.alert_resend_failed_unknown");
          toast.error(
            `${t("am_admin_employees.alert_resend_failed_prefix")}${reason}`,
          );
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const handleDeleteInvite = useCallback(
    async (token: string, subdomain: string) => {
      if (
        !confirm(
          `${t("am_admin_employees.confirm_delete_invite_prefix")}${subdomain}${t("am_admin_employees.confirm_delete_invite_suffix")}`,
        )
      )
        return;
      setBusy(`delete-invite:${token}`);
      try {
        const res = await fetch(
          `/api/am-admin/invites/${encodeURIComponent(token)}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) {
          toast.error(t("am_admin_employees.alert_delete_failed"));
          return;
        }
        toast.success(
          t("am_admin_employees.toast_invite_deleted").replace(
            "{subdomain}",
            subdomain,
          ),
        );
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [refresh, t],
  );

  const SortIcon = ({ active, dir }: { active: boolean; dir: SortDir }) => {
    if (!active) return <span className="text-white/25 ml-1">↕</span>;
    return (
      <span className="text-blue-300 ml-1">{dir === "asc" ? "↑" : "↓"}</span>
    );
  };

  // ─── Render ──────────────────────────────────────────────────────────
  const orgLabel = companyName || prefix;

  return (
    <section
      className="bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl p-6"
      data-testid="employee-list-section"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-medium">
            {t("am_admin_employees.heading")}
          </h2>
          <p className="text-xs text-white/55">
            {t("am_admin_employees.description_under")}{" "}
            <span className="font-medium text-white/70">{orgLabel}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Seats-progress-bar — venstre (D-092 hybrid-seat) */}
          <SeatProgressBar
            activeSeats={activeSeats}
            pendingSeats={pendingSeats}
            maxSeats={hasCap ? totalSeats : null}
            tooltip={t("am_admin_employees.seats_tooltip")}
          />
          {/* Oppdater — ved siden av "+ Ansatt" (secondary outline) */}
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 text-white/70 hover:text-white text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="employee-list-refresh"
            aria-label={t("am_admin_employees.refresh_aria")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {loading
              ? t("am_admin_employees.refresh_busy")
              : t("am_admin_employees.refresh_btn")}
          </button>
          {/* + Ansatt — helt til høyre */}
          {!invitesBlocked && !seatsFull && (
            <button
              onClick={() => setInviteOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium transition"
              data-testid="employee-add-btn"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t("am_admin_employees.add_employee_btn")}
            </button>
          )}
          {!invitesBlocked && seatsFull && (
            <>
              <button
                disabled
                className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs cursor-not-allowed"
                title={t("am_admin_employees.seats_full_tooltip")}
                data-testid="employee-add-seats-full"
              >
                {t("am_admin_employees.seats_full_btn")}
              </button>
              {/* D-093 (2026-06-28) — Be om utvidelse CTA */}
              <a
                href={(() => {
                  const orgLabel = companyName ?? prefix;
                  const subject = t(
                    "am_admin_employees.upgrade_email_subject",
                  ).replace("{orgName}", orgLabel);
                  const body = t(
                    "am_admin_employees.upgrade_email_body",
                  )
                    .replace("{orgName}", orgLabel)
                    .replace("{activeSeats}", String(activeSeats))
                    .replace("{pendingSeats}", String(pendingSeats))
                    .replace("{maxSeats}", String(totalSeats));
                  return `mailto:salg@kodovault.no?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                })()}
                data-testid="employee-request-upgrade-link"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold transition"
              >
                <Mail className="h-3.5 w-3.5" />
                {t("am_admin_employees.upgrade_request_btn")}
              </a>
            </>
          )}
          {invitesBlocked && (
            <button
              disabled
              className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs cursor-not-allowed"
              title={t("am_admin_invites.blocked_tooltip")}
              data-testid="employee-add-blocked"
            >
              {t("am_admin_invites.new_btn_disabled")}
            </button>
          )}
        </div>
      </header>

      {/* Inline invite-form */}
      {inviteOpen && (
        <InlineInviteForm
          prefix={prefix}
          onClose={() => setInviteOpen(false)}
          onCreated={() => {
            setInviteOpen(false);
            void refresh();
          }}
        />
      )}

      {/* Filter-input */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40 pointer-events-none" />
          <input
            type="text"
            placeholder={t("am_admin_employees.filter_placeholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-black/30 border border-white/15 text-sm text-white focus:border-blue-300/60 outline-none"
            data-testid="employee-filter-input"
          />
        </div>
        {filter && (
          <span
            className="text-xs text-white/55"
            data-testid="employee-filter-count"
          >
            {filteredSorted.length} / {rows.length}
          </span>
        )}
      </div>

      {error && (
        <div
          className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2 mb-3"
          data-testid="employee-list-error"
        >
          {error}
        </div>
      )}

      {!loading && filteredSorted.length === 0 && !error && (
        <p className="text-sm text-white/45 py-4 text-center">
          {rows.length === 0
            ? t("am_admin_employees.empty_state")
            : t("am_admin_employees.no_filter_match")}
        </p>
      )}

      {filteredSorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="employee-list-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-white/45 border-b border-white/10">
                <SortableTh
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => toggleSort("name")}
                  testId="th-name"
                  SortIcon={SortIcon}
                >
                  {t("am_admin_employees.col_name")}
                </SortableTh>
                <SortableTh
                  active={sortKey === "subdomain"}
                  dir={sortDir}
                  onClick={() => toggleSort("subdomain")}
                  testId="th-subdomain"
                  SortIcon={SortIcon}
                >
                  {t("am_admin_employees.col_subdomain")}
                </SortableTh>
                <SortableTh
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => toggleSort("status")}
                  testId="th-status"
                  SortIcon={SortIcon}
                >
                  {t("am_admin_employees.col_status")}
                </SortableTh>
                <th
                  scope="col"
                  className="py-2 pl-3 text-right font-medium"
                >
                  {t("am_admin_employees.col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map((row) => {
                const badgeKey =
                  row.kind === "invite"
                    ? row.statusKey === "pending"
                      ? "pending_invite"
                      : "expired_invite"
                    : row.statusKey;
                const isBusy =
                  busy?.endsWith(`:${row.subdomain}`) ||
                  (row.kind === "invite" && busy?.endsWith(`:${row.token}`));
                const statusI18nKey = STATUS_I18N_KEY[badgeKey];
                const statusLabel = statusI18nKey
                  ? t(statusI18nKey)
                  : row.statusKey;
                return (
                  <tr
                    key={`${row.kind}-${row.subdomain}`}
                    className="border-b border-white/5 last:border-0"
                    data-testid={`employee-row-${row.subdomain}`}
                  >
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-white/45 truncate max-w-[24ch]">
                        {row.email}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className="font-mono text-xs text-white/80"
                        data-testid={`employee-subdomain-${row.subdomain}`}
                      >
                        {row.subdomain}.kodovault.no
                      </span>
                      {row.kind === "invite" && row.mailSentAt && (
                        <div className="text-[10px] text-emerald-300/70 mt-0.5">
                          {t("am_admin_employees.email_sent_badge")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border whitespace-nowrap ${STATUS_BADGE[badgeKey] ?? "bg-white/10 border-white/15"}`}
                        data-testid={`employee-status-${row.subdomain}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex items-center gap-1 justify-end">
                        {row.kind === "tenant" &&
                          row.statusKey !== "deleted" &&
                          isUnlocked && (
                            <button
                              onClick={() =>
                                setNotesFor({
                                  subdomain: row.subdomain,
                                  name: row.name,
                                })
                              }
                              disabled={!!isBusy}
                              className="text-xs px-2 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 disabled:opacity-50"
                              data-testid={`employee-notes-${row.subdomain}`}
                            >
                              {t("am_admin_employees.action_notes")}
                            </button>
                          )}
                        {row.kind === "tenant" &&
                          row.statusKey === "suspended" && (
                            <button
                              onClick={() => void handleUnsuspend(row.subdomain, row.name)}
                              disabled={!!isBusy}
                              className="text-xs px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 disabled:opacity-50"
                              data-testid={`employee-unsuspend-${row.subdomain}`}
                            >
                              {t("am_admin_employees.action_unsuspend")}
                            </button>
                          )}
                        {row.kind === "tenant" &&
                          row.statusKey !== "suspended" &&
                          row.statusKey !== "deleted" && (
                            <button
                              onClick={() => void handleSuspend(row.subdomain, row.name)}
                              disabled={!!isBusy}
                              className="text-xs px-2 py-1 rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-200 disabled:opacity-50"
                              data-testid={`employee-suspend-${row.subdomain}`}
                            >
                              {t("am_admin_employees.action_suspend")}
                            </button>
                          )}
                        {row.kind === "tenant" &&
                          row.statusKey !== "deleted" && (
                            <button
                              onClick={() =>
                                void handleDeleteTenant(row.subdomain, row.name)
                              }
                              disabled={!!isBusy}
                              className="text-xs px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 disabled:opacity-50"
                              data-testid={`employee-delete-${row.subdomain}`}
                            >
                              {t("am_admin_employees.action_delete")}
                            </button>
                          )}
                        {row.kind === "invite" && row.statusKey === "pending" && (
                          <button
                            onClick={() => void handleResendInvite(row.token, row.email)}
                            disabled={!!isBusy}
                            className="text-xs px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 disabled:opacity-50"
                            data-testid={`invite-resend-${row.subdomain}`}
                          >
                            {t("am_admin_employees.action_resend_invite")}
                          </button>
                        )}
                        {row.kind === "invite" && (
                          <button
                            onClick={() =>
                              void handleDeleteInvite(row.token, row.subdomain)
                            }
                            disabled={!!isBusy}
                            className="text-xs px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 disabled:opacity-50"
                            data-testid={`invite-delete-${row.subdomain}`}
                          >
                            {t("am_admin_employees.action_delete")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {notesFor && (
        <AdminNotesModal
          subdomain={notesFor.subdomain}
          employeeName={notesFor.name}
          onClose={() => setNotesFor(null)}
        />
      )}
    </section>
  );
}

// ─── Sorterbar header-celle ───────────────────────────────────────────
function SortableTh({
  active,
  dir,
  onClick,
  children,
  testId,
  SortIcon,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  SortIcon: React.ComponentType<{ active: boolean; dir: SortDir }>;
}) {
  return (
    <th
      scope="col"
      className={`py-2 ${testId === "th-name" ? "pr-3" : "px-3"} font-medium`}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center text-[11px] uppercase tracking-wide text-white/45 hover:text-white/85 transition-colors"
        data-testid={testId}
      >
        {children}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  );
}
