"use client";

import { useEffect, useState } from "react";
import {
  BadgeCheck,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { IDS_THEME } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";
import { tHook } from "@/lib/i18n";
import { IdAttachmentDropZone } from "./IdAttachmentDropZone";
import { MAX_ATTACHMENTS_PER_ID } from "@/lib/ids-attachment";
import {
  exportImageWithWatermark,
  suggestedFilename,
  triggerDownload,
  WatermarkUnsupportedError,
} from "@/lib/ids-export";
import type {
  DriverId,
  HealthId,
  IdAttachment,
  IdCardId,
  IdKind,
  PassId,
  VaultId,
} from "@/lib/types";

type Mode = "view" | "edit" | "new";

interface IdModalProps {
  open: boolean;
  mode: Mode;
  id: VaultId | null;
  onClose: () => void;
  onSave: (id: VaultId) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const KIND_META: Record<
  IdKind,
  { labelKey: string; emoji: string; descKey: string }
> = {
  pass: { labelKey: "id_kind.pass_label", emoji: "🛂", descKey: "id_kind.pass_desc" },
  driver: { labelKey: "id_kind.driver_label", emoji: "🚗", descKey: "id_kind.driver_desc" },
  "id-card": { labelKey: "id_kind.id_card_label", emoji: "🆔", descKey: "id_kind.id_card_desc" },
  health: { labelKey: "id_kind.health_label", emoji: "🏥", descKey: "id_kind.health_desc" },
};

const KIND_ORDER: IdKind[] = ["pass", "driver", "id-card", "health"];

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `i-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Lag en tom ID av valgt type med fornuftige default-strings. */
function emptyId(kind: IdKind): VaultId {
  const now = new Date().toISOString();
  const base = {
    id: makeId(),
    title: "",
    favorite: false,
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  switch (kind) {
    case "pass":
      return {
        ...base,
        kind: "pass",
        nation: "Norge",
        passportNumber: "",
        expiryDate: "",
      };
    case "driver":
      return {
        ...base,
        kind: "driver",
        country: "Norge",
        licenseNumber: "",
        classes: ["B"],
        expiryDate: "",
      };
    case "id-card":
      return {
        ...base,
        kind: "id-card",
        type: "",
        issuer: "",
        number: "",
      };
    case "health":
      return {
        ...base,
        kind: "health",
        type: "Reiseforsikring",
        company: "",
        policyNumber: "",
        validTo: "",
      };
  }
}

/** Sjekk om alle påkrevde felter for typen er fylt ut. Bruker `tHook` siden
 * denne kalles fra event-handler (`handleSave`) som ikke trivielt kan motta
 * `t` fra useLocale-context. tHook leser aktiv locale fra localStorage. */
function validateRequired(d: VaultId): string | null {
  if (!d.title.trim()) return tHook("id_modal.error_title_required");
  switch (d.kind) {
    case "pass":
      if (!d.nation || !d.passportNumber || !d.expiryDate)
        return tHook("id_modal.error_pass_required");
      return null;
    case "driver":
      if (!d.country || !d.licenseNumber || d.classes.length === 0 || !d.expiryDate)
        return tHook("id_modal.error_driver_required");
      return null;
    case "id-card":
      if (!d.type || !d.issuer || !d.number)
        return tHook("id_modal.error_idcard_required");
      return null;
    case "health":
      if (!d.type || !d.company || !d.policyNumber || !d.validTo)
        return tHook("id_modal.error_health_required");
      return null;
  }
}

export function IdModal({
  open,
  mode: initialMode,
  id,
  onClose,
  onSave,
  onDelete,
}: IdModalProps) {
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<VaultId | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [viewer, setViewer] = useState<IdAttachment | null>(null);
  const [pickKindOpen, setPickKindOpen] = useState(false);

  // Reset state når modalen åpnes/lukkes
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setDraft(id);
      setBusy(false);
      setDeleteConfirm(false);
      setViewer(null);
      setPickKindOpen(initialMode === "new" && !id);
    }
  }, [open, initialMode, id]);

  if (!open) return null;

  // New-modus, ingen type valgt → vis type-velger
  if (mode === "new" && pickKindOpen) {
    return (
      <div
        data-testid="id-modal-kind-picker"
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-6 bg-[var(--kodo-card-bg,rgba(30,41,59,0.6))]"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <BadgeCheck className={`h-5 w-5 ${IDS_THEME.iconColor}`} />
              {t("id_modal.kind_picker_title")}
            </h3>
            <button
              data-testid="id-modal-kind-picker-close"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/70"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {KIND_ORDER.map((k) => {
              const meta = KIND_META[k];
              return (
                <button
                  key={k}
                  data-testid={`id-modal-pick-${k}`}
                  onClick={() => {
                    setDraft(emptyId(k));
                    setPickKindOpen(false);
                  }}
                  className={`text-left flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:${IDS_THEME.selectedBg} hover:${IDS_THEME.selectedBorder} transition`}
                >
                  <span className="text-2xl">{meta.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {t(meta.labelKey)}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {t(meta.descKey)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  const isView = mode === "view";
  const isEditing = mode === "edit" || mode === "new";
  const meta = KIND_META[draft.kind];

  const setField = (key: string, value: unknown) => {
    setDraft((prev) => (prev ? ({ ...prev, [key]: value } as VaultId) : prev));
  };

  const handleSave = async () => {
    if (!draft) return;
    const err = validateRequired(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const toSave: VaultId = { ...draft, updatedAt: new Date().toISOString() };
      await onSave(toSave);
      toast.success(mode === "new" ? t("id_modal.toast_id_created") : t("toast.changes_saved"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("id_modal.toast_save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!draft || !onDelete) return;
    setBusy(true);
    try {
      await onDelete(draft.id);
      toast.success(t("id_modal.toast_id_deleted"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("id_modal.toast_delete_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        data-testid="id-modal"
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg my-8 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl bg-[var(--kodo-card-bg,rgba(30,41,59,0.6))] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-2xl">{meta.emoji}</span>
              <h3 className="text-base font-semibold text-white truncate">
                {isView ? draft.title || t(meta.labelKey) : t(meta.labelKey)}
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              {isView && (
                <button
                  data-testid="id-modal-edit-btn"
                  onClick={() => setMode("edit")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${IDS_THEME.secondaryButton} transition`}
                  title={t("id_modal.edit_tooltip")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t("id_modal.edit_button")}
                </button>
              )}
              <button
                data-testid="id-modal-close-btn"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/70"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 px-5 py-5 space-y-4 overflow-y-auto max-h-[70vh]">
            {/* Tittel + favoritt */}
            <FieldGroup label={t("id_modal.field_title")} required>
              {isEditing ? (
                <input
                  data-testid="id-modal-title-input"
                  type="text"
                  value={draft.title}
                  onChange={(e) => setField("title", e.target.value)}
                  className={inputClass}
                  placeholder={`${t("id_modal.placeholder_example_prefix")} ${t(meta.labelKey)} ${draft.kind === "pass" ? "Norge" : draft.kind === "driver" ? "Norge" : ""}`}
                  autoFocus
                />
              ) : (
                <div className="text-sm text-white/90">{draft.title}</div>
              )}
            </FieldGroup>

            {/* Type-spesifikke felter */}
            {draft.kind === "pass" && (
              <PassFields draft={draft} setField={setField} isEditing={isEditing} />
            )}
            {draft.kind === "driver" && (
              <DriverFields draft={draft} setField={setField} isEditing={isEditing} />
            )}
            {draft.kind === "id-card" && (
              <IdCardFields draft={draft} setField={setField} isEditing={isEditing} />
            )}
            {draft.kind === "health" && (
              <HealthFields draft={draft} setField={setField} isEditing={isEditing} />
            )}

            {/* Vedlegg (0–3 bilder/PDF) */}
            <FieldGroup label={t("id_modal.field_attachments")}>
              <AttachmentsManager
                kind={draft.kind}
                parentId={draft}
                attachments={draft.attachments || []}
                isEditing={isEditing}
                onChange={(next) => setField("attachments", next)}
                onZoom={(att) => setViewer(att)}
              />
            </FieldGroup>

            {/* Notater */}
            <FieldGroup label={t("id_modal.field_notes")}>
              {isEditing ? (
                <textarea
                  data-testid="id-modal-notes-input"
                  value={draft.notes || ""}
                  onChange={(e) => setField("notes", e.target.value)}
                  className={`${inputClass} min-h-[80px] resize-y`}
                  placeholder={t("id_modal.notes_placeholder")}
                />
              ) : draft.notes ? (
                <div className="text-sm text-white/80 whitespace-pre-wrap">
                  {draft.notes}
                </div>
              ) : (
                <div className="text-xs text-white/45 italic">{t("id_modal.no_notes")}</div>
              )}
            </FieldGroup>

            {/* Favoritt */}
            {isEditing && (
              <label className="flex items-center gap-2 cursor-pointer text-sm text-white/80">
                <input
                  type="checkbox"
                  data-testid="id-modal-favorite-input"
                  checked={!!draft.favorite}
                  onChange={(e) => setField("favorite", e.target.checked)}
                  className="accent-amber-400"
                />
                <Star className="h-3.5 w-3.5 text-amber-300" />
                {t("id_modal.favorite_label")}
              </label>
            )}
          </div>

          {/* Footer / actions */}
          <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-white/10">
            {isEditing && mode === "edit" && onDelete && !deleteConfirm && (
              <button
                data-testid="id-modal-delete-btn"
                onClick={() => setDeleteConfirm(true)}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-300/40 text-rose-100 flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("id_modal.delete_id_button")}
              </button>
            )}
            {deleteConfirm && (
              <div className="flex items-center gap-2 text-xs text-rose-200">
                <span>{t("id_modal.delete_confirm_question")}</span>
                <button
                  data-testid="id-modal-delete-confirm-btn"
                  onClick={handleDelete}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-semibold transition disabled:opacity-50"
                >
                  {t("id_modal.delete_confirm_button")}
                </button>
                <button
                  onClick={() => setDeleteConfirm(false)}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/85 font-semibold transition disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            )}
            <div className="flex-1" />
            {isEditing && !deleteConfirm && (
              <button
                data-testid="id-modal-save-btn"
                onClick={handleSave}
                disabled={busy}
                className={`px-4 py-2 rounded-lg ${IDS_THEME.primaryButton} text-white text-sm font-semibold flex items-center gap-1.5 shadow transition disabled:opacity-50`}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {mode === "new" ? t("id_modal.submit_new") : t("id_modal.submit_save")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Full-screen attachment viewer */}
      {viewer && <AttachmentViewer attachment={viewer} onClose={() => setViewer(null)} />}
    </>
  );
}

