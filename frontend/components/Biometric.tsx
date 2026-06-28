"use client";

import { useState } from "react";
import {
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface BiometricEnableCardProps {
  onEnable: (masterPassword: string) => Promise<void>;
  onDismiss: () => void;
}

/**
 * Vises på dashboard etter første unlock hvis biometric ikke er aktivert.
 * Krever master-passord-bekreftelse for å sikre at brukeren faktisk eier
 * vaulten før vi binder en biometric-nøkkel til den.
 */
export function BiometricEnableCard({
  onEnable,
  onDismiss,
}: BiometricEnableCardProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || pwd.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onEnable(pwd);
      // Cardet vil forsvinne av seg selv når biometric.registered = true
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknown_error"));
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <div
        data-testid="biometric-enable-prompt"
        className="w-full max-w-2xl backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-5 mb-4 animate-slide-up"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center flex-shrink-0">
            <Fingerprint className="h-5 w-5 text-blue-200" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              {t("biometric.enable_title")}
            </h3>
            <p className="text-[11px] text-white/60 leading-relaxed mt-0.5">
              {t("biometric.enable_description")}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              data-testid="biometric-enable-cta"
              onClick={() => setExpanded(true)}
              className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition"
            >
              {t("biometric.enable_cta")}
            </button>
            <button
              data-testid="biometric-dismiss-btn"
              onClick={onDismiss}
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition"
              aria-label={t("common.close")}
              title={t("biometric.enable_dismiss_title")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="biometric-enable-form"
      className="w-full max-w-2xl backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-5 mb-4 animate-slide-up"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center flex-shrink-0">
          <Fingerprint className="h-5 w-5 text-blue-200" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            {t("biometric.confirm_title")}
          </h3>
          <p className="text-[11px] text-white/60 leading-relaxed mt-0.5">
            {t("biometric.confirm_description")}
          </p>
        </div>
        <button
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
          aria-label={t("common.cancel")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            data-testid="biometric-confirm-pwd-input"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoFocus
            value={pwd}
            onChange={(e) => {
              setPwd(e.target.value);
              if (error) setError(null);
            }}
            className="w-full bg-white/5 border border-white/15 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400/40 font-mono"
            placeholder={t("common.password_label_master")}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
            aria-label={show ? t("common.hide") : t("common.show")}
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && (
          <div
            data-testid="biometric-enable-error"
            className="flex items-start gap-2 p-2 rounded-md bg-rose-500/10 border border-rose-400/30 text-rose-100 text-[11px]"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          data-testid="biometric-enable-submit"
          type="submit"
          disabled={busy || pwd.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-white/5 disabled:text-white/40 text-white text-sm font-semibold shadow transition"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("biometric.confirm_submit_loading")}
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              {t("biometric.confirm_submit")}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

interface BiometricLoginButtonProps {
  onUnlock: () => Promise<void>;
  disabled?: boolean;
}

/**
 * Brukes på MasterPasswordLogin når biometric er aktivert + master er fresh.
 */
export function BiometricLoginButton({
  onUnlock,
  disabled,
}: BiometricLoginButtonProps) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biometric.login_error_default"));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        data-testid="biometric-login-btn"
        type="button"
        onClick={handleClick}
        disabled={busy || disabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-50 border border-blue-400/40 hover:border-blue-400/60 text-blue-100 text-sm font-semibold transition"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("biometric.login_button_loading")}
          </>
        ) : (
          <>
            <Fingerprint className="h-5 w-5" />
            {t("biometric.login_button")}
          </>
        )}
      </button>
      {error && (
        <div
          data-testid="biometric-login-error"
          className="flex items-start gap-2 p-2 rounded-md bg-rose-500/10 border border-rose-400/30 text-rose-100 text-[11px]"
        >
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
