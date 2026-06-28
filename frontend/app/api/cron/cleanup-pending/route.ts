/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /api/cron/cleanup-pending (D-056)
 *
 * Vercel Cron-jobb (skedulert i `vercel.json`). Kjører én gang per dag og
 *  - finner alle invitasjoner med status "pending" og expiresAt < now
 *  - setter status = "expired"
 *  - appender notis til parent-tenant's notes-felt
 *
 * Beskyttet med `CRON_SECRET` (Vercel-konvensjon): Authorization-header
 * må være `Bearer <CRON_SECRET>` ELLER Vercel sin `x-vercel-cron`-header
 * må være satt. Begge sjekkes — Vercel selv setter den automatiske
 * headeren ved skedulerte kall.
 */
import { NextResponse } from "next/server";
import { listAllInvites, putInvite } from "@/lib/platform/invite-store";
import { isInviteExpired } from "@/lib/platform/invite-types";
import { findB2BTenantByPrefix, putTenant } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  return false;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = {
    scanned: 0,
    expired: 0,
    parentsTouched: [] as string[],
    errors: [] as string[],
  };

  try {
    const invites = await listAllInvites();
    summary.scanned = invites.length;
    const now = new Date();

    for (const invite of invites) {
      if (invite.status !== "pending") continue;
      if (!isInviteExpired(invite, now)) continue;

      try {
        // 1. Marker invitasjon som expired
        await putInvite({ ...invite, status: "expired" });
        summary.expired++;

        // 2. Append notis til parent-tenant
        const parent = await findB2BTenantByPrefix(invite.parentTenant);
        if (parent) {
          const ts = now.toISOString();
          const note = `[${ts}] System: Invitasjon for ${invite.subdomain} utløpt`;
          const newNotes = parent.notes
            ? `${parent.notes}\n${note}`
            : note;
          await putTenant({ ...parent, notes: newNotes });
          if (!summary.parentsTouched.includes(parent.subdomain)) {
            summary.parentsTouched.push(parent.subdomain);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        summary.errors.push(`${invite.token}: ${msg}`);
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[cron/cleanup-pending]", err);
    return NextResponse.json(
      { ok: false, error: msg, ...summary },
      { status: 500 },
    );
  }
}