// ===== Sub-komponenter ======================================================

const inputClass =
  "w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-sm text-white placeholder-white/30 focus:outline-none focus:border-orange-300/60 transition";

function FieldGroup({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-white/55 flex items-center gap-1">
        {label}
        {required && <span className="text-rose-300">*</span>}
      </label>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  isEditing,
  required,
  placeholder,
  testId,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isEditing: boolean;
  required?: boolean;
  placeholder?: string;
  testId: string;
  type?: string;
}) {
  const { t } = useLocale();
  return (
    <FieldGroup label={label} required={required}>
      {isEditing ? (
        <input
          data-testid={testId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder={placeholder}
        />
      ) : value ? (
        <div className="text-sm text-white/90 font-mono">{value}</div>
      ) : (
        <div className="text-xs text-white/45 italic">{t("common.em_dash")}</div>
      )}
    </FieldGroup>
  );
}

function PassFields({
  draft,
  setField,
  isEditing,
}: {
  draft: PassId;
  setField: (k: string, v: unknown) => void;
  isEditing: boolean;
}) {
  const { t } = useLocale();
  // Pass i Norge (og de fleste land) er gyldig i 10 år for voksne.
  // Når brukeren skriver utstedelsesdato og utløp er tom, auto-fyller vi +10 år.
  // Hvis brukeren senere endrer utløp manuelt, respekterer vi det (vi sjekker
  // kun BEFORE-state).
  const handleIssuedChange = (v: string) => {
    setField("issuedDate", v);
    if (v && !draft.expiryDate) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        d.setFullYear(d.getFullYear() + 10);
        setField("expiryDate", d.toISOString().slice(0, 10));
      }
    }
  };
  return (
    <>
      <Field label={t("id_modal.field_nation")} value={draft.nation} required isEditing={isEditing}
        onChange={(v) => setField("nation", v)} testId="id-modal-pass-nation" placeholder={t("id_modal.field_nation_placeholder")} />
      <Field label={t("id_modal.field_passport_number")} value={draft.passportNumber} required isEditing={isEditing}
        onChange={(v) => setField("passportNumber", v)} testId="id-modal-pass-number" placeholder="C12345678" />
      <Field label={t("id_modal.field_issued_by")} value={draft.issuedBy || ""} isEditing={isEditing}
        onChange={(v) => setField("issuedBy", v)} testId="id-modal-pass-issuedby" placeholder={t("id_modal.field_issued_by_placeholder")} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("id_modal.field_issued")} value={draft.issuedDate || ""} isEditing={isEditing}
          onChange={handleIssuedChange} testId="id-modal-pass-issued" type="date" />
        <Field label={t("id_modal.field_expiry")} value={draft.expiryDate} required isEditing={isEditing}
          onChange={(v) => setField("expiryDate", v)} testId="id-modal-pass-expiry" type="date" />
      </div>
      {isEditing && (
        <p className="text-[10px] text-white/40 -mt-1.5 px-0.5">
          💡 Pass er normalt gyldig i 10 år — utløp fylles automatisk når du
          skriver utstedelsesdato (kan overstyres manuelt).
        </p>
      )}
    </>
  );
}

