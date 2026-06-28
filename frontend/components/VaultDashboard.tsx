"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Fingerprint,
  LayoutGrid,
  List,
  Plus,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { EntryModal } from "./EntryModal";
import { useLocale } from "@/lib/i18n-context";
import type { VaultEntry } from "@/lib/types";
import type { AppConfig, CategoryConfig } from "@/lib/config";
import type { BiometricInfo } from "@/hooks/useVault";

interface VaultDashboardProps {
  entries: VaultEntry[];
  config: AppConfig;
  biometric: BiometricInfo;
  onSaveEntries: (next: VaultEntry[]) => Promise<void>;
  onRemoveBiometric: () => void;
}

type ModalState =
  | { open: false }
  | { open: true; mode: "view" | "edit"; entry: VaultEntry }
  | { open: true; mode: "new"; entry: null };

type ViewMode = "list" | "grouped";

// Synthetic category-key for the "Favoritter" pseudo-group at the top.
// Uses leading underscore to avoid colliding with real category keys.
const FAVORITES_KEY = "_favorites";

export function VaultDashboard({
  entries,
  config,
  biometric,
  onSaveEntries,
  onRemoveBiometric,
}: VaultDashboardProps) {
  const { t } = useLocale();
  const [modal, setModal] = useState<ModalState>({ open: false });
  // viewMode følger tenant-config (config.ui.passwordsViewMode). useState gir
  // ett initial-snapshot, men hvis config lastes asynkront (eller endrer seg)
  // sync'er useEffect state til ny config-verdi. Mike kan likevel klikke
  // Liste/Gruppert manuelt — det overstyres først ved neste config-endring.
  const initialViewMode: ViewMode =
    config.ui.passwordsViewMode === "grouped" ? "grouped" : "list";
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  useEffect(() => {
    setViewMode(
      config.ui.passwordsViewMode === "grouped" ? "grouped" : "list",
    );
  }, [config.ui.passwordsViewMode]);
  const [query, setQuery] = useState("");
  // Hver pålogging starter med ALT lukket (per Mike — ingen persistens).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const sorter = (a: VaultEntry, b: VaultEntry) => {
    if (config.ui.showFavoritesFirst && !!a.favorite !== !!b.favorite) {
      return a.favorite ? -1 : 1;
    }
    if (config.ui.defaultSort === "lastModified") {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
    return a.title.localeCompare(b.title, config.ui.dateLocale);
  };

  // Filtrert entries-set basert på søk
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const cat = config.categories.find((c) => c.key === e.category);
      const haystack = [
        e.title,
        e.username,
        e.url,
        cat?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, query, config.categories]);

  // Flat sortert liste (for Liste-modus eller ved tom data)
  const sortedFlat = useMemo(() => {
    const arr = [...filtered];
    arr.sort(sorter);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, config.ui]);

  // Grupper for Gruppert-modus.
  // Rekkefølge fra default.json. Tomme kategorier skjules.
  // ⭐ Favoritter-pseudogruppe ALLTID på toppen (hvis det finnes favoritter
  // som matcher søket) — duplikater vises i sin egen kategori også (D-valg 3b).
  const groups = useMemo(() => {
    const result: Array<{
      key: string;
      label: string;
      icon: string;
      color: string;
      entries: VaultEntry[];
    }> = [];

    // 1) Favoritter på toppen
    const favs = filtered.filter((e) => e.favorite);
    if (favs.length > 0) {
      const favSorted = [...favs].sort(sorter);
      result.push({
        key: FAVORITES_KEY,
        label: t("vault.favorites_label"),
        icon: "⭐",
        color: "#fbbf24",
        entries: favSorted,
      });
    }

    // 2) Kategorier i rekkefølge fra default.json
    for (const cat of config.categories) {
      const catEntries = filtered.filter((e) => e.category === cat.key);
      if (catEntries.length === 0) continue; // Skjul tomme
      const sorted = [...catEntries].sort(sorter);
      result.push({
        key: cat.key,
        label: cat.label,
        icon: cat.icon,
        color: cat.color,
        entries: sorted,
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, config.categories, config.ui]);

  // Når brukeren søker i Gruppert-modus, auto-utvid grupper med treff
  // (slik at man faktisk ser resultatene) — uten å mutere brukerens
  // permanente valg når søket tømmes.
  const isSearching = query.trim().length > 0;
  const isGroupExpanded = (key: string) =>
    isSearching ? true : expanded.has(key);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveEntry = async (entry: VaultEntry) => {
    const exists = entries.some((e) => e.id === entry.id);
    const next = exists
      ? entries.map((e) => (e.id === entry.id ? entry : e))
      : [...entries, entry];
    await onSaveEntries(next);
  };

  const deleteEntry = async (id: string) => {
    await onSaveEntries(entries.filter((e) => e.id !== id));
  };

  const totalCount = entries.length;
  const filteredCount = filtered.length;

  return (
    <>
      <div
        data-testid="vault-dashboard"
        className="w-full max-w-2xl backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 animate-slide-up"
      >
        {/* Header: oppføringer-teller + Ny */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <span>
              {totalCount} {totalCount === 1 ? t("vault.entries_count_singular") : t("vault.entries_count_plural")}
              {isSearching && filteredCount !== totalCount && (
                <span className="text-white/50 font-normal">
                  {" "}
                  · {filteredCount} {t("vault.search_results_suffix")}
                </span>
              )}
            </span>
          </h2>
          <button
            data-testid="vault-add-btn"
            onClick={() => setModal({ open: true, mode: "new", entry: null })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold shadow transition"
          >
            <Plus className="h-4 w-4" />
            {t("vault.new_button")}
          </button>
        </div>

        {/* Toolbar: Liste/Gruppert-toggle + søk (søk kun desktop) */}
        {totalCount > 0 && (
          <div
            data-testid="vault-toolbar"
            className="flex flex-wrap items-center gap-2 mb-3"
          >
            {/* Mode-toggle */}
            <div
              role="group"
              aria-label={t("vault.view_mode_aria")}
              className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5"
            >
              <button
                data-testid="vault-view-list-btn"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "list"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("vault.view_list_tooltip")}
              >
                <List className="h-3.5 w-3.5" />
                <span>{t("vault.view_list")}</span>
              </button>
              <button
                data-testid="vault-view-grouped-btn"
                onClick={() => setViewMode("grouped")}
                aria-pressed={viewMode === "grouped"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "grouped"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("vault.view_grouped_tooltip")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>{t("vault.view_grouped")}</span>
              </button>
            </div>

            {/* Åpne/lukk alle grupper — kun synlig i Gruppert-modus.
                Iter 19.9.2 (Mike 2026-06-24): vise/skjule alt på én side. */}
            {viewMode === "grouped" && groups.length > 0 && (
              <div
                className="flex items-center gap-1"
                data-testid="vault-expand-collapse-controls"
              >
                <button
                  type="button"
                  data-testid="vault-expand-all-btn"
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
                  data-testid="vault-collapse-all-btn"
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
                placeholder={t("vault.search_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="vault-inline-search"
                className="w-full h-8 pl-9 pr-8 rounded-lg bg-white/5 border border-white/10 focus:border-white/30 focus:bg-white/[0.07] outline-none text-white text-[12px] placeholder:text-white/35 transition"
                aria-label={t("vault.search_aria")}
              />
              {query && (
                <button
                  data-testid="vault-inline-search-clear-btn"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition"
                  aria-label={t("vault.search_clear_aria")}
                  title={t("vault.search_clear_aria")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Resultat-område */}
        {sortedFlat.length === 0 && totalCount === 0 ? (
          <div
            data-testid="vault-empty-state"
            className="py-12 px-6 text-center flex flex-col items-center gap-3"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-400/15 border border-blue-300/30 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-blue-200" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <p className="text-sm font-semibold text-white/90">
                {t("vault.empty_state_title")}
              </p>
              <p className="text-[12px] text-white/55 leading-relaxed">
                {t("vault.empty_state_message")}
              </p>
            </div>
            <button
              data-testid="vault-empty-add-btn"
              onClick={() => setModal({ open: true, mode: "new", entry: null })}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition shadow"
            >
              <Plus className="h-4 w-4" />
              {t("vault.empty_state_button")}
            </button>
          </div>
        ) : sortedFlat.length === 0 ? (
          <div
            data-testid="vault-no-results"
            className="py-8 text-center text-white/55 text-sm"
          >
            {t("vault.no_results_for")} &ldquo;{query}&rdquo;.
          </div>
        ) : viewMode === "list" ? (
          <ul className="space-y-1.5">
            {sortedFlat.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                categories={config.categories}
                onClick={() => setModal({ open: true, mode: "view", entry })}
              />
            ))}
          </ul>
        ) : (
          <div className="space-y-2">
            {groups.map((g) => (
              <CategoryGroup
                key={g.key}
                groupKey={g.key}
                label={g.label}
                icon={g.icon}
                color={g.color}
                count={g.entries.length}
                expanded={isGroupExpanded(g.key)}
                onToggle={() => toggleGroup(g.key)}
                entries={g.entries}
                categories={config.categories}
                onEntryClick={(entry) =>
                  setModal({ open: true, mode: "view", entry })
                }
              />
            ))}
          </div>
        )}

        {biometric.registered && (
          <div
            data-testid="biometric-active-row"
            className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-400/15 border border-emerald-300/30 flex items-center justify-center">
                <Fingerprint className="h-3.5 w-3.5 text-emerald-200" />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-white/85">
                  {t("vault.biometric_active_title")}
                </div>
                <div className="text-[10px] text-white/45">
                  {biometric.masterFresh
                    ? t("vault.biometric_ready")
                    : t("vault.biometric_master_required")}
                </div>
              </div>
            </div>
            <button
              data-testid="biometric-remove-btn"
              onClick={onRemoveBiometric}
              className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-[10px] font-medium text-white/70 hover:text-white transition"
            >
              {t("vault.biometric_remove_button")}
            </button>
          </div>
        )}
      </div>

      <EntryModal
        open={modal.open}
        mode={modal.open ? modal.mode : "view"}
        entry={modal.open ? modal.entry : null}
        categories={config.categories}
        clipboardClearSeconds={config.security.clipboardClearSeconds}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        onClose={() => setModal({ open: false })}
        onSave={saveEntry}
        onDelete={deleteEntry}
      />
    </>
  );
}

function CategoryGroup({
  groupKey,
  label,
  icon,
  color,
  count,
  expanded,
  onToggle,
  entries,
  categories,
  onEntryClick,
}: {
  groupKey: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  entries: VaultEntry[];
  categories: CategoryConfig[];
  onEntryClick: (entry: VaultEntry) => void;
}) {
  return (
    <div
      data-testid={`vault-group-${groupKey}`}
      className="rounded-lg overflow-hidden"
    >
      <button
        data-testid={`vault-group-toggle-${groupKey}`}
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-left transition group"
      >
        <ChevronRight
          className={`h-4 w-4 text-white/40 group-hover:text-white/70 flex-shrink-0 transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
        <div
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-base"
          style={{
            backgroundColor: `${color}22`,
            border: `1px solid ${color}55`,
          }}
        >
          {icon}
        </div>
        <span className="flex-1 text-sm font-semibold text-white truncate">
          {label}
        </span>
        <span
          className="text-[11px] font-mono px-2 py-0.5 rounded-full"
          style={{
            color,
            backgroundColor: `${color}18`,
          }}
        >
          {count}
        </span>
      </button>
      {expanded && (
        <ul
          data-testid={`vault-group-list-${groupKey}`}
          className="space-y-1.5 pl-4 sm:pl-7 pr-1 pt-1.5 pb-1"
        >
          {entries.map((entry) => (
            <EntryRow
              key={`${groupKey}-${entry.id}`}
              entry={entry}
              categories={categories}
              onClick={() => onEntryClick(entry)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  categories,
  onClick,
}: {
  entry: VaultEntry;
  categories: CategoryConfig[];
  onClick: () => void;
}) {
  const cat = categories.find((c) => c.key === entry.category);
  return (
    <li>
      <button
        data-testid={`vault-entry-${entry.id}`}
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-left transition group"
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base"
          style={{
            backgroundColor: cat ? `${cat.color}22` : "rgba(255,255,255,0.05)",
            border: `1px solid ${cat ? `${cat.color}55` : "rgba(255,255,255,0.1)"}`,
          }}
          title={cat?.label}
        >
          {cat?.icon || "📁"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {entry.favorite && (
              <Star
                className="h-3 w-3 text-amber-300 flex-shrink-0"
                fill="currentColor"
              />
            )}
            <span className="text-sm font-medium text-white truncate">
              {entry.title}
            </span>
          </div>
          {entry.username && (
            <div className="text-[11px] text-white/50 font-mono truncate mt-0.5">
              {entry.username}
            </div>
          )}
        </div>

        {entry.url && (
          <ExternalLink className="h-3.5 w-3.5 text-white/30 group-hover:text-white/60 flex-shrink-0 transition" />
        )}
      </button>
    </li>
  );
}
