"use client";

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Pencil,
  Phone,
  PhoneCall,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";
import { translate } from "@/lib/i18n";
import type { CardType, VaultCard } from "@/lib/types";
import { copyWithAutoClear } from "@/lib/clipboard";
import { compressDataUrl } from "@/lib/image-compress";
import type { ImageConfig } from "@/lib/config";
import { CardCamera } from "./CardCamera";
import { CardCropper } from "./CardCropper";

type Mode = "view" | "edit" | "new";

interface CardModalProps {
  open: boolean;
  mode: Mode;
  card: VaultCard | null;
  clipboardClearSeconds: number;
  clipboardEnabled?: boolean;
  imageConfig: ImageConfig;
  onClose: () => void;
  onSave: (card: VaultCard) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const CARD_TYPE_LABELS: Record<CardType, string> = {
  credit: "Kreditt",
  debit: "Debet",
  virtual: "Virtuelt",
  reward: "Bonuskort",
};

const CARD_TYPE_COLORS: Record<CardType, string> = {
  credit: "#a78bfa", // violet-400
  debit: "#60a5fa", // blue-400
  virtual: "#22d3ee", // cyan-400
  reward: "#fbbf24", // amber-400
};

function emptyCard(): VaultCard {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title: "",
    cardType: "credit",
    cardNumber: "",
    holderName: "",
    expiryMonth: "",
    expiryYear: "",
    cvv: "",
    pin: "",
    issuer: "",
    customerServicePhone: "",
    customerServiceUrl: "",
    lostCardPhone: "",
    notes: "",
    favorite: false,
    rewardProgram: "",
    annualFee: "",
    createdAt: now,
    updatedAt: now,
  };
}

