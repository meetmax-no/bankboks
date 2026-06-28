"use client";

import { useEffect, useRef } from "react";
import { PackageOpen, PackagePlus, X } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface PackageHubModalProps {
  open: boolean;
  onClose: () => void;
  onChoosePack: () => void;
  onChooseUnpack: () => void;
  /** Hvis true: "Pakk ut" er deaktivert (Iter 4 ikke ferdig ennå). */
  unpackDisabled?: boolean;
}

/**
 * Sikker overlevering — modal med to valg: pakk inn / pakk ut.
 * Åpnes når Lars klikker 📦 i header (når toggle PÅ).
 *
 * SPEC: /app/memory/v4.0-SPEC.md seksjon 2.2 (Lars-flyt)
 */
export function PackageHubModal({
  open,
  onClose,
  onChoosePack,
  onChooseUnpack,
  unpackDisabled = false,
}: PackageHubModalProps) {
  const { t } = useLocale();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => cancelRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="package-hub-modal"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg">
        <div className="rounded-2xl backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 className="text-base font-semibold text-white">
              {t("package_hub.title")}
            </h2>
            <button
              ref={cancelRef}
              data-testid="hub-close-btn"
              onClick={onClose}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            <p className="text-sm text-white/75 mb-5">
              Krypter filer til en mottaker — eller åpne en pakke du har fått.
            </p>
            <div className="flex flex-col gap-3">
              <button
                data-testid="hub-pack-btn"
                onClick={onChoosePack}
                className="rounded-xl border border-white/20 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-300/40 p-5 text-left transition group flex items-center gap-4"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-300/30 flex items-center justify-center group-hover:bg-emerald-500/25 transition">
                  <PackagePlus className="h-6 w-6 text-emerald-300 group-hover:scale-110 transition" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white mb-0.5">
                    {t("package_hub.pack_title")}
                  </p>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {t("package_hub.pack_desc_1")} <code>.kodoenc</code> {t("package_hub.pack_desc_2")}
                  </p>
                </div>
              </button>

              <button
                data-testid="hub-unpack-btn"
                onClick={onChooseUnpack}
                disabled={unpackDisabled}
                className="rounded-xl border border-white/20 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-300/40 p-5 text-left transition group flex items-center gap-4 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/5 disabled:hover:border-white/20"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-300/30 flex items-center justify-center group-hover:bg-emerald-500/25 transition group-disabled:bg-emerald-500/15">
                  <PackageOpen className="h-6 w-6 text-emerald-300 group-hover:scale-110 transition group-disabled:scale-100" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-white mb-0.5">
                    {t("package_hub.unpack_title")}
                  </p>
                  <p className="text-xs text-white/60 leading-relaxed">
                    {unpackDisabled
                      ? t("package_hub.unpack_disabled")
                      : t("package_hub.unpack_desc")}
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
