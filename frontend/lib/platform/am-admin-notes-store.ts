/**
 * Ko | Do · Vault — Iter 20.5c (2026-06-26) — am-admin notes-store
 *
 * Sentral Upstash-storage for per-ansatt admin-notater. Per-org +
 * per-subdomain under `org-admin-notes:<prefix>:<subdomain>`. Indeks
 * `org-admin-notes:<prefix>:index` (SET) holder oversikt over hvilke
 * subdomains som har notater — brukes ved "Glemt MPW"-reset for å
 * slette alle krypterte notater i ett sveip uten en SCAN.
 *
 * Per user-svar 1=A (2026-06-26): separat key — bryter IKKE B2C-tenant-
 * recorden, og lar oss slette ALLE notater i én operasjon ved reset.
 *
 * Notatets innhold er en `MpwEnvelope` (AES-GCM, AES-256). Server ser
 * KUN opaque envelope — kan ikke lese innholdet. Bytemerge er ren
 * client-side krypto (D-079 zero-knowledge).
 *
 * Node runtime ONLY.
 */
import { getCentralRedis } from "./central-upstash";
import { isMpwEnvelope, type MpwEnvelope } from "./am-admin-mpw";

const PREFIX_RX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;
const SUBDOMAIN_RX = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function noteKey(prefix: string, subdomain: string): string {
  return `org-admin-notes:${prefix.toLowerCase()}:${subdomain.toLowerCase()}`;
}

function noteIndexKey(prefix: string): string {
  return `org-admin-notes:${prefix.toLowerCase()}:index`;
}

function validatePrefix(prefix: string): void {
  if (!PREFIX_RX.test(prefix.toLowerCase())) {
    throw new Error(`Ugyldig tenantPrefix: ${prefix}`);
  }
}

function validateSubdomain(subdomain: string): void {
  if (!SUBDOMAIN_RX.test(subdomain.toLowerCase())) {
    throw new Error(`Ugyldig subdomain: ${subdomain}`);
  }
}

/**
 * Hent admin-notat-envelope for en gitt ansatt. Returnerer null hvis
 * intet notat er lagret eller blob er korrupt.
 */
export async function getNote(
  prefix: string,
  subdomain: string,
): Promise<MpwEnvelope | null> {
  validatePrefix(prefix);
  validateSubdomain(subdomain);
  const client = getCentralRedis();
  const blob = await client.get<unknown>(noteKey(prefix, subdomain));
  if (!blob) return null;
  if (!isMpwEnvelope(blob)) return null;
  return blob;
}

/**
 * Som getNote, men returnerer status om blob fantes men var korrupt.
 * Brukes av GET-routen for å kunne fortelle UI at "et notat fantes
 * men kunne ikke leses" — slik at brukeren ikke ved et uhell
 * overskriver det med en tom textarea.
 */
export async function getNoteStatus(
  prefix: string,
  subdomain: string,
): Promise<
  | { state: "missing" }
  | { state: "ok"; envelope: MpwEnvelope }
  | { state: "corrupt" }
> {
  validatePrefix(prefix);
  validateSubdomain(subdomain);
  const client = getCentralRedis();
  const blob = await client.get<unknown>(noteKey(prefix, subdomain));
  if (!blob) return { state: "missing" };
  if (!isMpwEnvelope(blob)) return { state: "corrupt" };
  return { state: "ok", envelope: blob };
}

/**
 * Lagre admin-notat-envelope. Overskriver eksisterende. Oppdaterer
 * indeksen idempotent.
 */
export async function setNote(
  prefix: string,
  subdomain: string,
  envelope: MpwEnvelope,
): Promise<void> {
  validatePrefix(prefix);
  validateSubdomain(subdomain);
  if (!isMpwEnvelope(envelope)) {
    throw new Error("Ugyldig MpwEnvelope — kan ikke lagre notat");
  }
  const client = getCentralRedis();
  await client.set(noteKey(prefix, subdomain), envelope);
  await client.sadd(noteIndexKey(prefix), subdomain.toLowerCase());
}

/**
 * Slett admin-notat for én ansatt. Idempotent. Fjerner fra indeks.
 */
export async function deleteNote(
  prefix: string,
  subdomain: string,
): Promise<void> {
  validatePrefix(prefix);
  validateSubdomain(subdomain);
  const client = getCentralRedis();
  await client.del(noteKey(prefix, subdomain));
  await client.srem(noteIndexKey(prefix), subdomain.toLowerCase());
}

/**
 * List subdomains med admin-notater for en org. Brukes av backup-
 * eksporten (Iter 20.5d) og av reset-flyten for å vite hvilke nøkler
 * som skal slettes.
 */
export async function listNoteSubdomains(prefix: string): Promise<string[]> {
  validatePrefix(prefix);
  const client = getCentralRedis();
  return (await client.smembers(noteIndexKey(prefix))) ?? [];
}

/**
 * Slett ALLE admin-notater for en org. Brukes ved "Glemt MPW"-reset
 * (DELETE /api/am-admin/mpw) per blokker-svar 4=B.
 *
 * Sletter også selve indeksen til slutt så vi ikke har dangling pekere.
 */
export async function deleteAllNotes(prefix: string): Promise<number> {
  validatePrefix(prefix);
  const client = getCentralRedis();
  const subdomains = (await client.smembers(noteIndexKey(prefix))) ?? [];
  if (subdomains.length === 0) {
    await client.del(noteIndexKey(prefix));
    return 0;
  }
  const pipe = client.pipeline();
  for (const sub of subdomains) {
    pipe.del(noteKey(prefix, sub));
  }
  pipe.del(noteIndexKey(prefix));
  await pipe.exec();
  return subdomains.length;
}
