/**
 * Ko | Do · Vault — Iter 20.1 — OrgAdmin-store (sentral Upstash)
 *
 * CRUD mot sentral Upstash-instans (CENTRAL_KV_*). Hver OrgAdmin lagres som
 * AES-256-GCM-kryptert JSON under `org-admin:<tenantPrefix>:admin:<id>`.
 * En egen indeks `org-admin:<tenantPrefix>:admins` holder en SET av
 * admin-ID-er for rask listing per parent.
 *
 * Per D-078 (separation of concerns) + D-079 (MPW-isolasjon).
 *
 * Node runtime ONLY. Importer kun fra API-routes med `runtime = "nodejs"`.
 *
 * Invariants:
 *   - "Minst 1 super-admin per org" (Mike's blokker-spørsmål 4 = a, 2026-06-26)
 *   - E-post er unik per tenantPrefix (samme bruker kan ikke ha to admin-
 *     kontoer i samme org, men kan ha admin-konto i flere org-er — sjelden)
 */
import { randomUUID } from "node:crypto";
import { decryptPayload, encryptPayload, type EncryptedBlob } from "./tenant-crypto";
import { getCentralRedis } from "./central-upstash";
import { hashPassword } from "./password-hash";
import {
  OrgAdminError,
  type CreateOrgAdminInput,
  type OrgAdmin,
  type OrgAdminErrorCode,
  type OrgAdminRole,
} from "./org-admin-types";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREFIX_RX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

function indexKey(tenantPrefix: string): string {
  return `org-admin:${tenantPrefix.toLowerCase()}:admins`;
}

