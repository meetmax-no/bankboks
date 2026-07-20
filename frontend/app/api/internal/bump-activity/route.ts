/**
 * Ko | Do · Vault — D-149 (2026-02) — Internal activity-bump RPC
 *
 * POST /api/internal/bump-activity
 *
 * Kalles fra vault-pods (som ikke har CENTRAL_KV_* env-vars per D-071)
 * for å bumpe daglig aktivitets-teller på central Upstash.
 *
 * Auth: `Authorization: Bearer ${INTERNAL_RPC_SECRET}`
 *
 * Body: { subdomain: string, kind: "unlocks" | "writes" | "reads" }
 *
 * Failsoft: retunerer 200 uansett — analytics må aldri blokkere
 * vault-kritisk-path.
 */
import { NextResponse } from "next/server";
import { bumpDailyActivity } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.INTERNAL_RPC_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { subdomain?: string; kind?: string };
  try {
    body = (await req.json()) as { subdomain?: string; kind?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { subdomain, kind } = body;
  if (
    !subdomain ||
    !kind ||
    (kind !== "unlocks" && kind !== "writes" && kind !== "reads")
  ) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  try {
    await bumpDailyActivity(subdomain, kind, 365);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.warn(
      `[internal/bump-activity D-149] failed for ${subdomain}/${kind}:`,
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json({ ok: true, warned: true });
  }
}
