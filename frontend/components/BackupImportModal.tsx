"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  X,
  AlertTriangle,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
} from "lucide-react";
import type { BackupEnvelope } from "@/lib/backup";
import { useLocale } from "@/lib/i18n-context";
import { formatShortDateTime } from "@/lib/format-date";

interface BackupImportModalProps {
  open: boolean;
  envelope: BackupEnvelope | null;
  /** Visningsnavn per blob-ID (f.eks. { vault: "Passord", cards: "Kort" }) */
  blobLabels: Record<string, string>;
  /**
   * To-trinns import-handler:
   * - Trinn 1: kalleren får backupPwd. Kaster `NeedsCurrentPasswordError`
   *   hvis backup-pwd er forskjellig fra dagens master-pwd og vault er ulåst.
   * - Trinn 2 (etter mismatch): kalleren får backupPwd + currentPwd. Re-krypterer
   *   med currentPwd som target.
   */
  onConfirm: (
    selectedIds: string[],
    backupPwd: string,
    currentPwd?: string,
  ) => Promise<void>;
  onCancel: () => void;
}

/**
 * Modal for selektiv backup-import. To-trinns pwd-flyt:
 *   1. Bruker oppgir backup-pwd
 *   2. Hvis backup-pwd ≠ current vault-pwd, dukker ekstra felt opp:
 *      "Backup ble laget med et annet master-passord. Oppgi dagens master-passord
 *       — backup-data lagres da med dagens passord."
 */
