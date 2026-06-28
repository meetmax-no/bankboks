"use client";

/**
 * Ko | Do · Vault — PWAInstallHint
 *
 * Felles "Legg-til-på-hjemskjerm"-banner for iOS Safari og Android Chrome.
 *
 * Visningsregler — ALLE må være sanne:
 *   1. Plattform = iOS Safari ELLER Android Chrome
 *   2. Ikke i standalone-modus
 *   3. localStorage `pwaHintDismissed` !== "1" (INGEN unntak)
 *   4. vault.status === "needs-setup" (kunden er ikke ferdig med onboarding)
 *
 * Override for QA: `?pwa-hint=force` i URL bypasser regel 3 og 4
 * (men ikke 1 og 2 — disse er fysiske begrensninger).
 *
 * Konsekvenser:
 *   - Returning kunde (vault.status = "locked"/"unlocked") → ALDRI banner
 *   - Ny kunde på fresh subdomain → ser banner under needs-setup
 *   - Dismiss er permanent per origin (localStorage er per subdomain).
 *     Nytt subdomain (ny tenant) = ny localStorage = banner får ny sjanse.
 *
 * Visning utsettes med 5 sek setTimeout. `beforeinstallprompt` fanges
 * UMIDDELBART (kan kun fanges én gang), kun visningen utsettes.
 */
import { useEffect, useState } from "react";
import { X, Share, Download } from "lucide-react";
import { useVaultRuntime } from "@/lib/vault-runtime";

const DISMISS_KEY = "pwaHintDismissed";
const SHOW_DELAY_MS = 5000;

type Platform = "ios-safari" | "android-chrome" | null;

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

// `beforeinstallprompt`-event signatur (ikke i lib.dom)
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function detectPlatform(): Platform {
  if (typeof window === "undefined") return null;
  const ua = window.navigator.userAgent;

  const isIOS =
    /iPhone|iPad|iPod/.test(ua) ||
    (ua.includes("Mac") && "ontouchend" in document);
  if (isIOS) {
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isSafari ? "ios-safari" : null;
  }

  const isAndroid = /Android/.test(ua);
  if (isAndroid) {
    const isChromiumBased =
      /Chrome|CriOS|SamsungBrowser|EdgA/.test(ua) && !/Firefox|FxiOS/.test(ua);
    return isChromiumBased ? "android-chrome" : null;
  }

  return null;
}

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as NavigatorWithStandalone;
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function hasForceOverride(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("pwa-hint") === "force";
}

export function PWAInstallHint() {
  const { vault } = useVaultRuntime();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  // Markér client-mount EKSPLISITT. SSR og første CSR-render returnerer
  // alltid null før dette flagget er satt — eliminerer enhver mulighet for
  // hydration-mismatch (React error #418) selv om noe i avhengighets-kjeden
  // skulle lese browser-state på serveren.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // Reset visning hver gang vault.status endrer seg — slik at en bruker
    // som forlater needs-setup (gjennomfører eller låser opp) får banneret
    // fjernet umiddelbart uten å vente på navigering.
    setVisible(false);

    const forceShow = hasForceOverride();
    const detected = detectPlatform();
    if (!detected) return; // Regel 1
    if (isStandaloneMode()) return; // Regel 2

    if (!forceShow) {
      // Regel 3 — dismiss respekteres alltid (ingen unntak)
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      // Regel 4 — kun needs-setup gir banner (returning customers slipper)
      if (vault.status !== "needs-setup") return;
    }

    setPlatform(detected);

    // Fang Android-eventet UMIDDELBART (det kan kun fanges én gang).
    let captured: BeforeInstallPromptEvent | null = null;
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      captured = e as BeforeInstallPromptEvent;
      setDeferredPrompt(captured);
    }

    if (detected === "android-chrome") {
      window.addEventListener("beforeinstallprompt", onBeforeInstall);
    }

    // 5 sek delay før selve visningen
    const timer = window.setTimeout(() => {
      if (detected === "android-chrome") {
        // Vis hvis vi har et installer-event ELLER force-override
        // (force lar QA teste UI uten å vente på native event)
        if (captured || forceShow) setVisible(true);
      } else {
        // iOS Safari har ingen native prompt — vis alltid hvis vi nådde hit
        setVisible(true);
      }
    }, SHOW_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, [vault.status, mounted]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  async function triggerInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // Uansett valg — ikke spam brukeren senere
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
    setDeferredPrompt(null);
  }

  if (!mounted || !visible || !platform) return null;

  return (
    <div
      data-testid="pwa-install-hint"
      data-platform={platform}
      role="dialog"
      aria-label="Legg til på hjemskjerm-tips"
      className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-md rounded-2xl border border-amber-400/30 bg-[#0a0e1a]/95 px-4 py-3 shadow-2xl backdrop-blur-md"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-400/40">
          {platform === "ios-safari" ? (
            <Share className="h-4 w-4 text-amber-300" />
          ) : (
            <Download className="h-4 w-4 text-amber-300" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-snug">
            Alltid tilgjengelig — legg Ko | Do · Vault til på hjemskjermen.
          </p>

          {platform === "ios-safari" ? (
            <p className="mt-1 text-[12px] text-white/65 leading-snug">
              Trykk{" "}
              <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-white/85">
                <Share className="h-3 w-3" />
                Del
              </span>{" "}
              → <span className="text-white/85">«Legg til på hjemskjerm»</span>.{" "}
              <span className="text-white/55">Ingen installasjon nødvendig.</span>
            </p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={triggerInstall}
                disabled={!deferredPrompt}
                data-testid="pwa-install-button"
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-[12px] font-semibold text-[#0a0e1a] hover:bg-amber-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Legg til på hjemskjermen
              </button>
              <span className="text-[12px] text-white/55">
                Ingen installasjon nødvendig
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          data-testid="pwa-install-dismiss"
          aria-label="Lukk"
          className="flex-shrink-0 rounded-md p-1 text-white/55 hover:text-white hover:bg-white/10 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
