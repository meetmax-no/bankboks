/**
 * Ko | Do · Vault — v4.3 Iter 0 (revidert) — POST /api/admin/session/start
 *
 * Kalles av klienten automatisk etter vault-unlock på admin.kodovault.no.
 * Setter HMAC-signert HttpOnly cookie `kodo_admin_session` → middleware slipper
 * brukeren videre til /platform/admin/*.
 *
 * Per Mike's beslutning (2026-06-01, D-035-fortolkning):
 *   "admin.kodovault.no + vault unlocked = admin-tilgang"
 *
 * Ingen separat admin-pwd, ingen Argon2id-hash, ingen credential-generator.
 * Vault-unlock skjer 100% klient-side (zero-knowledge bevart, D-001).
 *
 * ─── Trusselsmodell (soft trust) ───────────────────────────────────────────
 * Server kan IKKE kryptografisk verifisere at klienten faktisk har unlocked
 * vault'en — det ville krevd en credential på server-siden (hash/token/key).
 * Dette endepunktet stoler derfor på at klienten kun kaller det etter ekte
 * unlock. Beskyttelse mot uvedkommende:
 *   1. Host-lock — kun admin.kodovault.no (+ dev/preview-hosts) kan kalle
 *   2. SameSite=Strict + Origin-sjekk — cross-origin POST blokkeres
 *   3. Cookie er HMAC-signert med ADMIN_SESSION_SECRET — kan ikke forfalskes
 *
 * Restrisiko: noen som faktisk besøker admin.kodovault.no i en nettleser
 * og kjenner endepunkt-URL'en kan kalle det direkte uten å unlocke vault.
 * Beskyttelse hviler da på at admin.kodovault.no ikke er offentliggjort.
 * v4.4 ("Autentiseringsarkitektur") legger på kryptografisk unlock-bevis.
 */
import { NextResponse } from "next/server";
import {
  ADMIN_HOST,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  signAdminSession,
} from "@/lib/platform/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHost(req: Request): string {
  const fwd = req.headers.get("x-forwarded-host");
  const host = (fwd ?? req.headers.get("host") ?? "").toLowerCase();
  return host.split(":")[0];
}

function isAdminHost(host: string): boolean {
  if (host === ADMIN_HOST) return true;
  if (process.env.NODE_ENV !== "production") {
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".preview.emergentagent.com") ||
      host.endsWith(".preview.emergentcf.cloud") ||
      host.endsWith(".vercel.app")
    ) {
      return true;
    }
  }
  return false;
}

function isSameOrigin(req: Request, host: string): boolean {
  // Origin-header er satt på alle moderne POST-kall fra nettlesere.
  // Sjekk at den matcher Host — blokkerer cross-origin POST.
  const origin = req.headers.get("origin");
  if (!origin) {
    // Eldre klienter eller direkte curl kan mangle Origin. I prod er det
    // strengt — i dev/preview tillater vi det for å la testing fungere.
    return process.env.NODE_ENV !== "production";
  }
  try {
    const originHost = new URL(origin).hostname.toLowerCase();
    return originHost === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const host = getHost(req);

  if (!isAdminHost(host)) {
    return NextResponse.json({ error: "forbidden_host" }, { status: 403 });
  }
  if (!isSameOrigin(req, host)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  if (!secret) {
    console.error("[admin-session] ADMIN_SESSION_SECRET mangler");
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  const cookieValue = await signAdminSession(secret);

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return res;
}
