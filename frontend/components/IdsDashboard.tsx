"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { IdModal } from "./IdModal";
import { IDS_THEME } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";
import { localeCompare } from "@/lib/format-date";
import type { IdsStatus } from "@/hooks/useIds";
import type { IdKind, VaultId } from "@/lib/types";
import type { AppConfig } from "@/lib/config";

interface IdsDashboardProps {
  status: IdsStatus;
  error: string | null;
  ids: VaultId[];
  config: AppConfig;
  onSaveIds: (next: VaultId[]) => Promise<void>;
}

type ViewMode = "list" | "grouped";

type ModalState =
  | { open: false }
  | { open: true; mode: "view" | "edit"; id: VaultId }
  | { open: true; mode: "new"; id: null };

/** ID-type metadata (Spec §3). Brukes for både liste-thumbnails og gruppering.
 *  Iter 19.9.15 (#13): Labels flyttet til i18n via ID_KIND_LABEL_KEY for
 *  full språk-støtte. ID_KIND_META beholder kun emoji + farge (statisk). */
const ID_KIND_META: Record<IdKind, { emoji: string; color: string }> = {
  pass: { emoji: "🛂", color: "#fb923c" }, // orange-400
  driver: { emoji: "🚗", color: "#fbbf24" }, // amber-400
  "id-card": { emoji: "🆔", color: "#60a5fa" }, // blue-400
  health: { emoji: "🏥", color: "#34d399" }, // emerald-400
};

const ID_KIND_LABEL_KEY: Record<IdKind, string> = {
  pass: "ids.kind_pass",
  driver: "ids.kind_driver",
  "id-card": "ids.kind_id_card",
  health: "ids.kind_health",
};

const FAVORITES_KEY = "_favorites";
const KIND_ORDER: IdKind[] = ["pass", "driver", "id-card", "health"];

/** Hent utløpsdato fra en VaultId (varierer pr type). Returnerer ISO eller null. */
function expiryDateOf(id: VaultId): string | null {
  switch (id.kind) {
    case "pass":
      return id.expiryDate;
    case "driver":
      return id.expiryDate;
    case "id-card":
      return id.expiryDate ?? null;
    case "health":
      return id.validTo;
  }
}

function formatExpiry(
  iso: string | null,
  t: (key: string) => string,
): string {
  if (!iso) return t("ids.expiry_none");
  const [y, m] = iso.split("-");
  if (!y || !m) return iso;
  return `${t("ids.expiry_prefix")} ${m}/${y.slice(-2)}`;
}

/** Hent identifikator-tekst for en ID (vises i listen som metadata). */
function identifierOf(id: VaultId): string {
  switch (id.kind) {
    case "pass":
      return id.passportNumber;
    case "driver":
      return id.licenseNumber;
    case "id-card":
      return id.number;
    case "health":
      return id.policyNumber;
  }
}

