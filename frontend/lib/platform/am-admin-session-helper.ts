/**
 * Ko | Do · Vault — Iter 20.3 — am-admin session-helper for API-routes
 *
 * Felles helper som henter ut + verifiserer am-admin-session fra cookie
 * og returnerer enten et `{ session, admin }`-par eller en NextResponse
 * med 401/403. Brukes av alle `/api/am-admin/*`-ruter for å unngå
 * duplisert auth-logikk.
 *
 * Middleware har allerede sjekket grunn-session (kombinert med host-
 * isolasjon), men API-routes må fortsatt:
 *   1. Re-validere at admin-objektet fortsatt eksisterer (sletting?)
 *   2. Re-validere at admin ikke er suspendert siden cookie ble utstedt
 *   3. Returnere session + admin-record for videre autorisasjon-sjekker
 *      (rolle, prefix-match, etc.)
 *
 * Node runtime ONLY.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ORG_ADMIN_SESSION_COOKIE,
  verifyOrgAdminSession,
  type OrgAdminSessionPayload,
} from "./org-admin-auth";
import { getOrgAdmin } from "./org-admin-store";
import type { OrgAdmin } from "./org-admin-types";

export type AmAdminAuthContext = {
  session: OrgAdminSessionPayload;
  admin: OrgAdmin;
};

export type AmAdminAuthResult =
  | { ok: true; ctx: AmAdminAuthContext }
  | { ok: false; response: NextResponse };

/**
 * Hent + verifiser am-admin session fra request. Returnerer enten
 * `{ ok: true, ctx }` (har session) eller `{ ok: false, response }` (en ferdig
 * NextResponse med 401/403/404 som rute-handleren kan returnere direkte).
 */
export async function requireAmAdmin(
  req: NextRequest,
): Promise<AmAdminAuthResult> {
  const cookie = req.cookies.get(ORG_ADMIN_SESSION_COOKIE)?.value;
  const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
  const session = await verifyOrgAdminSession(cookie, secret);

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const admin = await getOrgAdmin(session.prefix, session.adminId);
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "admin_not_found", detail: "Admin-objektet er slettet." },
        { status: 404 },
      ),
    };
  }
  if (admin.suspended) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "account_suspended",
          detail: "Kontoen er suspendert. Kontakt en super-admin.",
        },
        { status: 403 },
      ),
    };
  }

  // Iter 20.9 (D-086, 2026-06-27): "Logg ut alle enheter" bumper
  // sessionsInvalidatedAt. Sessions med iat før denne avvises.
  if (
    typeof admin.sessionsInvalidatedAt === "number" &&
    session.iat < admin.sessionsInvalidatedAt
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "session_invalidated",
          detail: "Sessionen ble avsluttet eksternt. Logg inn på nytt.",
        },
        { status: 401 },
      ),
    };
  }

  return { ok: true, ctx: { session, admin } };
}

/**
 * Krev super-admin-rolle. Brukes for endepunkter som administrerer
 * admin-brukerpool (opprett admin, slett admin, sett rolle, etc.).
 */
export async function requireSuperAdmin(
  req: NextRequest,
): Promise<AmAdminAuthResult> {
  const result = await requireAmAdmin(req);
  if (!result.ok) return result;
  if (result.ctx.admin.role !== "super-admin") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "forbidden",
          detail: "Kun super-admin kan utføre denne handlingen.",
        },
        { status: 403 },
      ),
    };
  }
  return result;
}

/**
 * Sjekker at en subdomain tilhører am-admin sin egen org (`<prefix>-...`).
 * Returnerer null hvis OK, eller NextResponse med 403/404 hvis ikke.
 */
export function assertSubdomainBelongsToOrg(
  subdomain: string,
  prefix: string,
): NextResponse | null {
  if (!subdomain.toLowerCase().startsWith(`${prefix.toLowerCase()}-`)) {
    return NextResponse.json(
      {
        error: "forbidden_cross_org",
        detail: "Subdomain tilhører ikke din organisasjon.",
      },
      { status: 403 },
    );
  }
  return null;
}
