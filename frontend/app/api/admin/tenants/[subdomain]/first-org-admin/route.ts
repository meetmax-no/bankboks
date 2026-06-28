/**
 * Ko | Do · Vault — D-107 (2026-06-28, Mike) — first-org-admin
 *
 * GET /api/admin/tenants/[subdomain]/first-org-admin
 *
 * Returnerer den OPPRINNELIGE super-adminen som ble opprettet ved B2B-
 * onboarding. Brukes i super-admin TenantViewer → Lisens & B2B-fanen.
 *
 * Hvilken regnes som "første":
 *   1. Record med `isFirstSuperAdmin === true` (eksplisitt flagg).
 *   2. Fallback: eldste `createdAt` blant super-admins for prefiks (backfill
 *      settes automatisk ved første kall til `getFirstSuperAdmin()`).
 *
 * D-078: Returnerer KUN org-admin-PII (super-admin er B2B-kontakt for
 * fakturering — Mike-admin trenger å vite hvem). Ingen ansatt-PII.
 */
import { NextResponse } from "next/server";
import { findB2BTenantByPrefix, getTenant } from "@/lib/platform/tenant-store";
import { getFirstSuperAdmin } from "@/lib/platform/org-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

export async function GET(_req: Request, { params }: Params) {  const { subdomain } = await params;
  if (!subdomain) {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }

  const record = await getTenant(subdomain);
  if (!record) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (record.customerType !== "b2b" || !record.tenantPrefix) {
    return NextResponse.json(
      { error: "not_a_b2b_parent" },
      { status: 400 },
    );
  }

  // Sjekk at det er en parent (ikke child)
  if (record.parentTenant) {
    return NextResponse.json(
      { error: "not_a_b2b_parent" },
      { status: 400 },
    );
  }

  // Verifiser at prefiks matcher tenant via central lookup (defense-in-depth)
  const parent = await findB2BTenantByPrefix(record.tenantPrefix);
  if (!parent || parent.subdomain !== subdomain) {
    return NextResponse.json({ error: "tenant_mismatch" }, { status: 400 });
  }

  const first = await getFirstSuperAdmin(record.tenantPrefix);
  if (!first) {
    return NextResponse.json({ admin: null });
  }

  return NextResponse.json({
    admin: {
      firstName: first.firstName,
      lastName: first.lastName,
      email: first.email,
      createdAt: first.createdAt,
      suspended: first.suspended,
    },
  });
}