function adminKey(tenantPrefix: string, id: string): string {
  return `org-admin:${tenantPrefix.toLowerCase()}:admin:${id}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePrefix(prefix: string): boolean {
  return PREFIX_RX.test(prefix.toLowerCase());
}

/**
 * Hent én admin på ID. Returnerer null hvis ikke funnet.
 */
export async function getOrgAdmin(
  tenantPrefix: string,
  id: string,
): Promise<OrgAdmin | null> {
  const client = getCentralRedis();
  const blob = await client.get<EncryptedBlob | null>(adminKey(tenantPrefix, id));
  if (!blob) return null;
  try {
    return decryptPayload<OrgAdmin>(blob);
  } catch {
    return null;
  }
}

/**
 * List alle admins for en org. Returnerer dekrypterte records sortert
 * eldste først (createdAt ASC) — nyttig for "siste super-admin"-sjekk.
 */
export async function listOrgAdmins(tenantPrefix: string): Promise<OrgAdmin[]> {
  const client = getCentralRedis();
  const ids = (await client.smembers(indexKey(tenantPrefix))) ?? [];
  if (ids.length === 0) return [];
  const pipe = client.pipeline();
  for (const id of ids) pipe.get<EncryptedBlob | null>(adminKey(tenantPrefix, id));
  const blobs = (await pipe.exec()) as (EncryptedBlob | null)[];
  const records: OrgAdmin[] = [];
  for (const blob of blobs) {
    if (!blob) continue;
    try {
      records.push(decryptPayload<OrgAdmin>(blob));
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return records;
}

/**
 * Finn admin på email innenfor én org (login-lookup).
 * Krever full liste-scan — vi har ikke en separat email-index ennå.
 * For org-er med < 100 admins er dette akseptabel kost.
 */
export async function findOrgAdminByEmail(
  tenantPrefix: string,
  email: string,
): Promise<OrgAdmin | null> {
  const normalized = normalizeEmail(email);
  const all = await listOrgAdmins(tenantPrefix);
  return all.find((a) => a.email === normalized) ?? null;
}

/**
 * Tell super-admins for en org. Brukes til "siste super-admin"-invariant.
 */
export async function countSuperAdmins(tenantPrefix: string): Promise<number> {
  const all = await listOrgAdmins(tenantPrefix);
  return all.filter((a) => a.role === "super-admin" && !a.suspended).length;
}

/**
 * D-107 (2026-06-28, Mike): Hent den FØRSTE super-adminen for en B2B-org.
 *
 * Strategi:
 *   1. Se etter record med `isFirstSuperAdmin === true`. Returner den.
 *   2. Hvis ingen har flagget (legacy-data), backfill: ta eldste super-admin
 *      etter `createdAt`, sett `isFirstSuperAdmin = true`, persister, returner.
 *   3. Hvis ingen super-admins finnes for prefiks: returner null.
 *   4. Hvis "den første" er slettet (flagg ikke matcher noen record):
 *      returner null. UI viser "(opprinnelig super-admin slettet)".
 */
export async function getFirstSuperAdmin(
  tenantPrefix: string,
): Promise<OrgAdmin | null> {
  const prefix = tenantPrefix.toLowerCase().trim();
  const all = await listOrgAdmins(prefix);
  if (all.length === 0) return null;

  // Steg 1: eksisterende flagg
  const flagged = all.find((a) => a.isFirstSuperAdmin === true);
  if (flagged) return flagged;

  // Steg 2: backfill — eldste super-admin får flagget
  const supers = all
    .filter((a) => a.role === "super-admin")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  if (supers.length === 0) return null;
  const first = supers[0];
  const client = getCentralRedis();
  const patched: OrgAdmin = { ...first, isFirstSuperAdmin: true };
  await client.set(adminKey(prefix, first.id), encryptPayload(patched));
  return patched;
}

/**
 * Opprett en ny org-admin. Tar plaintext-passord (bcrypt-hashes internt).
 * Returnerer ny OrgAdmin eller en feilkode-streng.
 *
 * Validerer:
 *   - tenantPrefix-format
 *   - email-format
 *   - email ikke i bruk i samme org
 *   - role gyldig
 *   - password ikke tom (zxcvbn ≥ 2 håndheves klient-side i Iter 20.2 UI)
 */
export async function createOrgAdmin(
  input: CreateOrgAdminInput,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  const prefix = input.tenantPrefix.toLowerCase().trim();
  if (!validatePrefix(prefix)) return OrgAdminError.InvalidTenantPrefix;

  const email = normalizeEmail(input.email);
  if (!EMAIL_RX.test(email)) return OrgAdminError.InvalidEmail;

  if (input.role !== "super-admin" && input.role !== "admin") {
    return OrgAdminError.InvalidRole;
  }

  if (!input.password || input.password.length < 8) {
    return OrgAdminError.WeakPassword;
  }

  const existing = await findOrgAdminByEmail(prefix, email);
  if (existing) return OrgAdminError.EmailAlreadyExists;

  // D-107 (2026-06-28, Mike): markér den aller første super-adminen for
  // dette prefiks med `isFirstSuperAdmin: true`. Brukes til å vise
  // "opprinnelig kontaktperson" i super-admin TenantViewer.
  const allExisting = await listOrgAdmins(prefix);
  const hasAnyFirstFlag = allExisting.some((a) => a.isFirstSuperAdmin === true);
  const isFirstSuperAdmin =
    !hasAnyFirstFlag &&
    input.role === "super-admin" &&
    allExisting.filter((a) => a.role === "super-admin").length === 0;

  const id = randomUUID();
  const record: OrgAdmin = {
    id,
    tenantPrefix: prefix,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    suspended: false,
    forcePasswordReset: true,
    parentTenantCreatedAt: input.parentTenantCreatedAt ?? null,
    isFirstSuperAdmin,
  };

  const client = getCentralRedis();
  await client.set(adminKey(prefix, id), encryptPayload(record));
  await client.sadd(indexKey(prefix), id);
  return record;
}

/**
 * Oppdater en eksisterende admin (full replace). Kaster ikke — returnerer
 * feilkode hvis invariant brytes.
 *
 * Håndhever "siste super-admin"-invariant: hvis denne oppdateringen ville
 * tatt count(super-admin && !suspended) til 0, returner LastSuperAdmin.
 */
export async function putOrgAdmin(
  next: OrgAdmin,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  const prefix = next.tenantPrefix.toLowerCase();
  const existing = await getOrgAdmin(prefix, next.id);
  if (!existing) return OrgAdminError.NotFound;

  // Invariant: minst 1 aktiv super-admin per org
  const isDegrading =
    existing.role === "super-admin" &&
    !existing.suspended &&
    (next.role !== "super-admin" || next.suspended);

  if (isDegrading) {
    const activeSupers = await countSuperAdmins(prefix);
    if (activeSupers <= 1) return OrgAdminError.LastSuperAdmin;
  }

  const client = getCentralRedis();
  await client.set(adminKey(prefix, next.id), encryptPayload(next));
  return next;
}

/**
 * Slett en admin permanent. Håndhever "siste super-admin"-invariant.
 */
export async function deleteOrgAdmin(
  tenantPrefix: string,
  id: string,
): Promise<true | OrgAdminErrorCode> {
  const prefix = tenantPrefix.toLowerCase();
  const existing = await getOrgAdmin(prefix, id);
  if (!existing) return OrgAdminError.NotFound;

  if (existing.role === "super-admin" && !existing.suspended) {
    const activeSupers = await countSuperAdmins(prefix);
    if (activeSupers <= 1) return OrgAdminError.LastSuperAdmin;
  }

  const client = getCentralRedis();
  await client.del(adminKey(prefix, id));
  await client.srem(indexKey(prefix), id);
  return true;
}

/**
 * Suspender en admin (reverserbart, data bevares, login blokkeres).
 * Kortform for putOrgAdmin({...existing, suspended: true}).
 */
export async function suspendOrgAdmin(
  tenantPrefix: string,
  id: string,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  const existing = await getOrgAdmin(tenantPrefix, id);
  if (!existing) return OrgAdminError.NotFound;
  if (existing.suspended) return existing; // idempotent
  return putOrgAdmin({ ...existing, suspended: true });
}

/**
 * Reverser suspendering.
 */
export async function unsuspendOrgAdmin(
  tenantPrefix: string,
  id: string,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  const existing = await getOrgAdmin(tenantPrefix, id);
  if (!existing) return OrgAdminError.NotFound;
  if (!existing.suspended) return existing; // idempotent
  // Direkte put — invariant kan ikke brytes av å aktivere noen
  const client = getCentralRedis();
  const next = { ...existing, suspended: false };
  await client.set(adminKey(tenantPrefix.toLowerCase(), id), encryptPayload(next));
  return next;
}

/**
 * Endre rolle. Håndhever invariant via putOrgAdmin.
 */
export async function setOrgAdminRole(
  tenantPrefix: string,
  id: string,
  role: OrgAdminRole,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  const existing = await getOrgAdmin(tenantPrefix, id);
  if (!existing) return OrgAdminError.NotFound;
  if (existing.role === role) return existing; // idempotent
  return putOrgAdmin({ ...existing, role });
}

/**
 * Endre passord. Returnerer den oppdaterte recorden uten passwordHash-lek.
 * Krever plaintext (bcrypt-hashes internt).
 *
 * Iter 20.9 (D-081): Etter vellykket bytte settes `forcePasswordReset = false`
 * automatisk. Brukes både ved første-gangs tvinget reset og frivillig bytte
 * — kallere skiller på `forcePasswordReset`-flagget før kall.
 */
export async function updateOrgAdminPassword(
  tenantPrefix: string,
  id: string,
  newPassword: string,
): Promise<OrgAdmin | OrgAdminErrorCode> {
  if (!newPassword || newPassword.length < 8) {
    return OrgAdminError.WeakPassword;
  }
  const existing = await getOrgAdmin(tenantPrefix, id);
  if (!existing) return OrgAdminError.NotFound;
  const next: OrgAdmin = {
    ...existing,
    passwordHash: await hashPassword(newPassword),
    forcePasswordReset: false,
  };
  const client = getCentralRedis();
  await client.set(adminKey(tenantPrefix.toLowerCase(), id), encryptPayload(next));
  return next;
}

/**
 * Iter 20.9 (D-091, 2026-06-28) — Cascade-purge ALLE org-admins for et
 * tenantPrefix. BYPASSER "siste super-admin"-invariant og admin-suspend-
 * sjekker. Brukes KUN ved:
 *   - Cascade-delete av B2B-parent-tenant (delete-tenant.ts)
 *   - Orphan-cleanup-script (scripts/cleanup-orphan-org-admins.ts)
 *
 * Returnerer antall admins som ble slettet. Idempotent — hvis ingen admins
 * finnes returneres 0. Sletter også:
 *   - Indeks-SET-en `org-admin:<prefix>:admins`
 *   - Login-events-sorted-set per admin-ID (`org-admin-login-events:<id>`)
 *
 * ⚠️ Skal IKKE kalles fra normal admin-team-CRUD — bruk `deleteOrgAdmin()`
 *   som håndhever invariantene.
 */
export async function deleteAllOrgAdminsForPrefix(
  tenantPrefix: string,
): Promise<{ deletedCount: number; adminIds: string[] }> {
  const prefix = tenantPrefix.toLowerCase();
  const client = getCentralRedis();
  const ids = (await client.smembers(indexKey(prefix))) ?? [];
  if (ids.length === 0) {
    // Rydd uansett indeks-nøkkelen for sikkerhets skyld (kan eksistere som
    // tom set etter tidligere delvise sletinger).
    await client.del(indexKey(prefix));
    return { deletedCount: 0, adminIds: [] };
  }
  // Sekvensiell sletting (cascade-purge er sjelden hot path) — unngår
  // pipeline-API som ikke alle test-mocks støtter for blandede commands.
  for (const id of ids) {
    await client.del(adminKey(prefix, id));
    // Login-events lagres flat under adminId (ikke prefiks-scoped). Slettes
    // her med direkte nøkkel for å unngå sirkulær import av
    // `org-admin-login-events.ts`.
    await client.del(`org-admin-login-events:${id}`);
  }
  await client.del(indexKey(prefix));
  return { deletedCount: ids.length, adminIds: ids };
}
