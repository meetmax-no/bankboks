"use client";

import { useEffect, useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import { Check, Loader2, Lock, LockOpen, RotateCcw, X } from "lucide-react";
import "react-image-crop/dist/ReactCrop.css";
import { PRIMARY_THEME, type FeatureTheme } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";

// CR80 — internasjonal kort-standard. 1.586:1 aspekt.
const CR80_ASPECT = 85.6 / 53.98;
// Passport — ICAO 9303 ~1.42:1 portrait (åpen oppslag). v4.1 §4.5.
const PASSPORT_ASPECT = 125 / 88;

/** Aspect-mode: speil av CardCamera. "id-1" = landscape, "passport" = portrait. */
export type CropperAspectMode = "id-1" | "passport";

interface CardCropperProps {
  open: boolean;
  /** Full ukomprimert frame fra CardCamera */
  imageDataUrl: string | null;
  label?: string;
  onCancel: () => void;
  /** Tilbake til kamera for nytt bilde */
  onRetake: () => void;
  /** Returnerer det manuelt beskårne PNG-bildet */
  onAccept: (croppedDataUrl: string) => void;
  /** Aspect-mode for låst beskjæring. Default "id-1". */
  aspectMode?: CropperAspectMode;
  /** Feature-tema. Default `PRIMARY_THEME` (blå) for cards-kompatibilitet. */
  theme?: FeatureTheme;
}

/**
 * Manuell beskjæring av kort-bilde (Iter 3.5).
 *
 * Sikkerhet (D-014/D-001):
 * - Bildet eksisterer KUN i React state og en lokal canvas
 * - react-image-crop velger BARE koordinater — selve pixel-arbeidet skjer i vår
 *   egen canvas, så biblioteket har aldri eierskap til pixel-data
 * - Ingen filsystem, ingen Camera Roll, ingen ekstern API
 * - Bildet forsvinner ved unmount eller cancel
 */
export function CardCropper({
  open,
  imageDataUrl,
  label,
  onCancel,
  onRetake,
  onAccept,
  aspectMode = "id-1",
  theme = PRIMARY_THEME,
}: CardCropperProps) {
  const { t } = useLocale();
  const effectiveLabel = label ?? t("card_cropper.title_default");
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [aspectLocked, setAspectLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Aspect for låst beskjæring. id-1 = landscape, passport = portrait.
  const targetAspect =
    aspectMode === "passport" ? 1 / PASSPORT_ASPECT : CR80_ASPECT;
  const lockLabel = aspectMode === "passport" ? "Pass-format" : "CR80";

  // Reset state ved åpning
  useEffect(() => {
    if (open) {
      setCrop(undefined);
      setCompletedCrop(null);
      setAspectLocked(false);
      setBusy(false);
    }
  }, [open, imageDataUrl]);

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initial = centerCrop(
      makeAspectCrop(
        {
          unit: "%",
          width: 88,
        },
        targetAspect,
        width,
        height,
      ),
      width,
      height,
    );
    setCrop(initial);
  };

  const handleAspectToggle = () => {
    setAspectLocked((prev) => {
      const next = !prev;
      // Når vi går FRA fri TIL låst: snap eksisterende crop til target-aspekt
      if (next && imgRef.current && crop) {
        const { width, height } = imgRef.current;
        const snapped = centerCrop(
          makeAspectCrop(
            { unit: "%", width: 88 },
            targetAspect,
            width,
            height,
          ),
          width,
          height,
        );
        setCrop(snapped);
      }
      return next;
    });
  };

  const handleAccept = async () => {
    const image = imgRef.current;
    if (!image || !completedCrop) return;
    if (!completedCrop.width || !completedCrop.height) return;

    setBusy(true);
    try {
      // react-image-crop gir display-pixels. Skaler til natural for canvas.
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(completedCrop.width * scaleX);
      canvas.height = Math.round(completedCrop.height * scaleY);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setBusy(false);
        return;
      }

      ctx.drawImage(
        image,
        completedCrop.x * scaleX,
        completedCrop.y * scaleY,
        completedCrop.width * scaleX,
        completedCrop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      const dataUrl = canvas.toDataURL("image/png");
      onAccept(dataUrl);
    } finally {
      setBusy(false);
    }
  };

  if (!open || !imageDataUrl) return null;

  return (
    <div
      data-testid="card-cropper"
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-black/70 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-2 text-white">
          <span className="text-sm font-semibold">{effectiveLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            data-testid="card-cropper-aspect-toggle"
            onClick={handleAspectToggle}
            className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition ${
              aspectLocked
                ? theme.toggleActive
                : "bg-white/10 border-white/20 text-white/70"
            }`}
            title={
              aspectLocked
                ? `${lockLabel}${t("card_cropper.locked_suffix")}`
                : t("card_cropper.free_crop_title")
            }
          >
            {aspectLocked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <LockOpen className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {aspectLocked ? `${lockLabel} ${t("card_cropper.locked_short_suffix")}` : t("card_cropper.free_crop_short")}
            </span>
          </button>
          <button
            data-testid="card-cropper-close-btn"
            onClick={onCancel}
            disabled={busy}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition disabled:opacity-50"
            aria-label={t("card_cropper.cancel_aria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body — react-image-crop med vår styling */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-auto p-4">
        <div className="kodo-cropper-wrapper">
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={aspectLocked ? targetAspect : undefined}
            keepSelection
            ruleOfThirds
            minWidth={50}
            minHeight={30}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imageDataUrl}
              alt={t("card_cropper.image_alt")}
              onLoad={onImageLoad}
              style={{ maxHeight: "70vh", maxWidth: "100%" }}
            />
          </ReactCrop>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 bg-black/70 backdrop-blur-sm border-t border-white/10">
        <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 justify-center">
          <button
            data-testid="card-cropper-retake-btn"
            onClick={onRetake}
            disabled={busy}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm font-semibold transition disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            {t("card_cropper.retake_button")}
          </button>
          <button
            data-testid="card-cropper-accept-btn"
            onClick={handleAccept}
            disabled={busy || !completedCrop?.width || !completedCrop?.height}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full ${theme.primaryButton} text-white text-sm font-semibold shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {t("card_cropper.accept_button")}
          </button>
        </div>
        <p className="text-[10px] text-white/40 text-center mt-3">
          {t("card_cropper.help_text_1")}
          {` ${lockLabel}-${t("card_cropper.help_text_2_suffix")}`}
        </p>
      </div>
    </div>
  );
}