function DriverFields({
  draft,
  setField,
  isEditing,
}: {
  draft: DriverId;
  setField: (k: string, v: unknown) => void;
  isEditing: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <Field label={t("id_modal.field_country")} value={draft.country} required isEditing={isEditing}
        onChange={(v) => setField("country", v)} testId="id-modal-driver-country" placeholder={t("id_modal.field_country_placeholder")} />
      <Field label={t("id_modal.field_license_number")} value={draft.licenseNumber} required isEditing={isEditing}
        onChange={(v) => setField("licenseNumber", v)} testId="id-modal-driver-number" placeholder="12345 67890" />
      <FieldGroup label={t("id_modal.field_classes")} required>
        {isEditing ? (
          <input
            data-testid="id-modal-driver-classes"
            type="text"
            value={draft.classes.join(", ")}
            onChange={(e) =>
              setField(
                "classes",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            className={inputClass}
            placeholder={t("id_modal.field_classes_placeholder")}
          />
        ) : (
          <div className="text-sm text-white/90 font-mono">
            {draft.classes.join(", ") || t("common.em_dash")}
          </div>
        )}
      </FieldGroup>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("id_modal.field_issued")} value={draft.issuedDate || ""} isEditing={isEditing}
          onChange={(v) => setField("issuedDate", v)} testId="id-modal-driver-issued" type="date" />
        <Field label={t("id_modal.field_expiry")} value={draft.expiryDate} required isEditing={isEditing}
          onChange={(v) => setField("expiryDate", v)} testId="id-modal-driver-expiry" type="date" />
      </div>
    </>
  );
}

function IdCardFields({
  draft,
  setField,
  isEditing,
}: {
  draft: IdCardId;
  setField: (k: string, v: unknown) => void;
  isEditing: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <Field label={t("id_modal.field_type")} value={draft.type} required isEditing={isEditing}
        onChange={(v) => setField("type", v)} testId="id-modal-idcard-type"
        placeholder={t("id_modal.field_idcard_type_placeholder")} />
      <Field label={t("id_modal.field_issuer")} value={draft.issuer} required isEditing={isEditing}
        onChange={(v) => setField("issuer", v)} testId="id-modal-idcard-issuer" placeholder={t("id_modal.field_issuer_placeholder")} />
      <Field label={t("id_modal.field_number")} value={draft.number} required isEditing={isEditing}
        onChange={(v) => setField("number", v)} testId="id-modal-idcard-number" placeholder="12345678" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("id_modal.field_issued")} value={draft.issuedDate || ""} isEditing={isEditing}
          onChange={(v) => setField("issuedDate", v)} testId="id-modal-idcard-issued" type="date" />
        <Field label={t("id_modal.field_expiry_optional")} value={draft.expiryDate || ""} isEditing={isEditing}
          onChange={(v) => setField("expiryDate", v)} testId="id-modal-idcard-expiry" type="date" />
      </div>
    </>
  );
}

