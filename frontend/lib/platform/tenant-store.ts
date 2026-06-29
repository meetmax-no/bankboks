/**
 * Ko | Do · Vault — v4.3 Iter 1 — Sentral TenantRecord-store
 *
 * CRUD mot sentral Upstash-instans (CENTRAL_KV_*). Hver TenantRecord lagres
 * som AES-256-GCM-kryptert JSON under `tenant:<subdomain>`. En egen indeks
 * `tenant-index` holder en liste over alle subdomener for rask listing.
 *
 * Per D-039 (sentral platform-database, IKKE zero-knowledge).
 * Per Spec §11 (kryptert AES-256-GCM).
 *
 * Node runtime ONLY. Importer kun fra API-routes med `export const runtime = "nodejs"`.
 */
import { decryptPayload, encryptPayload, type EncryptedBlob } from "./tenant-crypto";
import { getCentralRedis } from "./central-upstash";
import {
  getProvisioningLogMax,
  truncateProvisioningLog,
} from "./provisioning-log-limits";
import {
  buildTenantRecord,
  type CreateTenantInput,
  type CreatedBy,
  type ProvisioningEvent,
  type TenantRecord,
} from "./tenant-types";

const TENANT_KEY_PREFIX = "tenant:";
const TENANT_INDEX_KEY = "tenant-index";

const getClient = getCentralRedis;

function tenantKey(subdomain: string): string {
  return `${TENANT_KEY_PREFIX}${subdomain.toLowerCase()}`;
}

/**
 * Soft migration (D-065): eksisterende records (skrevet før 2026-06-04)
 * mangler `provisioningLog`. Vi initialiserer til [] ved load — neste
 * putTenant persisterer feltet.
 */
function migrateTenant(record: TenantRecord): TenantRecord {
  let next = record;
  if (!Array.isArray(next.provisioningLog)) {
    next = { ...next, provisioningLog: [] };
  }
  if (typeof next.vaultLive !== "boolean") {
    next = { ...next, vaultLive: false };
  }
  if (next.vaultLiveAt === undefined) {
    next = { ...next, vaultLiveAt: null };
  }
  if (next.welcomeEmailSentAt === undefined) {
    next = { ...next, welcomeEmailSentAt: null };
  }
  if (next.pendingExpiresAt === undefined) {
    next = { ...next, pendingExpiresAt: null };
  }
  // Iter 19.6 (2026-06-13): cancel_at_period_end-felter
  if (typeof next.cancelAtPeriodEnd !== "boolean") {
    next = { ...next, cancelAtPeriodEnd: false };
  }
  if (next.cancelEffectiveAt === undefined) {
    next = { ...next, cancelEffectiveAt: null };
  }
  // Iter 17 (2026-06-13): lifecycle-warning-idempotensspor
  if (
    !next.lifecycleWarningsSentAt ||
    typeof next.lifecycleWarningsSentAt !== "object"
  ) {
    next = {
      ...next,
      lifecycleWarningsSentAt: { t7: null, t3: null, t1: null },
    };
  }
  // Iter 17 full pakke (2026-06-13): nye mail-idempotens-felter
  if (next.trialReminderT5SentAt === undefined) {
    next = { ...next, trialReminderT5SentAt: null };
  }
  if (next.lockedNotificationSentAt === undefined) {
    next = { ...next, lockedNotificationSentAt: null };
  }
  if (next.deletedNotificationSentAt === undefined) {
    next = { ...next, deletedNotificationSentAt: null };
  }
  // Iter 20.4 (2026-06-26): B2B fakturerings-cache.
  if (next.nextBillingDate === undefined) {
    next = { ...next, nextBillingDate: null };
  }
  if (next.parentLockedAt === undefined) {
    next = { ...next, parentLockedAt: null };
  }
  return next;
}

/**
 * Hent én tenant. Returnerer null hvis ikke funnet.
 */
export async function getTenant(
  subdomain: string,
): Promise<TenantRecord | null> {
  const client = getClient();
  const raw = await client.get<EncryptedBlob | null>(tenantKey(subdomain));
  if (!raw) return null;
  return migrateTenant(decryptPayload<TenantRecord>(raw));
}

/**
 * Sjekk om en tenant finnes uten å dekryptere innholdet.
 * Brukes f.eks. av subdomain-availability-sjekker (Iter 2).
 */
export async function tenantExists(subdomain: string): Promise<boolean> {
  const client = getClient();
  const exists = await client.exists(tenantKey(subdomain));
  return exists === 1;
}

/**
 * Liste alle tenants. Bruker tenant-index for å unngå SCAN i hot path.
 * Returnerer dekrypterte records sortert nyeste først.
 */
