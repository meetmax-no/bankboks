/**
 * Ko | Do · Vault — D-076 Internal Tenant Status RPC
 *
 * Endepunkt for tenant-poder å spørre om sin egen status uten å eie
 * sentral-creds. Brukes av write-block-helperen i tenant-podden
 * (`lib/server/tenant-status-cache.ts`).
 *
 * Sikkerhet:
 *   - Beskyttet med `Authorization: Bearer ${INTERNAL_RPC_SECRET}`
 *   - Returnerer KUN `{ status, lockedAt }` — ingen andre tenant-felter
 *   - Tenant-pod og admin må dele INTERNAL_RPC_SECRET via Vercel env
 *
 * D-071-compliance:
 *   - Lever kun på admin-domenet (admin.kodovault.no)
 *   - Tenant-podens kall går cross-domain. INGEN rewrite trengs siden
 *     tenant-poden eksplisitt fetch'er https://admin.kodovault.no/...
 *
 * Status-confidentiality (D-076.1, framlagt):
 *   - Per dato kan hvem som helst med RPC_SECRET spørre om hvilken som
 *     helst tenant. Lav risk siden hemmeligheten kun er i serverside
 *     env. Master-password-bound autorisasjon kommer senere.
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // ─── 1. Auth ──────────────────────────────────────────────────────
  const secret = process.env.INTERNAL_RPC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "rpc_not_configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (provided !== secret) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ─── 2. Parse subdomain ───────────────────────────────────────────
  const url = new URL(req.url);
  const subdomain = url.searchParams.get("sub")?.trim().toLowerCase();
  if (!subdomain) {
    return NextResponse.json(
      { ok: false, error: "missing_sub" },
      { status: 400 },
    );
  }

  // ─── 3. Slå opp tenant — kun status + lockedAt eksponeres ─────────
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "tenant_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: tenant.status,
      lockedAt: tenant.lockedAt,
    },
    {
      // Korte cache-headere — admin-data kan forandre seg når som helst.
      // Tenant-podens egen TTL (5 min) er den primære cache-laget.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