export function IdsDashboard({
  status,
  error,
  ids,
  config,
  onSaveIds,
}: IdsDashboardProps) {
  const { t, locale } = useLocale();
  const [modal, setModal] = useState<ModalState>({ open: false });
  // viewMode følger tenant-config (config.ui.idsViewMode). useState gir
  // bruker mulighet til å toggle i session — neste session starter fra
  // config-verdien igjen. Samme mønster som VaultDashboard/CardsDashboard.
  const [viewMode, setViewMode] = useState<ViewMode>(
    config.ui.idsViewMode === "grouped" ? "grouped" : "list",
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Iter 19.9.2 (Mike 2026-06-24): inline-søk i ID, samme mønster som
  // Passord/Kort. Filter på title + identifier-felt avhengig av kind.
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ids;
    return ids.filter((id) => {
      const parts: string[] = [id.title];
      if (id.kind === "pass") parts.push(id.passportNumber, id.nation);
      else if (id.kind === "driver") parts.push(id.licenseNumber, id.country);
      else if (id.kind === "id-card") parts.push(id.number, id.issuer);
      return parts
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [ids, query]);

  const isSearching = query.trim().length > 0;
  const isGroupExpanded = (key: string) =>
    isSearching ? true : expanded.has(key);

  const sorter = (a: VaultId, b: VaultId) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return localeCompare(a.title, b.title, locale);
  };

  // Flat sortert liste
  const flat = useMemo(() => [...filtered].sort(sorter), [filtered]);

  // Grupper for Gruppert-modus: Favoritter først, deretter pr ID-type
  const groups = useMemo(() => {
    const out: { key: string; label: string; color: string; items: VaultId[] }[] = [];
    const favs = filtered.filter((i) => i.favorite).sort(sorter);
    if (favs.length > 0) {
      out.push({
        key: FAVORITES_KEY,
        label: `⭐ ${t("vault.favorites_label")}`,
        color: "#fbbf24",
        items: favs,
      });
    }
    const byKind: Record<IdKind, VaultId[]> = {
      pass: [],
      driver: [],
      "id-card": [],
      health: [],
    };
    filtered.forEach((i) => byKind[i.kind].push(i));
    KIND_ORDER.forEach((k) => {
      if (byKind[k].length > 0) {
        out.push({
          key: k,
          label: `${ID_KIND_META[k].emoji} ${t(ID_KIND_LABEL_KEY[k])}`,
          color: ID_KIND_META[k].color,
          items: byKind[k].sort(sorter),
        });
      }
    });
    return out;
  }, [filtered]);

  const toggleGroup = (k: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const saveId = async (id: VaultId) => {
    const exists = ids.some((x) => x.id === id.id);
    const next = exists ? ids.map((x) => (x.id === id.id ? id : x)) : [...ids, id];
    await onSaveIds(next);
  };

  const deleteId = async (id: string) => {
    await onSaveIds(ids.filter((x) => x.id !== id));
  };

  return (
    <>
      <div
        data-testid="ids-dashboard"
        className="w-full max-w-2xl backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 animate-slide-up"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <BadgeCheck className={`h-5 w-5 ${IDS_THEME.iconColor}`} />
            <span>
              {ids.length}{" "}
              {ids.length === 1
                ? t("ids.count_singular")
                : t("ids.count_plural")}
            </span>
          </h2>
          {status === "ready" && (
            <button
              data-testid="ids-add-btn"
              onClick={() => setModal({ open: true, mode: "new", id: null })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${IDS_THEME.primaryButton} text-white text-xs font-semibold shadow transition`}
            >
              <Plus className="h-4 w-4" />
              Ny
            </button>
          )}
        </div>

        {/* Liste/Gruppert-toggle (synlig kun når det er ID-er) */}
        {status === "ready" && ids.length > 0 && (
          <div data-testid="ids-toolbar" className="flex flex-wrap items-center gap-2 mb-3">
            <div
              role="group"
              aria-label={t("ids.view_mode_aria")}
              className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5"
            >
              <button
                data-testid="ids-view-list-btn"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "list"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("ids.view_list_tooltip")}
              >
                <List className="h-3.5 w-3.5" />
                <span>{t("vault.view_list")}</span>
              </button>
              <button
                data-testid="ids-view-grouped-btn"
                onClick={() => setViewMode("grouped")}
                aria-pressed={viewMode === "grouped"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "grouped"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("ids.view_grouped_tooltip")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>{t("vault.view_grouped")}</span>
              </button>
            </div>

            {/* Iter 19.9.2 — Åpne/lukk alle grupper, kun i Gruppert-modus */}
            {viewMode === "grouped" && groups.length > 0 && (
              <div
                className="flex items-center gap-1"
                data-testid="ids-expand-collapse-controls"
              >
                <button
                  type="button"
                  data-testid="ids-expand-all-btn"
                  onClick={() =>
                    setExpanded(new Set(groups.map((g) => g.key)))
                  }
                  title={t("vault.expand_all_tooltip")}
                  className="flex items-center justify-center w-8 h-8 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/65 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/20"
                  aria-label={t("vault.expand_all_aria")}
                >
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  data-testid="ids-collapse-all-btn"
                  onClick={() => setExpanded(new Set())}
                  title={t("vault.collapse_all_tooltip")}
                  className="flex items-center justify-center w-8 h-8 rounded-md bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 text-white/65 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white/20"
                  aria-label={t("vault.collapse_all_aria")}
                >
                  <ChevronsDownUp className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Inline-søk — full bredde på mobil (wrappes til ny linje via
                toolbar flex-wrap), flex-1 på desktop. Iter 19.9.15 (#3). */}
            <div className="flex w-full sm:w-auto sm:flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/35 pointer-events-none" />
              <input
                type="text"
                inputMode="search"
                placeholder={t("ids.search_placeholder")}
                aria-label={t("ids.search_aria")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="ids-inline-search"
                className="w-full h-8 pl-9 pr-8 rounded-lg bg-white/5 border border-white/10 focus:border-white/30 focus:bg-white/[0.07] outline-none text-white text-[12px] placeholder:text-white/35 transition"
              />
              {query && (
                <button
                  type="button"
                  data-testid="ids-inline-search-clear-btn"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-white/45 hover:text-white hover:bg-white/10 transition"
                  aria-label={t("ids.search_clear_aria")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {(status === "idle" || status === "loading") && (
          <div
            data-testid="ids-loading"
            className="py-10 flex items-center justify-center gap-2 text-white/60"
          >
            <Loader2 className={`h-4 w-4 animate-spin ${IDS_THEME.spinnerColor}`} />
            <span className="text-sm">{t("ids.loading_message")}</span>
          </div>
        )}

        {status === "error" && (
          <div
            data-testid="ids-error"
            className="py-6 text-center text-rose-200/80 text-[12px]"
          >
            {error || t("ids.error_default")}
          </div>
        )}

        {status === "locked" && (
          <div
            data-testid="ids-master-mismatch"
            className="py-8 px-4 text-center text-amber-200/85 text-[12px] flex flex-col items-center gap-2"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/25 flex items-center justify-center">
              <Lock className="h-4 w-4 text-amber-200" />
            </div>
            <p>
              {error ||
                t("ids.error_blob_mismatch")}
            </p>
          </div>
        )}

        {status === "ready" && ids.length === 0 && (
          <div
            data-testid="ids-empty-state"
            className="py-12 px-6 text-center flex flex-col items-center gap-3"
          >
            <div className={`w-12 h-12 rounded-2xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center`}>
              <BadgeCheck className={`h-5 w-5 ${IDS_THEME.iconColor}`} />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <p className="text-sm font-semibold text-white/90">
                {t("ids.empty_state_title")}
              </p>
              <p className="text-[12px] text-white/55 leading-relaxed">
                {t("ids.empty_state_message")}
              </p>
            </div>
            <button
              data-testid="ids-empty-add-btn"
              onClick={() => setModal({ open: true, mode: "new", id: null })}
              className={`mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg ${IDS_THEME.primaryButton} text-white text-xs font-semibold transition shadow`}
            >
              <Plus className="h-4 w-4" />
              {t("ids.empty_state_button")}
            </button>
          </div>
        )}

        {status === "ready" && ids.length > 0 && filtered.length === 0 && (
          <div
            data-testid="ids-no-results"
            className="py-8 text-center text-white/55 text-sm"
          >
            {t("ids.no_results_for")} &ldquo;{query}&rdquo;.
          </div>
        )}

        {status === "ready" && filtered.length > 0 && viewMode === "list" && (
          <ul data-testid="ids-list" className="space-y-1.5">
            {flat.map((id) => (
              <IdRow
                key={id.id}
                id={id}
                onClick={() => setModal({ open: true, mode: "view", id })}
              />
            ))}
          </ul>
        )}

        {status === "ready" && filtered.length > 0 && viewMode === "grouped" && (
          <div data-testid="ids-grouped" className="space-y-2">
            {groups.map((g) => {
              const isOpen = isGroupExpanded(g.key);
              return (
                <div
                  key={g.key}
                  data-testid={`ids-group-${g.key}`}
                  className="rounded-lg bg-white/5 border border-white/10 overflow-hidden"
                >
                  <button
                    onClick={() => toggleGroup(g.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-white/55" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-white/55" />
                    )}
                    <span
                      className="text-sm font-semibold flex-1"
                      style={{ color: g.color }}
                    >
                      {g.label}
                    </span>
                    <span className="text-[10px] font-mono text-white/45 px-1.5 py-0.5 rounded-full bg-white/5">
                      {g.items.length}
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="px-2 pb-2 space-y-1.5">
                      {g.items.map((id) => (
                        <IdRow
                          key={id.id}
                          id={id}
                          onClick={() =>
                            setModal({ open: true, mode: "view", id })
                          }
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <IdModal
        open={modal.open}
        mode={modal.open ? modal.mode : "view"}
        id={modal.open ? modal.id : null}
        onClose={() => setModal({ open: false })}
        onSave={saveId}
        onDelete={deleteId}
      />
    </>
  );
}

function IdRow({ id, onClick }: { id: VaultId; onClick: () => void }) {
  const { t } = useLocale();
  const meta = ID_KIND_META[id.kind];
  const kindLabel = t(ID_KIND_LABEL_KEY[id.kind]);
  const expiry = formatExpiry(expiryDateOf(id), t);
  const ident = identifierOf(id);
  const firstAttachment = id.attachments?.[0];
  const totalAttachments = id.attachments?.length ?? 0;
  const hasAttachment = !!firstAttachment;
  const isPdf = firstAttachment?.mime === "application/pdf";
  return (
    <li>
      <button
        data-testid={`id-row-${id.id}`}
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-left transition group"
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-lg overflow-hidden"
          style={{
            backgroundColor: `${meta.color}22`,
            border: `1px solid ${meta.color}55`,
          }}
        >
          {hasAttachment && !isPdf ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${firstAttachment.mime};base64,${firstAttachment.data}`}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : hasAttachment && isPdf ? (
            <FileText className="h-4 w-4" style={{ color: meta.color }} />
          ) : (
            <span aria-hidden>{meta.emoji}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {id.favorite && (
              <Star
                className="h-3 w-3 text-amber-300 flex-shrink-0"
                fill="currentColor"
              />
            )}
            <span className="text-sm font-medium text-white truncate">
              {id.title}
            </span>
            {totalAttachments > 0 && (
              <span
                className="flex-shrink-0 text-[9px] flex items-center gap-0.5 text-white/40"
                title={`${totalAttachments} ${t("ids.attachments_count_suffix")}`}
              >
                {isPdf ? (
                  <FileText className="h-3 w-3" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {totalAttachments > 1 && (
                  <span className="font-mono text-[9px]">×{totalAttachments}</span>
                )}
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/50 font-mono truncate mt-0.5">
            <span style={{ color: meta.color }}>{kindLabel}</span>
            <span className="mx-1.5 text-white/30">·</span>
            <span className="truncate">{ident}</span>
            <span className="mx-1.5 text-white/30">·</span>
            <span>{expiry}</span>
          </div>
        </div>
      </button>
    </li>
  );
}
