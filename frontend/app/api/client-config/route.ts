/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Public client-config endpoint (D-060)
 *
 * GET /api/client-config?id=<subdomain>
 *   200 → { ok: true, config: {...} }
 *   404 → { ok: false, error: "not_found" }
 *
 * Public — innhold er kategorier/branding/farger, ikke sensitivt.
 * Tenantens app (testkonto22.kodovault.no, etc.) kaller HIT på
 * admin.kodovault.no via CORS.
 *
 * CORS: tillater alle *.kodovault.no-subdomener.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { getClientConfig } from "@/lib/platform/client-config-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed =
    /^https?:\/\/([a-z0-9-]+\.)?kodovault\.no(:\d+)?$/i.test(origin) ||
    /^https?:\/\/localhost(:\d+)?$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://kodovault.no",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const cors = corsHeaders(req);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.toLowerCase().trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing_id" },
      { status: 400, headers: cors },
    );
  }
  try {
    const config = await getClientConfig(id);
    if (!config) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: cors },
      );
    }
    return NextResponse.json(
      { ok: true, config },
      {
        headers: {
          ...cors,
          "Cache-Control": "public, max-age=30, s-maxage=300",
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[api/client-config]", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: msg },
      { status: 500, headers: cors },
    );
  }
}
