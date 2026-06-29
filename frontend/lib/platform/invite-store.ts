/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — InviteRecord-store (D-056)
 *
 * CRUD mot sentral Upstash. Hver invitasjon krypteres med samme
 * AES-256-GCM-pipeline som TenantRecord (defense-in-depth — D-039).
 *
 * Nøkler:
 *   invite:<token>                  → kryptert InviteRecord (TTL 7d ved pending)
 *   invite-index:<parentTenant>     → SET av tokens (for admin-listing per parent)
 *
 * Når status går fra pending → used kaller vi PERSIST for å fjerne TTL slik
 * at audit-historikk er tilgjengelig i admin etter at ansatten har opprettet
 * vault. Pending invitasjoner som aldri brukes dør automatisk etter 7 dager.
 *
 * Node runtime ONLY.
 */
import { decryptPayload, encryptPayload, type EncryptedBlob } from "./tenant-crypto";
import { getCentralRedis } from "./central-upstash";
import {
  buildInviteRecord,
  type CreateInviteInput,
  type InviteRecord,
  INVITE_TTL_SECONDS,
  isInviteExpired,
} from "./invite-types";

const INVITE_KEY_PREFIX = "invite:";
const INVITE_INDEX_PREFIX = "invite-index:";

function inviteKey(token: string): string {
  return `${INVITE_KEY_PREFIX}${token}`;
}

function indexKey(parentTenant: string): string {
  return `${INVITE_INDEX_PREFIX}${parentTenant.toLowerCase()}`;
}

/** Hent en invitasjon på token. Returnerer null hvis ikke funnet. */
export async function getInvite(token: string): Promise<InviteRecord | null> {
  const client = getCentralRedis();
  const raw = await client.get<EncryptedBlob | null>(inviteKey(token));
  if (!raw) return null;
  return decryptPayload<InviteRecord>(raw);
}

