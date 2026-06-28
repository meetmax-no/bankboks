/**
 * Ko | Do · Vault — Iter 20.2 — POST /api/am-admin/auth/login
 *
 * am-admin login-endepunkt. Verifiserer epost + passord (bcrypt) mot
 * `org-admin:<prefix>:admin:<id>` på sentral Upstash, og setter HMAC-signert
 * session-cookie ved suksess.
 *
 * Host-låst: kun callable fra `<prefix>-admin.kodovault.no` (eller dev-host
 * med `?orgAdminPrefix=<prefix>` for preview). Middleware lar denne ruten
 * passere uten gyldig session.
 *
 * Per blokker-svar 1=b (per-org subdomain), 2026-06-26.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ORG_ADMIN_LOGIN_RATE_LIMIT,
  ORG_ADMIN_SESSION_COOKIE,
  ORG_ADMIN_SESSION_TTL_SECONDS,
  extractOrgAdminPrefix,
  signOrgAdminSession,
} from "@/lib/platform/org-admin-auth";
import { findOrgAdminByEmail, putOrgAdmin } from "@/lib/platform/org-admin-store";
import { verifyPassword } from "@/lib/platform/password-hash";
import { checkRateLimit, getClientIp } from "@/lib/platform/rate-limit";
import { recordLoginEvent } from "@/lib/platform/org-admin-login-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getHost(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-host");
  return (fwd ?? req.headers.get("host") ?? "").toLowerCase().split(":")[0];
}

export async function POST(req: NextRequest) {
  try {
    return await handleLogin(req);
  } catch (err) {
    // Iter 20.9 (Mike 2026-06-27): full unhandled-exception logging.
    // Tidligere klatret throwet ut og ga 500 uten noen logg — umulig å
    // debugge på prod. Vi logger med strukturert `[ALERT]`-tag.
    console.error(
      "[ALERT][am-admin/login] Unhandled exception:",
      err instanceof Error ? err.stack ?? err.message : String(err),
    );
    return NextResponse.json(
      {
        error: "server_error",
        detail: err instanceof Error ? err.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

async function handleLogin(req: NextRequest) {
  // ── Rate-limit (bremser brute-force på passord) ─────────────────
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, ORG_ADMIN_LOGIN_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        detail: `For mange innloggings-forsøk. Prøv igjen om ${Math.ceil(rl.resetSeconds / 60)} min.`,
        resetSeconds: rl.resetSeconds,
      },
      { status: 429 },
    );
  }

  // ── Host-validering: ekstraher tenantPrefix ─────────────────────
  const host = getHost(req);
  const fallback = req.nextUrl.searchParams.get("orgAdminPrefix");
  const prefix = extractOrgAdminPrefix(host, fallback);
  if (!prefix) {
    return NextResponse.json(
      { error: "invalid_host", detail: "Login må gjøres fra <prefix>-admin.kodovault.no." },
      { status: 400 },
    );
  }

  // ── Body-parsing ────────────────────────────────────────────────
  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "invalid_credentials", detail: "E-post og passord er påkrevd." },
      { status: 400 },
    );
  }

  // ── Lookup admin på email ───────────────────────────────────────
  const admin = await findOrgAdminByEmail(prefix, email);
  if (!admin) {
    // Konstant-tid: kjør en dummy bcrypt-compare for å unngå timing-orakel
    // som kan avsløre om e-post finnes (vi bruker en hardkodet hash).
    await verifyPassword(password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinval");
    return NextResponse.json(
      { error: "invalid_credentials", detail: "Feil e-post eller passord." },
      { status: 401 },
    );
  }

  // ── Sjekk suspended-status FØR passord (raskt avvis) ────────────
  if (admin.suspended) {
    return NextResponse.json(
      {
        error: "account_suspended",
        detail: "Kontoen er suspendert. Kontakt en super-admin i din organisasjon.",
      },
      { status: 403 },
    );
  }

  // ── Verifiser passord ───────────────────────────────────────────
  const ok = await verifyPassword(password, admin.passwordHash);
  if (!ok) {
    return NextResponse.json(
      { error: "invalid_credentials", detail: "Feil e-post eller passord." },
      { status: 401 },
    );
  }

  // ── Sign session-cookie ─────────────────────────────────────────
  const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
  if (!secret) {
    console.error("[am-admin/login] ORG_ADMIN_SESSION_SECRET mangler i env");
    return NextResponse.json(
      { error: "server_config_error" },
      { status: 500 },
    );
  }

  const cookieValue = await signOrgAdminSession(secret, {
    adminId: admin.id,
    prefix: admin.tenantPrefix,
    role: admin.role,
  });

  // Iter 20.9 (D-086, 2026-06-27): logg vellykket innlogging for visning i
  // Konsoll → Innstillinger → Sikkerhet, og oppdater lastLoginAt på admin.
  const now = new Date();
  const clientIp = getClientIp(req) ?? "unknown";
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 200);
  await recordLoginEvent(admin.id, {
    ts: now.getTime(),
    ip: clientIp,
    ua: userAgent,
    host: getHost(req),
  });
  await putOrgAdmin({ ...admin, lastLoginAt: now.toISOString() });

  const res = NextResponse.json({
    ok: true,
    adminId: admin.id,
    firstName: admin.firstName,
    lastName: admin.lastName,
    email: admin.email,
    role: admin.role,
    prefix: admin.tenantPrefix,
  });
  res.cookies.set({
    name: ORG_ADMIN_SESSION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax (ikke Strict) fordi am-admin er på et separat subdomain fra
    // public site. Strict ville blokkert cookie ved cross-site navigasjon
    // fra eksempelvis en epost-lenke.
    sameSite: "lax",
    path: "/",
    maxAge: ORG_ADMIN_SESSION_TTL_SECONDS,
  });
  return res;
}
