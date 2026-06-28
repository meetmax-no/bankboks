// Bilde-komprimering for kort-foto (D-016).
//
// Sikkerhet (D-014/D-001):
// - Bildet rører ALDRI filsystem, Camera Roll eller eksterne tjenester
// - Alt skjer i lokal canvas + dataURL — bevarer zero-knowledge-prinsippet
// - Output er en ny base64-streng som krypteres direkte i Cards-blob

import type { ImageConfig } from "./config";
import { tHook } from "./i18n";

/**
 * Komprimer en data-URL (typisk PNG fra CardCamera/CardCropper) til JPEG/WEBP
 * med konfigurerbare grenser. Bevarer aspekt-rasjo og clamp-er til
 * (maxWidth × maxHeight)-boksen.
 *
 * @returns Ny data-URL i ønsket format/kvalitet, og stats om komprimeringen.
 */
export async function compressDataUrl(
  inputDataUrl: string,
  config: ImageConfig,
): Promise<CompressResult> {
  const inputBytes = base64Bytes(inputDataUrl);

  // Last bildet til et HTMLImageElement
  const img = await loadImage(inputDataUrl);

  // Beregn output-dimensjoner med aspekt-rasjo bevart
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (!srcW || !srcH) {
    throw new Error(tHook("image_compress.error_invalid_dimensions"));
  }
  const scaleW = config.maxWidth / srcW;
  const scaleH = config.maxHeight / srcH;
  const scale = Math.min(1, scaleW, scaleH); // ikke skaler opp

  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  // Tegn til canvas
  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunne ikke opprette 2D-context");

  // Forbedret skalering for foto (kort har tekst som må være lesbar)
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Hvis JPEG (ikke alpha-kanal): tegn hvit bakgrunn først så ikke svart bakgrunn lekker
  if (config.format === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dstW, dstH);
  }
  ctx.drawImage(img, 0, 0, dstW, dstH);

  const outputDataUrl = canvas.toDataURL(config.format, config.quality);
  const outputBytes = base64Bytes(outputDataUrl);

  return {
    dataUrl: outputDataUrl,
    width: dstW,
    height: dstH,
    inputBytes,
    outputBytes,
    ratio: outputBytes / Math.max(1, inputBytes),
    format: config.format,
  };
}

export interface CompressResult {
  dataUrl: string;
  width: number;
  height: number;
  inputBytes: number;
  outputBytes: number;
  ratio: number;
  format: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Kunne ikke laste bilde for komprimering"));
    img.src = src;
  });
}

/** Estimer bytes av en base64-data-URL (uten å dekode). */
function base64Bytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return 0;
  const b64 = dataUrl.slice(idx + 1);
  // Hver 4 base64-tegn = 3 bytes, padding ('=') subtraheres
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