function HealthFields({
  draft,
  setField,
  isEditing,
}: {
  draft: HealthId;
  setField: (k: string, v: unknown) => void;
  isEditing: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <Field label={t("id_modal.field_type")} value={draft.type} required isEditing={isEditing}
        onChange={(v) => setField("type", v)} testId="id-modal-health-type"
        placeholder={t("id_modal.field_health_type_placeholder")} />
      <Field label={t("id_modal.field_company")} value={draft.company} required isEditing={isEditing}
        onChange={(v) => setField("company", v)} testId="id-modal-health-company" placeholder={t("id_modal.field_company_placeholder")} />
      <Field label={t("id_modal.field_policy_number")} value={draft.policyNumber} required isEditing={isEditing}
        onChange={(v) => setField("policyNumber", v)} testId="id-modal-health-policy" placeholder="12345-67-890" />
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("id_modal.field_contact_phone")} value={draft.contactPhone || ""} isEditing={isEditing}
          onChange={(v) => setField("contactPhone", v)} testId="id-modal-health-phone" placeholder="+47 21 49 24 00" />
        <Field label={t("id_modal.field_contact_email")} value={draft.contactEmail || ""} isEditing={isEditing}
          onChange={(v) => setField("contactEmail", v)} testId="id-modal-health-email"
          type="email" placeholder="skade@if.no" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("id_modal.field_valid_from")} value={draft.validFrom || ""} isEditing={isEditing}
          onChange={(v) => setField("validFrom", v)} testId="id-modal-health-validfrom" type="date" />
        <Field label={t("id_modal.field_valid_to")} value={draft.validTo} required isEditing={isEditing}
          onChange={(v) => setField("validTo", v)} testId="id-modal-health-validto" type="date" />
      </div>
    </>
  );
}

