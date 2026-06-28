"use client";

import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Search, Star } from "lucide-react";
import type { VaultCard, VaultEntry, VaultId } from "@/lib/types";
import type { CategoryConfig } from "@/lib/config";
import { useLocale } from "@/lib/i18n-context";

interface SearchPaletteProps {
  open: boolean;
  entries: VaultEntry[];
  cards: VaultCard[];
  /** v4.1: ID-er fra ID-blob. Tom array hvis ID-fanen aldri har vært aktivert
   *  (lazy-load D-002). Søkbar uansett — vi venter ikke på activate ved Cmd+K. */
  ids: VaultId[];
  categories: CategoryConfig[];
  onClose: () => void;
  onSelect: (entry: VaultEntry) => void;
  onSelectCard: (card: VaultCard) => void;
  /** v4.1: Klikk på ID-resultat åpner IdModal i view-mode. */
  onSelectId: (id: VaultId) => void;
}

const CARD_TYPE_LABEL_KEYS: Record<string, string> = {
  credit: "card_type.credit",
  debit: "card_type.debit",
  virtual: "card_type.virtual",
  reward: "card_type.reward",
};

const CARD_TYPE_COLORS: Record<string, string> = {
  credit: "#a78bfa",
  debit: "#60a5fa",
  virtual: "#22d3ee",
  reward: "#fbbf24",
};

/** ID-type metadata for søke-resultater. Speil av IdsDashboard. */
const ID_KIND_META: Record<
  VaultId["kind"],
  { labelKey: string; emoji: string; color: string }
> = {
  pass: { labelKey: "id_kind.pass_label", emoji: "🛂", color: "#fb923c" },
  driver: { labelKey: "id_kind.driver_label", emoji: "🚗", color: "#fbbf24" },
  "id-card": { labelKey: "id_kind.id_card_label", emoji: "🆔", color: "#60a5fa" },
  health: { labelKey: "id_kind.health_label", emoji: "🏥", color: "#34d399" },
};

/** Bygg søke-tekst for en ID — full integrasjon (Mike-valg A:full).
 *  Matcher tittel, type-spesifikke nøkkelfelter, notater, og felles synonymer. */
function buildIdSearchText(id: VaultId, t: (k: string) => string): string {
  const parts: string[] = [id.title, id.notes || "", id.kind, t(ID_KIND_META[id.kind].labelKey), "id"];
  switch (id.kind) {
    case "pass":
      parts.push(
        id.passportNumber,
        id.nation,
        id.issuedBy || "",
        "pass",
        "passport",
      );
      break;
    case "driver":
      parts.push(
        id.licenseNumber,
        id.country,
        ...id.classes,
        "førerkort",
        "kjørekort",
        "sertifikat",
      );
      break;
    case "id-card":
      parts.push(
        id.number,
        id.type,
        id.issuer,
        "id-kort",
        "medlemskort",
      );
      break;
    case "health":
      parts.push(
        id.policyNumber,
        id.type,
        id.company,
        id.contactPhone || "",
        id.contactEmail || "",
        "helsekort",
        "forsikring",
      );
      break;
  }
  return parts.join(" ").toLowerCase();
}

/** Formater utløp som "Utløp MM/YY" eller null hvis tom/utløpet er valgfri. */
function formatExpiry(iso: string | null | undefined, t: (k: string) => string): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  if (!y || !m) return null;
  return `${t("search.expiry_prefix")} ${m}/${y.slice(-2)}`;
}

