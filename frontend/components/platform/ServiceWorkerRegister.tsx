"use client";

/**
 * Ko | Do · Vault — Service Worker registrering
 *
 * Klient-only komponent. Registrerer `/sw.js` etter mount i produksjons-
 * builds. Dev-modus skippes — Next.js HMR fungerer ikke godt sammen med
 * en SW som cacher /_next/static/* assets, og PWA-install-testing skjer
 * uansett på prod-builds.
 *
 * Komponenten rendrer ingenting. Plasseres inne i `<Providers>` slik at
 * den er klient-only og kjører på alle sider.
 */
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skipp dev-modus — HMR + SW = ustabil utviklingsopplevelse
    if (process.env.NODE_ENV !== "production") return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        // Logg for debug — synlig kun i devtools-konsoll
        if (reg.installing) {
          console.log("[SW] installerer…");
        } else if (reg.waiting) {
          console.log("[SW] venter på aktivering");
        } else if (reg.active) {
          console.log("[SW] aktiv (scope:", reg.scope, ")");
        }
      } catch (err) {
        console.warn("[SW] registrering feilet:", err);
      }
    };

    // Vent til "load" så vi ikke konkurrerer med initial page-load
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return null;
}
