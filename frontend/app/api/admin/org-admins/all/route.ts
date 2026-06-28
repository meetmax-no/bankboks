/**
 * Ko | Do · Vault — D-091 (2026-06-28) — List ALLE org-admins på tvers
 * av prefiks. Brukes av OrgAdminListCard på Test Tools-fanen.
 *
 * Beskyttet av middleware (admin-session cookie kreves).
 *
 * GET /api/admin/org-admins/all
 *   → {
 *       admins: [{
 *         id, tenantPrefix, parentSubdomain, parentExists,
 *         firstName, lastName, email, role, suspended, createdAt
 *       }],
 *       summary: { total: N, orphanCount: M, prefixCount: K }
 *     }
 */
import { NextResponse } from "next/server";
import { getCentralRedis } from "@/lib/platform/central-upstash";
import { listOrgAdmins } from "@/lib/platform/org-admin-store";
import { getTenant } from "@/lib/platform/tenant-store";
import { toOrgAdminPublic } from "@/lib/platform/org-admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = getCentralRedis();

    // Scan alle prefix-indekser
    const adminIndexKeys: string[] = [];
    let cursor: string = "0";
    do {
      const result = (await client.scan(cursor, {
        match: "org-admin:*:admins",
        count: 100,
      })) as [string, string[]];
      cursor = result[0];
      adminIndexKeys.push(...result[1]);
    } while (cursor !== "0");

    const prefixes: string[] = [];
    for (const idxKey of adminIndexKeys) {
      const m = idxKey.match(/^org-admin:([a-z0-9-]+):admins$/);
      if (m && m[1]) prefixes.push(m[1]);
    }

    // For hver prefix: hent admins + sjekk om parent finnes
    // D-095 (2026-06-28): 3-state orphan-detection via snapshot-FK.
    type OrphanReason = "parent_missing" | "link_broken" | "link_missing";
    const admins: Array<{
      id: string;
      tenantPrefix: string;
      parentSubdomain: string;
      parentExists: boolean;
      isOrphan: boolean;
      orphanReason: OrphanReason | null;
      firstName: string;
      lastName: string;
      email: string;
      role: string;
      suspended: boolean;
      createdAt: string;
      parentTenantCreatedAt: string | null;
    }> = [];

    let orphanCount = 0;
    for (const prefix of prefixes) {
      const parentSub = `${prefix}-admin`;
      const parent = await getTenant(parentSub);
      const parentExists = parent !== null;
      const parentCreatedAt = parent?.createdAt ?? null;
      const adminsForPrefix = await listOrgAdmins(prefix);
      for (const adm of adminsForPrefix) {
        const pub = toOrgAdminPublic(adm);
        const snapshot = adm.parentTenantCreatedAt ?? null;
        let isOrphan = false;
        let orphanReason: OrphanReason | null = null;
        if (!parentExists) {
          isOrphan = true;
          orphanReason = "parent_missing";
        } else if (snapshot === null) {
          // Legacy record fra før D-095 — ingen snapshot lagret.
          isOrphan = true;
          orphanReason = "link_missing";
        } else if (parentCreatedAt !== snapshot) {
          // Parent er re-opprettet etter at admin ble laget.
          isOrphan = true;
          orphanReason = "link_broken";
        }
        if (isOrphan) orphanCount++;
        admins.push({
          id: pub.id,
          tenantPrefix: prefix,
          parentSubdomain: parentSub,
          parentExists,
          isOrphan,
          orphanReason,
          firstName: pub.firstName,
          lastName: pub.lastName,
          email: pub.email,
          role: pub.role,
          suspended: pub.suspended,
          createdAt: pub.createdAt,
          parentTenantCreatedAt: snapshot,
        });
      }
    }

    admins.sort((a, b) => {
      // Orphans først, deretter alfabetisk på prefix, deretter e-post
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? -1 : 1;
      if (a.tenantPrefix !== b.tenantPrefix) {
        return a.tenantPrefix.localeCompare(b.tenantPrefix);
      }
      return a.email.localeCompare(b.email);
    });

    return NextResponse.json({
      admins,
      summary: {
        total: admins.length,
        orphanCount,
        prefixCount: prefixes.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/org-admins/all GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