/** Hent utløpsdato pr ID-type. */
function expiryOf(id: VaultId): string | null {
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

/** Hovedidentifier (passnr / førerkort-nr / kortnr / polisenr) — vises i resultat-row. */
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

export function SearchPalette({
  open,
  entries,
  cards,
  ids,
  categories,
  onClose,
  onSelect,
  onSelectCard,
  onSelectId,
}: SearchPaletteProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const getCategory = (key?: string) =>
    categories.find((c) => c.key === key);

  const totalCount = entries.length + cards.length + ids.length;

  return (
    <div
      data-testid="search-palette"
      className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 pt-[15vh] animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Command
        label={t("search.aria_label")}
        shouldFilter={true}
        // Streng substring-matching. cmdk's default er fuzzy "command-score" som
        // matcher "amex" mot VIASAT pga m/e/x spredt i mike@meetmax.no — for
        // løst for et passord-arkiv. Multi-word søk: alle ord må finnes (case-
        // insensitive). Mike-feedback 2026-02.
        filter={(value, search) => {
          const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
          if (terms.length === 0) return 1;
          const lowered = value.toLowerCase();
          return terms.every((t) => lowered.includes(t)) ? 1 : 0;
        }}
        className="w-full max-w-xl bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden animate-slide-up"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search className="h-4 w-4 text-white/50 flex-shrink-0" />
          <Command.Input
            data-testid="search-input"
            value={query}
            onValueChange={setQuery}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
            autoFocus
          />
          <kbd className="text-[10px] text-white/40 bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <Command.List
          data-testid="search-list"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          <Command.Empty className="py-10 text-center text-sm text-white/50">
            {totalCount === 0 ? t("search.empty_vault") : t("search.no_results")}
          </Command.Empty>

          {entries.length > 0 && (
            <Command.Group
              heading={t("search.group_passwords")}
              className="text-[10px] uppercase tracking-wide text-white/40 px-2 py-1"
            >
              {entries.map((entry) => {
                const cat = getCategory(entry.category);
                const searchText = [
                  entry.title,
                  entry.url || "",
                  entry.username || "",
                  cat?.label || "",
                  "passord",
                ]
                  .join(" ")
                  .toLowerCase();
                return (
                  <Command.Item
                    key={`pwd-${entry.id}`}
                    value={searchText}
                    data-testid={`search-result-${entry.id}`}
                    onSelect={() => {
                      onSelect(entry);
                      onClose();
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-left aria-selected:bg-white/10 hover:bg-white/5 transition"
                  >
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base"
                      style={{
                        backgroundColor: cat
                          ? `${cat.color}22`
                          : "rgba(255,255,255,0.05)",
                        border: `1px solid ${
                          cat ? `${cat.color}55` : "rgba(255,255,255,0.1)"
                        }`,
                      }}
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
                      {(entry.username || entry.url) && (
                        <div className="text-[11px] text-white/50 truncate mt-0.5">
                          {entry.username && (
                            <span className="font-mono">{entry.username}</span>
                          )}
                          {entry.username && entry.url && (
                            <span className="mx-1.5 text-white/30">·</span>
                          )}
                          {entry.url && <span>{entry.url}</span>}
                        </div>
                      )}
                    </div>
                    {entry.url && (
                      <ExternalLink className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {cards.length > 0 && (
            <Command.Group
              heading={t("search.group_cards")}
              className="text-[10px] uppercase tracking-wide text-white/40 px-2 py-1"
            >
              {cards.map((card) => {
                const color = CARD_TYPE_COLORS[card.cardType] || "#a78bfa";
                const last4 = card.cardNumber.replace(/\s/g, "").slice(-4);
                const cardTypeLabel = t(CARD_TYPE_LABEL_KEYS[card.cardType] || "");
                const searchText = [
                  card.title,
                  cardTypeLabel,
                  card.issuer || "",
                  card.holderName,
                  last4,
                  "kort",
                ]
                  .join(" ")
                  .toLowerCase();
                return (
                  <Command.Item
                    key={`card-${card.id}`}
                    value={searchText}
                    data-testid={`search-result-card-${card.id}`}
                    onSelect={() => {
                      onSelectCard(card);
                      onClose();
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-left aria-selected:bg-white/10 hover:bg-white/5 transition"
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
                      <div className="text-[11px] text-white/50 truncate mt-0.5 font-mono">
                        <span style={{ color }}>
                          {cardTypeLabel}
                        </span>
                        <span className="mx-1.5 text-white/30">·</span>
                        ••••{last4}
                        {card.issuer && (
                          <>
                            <span className="mx-1.5 text-white/30">·</span>
                            <span className="font-sans">{card.issuer}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {ids.length > 0 && (
            <Command.Group
              heading={t("search.group_ids")}
              className="text-[10px] uppercase tracking-wide text-white/40 px-2 py-1"
            >
              {ids.map((id) => {
                const meta = ID_KIND_META[id.kind];
                const ident = identifierOf(id);
                const expiry = formatExpiry(expiryOf(id), t);
                return (
                  <Command.Item
                    key={`id-${id.id}`}
                    value={buildIdSearchText(id, t)}
                    data-testid={`search-result-id-${id.id}`}
                    onSelect={() => {
                      onSelectId(id);
                      onClose();
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer text-left aria-selected:bg-white/10 hover:bg-white/5 transition"
                  >
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-base"
                      style={{
                        backgroundColor: `${meta.color}22`,
                        border: `1px solid ${meta.color}55`,
                      }}
                      aria-hidden
                    >
                      {meta.emoji}
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
                      </div>
                      <div className="text-[11px] text-white/50 truncate mt-0.5 font-mono">
                        <span style={{ color: meta.color }}>{t(meta.labelKey)}</span>
                        <span className="mx-1.5 text-white/30">·</span>
                        <span className="truncate">{ident}</span>
                        {expiry && (
                          <>
                            <span className="mx-1.5 text-white/30">·</span>
                            <span>{expiry}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}
        </Command.List>

        <div className="flex items-center justify-between px-4 py-2 border-t border-white/10 bg-white/[0.03] text-[10px] text-white/40">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="bg-white/10 border border-white/10 rounded px-1">
                ↑↓
              </kbd>{" "}
              {t("search.kbd_navigate")}
            </span>
            <span>
              <kbd className="bg-white/10 border border-white/10 rounded px-1">
                ↵
              </kbd>{" "}
              {t("search.kbd_open")}
            </span>
          </div>
          <span className="font-mono">
            {entries.length} {t("search.footer_passwords_suffix")} · {cards.length} {t("search.footer_cards_suffix")} · {ids.length} {t("search.footer_ids_suffix")}
          </span>
        </div>
      </Command>
    </div>
  );
}
