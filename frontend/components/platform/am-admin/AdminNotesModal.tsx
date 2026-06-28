"use client";
/**
 * Ko | Do · Vault — Iter 20.5c — AdminNotesModal
 *
 * Modal per ansatt for å lese/skrive admin-notater. Krever at MPW er
 * unlocked (via MpwContext). Hvis MPW er låst, viser modalen en
 * unlock-hint i stedet for tekst-area.
 *
 * Flow:
 *   1. Åpne modal → GET /api/am-admin/employees/<sub>/notes
 *   2. Hvis envelope finnes: dekrypter klient-side via MPW key
 *   3. Vis textarea (maks 5000 tegn — blokker-svar 2=B)
 *   4. Lagre → krypter klient-side → PUT envelope
 *   5. Slett → DELETE
 *
 * Krypto er ren klient-side — server ser KUN opaque envelope (D-079).
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import {
  encryptWithMpwKey,
  decryptWithMpwKey,
  type MpwEnvelope,
} from "@/lib/platform/am-admin-mpw";
import { useMpw } from "./MpwContext";

const MAX_NOTE_CHARS = 5000;

export function AdminNotesModal({
  subdomain,
  employeeName,
  onClose,
}: {
  subdomain: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { isUnlocked, getUnlocked } = useMpw();
  const [text, setText] = useState("");
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrupt, setCorrupt] = useState(false);

  // ─── Initial fetch + decrypt ───────────────────────────────────
  useEffect(() => {
    if (!isUnlocked) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/am-admin/employees/${encodeURIComponent(subdomain)}/notes`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { envelope: MpwEnvelope | null; corrupt?: boolean } =
          await res.json();
        if (cancelled) return;
        if (data.corrupt) {
          setCorrupt(true);
          setOriginalText("");
          setText("");
          return;
        }
        if (!data.envelope) {
          setOriginalText("");
          setText("");
        } else {
          const unlocked = getUnlocked();
          if (!unlocked) {
            // Edge-case: bruker låste mellom click og fetch
            setError(t("am_admin_notes.error_mpw_locked"));
            return;
          }
          try {
            const decoded = await decryptWithMpwKey(data.envelope, unlocked.key);
            if (cancelled) return;
            setOriginalText(decoded);
            setText(decoded);
          } catch {
            setError(t("am_admin_notes.error_decrypt_failed"));
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subdomain, isUnlocked, getUnlocked, t]);

  const dirty = originalText !== null && text !== originalText;
  const tooLong = text.length > MAX_NOTE_CHARS;
  const canSave = dirty && !tooLong && !busy && isUnlocked;
  const canDelete = originalText !== null && originalText.length > 0 && !busy;

  // ─── Save ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const unlocked = getUnlocked();
    if (!unlocked) {
      setError(t("am_admin_notes.error_mpw_locked"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const envelope = await encryptWithMpwKey(
        text,
        unlocked.key,
        unlocked.salt,
        unlocked.iterations,
      );
      const res = await fetch(
        `/api/am-admin/employees/${encodeURIComponent(subdomain)}/notes`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ envelope }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canSave, getUnlocked, text, subdomain, onClose, t]);

  // ─── Delete ────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!canDelete) return;
    if (!confirm(t("am_admin_notes.confirm_delete"))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/am-admin/employees/${encodeURIComponent(subdomain)}/notes`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canDelete, subdomain, onClose, t]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="am-admin-notes-backdrop"
    >
      <div
        className="bg-[#161b26] border border-white/10 rounded-2xl max-w-lg w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="am-admin-notes-modal"
      >
        <header className="mb-4">
          <h3 className="text-lg font-semibold">
            {t("am_admin_notes.title_prefix")} {employeeName}
          </h3>
          <p className="text-xs text-white/55 mt-1 font-mono">{subdomain}</p>
        </header>

        {!isUnlocked && (
          <div
            className="text-sm text-amber-200/90 bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 mb-4"
            data-testid="am-admin-notes-locked-hint"
          >
            {t("am_admin_notes.locked_hint")}
          </div>
        )}

        {isUnlocked && corrupt && (
          <div
            className="text-sm text-rose-200/90 bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 mb-4"
            data-testid="am-admin-notes-corrupt-warning"
          >
            {t("am_admin_notes.corrupt_warning")}
          </div>
        )}

        {isUnlocked && loading && (
          <p className="text-sm text-white/55 py-6 text-center">
            {t("am_admin_notes.loading")}
          </p>
        )}

        {isUnlocked && !loading && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("am_admin_notes.placeholder")}
              rows={8}
              className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none resize-none"
              data-testid="am-admin-notes-textarea"
            />
            <div className="flex justify-between items-center mt-1.5 text-xs">
              <span
                className={tooLong ? "text-rose-300" : "text-white/45"}
                data-testid="am-admin-notes-counter"
              >
                {text.length} / {MAX_NOTE_CHARS}
              </span>
              {dirty && !tooLong && (
                <span className="text-amber-300/85">
                  {t("am_admin_notes.unsaved_changes")}
                </span>
              )}
            </div>
          </>
        )}

        {error && (
          <p
            className="text-xs text-rose-300 mt-3"
            data-testid="am-admin-notes-error"
          >
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-between mt-5">
          <div>
            {isUnlocked && canDelete && (
              <button
                onClick={() => void handleDelete()}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-rose-300 hover:bg-rose-500/10 text-xs underline-offset-2 hover:underline disabled:opacity-40 transition-colors"
                data-testid="am-admin-notes-delete-btn"
              >
                {t("am_admin_notes.btn_delete")}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm transition-colors"
              data-testid="am-admin-notes-cancel-btn"
            >
              {t("am_admin_notes.btn_cancel")}
            </button>
            {isUnlocked && (
              <button
                disabled={!canSave}
                onClick={() => void handleSave()}
                className="px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                data-testid="am-admin-notes-save-btn"
              >
                {busy ? t("am_admin_notes.btn_busy") : t("am_admin_notes.btn_save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
