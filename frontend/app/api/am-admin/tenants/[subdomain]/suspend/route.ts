/**
 * Ko | Do · Vault — Iter 20.3 — POST /api/am-admin/tenants/[subdomain]/suspend
 *
 * Setter `status: "suspended"` på ansatt-tenant. Reverserbart via /unsuspend.
 * Data bevares — vault-pod-en sjekker sentral status (per blokker-svar 5=a)
 * og blokkerer unlock så lenge suspendert.
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
    return NextResponse.json(
      { error: "cannot_suspend_parent" },
      { status: 400 },
    );
  }
  if (tenant.status === "suspended") {
    return NextResponse.json({ ok: true, status: tenant.status, idempotent: true });
  }
  if (tenant.status === "deleted" || tenant.status === "cancelled") {
    return NextResponse.json(
      {
        error: "invalid_state_transition",
        detail: `Kan ikke suspendere en konto med status "${tenant.status}".`,
      },
      { status: 409 },
    );
  }

  const updated = {
    ...tenant,
    status: "suspended" as const,
    suspendedAt: new Date().toISOString(),
  };
  await putTenant(updated);

  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (parent) {
      await logEvent(
        parent.subdomain,
        "tenant_suspended",
        "ok",
        `child=${subdomain} suspendert av ${admin.email}`,
      );
    }
    await logEvent(
      subdomain,
      "tenant_suspended",
      "ok",
      `Suspendert av am-admin ${admin.email}`,
    );
  } catch (e) {
    console.error("[am-admin/suspend] log feilet:", e);
  }

  return NextResponse.json({ ok: true, status: "suspended" });
}
