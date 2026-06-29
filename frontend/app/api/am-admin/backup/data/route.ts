/**
 * Ko | Do · Vault — Iter 20.5d (2026-06-26) — am-admin Backup data-aggregator
 *
 * GET /api/am-admin/backup/data
 *
 * Returnerer all rå data klienten trenger for å bygge en backup-fil
 * (CSV eller JSON). Server gjør INGEN ekstra kryptering — adminNotes-
 * envelopene dekrypteres KLIENT-SIDE med MPW-key i UI-laget.
 *
 * D-113 (Mike 2026-06-29): Backup-strukturen har nå 3 logiske seksjoner i
 * samme payload — `admin` (parent-tenanten), `employees` (children med
 * `parentTenant === prefix`), og `invites` (status="pending", ikke utløpt).
 * Bug-fiks: tidligere ble parent feilaktig inkludert i employees-listen
 * fordi filteret brukte `subdomain.startsWith(prefix+"-")` som OR-fallback.
 *
 * Krever am-admin-session. Returnerer KUN data fra admin sin egen org.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  findB2BTenantByPrefix,
  listTenants,
} from "@/lib/platform/tenant-store";
import { countLiveActiveLicenses } from "@/lib/platform/seat-counter";
import {
  listInvitesForParent,
} from "@/lib/platform/invite-store";
import { isInviteExpired } from "@/lib/platform/invite-types";
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

type InviteRow = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  locale: string | null;
  status: string; // alltid "pending"
  createdAt: string;
};

type AdminRow = {
  subdomain: string;
  email: string | null;
  contactEmail: string | null;
  locale: string | null;
  status: string;
  createdAt: string;
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

  // Hent alle tenants (parent + children).
  const all = await listTenants();

  // D-113: Strikt filter — kun children med parentTenant === prefix.
  // Tidligere brukte vi OR-fallback `startsWith(prefix-)` som plukket opp
  // parent-tenanten selv (f.eks. mm-admin matchet prefix="mm").
  const children = all.filter((t) => t.parentTenant === prefix);

  // Parent-tenanten (admin-recorden) — separat seksjon i payload.
  const parent = await findB2BTenantByPrefix(prefix);

  // Hent indeksen over hvilke subdomains har notater, så vi unngår å
  // GETe N nøkler hvis flertallet er tomme.
  const notedSubs = new Set(await listNoteSubdomains(prefix));

  // Hent envelopene for kun de ansatte som faktisk har notater.
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

  // D-113: Pending invites — kun "pending" og ikke utløpt.
  const allInvites = await listInvitesForParent(prefix);
  const now = new Date();
  const invites: InviteRow[] = allInvites
    .filter((r) => r.status === "pending" && !isInviteExpired(r, now))
    .map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      locale: r.locale,
      status: "pending",
      createdAt: r.createdAt,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // D-113: Admin-rad fra parent-tenanten (én rad per backup).
  const adminRow: AdminRow | null = parent
    ? {
        subdomain: parent.subdomain,
        email: parent.email,
        contactEmail: parent.contactEmail,
        locale: parent.locale,
        status: parent.status,
        createdAt: parent.createdAt,
      }
    : null;

  // License-info (D-111: activeLicenses live-tellet).
  const liveActiveLicenses = countLiveActiveLicenses(prefix, all);
  const license: LicenseInfo = parent
    ? {
        parentSubdomain: parent.subdomain,
        plan: parent.plan,
        maxLicenses: parent.maxLicenses,
        activeLicenses: liveActiveLicenses,
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
    admin: adminRow,
    employeeCount: employees.length,
    inviteCount: invites.length,
    notedCount: noteMap.size,
    employees,
    invites,
  });
}
