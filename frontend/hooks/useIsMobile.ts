"use client";

import { useEffect, useState } from "react";

/**
 * Returnerer true hvis enheten er en telefon (uavhengig av orientering).
 */
export function useIsMobile(threshold: number = 600): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const minSide = Math.min(window.innerWidth, window.innerHeight);
      setIsMobile(minSide < threshold);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [threshold]);

  return isMobile;
}
