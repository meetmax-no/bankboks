/**
 * Ko | Do · Vault — Iter 20.5d (2026-06-26) — am-admin Backup data-aggregator
 *
 * GET /api/am-admin/backup/data
 *
 * Returnerer all rå data klienten trenger for å bygge en backup-fil
 * (CSV eller JSON). Server gjør INGEN ekstra kryptering — adminNotes-
 * envelopene dekrypteres KLIENT-SIDE med MPW-key i UI-laget.
 *
 * Per user-svar 2 (2026-06-26): ansatt-liste + adminNotes + license-
 * info. INGEN audit-logs.
 *
 * Krever am-admin-session. Returnerer KUN data fra admin sin egen org.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  findB2BTenantByPrefix,
  listTenants,
} from "@/lib/platform/tenant-store";
import {
  listNoteSubdomains,
  getNote,
} from "@/lib/platform/am-admin-notes-store";
import type { MpwEnvelope } from "@/lib/platform/am-admin-mpw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EmployeeRow = {
  subdomain: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactEmail: string | null;
  locale: string | null;
  status: string;
  createdAt: string;
  noteEnvelope: MpwEnvelope | null;
};

type LicenseInfo = {
  parentSubdomain: string | null;
  plan: string | null;
  maxLicenses: number | null;
  activeLicenses: number | null;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  status: string | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;
  const prefix = admin.tenantPrefix;

  // Hent alle ansatte (child-tenants) under denne orgen.
  const all = await listTenants();
  const children = all.filter(
    (t) =>
      t.parentTenant === prefix || t.subdomain.startsWith(`${prefix}-`),
  );

  // Hent indeksen over hvilke subdomains har notater, så vi unngår å
  // GETe N nøkler hvis flertallet er tomme.
  const notedSubs = new Set(await listNoteSubdomains(prefix));

  // Hent envelopene for kun de ansatte som faktisk har notater.
  // Bruk Promise.all — antall ansatte per org er typisk < 100.
  const noteMap = new Map<string, MpwEnvelope>();
  await Promise.all(
    Array.from(notedSubs).map(async (sub) => {
      const env = await getNote(prefix, sub);
      if (env) noteMap.set(sub, env);
    }),
  );

  const employees: EmployeeRow[] = children
    .map((t) => ({
      subdomain: t.subdomain,
      firstName: t.firstName,
      lastName: t.lastName,
      email: t.email,
      contactEmail: t.contactEmail,
      locale: t.locale,
      status: t.status,
      createdAt: t.createdAt,
      noteEnvelope: noteMap.get(t.subdomain) ?? null,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // Hent license-info fra parent-tenant.
  const parent = await findB2BTenantByPrefix(prefix);
  const license: LicenseInfo = parent
    ? {
        parentSubdomain: parent.subdomain,
        plan: parent.plan,
        maxLicenses: parent.maxLicenses,
        activeLicenses: parent.activeLicenses,
        trialEndsAt: parent.trialEndsAt,
        nextBillingDate: parent.nextBillingDate,
        status: parent.status,
      }
    : {
        parentSubdomain: null,
        plan: null,
        maxLicenses: null,
        activeLicenses: null,
        trialEndsAt: null,
        nextBillingDate: null,
        status: null,
      };

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    prefix,
    license,
    employeeCount: employees.length,
    notedCount: noteMap.size,
    employees,
  });
}
