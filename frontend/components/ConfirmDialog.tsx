"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

export type ConfirmVariant = "default" | "destructive";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** Vercel-style "type to confirm" — case-sensitive */
  requireConfirmText?: string;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
  busy = false,
  requireConfirmText,
}: ConfirmDialogProps) {
  const { t } = useLocale();
  const effectiveCancelLabel = cancelLabel ?? t("common.cancel");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (!open) setTypedText("");
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => cancelRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const isDestructive = variant === "destructive";
  const textConfirmRequired = Boolean(requireConfirmText);
  const textMatches = !textConfirmRequired || typedText === requireConfirmText;
  const confirmDisabled = busy || !textMatches;

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="w-full max-w-md backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        <div className="flex items-start gap-4 p-5">
          <div
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              isDestructive
                ? "bg-rose-500/15 border border-rose-400/30"
                : "bg-blue-500/15 border border-blue-400/30"
            }`}
          >
            <AlertTriangle
              className={`h-5 w-5 ${
                isDestructive ? "text-rose-300" : "text-blue-300"
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-title" className="text-base font-semibold tracking-tight">
              {title}
            </h3>
            <div id="confirm-desc" className="mt-2 text-sm text-white/70 leading-relaxed">
              {description}
            </div>
            {textConfirmRequired && (
              <div className="mt-4">
                <label className="block text-xs text-white/60 mb-1.5">
                  Skriv{" "}
                  <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-rose-200 font-semibold">
                    {requireConfirmText}
                  </code>{" "}
                  for å bekrefte:
                </label>
                <input
                  data-testid="confirm-dialog-text-input"
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-white/5 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-400/40 font-mono"
                  placeholder={requireConfirmText}
                />
              </div>
            )}
          </div>
          <button
            data-testid="confirm-dialog-x"
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
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50"
          >
            {effectiveCancelLabel}
          </button>
          <button
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`px-4 py-2 rounded-lg text-sm font-medium shadow transition focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isDestructive
                ? "bg-rose-500 hover:bg-rose-600 focus:ring-rose-300/50 text-white"
                : "bg-blue-500 hover:bg-blue-600 focus:ring-blue-300/50 text-white"
            }`}
          >
            {busy ? t("common.wait_loading") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
