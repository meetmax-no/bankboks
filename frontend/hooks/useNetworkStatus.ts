"use client";

import { useEffect, useState } from "react";

export type NetStatus = "online" | "offline" | "server-error";

/**
 * Liten hook som fanger opp tre tilstander:
 * - "online" → browser rapporterer online og server er OK
 * - "offline" → browser har mistet nett (navigator.onLine === false)
 * - "server-error" → browser er online, men vault-fetch har feilet (vault.status === "error")
 *
 * Server-error overstyrer online; offline overstyrer alt.
 */
export function useNetworkStatus(serverError: boolean): NetStatus {
  // Start ALLTID som "online" deterministisk på både SSR og første
  // CSR-render — slik unngår vi hydration-mismatch når browser-tilstand
  // (navigator.onLine) avviker fra serverens initial-render.
  // Faktisk status hentes fra navigator etter mount via useEffect.
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Synkroniser med faktisk browser-status først
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  if (!online) return "offline";
  if (serverError) return "server-error";
  return "online";
}
