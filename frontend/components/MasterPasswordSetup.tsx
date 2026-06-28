"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { PasswordLab } from "./PasswordLab";
import { useLocale } from "@/lib/i18n-context";
import {
  analyzeStrength,
  scoreColor,
  type StrengthResult,
} from "@/lib/password-strength";

interface MasterPasswordSetupProps {
  onSetup: (masterPassword: string) => Promise<void>;
}

export function MasterPasswordSetup({ onSetup }: MasterPasswordSetupProps) {
  const { t } = useLocale();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  // Iter 19.9.4 (#10-extended): identisk zxcvbn-mønster som
  // ChangeMasterDialog. Score 0-1 blokkerer, 2 advarer, 3-4 grønt.
  // Lazy/dynamic-import via analyzeStrength(); cancellation-flag i useEffect.
  const [strength, setStrength] = useState<StrengthResult | null>(null);

  const tooShort = pwd.length > 0 && pwd.length < 12;
  const mismatch = confirm.length > 0 && pwd !== confirm;
  const tooWeak =
    strength !== null && pwd.length >= 12 && strength.score < 2;
  const canSubmit =
    pwd.length >= 12 && pwd === confirm && understood && !tooWeak && !busy;

  // Reset feilmelding når brukeren skriver
  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pwd, confirm]);

  // 200ms debounced zxcvbn-analyse — samme mønster som ChangeMasterDialog.
  // Hvis lazy-load feiler, settes strength=null så length-sjekken alene
  // (>=12) gjelder; submit blokkeres da ikke unødvendig.
  useEffect(() => {
    if (pwd.length === 0) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      analyzeStrength(pwd)
        .then((result) => {
          if (!cancelled) setStrength(result);
        })
        .catch(() => {
          if (!cancelled) setStrength(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pwd]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSetup(pwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknown_error"));
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-testid="master-password-setup"
        className="w-full max-w-md backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-7 animate-slide-up"
      >
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-400/30 flex items-center justify-center">
          <KeyRound className="h-5 w-5 text-blue-200" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("setup.title")}
          </h2>
          <p className="text-xs text-white/50">{t("setup.subtitle")}</p>
        </div>
      </div>

      <p className="text-[12px] text-white/65 leading-relaxed mt-4 mb-5">
        {t("setup.intro_1")}{" "}
        <strong className="text-white">{t("setup.intro_2_strong_aldri")}</strong>{" "}
        {t("setup.intro_3")}{" "}
        <strong className="text-amber-200">{t("setup.intro_4_strong_ikke")}</strong>{" "}
        {t("setup.intro_5")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider">
              {t("common.password_label_master")}
            </label>
            <button
              type="button"
              data-testid="setup-open-lab"
              onClick={() => setLabOpen(true)}
              className="flex items-center gap-1 text-[10px] font-medium text-violet-300 hover:text-violet-200 transition"
            >
              <FlaskConical className="h-3 w-3" />
              {t("common.password_lab")}
            </button>
          </div>
          <div className="relative">
            <input
              data-testid="setup-password-input"
              type={show ? "text" : "password"}
              name="kodo-vault-setup-handle"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore
              data-form-type="other"
              spellCheck={false}
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400/40 font-mono"
              placeholder={t("common.min_12_chars_placeholder")}
            />
            <button
              type="button"
              data-testid="setup-toggle-show"
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
          {tooShort && (
            <p
              data-testid="setup-error-too-short"
              className="text-[11px] text-amber-200 mt-1.5"
            >
              {t("common.error_too_short_12")}
            </p>
          )}
          {pwd.length >= 12 && strength && (
            <div data-testid="setup-strength" className="mt-2 space-y-1">
              <div className="h-1 w-full bg-white/10 rounded overflow-hidden">
                <div
                  data-testid={`setup-strength-bar-score-${strength.score}`}
                  className={`h-full transition-all ${scoreColor(strength.score)}`}
                  style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
                />
              </div>
              <p
                data-testid="setup-strength-text"
                className={`text-[11px] font-medium ${
                  strength.score < 2
                    ? "text-rose-300"
                    : strength.score === 2
                    ? "text-amber-200"
                    : "text-emerald-300"
                }`}
              >
                {strength.score < 2
                  ? t("change_pwd.strength_too_weak")
                  : strength.score === 2
                  ? t("change_pwd.strength_fair")
                  : t("change_pwd.strength_strong")}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-1.5">
            {t("setup.confirm_label")}
          </label>
          <input
            data-testid="setup-confirm-input"
            type={show ? "text" : "password"}
            name="kodo-vault-setup-confirm"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore
            data-form-type="other"
            spellCheck={false}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`w-full bg-white/5 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 font-mono ${
              mismatch
                ? "border-rose-400/50 focus:ring-rose-400/40 focus:border-rose-400/50"
                : "border-white/15 focus:ring-blue-400/40 focus:border-blue-400/40"
            }`}
            placeholder={t("setup.confirm_placeholder")}
          />
          {mismatch && (
            <p
              data-testid="setup-error-mismatch"
              className="text-[11px] text-rose-300 mt-1.5"
            >
              {t("common.error_passwords_mismatch")}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
          <input
            data-testid="setup-understood-checkbox"
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/5 text-blue-500 focus:ring-blue-400/40 focus:ring-offset-0"
          />
          <span className="text-[11px] text-white/70 leading-relaxed">
            {t("setup.understood_1")}{" "}
            <strong className="text-amber-200">{t("setup.understood_2_strong")}</strong>{" "}
            {t("setup.understood_3")}
          </span>
        </label>

        {error && (
          <div
            data-testid="setup-error-banner"
            className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-100 text-[11px]"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          data-testid="setup-submit-btn"
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-white/5 disabled:text-white/40 text-white disabled:cursor-not-allowed text-sm font-semibold shadow transition"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("setup.submit_button_loading")}
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              {t("setup.submit_button")}
            </>
          )}
        </button>
      </form>

      <div className="mt-5 pt-4 border-t border-white/10 flex items-start gap-2 text-[10px] text-white/50 leading-relaxed">
        <ShieldCheck className="h-3 w-3 mt-0.5 flex-shrink-0 text-emerald-300/70" />
        <span>
          {t("setup.security_note_1")}{" "}
          <strong className="text-white/70">{t("setup.security_note_2_strong")}</strong>{" "}
          {t("setup.security_note_3")}
        </span>
      </div>
      </div>

      <PasswordLab
        open={labOpen}
        initialTestPassword={pwd}
        onClose={() => setLabOpen(false)}
        onUsePassword={(newPwd) => {
          setPwd(newPwd);
          setConfirm(newPwd);
        }}
      />
    </>
  );
}
