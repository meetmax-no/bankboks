/**
 * Ko | Do · Vault — Iter 20.9 (D-081) — POST /api/am-admin/auth/change-password
 *
 * am-admin endepunkt for passordbytte. Brukes til to scenarier:
 *   1. Tvinget reset ved første innlogging (`forcePasswordReset === true`)
 *   2. Frivillig passordbytte fra dashbordet
 *
 * Server-side validering:
 *   - Krever gyldig session (cookie)
 *   - Verifiserer `currentPassword` mot bcrypt
 *   - `newPassword` må være minst 12 tegn (samme baseline som MpwSection)
 *   - zxcvbn score ≥ 3 håndheves klient-side; server stoler på minimum-lengde
 *     som siste forsvar
 *   - `newPassword` MÅ være forskjellig fra `currentPassword`
 *
 * Etter vellykket bytte: `forcePasswordReset` settes til `false` automatisk
 * via `updateOrgAdminPassword`.
 *
 * Host-låst: kun callable fra `<prefix>-admin.kodovault.no` (middleware).
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ORG_ADMIN_SESSION_COOKIE,
  verifyOrgAdminSession,
} from "@/lib/platform/org-admin-auth";
import {
  getOrgAdmin,
  updateOrgAdminPassword,
} from "@/lib/platform/org-admin-store";
import { verifyPassword } from "@/lib/platform/password-hash";
import { OrgAdminError } from "@/lib/platform/org-admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 12;

export async function POST(req: NextRequest) {
  // ── Session-verifisering ────────────────────────────────────────
  const cookie = req.cookies.get(ORG_ADMIN_SESSION_COOKIE)?.value;
  const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
  const session = await verifyOrgAdminSession(cookie, secret);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Body-parsing ────────────────────────────────────────────────
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      {
        error: "missing_fields",
        detail: "currentPassword og newPassword er påkrevd.",
      },
      { status: 400 },
    );
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      {
        error: "weak_password",
        detail: `Nytt passord må være minst ${MIN_PASSWORD_LENGTH} tegn.`,
      },
      { status: 400 },
    );
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      {
        error: "same_password",
        detail: "Nytt passord må være forskjellig fra det gamle.",
      },
      { status: 400 },
    );
  }

  // ── Hent admin + verifiser gammelt passord ──────────────────────
  const admin = await getOrgAdmin(session.prefix, session.adminId);
  if (!admin) {
    return NextResponse.json({ error: "admin_not_found" }, { status: 404 });
  }
  if (admin.suspended) {
    return NextResponse.json({ error: "account_suspended" }, { status: 403 });
  }

  const ok = await verifyPassword(currentPassword, admin.passwordHash);
  if (!ok) {
    return NextResponse.json(
      {
        error: "invalid_current_password",
        detail: "Gjeldende passord er feil.",
      },
      { status: 401 },
    );
  }

  // ── Oppdater passord (clear også forcePasswordReset-flagget) ────
  const result = await updateOrgAdminPassword(
    session.prefix,
    session.adminId,
    newPassword,
  );
  if (typeof result === "string") {
    const status = result === OrgAdminError.WeakPassword ? 400 : 500;
    return NextResponse.json({ error: result }, { status });
  }

  return NextResponse.json({ ok: true });
}
