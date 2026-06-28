"use client";

/**
 * Ko | Do · Vault — LocalePromptToast (v4.2 D-036 — første-besøks språk-tilbud)
 *
 * Vises diskret nederst-til-høyre når en bruker åpner appen FØRSTE GANG og
 * `navigator.language` IKKE matcher norsk. Tilbyr valg mellom alle tre
 * skandinaviske språk vi støtter (NO/SV/DA).
 *
 * Trigger-betingelser (ALLE må stemme):
 *   1. localStorage["kodo-locale"]            mangler (intet eksplisitt valg)
 *   2. localStorage["kodo-locale-prompted"]   mangler (ikke vist før)
 *   3. navigator.language.slice(0,2)          !== "no"  (nb/nn/no behandles likt)
 *
 * Filosofi:
 *  - Tre språk-titler ("Velg språk · Välj språk · Vælg sprog") fordi vi
 *    ikke vet hvilket av de tre brukeren forstår.
 *  - Tre flagg-knapper. Klikk = sett locale + lukk + lagre prompted-flagget.
 *  - Auto-luk etter 15 sek hvis ignoret (lagrer prompted-flagget men beholder
 *    nåværende fallback-locale).
 *  - Lukke-X = samme som auto-luk.
 *  - 750ms inn-delay etter mount slik at modalen ikke "spretter inn" i samme
 *    frame som login-skjermen.
 *
 * D-001 zero-knowledge: ingen brukerdata berøres. KUN localStorage-flagg.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n-context";

const PROMPTED_KEY = "kodo-locale-prompted";
const STORED_LOCALE_KEY = "kodo-locale";
const MOUNT_DELAY_MS = 750;
const AUTO_DISMISS_MS = 15_000;

/** Sjekker om vi skal vise prompt-toasten på første mount. */
function shouldShowPrompt(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(STORED_LOCALE_KEY)) return false;
    if (window.localStorage.getItem(PROMPTED_KEY)) return false;
  } catch {
    return false;
  }
  const navLang = typeof navigator !== "undefined" ? navigator.language : "";
  const prefix = (navLang || "").toLowerCase().slice(0, 2);
  // Hvis navigator.language matcher et av våre støttede språk → ingen prompt,
  // siden resolveInitialLocale() automatisk velger riktig locale.
  if (prefix === "nb" || prefix === "nn" || prefix === "no") return false;
  if (prefix === "sv" || prefix === "da" || prefix === "en") return false;
  return true;
}

function markPrompted(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROMPTED_KEY, "true");
  } catch {
    /* ignore */
  }
}

export function LocalePromptToast() {
  const { setLocale } = useLocale();
  const [visible, setVisible] = useState(false);

  // Mount-effekt: sjekk betingelser + delay 750ms før vi viser
  useEffect(() => {
    if (!shouldShowPrompt()) return;
    const showTimer = window.setTimeout(() => setVisible(true), MOUNT_DELAY_MS);
    return () => window.clearTimeout(showTimer);
  }, []);

  // Auto-luk etter 15 sek hvis ingen klikker
  useEffect(() => {
    if (!visible) return;
    const dismissTimer = window.setTimeout(() => {
      markPrompted();
      setVisible(false);
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(dismissTimer);
  }, [visible]);

  function handlePick(code: Locale) {
    setLocale(code);
    markPrompted();
    setVisible(false);
  }

  function handleDismiss() {
    markPrompted();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      data-testid="locale-prompt-toast"
      role="dialog"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] w-[min(92vw,360px)] rounded-2xl backdrop-blur-xl bg-slate-900/85 border border-white/20 shadow-2xl p-4 animate-fade-in"
    >
      <button
        type="button"
        data-testid="locale-prompt-close-btn"
        onClick={handleDismiss}
        className="absolute top-2 right-2 h-7 w-7 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 transition"
        aria-label="Lukk · Stäng · Luk"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <p className="text-[11px] text-white/65 font-medium tracking-wide mb-3 pr-6">
        Velg språk · Välj språk · Vælg sprog
      </p>

      <div className="flex items-center gap-2">
        {LOCALES.map((code) => {
          const meta = LOCALE_META[code];
          return (
            <button
              key={code}
              type="button"
              data-testid={`locale-prompt-pick-${code}`}
              onClick={() => handlePick(code)}
              className="flex-1 h-10 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 hover:border-white/30 text-white text-xs font-medium transition-all flex items-center justify-center gap-1.5"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {meta.flag}
              </span>
              <span>{meta.nativeLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
