"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-081 + D-083) — am-admin change-password form
 *
 * Gjenbrukbar komponent. Rendres inline i dashbordet på `/` når
 * `forcePasswordReset === true`, OG som standalone-side ved frivillig
 * bytte (samme komponent, ulik kontekst).
 *
 * Bruker zxcvbn-styrkemåler (score ≥ 2 kreves — samme terskel som
 * vault-MPW-flow, "score < 2 ikke godkjent") + minimum 12 tegn,
 * samme terskel som MpwSection (D-079).
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import {
  analyzeStrength,
  scoreColor,
  scoreLabel,
  type StrengthResult,
} from "@/lib/password-strength";

const MIN_LENGTH = 12;
const MIN_SCORE = 2;

export function ChangePasswordForm({
  forced,
  onSuccess,
}: {
  forced: boolean;
  /** Kalles 1.5s etter vellykket bytte. Parent re-fetcher /me. */
  onSuccess: () => void;
}) {
  const { t } = useLocale();

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [strength, setStrength] = useState<StrengthResult | null>(null);
  const [strengthLoading, setStrengthLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (newPwd.length < 4) {
      setStrength(null);
      return;
    }
    setStrengthLoading(true);
    let cancelled = false;
    void analyzeStrength(newPwd).then((r) => {
      if (!cancelled) {
        setStrength(r);
        setStrengthLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [newPwd]);

  const lengthOk = newPwd.length >= MIN_LENGTH;
  const scoreOk = strength !== null && strength.score >= MIN_SCORE;
  const matchOk = newPwd.length > 0 && newPwd === confirmPwd;
  const differentOk = newPwd.length > 0 && newPwd !== currentPwd;
  const canSubmit =
    currentPwd.length > 0 &&
    lengthOk &&
    scoreOk &&
    matchOk &&
    differentOk &&
    !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/am-admin/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: currentPwd,
          newPassword: newPwd,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (body.error === "invalid_current_password") {
          setError(t("am_admin_change_password.error_invalid_current"));
        } else if (body.error === "weak_password") {
          setError(t("am_admin_change_password.error_weak"));
        } else if (body.error === "same_password") {
          setError(t("am_admin_change_password.error_same"));
        } else {
          setError(body.detail ?? body.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      setSuccess(true);
      setTimeout(onSuccess, 1500);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "unknown_error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950/80 backdrop-blur-xl p-6 shadow-2xl"
      data-testid="am-admin-change-password-page"
    >
      <h1
        className="text-lg font-semibold mb-1"
        data-testid="am-admin-change-password-title"
      >
        {forced
          ? t("am_admin_change_password.title_forced")
          : t("am_admin_change_password.title_voluntary")}
      </h1>
      <p
        className="text-xs text-white/55 mb-6"
        data-testid="am-admin-change-password-subtitle"
      >
        {forced
          ? t("am_admin_change_password.subtitle_forced")
          : t("am_admin_change_password.subtitle_voluntary")}
      </p>

      {success ? (
        <div
          data-testid="am-admin-change-password-success"
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-200"
        >
          {t("am_admin_change_password.success")}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-white/55 mb-1.5">
              {t("am_admin_change_password.field_current")}
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              data-testid="am-admin-change-password-current-input"
              className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/60"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-white/55 mb-1.5">
              {t("am_admin_change_password.field_new")}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              data-testid="am-admin-change-password-new-input"
              className={`w-full rounded-lg bg-black/40 border px-3 py-2 text-sm text-white outline-none transition ${
                newPwd.length === 0
                  ? "border-white/15 focus:border-blue-300/60"
                  : lengthOk && scoreOk
                    ? "border-emerald-400/60 focus:border-emerald-300"
                    : "border-amber-400/60 focus:border-amber-300"
              }`}
            />
            {newPwd.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        strength ? scoreColor(strength.score) : "bg-white/20"
                      }`}
                      style={{
                        width: strength
                          ? `${((strength.score + 1) / 5) * 100}%`
                          : "0%",
                      }}
                    />
                  </div>
                  <span
                    data-testid="am-admin-change-password-score-label"
                    className="text-[11px] text-white/60 font-mono whitespace-nowrap"
                  >
                    {strengthLoading
                      ? t("am_admin_change_password.analyzing")
                      : strength
                        ? scoreLabel(strength.score)
                        : ""}
                  </span>
                </div>
                <ul className="text-[11px] text-white/55 space-y-0.5">
                  <li
                    data-testid="am-admin-change-password-rule-length"
                    className={lengthOk ? "text-emerald-300" : "text-white/50"}
                  >
                    {lengthOk ? "✓" : "○"}{" "}
                    {t("am_admin_change_password.rule_length").replace(
                      "{n}",
                      String(MIN_LENGTH),
                    )}
                  </li>
                  <li
                    data-testid="am-admin-change-password-rule-score"
                    className={scoreOk ? "text-emerald-300" : "text-white/50"}
                  >
                    {scoreOk ? "✓" : "○"}{" "}
                    {t("am_admin_change_password.rule_score")}
                  </li>
                  <li
                    data-testid="am-admin-change-password-rule-different"
                    className={
                      differentOk ? "text-emerald-300" : "text-white/50"
                    }
                  >
                    {differentOk ? "✓" : "○"}{" "}
                    {t("am_admin_change_password.rule_different")}
                  </li>
                </ul>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-white/55 mb-1.5">
              {t("am_admin_change_password.field_confirm")}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              data-testid="am-admin-change-password-confirm-input"
              className={`w-full rounded-lg bg-black/40 border px-3 py-2 text-sm text-white outline-none transition ${
                confirmPwd.length === 0
                  ? "border-white/15 focus:border-blue-300/60"
                  : matchOk
                    ? "border-emerald-400/60 focus:border-emerald-300"
                    : "border-rose-400/60 focus:border-rose-300"
              }`}
            />
            {confirmPwd.length > 0 && !matchOk && (
              <p
                data-testid="am-admin-change-password-mismatch"
                className="mt-1.5 text-[11px] text-rose-300"
              >
                {t("am_admin_change_password.error_mismatch")}
              </p>
            )}
          </div>

          {error && (
            <div
              data-testid="am-admin-change-password-error"
              className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="am-admin-change-password-submit"
            className="w-full rounded-lg bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-white font-semibold py-2.5 text-sm transition"
          >
            {busy
              ? t("am_admin_change_password.submitting")
              : t("am_admin_change_password.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