function formatCardNumber(num: string): string {
  // Group i 4 (eller 4-6-5 for AMEX-style 15-siffret)
  const clean = num.replace(/\s/g, "");
  if (clean.length === 15) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 10)} ${clean.slice(10)}`;
  }
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function maskCardNumber(num: string): string {
  const clean = num.replace(/\s/g, "");
  if (clean.length < 4) return clean;
  const last4 = clean.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

export function CardModal({
  open,
  mode: initialMode,
  card,
  clipboardClearSeconds,
  clipboardEnabled = true,
  imageConfig,
  onClose,
  onSave,
  onDelete,
}: CardModalProps) {
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<VaultCard>(() => card || emptyCard());
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraSide, setCameraSide] = useState<"front" | "back">("front");
  const [cropImageUrl, setCropImageUrl] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Sync state ved åpning — match EntryModal-mønsteret med stabile triggere
  const cardId = card?.id;
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setDraft(card || emptyCard());
    setShowCardNumber(false);
    setShowCvv(false);
    setShowPin(false);
    setDeleteConfirm(false);
    setCameraOpen(false);
    setCameraSide("front");
    setCropImageUrl(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cardId, initialMode]);

  if (!open) return null;

  const isViewing = mode === "view";
  const isEditing = mode === "edit" || mode === "new";

  const update = <K extends keyof VaultCard>(key: K, value: VaultCard[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const validate = (): string | null => {
    if (!draft.title.trim()) return t("card_modal.error_title_required");
    if (!draft.cardNumber.trim()) return t("card_modal.error_card_number_required");
    const clean = draft.cardNumber.replace(/\s/g, "");
    if (clean.length < 13 || clean.length > 19)
      return t("card_modal.error_card_number_length");
    if (!/^\d+$/.test(clean)) return t("card_modal.error_card_number_digits");
    if (!draft.holderName.trim()) return t("card_modal.error_holder_required");
    if (!/^\d{2}$/.test(draft.expiryMonth))
      return t("card_modal.error_month_format");
    const m = parseInt(draft.expiryMonth, 10);
    if (m < 1 || m > 12) return t("card_modal.error_month_range");
    if (!/^\d{4}$/.test(draft.expiryYear))
      return t("card_modal.error_year_format");
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const cleanNumber = draft.cardNumber.replace(/\s/g, "");
      const finalCard: VaultCard = {
        ...draft,
        cardNumber: cleanNumber,
        updatedAt: new Date().toISOString(),
      };
      await onSave(finalCard);
      toast.success(mode === "new" ? t("card_modal.toast_card_saved") : t("toast.changes_saved"));
      setMode("view");
      setDraft(finalCard);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("card_modal.toast_save_failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || !card) return;
    setBusy(true);
    try {
      await onDelete(card.id);
      toast.success(t("card_modal.toast_card_deleted"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("card_modal.toast_delete_failed"));
      setBusy(false);
    }
  };

  const handleCopy = async (value: string, label: string) => {
    if (!clipboardEnabled) return;
    if (!value) return;
    try {
      await copyWithAutoClear(value, clipboardClearSeconds);
      toast.success(
        `${label} ${t("card_modal.toast_copy_success_clear_suffix")} ${clipboardClearSeconds} ${t("card_modal.toast_copy_success_seconds_suffix")}`,
      );
    } catch {
      toast.error(`${t("card_modal.toast_copy_failed_prefix")} ${label}`);
    }
  };

  const applyCompressedPhoto = async (rawDataUrl: string) => {
    try {
      const result = await compressDataUrl(rawDataUrl, imageConfig);
      if (cameraSide === "front") {
        update("photoFront", result.dataUrl);
      } else {
        update("photoBack", result.dataUrl);
      }
      const reduced = Math.round((1 - result.ratio) * 100);
      const sizeKB = Math.round(result.outputBytes / 1024);
      toast.success(
        `${t("card_modal.toast_photo_saved_prefix")} · ${result.width}×${result.height} · ${sizeKB} KB (${reduced}${t("card_modal.toast_photo_saved_reduction_suffix")})`,
      );
    } catch (err) {
      // INGEN graceful fallback (D-001): hvis komprimering feiler skal brukeren
      // VITE det og kunne ta nytt bilde — ikke at vi stille lagrer en stor PNG
      // som fyller opp blob-en. Bedre å miste ett bilde enn å undergrave kvaliteten.
      toast.error(
        `${t("card_modal.compress_error_prefix")} ${err instanceof Error ? err.message : t("card_modal.compress_error_fallback")}`,
      );
    }
  };

  const cardColor = CARD_TYPE_COLORS[draft.cardType];

  return (
    <div
      data-testid="card-modal"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm overflow-y-auto py-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-zinc-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                backgroundColor: `${cardColor}22`,
                border: `1px solid ${cardColor}55`,
              }}
            >
              <CreditCard className="h-5 w-5" style={{ color: cardColor }} />
            </div>
            <div className="min-w-0 flex-1">
              {isViewing ? (
                <h3 className="text-base font-semibold text-white truncate flex items-center gap-1.5">
                  {draft.favorite && (
                    <Star
                      className="h-3.5 w-3.5 text-amber-300 flex-shrink-0"
                      fill="currentColor"
                    />
                  )}
                  <span className="truncate">{draft.title}</span>
                </h3>
              ) : (
                <input
                  data-testid="card-title-input"
                  type="text"
                  placeholder={t("card_modal.title_placeholder")}
                  value={draft.title}
                  onChange={(e) => update("title", e.target.value)}
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1 text-sm text-white outline-none"
                />
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ color: cardColor, backgroundColor: `${cardColor}18` }}
                >
                  {CARD_TYPE_LABELS[draft.cardType]}
                </span>
                {draft.issuer && (
                  <span className="text-[10px] text-white/45 truncate">
                    {draft.issuer}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            data-testid="card-modal-close-btn"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-md hover:bg-white/10 text-white/60 hover:text-white transition disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          {isEditing && (
            <>
              <Field label={t("card_modal.field_card_type")}>
                <div className="relative">
                  <select
                    data-testid="card-type-select"
                    value={draft.cardType}
                    onChange={(e) =>
                      update("cardType", e.target.value as CardType)
                    }
                    className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 pr-8 text-sm text-white outline-none appearance-none cursor-pointer"
                  >
                    {(Object.keys(CARD_TYPE_LABELS) as CardType[]).map((t) => (
                      <option key={t} value={t} className="bg-zinc-900">
                        {CARD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-white/55 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>
              </Field>
              <Field label={t("card_modal.field_issuer")}>
                <input
                  data-testid="card-issuer-input"
                  type="text"
                  placeholder={t("card_modal.field_issuer_placeholder")}
                  value={draft.issuer || ""}
                  onChange={(e) => update("issuer", e.target.value)}
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                />
              </Field>
            </>
          )}

          <Field label={t("card_modal.field_card_number")}>
            <SecretRow
              testId="card-number"
              value={
                isEditing
                  ? draft.cardNumber
                  : showCardNumber
                    ? formatCardNumber(draft.cardNumber)
                    : maskCardNumber(draft.cardNumber)
              }
              editing={isEditing}
              onChange={(v) =>
                update("cardNumber", v.replace(/[^\d\s]/g, ""))
              }
              placeholder="•••• •••• •••• ••••"
              onToggleVisible={() => setShowCardNumber((v) => !v)}
              visible={showCardNumber}
              onCopy={
                clipboardEnabled && !isEditing
                  ? () => handleCopy(draft.cardNumber, "Kortnummer")
                  : undefined
              }
              monospace
            />
          </Field>

          <Field label={t("card_modal.field_holder")}>
            {isEditing ? (
              <input
                data-testid="card-holder-input"
                type="text"
                placeholder={t("card_modal.field_holder_placeholder")}
                value={draft.holderName}
                onChange={(e) => update("holderName", e.target.value)}
                className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
              />
            ) : (
              <ReadValue value={draft.holderName} />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("card_modal.field_month")}>
              {isEditing ? (
                <input
                  data-testid="card-expiry-month-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  placeholder="09"
                  value={draft.expiryMonth}
                  onChange={(e) =>
                    update("expiryMonth", e.target.value.replace(/\D/g, ""))
                  }
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white font-mono outline-none"
                />
              ) : (
                <ReadValue value={draft.expiryMonth} mono />
              )}
            </Field>
            <Field label={t("card_modal.field_year")}>
              {isEditing ? (
                <input
                  data-testid="card-expiry-year-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="2027"
                  value={draft.expiryYear}
                  onChange={(e) =>
                    update("expiryYear", e.target.value.replace(/\D/g, ""))
                  }
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white font-mono outline-none"
                />
              ) : (
                <ReadValue value={draft.expiryYear} mono />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("card_modal.field_cvv")}>
              <SecretRow
                testId="card-cvv"
                value={
                  isEditing ? draft.cvv || "" : showCvv ? draft.cvv || "" : "•••"
                }
                editing={isEditing}
                onChange={(v) => update("cvv", v.replace(/\D/g, ""))}
                placeholder="123"
                maxLength={4}
                onToggleVisible={() => setShowCvv((v) => !v)}
                visible={showCvv}
                onCopy={
                  clipboardEnabled && !isEditing && draft.cvv
                    ? () => handleCopy(draft.cvv!, "CVV")
                    : undefined
                }
                monospace
              />
            </Field>
            <Field label={t("card_modal.field_pin")}>
              <SecretRow
                testId="card-pin"
                value={
                  isEditing ? draft.pin || "" : showPin ? draft.pin || "" : "••••"
                }
                editing={isEditing}
                onChange={(v) => update("pin", v.replace(/\D/g, ""))}
                placeholder="0000"
                maxLength={6}
                onToggleVisible={() => setShowPin((v) => !v)}
                visible={showPin}
                onCopy={
                  clipboardEnabled && !isEditing && draft.pin
                    ? () => handleCopy(draft.pin!, "PIN")
                    : undefined
                }
                monospace
              />
            </Field>
          </div>

          {/* Mist-kort-knapp — alltid synlig hvis satt (D-015) */}
          {(isEditing || draft.lostCardPhone) && (
            <Field label={t("card_modal.field_lost_phone")}>
              {isEditing ? (
                <input
                  data-testid="card-lost-phone-input"
                  type="tel"
                  placeholder="+47 22 96 00 00"
                  value={draft.lostCardPhone || ""}
                  onChange={(e) => update("lostCardPhone", e.target.value)}
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                />
              ) : (
                <a
                  data-testid="card-lost-phone-link"
                  href={`tel:${draft.lostCardPhone}`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-300/40 text-rose-100 text-xs font-semibold transition"
                >
                  <PhoneCall className="h-3.5 w-3.5" />
                  Ring tap-kort: {draft.lostCardPhone}
                </a>
              )}
            </Field>
          )}

          {/* Kundeservice tel + URL */}
          {(isEditing || draft.customerServicePhone) && (
            <Field label={t("card_modal.field_support_phone")}>
              {isEditing ? (
                <input
                  data-testid="card-cs-phone-input"
                  type="tel"
                  placeholder="+47 ..."
                  value={draft.customerServicePhone || ""}
                  onChange={(e) =>
                    update("customerServicePhone", e.target.value)
                  }
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                />
              ) : (
                <a
                  data-testid="card-cs-phone-link"
                  href={`tel:${draft.customerServicePhone}`}
                  className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 text-sm transition"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {draft.customerServicePhone}
                </a>
              )}
            </Field>
          )}
          {(isEditing || draft.customerServiceUrl) && (
            <Field label={t("card_modal.field_support_url")}>
              {isEditing ? (
                <input
                  data-testid="card-cs-url-input"
                  type="url"
                  placeholder="https://..."
                  value={draft.customerServiceUrl || ""}
                  onChange={(e) =>
                    update("customerServiceUrl", e.target.value)
                  }
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                />
              ) : (
                <a
                  data-testid="card-cs-url-link"
                  href={draft.customerServiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 text-sm transition truncate"
                >
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{draft.customerServiceUrl}</span>
                </a>
              )}
            </Field>
          )}

          {/* Bonusprogram + årsavgift */}
          {(isEditing || draft.rewardProgram || draft.annualFee) && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("card_modal.field_bonus")}>
                {isEditing ? (
                  <input
                    data-testid="card-reward-input"
                    type="text"
                    placeholder={t("card_modal.field_bonus_placeholder")}
                    value={draft.rewardProgram || ""}
                    onChange={(e) =>
                      update("rewardProgram", e.target.value)
                    }
                    className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                  />
                ) : (
                  <ReadValue value={draft.rewardProgram} />
                )}
              </Field>
              <Field label={t("card_modal.field_yearly_fee")}>
                {isEditing ? (
                  <input
                    data-testid="card-fee-input"
                    type="text"
                    placeholder="900 NOK/år"
                    value={draft.annualFee || ""}
                    onChange={(e) => update("annualFee", e.target.value)}
                    className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none"
                  />
                ) : (
                  <ReadValue value={draft.annualFee} />
                )}
              </Field>
            </div>
          )}

          {/* Notater */}
          {(isEditing || draft.notes) && (
            <Field label={t("card_modal.field_notes")}>
              {isEditing ? (
                <textarea
                  data-testid="card-notes-input"
                  placeholder={t("card_modal.field_notes_placeholder")}
                  value={draft.notes || ""}
                  onChange={(e) => update("notes", e.target.value)}
                  rows={3}
                  className="w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none resize-none"
                />
              ) : (
                <p className="text-sm text-white/85 whitespace-pre-wrap">
                  {draft.notes}
                </p>
              )}
            </Field>
          )}

          {/* Favoritt-toggle (kun edit/new) */}
          {isEditing && (
            <button
              data-testid="card-favorite-toggle"
              type="button"
              onClick={() => update("favorite", !draft.favorite)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition ${
                draft.favorite
                  ? "bg-amber-500/15 border-amber-300/40 text-amber-100"
                  : "bg-white/5 border-white/15 text-white/65 hover:text-white/85"
              }`}
            >
              <Star
                className="h-3.5 w-3.5"
                fill={draft.favorite ? "currentColor" : "none"}
              />
              {draft.favorite ? t("card_modal.favorite_label") : t("card_modal.favorite_add_label")}
            </button>
          )}

          {/* Foto-felt — Iter 3: capture-flow + preview. Iter 4: komprimering + faktisk lagring til blob */}
          {(isEditing || draft.photoFront || draft.photoBack) && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="block text-[10px] uppercase tracking-wide text-white/45 font-semibold">
                Foto av kort (valgfri)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <PhotoSlot
                  testId="card-photo-front"
                  side="Forside"
                  dataUrl={draft.photoFront}
                  editable={isEditing}
                  onCapture={() => {
                    setCameraSide("front");
                    setCameraOpen(true);
                  }}
                  onClear={() => update("photoFront", undefined)}
                />
                <PhotoSlot
                  testId="card-photo-back"
                  side="Bakside"
                  dataUrl={draft.photoBack}
                  editable={isEditing}
                  onCapture={() => {
                    setCameraSide("back");
                    setCameraOpen(true);
                  }}
                  onClear={() => update("photoBack", undefined)}
                />
              </div>
              {isEditing && (
                <p className="text-[10px] text-white/40 text-center pt-1 leading-relaxed">
                  📷 Bildet eksisterer KUN i kryptert blob (D-014). Aldri i Camera Roll.
                  <br />
                  ⚙️ Komprimeres til {imageConfig.maxWidth}×{imageConfig.maxHeight} {imageConfig.format === "image/jpeg" ? "JPEG" : "WEBP"} ({Math.round(imageConfig.quality * 100)}%).
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 border-t border-white/10">
          {isViewing && (
            <>
              {onDelete && (
                <button
                  data-testid="card-delete-btn"
                  onClick={() => setDeleteConfirm(true)}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-rose-500/15 border border-white/15 hover:border-rose-300/40 text-white/70 hover:text-rose-200 text-xs font-semibold transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Slett
                </button>
              )}
              <div className="flex-1" />
              <button
                data-testid="card-edit-btn"
                onClick={() => setMode("edit")}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition"
              >
                <Pencil className="h-3.5 w-3.5" />
                Rediger
              </button>
            </>
          )}
          {isEditing && (
            <>
              <button
                data-testid="card-cancel-btn"
                onClick={() => {
                  if (mode === "new") {
                    onClose();
                  } else {
                    setMode("view");
                    setDraft(card || emptyCard());
                  }
                }}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-xs font-semibold transition"
              >
                Avbryt
              </button>
              <div className="flex-1" />
              <button
                data-testid="card-save-btn"
                onClick={handleSave}
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Lagre
              </button>
            </>
          )}
        </div>

        {/* Delete confirm overlay */}
        {deleteConfirm && (
          <div
            data-testid="card-delete-confirm"
            className="absolute inset-0 z-10 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 bg-black/60 backdrop-blur-sm rounded-2xl"
          >
            <div className="w-full max-w-sm bg-zinc-900 border border-rose-300/30 rounded-xl p-4 shadow-2xl">
              <p className="text-sm text-white mb-3">
                Slette &ldquo;{draft.title}&rdquo;? Dette kan ikke angres.
              </p>
              <div className="flex gap-2">
                <button
                  data-testid="card-delete-cancel-btn"
                  onClick={() => setDeleteConfirm(false)}
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 text-xs font-semibold transition"
                >
                  Avbryt
                </button>
                <button
                  data-testid="card-delete-confirm-btn"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold transition disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Slett
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Camera-overlay — full-screen, separat z-index */}
      <CardCamera
        open={cameraOpen}
        label={cameraSide === "front" ? t("card_modal.camera_label_front") : t("card_modal.camera_label_back")}
        onClose={() => setCameraOpen(false)}
        onCapture={async (dataUrl) => {
          // Auto-cropped (fast path): komprimer per D-016 → lagre til draft
          await applyCompressedPhoto(dataUrl);
          setCameraOpen(false);
        }}
        onRequestFineTune={(fullDataUrl) => {
          // Manuell finjustering: lukk kamera, åpne CardCropper med full frame
          setCameraOpen(false);
          setCropImageUrl(fullDataUrl);
        }}
      />

      {/* Cropper-overlay — kommer kun ved "Finjuster utsnitt" fra kamera */}
      <CardCropper
        open={cropImageUrl !== null}
        imageDataUrl={cropImageUrl}
        label={
          cameraSide === "front"
            ? t("card_modal.cropper_label_front")
            : t("card_modal.cropper_label_back")
        }
        onCancel={() => setCropImageUrl(null)}
        onRetake={() => {
          // Tilbake til kamera for ny capture
          setCropImageUrl(null);
          setCameraOpen(true);
        }}
        onAccept={async (croppedDataUrl) => {
          await applyCompressedPhoto(croppedDataUrl);
          setCropImageUrl(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-komponenter
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-white/45 mb-1 font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

function ReadValue({
  value,
  mono,
}: {
  value?: string;
  mono?: boolean;
}) {
  if (!value)
    return <p className="text-sm text-white/40 italic">Ikke satt</p>;
  return (
    <p className={`text-sm text-white ${mono ? "font-mono" : ""} break-all`}>
      {value}
    </p>
  );
}

function PhotoSlot({
  testId,
  side,
  dataUrl,
  editable,
  onCapture,
  onClear,
}: {
  testId: string;
  side: string;
  dataUrl?: string;
  editable: boolean;
  onCapture: () => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const [lightbox, setLightbox] = useState(false);

  if (dataUrl) {
    return (
      <>
        <div
          data-testid={`${testId}-thumb`}
          className="relative aspect-[1.586/1] rounded-lg overflow-hidden bg-zinc-800 border border-white/15"
        >
          {/* Tapp-flate for å åpne full-skjerm */}
          <button
            type="button"
            data-testid={`${testId}-expand-btn`}
            onClick={() => setLightbox(true)}
            className="absolute inset-0 w-full h-full"
            aria-label={`Vis ${side} i full størrelse`}
          >
            <img
              src={dataUrl}
              alt={side}
              className="w-full h-full object-cover"
            />
          </button>

          {/* Side-label nederst */}
          <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/85 to-transparent text-[10px] text-white font-semibold pointer-events-none">
            {side}
          </div>

          {/* Action-knapper i hjørner — alltid synlige i edit-modus */}
          {editable && (
            <>
              <button
                type="button"
                data-testid={`${testId}-retake-btn`}
                onClick={onCapture}
                className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-black/65 hover:bg-blue-500 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white transition shadow-lg"
                title={t("card_modal.retake_tooltip")}
                aria-label={`Ta nytt bilde av ${side}`}
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                data-testid={`${testId}-clear-btn`}
                onClick={onClear}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/65 hover:bg-rose-500 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white transition shadow-lg"
                title={t("card_modal.delete_photo_tooltip")}
                aria-label={`Slett bilde av ${side}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {lightbox && (
          <div
            data-testid={`${testId}-lightbox`}
            className="fixed inset-0 z-[55] bg-black/95 flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setLightbox(false)}
          >
            <img
              src={dataUrl}
              alt={side}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              data-testid={`${testId}-lightbox-close-btn`}
              onClick={() => setLightbox(false)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/25 flex items-center justify-center text-white transition"
              aria-label={t("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs text-white font-semibold">
              {side}
            </div>
          </div>
        )}
      </>
    );
  }
  if (!editable) return null;
  return (
    <button
      type="button"
      data-testid={`${testId}-add-btn`}
      onClick={onCapture}
      className="aspect-[1.586/1] rounded-lg border-2 border-dashed border-white/20 hover:border-blue-300/60 hover:bg-blue-500/5 flex flex-col items-center justify-center gap-1.5 text-white/55 hover:text-blue-200 transition"
    >
      <Camera className="h-5 w-5" />
      <span className="text-[10px] font-semibold">{side}</span>
    </button>
  );
}

function SecretRow({
  testId,
  value,
  editing,
  onChange,
  placeholder,
  maxLength,
  onToggleVisible,
  visible,
  onCopy,
  monospace,
}: {
  testId: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  onToggleVisible: () => void;
  visible: boolean;
  onCopy?: () => void;
  monospace?: boolean;
}) {
  const { t } = useLocale();
  if (editing) {
    return (
      <input
        data-testid={`${testId}-input`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white/5 border border-white/15 focus:border-white/30 rounded-md px-2 py-1.5 text-sm text-white outline-none ${
          monospace ? "font-mono tracking-wider" : ""
        }`}
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span
        data-testid={`${testId}-value`}
        className={`flex-1 text-sm text-white ${monospace ? "font-mono tracking-wider" : ""} truncate`}
      >
        {value || "—"}
      </span>
      <button
        type="button"
        data-testid={`${testId}-toggle-btn`}
        onClick={onToggleVisible}
        className="p-1.5 rounded-md hover:bg-white/10 text-white/55 hover:text-white transition"
        title={visible ? t("card_modal.toggle_hide_value") : t("card_modal.toggle_show_value")}
      >
        {visible ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </button>
      {onCopy && (
        <button
          type="button"
          data-testid={`${testId}-copy-btn`}
          onClick={onCopy}
          className="p-1.5 rounded-md hover:bg-white/10 text-white/55 hover:text-white transition"
          title={t("common.copy_aria")}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
