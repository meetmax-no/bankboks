/**
 * Ko | Do · Vault — Iter 20.9 (D-084) — am-admin team-administrasjon
 *
 * GET  /api/am-admin/team — Liste alle org-admins for innlogget admin sin org.
 *                          Kun super-admin.
 * POST /api/am-admin/team — Opprett ny admin/super-admin i samme org.
 *                          Kun super-admin. Sender velkomstmail.
 *
 * Per D-079 + D-084: kun super-admin kan administrere team. Vanlig admin
 * får 403 og ser ikke endepunktet i UI heller (faner skjules).
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  createOrgAdmin,
  listOrgAdmins,
} from "@/lib/platform/org-admin-store";
import {
  OrgAdminError,
  toOrgAdminPublic,
  type OrgAdminPublic,
  type OrgAdminRole,
} from "@/lib/platform/org-admin-types";
import { findB2BTenantByPrefix } from "@/lib/platform/tenant-store";
import { sendOrgAdminWelcome } from "@/lib/platform/notify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
};

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const all = await listOrgAdmins(auth.ctx.session.prefix);
  const admins: OrgAdminPublic[] = all.map(toOrgAdminPublic);
  return NextResponse.json({
    prefix: auth.ctx.session.prefix,
    count: admins.length,
    admins,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const firstName =
    typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName =
    typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: OrgAdminRole =
    body.role === "super-admin" ? "super-admin" : "admin";

  if (!firstName || !lastName || !email || !password) {
    return NextResponse.json(
      {
        error: "missing_fields",
        detail: "firstName, lastName, email og password er påkrevd.",
      },
      { status: 400 },
    );
  }

  // D-095 (2026-06-28): hent parent FØR createOrgAdmin for snapshot-FK.
  const parent = await findB2BTenantByPrefix(auth.ctx.session.prefix);

  const result = await createOrgAdmin({
    tenantPrefix: auth.ctx.session.prefix,
    firstName,
    lastName,
    email,
    password,
    role,
    createdBy: auth.ctx.admin.email,
    parentTenantCreatedAt: parent?.createdAt ?? null,
  });

  if (typeof result === "string") {
    const status =
      result === OrgAdminError.EmailAlreadyExists
        ? 409
        : result === OrgAdminError.WeakPassword
          ? 400
          : 400;
    return NextResponse.json({ error: result }, { status });
  }

  // Velkomstmail med samme HTML-mal som Mike's create-flow.
  // Krever tenant-kontext for companyName + adminUrl. Hopper graciøst
  // hvis parent ikke kan resolves (edge case, ikke kritisk).
  let welcomeEmail = null;
  if (parent) {
    const adminUrl = `https://${parent.tenantPrefix}-admin.kodovault.no/`;
    const welcomeLocale: "no" | "sv" | "da" | "en" =
      parent.locale === "en" ||
      parent.locale === "sv" ||
      parent.locale === "da"
        ? parent.locale
        : "no";
    welcomeEmail = await sendOrgAdminWelcome({
      recipientEmail: result.email,
      recipientFirstName: result.firstName,
      recipientLocale: welcomeLocale,
      companyName: parent.companyName ?? parent.subdomain,
      adminUrl,
      tempPassword: password,
    });
  }

  return NextResponse.json({
    ok: true,
    admin: toOrgAdminPublic(result),
    welcomeEmail,
  });
}
