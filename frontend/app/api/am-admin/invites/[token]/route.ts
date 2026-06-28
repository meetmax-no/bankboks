/**
 * Ko | Do · Vault — Iter 20.3 — am-admin enkelt-invitasjons-handlinger
 *
 * DELETE → slett invitasjon (cross-org-sikret)
 * POST   → resend (re-send invite-mail). Bumper IKKE expiresAt — om
 *          invitasjonen er utløpt, må super-admin slette og opprette ny
 *          (vi avviser med 409 invite_expired).
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  deleteInvite,
  getInvite,
  putInvite,
} from "@/lib/platform/invite-store";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { sendInviteEmail } from "@/lib/platform/notify-email";
import { logEvent } from "@/lib/platform/provisioning-log";
import { buildInviteUrl } from "@/lib/platform/invite-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;
  const { token } = await ctx.params;

  const invite = await getInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
  }
  if (invite.parentTenant !== admin.tenantPrefix) {
    return NextResponse.json(
      { error: "forbidden_cross_org" },
      { status: 403 },
    );
  }
  await deleteInvite(invite);
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;
  const { token } = await ctx.params;

  const invite = await getInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "invite_not_found" }, { status: 404 });
  }
  if (invite.parentTenant !== admin.tenantPrefix) {
    return NextResponse.json(
      { error: "forbidden_cross_org" },
      { status: 403 },
    );
  }
  if (invite.status === "used") {
    return NextResponse.json(
      { error: "invite_already_used" },
      { status: 409 },
    );
  }
  // Avvis resend på utløpte invitasjoner — ellers ville vi mailet en
  // dead link. Super-admin må slette + opprette ny.
  if (
    invite.status === "expired" ||
    new Date(invite.expiresAt).getTime() < Date.now()
  ) {
    return NextResponse.json(
      {
        error: "invite_expired",
        detail:
          "Invitasjonen er utløpt. Slett den og opprett en ny invitasjon.",
      },
      { status: 409 },
    );
  }
  if (!invite.email) {
    return NextResponse.json(
      { error: "no_recipient", detail: "Invite har ingen e-post — kan ikke resendes." },
      { status: 400 },
    );
  }

  const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }
  const orgName =
    [parent.firstName, parent.lastName].filter(Boolean).join(" ").trim() ||
    parent.subdomain;
  const inviteUrl = buildInviteUrl(invite.token, invite.parentTenant);

  const sendResult = await sendInviteEmail({
    recipientEmail: invite.email,
    recipientFirstName: invite.firstName,
    recipientLocale: invite.locale,
    orgName,
    inviteUrl,
  });

  if (sendResult.ok) {
    const now = new Date().toISOString();
    await putInvite({ ...invite, mailSentAt: now });
    try {
      await logEvent(
        parent.subdomain,
        "invite_mail_sent",
        "ok",
        `child=${invite.subdomain} (resend av ${admin.email})`,
      );
    } catch (e) {
      console.error("[am-admin/invites/resend] log feilet:", e);
    }
    return NextResponse.json({ ok: true, mailSent: true, inviteUrl });
  }

  return NextResponse.json(
    {
      ok: false,
      mailSent: false,
      reason: sendResult.reason ?? sendResult.error,
      inviteUrl,
    },
    { status: 502 },
  );
}
