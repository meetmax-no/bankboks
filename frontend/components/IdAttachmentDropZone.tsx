"use client";

import { useCallback, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { IDS_THEME } from "@/lib/feature-theme";
import {
  AttachmentEmptyError,
  AttachmentTooLargeError,
  AttachmentUnsupportedError,
  processAttachmentFile,
  processAttachmentFromCamera,
} from "@/lib/ids-attachment";
import type { IdAttachment, IdKind } from "@/lib/types";
import { CardCamera, type CameraAspectMode } from "./CardCamera";
import { CardCropper } from "./CardCropper";
import { useLocale } from "@/lib/i18n-context";

interface IdAttachmentDropZoneProps {
  /** ID-typen styrer kamera-aspect-mode (pass → portrait, andre → landscape). */
  kind: IdKind;
  /** Eksisterende vedlegg (hvis ID redigeres). */
  current?: IdAttachment;
  /** Kalles når et nytt vedlegg er prosessert ferdig. */
  onChange: (attachment: IdAttachment | undefined) => void;
  /** Valgfri label-prefix (f.eks. "Vedlegg 1/3"). Vises i drop-zone-header. */
  label?: string;
}

/** Map ID-kind til kamera-aspect (Spec §4.5). */
function aspectForKind(kind: IdKind): CameraAspectMode {
  return kind === "pass" ? "passport" : "id-1";
}

/**
 * Samlet vedleggs-UI for v4.1 ID-er. Tilbyr 3 kilder (Spec §4.4):
 *   1. Fil-picker (primær, alle plattformer)
 *   2. Kamera-flow (med per-type aspect-guide)
 *   3. Drag-and-drop (desktop)
 *
 * Validerer + komprimerer via `lib/ids-attachment.ts`. Viser feilmeldinger
 * inline. Bruker IDS_THEME (orange) per D-031 / B-modellen.
 */
export function IdAttachmentDropZone({
  kind,
  current,
  onChange,
  label,
}: IdAttachmentDropZoneProps) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropperImage, setCropperImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const aspectMode = aspectForKind(kind);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const att = await processAttachmentFile(file);
        onChange(att);
      } catch (err) {
        if (err instanceof AttachmentTooLargeError) {
          setError(err.message);
        } else if (err instanceof AttachmentUnsupportedError) {
          setError(err.message);
        } else if (err instanceof AttachmentEmptyError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : t("id_attachment.error_unknown"));
        }
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const handleFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await handleFile(file);
      // Reset så samme fil kan velges igjen senere
      e.target.value = "";
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) await handleFile(file);
    },
    [handleFile],
  );

  const handleCameraCapture = useCallback(
    async (dataUrl: string) => {
      setCameraOpen(false);
      setBusy(true);
      setError(null);
      try {
        const att = await processAttachmentFromCamera(dataUrl);
        onChange(att);
      } catch (err) {
        if (err instanceof AttachmentTooLargeError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : t("id_attachment.error_unknown"));
        }
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const handleCameraFineTune = useCallback((fullDataUrl: string) => {
    setCameraOpen(false);
    setCropperImage(fullDataUrl);
  }, []);

  const handleCropperAccept = useCallback(
    async (croppedDataUrl: string) => {
      setCropperImage(null);
      setBusy(true);
      setError(null);
      try {
        const att = await processAttachmentFromCamera(croppedDataUrl);
        onChange(att);
      } catch (err) {
        if (err instanceof AttachmentTooLargeError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : t("id_attachment.error_unknown"));
        }
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  const handleRemove = useCallback(() => {
    setError(null);
    onChange(undefined);
  }, [onChange]);

  // ----- Hvis vedlegg er satt: vis preview + erstatt/fjern --------------
  if (current && !busy) {
    const isPdf = current.mime === "application/pdf";
    const sizeKb = (current.bytes / 1024).toFixed(0);
    return (
      <div className="space-y-1.5">
        {label && (
          <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold">
            {label}
          </p>
        )}
        <div
          data-testid="id-attachment-current"
          className={`rounded-xl border ${IDS_THEME.selectedBorder} ${IDS_THEME.selectedBg} p-3 flex items-center gap-3`}
        >
        <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-black/30 border border-white/10 overflow-hidden flex items-center justify-center">
          {isPdf ? (
            <FileText className={`h-8 w-8 ${IDS_THEME.iconColor}`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${current.mime};base64,${current.data}`}
              alt="Vedlegg"
              className="w-full h-full object-cover"
              data-testid="id-attachment-thumbnail"
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-white/90 text-sm font-medium truncate">
            {isPdf ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            <span className="truncate">{current.name || (isPdf ? "PDF-vedlegg" : "Bilde")}</span>
          </div>
          <div className="text-[11px] text-white/50 mt-0.5">
            {sizeKb} KB · {isPdf ? "PDF" : current.mime.replace("image/", "")}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <button
            type="button"
            onClick={handleFilePicker}
            data-testid="id-attachment-replace-btn"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${IDS_THEME.secondaryButton} transition`}
            title={t("id_attachment.replace_title")}
          >
            Erstatt
          </button>
          <button
            type="button"
            onClick={handleRemove}
            data-testid="id-attachment-remove-btn"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-300/40 text-rose-100 transition flex items-center gap-1.5"
            title={t("id_attachment.remove_title")}
          >
            <Trash2 className="h-3 w-3" />
            Fjern
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileInputChange}
          data-testid="id-attachment-file-input"
        />
        </div>
      </div>
    );
  }

  // ----- Tomt: vis drop-zone + 2 knapper -------------------------------------
  return (
    <>
      {label && (
        <p className="text-[10px] uppercase tracking-wider text-white/40 font-semibold mb-1.5">
          {label}
        </p>
      )}
      <div
        data-testid="id-attachment-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-5 transition ${
          dragOver
            ? `${IDS_THEME.selectedBorder} ${IDS_THEME.selectedBg}`
            : "border-white/15 bg-white/[0.03]"
        }`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 py-3 text-white/70">
            <Loader2 className={`h-5 w-5 animate-spin ${IDS_THEME.spinnerColor}`} />
            <span className="text-xs">Komprimerer vedlegg ...</span>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 mb-4">
              <Upload className={`h-6 w-6 ${IDS_THEME.iconColor}`} />
              <p className="text-sm text-white/80 text-center">
                Dra fil hit, eller velg under
              </p>
              <p className="text-[11px] text-white/40 text-center">
                JPEG · PNG · WebP · HEIC · PDF · maks 1 MB
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                type="button"
                onClick={handleFilePicker}
                data-testid="id-attachment-pick-file-btn"
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg ${IDS_THEME.primaryButton} text-white text-sm font-semibold transition`}
              >
                <Upload className="h-4 w-4" />
                Velg fil
              </button>
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                data-testid="id-attachment-camera-btn"
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg ${IDS_THEME.secondaryButton} text-white text-sm font-semibold transition`}
              >
                <Camera className="h-4 w-4" />
                Ta bilde
              </button>
            </div>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFileInputChange}
          data-testid="id-attachment-file-input"
        />
      </div>
      {error && (
        <div
          data-testid="id-attachment-error"
          className="mt-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100"
        >
          {error}
        </div>
      )}

      {/* Kamera-modal — orange-tema, riktig aspect for ID-typen */}
      <CardCamera
        open={cameraOpen}
        label={kind === "pass" ? t("id_attachment.camera_label_passport") : t("id_attachment.camera_label_id")}
        aspectMode={aspectMode}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCameraCapture}
        onRequestFineTune={handleCameraFineTune}
        theme={IDS_THEME}
      />

      {/* Cropper-modal — orange-tema */}
      <CardCropper
        open={cropperImage !== null}
        imageDataUrl={cropperImage}
        label={t("id_attachment.crop_label")}
        aspectMode={aspectMode}
        onCancel={() => setCropperImage(null)}
        onRetake={() => {
          setCropperImage(null);
          setCameraOpen(true);
        }}
        onAccept={handleCropperAccept}
        theme={IDS_THEME}
      />
    </>
  );
}
