"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CreditCard,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { CardModal } from "./CardModal";
import type { CardsStatus } from "@/hooks/useCards";
import type { CardType, VaultCard } from "@/lib/types";
import type { AppConfig } from "@/lib/config";
import { useLocale } from "@/lib/i18n-context";
import { localeCompare } from "@/lib/format-date";

interface CardsDashboardProps {
  status: CardsStatus;
  error: string | null;
  cards: VaultCard[];
  config: AppConfig;
  onSaveCards: (next: VaultCard[]) => Promise<void>;
}

type ViewMode = "list" | "grouped";

type ModalState =
  | { open: false }
  | { open: true; mode: "view" | "edit"; card: VaultCard }
  | { open: true; mode: "new"; card: null };

const CARD_TYPE_KEY: Record<CardType, string> = {
  credit: "cards.type_credit",
  debit: "cards.type_debit",
  virtual: "cards.type_virtual",
  reward: "cards.type_reward",
};

const CARD_TYPE_COLORS: Record<CardType, string> = {
  credit: "#a78bfa",
  debit: "#60a5fa",
  virtual: "#22d3ee",
  reward: "#fbbf24",
};

const FAVORITES_KEY = "_favorites";

function maskedTail(num: string): string {
  const clean = num.replace(/\s/g, "");
  if (clean.length < 4) return clean;
  return `••••${clean.slice(-4)}`;
}

