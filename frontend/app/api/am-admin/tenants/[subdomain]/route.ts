/**
 * Ko | Do · Vault — Iter 20.3 — am-admin tenant-handlinger
 *
 * POST   → ingen (suspender/unsuspender via egne sub-ruter)
 * DELETE → permanent sletting (kaskade D-070) av ansatt-tenant
 *
 * Krever cross-org-sjekk: subdomain MÅ starte med admin.tenantPrefix.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  assertSubdomainBelongsToOrg,
  requireAmAdmin,
} from "@/lib/platform/am-admin-session-helper";
import { getTenant } from "@/lib/platform/tenant-store";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import { logEvent } from "@/lib/platform/provisioning-log";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;
  const { subdomain } = await ctx.params;

  // Cross-org-sjekk
  const forbidden = assertSubdomainBelongsToOrg(subdomain, admin.tenantPrefix);
  if (forbidden) return forbidden;

  // Verifiser at tenanten eksisterer
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  // Forbi å slette parent — am-admin skal kun kunne slette ansatte
  if (tenant.subdomain === admin.tenantPrefix) {
    return NextResponse.json(
      { error: "cannot_delete_parent" },
      { status: 400 },
    );
  }

  // Full kaskade-sletting (D-070): Stripe, Vercel, Upstash, indices.
  const result = await deleteTenant(subdomain, "admin");

  // Logg audit-event på parent
  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (parent) {
      await logEvent(
        parent.subdomain,
        "tenant_deleted",
        result.success ? "ok" : "failed",
        `child=${subdomain} slettet av ${admin.email}`,
      );
    }
  } catch (e) {
    console.error("[am-admin/tenants DELETE] log feilet:", e);
  }

  return NextResponse.json({
    ok: result.success,
    subdomain,
    detail: result.success
      ? "Ansatt-konto slettet (kaskade fullført)."
      : `Sletting feilet: ${result.errors?.join("; ") ?? "ukjent"}`,
  }, { status: result.success ? 200 : 500 });
}
