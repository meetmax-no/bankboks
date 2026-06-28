/**
 * Ko | Do · Vault — v4.3 Iter 0 — POST /api/admin/logout
 *
 * Sletter session-cookien. Idempotent — kan kalles selv uten gyldig session
 * (middleware har eksplisitt unntak for denne ruten).
 */
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/platform/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return res;
}
