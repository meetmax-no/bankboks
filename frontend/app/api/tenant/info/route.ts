/**
 * Ko | Do · Vault — GET /api/tenant/info
 *
 * Iter 19.9.2 — Klient-fanen i Settings henter tenant-data fra DB i stedet
 * for å vise statisk `_meta` fra clients/<tenant>.json. Endepunktet leverer
 * de fem feltene som vises i Klient-accordionen:
 *
 *   - fullName    (firstName + lastName, fallback til email-lokaldel)
 *   - email
 *   - subdomain   (uten ".kodovault.no")
 *   - createdAt   (ISO 8601 UTC)
 *   - locale      ("no"|"sv"|"da"|"en"|null — låst ved registrering per Iter 19.9)
 *
 * Sikkerhetsmodell:
 *   - Subdomain bestemmes av host (D-046) eller `?_tenant=` (D-071 rewrite).
 *   - Endepunktet kan IKKE returnere data for en annen tenant enn den som
 *     hoster requesten. Cross-tenant blokkert av subdomain-isolation.
 *   - Same-origin GET → CORS-beskyttet mot fra-cross-site fetch.
 *   - Samme sikkerhetsnivå som /api/billing/checkout-info og /api/vault GET.
 *   - Ingen master-pwd nødvendig — dette er konto-data, ikke vault-data.
 *
 * Node runtime (lese kryptert tenant-record fra Upstash).
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveSubdomain(req: Request): string {
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("_tenant")?.trim().toLowerCase();
  if (tenantParam) return tenantParam;
  const host = req.headers.get("host") ?? "";
  const m = host.toLowerCase().match(/^([^.]+)\.kodovault\./);
  return m?.[1] ?? "";
}

interface TenantInfoResponse {
  ok: true;
  fullName: string | null;
  email: string;
  subdomain: string;
  createdAt: string;
  locale: "no" | "sv" | "da" | "en" | null;
}

interface ErrorResponse {
  ok: false;
  error: string;
}

export async function GET(req: Request) {
  const subdomain = resolveSubdomain(req);
  if (!subdomain || !isValidSubdomainFormat(subdomain)) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: "invalid_subdomain" },
      { status: 400 },
    );
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: "tenant_not_found" },
      { status: 404 },
    );
  }

  // Iter 20.4 patch (2026-06-26): B2B parent-tenants har INGEN vault-URL.
  // Hvis noen treffer `<prefix>.kodovault.no` skal vi behandle det som om
  // tenanten ikke finnes — ikke lekke parent-metadata via tenant/info.
  // (am-admin-panelet bor på `<prefix>-admin.kodovault.no` og har egne
  // autoriserte endepunkter — det går aldri via tenant/info.)
  if (tenant.customerType === "b2b" && tenant.parentTenant === null) {
    return NextResponse.json<ErrorResponse>(
      { ok: false, error: "tenant_not_found" },
      { status: 404 },
    );
  }

  // Aggregér fullName fra firstName + lastName (D-044: begge kan være null).
  // Fallback til null så frontend kan rendre em-dash ("—") konsistent.
  const fullName =
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ").trim() ||
    null;

  const response: TenantInfoResponse = {
    ok: true,
    fullName,
    email: tenant.email,
    subdomain: tenant.subdomain,
    createdAt: tenant.createdAt,
    locale: tenant.locale,
  };
  return NextResponse.json(response, { status: 200 });
}
