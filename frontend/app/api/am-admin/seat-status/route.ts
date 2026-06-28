/**
 * Ko | Do · Vault — D-092 (2026-06-28) — Hybrid-seat status for Konsoll-UI
 *
 * GET /api/am-admin/seat-status
 *
 * Returnerer kapasitets-status for parent-tenant til innlogget am-admin.
 *
 * Per Mike's spec 2026-06-28 (hybrid-seat):
 *   - activeLicenses = TenantRecord.activeLicenses (aksepterte ansatte)
 *   - pendingInvites = invites med status="pending" som ikke er utløpt
 *   - maxLicenses   = TenantRecord.maxLicenses (null eller 0 → ubegrenset)
 *   - availableSeats = max(0, maxLicenses - activeLicenses - pendingInvites)
 *   - blocked       = true når availableSeats === 0 (kun når maxLicenses > 0)
 *
 * Beskyttet av am-admin-session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { countActivePendingInvites } from "@/lib/platform/invite-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  const activeLicenses = parent.activeLicenses ?? 0;
  const pendingInvites = await countActivePendingInvites(admin.tenantPrefix);
  const maxLicenses = parent.maxLicenses ?? null;
  const hasCap = typeof maxLicenses === "number" && maxLicenses > 0;
  const availableSeats = hasCap
    ? Math.max(0, maxLicenses - activeLicenses - pendingInvites)
    : null;
  const blocked = hasCap ? availableSeats === 0 : false;

  return NextResponse.json({
    activeLicenses,
    pendingInvites,
    maxLicenses,
    availableSeats,
    blocked,
    hasCap,
  });
}
