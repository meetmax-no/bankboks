/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — logout-all-devices
 *
 * POST /api/am-admin/auth/logout-all
 *
 * Setter `admin.sessionsInvalidatedAt = now` på OrgAdmin-recorden. Alle
 * eksisterende session-cookies med iat før denne tiden vil avvises av
 * `requireAmAdmin` ved neste request. Sletter også current cookie.
 *
 * Tilgjengelig for ALLE admin-roller (per Mike-direktiv D-086 c=1):
 * en admin trenger ikke super-admin-tillatelse for å logge ut sine egne
 * enheter.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { ORG_ADMIN_SESSION_COOKIE } from "@/lib/platform/org-admin-auth";
import { putOrgAdmin } from "@/lib/platform/org-admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;

  const now = Math.floor(Date.now() / 1000);
  await putOrgAdmin({
    ...auth.ctx.admin,
    sessionsInvalidatedAt: now,
  });

  const res = NextResponse.json({ ok: true, sessionsInvalidatedAt: now });
  res.cookies.set({
    name: ORG_ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
