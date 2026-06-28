/**
 * Ko | Do · Vault — D-091 (2026-06-28) — Bulk-slett valgte org-admins.
 *
 * Brukes av OrgAdminListCard for å rydde orphans (eller normale records,
 * Mike sin nuke-from-orbit-modus). BYPASSER last-super-admin-invariant —
 * dette er ren super-admin-styrt rydding, ikke normal team-CRUD.
 *
 * Hvis ALLE admins for et prefix slettes, ryddes også login-events,
 * indeks-SET, MPW-verifier, admin-notater og pending-invites for det
 * prefikset (samme cascade som ved delete-tenant av B2B-parent).
 *
 * Beskyttet av middleware (admin-session cookie kreves).
 *
 * POST /api/admin/org-admins/bulk-delete
 *   body: { items: [{ tenantPrefix, adminId }, ...] }
 *   →    : { deletedCount, prefixesPurged: [...], errors: [...] }
 */
import { NextRequest, NextResponse } from "next/server";
import { getCentralRedis } from "@/lib/platform/central-upstash";
import {
  deleteAllOrgAdminsForPrefix,
  listOrgAdmins,
} from "@/lib/platform/org-admin-store";
import { deleteMpwVerifier } from "@/lib/platform/am-admin-mpw-store";
import { deleteAllNotes } from "@/lib/platform/am-admin-notes-store";
import {
  listInvitesForParent,
  deleteInvite,
} from "@/lib/platform/invite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { tenantPrefix: string; adminId: string };

function isValidItem(x: unknown): x is Item {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.tenantPrefix === "string" &&
    /^[a-z0-9-]+$/.test(r.tenantPrefix) &&
    typeof r.adminId === "string" &&
    r.adminId.length > 0
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { items?: unknown[] }
      | null;
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "items: ikke-tom array med {tenantPrefix, adminId} kreves" },
        { status: 400 },
      );
    }
    const items: Item[] = [];
    for (const x of body.items) {
      if (!isValidItem(x)) {
        return NextResponse.json(
          { error: "items: alle elementer må ha {tenantPrefix, adminId}" },
          { status: 400 },
        );
      }
      items.push({
        tenantPrefix: x.tenantPrefix.toLowerCase(),
        adminId: x.adminId,
      });
    }

    const client = getCentralRedis();
    const errors: string[] = [];
    let deletedCount = 0;

    // Grupper per prefix for at vi kan rydde indeks effektivt og kjøre
    // full cascade hvis alle admins i en org slettes.
    const byPrefix = new Map<string, string[]>();
    for (const it of items) {
      const arr = byPrefix.get(it.tenantPrefix) ?? [];
      arr.push(it.adminId);
      byPrefix.set(it.tenantPrefix, arr);
    }

    const prefixesPurged: string[] = [];

    for (const [prefix, adminIds] of byPrefix) {
      const before = await listOrgAdmins(prefix);
      const beforeIds = new Set(before.map((a) => a.id));
      const toDelete = adminIds.filter((id) => beforeIds.has(id));
      const willBeEmpty = beforeIds.size === toDelete.length;

      if (willBeEmpty && toDelete.length > 0) {
        // Full cascade — samme som ved delete-tenant av B2B-parent.
        try {
          const purge = await deleteAllOrgAdminsForPrefix(prefix);
          deletedCount += purge.deletedCount;
          try {
            await deleteMpwVerifier(prefix);
          } catch (e) {
            errors.push(`mpw[${prefix}]: ${e instanceof Error ? e.message : e}`);
          }
          try {
            await deleteAllNotes(prefix);
          } catch (e) {
            errors.push(`notes[${prefix}]: ${e instanceof Error ? e.message : e}`);
          }
          try {
            // InviteRecord.parentTenant = prefiks (mm), ikke subdomain.
            const invites = await listInvitesForParent(prefix);
            for (const inv of invites) {
              await deleteInvite(inv);
            }
          } catch (e) {
            errors.push(`invites[${prefix}]: ${e instanceof Error ? e.message : e}`);
          }
          prefixesPurged.push(prefix);
        } catch (e) {
          errors.push(
            `cascade[${prefix}]: ${e instanceof Error ? e.message : e}`,
          );
        }
      } else {
        // Selektiv sletting — fjern hver admin + login-events + indeks-SREM.
        for (const adminId of toDelete) {
          try {
            await client.del(`org-admin:${prefix}:admin:${adminId}`);
            await client.del(`org-admin-login-events:${adminId}`);
            await client.srem(`org-admin:${prefix}:admins`, adminId);
            deletedCount++;
          } catch (e) {
            errors.push(
              `delete[${prefix}/${adminId}]: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
      }
    }

    return NextResponse.json({
      deletedCount,
      prefixesPurged,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/org-admins/bulk-delete POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
