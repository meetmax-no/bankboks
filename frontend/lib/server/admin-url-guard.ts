/**
 * Ko | Do · Vault — D-149 (2026-02) — Delt URL-guard for ADMIN_INTERNAL_URL
 *
 * Bakgrunn: Mike hadde `admin.kodovaul.no` (uten T) satt via D-077-propagering
 * på eksisterende tenant-pods. Uten guard endte alle RPC-kall (activity-bump,
 * write-block, tenant-status) i `fetch failed` fordi DNS-oppslag på
 * ikke-eksisterende domene feiler.
 *
 * Samme mønster som `resolveAdminConfigHost()` i `useAppConfig.ts` — hvis
 * URL-en ikke peker på `*.kodovault.no`, logg en warning og bruk fallback.
 */

const ADMIN_INTERNAL_URL_FALLBACK = "https://admin.kodovault.no";

export function resolveAdminInternalUrl(): string {
  const raw = process.env.ADMIN_INTERNAL_URL?.trim();
  if (!raw) return ADMIN_INTERNAL_URL_FALLBACK;
  try {
    const u = new URL(raw);
    const ok =
      u.hostname === "kodovault.no" || u.hostname.endsWith(".kodovault.no");
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[admin-url-guard] ADMIN_INTERNAL_URL="${raw}" peker ikke på *.kodovault.no — sannsynligvis typo (bør være admin.kodovault.no). Faller tilbake til "${ADMIN_INTERNAL_URL_FALLBACK}".`,
      );
      return ADMIN_INTERNAL_URL_FALLBACK;
    }
    return raw;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[admin-url-guard] ADMIN_INTERNAL_URL="${raw}" er ikke en gyldig URL. Faller tilbake til "${ADMIN_INTERNAL_URL_FALLBACK}".`,
    );
    return ADMIN_INTERNAL_URL_FALLBACK;
  }
}
