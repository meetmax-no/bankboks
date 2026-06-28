/**
 * Ko | Do · Vault — v4.3 Iter 9 (D-066) — Public /api/status
 *
 * GET /api/status?subdomain=<subdomain>
 *
 * Brukes av Skjerm 5 (post-registrering) for å polle progresjonen mens
 * Vercel-deployen bygger. Returnerer current vault_live-state + de siste
 * 5 provisjonerings-eventene.
 *
 * Hver request trigger en on-demand check mot Vercel deployment-API hvis
 * vault ennå ikke er live — vi har ingen background-prosess (serverless).
 *
 * Rate limit: ingen — frontend poller hvert 2. sek og vi vil heller
 * resolve raskt enn å blokkere. CORS åpent for *.kodovault.no.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkDeploymentOnce } from "@/lib/platform/poll-deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(origin: string | null): Record<string, string> {
  // Tillat alle *.kodovault.no + admin.kodovault.no
  const ok =
    origin && (origin.endsWith(".kodovault.no") || origin === "https://kodovault.no");
  return {
    "Access-Control-Allow-Origin": ok ? origin : "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  try {
    const subdomain = (
      req.nextUrl.searchParams.get("subdomain") ?? ""
    )
      .toLowerCase()
      .trim();
    if (!subdomain || !/^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]?$/.test(subdomain)) {
      return NextResponse.json(
        { error: "invalid_subdomain" },
        { status: 400, headers },
      );
    }
    const result = await checkDeploymentOnce(subdomain);
    if (!result) {
      return NextResponse.json(
        { error: "tenant_not_found" },
        { status: 404, headers },
      );
    }
    return NextResponse.json(result, { status: 200, headers });
  } catch (e) {
    console.error("[api/status]", e);
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json({ error: msg }, { status: 500, headers });
  }
}
