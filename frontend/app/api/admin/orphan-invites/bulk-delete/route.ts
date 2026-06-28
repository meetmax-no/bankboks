/**
 * Ko | Do · Vault — D-094 (2026-06-28) — Bulk-slett valgte invites.
 *
 * POST /api/admin/orphan-invites/bulk-delete
 *   body: { tokens: [string, ...] }
 *   →    : { deletedCount, errors }
 *
 * Beskyttet av middleware (admin-session).
 */
import { NextRequest, NextResponse } from "next/server";
import { getCentralRedis } from "@/lib/platform/central-upstash";
import { decryptPayload } from "@/lib/platform/tenant-crypto";
import type { InviteRecord } from "@/lib/platform/invite-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { tokens?: unknown }
      | null;
    if (!body || !Array.isArray(body.tokens) || body.tokens.length === 0) {
      return NextResponse.json(
        { error: "tokens: ikke-tom array av strenger kreves" },
        { status: 400 },
      );
    }
    const tokens: string[] = [];
    for (const x of body.tokens) {
      if (typeof x !== "string" || x.length === 0) {
        return NextResponse.json(
          { error: "tokens: alle elementer må være ikke-tomme strenger" },
          { status: 400 },
        );
      }
      tokens.push(x);
    }

    const client = getCentralRedis();
    const errors: string[] = [];
    let deletedCount = 0;

    for (const token of tokens) {
      try {
        // Hent recorden for å vite parentTenant — så vi kan rydde indeks-SREM
        const blob = await client.get(`invite:${token}`);
        if (!blob) {
          // Allerede borte fra invite:<token> — prøv likevel å rydde
          // potensielle indeks-rester (vi vet ikke prefiks her).
          // Trygt no-op for normale tilfeller.
          continue;
        }
        let parentTenant: string | null = null;
        try {
          const rec = decryptPayload<InviteRecord>(
            blob as Parameters<typeof decryptPayload>[0],
          );
          parentTenant = rec.parentTenant;
        } catch {
          // Decrypt feilet — slett uansett recorden, hopp indeks-cleanup
          parentTenant = null;
        }
        await client.del(`invite:${token}`);
        if (parentTenant) {
          await client.srem(`invite-index:${parentTenant}`, token);
        }
        deletedCount++;
      } catch (e) {
        errors.push(`${token}: ${e instanceof Error ? e.message : e}`);
      }
    }

    return NextResponse.json({ deletedCount, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/orphan-invites/bulk-delete POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
