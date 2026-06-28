// Vedleggs-pipeline for v4.1 ID-blob.
//
// Sikkerhet (D-001 / D-014):
// - Alt skjer klient-side. Vedlegg når ALDRI server i klartekst.
// - Bilde-pipeline: canvas-basert re-encoding (lokal, ingen ekstern API).
// - PDF: lagres som-er, kun MIME-validering + størrelses-clamp.
//
// Spec-referanse: /app/memory/v4.1-SPEC.md §4 (Vedleggs-spesifikasjon).
//   - JPEG/PNG/WebP/HEIC → re-encode JPEG 80% / 1600px lengste side
//   - PDF → behold som-er
//   - Hard maks 1 MB etter komprimering
//   - Maks 1 vedlegg per ID

import type { IdAttachment } from "./types";
import { tHook } from "./i18n";

// ---- Konstanter (spec §4.2) -----------------------------------------------

/** Hard maks per vedlegg etter komprimering (Spec §4.2, Mike-beslutning 2026-02). */
export const MAX_ATTACHMENT_BYTES = 1_048_576; // 1 MB

/** Maks antall vedlegg per ID (1–3). Mike-utvidelse 2026-02 — brukeren velger.
 *  Total kvote per ID dermed 3 MB → blob-target ~25 MB total er fortsatt OK. */
export const MAX_ATTACHMENTS_PER_ID = 3;

/** Maks lengste side for bilde-vedlegg (Spec §4.1). */
export const ID_IMAGE_MAX_DIM = 1600;

/** Initial JPEG-kvalitet (Spec §4.1). Trappes ned hvis output > 1 MB. */
export const ID_IMAGE_INITIAL_QUALITY = 0.8;

/** Minste kvalitets-trinn før vi gir opp. Under dette ofrer vi lesbarhet. */
export const ID_IMAGE_MIN_QUALITY = 0.6;

/** Kvalitets-trapp ved overskridelse av 1 MB. */
export const ID_IMAGE_QUALITY_STEPS = [0.8, 0.75, 0.7, 0.65, 0.6] as const;

/** Tillatte bilde-MIME-typer (Spec §4.1). HEIC inkludert — Safari kan dekode,
 *  andre browsere kaster ved canvas-tegning og brukeren får tydelig melding. */
export const SUPPORTED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** PDF — eneste dokument-type tillatt som vedlegg i v4.1. */
export const SUPPORTED_PDF_MIME = "application/pdf";

// ---- Error-typer ----------------------------------------------------------

export class AttachmentTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;
  constructor(bytes: number) {
    const mb = (bytes / 1024 / 1024).toFixed(2);
    super(
      `Vedlegget er ${mb} MB. Maks ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)} MB per vedlegg. Komprimer eller velg en mindre fil.`,
    );
    this.name = "AttachmentTooLargeError";
    this.bytes = bytes;
    this.maxBytes = MAX_ATTACHMENT_BYTES;
  }
}

export class AttachmentUnsupportedError extends Error {
  readonly mime: string;
  constructor(mime: string) {
    super(
      `Filtypen «${mime || "ukjent"}» støttes ikke. Tillatt: JPEG, PNG, WebP, HEIC eller PDF.`,
    );
    this.name = "AttachmentUnsupportedError";
    this.mime = mime;
  }
}

export class AttachmentEmptyError extends Error {
  constructor() {
    super("Fila er tom (0 bytes).");
    this.name = "AttachmentEmptyError";
  }
}

// ---- Hjelpere -------------------------------------------------------------

/** Avgjør om en MIME-type behandles som bilde. */
export function isImageMime(mime: string): boolean {
  return (SUPPORTED_IMAGE_MIMES as readonly string[]).includes(mime);
}

/** Avgjør om en MIME-type er PDF. */
export function isPdfMime(mime: string): boolean {
  return mime === SUPPORTED_PDF_MIME;
}

/** Returner antall bytes en base64-streng dekoder til (uten faktisk dekoding). */
export function base64ByteSize(b64: string): number {
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Strip eventuell `data:mime;base64,`-prefix og returner kun base64-delen. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

/** Konverter ArrayBuffer til base64 (browser-safe, ingen Buffer-avhengighet). */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  // Chunk for å unngå "Maximum call stack" på store filer
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(bin);
}

// ---- PDF-pipeline ---------------------------------------------------------

/**
 * Behandle en PDF-fil. Pdf lagres som-er (ingen re-rendering).
 * Validerer MIME-type + 1 MB-grense (Spec §4.1, §4.2).
 */
export async function processPdfFile(file: File): Promise<IdAttachment> {
  if (file.size === 0) throw new AttachmentEmptyError();
  if (!isPdfMime(file.type)) {
    throw new AttachmentUnsupportedError(file.type);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(file.size);
  }
  const buf = await file.arrayBuffer();
  const data = arrayBufferToBase64(buf);
  return {
    mime: SUPPORTED_PDF_MIME,
    data,
    name: file.name,
    bytes: file.size,
    addedAt: new Date().toISOString(),
  };
}

// ---- Image-pipeline (canvas-basert) ---------------------------------------

