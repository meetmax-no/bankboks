/**
 * Ko | Do · Vault — Iter 20.3 — GET /api/am-admin/tenants
 *
 * Listet alle ansatt-tenants (child-tenants under egen tenantPrefix).
 * am-admin ser kun sin egen org. Mike-admin har ikke tilgang til denne
 * ruten (forskjellig host + path).
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import { listTenants } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const all = await listTenants();
  const children = all.filter(
    (t) =>
      t.parentTenant === admin.tenantPrefix ||
      t.subdomain.startsWith(`${admin.tenantPrefix}-`),
  );

  // Returner kun feltene am-admin trenger — ikke vault-blob, ikke
  // sensitive intern-status. (passwordHash er aldri i TenantRecord.)
  const safe = children.map((t) => ({
    subdomain: t.subdomain,
    firstName: t.firstName,
    lastName: t.lastName,
    email: t.email,
    contactEmail: t.contactEmail,
    locale: t.locale,
    status: t.status,
    createdAt: t.createdAt,
    customerType: t.customerType,
  }));
  safe.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({
    prefix: admin.tenantPrefix,
    count: safe.length,
    tenants: safe,
  });
}