function AttachmentsManager({
  kind,
  parentId,
  attachments,
  isEditing,
  onChange,
  onZoom,
}: {
  kind: IdKind;
  parentId: VaultId;
  attachments: IdAttachment[];
  isEditing: boolean;
  onChange: (next: IdAttachment[]) => void;
  onZoom: (att: IdAttachment) => void;
}) {
  const { t } = useLocale();
  // Hooks MÅ være øverst (Rules of Hooks).
  const [pendingSlot, setPendingSlot] = useState(false);

  if (!isEditing) {
    if (attachments.length === 0) {
      return <div className="text-xs text-white/45 italic">{t("id_modal.no_attachments")}</div>;
    }
    return (
      <div className="space-y-2">
        {attachments.map((att, idx) => (
          <AttachmentPreview
            key={idx}
            index={idx}
            total={attachments.length}
            attachment={att}
            parentId={parentId}
            onZoom={() => onZoom(att)}
          />
        ))}
      </div>
    );
  }

  const canAdd = attachments.length < MAX_ATTACHMENTS_PER_ID;
  const setAt = (idx: number, next: IdAttachment | undefined) => {
    if (next === undefined) {
      onChange(attachments.filter((_, i) => i !== idx));
    } else {
      const arr = [...attachments];
      arr[idx] = next;
      onChange(arr);
    }
  };

  return (
    <div className="space-y-2">
      {attachments.map((att, idx) => (
        <IdAttachmentDropZone
          key={`att-${idx}`}
          kind={kind}
          label={`${t("id_modal.attachment_label_prefix")} ${idx + 1}/${MAX_ATTACHMENTS_PER_ID}`}
          current={att}
          onChange={(next) => setAt(idx, next)}
        />
      ))}
      {pendingSlot && canAdd && (
        <IdAttachmentDropZone
          key={`att-new-${attachments.length}`}
          kind={kind}
          label={`${t("id_modal.attachment_label_prefix")} ${attachments.length + 1}/${MAX_ATTACHMENTS_PER_ID}`}
          current={undefined}
          onChange={(next) => {
            if (next) {
              onChange([...attachments, next]);
            }
            setPendingSlot(false);
          }}
        />
      )}
      {canAdd && !pendingSlot && (
        <button
          type="button"
          data-testid="id-modal-attachments-add-btn"
          onClick={() => setPendingSlot(true)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-white/20 ${IDS_THEME.accentText} hover:bg-white/5 transition text-xs font-semibold`}
        >
          <Plus className="h-3.5 w-3.5" />
          {attachments.length === 0
            ? t("id_modal.add_attachment_first")
            : `${t("id_modal.add_attachment_more_prefix")}${attachments.length}/${MAX_ATTACHMENTS_PER_ID})`}
        </button>
      )}
      {!canAdd && (
        <p className="text-[10px] text-white/40 text-center">
          {t("id_modal.max_attachments_note_prefix")} {MAX_ATTACHMENTS_PER_ID} {t("id_modal.max_attachments_note_suffix")}
        </p>
      )}
    </div>
  );
}

function AttachmentPreview({
  attachment,
  onZoom,
  index,
  total,
  parentId,
}: {
  attachment: IdAttachment;
  onZoom: () => void;
  index?: number;
  total?: number;
  /** Brukes til å bygge filnavn ved vannmerke-eksport. */
  parentId?: VaultId;
}) {
  const { t } = useLocale();
  const isPdf = attachment.mime === "application/pdf";
  const sizeKb = (attachment.bytes / 1024).toFixed(0);
  const [exporting, setExporting] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation(); // ikke åpne viewer
    if (isPdf || !parentId) return;
    setExporting(true);
    try {
      const blob = await exportImageWithWatermark(attachment);
      triggerDownload(blob, suggestedFilename(parentId));
      toast.success(t("id_modal.toast_export_success"));
    } catch (err) {
      if (err instanceof WatermarkUnsupportedError) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : t("id_modal.toast_export_failed"));
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      data-testid={
        index !== undefined
          ? `id-modal-attachment-row-${index}`
          : "id-modal-attachment-row"
      }
      className={`rounded-xl border ${IDS_THEME.selectedBorder} ${IDS_THEME.selectedBg} flex items-center gap-3 overflow-hidden`}
    >
      <button
        type="button"
        data-testid={
          index !== undefined
            ? `id-modal-attachment-preview-${index}`
            : "id-modal-attachment-preview"
        }
        onClick={onZoom}
        className="flex-1 flex items-center gap-3 p-3 hover:brightness-110 transition text-left group min-w-0"
      >
        <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-black/30 border border-white/10 overflow-hidden flex items-center justify-center relative">
          {isPdf ? (
            <FileText className={`h-8 w-8 ${IDS_THEME.iconColor}`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${attachment.mime};base64,${attachment.data}`}
              alt={t("id_modal.attachment_alt")}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
            <ZoomIn className="h-5 w-5 text-white" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-white/90 text-sm font-medium truncate">
            {isPdf ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            <span className="truncate">{attachment.name || (isPdf ? t("id_modal.attachment_pdf_label") : t("id_modal.attachment_image_label"))}</span>
            {total !== undefined && total > 1 && (
              <span className="ml-auto text-[10px] font-mono text-white/40">
                {(index ?? 0) + 1}/{total}
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/50 mt-0.5">
            {sizeKb} KB · {isPdf ? "PDF" : attachment.mime.replace("image/", "")}
          </div>
        </div>
      </button>
      {parentId && (
        <button
          type="button"
          data-testid={
            index !== undefined
              ? `id-modal-attachment-download-${index}`
              : "id-modal-attachment-download"
          }
          onClick={handleDownload}
          disabled={isPdf || exporting}
          className={`flex-shrink-0 mr-3 p-2 rounded-lg ${IDS_THEME.accentOutlineButton} text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5`}
          title={
            isPdf
              ? t("id_modal.export_pdf_disabled")
              : t("id_modal.export_button_title")
          }
        >
          {exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span className="hidden sm:inline">KOPI</span>
        </button>
      )}
    </div>
  );
}

function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: IdAttachment;
  onClose: () => void;
}) {
  const { t } = useLocale();
  // Esc-lukking
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPdf = attachment.mime === "application/pdf";
  const src = `data:${attachment.mime};base64,${attachment.data}`;

  return (
    <div
      data-testid="id-attachment-viewer"
      className="fixed inset-0 z-[70] bg-black/95 flex flex-col"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-white text-sm">
          {isPdf ? <FileText className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
          <span className="truncate max-w-[60vw]">
            {attachment.name || (isPdf ? t("id_modal.attachment_pdf_label") : t("id_modal.attachment_image_full_label"))}
          </span>
        </div>
        <button
          data-testid="id-attachment-viewer-close"
          onClick={onClose}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/15 text-white"
          aria-label={t("id_modal.viewer_close_aria")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        className="flex-1 flex items-center justify-center overflow-auto"
        onClick={(e) => e.stopPropagation()}
        style={{ touchAction: "pinch-zoom" }}
      >
        {isPdf ? (
          <iframe
            data-testid="id-attachment-viewer-pdf"
            src={src}
            className="w-full h-full border-0"
            title={attachment.name || t("id_modal.attachment_pdf_label")}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            data-testid="id-attachment-viewer-image"
            src={src}
            alt={attachment.name || t("id_modal.attachment_image_full_label")}
            className="max-w-full max-h-full object-contain select-none"
          />
        )}
      </div>
    </div>
  );
}
