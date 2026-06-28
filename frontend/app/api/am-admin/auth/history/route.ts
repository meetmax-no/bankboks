/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — am-admin login-historikk
 *
 * GET /api/am-admin/auth/history?days=90
 *
 * Returnerer egen innlogginghistorikk (siste 90 dager, maks 50 events).
 * Alle admin-roller (admin + super-admin) kan kalle. Hver admin ser KUN
 * sine egne events — det er ingen "se alle"-modus selv for super-admin
 * (per privacy-by-default).
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { listLoginEvents } from "@/lib/platform/org-admin-login-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const daysRaw = url.searchParams.get("days");
  let days = 90;
  if (daysRaw) {
    const parsed = parseInt(daysRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 365) {
      days = parsed;
    }
  }

  const events = await listLoginEvents(auth.ctx.admin.id, days);
  return NextResponse.json({
    adminId: auth.ctx.admin.id,
    days,
    count: events.length,
    events,
  });
}
