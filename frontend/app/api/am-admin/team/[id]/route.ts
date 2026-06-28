/**
 * Ko | Do · Vault — Iter 20.9 (D-084) — am-admin team handlinger per admin
 *
 * DELETE /api/am-admin/team/[id]      — slett permanent (kun super-admin)
 * POST   /api/am-admin/team/[id]?action=suspend | unsuspend
 *
 * Håndhever `OrgAdminError.LastSuperAdmin`-invariant (siste super-admin kan
 * ikke slettes eller suspenderes). Selvslett blokkeres.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  deleteOrgAdmin,
  suspendOrgAdmin,
  unsuspendOrgAdmin,
} from "@/lib/platform/org-admin-store";
import {
  OrgAdminError,
  toOrgAdminPublic,
} from "@/lib/platform/org-admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapErrorStatus(code: string): number {
  if (code === OrgAdminError.NotFound) return 404;
  if (code === OrgAdminError.LastSuperAdmin) return 409;
  return 400;
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  // Selvslett-guard: en super-admin kan ikke slette seg selv via API.
  if (id === auth.ctx.admin.id) {
    return NextResponse.json(
      { error: "cannot_delete_self" },
      { status: 400 },
    );
  }

  const result = await deleteOrgAdmin(auth.ctx.session.prefix, id);
  if (typeof result === "string") {
    return NextResponse.json({ error: result }, { status: mapErrorStatus(result) });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Selvsuspendering blokkeres uansett.
  if (id === auth.ctx.admin.id && action === "suspend") {
    return NextResponse.json(
      { error: "cannot_suspend_self" },
      { status: 400 },
    );
  }

  if (action === "suspend") {
    const result = await suspendOrgAdmin(auth.ctx.session.prefix, id);
    if (typeof result === "string") {
      return NextResponse.json(
        { error: result },
        { status: mapErrorStatus(result) },
      );
    }
    return NextResponse.json({ ok: true, admin: toOrgAdminPublic(result) });
  }

  if (action === "unsuspend") {
    const result = await unsuspendOrgAdmin(auth.ctx.session.prefix, id);
    if (typeof result === "string") {
      return NextResponse.json(
        { error: result },
        { status: mapErrorStatus(result) },
      );
    }
    return NextResponse.json({ ok: true, admin: toOrgAdminPublic(result) });
  }

  return NextResponse.json(
    { error: "invalid_action", detail: "action=suspend|unsuspend" },
    { status: 400 },
  );
}
