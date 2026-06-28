// Vannmerke-eksport for ID-vedlegg.
//
// Spec /app/memory/v4.1-SPEC.md §6.4 (Mike-beslutning 2026-02).
// Format: C2 — stempel-stil "KOPI · YYYY-MM-DD" nederst over hele bredden.
//
// D-001 / D-014: Alt skjer klient-side. Original-vedlegget når ALDRI server i
// klartekst. Eksport-fila lages lokalt og last-ned via blob-URL.
//
// PDF-vedlegg er IKKE støttet i v4.1 (D3-beslutning). Brukeren får tydelig
// feilmelding ved forsøk.

import type { IdAttachment, VaultId } from "./types";

export class WatermarkExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatermarkExportError";
  }
}

export class WatermarkUnsupportedError extends WatermarkExportError {
  constructor() {
    super(
      "PDF-vedlegg kan ikke eksporteres med vannmerke i v4.1. Last ned direkte fra viewer.",
    );
    this.name = "WatermarkUnsupportedError";
  }
}

/** Format dato som "YYYY-MM-DD" (ISO uten tid, bruker lokal tidssone). */
export function formatStampDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Bygg stempel-tekst slik den vises på bildet. */
export function buildStampText(date: Date = new Date()): string {
  return `KOPI · ${formatStampDate(date)}`;
}

/**
 * Foreslått filnavn for nedlasting: <id-tittel>-kopi-YYYY-MM-DD.jpg
 * Sanitiserer ulovlige filsystem-tegn.
 */
export function suggestedFilename(id: VaultId, date: Date = new Date()): string {
  const sanitized = (id.title || id.kind)
    .toLowerCase()
    .replace(/[æå]/g, "a")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "id";
  return `${sanitized}-kopi-${formatStampDate(date)}.jpg`;
}

/** Last en data-URL til en HTMLImageElement (browser-only). */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new WatermarkExportError("Kunne ikke laste bildet for eksport."));
    img.src = src;
  });
}

/**
 * Tegn klassisk Word-stil diagonal "KOPI"-vannmerke (Mike-valg A, 2026-02).
 *
 * Stil:
 *   - Stor "KOPI"-tekst sentrert, -30° rotert
 *   - Dato (mindre) under, samme rotasjon
 *   - Hvit fyll @ 35% opasitet + tynn mørk stroke for synlighet på både
 *     lyse og mørke deler av ID-bildet
 *   - Font-størrelse: ~15% av kortere side (clampet 60–180 px)
 *
 * Profesjonell, gjenkjennelig som "ekte" vannmerke, ikke skrikende.
 * Vanskelig å redigere bort uten å ødelegge selve bildet.
 */
export function drawDiagonalWatermark(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  mainText: string,
  subText: string,
): void {
  const shortSide = Math.min(canvasWidth, canvasHeight);
  const mainSize = Math.min(180, Math.max(60, Math.round(shortSide * 0.15)));
  const subSize = Math.max(14, Math.round(mainSize * 0.28));

  ctx.save();
  ctx.translate(canvasWidth / 2, canvasHeight / 2);
  ctx.rotate(-Math.PI / 6); // -30° — Word-default, mer subtilt enn -45°
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Hovedtekst "KOPI" — hvit fyll med mørk stroke for kontrast over alle bg-er
  ctx.font = `bold ${mainSize}px ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif`;
  // Letter-spacing-simulering via tracking i selve tekst-en (canvas mangler tracking)
  const tracked = mainText.split("").join(" ");
  ctx.lineWidth = Math.max(2, Math.round(mainSize * 0.025));
  ctx.strokeStyle = "rgba(0, 0, 0, 0.32)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  const mainY = -mainSize * 0.25;
  ctx.strokeText(tracked, 0, mainY);
  ctx.fillText(tracked, 0, mainY);

  // Dato under — samme stil, mindre
  ctx.font = `${subSize}px ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif`;
  ctx.lineWidth = Math.max(1, Math.round(subSize * 0.06));
  const subY = mainSize * 0.55;
  ctx.strokeText(subText, 0, subY);
  ctx.fillText(subText, 0, subY);

  ctx.restore();
}

/**
 * Eksporter et bilde-vedlegg som JPEG med diagonalt vannmerke (Mike-valg A,
 * 2026-02 — klassisk Word-stil). Original-bildet rendres uendret i sine native
 * dimensjoner, så får "KOPI" + dato stemplet diagonalt midt på.
 *
 * Kaster:
 *   - WatermarkUnsupportedError ved PDF eller annen ikke-bilde-MIME
 *   - WatermarkExportError ved canvas/loading-feil
 */
export async function exportImageWithWatermark(
  attachment: IdAttachment,
  options: { date?: Date; mainText?: string } = {},
): Promise<Blob> {
  if (!attachment.mime.startsWith("image/")) {
    throw new WatermarkUnsupportedError();
  }

  const date = options.date ?? new Date();
  const mainText = options.mainText ?? "KOPI";
  const subText = formatStampDate(date);
  const src = `data:${attachment.mime};base64,${attachment.data}`;
  const img = await loadImage(src);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new WatermarkExportError("Kunne ikke opprette canvas-context.");
  }

  ctx.drawImage(img, 0, 0);
  drawDiagonalWatermark(ctx, canvas.width, canvas.height, mainText, subText);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob)
          reject(new WatermarkExportError("Canvas.toBlob returnerte null."));
        else resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

/**
 * Last ned blob i nettleseren som <filename>. Bruker programmatisk <a>-click
 * + ObjectURL → revokeObjectURL etterpå.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke etter et lite tick — gir browser tid til å starte nedlasting
  setTimeout(() => URL.revokeObjectURL(url), 200);
}
