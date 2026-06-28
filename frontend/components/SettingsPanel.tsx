"use client";

// Iter 19.9.2 — SettingsPanel redesign.
// 4 faner i én modal:
//   1. Generelle      — Språk + Konfigurasjon (accordion) + Klient (accordion)
//   2. Look & Feel    — Tema + Bakgrunns-modus + Overlay slider + 9 tiles
//   3. Sikkerhet      — Passord-lab, Bytt master, Fjern Touch ID, Hendelses-logg
//   4. Backup & Admin — Stripe Portal, Backup eksport/import, Farlig sone
//
// Visuell signatur: Ko|Do amber #f5a623 via --kodo-accent CSS-variabel
// (settes per .theme-<id> i globals.css). Tab-indicator under aktiv fane
// + accent-soft bg på aktiv fane.

import { Settings, X } from "lucide-react";
import type { AppConfig } from "@/lib/config";
import type { VaultEvent } from "@/lib/events-sync";
import type { BgMode } from "@/lib/bg-preference";
import { useLocale } from "@/lib/i18n-context";
import { GeneralTab } from "@/components/settings/GeneralTab";
import { LookFeelTab } from "@/components/settings/LookFeelTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { BackupAdminTab } from "@/components/settings/BackupAdminTab";
import { useEffect, useState } from "react";

type TabKey = "general" | "look-feel" | "security" | "backup-admin";

interface SettingsPanelProps {
  open: boolean;
  config: AppConfig;
  biometricActive: boolean;
  currentBackground?: string;
  bgMode: BgMode;
  /** Iter 19.9.2 — user overlay override (0..0.8). Hvis udefinert: fall
   *  tilbake til config.bgImageOverlay (~0.10). */
  bgOverlay: number;
  onBgModeChange: (mode: BgMode) => void;
  onBgPickImage: (url: string) => void;
  /** Iter 19.9.2 — setter user overlay i bg-preference. */
  onBgOverlayChange: (overlay: number) => void;
  loginHistory: VaultEvent[];
  loginHistoryLoading: boolean;
  onOpenEventLog: () => void;
  onClose: () => void;
  onChangeMaster: () => void;
  onRemoveBiometric: () => void;
  onExportBackup: () => void | Promise<void>;
  onImportFile: (file: File) => void;
  onOpenPasswordLab: () => void;
  onExportPasswordsCsv: () => void;
  onDeleteVaultAndAccount: () => void;
}

export function SettingsPanel({
  open,
  config,
  biometricActive,
  currentBackground,
  bgMode,
  bgOverlay,
  onBgModeChange,
  onBgPickImage,
  onBgOverlayChange,
  loginHistory,
  loginHistoryLoading,
  onOpenEventLog,
  onClose,
  onChangeMaster,
  onRemoveBiometric,
  onExportBackup,
  onImportFile,
  onOpenPasswordLab,
  onExportPasswordsCsv,
  onDeleteVaultAndAccount,
}: SettingsPanelProps) {
  const { t } = useLocale();
  const [tab, setTab] = useState<TabKey>("general");

  // Reset til "general" hver gang modalen åpnes — slik at brukeren ikke
  // havner på siste fane fra forrige session (uventet i UX-testing).
  useEffect(() => {
    if (open) setTab("general");
  }, [open]);

  // Iter 19.9.2 (Mike 2026-06-24): ESC lukker modalen — konsistent med
  // alle andre modaler i appen (PasswordLab, ConfirmDialog, EntryModal,
  // PackageHubModal m.fl.). Lytter kun mens modalen er åpen for å unngå
  // global keybinding-konflikt.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const tabs: { key: TabKey; label: string; testId: string }[] = [
    {
      key: "general",
      label: t("settings.tab_general"),
      testId: "settings-tab-general",
    },
    {
      key: "look-feel",
      label: t("settings.tab_look_feel"),
      testId: "settings-tab-look-feel",
    },
    {
      key: "security",
      label: t("settings.tab_security"),
      testId: "settings-tab-security",
    },
    {
      key: "backup-admin",
      label: t("settings.tab_backup_admin"),
      testId: "settings-tab-backup-admin",
    },
  ];

  return (
    <div
      data-testid="settings-panel-overlay"
      className="fixed inset-0 z-[58] bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="settings-panel"
        className="w-full max-w-3xl my-8 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-white/10 sticky top-0 bg-slate-900/95 backdrop-blur-xl rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
              <Settings className="h-4 w-4 text-white/80" />
            </div>
            <h3 className="text-lg font-semibold tracking-tight truncate">
              {t("settings.title")}
            </h3>
          </div>
          <button
            data-testid="settings-close-btn"
            onClick={onClose}
            className="p-1.5 rounded-md text-white/55 hover:text-white hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)]"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab nav */}
        <div
          className="px-5 pt-3 pb-0 border-b border-white/10 sticky bg-slate-900/95 backdrop-blur-xl z-10"
          style={{ top: "60px" }}
        >
          <div
            role="tablist"
            aria-label={t("settings.title")}
            className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0"
          >
            {tabs.map((tDef) => {
              const isActive = tab === tDef.key;
              return (
                <button
                  key={tDef.key}
                  role="tab"
                  aria-selected={isActive}
                  data-testid={tDef.testId}
                  onClick={() => setTab(tDef.key)}
                  className={`relative px-3 py-2 rounded-md text-[13px] font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)] whitespace-nowrap ${
                    isActive
                      ? "text-[var(--kodo-accent)] bg-[var(--kodo-accent-soft)]"
                      : "text-white/45 hover:text-white/85 hover:bg-white/[0.04]"
                  }`}
                >
                  {tDef.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute left-3 right-3 -bottom-px h-[2px] rounded-t bg-[var(--kodo-accent)]"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="p-5">
          {tab === "general" && <GeneralTab config={config} />}
          {tab === "look-feel" && (
            <LookFeelTab
              config={config}
              currentBackground={currentBackground}
              bgMode={bgMode}
              overlay={bgOverlay}
              onBgModeChange={onBgModeChange}
              onBgPickImage={onBgPickImage}
              onOverlayChange={onBgOverlayChange}
            />
          )}
          {tab === "security" && (
            <SecurityTab
              biometricActive={biometricActive}
              loginHistory={loginHistory}
              loginHistoryLoading={loginHistoryLoading}
              onOpenPasswordLab={onOpenPasswordLab}
              onChangeMaster={onChangeMaster}
              onRemoveBiometric={onRemoveBiometric}
              onOpenEventLog={onOpenEventLog}
            />
          )}
          {tab === "backup-admin" && (
            <BackupAdminTab
              open={open}
              onExportBackup={onExportBackup}
              onImportFile={onImportFile}
              onExportPasswordsCsv={onExportPasswordsCsv}
              onDeleteVaultAndAccount={onDeleteVaultAndAccount}
            />
          )}
        </div>

        {/* Footer (alle faner) */}
        <div
          data-testid="settings-footer"
          className="px-5 py-3 border-t border-white/10 bg-white/[0.03] text-[10px] text-white/40 rounded-b-2xl text-center font-mono tracking-wide"
        >
          {t("settings.footer_security")}
        </div>
      </div>
    </div>
  );
}
