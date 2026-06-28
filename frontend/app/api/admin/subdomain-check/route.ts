/**
 * Ko | Do · Vault — v4.3 — /api/admin/subdomain-check
 *
 * Admin-flow tilgjengelighets-sjekk. Per Mike 2026-06-02:
 *   - Admin har FULL overstyringsrett.
 *   - `isReservedSubdomain()` brukes KUN i selvbetjent /api/register +
 *     /api/register/paid (B2C-spam-vern).
 *   - Her sjekker vi BARE format (regex) og duplikat (tenantExists).
 *
 * GET ?subdomain=<s>
 *   → { available: true }
 *   → { available: false, reason: "invalid_format" | "taken" }
 *
 * Beskyttet av middleware (admin-session-cookie kreves) — samme som resten
 * av /api/admin/*.
 */
import { NextResponse } from "next/server";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import { tenantExists } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const subdomain = searchParams.get("subdomain");

  if (!subdomain || typeof subdomain !== "string") {
    return NextResponse.json(
      { available: false, reason: "invalid_format" },
      { status: 400 },
    );
  }

  const normalized = subdomain.toLowerCase().trim();
  if (!isValidSubdomainFormat(normalized)) {
    return NextResponse.json({ available: false, reason: "invalid_format" });
  }

  try {
    if (await tenantExists(normalized)) {
      return NextResponse.json({ available: false, reason: "taken" });
    }
    return NextResponse.json({ available: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/subdomain-check]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
