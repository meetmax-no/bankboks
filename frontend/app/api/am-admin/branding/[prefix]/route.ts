/**
 * Ko | Do · Vault — D-114 (2026-06-29) — Public branding-endpoint
 *
 * GET /api/am-admin/branding/[prefix]
 *
 * Returnerer ikke-sensitiv branding-info for en B2B-parent. Brukes av
 * login-siden (`/platform/am-admin/login`) til å vise firmanavn ved
 * pålogging — slik at brukeren ser HVILKEN firma-konto de logger inn på,
 * ikke bare en svart bakgrunn.
 *
 * Bevisst PUBLIC — ingen auth. Avslører kun:
 *   - prefix (allerede synlig i URL-en)
 *   - companyName (skulle vært på fakturaer, visittkort, etc.)
 *
 * IKKE inkludert (ikke vurdert som sensitivt, men holdes minimalt):
 *   - email, orgnr, adresser, plan, status
 *
 * 404 hvis prefiks ikke har en B2B-parent.
 */
import { NextResponse, type NextRequest } from "next/server";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ prefix: string }> },
) {
  const { prefix: rawPrefix } = await params;
  const prefix = rawPrefix.trim().toLowerCase();

  if (!/^[a-z0-9-]{2,32}$/.test(prefix)) {
    return NextResponse.json({ error: "invalid_prefix" }, { status: 400 });
  }

  const parent = await findB2BTenantByPrefix(prefix);
  if (!parent) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    prefix,
    companyName: parent.companyName ?? null,
  });
}
