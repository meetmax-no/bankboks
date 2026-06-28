/**
 * Ko | Do · Vault — Iter 20.2 — POST /api/am-admin/auth/logout
 *
 * Sletter am-admin session-cookien. Idempotent — kan kalles uten gyldig
 * session (middleware har eksplisitt unntak).
 */
import { NextResponse } from "next/server";
import { ORG_ADMIN_SESSION_COOKIE } from "@/lib/platform/org-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
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
