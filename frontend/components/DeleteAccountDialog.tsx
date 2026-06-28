"use client";

/**
 * Ko | Do · Vault — DeleteAccountDialog
 *
 * To-stegs selvbetjent vault- og konto-sletting.
 *
 * Steg 1: advarsel + GDPR-notat → [Avbryt] [Fortsett →]
 * Steg 2: bekreft med master-passord → [Avbryt] [Slett vault permanent]
 *
 * Master-passordet verifiseres KLIENTSIDE via `verifyMasterPassword` (samme
 * mekanisme som unlock — dekrypterer vault-blob med oppgitt pwd). Først ved
 * vellykket verifisering kalles `onConfirmedDelete()` som typisk POSTer til
 * `/api/account/delete` og redirecter brukeren ut.
 *
 * Bevisst designvalg:
 *   - Avbryt-knappen er focusert ved åpning (ikke destruktiv-knappen) →
 *     hindrer at trykk-på-enter sletter vault.
 *   - Master-pwd-feltet er type="password" + autoComplete="current-password"
 *     slik at passord-managere fungerer normalt.
 *   - Esc lukker dialogen unntatt mens busy=true.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, KeyRound, X } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface DeleteAccountDialogProps {
  open: boolean;
  /** Klient-side verifisering av master-pwd (dekrypterer vault-blob). */
  verifyMasterPassword: (pwd: string) => Promise<boolean>;
  /** Kjøres etter pwd er bekreftet. Skal slette tenant og redirecte ut. */
  onConfirmedDelete: () => Promise<void>;
  onCancel: () => void;
}

export function DeleteAccountDialog({
  open,
  verifyMasterPassword,
  onConfirmedDelete,
  onCancel,
}: DeleteAccountDialogProps) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pwdRef = useRef<HTMLInputElement>(null);

  // Reset state hver gang dialog åpnes
  useEffect(() => {
    if (open) {
      setStep(1);
      setPassword("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  // Auto-fokus: Avbryt på steg 1 (defensiv default), pwd-felt på steg 2
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

  async function handleConfirmDelete() {
    setError(null);
    if (!password) {
      setError(t("delete_account.error_pwd_required"));
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyMasterPassword(password);
      if (!ok) {
        setError(t("delete_account.error_pwd_wrong"));
        setBusy(false);
        return;
      }
      await onConfirmedDelete();
      // Suksess: caller (typisk page.tsx) redirecter — vi forblir busy
      // til navigasjonen kicker inn.
    } catch (e) {
      setError(e instanceof Error ? e.message : t("delete_account.error_generic"));
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="delete-account-dialog"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="delete-account-title"
        className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-rose-400/30 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        <div className="flex items-start gap-4 p-5">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-rose-500/15 border border-rose-400/30 flex items-center justify-center">
            {step === 1 ? (
              <AlertTriangle className="h-5 w-5 text-rose-300" />
            ) : (
              <KeyRound className="h-5 w-5 text-rose-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3
              id="delete-account-title"
              className="text-base font-semibold tracking-tight"
            >
              {step === 1
                ? t("delete_account.step1_title")
                : t("delete_account.step2_title")}
            </h3>

            {step === 1 ? (
              <>
                <p
                  data-testid="delete-account-warning-body"
                  className="mt-2 text-sm text-white/75 leading-relaxed"
                >
                  {t("delete_account.step1_body")}
                </p>
                <p className="mt-3 text-[11px] text-white/45 leading-relaxed">
                  {t("delete_account.gdpr_note")}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-white/75 leading-relaxed">
                  {t("delete_account.step2_body")}
                </p>
                <div className="mt-3">
                  <input
                    ref={pwdRef}
                    data-testid="delete-account-pwd-input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error) setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) handleConfirmDelete();
                    }}
                    disabled={busy}
                    placeholder={t("delete_account.pwd_placeholder")}
                    className="w-full bg-white/5 border border-white/15 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-rose-400/40 focus:border-rose-400/40 font-mono disabled:opacity-50"
                  />
                  {error && (
                    <p
                      data-testid="delete-account-error"
                      className="mt-2 text-xs text-rose-300"
                    >
                      {error}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            data-testid="delete-account-x"
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
            data-testid="delete-account-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-sm font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          {step === 1 ? (
            <button
              data-testid="delete-account-continue"
              onClick={() => setStep(2)}
              className="px-4 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-sm font-medium text-rose-100 transition focus:outline-none focus:ring-2 focus:ring-rose-300/50"
            >
              {t("delete_account.continue_button")}
            </button>
          ) : (
            <button
              data-testid="delete-account-confirm"
              onClick={handleConfirmDelete}
              disabled={busy || password.length === 0}
              className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium shadow transition focus:outline-none focus:ring-2 focus:ring-rose-300/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy
                ? t("delete_account.busy_label")
                : t("delete_account.confirm_button")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
