/**
 * Ko | Do · Vault — Iter 20.2 — POST /api/admin/tenants/[subdomain]/create-org-admin
 *
 * Mike's super-admin-endepunkt for å opprette første super-admin på en
 * B2B-parent. Skjer som del av B2B-onboarding.
 *
 * Kun callable fra `admin.kodovault.no` (middleware host-låst). Krever
 * gyldig Mike-admin-session.
 *
 * Body: { firstName, lastName, email, password, role? }
 *  - role defaulter til "super-admin" siden dette er første opprettelse
 *
 * Pre-checks:
 *  - Subdomain MÅ være en B2B-parent (customerType="b2b" && tenantPrefix satt)
 *  - role-defaultet kan overstyres til "admin" (sjelden brukt fra Mike-flyt)
 *
 * Loggers to `provisioningLog` på parent-tenanten:
 *  `org_admin_created` med admin-id, e-post, rolle, opprettet av "mike@admin".
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  createOrgAdmin,
  countSuperAdmins,
} from "@/lib/platform/org-admin-store";
import {
  OrgAdminError,
  toOrgAdminPublic,
  type OrgAdminRole,
} from "@/lib/platform/org-admin-types";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import { sendOrgAdminWelcome } from "@/lib/platform/notify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateOrgAdminBody = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const { subdomain } = await ctx.params;

  // ── Last parent-tenant + valider B2B + tenantPrefix ─────────────
  const parent = await getTenant(subdomain);
  if (!parent) {
    return NextResponse.json(
      { error: "tenant_not_found", detail: `Tenant ${subdomain} finnes ikke.` },
      { status: 404 },
    );
  }
  if (parent.customerType !== "b2b") {
    return NextResponse.json(
      {
        error: "not_a_b2b_parent",
        detail: "Org-admin kan kun opprettes på B2B-parents.",
      },
      { status: 400 },
    );
  }
  if (!parent.tenantPrefix) {
    return NextResponse.json(
      {
        error: "missing_tenant_prefix",
        detail: "B2B-parent mangler tenantPrefix. Sett det først.",
      },
      { status: 400 },
    );
  }

  // ── Body-parsing + validering ───────────────────────────────────
  let body: CreateOrgAdminBody;
  try {
    body = (await req.json()) as CreateOrgAdminBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: OrgAdminRole = body.role === "admin" ? "admin" : "super-admin";

  if (!firstName || !lastName || !email || !password) {
    return NextResponse.json(
      {
        error: "missing_fields",
        detail: "firstName, lastName, email og password er påkrevd.",
      },
      { status: 400 },
    );
  }

  // ── Opprett admin via store ─────────────────────────────────────
  const result = await createOrgAdmin({
    tenantPrefix: parent.tenantPrefix,
    firstName,
    lastName,
    email,
    password,
    role,
    createdBy: "mike@admin",
    // D-095 (2026-06-28): snapshot-FK mot parent.createdAt
    parentTenantCreatedAt: parent.createdAt,
  });

  if (typeof result === "string") {
    const status =
      result === OrgAdminError.EmailAlreadyExists
        ? 409
        : result === OrgAdminError.WeakPassword
          ? 400
          : 400;
    return NextResponse.json(
      { error: result, detail: errorMessage(result) },
      { status },
    );
  }

  // ── Audit-log på parent ─────────────────────────────────────────
  const provisioningLog = parent.provisioningLog ?? [];
  provisioningLog.push({
    timestamp: new Date().toISOString(),
    stage: "org_admin_created",
    status: "ok",
    detail: `${result.email} (${result.role}) opprettet av mike@admin`,
  });
  await putTenant({ ...parent, provisioningLog });

  // ── Iter 20.9 (D-081): Velkomstmail med midlertidig passord ────
  // Mailen advarer eksplisitt om at passordet må byttes ved første
  // innlogging (forcePasswordReset er allerede satt true i createOrgAdmin).
  // Vi sender alltid — `sendOrgAdminWelcome` returnerer `skipped` graciøst
  // hvis EMAIL_ENABLED ikke er satt (lokal-dev). Feiler aldri.
  const adminUrl = `https://${parent.tenantPrefix}-admin.kodovault.no/`;
  const welcomeLocale: "no" | "sv" | "da" | "en" =
    parent.locale === "en" || parent.locale === "sv" || parent.locale === "da"
      ? parent.locale
      : "no";
  const emailResult = await sendOrgAdminWelcome({
    recipientEmail: result.email,
    recipientFirstName: result.firstName,
    recipientLocale: welcomeLocale,
    companyName: parent.companyName ?? parent.subdomain,
    adminUrl,
    tempPassword: password,
  });

  // ── Returner public view + total-count + e-post-status ─────────
  const totalSupers = await countSuperAdmins(parent.tenantPrefix);
  return NextResponse.json({
    ok: true,
    admin: toOrgAdminPublic(result),
    superAdminCount: totalSupers,
    loginUrl: adminUrl,
    welcomeEmail: emailResult,
  });
}

function errorMessage(code: string): string {
  switch (code) {
    case OrgAdminError.EmailAlreadyExists:
      return "En admin med denne e-posten finnes allerede i denne org-en.";
    case OrgAdminError.WeakPassword:
      return "Passordet er for kort (minst 8 tegn).";
    case OrgAdminError.InvalidEmail:
      return "Ugyldig e-postformat.";
    case OrgAdminError.InvalidTenantPrefix:
      return "Ugyldig tenantPrefix.";
    case OrgAdminError.InvalidRole:
      return "Ugyldig rolle.";
    default:
      return code;
  }
}
