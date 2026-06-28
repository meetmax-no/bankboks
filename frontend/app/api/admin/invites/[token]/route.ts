/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /api/admin/invites/[token] (D-056)
 *
 * DELETE                          → slett invitasjon
 * POST   (action: "resend")       → invalider gammel + opprett ny
 *
 * Beskyttet av middleware. Slett og resend krever begge at admin har
 * gyldig session.
 */
import { NextResponse } from "next/server";
import {
  createInvite,
  deleteInvite,
  getInvite,
} from "@/lib/platform/invite-store";
import { buildInviteUrl } from "@/lib/platform/invite-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { token } = await params;
  try {
    const invite = await getInvite(token);
    if (!invite) {
      // Idempotent — allerede borte
      return NextResponse.json({ ok: true, removed: false });
    }
    const removed = await deleteInvite(invite);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/invites DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST { action: "resend" } — invaliderer gammel invitasjon og oppretter
 * ny med samme subdomain/email/parent. Returnerer ny token + URL.
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.action !== "resend") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  try {
    const old = await getInvite(token);
    if (!old) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (old.status === "used") {
      return NextResponse.json(
        { error: "already_used" },
        { status: 409 },
      );
    }
    // Slett gammel, opprett ny med samme data
    await deleteInvite(old);
    const fresh = await createInvite({
      subdomain: old.subdomain,
      parentTenant: old.parentTenant,
      email: old.email ?? undefined,
      firstName: old.firstName ?? undefined,
      lastName: old.lastName ?? undefined,
      locale: old.locale ?? undefined,
      // D-095 (2026-06-28): bevar samme parent-FK-link ved resend
      parentTenantCreatedAt: old.parentTenantCreatedAt ?? null,
    });
    const inviteUrl = buildInviteUrl(fresh.token, fresh.parentTenant);
    return NextResponse.json({ invite: fresh, inviteUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/invites resend]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
