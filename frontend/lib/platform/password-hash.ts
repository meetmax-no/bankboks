/**
 * Ko | Do · Vault — Iter 20.1 — bcrypt-passord-hashing-helper
 *
 * Brukes for am-admin innloggings-passord. NIST 2026-anbefaling for bcrypt:
 * cost-factor 12 (≈250ms per hash på moderne hardware — bremser brute-force
 * uten å være ubrukelig for legitime login-forsøk).
 *
 * Node runtime ONLY. Importer kun fra API-routes med `runtime = "nodejs"`.
 *
 * Per D-079 — passwordHash lagres i klartekst-vis (bcrypt-hash) på Upstash
 * fordi server MÅ kunne verifisere det ved login. MPW-kryptering (D-079)
 * gjelder kun "org-interne data" (backup-eksport + admin-notater), IKKE
 * passwordHash som er en envei-funksjon i seg selv.
 */
import bcrypt from "bcrypt";

const BCRYPT_COST = 12;

/**
 * Hash et plaintext-passord til bcrypt-format ($2b$12$...).
 * Tar ~250ms på moderne hardware (CPU-bound).
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length === 0) {
    throw new Error("Passord kan ikke være tomt");
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Verifiser et plaintext-passord mot en lagret bcrypt-hash.
 * Konstant-tid sammenligning (timing-safe).
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
