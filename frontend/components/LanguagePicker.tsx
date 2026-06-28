"use client";

/**
 * Ko | Do · Vault — LanguagePicker (v4.2 D-036)
 *
 * Tre flagg 🇳🇴 🇸🇪 🇩🇰 som lar brukeren bytte locale. Klikk bytter
 * umiddelbart uten reload, persisterer i localStorage via useLocale().
 *
 * Design:
 *  - Aktiv flagg:    bg-white/25 + ring-2 ring-white/50 + subtil glow
 *  - Inaktiv flagg:  bg-white/10 + opacity-60, hover oppklarer
 *  - Nøytral UI-chrome per D-031 — ingen feature-farge
 *
 * Brukes to steder:
 *  - AppHeader (locked-state, size="sm")  — alltid synlig før innlogging
 *  - SettingsPanel (unlocked, size="md")  — diskret inne i settings
 *
 * data-testid:
 *  - "language-picker"            (container)
 *  - "language-flag-no" / -sv / -da  (hver pill)
 */

import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-context";

interface LanguagePickerProps {
  /** Pill-størrelse. "sm" = header (32px), "md" = settings (36px). */
  size?: "sm" | "md";
  /** Override aria-label (default: oversatt fra "language_picker.aria_label"). */
  ariaLabel?: string;
}

export function LanguagePicker({ size = "sm", ariaLabel }: LanguagePickerProps) {
  const { locale, setLocale, t } = useLocale();
  const label = ariaLabel ?? t("language_picker.aria_label");

  const dim = size === "md" ? "h-9 w-9 text-lg" : "h-8 w-8 text-base";
  const gap = size === "md" ? "gap-1.5" : "gap-1";

  return (
    <div
      data-testid="language-picker"
      role="radiogroup"
      aria-label={label}
      className={`flex items-center ${gap}`}
    >
      {LOCALES.map((code) => {
        const isActive = locale === code;
        const meta = LOCALE_META[code];
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={meta.nativeLabel}
            title={meta.nativeLabel}
            data-testid={`language-flag-${code}`}
            onClick={() => setLocale(code)}
            className={
              `${dim} flex items-center justify-center rounded-full border transition-all duration-150 ` +
              (isActive
                ? "bg-white/25 border-white/40 ring-2 ring-white/50 shadow-[0_0_12px_rgba(255,255,255,0.15)] scale-105"
                : "bg-white/10 border-white/15 opacity-60 hover:opacity-100 hover:bg-white/15 hover:border-white/25")
            }
          >
            <span aria-hidden="true" className="leading-none">
              {meta.flag}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Eksporter type for downstream-bruk (f.eks. tester). */
export type { Locale };
