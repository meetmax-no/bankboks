"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll Sikkerhet
 *
 * Innhold:
 *   1. Bytt passord (frivillig — gjenbruker ChangePasswordForm med forced=false)
 *   2. Login-historikk (siste 90 dager, maks 50 events) fra /api/am-admin/auth/history
 *   3. Logg ut alle enheter — POST /api/am-admin/auth/logout-all
 *   4. MPW-status (om satt opp + krysslink til MPW-fanen)
 *
 * Tilgjengelig for ALLE admin-roller. Logout-all påvirker kun innlogget bruker.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LogOut, ShieldAlert } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { formatShortDateTime } from "@/lib/format-date";
import { ChangePasswordForm } from "../ChangePasswordForm";

type LoginEvent = {
  ts: number;
  ip: string;
  ua: string;
  host: string;
};

type Props = {
  lastLoginAt: string | null;
  mpwSetup: boolean;
  onGoToMpwTab: () => void;
};

export function KonsollSecurityTab({
  lastLoginAt,
  mpwSetup,
  onGoToMpwTab,
}: Props) {
  const { t, locale } = useLocale();
  const [showChangePw, setShowChangePw] = useState(false);
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [logoutBusy, setLogoutBusy] = useState(false);
  // Iter 20.9 (D-087, Mike 2026-06-27): kompakt log-visning — 5 events default,
  // utvid til scrollbar container + dato-filter (7/30/90d) ved klikk.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyFilterDays, setHistoryFilterDays] = useState<7 | 30 | 90>(90);

  const COMPACT_COUNT = 5;

  // Filtrer events basert på filter-pills (kun aktivt når ekspandert).
  const filteredEvents = (() => {
    if (!historyExpanded) return events;
    const cutoff = Date.now() - historyFilterDays * 24 * 60 * 60 * 1000;
    return events.filter((e) => e.ts >= cutoff);
  })();
  const visibleEvents = historyExpanded
    ? filteredEvents
    : events.slice(0, COMPACT_COUNT);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/am-admin/auth/history?days=90", {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.events)) {
          setEvents(data.events as LoginEvent[]);
        }
      }
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const handleLogoutAll = useCallback(async () => {
    if (!confirm(t("am_admin_settings.logout_all_confirm"))) return;
    setLogoutBusy(true);
    try {
      const res = await fetch("/api/am-admin/auth/logout-all", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        toast.error(t("am_admin_settings.logout_all_failed"));
        return;
      }
      toast.success(t("am_admin_settings.logout_all_success"));
      // Redirect til login (current session er invalidert)
      setTimeout(() => {
        window.location.href = "/";
      }, 1200);
    } finally {
      setLogoutBusy(false);
    }
  }, [t]);

  return (
    <div className="space-y-5">
      {/* ─── Bytt passord ───────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-security-password"
      >
        <SectionTitle>
          {t("am_admin_settings.password_section_title")}
        </SectionTitle>
        <p className="text-[11px] text-white/45 mb-3 mt-1">
          {t("am_admin_settings.password_section_help")}
        </p>
        {!showChangePw ? (
          <button
            onClick={() => setShowChangePw(true)}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-xs"
            data-testid="konsoll-security-change-password-btn"
          >
            {t("am_admin_account.change_password_btn")}
          </button>
        ) : (
          <div>
            <ChangePasswordForm
              forced={false}
              onSuccess={() => {
                setShowChangePw(false);
                toast.success(t("am_admin_settings.password_changed_toast"));
              }}
            />
            <button
              onClick={() => setShowChangePw(false)}
              className="mt-2 text-xs text-white/55 hover:text-white/85"
              data-testid="konsoll-security-change-password-cancel"
            >
              {t("am_admin_account.cancel_password_btn")}
            </button>
          </div>
        )}
      </section>

      {/* ─── MPW-status ──────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-security-mpw-status"
      >
        <SectionTitle>{t("am_admin_settings.mpw_section_title")}</SectionTitle>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">
              {mpwSetup ? (
                <span className="text-emerald-300">
                  ● {t("am_admin_settings.mpw_status_setup")}
                </span>
              ) : (
                <span className="text-amber-300">
                  ● {t("am_admin_settings.mpw_status_not_setup")}
                </span>
              )}
            </p>
            <p className="text-[11px] text-white/45 mt-1">
              {t("am_admin_settings.mpw_section_help")}
            </p>
          </div>
          <button
            onClick={onGoToMpwTab}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-xs whitespace-nowrap"
            data-testid="konsoll-security-mpw-link"
          >
            {t("am_admin_settings.go_to_mpw_btn")}
          </button>
        </div>
      </section>

      {/* ─── Login-historikk ────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-security-history"
      >
        <SectionTitle>
          {t("am_admin_settings.history_section_title")}
        </SectionTitle>
        {lastLoginAt && (
          <div className="mt-2 mb-3 text-xs flex flex-wrap gap-x-4 gap-y-1">
            <span>
              <span className="text-white/45">
                {t("am_admin_settings.last_login_label")}
              </span>{" "}
              <span className="font-mono text-white/85">
                {formatShortDateTime(lastLoginAt, locale)}
              </span>
            </span>
            <span>
              <span className="text-white/45">
                {t("am_admin_settings.history_summary_total")}
              </span>{" "}
              <span className="font-mono text-white/85">{events.length}</span>
            </span>
            <span>
              <span className="text-white/45">
                {t("am_admin_settings.history_summary_devices")}
              </span>{" "}
              <span className="font-mono text-white/85">
                {uniqueDeviceCount(events)}
              </span>
            </span>
          </div>
        )}

        {loadingHistory && (
          <p className="text-sm text-white/45">
            {t("am_admin_settings.history_loading")}
          </p>
        )}
        {!loadingHistory && events.length === 0 && (
          <p className="text-sm text-white/45">
            {t("am_admin_settings.history_empty")}
          </p>
        )}

        {!loadingHistory && events.length > 0 && (
          <>
            {/* Filter-pills (synlig kun når ekspandert) */}
            {historyExpanded && (
              <div className="flex gap-1.5 mb-3" data-testid="konsoll-history-filter">
                {([7, 30, 90] as const).map((d) => {
                  const active = historyFilterDays === d;
                  return (
                    <button
                      key={d}
                      onClick={() => setHistoryFilterDays(d)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition ${
                        active
                          ? "bg-amber-400/15 border-amber-400/60 text-amber-100"
                          : "bg-white/5 border-white/10 text-white/55 hover:text-white/85"
                      }`}
                      data-testid={`history-filter-${d}d`}
                    >
                      {t("am_admin_settings.history_filter_prefix")}{" "}
                      {d}{" "}
                      {t("am_admin_settings.history_filter_days")}
                    </button>
                  );
                })}
              </div>
            )}

            <div
              className={`overflow-x-auto ${historyExpanded ? "max-h-96 overflow-y-auto" : ""}`}
            >
              <table
                className="w-full text-xs"
                data-testid="konsoll-history-table"
              >
                <thead
                  className={
                    historyExpanded
                      ? "sticky top-0 bg-slate-900/95 backdrop-blur-sm"
                      : ""
                  }
                >
                  <tr className="text-left text-[10px] uppercase tracking-wide text-white/45 border-b border-white/10">
                    <th className="py-2 pr-3 font-medium">
                      {t("am_admin_settings.history_col_time")}
                    </th>
                    <th className="py-2 px-3 font-medium">
                      {t("am_admin_settings.history_col_ip")}
                    </th>
                    <th className="py-2 px-3 font-medium">
                      {t("am_admin_settings.history_col_ua")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((e) => (
                    <tr
                      key={e.ts}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="py-2 pr-3 font-mono text-white/80">
                        {formatShortDateTime(
                          new Date(e.ts).toISOString(),
                          locale,
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-white/65">
                        {e.ip}
                      </td>
                      <td className="py-2 px-3 text-white/55 truncate max-w-[32ch]">
                        {summarizeUserAgent(e.ua)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Toggle: expand/collapse */}
            {events.length > COMPACT_COUNT && (
              <button
                onClick={() => setHistoryExpanded((v) => !v)}
                className="mt-3 text-[11px] text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline"
                data-testid="konsoll-history-toggle"
              >
                {historyExpanded
                  ? t("am_admin_settings.history_show_less")
                  : `${t("am_admin_settings.history_show_more_prefix")} (${events.length - COMPACT_COUNT} ${t("am_admin_settings.history_show_more_suffix")})`}
              </button>
            )}
          </>
        )}
      </section>

      {/* ─── Logg ut alle enheter ──────────────────────────────── */}
      <section
        className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.05] p-4"
        data-testid="konsoll-security-logout-all"
      >
        <SectionTitle>
          <span className="flex items-center gap-1.5 text-rose-200/85">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t("am_admin_settings.logout_all_heading")}
          </span>
        </SectionTitle>
        <p className="text-[11px] text-white/55 mt-1 mb-3">
          {t("am_admin_settings.logout_all_help")}
        </p>
        <button
          onClick={() => void handleLogoutAll()}
          disabled={logoutBusy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/40 text-rose-100 text-xs font-medium disabled:opacity-50"
          data-testid="konsoll-logout-all-btn"
        >
          <LogOut className="h-3.5 w-3.5" />
          {logoutBusy
            ? t("am_admin_settings.logout_all_busy")
            : t("am_admin_settings.logout_all_btn")}
        </button>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.12em]">
      {children}
    </h3>
  );
}

function uniqueDeviceCount(events: { ua: string }[]): number {
  // Tell unike "browser · OS"-kombinasjoner — gir bedre signal enn ren ua-streng.
  const set = new Set<string>();
  for (const e of events) set.add(summarizeUserAgent(e.ua));
  return set.size;
}

function summarizeUserAgent(ua: string): string {
  // Veldig enkel parser — viser bare browser-navn + OS for å holde UI ren.
  if (!ua) return "—";
  let browser = "Other";
  if (/edg\b|edge/i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  let os = "";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os|macintosh/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ios/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return os ? `${browser} · ${os}` : browser;
}
