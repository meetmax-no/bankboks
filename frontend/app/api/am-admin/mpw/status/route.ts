/**
 * Ko | Do · Vault — Iter 20.5b — GET /api/am-admin/mpw/status
 *
 * Returnerer om MPW er satt opp for innlogget am-admin sin org, og om så
 * ER tilfelle: hele envelopen så klienten kan verifisere passord lokalt
 * uten ekstra rundtur.
 *
 * Per D-079 (zero-knowledge): envelopen er opaque for serveren. Vi
 * returnerer den til klienten som henter den, fordi vi MÅ kunne avgjøre
 * om setup vs unlock-modal skal vises.
 *
 * Krever am-admin-session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { getMpwVerifier } from "@/lib/platform/am-admin-mpw-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const envelope = await getMpwVerifier(admin.tenantPrefix);
  return NextResponse.json({
    enabled: envelope !== null,
    envelope,
  });
}
