"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  Clock,
  Filter as FilterIcon,
  Fingerprint,
  KeyRound,
  Pencil,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { VaultEvent } from "@/lib/events-sync";
import { useLocale } from "@/lib/i18n-context";
import { translate } from "@/lib/i18n";

interface EventLogPanelProps {
  open: boolean;
  events: VaultEvent[];
  loading: boolean;
  locale: string;
  onRefresh: () => void;
  onClear: () => void;
  onClose: () => void;
}

type Filter = "all" | "unlocks" | "fails" | "modifications";

const FILTER_KEYS: Filter[] = ["all", "unlocks", "fails", "modifications"];

export function EventLogPanel({
  open,
  events,
  loading,
  locale,
  onRefresh,
  onClear,
  onClose,
}: EventLogPanelProps) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    switch (filter) {
      case "unlocks":
        return events.filter(
          (e) =>
            e.kind === "unlock-success" || e.kind === "unlock-biometric",
        );
      case "fails":
        return events.filter((e) => e.kind === "unlock-fail");
      case "modifications":
        return events.filter(
          (e) =>
            e.kind === "modify" ||
            e.kind === "master-changed" ||
            e.kind === "reset",
        );
      default:
        return events;
    }
  }, [events, filter]);

  const stats = useMemo(() => {
    const by = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] || 0) + 1;
      return acc;
    }, {});
    return {
      total: events.length,
      unlocks:
        (by["unlock-success"] || 0) + (by["unlock-biometric"] || 0),
      fails: by["unlock-fail"] || 0,
      modifies:
        (by["modify"] || 0) +
        (by["master-changed"] || 0) +
        (by["reset"] || 0),
    };
  }, [events]);

  if (!open) return null;

  return (
    <div
      data-testid="event-log-overlay"
      className="fixed inset-0 z-[59] bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="event-log-panel"
        className="w-full max-w-2xl my-8 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
              <Clock className="h-4 w-4 text-white/80" />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight">
                {t("event_log.title")}
              </h3>
              <div className="text-[10px] text-white/45">
                {t("event_log.subtitle_1")} {events.length} {t("event_log.subtitle_2")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="eventlog-refresh"
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
              aria-label={t("event_log.refresh_aria")}
              title={t("event_log.refresh_tooltip")}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
            </button>
            <button
              type="button"
              data-testid="eventlog-clear"
              onClick={onClear}
              disabled={events.length === 0}
              className="p-1.5 rounded text-white/50 hover:text-rose-300 hover:bg-white/10 transition disabled:opacity-30"
              aria-label={t("event_log.clear_aria")}
              title={t("event_log.clear_tooltip")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              data-testid="eventlog-close"
              onClick={onClose}
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition ml-1"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 px-5 py-3 border-b border-white/10 bg-white/[0.02]">
          <Stat label={t("event_log.stat_total")} value={stats.total} tone="neutral" />
          <Stat label={t("event_log.stat_unlocks")} value={stats.unlocks} tone="success" />
          <Stat label={t("event_log.stat_fails")} value={stats.fails} tone="danger" />
          <Stat label={t("event_log.stat_modifies")} value={stats.modifies} tone="info" />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-white/10 overflow-x-auto">
          <FilterIcon className="h-3.5 w-3.5 text-white/40 flex-shrink-0 mr-1" />
          {FILTER_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              data-testid={`eventlog-filter-${key}`}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition whitespace-nowrap ${
                filter === key
                  ? "bg-blue-500/20 border-blue-400/50 text-white"
                  : "bg-white/5 border-white/10 text-white/55 hover:bg-white/10 hover:text-white/80"
              }`}
            >
              {t(`event_log.filter_${key === "modifications" ? "modifications" : key}`)}
            </button>
          ))}
        </div>

        {/* Liste */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && events.length === 0 ? (
            <div className="text-[11px] text-white/50 text-center py-8">
              {t("event_log.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <div
              data-testid="eventlog-empty"
              className="text-[11px] text-white/50 text-center py-8"
            >
              {events.length === 0
                ? t("event_log.empty_no_events")
                : t("event_log.empty_no_results")}
            </div>
          ) : (
            <ul className="space-y-1.5" data-testid="eventlog-list">
              {filtered.map((ev) => (
                <EventRow key={ev.id} event={ev} locale={locale} />
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 bg-white/[0.03] text-[10px] text-white/40 rounded-b-2xl">
          {t("event_log.footer_hint")}
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "danger" | "info";
}) {
  const color =
    tone === "success"
      ? "text-emerald-200"
      : tone === "danger"
        ? "text-rose-300"
        : tone === "info"
          ? "text-blue-200"
          : "text-white/90";
  return (
    <div className="flex flex-col items-center justify-center px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
      <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
      <div className="text-[9px] font-semibold text-white/50 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function EventRow({ event, locale }: { event: VaultEvent; locale: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const d = new Date(event.at);
  const when = isNaN(d.getTime())
    ? event.at
    : d.toLocaleString(locale, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
  const meta = eventMeta(event.kind, locale);

  return (
    <li
      data-testid={`eventlog-row-${event.kind}`}
      className="rounded-xl bg-white/5 border border-white/10"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center ${meta.color}`}
        >
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-white/90 truncate">
              {meta.label}
            </span>
            <span className="text-[10px] text-white/40 font-mono">
              {when}
            </span>
          </div>
          <div className="text-[10px] text-white/50 truncate">
            {event.device}
            {event.location && (
              <>
                {" · "}
                {event.location}
              </>
            )}
          </div>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 text-white/30 flex-shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-1 text-[10px] text-white/55 font-mono">
          <KvLine k={t("event_log.kv_id")} v={event.id} />
          <KvLine k={t("event_log.kv_ip")} v={event.ip || t("common.em_dash")} />
          <KvLine k={t("event_log.kv_timestamp")} v={event.at} />
          <KvLine k={t("event_log.kv_user_agent")} v={event.userAgent} />
          {event.country && <KvLine k={t("event_log.kv_country")} v={event.country} />}
          {event.city && <KvLine k={t("event_log.kv_city")} v={event.city} />}
        </div>
      )}
    </li>
  );
}

function KvLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/40 flex-shrink-0">{k}:</span>
      <span className="truncate text-right" title={v}>
        {v}
      </span>
    </div>
  );
}

function eventMeta(kind: string, locale: string): {
  label: string;
  icon: ReactNode;
  color: string;
} {
  // `locale` sendes inn fra `EventRow`-propsen og brukes som argument til
  // `translate()`-pure-funksjonen. Faller automatisk tilbake til norsk hvis
  // nøkkelen mangler i den valgte locale (per i18n-kontrakt).
  const l = locale as Parameters<typeof translate>[1];
  switch (kind) {
    case "unlock-success":
      return {
        label: translate("event_log.event_unlock_success", l),
        icon: <KeyRound className="h-3.5 w-3.5" />,
        color: "bg-emerald-400/15 border-emerald-300/30 text-emerald-200",
      };
    case "unlock-biometric":
      return {
        label: translate("event_log.event_unlock_biometric", l),
        icon: <Fingerprint className="h-3.5 w-3.5" />,
        color: "bg-emerald-400/15 border-emerald-300/30 text-emerald-200",
      };
    case "unlock-fail":
      return {
        label: translate("event_log.event_unlock_fail", l),
        icon: <XCircle className="h-3.5 w-3.5" />,
        color: "bg-rose-500/15 border-rose-400/30 text-rose-300",
      };
    case "access":
      return {
        label: translate("event_log.event_access", l),
        icon: <Shield className="h-3.5 w-3.5" />,
        color: "bg-white/10 border-white/20 text-white/70",
      };
    case "modify":
      return {
        label: translate("event_log.event_modify", l),
        icon: <Pencil className="h-3.5 w-3.5" />,
        color: "bg-blue-400/15 border-blue-300/30 text-blue-200",
      };
    case "master-changed":
      return {
        label: translate("event_log.event_master_changed", l),
        icon: <KeyRound className="h-3.5 w-3.5" />,
        color: "bg-amber-400/15 border-amber-300/30 text-amber-200",
      };
    case "reset":
      return {
        label: translate("event_log.event_reset", l),
        icon: <ShieldOff className="h-3.5 w-3.5" />,
        color: "bg-rose-500/15 border-rose-400/30 text-rose-300",
      };
    default:
      return {
        label: kind,
        icon: <Shield className="h-3.5 w-3.5" />,
        color: "bg-white/10 border-white/20 text-white/70",
      };
  }
}
