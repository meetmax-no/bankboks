"use client";
/**
 * Ko | Do · Vault — D-153 (2026-02) — useIsAdminHost
 *
 * Klient-side hook som returnerer true hvis vi kjører på en admin-host:
 *   - `admin.kodovault.no` (SuperAdmin-konsollen)
 *   - `<prefix>-admin.kodovault.no` (firma-admin-konsoller)
 *
 * Begge disse er administrator-roller uten egen bruker-konto/vault — så
 * "Slett vault og konto"-knappen gir ingen mening der (ville prøvd å
 * slette Mikes SA-vault, eller firma-adminens skyggekonto).
 *
 * Returnerer `null` på server-side og under første render — komponenter
 * bør defaulte til "skjul destruktive knapper" mens hooken løser seg.
 */
import { useEffect, useState } from "react";

export function useIsAdminHost(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    // Matcher `admin.kodovault.no` og alle `<prefix>-admin.kodovault.no`
    const isAdminHost = host.startsWith("admin.") || host.includes("-admin.");
    setIsAdmin(isAdminHost);
  }, []);

  return isAdmin;
}