export function CardsDashboard({
  status,
  error,
  cards,
  config,
  onSaveCards,
}: CardsDashboardProps) {
  const { t, locale } = useLocale();
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [viewMode, setViewMode] = useState<ViewMode>(
    config.ui.cardsViewMode === "grouped" ? "grouped" : "list",
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Iter 19.9.2 (Mike 2026-06-24): inline-søk i Kort, samme mønster som
  // VaultDashboard. Filter på title + holderName + cardNumber. Auto-utvider
  // grupper når søk er aktivt så treff alltid er synlige.
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const haystack = [c.title, c.holderName, c.cardNumber]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [cards, query]);

  const isSearching = query.trim().length > 0;
  const isGroupExpanded = (key: string) =>
    isSearching ? true : expanded.has(key);

  const sorter = (a: VaultCard, b: VaultCard) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    return localeCompare(a.title, b.title, locale);
  };

  // Flat sortert liste (Liste-modus)
  const flat = useMemo(() => [...filtered].sort(sorter), [filtered]);

  // Grupper for Gruppert-modus: Favoritter først, deretter pr cardType
  const groups = useMemo(() => {
    const out: { key: string; label: string; color: string; items: VaultCard[] }[] = [];
    const favs = filtered.filter((c) => c.favorite).sort(sorter);
    if (favs.length > 0) {
      out.push({
        key: FAVORITES_KEY,
        label: `⭐ ${t("vault.favorites_label")}`,
        color: "#fbbf24",
        items: favs,
      });
    }
    const byType: Record<CardType, VaultCard[]> = {
      credit: [],
      debit: [],
      virtual: [],
      reward: [],
    };
    filtered.forEach((c) => byType[c.cardType].push(c));
    (Object.keys(byType) as CardType[]).forEach((ct) => {
      if (byType[ct].length > 0) {
        out.push({
          key: ct,
          label: t(CARD_TYPE_KEY[ct]),
          color: CARD_TYPE_COLORS[ct],
          items: byType[ct].sort(sorter),
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

  const saveCard = async (card: VaultCard) => {
    const exists = cards.some((c) => c.id === card.id);
    const next = exists
      ? cards.map((c) => (c.id === card.id ? card : c))
      : [...cards, card];
    await onSaveCards(next);
  };

  const deleteCard = async (id: string) => {
    await onSaveCards(cards.filter((c) => c.id !== id));
  };

  return (
    <>
      <div
        data-testid="cards-dashboard"
        className="w-full max-w-2xl backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 animate-slide-up"
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-300" />
            <span>
              {cards.length}{" "}
              {cards.length === 1
                ? t("cards.count_singular")
                : t("cards.count_plural")}
            </span>
          </h2>
          {status === "ready" && (
            <button
              data-testid="cards-add-btn"
              onClick={() => setModal({ open: true, mode: "new", card: null })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold shadow transition"
            >
              <Plus className="h-4 w-4" />
              {t("common.new")}
            </button>
          )}
        </div>

        {/* Liste/Gruppert-toggle (synlig kun når det er kort) */}
        {status === "ready" && cards.length > 0 && (
          <div
            data-testid="cards-toolbar"
            className="flex flex-wrap items-center gap-2 mb-3"
          >
            <div
              role="group"
              aria-label={t("cards.view_mode_aria")}
              className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5"
            >
              <button
                data-testid="cards-view-list-btn"
                onClick={() => setViewMode("list")}
                aria-pressed={viewMode === "list"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "list"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("cards.view_list_tooltip")}
              >
                <List className="h-3.5 w-3.5" />
                <span>{t("vault.view_list")}</span>
              </button>
              <button
                data-testid="cards-view-grouped-btn"
                onClick={() => setViewMode("grouped")}
                aria-pressed={viewMode === "grouped"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition ${
                  viewMode === "grouped"
                    ? "bg-white/15 text-white shadow-inner"
                    : "text-white/55 hover:text-white/85"
                }`}
                title={t("cards.view_grouped_tooltip")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>{t("vault.view_grouped")}</span>
              </button>
            </div>

            {/* Iter 19.9.2 — Åpne/lukk alle grupper, kun i Gruppert-modus */}
            {viewMode === "grouped" && groups.length > 0 && (
              <div
                className="flex items-center gap-1"
                data-testid="cards-expand-collapse-controls"
              >
                <button
                  type="button"
                  data-testid="cards-expand-all-btn"
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
                  data-testid="cards-collapse-all-btn"
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
                placeholder={t("cards.search_placeholder")}
                aria-label={t("cards.search_aria")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="cards-inline-search"
                className="w-full h-8 pl-9 pr-8 rounded-lg bg-white/5 border border-white/10 focus:border-white/30 focus:bg-white/[0.07] outline-none text-white text-[12px] placeholder:text-white/35 transition"
              />
              {query && (
                <button
                  type="button"
                  data-testid="cards-inline-search-clear-btn"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-white/45 hover:text-white hover:bg-white/10 transition"
                  aria-label={t("cards.search_clear_aria")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {(status === "idle" || status === "loading") && (
          <div
            data-testid="cards-loading"
            className="py-10 flex items-center justify-center gap-2 text-white/60"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t("cards.loading_message")}</span>
          </div>
        )}

        {status === "error" && (
          <div
            data-testid="cards-error"
            className="py-6 text-center text-rose-200/80 text-[12px]"
          >
            {error || t("cards.error_default")}
          </div>
        )}

        {status === "locked" && (
          <div
            data-testid="cards-master-mismatch"
            className="py-8 px-4 text-center text-amber-200/85 text-[12px] flex flex-col items-center gap-2"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/25 flex items-center justify-center">
              <Lock className="h-4 w-4 text-amber-200" />
            </div>
            <p>
              {error ||
                t("cards.error_blob_mismatch")}
            </p>
          </div>
        )}

        {status === "ready" && cards.length === 0 && (
          <div
            data-testid="cards-empty-state"
            className="py-12 px-6 text-center flex flex-col items-center gap-3"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-400/15 border border-blue-300/30 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-blue-200" />
            </div>
            <div className="space-y-1.5 max-w-sm">
              <p className="text-sm font-semibold text-white/90">
                {t("cards.empty_state_title")}
              </p>
              <p className="text-[12px] text-white/55 leading-relaxed">
                {t("cards.empty_state_message")}
              </p>
            </div>
            <button
              data-testid="cards-empty-add-btn"
              onClick={() => setModal({ open: true, mode: "new", card: null })}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition shadow"
            >
              <Plus className="h-4 w-4" />
              {t("cards.empty_state_button")}
            </button>
          </div>
        )}

        {status === "ready" && cards.length > 0 && filtered.length === 0 && (
          <div
            data-testid="cards-no-results"
            className="py-8 text-center text-white/55 text-sm"
          >
            {t("cards.no_results_for")} &ldquo;{query}&rdquo;.
          </div>
        )}

        {status === "ready" && filtered.length > 0 && viewMode === "list" && (
          <ul data-testid="cards-list" className="space-y-1.5">
            {flat.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                onClick={() => setModal({ open: true, mode: "view", card })}
              />
            ))}
          </ul>
        )}

        {status === "ready" && filtered.length > 0 && viewMode === "grouped" && (
          <div data-testid="cards-grouped" className="space-y-2">
            {groups.map((g) => {
              const isOpen = isGroupExpanded(g.key);
              return (
                <div
                  key={g.key}
                  data-testid={`cards-group-${g.key}`}
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
                      {g.items.map((card) => (
                        <CardRow
                          key={card.id}
                          card={card}
                          onClick={() =>
                            setModal({ open: true, mode: "view", card })
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

      <CardModal
        open={modal.open}
        mode={modal.open ? modal.mode : "view"}
        card={modal.open ? modal.card : null}
        clipboardClearSeconds={config.security.clipboardClearSeconds}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        imageConfig={config.image}
        onClose={() => setModal({ open: false })}
        onSave={saveCard}
        onDelete={deleteCard}
      />
    </>
  );
}

function CardRow({
  card,
  onClick,
}: {
  card: VaultCard;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const color = CARD_TYPE_COLORS[card.cardType];
  return (
    <li>
      <button
        data-testid={`card-row-${card.id}`}
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-left transition group"
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: `${color}22`,
            border: `1px solid ${color}55`,
          }}
        >
          <CreditCard className="h-4 w-4" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {card.favorite && (
              <Star
                className="h-3 w-3 text-amber-300 flex-shrink-0"
                fill="currentColor"
              />
            )}
            <span className="text-sm font-medium text-white truncate">
              {card.title}
            </span>
          </div>
          <div className="text-[11px] text-white/50 font-mono truncate mt-0.5">
            <span style={{ color }}>{t(CARD_TYPE_KEY[card.cardType])}</span>
            <span className="mx-1.5 text-white/30">·</span>
            {maskedTail(card.cardNumber)}
            <span className="mx-1.5 text-white/30">·</span>
            <span>
              {card.expiryMonth}/{card.expiryYear.slice(-2)}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}
