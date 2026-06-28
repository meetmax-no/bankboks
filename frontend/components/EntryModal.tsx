"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  Loader2,
  Pencil,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { VaultEntry } from "@/lib/types";
import type { CategoryConfig } from "@/lib/config";
import { copyWithAutoClear } from "@/lib/clipboard";
import { PasswordLab } from "./PasswordLab";
import { useLocale } from "@/lib/i18n-context";
import { formatShortDateTime } from "@/lib/format-date";

type Mode = "view" | "edit" | "new";

interface EntryModalProps {
  open: boolean;
  mode: Mode;
  entry: VaultEntry | null;
  categories: CategoryConfig[];
  clipboardClearSeconds: number;
  clipboardEnabled?: boolean;
  onClose: () => void;
  onSave: (entry: VaultEntry) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

function emptyEntry(): VaultEntry {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `e-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: "",
    username: "",
    password: "",
    url: "",
    category: "other",
    notes: "",
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function EntryModal({
  open,
  mode: initialMode,
  entry,
  categories,
  clipboardClearSeconds,
  clipboardEnabled = true,
  onClose,
  onSave,
  onDelete,
}: EntryModalProps) {
  const { t, locale } = useLocale();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<VaultEntry>(() => entry || emptyEntry());
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync kun når modalen åpnes (ikke ved hver parent-render)
  // — bruker entry.id + open som stabile triggere, IKKE entry-referansen
  // for å unngå at "Rediger" flippes tilbake til "view".
  const entryId = entry?.id;
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setDraft(entry || emptyEntry());
    setShowPwd(false);
    setDeleteConfirm(false);
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const isView = mode === "view";
  const isEdit = mode === "edit" || mode === "new";
  const canSave =
    isEdit && draft.title.trim().length > 0 && draft.password.length > 0;

  const category = useMemo(
    () => categories.find((c) => c.key === draft.category),
    [categories, draft.category],
  );

  if (!open) return null;

  const copyField = async (value: string, label: string) => {
    if (!value) return;
    try {
      await copyWithAutoClear(
        value,
        clipboardClearSeconds,
        (success) => {
          if (success) {
            toast.info(`${label} ${t("toast.clipboard_cleared_suffix")}`);
          }
        },
      );
      toast.success(
        `${label} ${t("toast.copied_clear_in")} ${clipboardClearSeconds}s`,
      );
    } catch {
      toast.error(t("toast.copy_failed"));
    }
  };

  const handleSave = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      await onSave({ ...draft, updatedAt: now });
      toast.success(mode === "new" ? t("toast.entry_created") : t("toast.changes_saved"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.save_failed"));
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !entry || busy) return;
    setBusy(true);
    try {
      await onDelete(entry.id);
      toast.success(t("toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.delete_failed"));
      setBusy(false);
    }
  };

  return (
    <>
    <div
      data-testid="entry-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        className="w-full max-w-lg backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white max-h-[90vh] overflow-y-auto animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-white/10">
          <button
            data-testid="entry-favorite-toggle"
            type="button"
            onClick={() =>
              isEdit && setDraft({ ...draft, favorite: !draft.favorite })
            }
            disabled={!isEdit}
            className={`flex-shrink-0 p-2 rounded-lg transition ${
              draft.favorite
                ? "text-amber-300"
                : "text-white/40 hover:text-white/70"
            } ${isEdit ? "hover:bg-white/10" : ""}`}
            aria-label={draft.favorite ? t("entry.favorite_remove_aria") : t("entry.favorite_add_aria")}
          >
            <Star
              className="h-5 w-5"
              fill={draft.favorite ? "currentColor" : "none"}
            />
          </button>
          <div className="flex-1 min-w-0">
            {isEdit ? (
              <input
                data-testid="entry-title-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={t("entry.title_placeholder")}
                autoFocus={mode === "new"}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                spellCheck={false}
                className="w-full bg-transparent text-lg font-semibold tracking-tight text-white placeholder:text-white/30 focus:outline-none"
              />
            ) : (
              <h2 className="text-lg font-semibold tracking-tight truncate">
                {draft.title}
              </h2>
            )}
            {category && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                <span className="text-[11px] text-white/60">
                  {category.icon} {category.label}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isView && (
              <button
                data-testid="entry-edit-btn"
                type="button"
                onClick={() => setMode("edit")}
                className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition"
              >
                <Pencil className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
                {t("common.edit_button")}
              </button>
            )}
            <button
              data-testid="entry-close-btn"
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Brukernavn */}
          <Field label={t("entry.field_username_label")}>
            {isEdit ? (
              <input
                data-testid="entry-username-input"
                value={draft.username || ""}
                onChange={(e) =>
                  setDraft({ ...draft, username: e.target.value })
                }
                className={inputCls}
                placeholder={t("common.optional_placeholder")}
                type="text"
                name="kodo-vault-entry-handle"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-form-type="other"
                spellCheck={false}
              />
            ) : (
              <ReadOnlyRow
                testId="entry-username-value"
                value={draft.username}
                placeholder={t("common.em_dash")}
                onCopy={() => copyField(draft.username || "", t("common.label_username"))}
                showCopy={clipboardEnabled}
                copyAriaLabel={t("common.copy_aria")}
              />
            )}
          </Field>

          {/* Passord */}
          <Field label={t("entry.field_password_label")}>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  data-testid="entry-password-input"
                  type={showPwd ? "text" : "password"}
                  value={draft.password}
                  onChange={(e) =>
                    isEdit && setDraft({ ...draft, password: e.target.value })
                  }
                  readOnly={!isEdit}
                  name="kodo-vault-entry-secret"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore
                  data-form-type="other"
                  spellCheck={false}
                  className={`${inputCls} font-mono pr-20`}
                  placeholder={isEdit ? t("common.required_placeholder") : ""}
                />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
                  <button
                    type="button"
                    data-testid="entry-toggle-pwd"
                    onClick={() => setShowPwd((v) => !v)}
                    className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
                    aria-label={showPwd ? t("common.hide") : t("common.show")}
                  >
                    {showPwd ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                  {clipboardEnabled && (
                    <button
                      type="button"
                      data-testid="entry-copy-pwd"
                      onClick={() => copyField(draft.password, t("common.label_password"))}
                      className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
                      aria-label={t("entry.copy_password_aria")}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  )}
                  {isEdit && (
                    <button
                      type="button"
                      data-testid="entry-open-lab"
                      onClick={() => setLabOpen(true)}
                      className="p-1.5 rounded text-violet-300 hover:text-violet-200 hover:bg-white/10 transition"
                      aria-label={t("common.password_lab")}
                      title={t("header.password_lab_tooltip")}
                    >
                      <FlaskConical className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Field>

          {/* URL */}
          <Field label="URL">
            {isEdit ? (
              <input
                data-testid="entry-url-input"
                value={draft.url || ""}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                className={inputCls}
                placeholder="https://..."
                type="text"
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                spellCheck={false}
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm text-white/85 truncate">
                  {draft.url || <span className="text-white/30">{t("common.em_dash")}</span>}
                </span>
                {draft.url && (
                  <a
                    data-testid="entry-url-link"
                    href={
                      draft.url.startsWith("http")
                        ? draft.url
                        : `https://${draft.url}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
                    aria-label={t("entry.url_open_aria")}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            )}
          </Field>

          {/* Kategori */}
          <Field label={t("entry.field_category_label")}>
            {isEdit ? (
              <div className="relative">
                <select
                  data-testid="entry-category-select"
                  value={draft.category || "other"}
                  onChange={(e) =>
                    setDraft({ ...draft, category: e.target.value })
                  }
                  className={`${inputCls} appearance-none pr-9 cursor-pointer`}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key} className="bg-slate-900">
                      {c.icon} {c.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            ) : (
              <span className="text-sm text-white/85">
                {category ? `${category.icon} ${category.label}` : t("common.em_dash")}
              </span>
            )}
          </Field>

          {/* Notater */}
          <Field label={t("entry.field_notes_label")}>
            {isEdit ? (
              <textarea
                data-testid="entry-notes-input"
                value={draft.notes || ""}
                onChange={(e) =>
                  setDraft({ ...draft, notes: e.target.value })
                }
                rows={3}
                className={`${inputCls} resize-none`}
                placeholder={t("common.optional_placeholder")}
              />
            ) : (
              <div className="text-sm text-white/80 whitespace-pre-wrap min-h-[1.5rem]">
                {draft.notes || <span className="text-white/30">{t("common.em_dash")}</span>}
              </div>
            )}
          </Field>

          {/* Timestamps — kun i view */}
          {isView && (
            <div className="grid grid-cols-2 gap-3 pt-2 text-[10px] text-white/40">
              <div>
                <div className="uppercase tracking-wider">{t("entry.timestamp_created")}</div>
                <div>{formatShortDateTime(draft.createdAt, locale)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wider">{t("entry.timestamp_modified")}</div>
                <div>{formatShortDateTime(draft.updatedAt, locale)}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {isEdit && (
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-white/10 bg-white/5">
            {mode === "edit" && onDelete ? (
              !deleteConfirm ? (
                <button
                  data-testid="entry-delete-btn"
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 text-xs font-medium transition disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common.delete_button")}
                </button>
              ) : (
                <div className="flex items-center gap-2 text-[11px] text-rose-200">
                  <span>{t("common.are_you_sure")}</span>
                  <button
                    data-testid="entry-delete-confirm"
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="px-2.5 py-1 rounded bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-semibold transition"
                  >
                    {busy ? "..." : t("entry.delete_forever_confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(false)}
                    disabled={busy}
                    className="text-white/50 hover:text-white text-[11px] transition"
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              )
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-xs font-medium transition disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                data-testid="entry-save-btn"
                type="button"
                onClick={handleSave}
                disabled={!canSave || busy}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-white/5 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {mode === "new" ? t("entry.submit_new") : t("entry.submit_save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    <PasswordLab
      open={labOpen}
      initialTestPassword={draft.password}
      clipboardClearSeconds={clipboardClearSeconds}
      onClose={() => setLabOpen(false)}
      onUsePassword={(pwd) => setDraft({ ...draft, password: pwd })}
    />
    </>
  );
}

const inputCls =
  "w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-400/40";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-white/60 uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadOnlyRow({
  testId,
  value,
  placeholder,
  onCopy,
  showCopy = true,
  copyAriaLabel = "Kopier",
}: {
  testId: string;
  value?: string;
  placeholder: string;
  onCopy: () => void;
  showCopy?: boolean;
  copyAriaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        data-testid={testId}
        className="flex-1 text-sm text-white/85 truncate"
      >
        {value || <span className="text-white/30">{placeholder}</span>}
      </span>
      {value && showCopy && (
        <button
          type="button"
          onClick={onCopy}
          className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
          aria-label={copyAriaLabel}
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
