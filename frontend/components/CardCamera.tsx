"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Crop,
  Loader2,
  RotateCcw,
  ScanLine,
  Smartphone,
  X,
} from "lucide-react";
import { PRIMARY_THEME, type FeatureTheme } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";

// CR80 — internasjonal standard for kreditt/debetkort. 85.60 × 53.98 mm.
// Aspect ratio: 1.586:1 (landscape) eller 0.631:1 (portrait).
const CR80_ASPECT = 85.6 / 53.98;
// Passport — ICAO 9303 standard. 88 × 125 mm åpen oppslag. Portrait, ~1.42:1.
// Spec /app/memory/v4.1-SPEC.md §4.5: brukes for Pass-vedlegg.
const PASSPORT_ASPECT = 125 / 88; // ~1.42, anvendes som høyde/bredde for portrait

export type CameraFacing = "environment" | "user";

/** Aspect-mode for fokus-ramme og auto-crop. v4.1 §4.5.
 *  - "id-1": CR80 landscape 1.586:1 — Bankkort, Førerkort, ID-kort, Helse
 *  - "passport": ICAO 9303 portrait ~1.42:1 — Pass (åpen oppslag) */
export type CameraAspectMode = "id-1" | "passport";

interface CardCameraProps {
  open: boolean;
  /** Vises i header — typisk "Forside av kort" eller "Bakside av kort" */
  label?: string;
  onClose: () => void;
  /** Returnerer auto-cropped utsnitt (PNG) — fast path */
  onCapture: (dataUrl: string) => void;
  /** Returnerer FULL ukomprimert frame for manuell finjustering i CardCropper */
  onRequestFineTune?: (fullDataUrl: string) => void;
  /** Aspect-mode for fokus-ramme + auto-crop. Default "id-1" for
   *  bakoverkompatibilitet med eksisterende cards-flows. */
  aspectMode?: CameraAspectMode;
  /** Feature-tema. Default `PRIMARY_THEME` (blå) for cards-kompatibilitet.
   *  v4.1: IdAttachmentDropZone passer `IDS_THEME` (orange) per D-031 / B-modellen. */
  theme?: FeatureTheme;
}

type Phase =
  | "checking" // detekterer kamera
  | "denied" // ingen kamera ELLER bruker nektet
  | "requesting" // venter på getUserMedia-prompt
  | "live" // viser video-stream
  | "preview" // bruker har tatt bilde, viser canvas
  | "error";

/**
 * Custom kamera-fangst per D-014 + D-020:
 * - getUserMedia universelt (mobil + laptop)
 * - ALDRI file picker / Camera Roll
 * - Hvis ingen kamera: tydelig "ikke støttet"-melding, ingen fallback
 * - Bildet eksisterer KUN i React state, aldri på filsystemet
 */
