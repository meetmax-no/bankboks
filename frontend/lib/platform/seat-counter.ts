/**
 * Ko | Do · Vault — D-103e/D-104 (2026-06-28) — Live seat-telling
 *
 * Ett sted for å beregne `{ activeLicenses, pendingLicenses }` for en B2B-
 * parent. Brukes både av Super-admin (`/api/admin/tenants`) og B2B-Konsoll
 * (`/api/am-admin/auth/me`), så duplisert logikk er eliminert.
 *
 * KRITISK datamodell-detalj: `child.parentTenant` og `invite.parentTenant`
 * lagrer PREFIKS ("mm") — IKKE full subdomain ("mm-admin"). Tidligere bugs
 * (D-103c) brukte parent.subdomain → 0 children. Vi matcher konsekvent mot
 * `tenantPrefix`.
 *
 * Hvorfor live-telling? Det lagrede `activeLicenses`-feltet inkrementeres
 * ved invite-accept men dekrementeres ALDRI ved delete-tenant (kjent bug).
 * Vi stoler ikke på det.
 */
import { listTenants } from "./tenant-store";
import { countActivePendingInvites } from "./invite-store";
import type { TenantRecord } from "./tenant-types";

export type LiveSeatCounts = {
  activeLicenses: number;
  pendingLicenses: number;
};

/**
 * Tell live antall aktive lisenser (ikke-slettede children) for et B2B-
 * prefiks. Tar en allerede-hentet tenant-liste for å unngå dobbel listTenants-
 * kall hvis kalleren allerede har den.
 */
export function countLiveActiveLicenses(
  prefix: string,
  allTenants: readonly TenantRecord[],
): number {
  if (!prefix) return 0;
  let count = 0;
  for (const t of allTenants) {
    if (!t.parentTenant) continue;
    if (t.deletedAt) continue;
    if (t.parentTenant === prefix) count++;
  }
  return count;
}

/**
 * Komplett seat-snapshot for en B2B-parent: live-active + pending-invites.
 * Henter tenant-listen selv hvis ikke gitt. Pending-invites kommer fra
 * `countActivePendingInvites` (filtrerer ut expired og used).
 */
export async function getLiveSeatCounts(
  prefix: string,
  options?: { allTenants?: readonly TenantRecord[] },
): Promise<LiveSeatCounts> {
  if (!prefix) return { activeLicenses: 0, pendingLicenses: 0 };
  const tenants = options?.allTenants ?? (await listTenants());
  const activeLicenses = countLiveActiveLicenses(prefix, tenants);
  const pendingLicenses = await countActivePendingInvites(prefix);
  return { activeLicenses, pendingLicenses };
}
