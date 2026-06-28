"use client";
/**
 * Ko | Do · Vault — Iter 20.5b — am-admin MPW Section
 *
 * Settings-seksjon på am-admin dashbordet for å håndtere valgfri Master
 * Password (MPW). Inneholder selv setup-, unlock- og reset-modaler.
 *
 * Statesymbol:
 *   - Ingen MPW satt   → "Sett opp Master Password"-CTA
 *   - MPW satt, låst   → "Lås opp"-CTA + "Glemt MPW?"-link
 *   - MPW satt, åpen   → "Låst opp"-badge + "Lås"-knapp
 *
 * Per blokker-svar (2026-06-26):
 *   1=B  → Per-org MPW under `org-meta:<prefix>:mpw`
 *   4=B  → "Glemt MPW" sletter verifier + alle krypterte payloads irreversibelt
 *
 * Krypto utføres KLIENT-SIDE — passord forlater aldri nettleseren.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import {
  createMpwVerifier,
  verifyMpw,
  type MpwEnvelope,
} from "@/lib/platform/am-admin-mpw";
import {
  analyzeStrength,
  scoreColor,
  type StrengthResult,
} from "@/lib/password-strength";
import { useMpw } from "./MpwContext";

// ─── Statusvariant ────────────────────────────────────────────────────
type MpwStatus =
  | { phase: "loading" }
  | { phase: "none" }
  | { phase: "set"; envelope: MpwEnvelope }
  | { phase: "error"; message: string };

// ─── Hoved-seksjon ────────────────────────────────────────────────────
export function MpwSection({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { t } = useLocale();
  const { isUnlocked, lock } = useMpw();
  const [status, setStatus] = useState<MpwStatus>({ phase: "loading" });
  const [modal, setModal] = useState<"none" | "setup" | "unlock" | "reset">("none");

  const refresh = useCallback(async () => {
    setStatus({ phase: "loading" });
    try {
      const res = await fetch("/api/am-admin/mpw/status", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { enabled: boolean; envelope: MpwEnvelope | null } =
        await res.json();
      if (data.enabled && data.envelope) {
        setStatus({ phase: "set", envelope: data.envelope });
      } else {
        setStatus({ phase: "none" });
      }
    } catch (e) {
      setStatus({
        phase: "error",
        message: e instanceof Error ? e.message : "unknown",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Når MPW faktisk er fjernet (etter reset → phase="none"), tøm derivet
  // nøkkel fra context. VIKTIG: vi sjekker IKKE mot "loading"/"error",
  // for setup-/unlock-flowen trigger en refresh() som sender oss innom
  // phase="loading" mens vi ALLEREDE har en gyldig key — ellers ville
  // brukeren bli umiddelbart låst rett etter setup/unlock.
  useEffect(() => {
    if (status.phase === "none" && isUnlocked) {
      lock();
    }
  }, [status.phase, isUnlocked, lock]);

  const handleClose = useCallback(() => {
    setModal("none");
    void refresh();
  }, [refresh]);

  return (
    <section
      className="bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl p-6"
      data-testid="am-admin-mpw-section"
    >
      <header className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-base font-medium">{t("am_admin_mpw.heading")}</h2>
          <p className="text-xs text-white/55 mt-1">
            {t("am_admin_mpw.description")}
          </p>
        </div>
        {status.phase === "set" && isUnlocked && (
          <span
            className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/25 rounded-md px-2 py-1"
            data-testid="am-admin-mpw-unlocked-badge"
          >
            {t("am_admin_mpw.badge_unlocked")}
          </span>
        )}
      </header>

      {status.phase === "loading" && (
        <p className="text-sm text-white/55">{t("am_admin_mpw.loading")}</p>
      )}

      {status.phase === "error" && (
        <p className="text-sm text-rose-300">
          {t("am_admin_mpw.error_prefix")} {status.message}
        </p>
      )}

      {status.phase === "none" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-white/70">{t("am_admin_mpw.none_hint")}</p>
          <button
            onClick={() => setModal("setup")}
            className="self-start px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            data-testid="am-admin-mpw-setup-btn"
          >
            {t("am_admin_mpw.btn_setup")}
          </button>
        </div>
      )}

      {status.phase === "set" && !isUnlocked && (
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setModal("unlock")}
            className="px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            data-testid="am-admin-mpw-unlock-btn"
          >
            {t("am_admin_mpw.btn_unlock")}
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => setModal("reset")}
              className="px-3 py-2 rounded-lg text-rose-300 hover:bg-rose-500/10 text-xs underline-offset-2 hover:underline transition-colors"
              data-testid="am-admin-mpw-forgot-btn"
            >
              {t("am_admin_mpw.btn_forgot")}
            </button>
          )}
        </div>
      )}

      {status.phase === "set" && isUnlocked && (
        <div className="flex flex-wrap gap-2 items-center">
          <p className="text-sm text-emerald-200/85 flex-1">
            {t("am_admin_mpw.unlocked_hint")}
          </p>
          <button
            onClick={() => lock()}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs transition-colors"
            data-testid="am-admin-mpw-lock-btn"
          >
            {t("am_admin_mpw.btn_lock")}
          </button>
        </div>
      )}

      {/* ─── Modaler ─────────────────────────────────────────── */}
      {modal === "setup" && <MpwSetupModal onClose={handleClose} />}
      {modal === "unlock" && status.phase === "set" && (
        <MpwUnlockModal envelope={status.envelope} onClose={handleClose} />
      )}
      {modal === "reset" && (
        <MpwResetModal onClose={handleClose} onResetDone={refresh} />
      )}
    </section>
  );
}