export async function listTenants(): Promise<TenantRecord[]> {
  const client = getClient();
  const subdomains = (await client.smembers(TENANT_INDEX_KEY)) ?? [];
  if (subdomains.length === 0) return [];
  // mget krever array av nøkler — bruk pipeline for batch.
  const pipe = client.pipeline();
  for (const sub of subdomains) {
    pipe.get<EncryptedBlob | null>(tenantKey(sub));
  }
  const blobs = (await pipe.exec()) as (EncryptedBlob | null)[];
  const records: TenantRecord[] = [];
  for (const blob of blobs) {
    if (!blob) continue;
    try {
      records.push(migrateTenant(decryptPayload<TenantRecord>(blob)));
    } catch {
      // Korrupt eller fra annen krypto-key — skip, ikke krasj hele listen.
      continue;
    }
  }
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return records;
}

/**
 * Opprett en ny tenant. Kaster hvis subdomain allerede finnes.
 */
export async function createTenant(
  input: CreateTenantInput,
  createdBy: CreatedBy,
): Promise<TenantRecord> {
  const client = getClient();
  const sub = input.subdomain.toLowerCase();
  const exists = await tenantExists(sub);
  if (exists) {
    throw new Error(`Tenant '${sub}' finnes allerede.`);
  }
  const record = buildTenantRecord({ ...input, subdomain: sub }, createdBy);
  const blob = encryptPayload(record);
  await client.set(tenantKey(sub), blob);
  await client.sadd(TENANT_INDEX_KEY, sub);
  return record;
}

/**
 * Oppdater en eksisterende tenant (full replace med ny record). Kaster hvis
 * subdomain ikke finnes. Bevarer createdAt automatisk hvis caller ikke setter det.
 */
export async function putTenant(record: TenantRecord): Promise<void> {
  const client = getClient();
  const sub = record.subdomain.toLowerCase();
  const existing = await tenantExists(sub);
  if (!existing) {
    throw new Error(`Tenant '${sub}' finnes ikke.`);
  }
  // D-123 (2026-06-29): trunker provisioningLog så den ikke vokser
  // uendelig. Asymmetrisk grense — B2B-parent får 1000, alle andre 100
  // (default.json provisioningLog.*). Trunkering skjer på EVERY write så
  // eksisterende records med 5000 events kuttes ned ved første touch
  // (gradvis migrering uten ekstra cron).
  const limit = getProvisioningLogMax(record);
  const trimmed = truncateProvisioningLog(record.provisioningLog, limit);
  const recordToStore: TenantRecord =
    trimmed === record.provisioningLog
      ? record
      : { ...record, provisioningLog: trimmed };
  const blob = encryptPayload({ ...recordToStore, subdomain: sub });
  await client.set(tenantKey(sub), blob);
  await client.sadd(TENANT_INDEX_KEY, sub); // idempotent
}

/**
 * Finn parent B2B-tenant med gitt tenantPrefix. Brukes ved invitasjons-
 * opprettelse (Iter 7.6 / D-056) for å verifisere at parent eksisterer
 * og at activeLicenses < maxLicenses før vi oppretter invitasjonen.
 *
 * Returnerer null hvis ingen B2B-tenant har dette prefikset. Tar kun
 * customerType === "b2b"-records i betraktning.
 */
export async function findB2BTenantByPrefix(
  prefix: string,
): Promise<TenantRecord | null> {
  const clean = prefix.toLowerCase().trim();
  if (!clean) return null;
  const all = await listTenants();
  return (
    all.find(
      (t) => t.customerType === "b2b" && t.tenantPrefix === clean,
    ) ?? null
  );
}

/**
 * Append én provisjonerings-hendelse til tenantens log (D-065).
 * Idempotent på subdomain-not-found (returnerer false, kaster ikke) —
 * brukes i provisjonerings-flyt der vi ikke vil at logging-feil skal
 * krasje hele kjeden.
 */
export async function appendProvisioningEvent(
  subdomain: string,
  event: ProvisioningEvent,
): Promise<boolean> {
  try {
    const tenant = await getTenant(subdomain);
    if (!tenant) return false;
    const updated: TenantRecord = {
      ...tenant,
      provisioningLog: [...tenant.provisioningLog, event],
    };
    await putTenant(updated);
    return true;
  } catch (e) {
    console.error(
      "[appendProvisioningEvent] failed to append event:",
      e,
      "event:",
      event,
    );
    return false;
  }
}

/**
 * Slett tenant-record fra sentral platform-database (blob + indeks).
 * Idempotent — returnerer false hvis ikke funnet.
 *
 * NB: Dette er LAVNIVÅ-helperen som KUN rører den sentrale DB-en. For å
 * slette tenant i ALLE systemer (Vercel + Upstash + sentral DB +
 * client-config + B2B-prefiks) bruk `deleteTenant()` fra
 * `lib/platform/delete-tenant.ts`.
 */
export async function deleteTenantRecord(subdomain: string): Promise<boolean> {
  const client = getClient();
  const sub = subdomain.toLowerCase();
  const removed = await client.del(tenantKey(sub));
  await client.srem(TENANT_INDEX_KEY, sub);
  return removed > 0;
}
