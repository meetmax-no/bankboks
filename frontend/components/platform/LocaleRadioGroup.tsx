"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 19.9 Fase 2 — LocaleRadioGroup
 *
 * Gjenbrukbar obligatorisk språkvalg-komponent for registrering + invite.
 * 4 radio-knapper på rad (visuelt som checkbox-stil), kun ett valg.
 * Starter HELT TOMT — ingen pre-utfylling fra useLocale() eller browser.
 *
 * Brukes i:
 *   - /platform/register (B2C trial + paid)
 *   - /invite (B2B invite-accept)
 *
 * Per Mike 2026-06-13: "Vi gjetter aldri mer på språk."
 */
import { Check } from "lucide-react";

export type Locale = "no" | "sv" | "da" | "en";

interface Option {
  value: Locale;
  label: string;
}

const OPTIONS: Option[] = [
  { value: "no", label: "Norsk" },
  { value: "sv", label: "Svensk" },
  { value: "da", label: "Dansk" },
  { value: "en", label: "English" },
];

interface Props {
  value: Locale | null;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
  label: string;
}

export function LocaleRadioGroup({ value, onChange, disabled, label }: Props) {
  return (
    <fieldset
      data-testid="locale-radio-group"
      disabled={disabled}
      className="block"
    >
      <legend className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5 block">
        {label}
        <span className="text-rose-400 ml-1" aria-hidden="true">
          *
        </span>
      </legend>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {OPTIONS.map((opt) => {
          const checked = value === opt.value;
          return (
            <label
              key={opt.value}
              data-testid={`locale-radio-${opt.value}`}
              data-checked={checked ? "true" : "false"}
              className={`relative flex items-center gap-2 px-3 py-2.5 rounded-lg border cursor-pointer transition select-none ${
                checked
                  ? "border-emerald-400/60 bg-emerald-500/10"
                  : "border-white/15 bg-black/40 hover:border-white/30 hover:bg-black/60"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="radio"
                name="locale"
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
                disabled={disabled}
                className="sr-only"
                data-testid={`locale-radio-input-${opt.value}`}
              />
              <span
                aria-hidden="true"
                className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 transition ${
                  checked
                    ? "border-emerald-300 bg-emerald-400/30"
                    : "border-white/30 bg-transparent"
                }`}
              >
                {checked && <Check className="h-3 w-3 text-emerald-200" />}
              </span>
              <span
                className={`text-sm ${checked ? "text-emerald-100 font-medium" : "text-white"}`}
              >
                {opt.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
