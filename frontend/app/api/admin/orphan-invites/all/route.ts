/**
 * Ko | Do · Vault — D-094 (2026-06-28) — List ALLE invites på tvers av prefiks
 * + orphan-detection. Brukes av OrgAdminListCard på Test Tools-fanen.
 *
 * Et invite regnes som orphan hvis:
 *   1. parent-tenanten (`<prefix>-admin`) ikke finnes lenger, ELLER
 *   2. parent finnes, men invite.createdAt er ELDRE enn parent.createdAt
 *      (parent ble re-opprettet etter at invite-recorden ble laget — Mike's
 *      konkrete case 2026-06-28 med mm-admin).
 *
 * Beskyttet av middleware (admin-session cookie).
 *
 * GET /api/admin/orphan-invites/all
 *   → {
 *       invites: [{
 *         token, subdomain, parentPrefix, parentSubdomain, parentExists,
 *         email, firstName, lastName, status, isOrphan, orphanReason,
 *         createdAt, expiresAt
 *       }],
 *       summary: { total, orphanCount }
 *     }
 */
import { NextResponse } from "next/server";
import { getCentralRedis } from "@/lib/platform/central-upstash";
import { listInvitesForParent } from "@/lib/platform/invite-store";
import type { InviteRecord } from "@/lib/platform/invite-types";
import { getTenant } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  token: string;
  subdomain: string;
  parentPrefix: string;
  parentSubdomain: string;
  parentExists: boolean;
  childExists: boolean;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  status: InviteRecord["status"];
  isOrphan: boolean;
  orphanReason: "parent_missing" | "link_broken" | "link_missing" | "child_missing" | null;
  /** D-101: ISO 8601 UTC når child-vault ble slettet via admin. null = ikke arkivert. */
  childDeletedAt: string | null;
  createdAt: string;
  expiresAt: string;
  parentTenantCreatedAt: string | null;
};

export async function GET() {
  try {
    const client = getCentralRedis();

    // Scan alle invite-index keys
    const indexKeys: string[] = [];
    let cursor: string = "0";
    do {
      const result = (await client.scan(cursor, {
        match: "invite-index:*",
        count: 100,
      })) as [string, string[]];
      cursor = result[0];
      indexKeys.push(...result[1]);
    } while (cursor !== "0");

    const prefixes: string[] = [];
    for (const idxKey of indexKeys) {
      const m = idxKey.match(/^invite-index:([a-z0-9-]+)$/);
      if (m && m[1]) prefixes.push(m[1]);
    }

    const rows: Row[] = [];
    let orphanCount = 0;
    for (const prefix of prefixes) {
      const parentSub = `${prefix}-admin`;
      const parent = await getTenant(parentSub);
      const parentExists = parent !== null;
      const parentCreatedAt = parent?.createdAt ?? null;
      const invites = await listInvitesForParent(prefix);
      for (const inv of invites) {
        const snapshot = inv.parentTenantCreatedAt ?? null;
        let isOrphan = false;
        let orphanReason: Row["orphanReason"] = null;

        // Sjekk parent-siden (D-095 snapshot-FK)
        if (!parentExists) {
          isOrphan = true;
          orphanReason = "parent_missing";
        } else if (snapshot === null) {
          // Legacy record fra før D-095 — ingen snapshot lagret.
          isOrphan = true;
          orphanReason = "link_missing";
        } else if (parentCreatedAt !== snapshot) {
          // Parent re-opprettet etter at invite ble laget — eksakt match feiler.
          isOrphan = true;
          orphanReason = "link_broken";
        }

        // D-101 (2026-06-28, Mike): Sjekk OGSÅ child-siden for "Brukt"-invites.
        // En invite som er konsumert peker på en child-tenant (`inv.subdomain`).
        // Hvis childDeletedAt er satt → ARKIVERT (eksplisitt sletting via
        // admin), IKKE rødt orphan-flagg. Vis i UI som historikk.
        // Hvis childDeletedAt IKKE er satt MEN tenant er borte → child_missing
        // orphan (uventet/uregistrert sletting — typisk Vercel-sletting
        // direkte i dashbord).
        let childExists = true;
        const childDeletedAt = inv.childDeletedAt ?? null;
        if (inv.status === "used") {
          const child = await getTenant(inv.subdomain);
          childExists = child !== null;
          if (!childExists && !childDeletedAt && !isOrphan) {
            // Child-tenant er slettet utenfor admin-flowen → flagg som orphan.
            isOrphan = true;
            orphanReason = "child_missing";
          }
        }

        if (isOrphan) orphanCount++;
        rows.push({
          token: inv.token,
          subdomain: inv.subdomain,
          parentPrefix: prefix,
          parentSubdomain: parentSub,
          parentExists,
          childExists,
          email: inv.email,
          firstName: inv.firstName,
          lastName: inv.lastName,
          status: inv.status,
          isOrphan,
          orphanReason,
          childDeletedAt,
          createdAt: inv.createdAt,
          expiresAt: inv.expiresAt,
          parentTenantCreatedAt: snapshot,
        });
      }
    }

    rows.sort((a, b) => {
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? -1 : 1;
      if (a.parentPrefix !== b.parentPrefix) {
        return a.parentPrefix.localeCompare(b.parentPrefix);
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    return NextResponse.json({
      invites: rows,
      summary: { total: rows.length, orphanCount },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/orphan-invites/all GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
