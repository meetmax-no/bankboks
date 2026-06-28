/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — org default e-post-locale
 *
 * PATCH /api/am-admin/org/locale
 *   { locale: "no" | "sv" | "da" | "en" }
 *
 * Endrer parent-tenant.locale, som brukes som default når invitasjons-mail
 * eller velkomstmail sendes uten eksplisitt locale. Kun super-admin.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/am-admin-session-helper";
import { findB2BTenantByPrefix, putTenant } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_LOCALES = ["no", "sv", "da", "en"] as const;
type AllowedLocale = (typeof ALLOWED_LOCALES)[number];

function isAllowedLocale(v: unknown): v is AllowedLocale {
  return (
    typeof v === "string" &&
    (ALLOWED_LOCALES as readonly string[]).includes(v)
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  let body: { locale?: unknown };
  try {
    body = (await req.json()) as { locale?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isAllowedLocale(body.locale)) {
    return NextResponse.json(
      {
        error: "invalid_locale",
        detail: "locale må være en av: no, sv, da, en",
      },
      { status: 400 },
    );
  }

  const parent = await findB2BTenantByPrefix(auth.ctx.session.prefix);
  if (!parent) {
    return NextResponse.json(
      { error: "parent_not_found" },
      { status: 404 },
    );
  }

  await putTenant({ ...parent, locale: body.locale });
  return NextResponse.json({ ok: true, locale: body.locale });
}