// ─── Setup modal ──────────────────────────────────────────────────────
function MpwSetupModal({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { setUnlocked } = useMpw();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [strength, setStrength] = useState<StrengthResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = pwd.length > 0 && pwd.length < 12;
  const mismatch = confirm.length > 0 && pwd !== confirm;
  // Iter 20.9 (D-085, 2026-06-27): senket terskel til ≥ 2 (samme som
  // vault-MPW-flow). Score < 2 (= 0 eller 1) ikke godkjent.
  const tooWeak = strength !== null && pwd.length >= 12 && strength.score < 2;
  // Vi krever at zxcvbn-score er ferdig beregnet FØR submit aktiveres —
  // ellers kunne brukeren rekke å klikke i 200ms-debounce-vinduet med
  // pwd ≥ 12 men strength=null, og slippe gjennom et svakt passord.
  const strengthReady = strength !== null && strength.score >= 2;
  const canSubmit =
    pwd.length >= 12 &&
    pwd === confirm &&
    understood &&
    strengthReady &&
    !tooWeak &&
    !busy;

  useEffect(() => {
    if (pwd.length === 0) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      analyzeStrength(pwd)
        .then((r) => {
          if (!cancelled) setStrength(r);
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

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { envelope, key, salt } = await createMpwVerifier(pwd);
      const res = await fetch("/api/am-admin/mpw/setup", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      // Sett aktiv nøkkel umiddelbart slik at brukeren ikke må unlock'e
      // rett etter setup.
      setUnlocked({ key, salt, iterations: envelope.iterations });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t("am_admin_mpw.setup_title")} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-400/25 rounded-lg p-3">
          <strong className="font-medium">{t("am_admin_mpw.setup_warning_title")}</strong>
          <p className="mt-1 text-amber-100/80">
            {t("am_admin_mpw.setup_warning_body")}
          </p>
        </div>

        <label className="block">
          <span className="text-xs text-white/70">{t("am_admin_mpw.field_password")}</span>
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-indigo-400 focus:outline-none"
            data-testid="am-admin-mpw-setup-input"
          />
        </label>

        {pwd.length > 0 && (
          <div className="space-y-1.5" data-testid="am-admin-mpw-strength">
            <div className="h-1.5 w-full bg-white/5 rounded">
              <div
                className={`h-1.5 rounded transition-all ${
                  strength ? scoreColor(strength.score) : "bg-white/10"
                }`}
                style={{ width: `${((strength?.score ?? 0) + 1) * 20}%` }}
              />
            </div>
            {strength && (
              <p className="text-xs text-white/55">
                {t("am_admin_mpw.crack_time_label")}: {strength.crackTime}
              </p>
            )}
            {strength?.warning && (
              <p className="text-xs text-amber-300">{strength.warning}</p>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-xs text-white/70">{t("am_admin_mpw.field_confirm")}</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="mt-1 w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-indigo-400 focus:outline-none"
            data-testid="am-admin-mpw-setup-confirm"
          />
        </label>

        {tooShort && (
          <p className="text-xs text-rose-300">{t("am_admin_mpw.error_too_short")}</p>
        )}
        {mismatch && (
          <p className="text-xs text-rose-300">{t("am_admin_mpw.error_mismatch")}</p>
        )}
        {tooWeak && (
          <p className="text-xs text-rose-300">{t("am_admin_mpw.error_too_weak")}</p>
        )}

        <label className="flex items-start gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5"
            data-testid="am-admin-mpw-setup-confirm-checkbox"
          />
          <span>{t("am_admin_mpw.setup_understand")}</span>
        </label>

        {error && (
          <p className="text-xs text-rose-300" data-testid="am-admin-mpw-setup-error">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors"
          >
            {t("am_admin_mpw.btn_cancel")}
          </button>
          <button
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            className="px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            data-testid="am-admin-mpw-setup-submit"
          >
            {busy ? t("am_admin_mpw.btn_busy") : t("am_admin_mpw.btn_confirm_setup")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Unlock modal ─────────────────────────────────────────────────────
function MpwUnlockModal({
  envelope,
  onClose,
}: {
  envelope: MpwEnvelope;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { setUnlocked } = useMpw();
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (pwd.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyMpw(envelope, pwd);
      if (!result) {
        setError(t("am_admin_mpw.error_wrong_password"));
        return;
      }
      setUnlocked({
        key: result.key,
        salt: result.salt,
        iterations: envelope.iterations,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t("am_admin_mpw.unlock_title")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-white/70">{t("am_admin_mpw.unlock_hint")}</p>
        <label className="block">
          <span className="text-xs text-white/70">{t("am_admin_mpw.field_password")}</span>
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
            autoFocus
            autoComplete="current-password"
            className="mt-1 w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-indigo-400 focus:outline-none"
            data-testid="am-admin-mpw-unlock-input"
          />
        </label>

        {error && (
          <p className="text-xs text-rose-300" data-testid="am-admin-mpw-unlock-error">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors"
          >
            {t("am_admin_mpw.btn_cancel")}
          </button>
          <button
            disabled={pwd.length === 0 || busy}
            onClick={() => void handleSubmit()}
            className="px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            data-testid="am-admin-mpw-unlock-submit"
          >
            {busy ? t("am_admin_mpw.btn_busy") : t("am_admin_mpw.btn_unlock")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Reset modal (Glemt MPW) ──────────────────────────────────────────
function MpwResetModal({
  onClose,
  onResetDone,
}: {
  onClose: () => void;
  onResetDone: () => void;
}) {
  const { t } = useLocale();
  const { lock } = useMpw();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requiredText = t("am_admin_mpw.reset_required_text");
  const matches = confirmText.trim() === requiredText;

  const handleReset = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/am-admin/mpw", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      lock();
      onResetDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t("am_admin_mpw.reset_title")} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-rose-200/90 bg-rose-500/10 border border-rose-400/30 rounded-lg p-3">
          <strong className="font-medium">{t("am_admin_mpw.reset_warning_title")}</strong>
          <p className="mt-1 text-rose-100/80 whitespace-pre-line">
            {t("am_admin_mpw.reset_warning_body")}
          </p>
        </div>

        <label className="block">
          <span className="text-xs text-white/70">
            {t("am_admin_mpw.reset_type_label_prefix")}{" "}
            <span className="font-mono text-rose-300">{requiredText}</span>{" "}
            {t("am_admin_mpw.reset_type_label_suffix")}
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="mt-1 w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm font-mono text-white focus:border-rose-400 focus:outline-none"
            data-testid="am-admin-mpw-reset-input"
          />
        </label>

        {error && (
          <p className="text-xs text-rose-300" data-testid="am-admin-mpw-reset-error">
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors"
          >
            {t("am_admin_mpw.btn_cancel")}
          </button>
          <button
            disabled={!matches || busy}
            onClick={() => void handleReset()}
            className="px-4 py-2 rounded-lg bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            data-testid="am-admin-mpw-reset-submit"
          >
            {busy ? t("am_admin_mpw.btn_busy") : t("am_admin_mpw.btn_confirm_reset")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Felles modal-shell ───────────────────────────────────────────────
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="am-admin-mpw-modal-backdrop"
    >
      <div
        className="bg-[#161b26] border border-white/10 rounded-2xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="am-admin-mpw-modal"
      >
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}
