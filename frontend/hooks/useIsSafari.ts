"use client";

import { useEffect, useState } from "react";

/**
 * Returnerer true hvis nettleseren er Safari (desktop eller iOS).
 *
 * Brukes til å justere glass-morfisme-overlay og lignende, fordi Safari sin
 * `backdrop-filter`-implementasjon rendrer enkelt-pass blur som ser svakere
 * ut enn Chromes multi-pass gaussian-blur ved samme `blur(Npx)`-verdi.
 * Se D-022 for kontekst.
 *
 * UA-detection: standard regex som ekskluderer Chrome (Chromes UA inneholder
 * også "Safari"), Android, Edge, OPR, og Brave. Fungerer for både macOS
 * Safari og iOS Safari/WebKit-baserte browsere på iPhone/iPad.
 */
export function useIsSafari(): boolean {
  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    const isWebKitSafari =
      /^((?!chrome|android|crios|fxios|edg|opr|opera).)*safari/i.test(ua);
    setIsSafari(isWebKitSafari);
  }, []);

  return isSafari;
}
