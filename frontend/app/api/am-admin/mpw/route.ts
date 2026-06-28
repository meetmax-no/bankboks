/**
 * Ko | Do · Vault — Iter 20.5b — DELETE /api/am-admin/mpw
 *
 * "Glemt MPW"-reset. Sletter verifier-envelope irreversibelt. Per
 * blokker-svar 4=B (2026-06-26): Iter 20.5c vil utvide denne ruten til
 * også å slette alle krypterte adminNotes-payloads i samme operasjon.
 *
 * Idempotent: trygt å kalle selv om ingen MPW finnes.
 *
 * Krever super-admin-rolle — vanlige admins kan ikke trigge org-wide
 * data-tap. (D-079 risk-mitigation.)
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/am-admin-session-helper";
import { deleteMpwVerifier } from "@/lib/platform/am-admin-mpw-store";
import { deleteAllNotes } from "@/lib/platform/am-admin-notes-store";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { logEvent } from "@/lib/platform/provisioning-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  // Per blokker-svar 4=B (2026-06-26): "Glemt MPW" sletter verifier
  // OG alle krypterte admin-notater i samme operasjon. Rekkefølge:
  //   1. Slett verifier (klienten kan dermed ikke fortsette å bruke
  //      eventuell cached key — neste status-poll viser none).
  //   2. Slett alle notes (de er nå uleselige uansett, men vi sletter
  //      for å frigi Upstash-plass og unngå dangling data).
  await deleteMpwVerifier(admin.tenantPrefix);
  const deletedNotes = await deleteAllNotes(admin.tenantPrefix);

  // Audit — kritisk handling som irreversibelt sletter krypterte payloads.
  try {
    const parent = await findB2BTenantByPrefix(admin.tenantPrefix);
    if (parent) {
      await logEvent(
        parent.subdomain,
        "am_admin_mpw_reset",
        "ok",
        `by=${admin.email} (super-admin) deletedNotes=${deletedNotes}`,
      );
    }
  } catch (e) {
    console.error("[am-admin/mpw DELETE] log feilet:", e);
  }

  return NextResponse.json({ ok: true, deletedNotes });
}
