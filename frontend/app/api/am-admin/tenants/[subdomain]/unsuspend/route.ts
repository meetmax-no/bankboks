/**
 * Ko | Do · Vault — Iter 20.3 — POST /api/am-admin/tenants/[subdomain]/unsuspend
 *
 * Reverserer suspendering. Setter status tilbake til "active".
 * Idempotent.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  assertSubdomainBelongsToOrg,
  requireAmAdmin,
} from "@/lib/platform/am-admin-session-helper";
import {
  findB2BTenantByPrefix,
  getTenant,
  putTenant,
} from "@/lib/platform/tenant-store";
import { logEvent } from "@/lib/platform/provisioning-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;
  const { subdomain } = await ctx.params;

  const forbidden = assertSubdomainBelongsToOrg(subdomain, admin.tenantPrefix);
  if (forbidden) return forbidden;

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  if (tenant.subdomain === admin.tenantPrefix) {
    // Defense-in-depth: assertSubdomainBelongsToOrg blokkerer allerede plain
    // prefix (uten "-"), men vi beholder denne for symmetri med suspend-ruten
    // og som ekstra audit-vennlig feilmelding.
    return NextResponse.json(
      { error: "cannot_unsuspend_parent" },
      { status: 400 },
    );
  }
  if (tenant.status !== "suspended") {
    return NextResponse.json({ ok: true, status: tenant.status, idempotent: true });
  }

  const updated = {
    ...tenant,
    status: "active" as const,
    suspendedAt: null,
  };
  await putTenant(updated);

  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (parent) {
      await logEvent(
        parent.subdomain,
        "tenant_unsuspended",
        "ok",
        `child=${subdomain} reaktivert av ${admin.email}`,
      );
    }
    await logEvent(
      subdomain,
      "tenant_unsuspended",
      "ok",
      `Reaktivert av am-admin ${admin.email}`,
    );
  } catch (e) {
    console.error("[am-admin/unsuspend] log feilet:", e);
  }

  return NextResponse.json({ ok: true, status: "active" });
}
