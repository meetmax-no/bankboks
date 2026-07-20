/**
 * Ko | Do · Vault — D-149 (2026-02) — Vault unlock heartbeat
 *
 * POST /api/vault/heartbeat
 *
 * Kalles av klienten umiddelbart ETTER vellykket unlock. Bumper
 * `dailyActivity.unlocks[today]++` via internal RPC til admin-pod
 * (siden vault-pods ikke har CENTRAL_KV_* per D-071).
 *
 * Zero-knowledge preservert: server ser kun at unlock skjedde, ikke hva.
 *
 * Failsoft: returnerer 200 uansett — analytics må aldri blokkere
 * unlock-flyten.
 */
import { NextResponse } from "next/server";
import { checkHostMatchesPod } from "@/lib/server/vault-host-guard";
import { bumpActivityViaRpc } from "@/lib/server/activity-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const hostMismatch = checkHostMatchesPod(req);
  if (hostMismatch) return hostMismatch;

  const sub = process.env.NEXT_PUBLIC_CLIENT_CONFIG;
  if (!sub || sub === "default") {
    return NextResponse.json({ ok: true, tracked: false });
  }

  await bumpActivityViaRpc(sub, "unlocks");
  return NextResponse.json({ ok: true, tracked: true });
}
