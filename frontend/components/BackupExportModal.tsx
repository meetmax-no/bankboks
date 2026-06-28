"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, X, AlertTriangle } from "lucide-react";
import type { BackupBlobSource } from "@/lib/backup-registry";
import { useLocale } from "@/lib/i18n-context";

interface BackupExportModalProps {
  open: boolean;
  sources: BackupBlobSource[];
  /** Kalles med liste av valgte blob-IDer. Kalleren henter blobs + bygger envelope. */
  onConfirm: (selectedIds: string[]) => Promise<void> | void;
  onCancel: () => void;
}

/**
 * Modal for selektiv backup-eksport. Bruker velger hvilke blobs som skal med.
 * Default: alle valgt. Knapp deaktivert hvis ingenting er valgt.
 */
export function BackupExportModal({
  open,
  sources,
  onConfirm,
  onCancel,
}: BackupExportModalProps) {
  const { t } = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset valg hver gang modalen åpnes — default: alle valgt
  useEffect(() => {
    if (open) {
      setSelected(new Set(sources.map((s) => s.id)));
      setBusy(false);
      setError(null);
      const t = setTimeout(() => cancelRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, sources]);

  // Esc lukker
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  const canConfirm = useMemo(() => selected.size > 0 && !busy, [selected, busy]);

  if (!open) return null;

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
      await onConfirm(Array.from(selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("backup_export.error_default"));
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="backup-export-modal"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="export-title"
        className="w-full max-w-md backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        <div className="flex items-start gap-4 p-5">
          <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/15 border border-blue-400/30">
            <Download className="h-5 w-5 text-blue-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="export-title" className="text-base font-semibold tracking-tight">
              {t("backup_export.title")}
            </h3>
            <p className="mt-2 text-sm text-white/70 leading-relaxed">
              {t("backup_export.subtitle")}
            </p>

            <div className="mt-4 space-y-2">
              {sources.map((src) => {
                const isSelected = selected.has(src.id);
                return (
                  <label
                    key={src.id}
                    data-testid={`backup-export-source-${src.id}`}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      isSelected
                        ? "bg-blue-500/15 border-blue-400/40"
                        : "bg-white/5 border-white/15 hover:bg-white/10"
                    }`}
                  >
                    <input
                      type="checkbox"
                      data-testid={`backup-export-checkbox-${src.id}`}
                      checked={isSelected}
                      onChange={() => toggle(src.id)}
                      disabled={busy}
                      className="h-4 w-4 rounded accent-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{src.label}</div>
                      <div className="text-xs text-white/50">
                        {src.itemCount === null
                          ? t("backup_export.count_unknown")
                          : src.itemCount === 0
                          ? t("backup_export.count_zero")
                          : `${src.itemCount} ${
                              src.itemCount === 1 ? t("vault.entries_count_singular") : t("vault.entries_count_plural")
                            }`}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {error && (
              <div
                data-testid="backup-export-error"
                className="mt-3 flex items-start gap-2 p-2.5 rounded-md bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200"
              >
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <button
            data-testid="backup-export-x"
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
            data-testid="backup-export-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            data-testid="backup-export-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium shadow transition focus:outline-none focus:ring-2 bg-blue-500 hover:bg-blue-600 focus:ring-blue-300/50 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("backup_export.confirm_loading")}
              </>
            ) : (
              <>{t("backup_export.confirm_button_prefix")} ({selected.size})</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