export function CardCamera({
  open,
  label,
  onClose,
  onCapture,
  onRequestFineTune,
  aspectMode = "id-1",
  theme = PRIMARY_THEME,
}: CardCameraProps) {
  const { t } = useLocale();
  const effectiveLabel = label ?? t("camera.label_default");
  const [phase, setPhase] = useState<Phase>("checking");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [facing, setFacing] = useState<CameraFacing>("environment");
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [fullDataUrl, setFullDataUrl] = useState<string | null>(null);

  // Koble strøm til <video> NÅR både elementet og strømmen finnes.
  // Dette er kritisk fordi video-elementet rendres kun når phase === "live",
  // så vi må vente på at React har montert det før vi setter srcObject.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeStream) return;
    if (video.srcObject !== activeStream) {
      video.srcObject = activeStream;
    }
    // iOS Safari + noen Android-browsere: må kalle play() eksplisitt
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        /* play kan feile silently; vil starte når metadata loades */
      });
    }
  }, [activeStream, phase]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActiveStream(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startStream = useCallback(
    async (preferredFacing: CameraFacing) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setErrorMsg(
          t("camera.error_no_api"),
        );
        setPhase("denied");
        return;
      }
      setPhase("requesting");
      setErrorMsg("");
      try {
        // Sjekk hvor mange video-enheter vi har — kun for å vise switch-knapp
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videos = devices.filter((d) => d.kind === "videoinput");
          setHasMultipleCameras(videos.length > 1);
          if (videos.length === 0) {
            setErrorMsg(
              t("camera.error_no_device"),
            );
            setPhase("denied");
            return;
          }
        } catch {
          /* enumerateDevices kan feile uten permission på noen browsere — ignorer */
        }

        // Forsøk preferred facingMode først, fall tilbake til "any"
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          // Fallback uten facingMode (laptop/desktop med kun front-cam)
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        }

        streamRef.current = stream;
        // Sett state først — video-elementet vil mountes når phase === "live",
        // og useEffect over vil koble strømmen til video.srcObject automatisk.
        setActiveStream(stream);
        setPhase("live");
      } catch (err) {
        const e = err as DOMException;
        if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
          setErrorMsg(
            t("camera.error_denied"),
          );
        } else if (
          e?.name === "NotFoundError" ||
          e?.name === "DevicesNotFoundError"
        ) {
          setErrorMsg(
            t("camera.error_not_found"),
          );
        } else if (e?.name === "NotReadableError") {
          setErrorMsg(
            t("camera.error_in_use"),
          );
        } else {
          setErrorMsg(
            `Kunne ikke starte kamera: ${e?.message || "ukjent feil"}`,
          );
        }
        setPhase("denied");
      }
    },
    [],
  );

  // Start/stopp ved open
  useEffect(() => {
    if (open) {
      setPhase("checking");
      setPreviewDataUrl(null);
      setFullDataUrl(null);
      startStream(facing);
    } else {
      stopStream();
      setPreviewDataUrl(null);
      setFullDataUrl(null);
      setPhase("checking");
    }
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSwitchCamera = useCallback(() => {
    const next: CameraFacing = facing === "environment" ? "user" : "environment";
    setFacing(next);
    stopStream();
    startStream(next);
  }, [facing, startStream, stopStream]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.videoWidth || !video.videoHeight) return;

    // Lokale canvas (ingen refs) — eliminerer mulighet for state-konflikt
    // mellom React re-renders og DOM-canvas state.

    // 1) Full-frame canvas for "Finjuster"-flow
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx) return;

    // Speilvend hvis front-cam (laptop) for å matche live-preview-en
    if (facing === "user") {
      fullCtx.translate(fullCanvas.width, 0);
      fullCtx.scale(-1, 1);
    }
    fullCtx.drawImage(video, 0, 0, fullCanvas.width, fullCanvas.height);
    if (facing === "user") {
      fullCtx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const fullUrl = fullCanvas.toDataURL("image/png");
    setFullDataUrl(fullUrl);

    // 2) Beregn auto-crop sentrert. For "id-1" (CR80 landscape) bruker vi
    //    1.586:1. For "passport" (portrait) bruker vi 1/PASSPORT_ASPECT slik at
    //    width/height blir < 1 (portrait). Tightere inset (65%) matcher det
    //    brukeren ser inne i fokus-rammen.
    const targetAspect =
      aspectMode === "passport" ? 1 / PASSPORT_ASPECT : CR80_ASPECT;
    const sw = fullCanvas.width;
    const sh = fullCanvas.height;
    const videoRatio = sw / sh;
    const safetyInset = 0.65;
    let cropW: number;
    let cropH: number;
    if (videoRatio > targetAspect) {
      cropH = sh * safetyInset;
      cropW = cropH * targetAspect;
    } else {
      cropW = sw * safetyInset;
      cropH = cropW / targetAspect;
    }
    const sx = (sw - cropW) / 2;
    const sy = (sh - cropH) / 2;

    // 3) Lokal crop-canvas
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.round(cropW);
    cropCanvas.height = Math.round(cropH);
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;
    cropCtx.drawImage(
      fullCanvas,
      sx,
      sy,
      cropW,
      cropH,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    const dataUrl = cropCanvas.toDataURL("image/png");
    setPreviewDataUrl(dataUrl);
    setPhase("preview");
    stopStream();
  }, [facing, stopStream, aspectMode]);

  const handleRetake = useCallback(() => {
    setPreviewDataUrl(null);
    setFullDataUrl(null);
    startStream(facing);
  }, [facing, startStream]);

  const handleAccept = useCallback(() => {
    if (previewDataUrl) {
      onCapture(previewDataUrl);
      setPreviewDataUrl(null);
      setFullDataUrl(null);
    }
  }, [previewDataUrl, onCapture]);

  const handleFineTune = useCallback(() => {
    if (fullDataUrl && onRequestFineTune) {
      onRequestFineTune(fullDataUrl);
      setPreviewDataUrl(null);
      setFullDataUrl(null);
    }
  }, [fullDataUrl, onRequestFineTune]);

  if (!open) return null;

  return (
    <div
      data-testid="card-camera"
      className="fixed inset-0 z-[60] bg-black flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-black/70 backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center gap-2 text-white">
          <Camera className={`h-4 w-4 ${theme.iconColor}`} />
          <span className="text-sm font-semibold">{effectiveLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {phase === "live" && hasMultipleCameras && (
            <button
              data-testid="card-camera-switch-btn"
              onClick={handleSwitchCamera}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition"
              title={t("camera.switch_tooltip")}
              aria-label={t("camera.switch_aria")}
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button
            data-testid="card-camera-close-btn"
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 hover:text-white transition"
            aria-label={t("camera.close_aria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {(phase === "checking" || phase === "requesting") && (
          <div
            data-testid="card-camera-loading"
            className="flex flex-col items-center gap-3 text-white/70"
          >
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">
              {phase === "checking"
                ? t("camera.checking")
                : t("camera.waiting")}
            </span>
          </div>
        )}

        {phase === "denied" && (
          <div
            data-testid="card-camera-denied"
            className="max-w-md mx-4 p-6 rounded-2xl bg-zinc-900 border border-white/15 text-center"
          >
            <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center">
              <Smartphone className="h-5 w-5 text-amber-200" />
            </div>
            <h3 className="text-base font-semibold text-white mb-2">
              Foto kan ikke tas her
            </h3>
            <p className="text-sm text-white/70 mb-5 leading-relaxed">
              {errorMsg}
            </p>
            <button
              data-testid="card-camera-denied-close-btn"
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm font-semibold transition"
            >
              OK, lagre uten foto
            </button>
            <p className="text-[11px] text-white/40 mt-4">
              📱 Tips: Åpne samme vault på mobil → rediger kortet → ta foto der
            </p>
          </div>
        )}

        {phase === "live" && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              data-testid="card-camera-video"
              className={`w-full h-full object-cover ${
                facing === "user" ? "scale-x-[-1]" : ""
              }`}
            />
            {/* Fokus-ramme overlay — aspect-mode bestemmer form */}
            <FocusFrame aspectMode={aspectMode} cornerMarker={theme.cornerMarker} />
          </>
        )}

        {phase === "preview" && previewDataUrl && (
          <>
            <img
              data-testid="card-camera-preview"
              src={previewDataUrl}
              alt={t("camera.preview_alt")}
              className="w-full h-full object-contain"
            />
            <div className="absolute top-4 left-4 right-4 px-3 py-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/10 text-center text-sm text-white/85">
              Ser bildet OK ut? Sjekk fokus og lesbarhet.
            </div>
          </>
        )}
      </div>

      {/* Footer / Capture-knapper */}
      <div className="px-4 py-4 bg-black/70 backdrop-blur-sm border-t border-white/10">
        {phase === "live" && (
          <div className="flex items-center justify-center">
            <button
              data-testid="card-camera-capture-btn"
              onClick={handleCapture}
              className="w-16 h-16 rounded-full bg-white shadow-2xl border-4 border-white/40 hover:border-white/60 active:scale-95 transition"
              aria-label={t("camera.snap_aria")}
            />
          </div>
        )}
        {phase === "preview" && (
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 justify-center">
            <button
              data-testid="card-camera-retake-btn"
              onClick={handleRetake}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm font-semibold transition"
            >
              <RotateCcw className="h-4 w-4" />
              {t("camera.retake_button")}
            </button>
            {onRequestFineTune && (
              <button
                data-testid="card-camera-finetune-btn"
                onClick={handleFineTune}
                className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full ${theme.accentOutlineButton} text-sm font-semibold transition`}
                title={t("camera.finetune_tooltip")}
              >
                <Crop className="h-4 w-4" />
                {t("camera.finetune_button")}
              </button>
            )}
            <button
              data-testid="card-camera-accept-btn"
              onClick={handleAccept}
              className={`w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-full ${theme.primaryButton} text-white text-sm font-semibold shadow-lg transition`}
            >
              <Check className="h-4 w-4" />
              {t("camera.use_button")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Aspect-aware fokus-ramme med stiplet kant.
 *
 * "id-1": landscape 1.586:1 (CR80) — bredt rektangel for kort
 * "passport": portrait ~1.42:1 — høyt rektangel for pass-oppslag
 *
 * Tilpasser seg viewport. Hjørne-markører + hint-tekst inkludert.
 */
function FocusFrame({
  aspectMode,
  cornerMarker,
}: {
  aspectMode: CameraAspectMode;
  cornerMarker: string;
}) {
  const { t } = useLocale();
  const isPassport = aspectMode === "passport";
  // For passport (portrait): aspectRatio < 1. For id-1 (landscape): > 1.
  const aspect = isPassport ? 1 / PASSPORT_ASPECT : CR80_ASPECT;
  // Forskjellig dimensjonering — passport trenger høyde-prioritet, id-1 bredde
  const frameStyle: React.CSSProperties = isPassport
    ? {
        height: "min(75vh, 85vw / (1 / 1.42))",
        aspectRatio: `${aspect}`,
      }
    : {
        width: "min(85vw, 70vh * 1.586)",
        aspectRatio: `${aspect}`,
      };
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="relative" style={frameStyle}>
        {/* Stiplet ramme + mørk overlay rundt for "spotlight"-effekt */}
        <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
        {/* Hjørne-markører i feature-farge */}
        <div className={`absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 ${cornerMarker} rounded-tl-2xl`} />
        <div className={`absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 ${cornerMarker} rounded-tr-2xl`} />
        <div className={`absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 ${cornerMarker} rounded-bl-2xl`} />
        <div className={`absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 ${cornerMarker} rounded-br-2xl`} />
        {/* Hint-tekst */}
        <div className="absolute -bottom-12 left-0 right-0 text-center text-white/80 text-xs flex items-center justify-center gap-1.5">
          <ScanLine className="h-3.5 w-3.5" />
          {isPassport
            ? t("camera.frame_hint_passport")
            : t("camera.frame_hint_default")}
        </div>
      </div>
    </div>
  );
}