export function BackupImportModal({
  open,
  envelope,
  blobLabels,
  onConfirm,
  onCancel,
}: BackupImportModalProps) {
  const { t, locale } = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [backupPwd, setBackupPwd] = useState("");
  const [currentPwd, setCurrentPwd] = useState("");
  const [needsCurrentPwd, setNeedsCurrentPwd] = useState(false);
  const [showBackupPwd, setShowBackupPwd] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backupPwdRef = useRef<HTMLInputElement>(null);
  const currentPwdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && envelope) {
      setSelected(new Set(envelope.includedBlobs));
      setBackupPwd("");
      setCurrentPwd("");
      setNeedsCurrentPwd(false);
      setShowBackupPwd(false);
      setShowCurrentPwd(false);
      setBusy(false);
      setError(null);
      const t = setTimeout(() => backupPwdRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, envelope]);

  // Fokuser current-pwd-feltet når det først dukker opp
  useEffect(() => {
    if (needsCurrentPwd) {
      const t = setTimeout(() => currentPwdRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [needsCurrentPwd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  const canConfirm = useMemo(() => {
    if (selected.size === 0 || busy) return false;
    if (backupPwd.length === 0) return false;
    if (needsCurrentPwd && currentPwd.length === 0) return false;
    return true;
  }, [selected, backupPwd, currentPwd, needsCurrentPwd, busy]);

  if (!open || !envelope) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(
        Array.from(selected),
        backupPwd,
        needsCurrentPwd ? currentPwd : undefined,
      );
    } catch (err) {
      // Spesialtilfelle: kalleren signaliserer at backup-pwd ≠ current pwd
      if (err instanceof Error && err.name === "NeedsCurrentPasswordError") {
        setNeedsCurrentPwd(true);
        setError(null);
        setBusy(false);
        return;
      }
      setError(err instanceof Error ? err.message : t("backup_import.error_default"));
      setBusy(false);
    }
  }

  const exportedDate = (() => {
    try {
      return formatShortDateTime(envelope.exportedAt, locale);
    } catch {
      return envelope.exportedAt;
    }
  })();

  return (
    <div
      data-testid="backup-import-modal"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="import-title"
        className="w-full max-w-md backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        <div className="flex items-start gap-4 p-5">
          <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/15 border border-amber-400/30">
            <Upload className="h-5 w-5 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="import-title" className="text-base font-semibold tracking-tight">
              {t("backup_import.title")}
            </h3>
            <p className="mt-1 text-xs text-white/50">
              {t("backup_import.exported_prefix")} {exportedDate} · {envelope.appVersion}
            </p>
            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              {t("backup_import.subtitle_1")}{" "}
              <strong className="text-white">{t("backup_import.subtitle_2_strong")}</strong>{" "}
              {t("backup_import.subtitle_3")}
            </p>

            <div className="mt-4 space-y-2">
              {envelope.includedBlobs.map((id) => {
                const isSelected = selected.has(id);
                const label = blobLabels[id] ?? id;
                return (
                  <label
                    key={id}
                    data-testid={`backup-import-source-${id}`}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? "bg-amber-500/15 border-amber-400/40"
                        : "bg-white/5 border-white/15 hover:bg-white/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`backup-import-checkbox-${id}`}
                      checked={isSelected}
                      onChange={() => toggle(id)}
                      disabled={busy || needsCurrentPwd}
                      className="h-4 w-4 rounded accent-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-white/50">
                        {t("backup_import.overwrite_prefix")} {label.toLowerCase()} {t("backup_import.overwrite_suffix")}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-4">
              <label className="block text-xs text-white/60 mb-1.5">
                <Lock className="inline h-3 w-3 mr-1 -mt-0.5" />
                {t("backup_import.backup_pwd_label")}
              </label>
              <div className="relative">
                <input
                  ref={backupPwdRef}
                  data-testid="backup-import-pwd"
                  type={showBackupPwd ? "text" : "password"}
                  value={backupPwd}
                  onChange={(e) => setBackupPwd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canConfirm && !needsCurrentPwd) {
                      handleConfirm();
                    } else if (e.key === "Enter" && needsCurrentPwd) {
                      currentPwdRef.current?.focus();
                    }
                  }}
                  disabled={busy || needsCurrentPwd}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-white/5 border border-white/15 rounded-md pl-3 pr-10 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/40 font-mono disabled:opacity-50"
                  placeholder={t("backup_import.backup_pwd_placeholder")}
                />
                <button
                  type="button"
                  data-testid="backup-import-pwd-toggle"
                  onClick={() => setShowBackupPwd((v) => !v)}
                  disabled={busy || needsCurrentPwd}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-white/50 hover:text-white/80 transition disabled:opacity-30"
                  aria-label={showBackupPwd ? t("common.hide_password") : t("common.show_password")}
                  tabIndex={-1}
                >
                  {showBackupPwd ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {needsCurrentPwd && (
              <div
                data-testid="backup-import-mismatch-banner"
                className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-400/40"
              >
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-300" />
                  <div className="text-sm text-amber-100 leading-relaxed">
                    {t("backup_import.mismatch_warning_1")}{" "}
                    <strong>{t("backup_import.mismatch_warning_2_strong")}</strong>{" "}
                    {t("backup_import.mismatch_warning_3")}
                  </div>
                </div>
                <label className="block text-xs text-white/70 mb-1.5">
                  <KeyRound className="inline h-3 w-3 mr-1 -mt-0.5" />
                  {t("backup_import.current_pwd_label")}
                </label>
                <div className="relative">
                  <input
                    ref={currentPwdRef}
                    data-testid="backup-import-current-pwd"
                    type={showCurrentPwd ? "text" : "password"}
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canConfirm) handleConfirm();
                    }}
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-white/10 border border-amber-400/40 rounded-md pl-3 pr-10 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/40 font-mono disabled:opacity-50"
                    placeholder={t("backup_import.current_pwd_placeholder")}
                  />
                  <button
                    type="button"
                    data-testid="backup-import-current-pwd-toggle"
                    onClick={() => setShowCurrentPwd((v) => !v)}
                    disabled={busy}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-white/50 hover:text-white/80 transition disabled:opacity-30"
                    aria-label={showCurrentPwd ? t("common.hide_password") : t("common.show_password")}
                    tabIndex={-1}
                  >
                    {showCurrentPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div
                data-testid="backup-import-error"
                className="mt-3 flex items-start gap-2 p-2.5 rounded-md bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <button
            data-testid="backup-import-x"
            onClick={onCancel}
            disabled={busy}
            className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10 bg-white/[0.02] rounded-b-2xl">
          <button
            ref={cancelRef}
            data-testid="backup-import-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            data-testid="backup-import-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium shadow transition focus:outline-none focus:ring-2 bg-amber-500 hover:bg-amber-600 focus:ring-amber-300/50 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("backup_import.confirm_loading")}
              </>
            ) : needsCurrentPwd ? (
              <>{t("backup_import.confirm_button_with_pwd")}</>
            ) : (
              <>{t("backup_import.confirm_button_prefix")} ({selected.size})</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
