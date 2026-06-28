"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { BiometricLoginButton } from "./Biometric";
import { useLocale } from "@/lib/i18n-context";
import type { BiometricInfo } from "@/hooks/useVault";

interface MasterPasswordLoginProps {
  onUnlock: (masterPassword: string) => Promise<void>;
  onUnlockBiometric: () => Promise<void>;
  onDestroy: () => void;
  biometric: BiometricInfo;
  /**
   * v4.0 — Slot for ekstra elementer integrert i login-cardet (f.eks.
   * "Pakk ut en pakke jeg fikk"-knapp for Anna). Vises som en seksjon under
   * "Glemt passord"-stripen med visuell separator.
   */
  extraFooter?: React.ReactNode;
}

export function MasterPasswordLogin({
  onUnlock,
  onUnlockBiometric,
  onDestroy,
  biometric,
  extraFooter,
}: MasterPasswordLoginProps) {
  const { t } = useLocale();
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [destroyOpen, setDestroyOpen] = useState(false);

  // Vis biometric-knapp KUN når den er registrert + master er fresh
  const showBiometric =
    biometric.supported && biometric.registered && biometric.masterFresh;
  const masterRequired =
    biometric.registered && !biometric.masterFresh;

  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pwd]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || pwd.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(pwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error_default"));
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-testid="master-password-login"
        className="w-full max-w-md backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-7 animate-slide-up"
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center">
            <KeyRound className="h-5 w-5 text-blue-200" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {t("login.title")}
            </h2>
            <p className="text-xs text-white/50">
              {masterRequired
                ? t("login.subtitle_master_required")
                : t("login.subtitle_default")}
            </p>
          </div>
        </div>

        {showBiometric && (
          <div className="mb-5">
            <BiometricLoginButton onUnlock={onUnlockBiometric} disabled={busy} />
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider">
                {t("login.divider_or_password")}
              </span>
              <div className="flex-1 h-px bg-white/10" />
            </div>
          </div>
        )}

        {masterRequired && (
          <div
            data-testid="master-required-banner"
            className="mb-4 flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-100 text-[11px]"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>
              {t("login.master_required_explanation")}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-1.5">
              {t("common.password_label_master")}
            </label>
            <div className="relative">
              <input
                data-testid="login-password-input"
                type={show ? "text" : "password"}
                name="kodo-vault-master-handle"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-form-type="other"
                spellCheck={false}
                autoFocus={!showBiometric}
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400/40 font-mono"
                placeholder={t("login.password_placeholder")}
              />
              <button
                type="button"
                data-testid="login-toggle-show"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
                aria-label={show ? t("common.hide_password") : t("common.show_password")}
                tabIndex={-1}
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error && (
            <div
              data-testid="login-error-banner"
              className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-100 text-[11px]"
            >
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            data-testid="login-submit-btn"
            type="submit"
            disabled={busy || pwd.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-white/5 disabled:text-white/40 text-white disabled:cursor-not-allowed text-sm font-semibold shadow transition"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("login.unlock_button_loading")}
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                {t("login.unlock_button")}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/40 leading-relaxed">
            {t("login.forgot_help")}
          </span>
          <button
            data-testid="login-destroy-btn"
            type="button"
            onClick={() => setDestroyOpen(true)}
            className="flex items-center gap-1 text-[10px] text-rose-300/80 hover:text-rose-200 transition"
          >
            <Trash2 className="h-3 w-3" />
            {t("login.destroy_button")}
          </button>
        </div>

        {extraFooter && (
          <div className="mt-4 pt-4 border-t border-white/10">{extraFooter}</div>
        )}
      </div>

      <ConfirmDialog
        open={destroyOpen}
        title={t("login.destroy_dialog_title")}
        description={
          <>
            {t("login.destroy_dialog_body_1")}{" "}
            <strong className="text-white">{t("login.destroy_dialog_body_2_strong")}</strong>{" "}
            {t("login.destroy_dialog_body_3")}
            <br />
            <br />
            <span className="text-amber-200/90">
              {t("login.destroy_dialog_warning")}
            </span>
          </>
        }
        confirmLabel={t("login.destroy_dialog_confirm")}
        cancelLabel={t("common.cancel")}
        variant="destructive"
        requireConfirmText="SLETT"
        onConfirm={() => {
          onDestroy();
          setDestroyOpen(false);
        }}
        onCancel={() => setDestroyOpen(false)}
      />
    </>
  );
}
