"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-084) — TeamManagementSection
 *
 * Synlig KUN for super-admin (klient-side guard; server håndhever 403).
 * Tabell + "+ Legg til admin" / "+ Legg til super-admin"-knapper.
 *
 * Bruker `CreateOrgAdminCard`-mønster: passord-generator, og velkomstmail
 * sendes automatisk fra `POST /api/am-admin/team`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";
import { formatShortDateTime } from "@/lib/format-date";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { OrgAdminPublic } from "@/lib/platform/org-admin-types";

type Props = {
  /** ID til innlogget super-admin — brukes for selvslett/selvsuspendering-guards. */
  currentAdminId: string;
};

type ListResponse = {
  prefix: string;
  count: number;
  admins: OrgAdminPublic[];
};

function generatePassword(): string {
  // 16 tegn, kun ufarlige ASCII-tegn (ikke I/l/O/0 for klarhet).
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += charset[b % charset.length];
  return out;
}

export function TeamManagementSection({ currentAdminId }: Props) {
  const { t, locale } = useLocale();
  const [admins, setAdmins] = useState<OrgAdminPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<null | "admin" | "super-admin">(
    null,
  );
  // D-143 (2026-02): erstatt native window.confirm() med ConfirmDialog +
  // type-to-confirm på e-post. Alerts erstattet med toast.error.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/am-admin/team", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ListResponse = await res.json();
      setAdmins(data.admins);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("am_admin_team.fetch_failed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = useMemo(
    () =>
      [...admins].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [admins],
  );

  const activeSuperCount = useMemo(
    () =>
      admins.filter((a) => a.role === "super-admin" && !a.suspended).length,
    [admins],
  );

  const handleDelete = useCallback(
    (admin: OrgAdminPublic) => {
      if (admin.id === currentAdminId) {
        toast.error(t("am_admin_team.error_cannot_delete_self"));
        return;
      }
      setPendingDelete({
        id: admin.id,
        name: `${admin.firstName} ${admin.lastName}`.trim() || admin.email,
        email: admin.email,
      });
    },
    [currentAdminId, t],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setBusy(`delete:${pendingDelete.id}`);
    try {
      const res = await fetch(
        `/api/am-admin/team/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "org_admin_last_super_admin") {
          toast.error(t("am_admin_team.error_last_super_admin"));
        } else {
          toast.error(data.detail || data.error || `HTTP ${res.status}`);
        }
        return;
      }
      toast.success(
        t("am_admin_team.delete_success").replace(
          "{name}",
          pendingDelete.name,
        ),
      );
      setPendingDelete(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [pendingDelete, refresh, t]);

  const handleSuspendToggle = useCallback(
    async (admin: OrgAdminPublic) => {
      const action = admin.suspended ? "unsuspend" : "suspend";
      if (admin.id === currentAdminId && action === "suspend") {
        toast.error(t("am_admin_team.error_cannot_suspend_self"));
        return;
      }
      setBusy(`${action}:${admin.id}`);
      try {
        const res = await fetch(
          `/api/am-admin/team/${encodeURIComponent(admin.id)}?action=${action}`,
          { method: "POST", credentials: "include" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data.error === "org_admin_last_super_admin") {
            toast.error(t("am_admin_team.error_last_super_admin"));
          } else {
            toast.error(data.detail || data.error || `HTTP ${res.status}`);
          }
          return;
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [currentAdminId, refresh, t],
  );

  return (
    <section
      className="bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl p-6"
      data-testid="team-management-section"
    >
      <header className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">
            {t("am_admin_team.heading")}
          </h2>
          <p className="text-xs text-white/55 mt-0.5">
            {t("am_admin_team.description")}
          </p>
        </div>
        {createMode === null && (
          <div className="flex gap-2">
            <button
              onClick={() => setCreateMode("admin")}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
              data-testid="team-add-admin-btn"
            >
              {t("am_admin_team.add_admin_btn")}
            </button>
            <button
              onClick={() => setCreateMode("super-admin")}
              className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-xs text-amber-100"
              data-testid="team-add-super-admin-btn"
            >
              {t("am_admin_team.add_super_admin_btn")}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div
          className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2 mb-3"
          data-testid="team-error"
        >
          {error}
        </div>
      )}

      {createMode && (
        <CreateAdminForm
          role={createMode}
          onClose={() => setCreateMode(null)}
          onCreated={() => {
            setCreateMode(null);
            void refresh();
          }}
        />
      )}

      {loading && (
        <p className="text-sm text-white/45 py-3">
          {t("am_admin_team.loading")}
        </p>
      )}

      {!loading && sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="team-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-white/45 border-b border-white/10">
                <th className="py-2 pr-3 font-medium">
                  {t("am_admin_team.col_name")}
                </th>
                <th className="py-2 px-3 font-medium">
                  {t("am_admin_team.col_email")}
                </th>
                <th className="py-2 px-3 font-medium">
                  {t("am_admin_team.col_role")}
                </th>
                <th className="py-2 px-3 font-medium">
                  {t("am_admin_team.col_created")}
                </th>
                <th className="py-2 pl-3 text-right font-medium">
                  {t("am_admin_team.col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const isCurrent = a.id === currentAdminId;
                const isLastSuper =
                  a.role === "super-admin" &&
                  !a.suspended &&
                  activeSuperCount <= 1;
                const isBusy = busy?.endsWith(`:${a.id}`);
                return (
                  <tr
                    key={a.id}
                    className="border-b border-white/5 last:border-0"
                    data-testid={`team-row-${a.id}`}
                  >
                    <td className="py-3 pr-3">
                      <div className="font-medium">
                        {a.firstName} {a.lastName}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] text-emerald-300/85 font-normal">
                            {t("am_admin_team.you_badge")}
                          </span>
                        )}
                      </div>
                      {a.suspended && (
                        <div className="text-[10px] text-amber-300/85 mt-0.5">
                          {t("am_admin_team.status_suspended")}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-white/85 font-mono text-xs">
                      {a.email}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border ${
                          a.role === "super-admin"
                            ? "bg-amber-500/15 text-amber-200 border-amber-400/30"
                            : "bg-white/10 text-white/70 border-white/20"
                        }`}
                      >
                        {a.role === "super-admin"
                          ? t("am_admin_team.role_super_admin")
                          : t("am_admin_team.role_admin")}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-white/55 text-xs">
                      {formatShortDateTime(a.createdAt, locale)}
                    </td>
                    <td className="py-3 pl-3">
                      <div className="flex items-center gap-1 justify-end">
                        {!isCurrent && (
                          <button
                            onClick={() => void handleSuspendToggle(a)}
                            disabled={!!isBusy || isLastSuper}
                            title={
                              isLastSuper
                                ? t("am_admin_team.tooltip_last_super_admin")
                                : ""
                            }
                            className="text-xs px-2 py-1 rounded bg-orange-500/10 hover:bg-orange-500/20 text-orange-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            data-testid={`team-suspend-${a.id}`}
                          >
                            {a.suspended
                              ? t("am_admin_team.action_unsuspend")
                              : t("am_admin_team.action_suspend")}
                          </button>
                        )}
                        {!isCurrent && (
                          <button
                            onClick={() => void handleDelete(a)}
                            disabled={!!isBusy || isLastSuper}
                            title={
                              isLastSuper
                                ? t("am_admin_team.tooltip_last_super_admin")
                                : ""
                            }
                            className="text-xs px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            data-testid={`team-delete-${a.id}`}
                          >
                            {t("am_admin_team.action_delete")}
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

      {/* D-143 (2026-02): erstatt native window.confirm() med mørk
          ConfirmDialog + type-to-confirm på e-post. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("am_admin_team.delete_dialog_title")}
        description={
          pendingDelete ? (
            <span data-testid="team-delete-dialog-desc">
              {t("am_admin_team.delete_dialog_desc")
                .replace("{name}", pendingDelete.name)
                .replace("{email}", pendingDelete.email)}
            </span>
          ) : (
            ""
          )
        }
        confirmLabel={t("am_admin_team.delete_dialog_confirm")}
        variant="destructive"
        busy={busy?.startsWith("delete:") ?? false}
        requireConfirmText={pendingDelete?.email}
        onConfirm={() => void performDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

// ─── Opprett-form ─────────────────────────────────────────────────────
function CreateAdminForm({
  role,
  onClose,
  onCreated,
}: {
  role: "admin" | "super-admin";
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    password: string;
    mailSent: boolean;
  } | null>(null);

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 3 &&
    password.length >= 8 &&
    !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/am-admin/team", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "org_admin_email_exists") {
          setErr(t("am_admin_team.error_email_exists"));
        } else if (data.error === "org_admin_weak_password") {
          setErr(t("am_admin_team.error_weak_password"));
        } else if (data.error === "org_admin_invalid_email") {
          setErr(t("am_admin_team.error_invalid_email"));
        } else {
          setErr(data.detail || data.error || `HTTP ${res.status}`);
        }
        return;
      }
      setCreated({
        email,
        password,
        mailSent: data.welcomeEmail?.ok === true,
      });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div
        className="bg-emerald-500/5 border border-emerald-400/25 rounded-xl p-4 mb-4"
        data-testid="team-create-success"
      >
        <p className="text-sm text-emerald-200 font-medium mb-2">
          {created.mailSent
            ? t("am_admin_team.created_with_email")
            : t("am_admin_team.created_without_email")}
        </p>
        <dl className="text-xs space-y-1 mb-3">
          <div className="flex gap-2">
            <dt className="text-white/55 w-28">
              {t("am_admin_team.field_email")}
            </dt>
            <dd className="font-mono text-white/85">{created.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/55 w-28">
              {t("am_admin_team.field_temp_password")}
            </dt>
            <dd className="font-mono text-white/85 select-all">
              {created.password}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] text-amber-200/80 mb-3">
          {t("am_admin_team.temp_password_warning")}
        </p>
        <button
          onClick={onCreated}
          className="px-4 py-1.5 rounded-lg bg-white text-[#0b0e14] text-xs font-medium hover:bg-white/90"
          data-testid="team-create-close-btn"
        >
          {t("am_admin_team.close_btn")}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 bg-white/[0.02] border border-white/10 rounded-xl p-4 mb-4"
      data-testid="team-create-form"
    >
      <h3 className="text-sm font-medium">
        {role === "super-admin"
          ? t("am_admin_team.form_title_super_admin")
          : t("am_admin_team.form_title_admin")}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          required
          placeholder={t("am_admin_team.field_first_name")}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
          data-testid="team-create-firstname"
        />
        <input
          required
          placeholder={t("am_admin_team.field_last_name")}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
          data-testid="team-create-lastname"
        />
      </div>
      <input
        required
        type="email"
        placeholder={t("am_admin_team.field_email")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
        data-testid="team-create-email"
      />
      <div>
        <label className="block text-[11px] text-white/55 mb-1">
          {t("am_admin_team.field_temp_password")}
        </label>
        <div className="flex gap-2">
          <input
            required
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm font-mono"
            data-testid="team-create-password"
          />
          <button
            type="button"
            onClick={() => setPassword(generatePassword())}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
            data-testid="team-create-regenerate"
          >
            {t("am_admin_team.regenerate_btn")}
          </button>
        </div>
        <p className="text-[10px] text-white/45 mt-1">
          {t("am_admin_team.temp_password_hint")}
        </p>
      </div>
      {err && (
        <p
          className="text-xs text-rose-300"
          data-testid="team-create-error"
        >
          {err}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
          data-testid="team-create-cancel"
        >
          {t("am_admin_team.cancel_btn")}
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium"
          data-testid="team-create-submit"
        >
          {busy ? t("am_admin_team.submitting") : t("am_admin_team.submit_btn")}
        </button>
      </div>
    </form>
  );
}