/** Liste alle invitasjoner for en gitt parent (sortert nyeste først). */
export async function listInvitesForParent(
  parentTenant: string,
): Promise<InviteRecord[]> {
  const client = getCentralRedis();
  const tokens = (await client.smembers(indexKey(parentTenant))) ?? [];
  if (tokens.length === 0) return [];
  const pipe = client.pipeline();
  for (const tok of tokens) {
    pipe.get<EncryptedBlob | null>(inviteKey(tok));
  }
  const blobs = (await pipe.exec()) as (EncryptedBlob | null)[];
  const records: InviteRecord[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i];
    if (!blob) {
      // Record er auto-utløpt fra Redis — rydd index-referansen.
      await client.srem(indexKey(parentTenant), tokens[i]);
      continue;
    }
    try {
      records.push(decryptPayload<InviteRecord>(blob));
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return records;
}

/** Opprett en ny invitasjon. Token genereres internt. */
export async function createInvite(
  input: CreateInviteInput,
): Promise<InviteRecord> {
  const client = getCentralRedis();
  const record = buildInviteRecord(input);
  const blob = encryptPayload(record);
  // TTL settes ved opprettelse — pending invitasjoner dør etter 7d
  await client.set(inviteKey(record.token), blob, { ex: INVITE_TTL_SECONDS });
  await client.sadd(indexKey(record.parentTenant), record.token);
  return record;
}

/**
 * Oppdater en eksisterende invitasjon (full replace).
 * Når status går til "used" fjernes TTL slik at posten persisteres
 * for audit-formål.
 */
export async function putInvite(record: InviteRecord): Promise<void> {
  const client = getCentralRedis();
  const blob = encryptPayload(record);
  if (record.status === "used") {
    // PERSIST — ingen TTL, posten lever til admin manuelt sletter
    await client.set(inviteKey(record.token), blob);
  } else {
    // Bevar resterende TTL: les ut og sett samme verdi tilbake
    const ttl = await client.ttl(inviteKey(record.token));
    if (ttl > 0) {
      await client.set(inviteKey(record.token), blob, { ex: ttl });
    } else {
      await client.set(inviteKey(record.token), blob);
    }
  }
  await client.sadd(indexKey(record.parentTenant), record.token);
}

/** Slett en invitasjon (idempotent). */
export async function deleteInvite(record: InviteRecord): Promise<boolean> {
  const client = getCentralRedis();
  const removed = await client.del(inviteKey(record.token));
  await client.srem(indexKey(record.parentTenant), record.token);
  return removed > 0;
}

/**
 * D-092 (2026-06-28) — Hybrid-seat: tell aktive pending-invites for en parent.
 *
 * Brukes ved invite-create i `/api/am-admin/invites` POST for å håndheve
 * `activeLicenses + pendingInvites ≤ maxLicenses`. Eksisterende cleanup-cron
 * markerer utløpte som status="expired" → de telles IKKE. Manuell DELETE
 * fjerner invite-record helt → telles IKKE. Accept setter status="used" →
 * telles IKKE (D-111: activeLicenses tellet live fra child-tenants i stedet).
 *
 * Returnerer kun antall — krever ikke decrypt-roundtrip per record.
 */
export async function countActivePendingInvites(
  parentTenantPrefix: string,
): Promise<number> {
  const records = await listInvitesForParent(parentTenantPrefix);
  const now = new Date();
  let count = 0;
  for (const r of records) {
    if (r.status !== "pending") continue;
    if (isInviteExpired(r, now)) continue;
    count++;
  }
  return count;
}

/**
 * Liste ALLE invitasjoner på tvers av parents — brukes av cron-jobben
 * for å markere utløpte. Itererer over alle invite-index:* SET-er.
 *
 * (Vi bruker SCAN-pattern for å unngå KEYS i hot path; men siden Upstash
 * Redis er liten og dette kjører max én gang per dag, er det greit.)
 */
export async function listAllInvites(): Promise<InviteRecord[]> {
  const client = getCentralRedis();
  // Upstash SCAN returnerer [cursor, keys]
  const collected: string[] = [];
  let cursor = "0";
  do {
    const result = (await client.scan(cursor, {
      match: `${INVITE_INDEX_PREFIX}*`,
      count: 100,
    })) as [string, string[]];
    cursor = result[0];
    collected.push(...result[1]);
  } while (cursor !== "0");

  const allTokens = new Set<string>();
  for (const idxKey of collected) {
    const tokens = (await client.smembers(idxKey)) ?? [];
    tokens.forEach((t) => allTokens.add(t));
  }
  if (allTokens.size === 0) return [];

  const pipe = client.pipeline();
  const tokenList = Array.from(allTokens);
  for (const tok of tokenList) {
    pipe.get<EncryptedBlob | null>(inviteKey(tok));
  }
  const blobs = (await pipe.exec()) as (EncryptedBlob | null)[];
  const records: InviteRecord[] = [];
  for (const blob of blobs) {
    if (!blob) continue;
    try {
      records.push(decryptPayload<InviteRecord>(blob));
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * D-118 (2026-06-29) — slett invites assosiert med en slettet child-tenant.
 *
 * Erstatter D-101 (`markInvitesAsChildDeleted`). Audit-spor sikres via
 * `logEvent("tenant_deleted")` på parent-tenant (`provisioningLog`) +
 * Stripe customer-bevaring per D-070. Invite-recorden tilfører ingen ny
 * informasjon — bare UI-støy som "Child-vault slettet"-orphan.
 *
 * Sletter ALLE invites (pending/expired/used) der `subdomain` matcher den
 * slettede tenanten. Idempotent — sletting av en allerede borte record er
 * en no-op (deleteInvite returnerer false).
 *
 * @returns antall invites som faktisk ble slettet
 */
export async function deleteInvitesForSubdomain(
  subdomain: string,
): Promise<number> {
  const all = await listAllInvites();
  let deleted = 0;
  for (const inv of all) {
    if (inv.subdomain !== subdomain) continue;
    const ok = await deleteInvite(inv);
    if (ok) deleted += 1;
  }
  return deleted;
}

