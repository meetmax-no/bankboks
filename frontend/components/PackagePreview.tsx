"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import type { PackageFile } from "@/lib/package-zip";
import { useLocale } from "@/lib/i18n-context";

interface PackagePreviewProps {
  file: PackageFile | null;
  onClose: () => void;
}

type PreviewKind = "image" | "pdf" | "text" | "none";

/**
 * Inline preview-overlay for én fil. Viser i nettleseren uten å laste ned
 * (SPEC rad 1 — reduserer disk-eksponering, D-014-prinsipp).
 *
 * Støttede typer (SPEC 9.10):
 *   - Bilde: .jpg, .jpeg, .png, .webp, .gif, .svg → <img>
 *   - PDF:   .pdf                                → <iframe> (browser native viewer)
 *   - Tekst: .txt, .md, .csv, .json, .log        → <pre>
 *   - Andre: kun "Last ned"-knapp (ingen preview)
 *
 * Object-URL frigis ved unmount/lukk for å frigjøre RAM.
 */
export function PackagePreview({ file, onClose }: PackagePreviewProps) {
  const { t } = useLocale();
  const [textContent, setTextContent] = useState<string | null>(null);

  const kind = useMemo<PreviewKind>(() => {
    if (!file) return "none";
    const lower = file.path.toLowerCase();
    if (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".svg")
    )
      return "image";
    if (lower.endsWith(".pdf")) return "pdf";
    if (
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json") ||
      lower.endsWith(".log")
    )
      return "text";
    return "none";
  }, [file]);

  // Build object-URL for image/pdf
  const objectUrl = useMemo(() => {
    if (!file || (kind !== "image" && kind !== "pdf")) return null;
    const mime =
      kind === "pdf"
        ? "application/pdf"
        : file.path.toLowerCase().endsWith(".svg")
          ? "image/svg+xml"
          : "image/*";
    const blob = new Blob([file.bytes as BlobPart], { type: mime });
    return URL.createObjectURL(blob);
  }, [file, kind]);

  // Decode text content
  useEffect(() => {
    if (!file || kind !== "text") {
      setTextContent(null);
      return;
    }
    try {
      const txt = new TextDecoder("utf-8", { fatal: false }).decode(file.bytes);
      setTextContent(txt);
    } catch {
      setTextContent(t("package_preview.decode_failed"));
    }
  }, [file, kind]);

  // Frigi object-URL ved unmount/lukk
  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  // Esc lukker
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file) return null;

  function handleDownload() {
    if (!file) return;
    const blob = new Blob([file.bytes as BlobPart], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.path.split("/").pop() || "fil";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div
      data-testid="package-preview-overlay"
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-t-2xl backdrop-blur-xl border border-white/20 border-b-0">
          <span
            className="text-sm text-white/90 truncate font-mono"
            title={file.path}
          >
            {file.path}
          </span>
          <div className="flex items-center gap-2">
            <button
              data-testid="preview-download-btn"
              onClick={handleDownload}
              className="h-8 px-3 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-300/40 text-emerald-200 text-xs font-semibold transition flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> {t("common.download")}
            </button>
            <button
              data-testid="preview-close-btn"
              onClick={onClose}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition"
              aria-label={t("package_preview.close_aria")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden rounded-b-2xl border border-white/20 border-t-0 bg-black/40">
          {kind === "image" && objectUrl && (
            <div
              data-testid="preview-image"
              className="w-full h-full overflow-auto p-4 flex items-center justify-center"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={objectUrl}
                alt={file.path}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
          {kind === "pdf" && objectUrl && (
            <iframe
              data-testid="preview-pdf"
              src={objectUrl}
              className="w-full h-full bg-white"
              title={file.path}
            />
          )}
          {kind === "text" && (
            <pre
              data-testid="preview-text"
              className="w-full h-full overflow-auto p-4 text-xs font-mono text-white/85 whitespace-pre-wrap break-words"
            >
              {textContent ?? t("common.loading_short")}
            </pre>
          )}
          {kind === "none" && (
            <div
              data-testid="preview-no-renderer"
              className="w-full h-full flex flex-col items-center justify-center gap-3 text-white/65 p-8 text-center"
            >
              <FileText className="h-12 w-12 text-white/30" />
              <p className="text-sm">
                {t("package_preview.no_renderer_title")}
              </p>
              <p className="text-xs text-white/45">
                {t("package_preview.no_renderer_hint")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