/**
 * Last en data-URL eller blob-URL til et HTMLImageElement.
 * Bevarer aspect-ratio. Krever DOM — ikke tilgjengelig i Node.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          tHook("ids_attachment.error_heic_hint"),
        ),
      );
    img.src = src;
  });
}

/**
 * Beregn output-dimensjoner som bevarer aspect og clamper til maxDim
 * (lengste side). Skalerer ALDRI opp små bilder.
 */
function computeTargetDims(
  srcW: number,
  srcH: number,
  maxDim: number,
): { width: number; height: number } {
  if (!srcW || !srcH) {
    throw new Error("Bildet har ugyldige dimensjoner.");
  }
  const longest = Math.max(srcW, srcH);
  if (longest <= maxDim) return { width: srcW, height: srcH };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

/**
 * Render et bilde til en canvas med hvit bakgrunn (for JPEG-output uten
 * svart-bakgrunn-lekkasje fra alpha-kanal).
 */
function renderToCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunne ikke opprette 2D-context.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Hvit bakgrunn så transparente PNG-er ikke blir svarte i JPEG-output
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

/**
 * Behandle en bilde-fil eller data-URL. Pipeline (Spec §4.1, §5.5):
 *   1. Last til Image()
 *   2. Skaler ned til 1600px lengste side (bevarer aspekt)
 *   3. Render til canvas → toDataURL("image/jpeg", 0.80)
 *   4. Hvis output > 1 MB: trapp ned kvalitet (0.75, 0.70, 0.65, 0.60)
 *   5. Hvis fortsatt > 1 MB: kast AttachmentTooLargeError
 */
export async function processImageDataUrl(
  inputDataUrl: string,
): Promise<IdAttachment> {
  const img = await loadImage(inputDataUrl);
  const { width, height } = computeTargetDims(
    img.naturalWidth,
    img.naturalHeight,
    ID_IMAGE_MAX_DIM,
  );
  const canvas = renderToCanvas(img, width, height);

  // Trinnvis nedgang i kvalitet til vi er innenfor 1 MB
  let outputDataUrl = "";
  let bytes = Number.MAX_SAFE_INTEGER;
  let usedQuality: number = ID_IMAGE_QUALITY_STEPS[0];
  for (const q of ID_IMAGE_QUALITY_STEPS) {
    const candidate = canvas.toDataURL("image/jpeg", q);
    const candidateBytes = base64ByteSize(stripDataUrlPrefix(candidate));
    outputDataUrl = candidate;
    bytes = candidateBytes;
    usedQuality = q;
    if (candidateBytes <= MAX_ATTACHMENT_BYTES) break;
  }

  if (bytes > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentTooLargeError(bytes);
  }

  return {
    mime: "image/jpeg",
    data: stripDataUrlPrefix(outputDataUrl),
    bytes,
    addedAt: new Date().toISOString(),
    // Vi unngår å lagre original-filnavn ved kamera-bilder; data-URL har ingen.
    // For fil-picker setter kalleren `name` etter prosessering hvis ønskelig.
    name: usedQuality < ID_IMAGE_INITIAL_QUALITY
      ? `kvalitet-${Math.round(usedQuality * 100)}%`
      : undefined,
  };
}

/**
 * Behandle en bilde-fil fra fil-picker eller drag-drop. Wraps processImageDataUrl
 * og bevarer original-filnavnet for senere visning.
 */
export async function processImageFile(file: File): Promise<IdAttachment> {
  if (file.size === 0) throw new AttachmentEmptyError();
  if (!isImageMime(file.type)) {
    throw new AttachmentUnsupportedError(file.type);
  }
  // Konverter fil → data-URL (krever FileReader / blob-URL)
  const dataUrl = await fileToDataUrl(file);
  const att = await processImageDataUrl(dataUrl);
  return { ...att, name: file.name };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Kunne ikke lese fila."));
    reader.readAsDataURL(file);
  });
}

// ---- Top-level dispatcher -------------------------------------------------

/**
 * Hovedinngang. Aksepterer enhver fil og ruter til riktig pipeline basert
 * på MIME-type. Brukes fra fil-picker og drag-drop.
 *
 * Kaster:
 *  - AttachmentEmptyError ved 0-byte filer
 *  - AttachmentUnsupportedError ved ikke-støttet MIME
 *  - AttachmentTooLargeError ved overskridelse av 1 MB etter komprimering
 */
export async function processAttachmentFile(file: File): Promise<IdAttachment> {
  if (file.size === 0) throw new AttachmentEmptyError();
  if (isPdfMime(file.type)) return processPdfFile(file);
  if (isImageMime(file.type)) return processImageFile(file);
  throw new AttachmentUnsupportedError(file.type);
}

/**
 * For bilder som kommer rett fra CardCamera (PNG data-URL).
 * Rerunner gjennom image-pipeline → produserer JPEG ≤ 1 MB.
 */
export async function processAttachmentFromCamera(
  pngDataUrl: string,
): Promise<IdAttachment> {
  return processImageDataUrl(pngDataUrl);
}
