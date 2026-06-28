"use client";

// Iter 19.9.2 — Fane 3: Sikkerhet
//
// Innhold (alle ActionRow-er kaller callbacks fra parent SettingsPanel):
//  - Passord-lab (åpner eksisterende PasswordLab-modal)
//  - Bytt master-passord (re-krypterer alle blobs)
//  - Fjern Touch ID / Face ID (kun synlig hvis biometric aktiv)
//  - Hendelses-logg (med count fra parent)

import {
  Clock,
  Fingerprint,
  FlaskConical,
  KeyRound,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import type { VaultEvent } from "@/lib/events-sync";
import { useLocale } from "@/lib/i18n-context";

interface SecurityTabProps {
  biometricActive: boolean;
  loginHistory: VaultEvent[];
  loginHistoryLoading: boolean;
  onOpenPasswordLab: () => void;
  onChangeMaster: () => void;
  onRemoveBiometric: () => void;
  onOpenEventLog: () => void;
}

export function SecurityTab({
  biometricActive,
  loginHistory,
  loginHistoryLoading,
  onOpenPasswordLab,
  onChangeMaster,
  onRemoveBiometric,
  onOpenEventLog,
}: SecurityTabProps) {
  const { t } = useLocale();

  const eventLogDesc = loginHistoryLoading
    ? t("settings.action_event_log_loading")
    : loginHistory.length > 0
      ? `${loginHistory.length} ${t("settings.action_event_log_desc_count_suffix")}`
      : t("settings.action_event_log_desc_empty");

  return (
    <div className="space-y-2">
      <ActionRow
        testId="settings-open-password-lab"
        icon={FlaskConical}
        iconColor="text-violet-200"
        iconBg="bg-violet-400/15 border-violet-300/30"
        title={t("settings.action_lab_title")}
        desc={t("settings.action_lab_desc")}
        onClick={onOpenPasswordLab}
      />
      <ActionRow
        testId="settings-change-master"
        icon={KeyRound}
        iconColor="text-amber-200"
        iconBg="bg-amber-400/15 border-amber-300/30"
        title={t("settings.action_change_master_title")}
        desc={t("settings.action_change_master_desc")}
        onClick={onChangeMaster}
      />
      {biometricActive ? (
        <ActionRow
          testId="settings-remove-biometric"
          icon={Fingerprint}
          iconColor="text-emerald-200"
          iconBg="bg-emerald-400/15 border-emerald-300/30"
          title={t("settings.action_remove_biometric_title")}
          desc={t("settings.action_remove_biometric_desc")}
          onClick={onRemoveBiometric}
        />
      ) : (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 text-white/50 text-[11px]">
          <ShieldAlert className="h-4 w-4 flex-shrink-0 text-white/40" />
          <span>{t("settings.biometric_not_active_help")}</span>
        </div>
      )}
      <ActionRow
        testId="settings-open-event-log"
        icon={Clock}
        iconColor="text-sky-200"
        iconBg="bg-sky-400/15 border-sky-300/30"
        title={t("settings.action_event_log_title")}
        desc={eventLogDesc}
        onClick={onOpenEventLog}
      />
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────

function ActionRow({
  testId,
  icon: Icon,
  iconColor,
  iconBg,
  title,
  desc,
  onClick,
}: {
  testId: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)]"
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${iconBg}`}
      >
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-[11px] text-white/55 mt-0.5">{desc}</div>
      </div>
    </button>
  );
}
