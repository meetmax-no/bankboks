"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 5 — TurnstileWidget React-komponent
 *
 * Embedder Cloudflare Turnstile-widgeten ved hjelp av globalt script
 * `https://challenges.cloudflare.com/turnstile/v0/api.js`. Scriptet lastes
 * KUN én gang per side (idempotent) — `<TurnstileWidget>`-komponenten kan
 * derfor brukes flere ganger uten dobbel-load.
 *
 * Krever `NEXT_PUBLIC_TURNSTILE_SITE_KEY` i env. Hvis env mangler vises
 * en placeholder-melding i stedet for widget — slik at lokal utvikling
 * uten Cloudflare-konto ikke crasher skjemaet.
 *
 * Props:
 *   - onVerify: callback med challenge-token når bruker har passert
 *   - onExpire: callback når token utløper (Turnstile auto-resetter da)
 *   - onError:  callback ved widget-feil
 *   - theme:    "light" | "dark" | "auto" — default "dark" (matcher Ko | Do)
 *
 * Dokumentasjon:
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */
import { useEffect, useRef } from "react";

interface TurnstileGlobal {
  render: (
    container: HTMLElement | string,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "compact" | "flexible" | "invisible";
      appearance?: "always" | "execute" | "interaction-only";
    },
  ) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal;
    __kodoTurnstileLoading?: boolean;
    __kodoTurnstileReadyQueue?: Array<() => void>;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return;
    if (window.turnstile) {
      resolve();
      return;
    }
    // Hvis et annet komponent allerede er i ferd med å laste scriptet,
    // queue oss opp og vent.
    if (window.__kodoTurnstileLoading) {
      window.__kodoTurnstileReadyQueue ??= [];
      window.__kodoTurnstileReadyQueue.push(resolve);
      return;
    }
    window.__kodoTurnstileLoading = true;
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const queue = window.__kodoTurnstileReadyQueue ?? [];
      queue.forEach((cb) => cb());
      window.__kodoTurnstileReadyQueue = [];
      resolve();
    };
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({
  onVerify,
  onExpire,
  onError,
  theme = "dark",
}: {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  theme?: "light" | "dark" | "auto";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Lagre callbacks i ref så `render()` ikke trenger å kalles på nytt
  // hver gang parent re-renderer.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
    onErrorRef.current = onError;
  }, [onVerify, onExpire, onError]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadScript().then(() => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        // Iter 5 (revidert) — invisible/bakgrunnsmodus. Per Mike: brukere
        // skal ikke se "Verify you are human"-widget. Cloudflare leverer
        // token i bakgrunnen og viser kun challenge hvis bot-mistanke.
        // For å fullføre må widget mode også settes til "Invisible" i
        // Cloudflare dashboard → Turnstile → Settings → Widget mode.
        size: "invisible",
        appearance: "interaction-only",
        callback: (token: string) => onVerifyRef.current(token),
        "expired-callback": () => onExpireRef.current?.(),
        "error-callback": () => onErrorRef.current?.(),
      });
    });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* widget allerede fjernet av Cloudflare */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme]);

  if (!siteKey) {
    return (
      <div
        data-testid="turnstile-widget-missing-key"
        className="text-[11px] text-amber-300/80 italic font-mono p-2 rounded border border-amber-400/20 bg-amber-500/5"
      >
        ⚠ NEXT_PUBLIC_TURNSTILE_SITE_KEY mangler (lokal dev — OK).
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="turnstile-widget"
    />
  );
}
