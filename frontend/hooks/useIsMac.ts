"use client";

import { useEffect, useState } from "react";

/**
 * Returnerer true hvis brukeren kjører på macOS eller iOS-enhet med
 * fysisk tastatur (iPad m/ tastatur). Brukes for å vise riktig snarvei-
 * symbol: ⌘ på Mac, "Ctrl" på Windows/Linux.
 *
 * Iter 19.9.3 (Mike 2026-06-25): UX-detalj #6 — Ctrl+K på Win/Linux.
 *
 * Default = false ved SSR, oppdateres etter mount. Komponenter som viser
 * snarveier er uansett desktop-only (footer-pillen er `hidden sm:block`),
 * så vi trenger ikke ekstra mobil-skjul her.
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // navigator.platform er deprecated men fortsatt mest pålitelig for
    // macOS-detect. Fallback til userAgent for iPadOS som ofte rapporterer
    // platform="MacIntel" + Touch (iPad-modus).
    const platform = navigator.platform || "";
    const ua = navigator.userAgent || "";
    const onMac = /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/.test(ua);
    setIsMac(onMac);
  }, []);

  return isMac;
}
