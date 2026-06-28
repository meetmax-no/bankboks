/**
 * Ko | Do · Vault — Iter 20.5b — POST /api/am-admin/mpw/setup
 *
 * Setter opp MPW-verifier-envelope for innlogget am-admin sin org.
 * Avslår med 409 hvis verifier allerede finnes (caller må bruke
 * `DELETE /api/am-admin/mpw` først for "Glemt MPW"-reset).
 *
 * Body: { envelope: MpwEnvelope } — generert klient-side av
 * `createMpwVerifier(password)`. MPW-passordet forlater ALDRI klienten.
 *
 * Per D-079: server validerer kun envelope-shape (isMpwEnvelope), aldri
 * innholdet.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  setMpwVerifierIfAbsent,
} from "@/lib/platform/am-admin-mpw-store";
import { isMpwEnvelope } from "@/lib/platform/am-admin-mpw";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { logEvent } from "@/lib/platform/provisioning-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const envelope =
    body && typeof body === "object"
      ? (body as { envelope?: unknown }).envelope
      : null;
  if (!isMpwEnvelope(envelope)) {
    return NextResponse.json({ error: "invalid_envelope" }, { status: 400 });
  }

  // Atomisk SETNX — lukker TOCTOU-vinduet hvor to samtidige super-admin-
  // setup-kall begge kunne passere get→null-sjekken og den siste SET'en
  // silently overskriver den første. Returnerer false hvis verifier
  // allerede eksisterer (caller må bruke DELETE-reset først).
  const wasSet = await setMpwVerifierIfAbsent(admin.tenantPrefix, envelope);
  if (!wasSet) {
    return NextResponse.json(
      {
        error: "mpw_already_set",
        detail: "MPW er allerede satt for denne organisasjonen. Bruk reset-flowen først.",
      },
      { status: 409 },
    );
  }

  // Audit på parent for synlighet i Mike's panel.
  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (parent) {
      await logEvent(
        parent.subdomain,
        "am_admin_mpw_setup",
        "ok",
        `by=${admin.email}`,
      );
    }
  } catch (e) {
    console.error("[am-admin/mpw/setup] log feilet:", e);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
