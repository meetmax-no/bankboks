"use client";

import { useState } from "react";
import { BadgeCheck, CreditCard, KeyRound } from "lucide-react";
import { VaultDashboard } from "./VaultDashboard";
import { CardsDashboard } from "./CardsDashboard";
import { IdsDashboard } from "./IdsDashboard";
import { useLocale } from "@/lib/i18n-context";
import type { VaultEntry } from "@/lib/types";
import type { AppConfig } from "@/lib/config";
import type { BiometricInfo } from "@/hooks/useVault";
import type { CardsStatus } from "@/hooks/useCards";
import type { IdsStatus } from "@/hooks/useIds";
import type { VaultCard, VaultId } from "@/lib/types";

type View = "passwords" | "cards" | "ids";

interface DashboardShellProps {
  // Vault-side props
  entries: VaultEntry[];
  config: AppConfig;
  biometric: BiometricInfo;
  onSaveEntries: (next: VaultEntry[]) => Promise<void>;
  onRemoveBiometric: () => void;
  // Cards-side props (cards låses automatisk opp ved master-pwd/Touch ID,
  // men selve Upstash-fetchen utsettes til brukeren faktisk åpner Kort-fanen — D-002 lazy-load)
  cardsStatus: CardsStatus;
  cardsError: string | null;
  cards: VaultCard[];
  /** Trigger lazy-fetch av cards-blob første gang Kort-fanen åpnes. */
  onActivateCards: () => Promise<void>;
  onSaveCards: (next: VaultCard[]) => Promise<void>;
  // IDs-side props (v4.1, samme lazy-pattern som cards)
  /** Hvis false: 🆔-fanen vises ikke (tenant-toggle features.ids.showInApp). */
  idsShowInApp?: boolean;
  idsStatus: IdsStatus;
  idsError: string | null;
  ids: VaultId[];
  /** Trigger lazy-fetch av ID-blob første gang ID-fanen åpnes. */
  onActivateIds: () => Promise<void>;
  onSaveIds: (next: VaultId[]) => Promise<void>;
}

/**
 * Wrapper som holder Passord/Kort/ID-toggle + rendrer aktiv view.
 * Toggle-stilen speiler Liste/Gruppert-toggle fra v2.9.5 (samme pill-pattern).
 *
 * v4.1: ID-fanen plasseres til høyre for Kort per Mike-beslutning 2026-02
 * (Spec §6.1). Bruker IDS_THEME (orange) farge-aksent.
 */
export function DashboardShell({
  entries,
  config,
  biometric,
  onSaveEntries,
  onRemoveBiometric,
  cardsStatus,
  cardsError,
  cards,
  onActivateCards,
  onSaveCards,
  idsShowInApp = true,
  idsStatus,
  idsError,
  ids,
  onActivateIds,
  onSaveIds,
}: DashboardShellProps) {
  const { t } = useLocale();
  const [view, setView] = useState<View>("passwords");

  const switchToCards = () => {
    setView("cards");
    // Trigger lazy-fetch hvis ikke allerede aktivert
    if (cardsStatus === "idle") {
      onActivateCards().catch(() => {
        /* feilen settes i cards.error / cards.status */
      });
    }
  };

  const switchToIds = () => {
    setView("ids");
    if (idsStatus === "idle") {
      onActivateIds().catch(() => {
        /* feilen settes i ids.error / ids.status */
      });
    }
  };

  return (
    <div className="w-full flex flex-col items-center gap-3">
      {/* View-toggle: Passord ⇄ Kort ⇄ ID */}
      <div
        data-testid="dashboard-view-toggle"
        role="group"
        aria-label={t("dashboard.toggle_aria")}
        className="flex items-center backdrop-blur-xl border border-white/15 rounded-full p-1 shadow-lg"
      >
        <button
          data-testid="dashboard-view-passwords-btn"
          onClick={() => setView("passwords")}
          aria-pressed={view === "passwords"}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-semibold transition ${
            view === "passwords"
              ? "bg-blue-500 text-white shadow"
              : "text-white/60 hover:text-white/90"
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" />
          <span>{t("dashboard.tab_passwords")}</span>
          {entries.length > 0 && (
            <span
              className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                view === "passwords"
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-white/55"
              }`}
            >
              {entries.length}
            </span>
          )}
        </button>
        <button
          data-testid="dashboard-view-cards-btn"
          onClick={switchToCards}
          aria-pressed={view === "cards"}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-semibold transition ${
            view === "cards"
              ? "bg-violet-500 text-white shadow"
              : "text-white/60 hover:text-white/90"
          }`}
        >
          <CreditCard className="h-3.5 w-3.5" />
          <span>{t("dashboard.tab_cards")}</span>
          {cardsStatus === "ready" && cards.length > 0 && (
            <span
              className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                view === "cards"
                  ? "bg-white/20 text-white"
                  : "bg-white/10 text-white/55"
              }`}
            >
              {cards.length}
            </span>
          )}
        </button>
        {idsShowInApp && (
          <button
            data-testid="dashboard-view-ids-btn"
            onClick={switchToIds}
            aria-pressed={view === "ids"}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-semibold transition ${
              view === "ids"
                ? "bg-orange-500 text-white shadow"
                : "text-white/60 hover:text-white/90"
            }`}
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            <span>{t("dashboard.tab_ids")}</span>
            {idsStatus === "ready" && ids.length > 0 && (
              <span
                className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  view === "ids"
                    ? "bg-white/20 text-white"
                    : "bg-white/10 text-white/55"
                }`}
              >
                {ids.length}
              </span>
            )}
          </button>
        )}
      </div>

      {view === "passwords" && (
        <VaultDashboard
          entries={entries}
          config={config}
          biometric={biometric}
          onSaveEntries={onSaveEntries}
          onRemoveBiometric={onRemoveBiometric}
        />
      )}
      {view === "cards" && (
        <CardsDashboard
          status={cardsStatus}
          error={cardsError}
          cards={cards}
          config={config}
          onSaveCards={onSaveCards}
        />
      )}
      {view === "ids" && (
        <IdsDashboard
          status={idsStatus}
          error={idsError}
          ids={ids}
          config={config}
          onSaveIds={onSaveIds}
        />
      )}
    </div>
  );
}
