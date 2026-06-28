/**
 * Ko | Do · Vault — Iter 20.5a (2026-06-26 · D-079) — am-admin MPW Store
 *
 * Sentral Upstash-storage for am-admin Master Password (MPW) verifier-
 * envelope. Per-org under `org-meta:<prefix>:mpw`.
 *
 * Per blokker-svar 1=B (2026-06-26): én MPW per org, delt mellom alle
 * admins i samme tenantPrefix. Envelopen er en opaque MpwEnvelope —
 * sentral Upstash kan IKKE lese innholdet (zero-knowledge).
 *
 * Per blokker-svar 4=B: `deleteMpwVerifier` brukes ved "Glemt MPW" —
 * verifier slettes uigjenkallelig. Caller MÅ også slette alle
 * krypterte payloads (adminNotes per ansatt) i samme transaksjon —
 * det er Iter 20.5c sitt ansvar.
 *
 * Node runtime ONLY. Importer kun fra API-routes med `runtime = "nodejs"`.
 */
import { getCentralRedis } from "./central-upstash";
import { isMpwEnvelope, type MpwEnvelope } from "./am-admin-mpw";

const PREFIX_RX = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

function mpwKey(tenantPrefix: string): string {
  return `org-meta:${tenantPrefix.toLowerCase()}:mpw`;
}

function validatePrefix(prefix: string): void {
  if (!PREFIX_RX.test(prefix.toLowerCase())) {
    throw new Error(`Ugyldig tenantPrefix: ${prefix}`);
  }
}

/**
 * Hent MPW-verifier-envelope for en org. Returnerer null hvis MPW
 * ikke er satt opp ennå.
 *
 * Validerer at lagret blob er en gyldig MpwEnvelope — korrupt data
 * gir null (caller bør prompte for re-setup).
 */
export async function getMpwVerifier(
  tenantPrefix: string,
): Promise<MpwEnvelope | null> {
  validatePrefix(tenantPrefix);
  const client = getCentralRedis();
  const blob = await client.get<unknown>(mpwKey(tenantPrefix));
  if (!blob) return null;
  if (!isMpwEnvelope(blob)) return null;
  return blob;
}

/**
 * Sett MPW-verifier-envelope. Brukes ved første MPW-setup ELLER ved
 * "Glemt MPW"-reset (overskriver eksisterende). Caller har ansvar
 * for å slette gamle krypterte payloads ved reset.
 *
 * Throws hvis envelope er ugyldig (defensive: vi vil ALDRI persistere
 * en korrupt verifier som ville låst orgen ute permanent).
 */
export async function setMpwVerifier(
  tenantPrefix: string,
  envelope: MpwEnvelope,
): Promise<void> {
  validatePrefix(tenantPrefix);
  if (!isMpwEnvelope(envelope)) {
    throw new Error("Ugyldig MpwEnvelope — vil ikke persistere korrupt verifier");
  }
  const client = getCentralRedis();
  await client.set(mpwKey(tenantPrefix), envelope);
}

/**
 * Atomisk sett MPW-verifier KUN hvis ingen finnes (SETNX). Returnerer
 * true ved suksess, false hvis en verifier allerede eksisterer.
 *
 * Brukes av `POST /api/am-admin/mpw/setup` for å lukke TOCTOU-vinduet
 * der to samtidige super-admin-setup-kall begge passerer get→null-
 * sjekken og den siste SET'en silently overskriver den første. Per
 * D-079 risk-mitigation (2026-06-26 user-direktiv).
 */
export async function setMpwVerifierIfAbsent(
  tenantPrefix: string,
  envelope: MpwEnvelope,
): Promise<boolean> {
  validatePrefix(tenantPrefix);
  if (!isMpwEnvelope(envelope)) {
    throw new Error("Ugyldig MpwEnvelope — vil ikke persistere korrupt verifier");
  }
  const client = getCentralRedis();
  // Upstash SET med { nx: true } returnerer "OK" ved suksess, null hvis
  // nøkkelen allerede eksisterer.
  const result = await client.set(mpwKey(tenantPrefix), envelope, { nx: true });
  return result === "OK";
}

/**
 * Slett MPW-verifier irreversibelt. Brukes av "Glemt MPW"-flowen
 * (blokker-svar 4=B). Caller MÅ også slette alle adminNotes-payloads
 * — dette er Iter 20.5c sin oppgave.
 *
 * Idempotent: trygt å kalle selv om ingen verifier eksisterer.
 */
export async function deleteMpwVerifier(tenantPrefix: string): Promise<void> {
  validatePrefix(tenantPrefix);
  const client = getCentralRedis();
  await client.del(mpwKey(tenantPrefix));
}

/**
 * Sjekk om MPW er satt opp for en org uten å laste hele envelopen.
 * Brukes av `/api/am-admin/auth/me` for å fortelle klienten om vi
 * skal vise MPW-unlock-modal eller MPW-setup-modal.
 */
export async function hasMpwVerifier(tenantPrefix: string): Promise<boolean> {
  validatePrefix(tenantPrefix);
  const client = getCentralRedis();
  const exists = await client.exists(mpwKey(tenantPrefix));
  return exists > 0;
}
