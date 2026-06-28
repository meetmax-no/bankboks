/**
 * Ko | Do · Vault — Iter 20.9 (D-097d/e, Mike 2026-06-28)
 *
 * Sentral helper for å bygge invite-URL-er. Brukes av både Mike's super-
 * admin invite-routes og B2B Konsoll am-admin invite-routes.
 *
 * Bakgrunn:
 *   - `/invite`-siden er en del av admin-Next.js-deploymen.
 *   - Vercel-prosjektet er mappet til `admin.kodovault.no` OG wildcard
 *     `*-admin.kodovault.no`. Apex og www er IKKE mappet (404).
 *   - Per-org host gir en mer "white-label" opplevelse i invite-mailen:
 *     en ansatt i meetmax ser `mm-admin.kodovault.no/invite?…` heller enn
 *     en generisk `admin.kodovault.no/invite?…`.
 *
 * Mike-direktiv 2026-06-28: bruk per-org host når vi har parent-prefix
 * (alltid tilfellet for B2B-invitasjoner), fall tilbake til generic
 * `admin.kodovault.no` kun for hypotetiske invitasjoner uten parent.
 */

const FALLBACK_ADMIN_HOST = "admin.kodovault.no";

/**
 * Returnér origin for invite-lenker basert på tenant-prefix.
 *
 * @param tenantPrefix - B2B-parent sin prefix (eks "mm"). Brukes til å
 *                       bygge `<prefix>-admin.<base>`. Hvis null/undef,
 *                       returneres generic `admin.kodovault.no`.
 *
 * Override-mekanisme: `NEXT_PUBLIC_ADMIN_ORIGIN` env-var settes for
 * dev/preview (matcher next.config.mjs sin ADMIN_ORIGIN-konvensjon).
 * I dev/preview lager vi IKKE per-prefix subdomain — vi bruker
 * override som er, siden `<prefix>-admin.localhost` ikke virker.
 */
export function getInviteOrigin(tenantPrefix?: string | null): string {
  const override = process.env.NEXT_PUBLIC_ADMIN_ORIGIN;
  if (override && /^https?:\/\//.test(override)) {
    // Dev/preview: bruk override direkte (ingen prefix-substitusjon)
    return override.replace(/\/+$/, "");
  }
  if (tenantPrefix && /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(tenantPrefix)) {
    // Produksjon med kjent parent-prefix: per-org host.
    return `https://${tenantPrefix}-admin.kodovault.no`;
  }
  // Fallback: generic admin-host (kun for invitasjoner uten parent-context,
  // og Mike's super-admin der parent-prefix uansett peker ut bedriften).
  return `https://${FALLBACK_ADMIN_HOST}`;
}

/**
 * Bygg en absolutt invite-URL.
 *
 * @param token        - Invite-token (UUID v4)
 * @param tenantPrefix - B2B-parent sin prefix. Pass `invite.parentTenant`
 *                       fra invite-recorden (alltid satt for B2B-flow).
 */
export function buildInviteUrl(
  token: string,
  tenantPrefix?: string | null,
): string {
  return `${getInviteOrigin(tenantPrefix)}/invite?token=${token}`;
}
