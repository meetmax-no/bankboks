"use client";

/**
 * Ko | Do · Vault — ExportPasswordsDialog
 *
 * Iter 19.9.6 (#11): CSV-eksport av passord-blob til Bitwarden-format.
 *
 * To-stegs flyt (samme mønster som DeleteAccountDialog):
 *   Steg 1: advarsel + ansvars-checkbox → [Avbryt] [Fortsett →]
 *   Steg 2: bekreft med master-passord → [Avbryt] [Last ned CSV]
 *
 * Master-passordet verifiseres KLIENTSIDE via `verifyMasterPassword`.
 * Først ved vellykket verifisering kalles `onConfirmedExport()` som
 * får ansvar for å bygge CSV og trigge nedlasting.
 *
 * Bevisste designvalg:
 *   - Eksporter-knappen i steg 1 er disabled til checkbox er avkrysset.
 *   - Checkbox + master-pwd resettes hver gang dialogen åpnes (også
 *     hvis brukeren lukker og åpner på nytt — per Mike-spec).
 *   - Avbryt-knappen er fokusert ved åpning (defensiv default).
 *   - Esc lukker dialogen unntatt mens busy=true.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, KeyRound, X } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface ExportPasswordsDialogProps {
  open: boolean;
  entryCount: number;
  /** Klient-side verifisering av master-pwd (dekrypterer vault-blob). */
  verifyMasterPassword: (pwd: string) => Promise<boolean>;
  /** Kalles etter pwd er bekreftet. Skal bygge CSV og trigge nedlasting. */
  onConfirmedExport: () => Promise<void> | void;
  onCancel: () => void;
}

export function ExportPasswordsDialog({
  open,
  entryCount,
  verifyMasterPassword,
  onConfirmedExport,
  onCancel,
}: ExportPasswordsDialogProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2>(1);
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pwdRef = useRef<HTMLInputElement>(null);

  // Reset state hver gang dialog åpnes (også gjenåpning per Mike-spec)
  useEffect(() => {
    if (open) {
      setStep(1);
      setUnderstood(false);
      setPassword("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Auto-fokus: Avbryt på steg 1, pwd-felt på steg 2
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (step === 1) cancelRef.current?.focus();
      else pwdRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, step]);

  // Esc lukker
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  async function handleConfirmExport() {
    setError(null);
    if (!password) {
      setError(t("export.error_pwd_required"));
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyMasterPassword(password);
      if (!ok) {
        setError(t("export.error_pwd_wrong"));
        setBusy(false);
        return;
      }
      await onConfirmedExport();
      // Suksess: caller stenger dialogen via onCancel-flyt
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("export.error_generic"));
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="export-passwords-dialog"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="export-passwords-title"
        className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-amber-400/30 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        <div className="flex items-start gap-4 p-5">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/15 border border-amber-400/30 flex items-center justify-center">
            {step === 1 ? (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            ) : (
              <KeyRound className="h-5 w-5 text-amber-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3
              id="export-passwords-title"
              className="text-base font-semibold tracking-tight"
            >
              {step === 1
                ? t("export.step1_title")
                : t("export.step2_title")}
            </h3>
            <p className="text-[12px] text-white/65 leading-relaxed mt-1">
              {step === 1
                ? `${t("export.step1_subtitle_prefix")} ${entryCount} ${
                    entryCount === 1
                      ? t("export.entries_singular")
                      : t("export.entries_plural")
                  }.`
                : t("export.step2_subtitle")}
            </p>
          </div>
          <button
            type="button"
            data-testid="export-close-btn"
            onClick={() => !busy && onCancel()}
            className="flex-shrink-0 p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {step === 1 && (
            <>
              <div
                data-testid="export-warning-box"
                className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/30 text-[11px] text-amber-100 leading-relaxed"
              >
                {t("export.warning")}
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                <input
                  data-testid="export-understood-checkbox"
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/5 text-amber-500 focus:ring-amber-400/40 focus:ring-offset-0"
                />
                <span className="text-[11px] text-white/75 leading-relaxed">
                  {t("export.confirm_plaintext")}
                </span>
              </label>

              <div className="flex gap-2 pt-2">
                <button
                  ref={cancelRef}
                  type="button"
                  data-testid="export-cancel-btn"
                  onClick={onCancel}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-sm text-white/85 transition focus:outline-none focus:ring-2 focus:ring-white/30"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="export-step1-continue-btn"
                  disabled={!understood}
                  onClick={() => setStep(2)}
                  className="flex-1 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-white/5 disabled:text-white/40 disabled:cursor-not-allowed text-sm font-semibold text-slate-900 transition focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                >
                  {t("export.continue")} →
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-1.5">
                {t("common.password_label_master")}
              </label>
              <input
                ref={pwdRef}
                data-testid="export-pwd-input"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) handleConfirmExport();
                }}
                className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/40 font-mono"
                placeholder={t("export.pwd_placeholder")}
              />

              {error && (
                <p
                  data-testid="export-error"
                  className="text-[11px] text-rose-300 mt-1.5"
                >
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  ref={cancelRef}
                  type="button"
                  data-testid="export-cancel-btn-2"
                  onClick={onCancel}
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-sm text-white/85 transition focus:outline-none focus:ring-2 focus:ring-white/30 disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="export-confirm-btn"
                  onClick={handleConfirmExport}
                  disabled={busy || !password}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-white/5 disabled:text-white/40 disabled:cursor-not-allowed text-sm font-semibold text-slate-900 transition focus:outline-none focus:ring-2 focus:ring-amber-300/50"
                >
                  <Download className="h-3.5 w-3.5" />
                  {busy ? t("export.exporting") : t("export.download_csv")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
