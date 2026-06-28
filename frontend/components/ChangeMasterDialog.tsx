"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { PasswordLab } from "./PasswordLab";
import { useLocale } from "@/lib/i18n-context";
import {
  analyzeStrength,
  scoreColor,
  type StrengthResult,
} from "@/lib/password-strength";

interface ChangeMasterDialogProps {
  open: boolean;
  biometricActive: boolean;
  onClose: () => void;
  onChange: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
}

export function ChangeMasterDialog({
  open,
  biometricActive,
  onClose,
  onChange,
}: ChangeMasterDialogProps) {
  const { t } = useLocale();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  // Iter 19.9.3 (#10): zxcvbn-styrke-analyse av det nye passordet.
  // Score 0-1 = blokkert, 2 = advar, 3-4 = OK. Lazy/dynamic-import via
  // analyzeStrength() — første call laster ~300KB, deretter cached.
  const [strength, setStrength] = useState<StrengthResult | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setShowCurrent(false);
      setShowNext(false);
      setUnderstood(false);
      setBusy(false);
      setError(null);
      setStrength(null);
    }
  }, [open]);

  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, next, confirm]);

  // Debounced zxcvbn-analyse — 200ms delay så vi ikke kjører på hver
  // tastetrykk. Bruker setTimeout/clearTimeout-mønster og avbryter
  // hvis komponenten unmounter eller `next` endres før analysen er ferdig.
  useEffect(() => {
    if (next.length === 0) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      analyzeStrength(next, [current])
        .then((result) => {
          if (!cancelled) setStrength(result);
        })
        .catch(() => {
          // Hvis zxcvbn feiler å laste, ikke blokker brukeren —
          // length-sjekken (>= 12) er fortsatt aktiv.
          if (!cancelled) setStrength(null);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [next, current]);

  if (!open) return null;

  const tooShort = next.length > 0 && next.length < 12;
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooWeak =
    strength !== null && next.length >= 12 && strength.score < 2;
  const canSubmit =
    current.length > 0 &&
    next.length >= 12 &&
    next === confirm &&
    next !== current &&
    understood &&
    !tooWeak &&
    !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(current, next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unknown_error"));
      setBusy(false);
    }
  };

  return (
    <>
    <div
      data-testid="change-master-dialog"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up">
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center flex-shrink-0">
            <KeyRound className="h-5 w-5 text-amber-200" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold tracking-tight">
              {t("change_master.title")}
            </h3>
            <p className="text-[11px] text-white/55 mt-0.5">
              {t("change_master.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {biometricActive && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-amber-100 text-[11px]">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                {t("change_master.biometric_warning_1")}{" "}
                <strong>{t("change_master.biometric_warning_2_strong")}</strong>{" "}
                {t("change_master.biometric_warning_3")}
              </span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-1.5">
              {t("change_master.current_label")}
            </label>
            <div className="relative">
              <input
                data-testid="cm-current-input"
                type={showCurrent ? "text" : "password"}
                name="kodo-vault-cm-current"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-form-type="other"
                spellCheck={false}
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={inputCls}
                placeholder="••••••••••••"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className={eyeBtnCls}
                tabIndex={-1}
              >
                {showCurrent ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider">
                {t("change_master.new_label")}
              </label>
              <button
                type="button"
                data-testid="cm-open-lab"
                onClick={() => setLabOpen(true)}
                className="flex items-center gap-1 text-[10px] font-medium text-violet-300 hover:text-violet-200 transition"
              >
                <FlaskConical className="h-3 w-3" />
                {t("common.password_lab")}
              </button>
            </div>
            <div className="relative">
              <input
                data-testid="cm-new-input"
                type={showNext ? "text" : "password"}
                name="kodo-vault-cm-new"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-form-type="other"
                spellCheck={false}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className={inputCls}
                placeholder={t("common.min_12_chars_placeholder")}
              />
              <button
                type="button"
                onClick={() => setShowNext((v) => !v)}
                className={eyeBtnCls}
                tabIndex={-1}
              >
                {showNext ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {tooShort && (
              <p className="text-[11px] text-amber-200 mt-1.5">
                {t("common.error_too_short_12")}
              </p>
            )}
            {next.length >= 12 && strength && (
              <div data-testid="cm-strength" className="mt-2 space-y-1">
                <div className="h-1 w-full bg-white/10 rounded overflow-hidden">
                  <div
                    data-testid={`cm-strength-bar-score-${strength.score}`}
                    className={`h-full transition-all ${scoreColor(strength.score)}`}
                    style={{ width: `${((strength.score + 1) / 5) * 100}%` }}
                  />
                </div>
                <p
                  data-testid="cm-strength-text"
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
            {next.length > 0 && next === current && (
              <p className="text-[11px] text-amber-200 mt-1.5">
                {t("change_master.error_same_as_current")}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-white/70 uppercase tracking-wider mb-1.5">
              {t("change_master.confirm_label")}
            </label>
            <input
              data-testid="cm-confirm-input"
              type={showNext ? "text" : "password"}
              name="kodo-vault-cm-confirm"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore
              data-form-type="other"
              spellCheck={false}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={`${inputCls.replace("pr-10", "")} ${
                mismatch ? "border-rose-400/50 focus:ring-rose-400/40" : ""
              }`}
              placeholder={t("change_master.placeholder_repeat")}
            />
            {mismatch && (
              <p className="text-[11px] text-rose-300 mt-1.5">
                Passordene matcher ikke
              </p>
            )}
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              data-testid="cm-understood"
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/30 bg-white/5 text-blue-500 focus:ring-blue-400/40"
            />
            <span className="text-[11px] text-white/70 leading-relaxed">
              Jeg forstår at hvis jeg glemmer det nye passordet, vil vaulten
              være <strong className="text-amber-200">tapt for alltid</strong>.
            </span>
          </label>

          {error && (
            <div
              data-testid="cm-error"
              className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30 text-rose-100 text-[11px]"
            >
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-xs font-medium transition disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              data-testid="cm-submit-btn"
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-white/5 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("change_master.submit_button_loading")}
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t("change_master.submit_button")}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>

    <PasswordLab
      open={labOpen}
      initialTestPassword={next}
      onClose={() => setLabOpen(false)}
      onUsePassword={(pwd) => {
        setNext(pwd);
        setConfirm(pwd);
      }}
    />
    </>
  );
}

const inputCls =
  "w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400/40 font-mono pr-10";

const eyeBtnCls =
  "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition";
