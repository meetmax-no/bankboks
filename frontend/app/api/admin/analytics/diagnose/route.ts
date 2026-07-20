/**
 * Ko | Do · Vault — D-149 (2026-02) — Analytics diagnose-endepunkt
 *
 * Diagnostikk for hvorfor `dailyActivity` er tom/null på tvers av tenants.
 * Beskyttet av admin-session-middleware.
 *
 * Mode "self-bump" (POST):
 *   Kaller `bumpDailyActivity(subdomain, kind)` DIREKTE fra admin-pod
 *   (uten RPC). Verifiserer at central-Upstash-siden fungerer end-to-end.
 *
 * Mode "rpc-selftest" (GET):
 *   Fra admin-pod, POSTer til seg selv (`ADMIN_INTERNAL_URL/api/internal/bump-activity`)
 *   med `INTERNAL_RPC_SECRET`. Verifiserer at secret er gyldig og at
 *   internal-RPC-endepunktet fungerer.
 */
import { NextResponse } from "next/server";
import { bumpDailyActivity, getTenant } from "@/lib/platform/tenant-store";
import { resolveAdminInternalUrl } from "@/lib/server/admin-url-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const subdomain = url.searchParams.get("subdomain")?.trim().toLowerCase();
  const kindRaw = url.searchParams.get("kind") ?? "reads";
  const kind =
    kindRaw === "unlocks" || kindRaw === "writes" || kindRaw === "reads"
      ? kindRaw
      : "reads";
  const count = Math.max(1, Math.min(100, parseInt(url.searchParams.get("count") ?? "1", 10) || 1));

  if (!subdomain) {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }

  const before = await getTenant(subdomain);
  if (!before) {
    return NextResponse.json({ error: "tenant_not_found", subdomain }, { status: 404 });
  }

  const results: boolean[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await bumpDailyActivity(subdomain, kind, 365));
  }

  const after = await getTenant(subdomain);
  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    ok: true,
    subdomain,
    kind,
    count,
    successCount: results.filter(Boolean).length,
    before: { dailyActivity: before.dailyActivity ?? null },
    after: {
      dailyActivity: after?.dailyActivity ?? null,
      todayCount: after?.dailyActivity?.[today] ?? null,
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const subdomain = url.searchParams.get("subdomain")?.trim().toLowerCase() ?? "diagnose-noop";

  const base = resolveAdminInternalUrl();
  const rawEnvUrl = process.env.ADMIN_INTERNAL_URL ?? "(unset)";
  const secret = process.env.INTERNAL_RPC_SECRET;

  const env = {
    ADMIN_INTERNAL_URL_raw: rawEnvUrl,
    resolvedBase: base,
    typoDetected: rawEnvUrl !== base && rawEnvUrl !== "(unset)",
    INTERNAL_RPC_SECRET_present: Boolean(secret),
    INTERNAL_RPC_SECRET_length: secret?.length ?? 0,
  };

  if (!secret) {
    return NextResponse.json({
      ok: false,
      reason: "INTERNAL_RPC_SECRET mangler på admin-pod — RPC vil aldri fungere",
      env,
    });
  }

  // Test admin-pod → admin-pod RPC med noop-subdomain (returnerer 404 tenant_not_found
  // = normalt tegn på at auth + endpoint-fungerer, bare tenanten finnes ikke).
  const startedAt = Date.now();
  try {
    const res = await fetch(`${base}/api/internal/bump-activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ subdomain, kind: "reads" }),
    });
    const elapsedMs = Date.now() - startedAt;
    const bodyText = await res.text().catch(() => "<no body>");
    let bodyJson: unknown = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      /* not JSON */
    }
    return NextResponse.json({
      ok: res.ok,
      httpStatus: res.status,
      elapsedMs,
      responseBody: bodyJson ?? bodyText.slice(0, 500),
      env,
      interpretation:
        res.status === 401
          ? "Secret-mismatch. INTERNAL_RPC_SECRET på admin-pod stemmer ikke med hva /api/internal/bump-activity forventer."
          : res.status === 200
            ? "RPC-pipeline OK. Problem må ligge på tenant-pod-siden (mismatch mellom tenant-pod og admin-pod secret)."
            : res.status === 404
              ? "Endepunkt mangler — bygget ikke deployet?"
              : `Uventet HTTP ${res.status}`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      reason: "Fetch feilet",
      error: e instanceof Error ? e.message : String(e),
      env,
    });
  }
}
