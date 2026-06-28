/**
 * Ko | Do · Vault — Iter 20.5a (2026-06-26 · D-079) — am-admin Master Password
 *
 * Klient-side krypto for am-admin valgfri Master Password (MPW). Per-org —
 * delt mellom alle admins i samme tenantPrefix (D-079, blokker-svar 1=B).
 *
 * Brukes til å kryptere:
 *   - Per-employee adminNotes (Iter 20.5c)
 *   - Backup-eksport av org-metadata (Iter 20.5d)
 *
 * Krypto-spec (identisk med B2C-vault for konsistens og Code Audit-overflate):
 *   - PBKDF2-SHA256, 600 000 iterasjoner
 *   - AES-GCM 256-bit, 12-byte IV, 16-byte salt
 *   - Master password forlater ALDRI klienten — sentral Upstash ser kun
 *     opaque {salt, iv, cipher, iterations}-envelope
 *
 * Verifier-mønster: en kjent klartekst ("kodo-mpw-verifier-v1") krypteres
 * ved MPW-setup og lagres som sentral envelope. Ved unlock dekrypterer vi
 * envelopen — matcher klartekst → korrekt MPW.
 *
 * Per blokker-svar 4=B (2026-06-26): Hvis MPW glemmes, "Glemt MPW"-knappen
 * sletter både verifier og alle krypterte payloads. Ingen recovery — Iter 21+.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const MPW_VERIFIER_PLAINTEXT = "kodo-mpw-verifier-v1";

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Krypto-envelope brukt for ALLE MPW-krypterte payloads (verifier,
 * adminNotes, backup-eksport). Persisteres som JSON.
 */
export type MpwEnvelope = {
  version: 1;
  /** Base64-encoded salt (16 bytes). */
  salt: string;
  /** Base64-encoded IV (12 bytes). */
  iv: string;
  /** Base64-encoded ciphertext (inkl. AES-GCM auth tag). */
  cipher: string;
  iterations: number;
};

// ─── Base64 helpers ─────────────────────────────────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

// ─── Key derivation ─────────────────────────────────────────────────────
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ─── Encrypt / Decrypt string payloads ──────────────────────────────────
async function encryptStringWithKey(
  plaintext: string,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number,
): Promise<MpwEnvelope> {
  const iv = randomBytes(IV_LENGTH);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iterations,
  };
}

async function decryptEnvelopeWithKey(
  envelope: MpwEnvelope,
  key: CryptoKey,
): Promise<string> {
  const iv = base64ToBytes(envelope.iv);
  const cipher = base64ToBytes(envelope.cipher);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return dec.decode(plainBuf);
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Oppretter en MPW-verifier-envelope ved første MPW-setup. Brukes til å
 * verifisere MPW ved senere unlock — uten å lagre selve passordet.
 *
 * Returnerer envelope + derived key (caller kan bruke nøkkelen umiddelbart
 * for å kryptere første batch med adminNotes uten å derive på nytt).
 */
export async function createMpwVerifier(password: string): Promise<{
  envelope: MpwEnvelope;
  key: CryptoKey;
  salt: Uint8Array;
}> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt);
  const envelope = await encryptStringWithKey(
    MPW_VERIFIER_PLAINTEXT,
    key,
    salt,
    PBKDF2_ITERATIONS,
  );
  return { envelope, key, salt };
}

/**
 * Verifiserer at password matcher en eksisterende MPW-verifier-envelope.
 * Returnerer derived key ved suksess (kan brukes til å dekryptere notater +
 * backup-data uten å derive på nytt). Returnerer null hvis feil passord.
 */
export async function verifyMpw(
  envelope: MpwEnvelope,
  password: string,
): Promise<{ key: CryptoKey; salt: Uint8Array } | null> {
  const salt = base64ToBytes(envelope.salt);
  try {
    const key = await deriveKey(password, salt, envelope.iterations);
    const plaintext = await decryptEnvelopeWithKey(envelope, key);
    if (plaintext !== MPW_VERIFIER_PLAINTEXT) {
      // Hvis dekryptering lykkes men klartekst er feil (svært usannsynlig
      // med AES-GCM auth tag), avvis.
      return null;
    }
    return { key, salt };
  } catch {
    // AES-GCM-dekrypterings-feil = feil passord (auth tag mismatch).
    return null;
  }
}

/**
 * Krypterer en vilkårlig streng (typisk JSON-stringified) med en allerede
 * derivet nøkkel. Brukes for adminNotes + backup-payload.
 *
 * NB: Bruker SAMME salt som verifier — det betyr at ALL MPW-kryptert data
 * for en gitt org bruker samme salt + iterations. Kun IV varierer per
 * envelope. Dette er trygt fordi key=PBKDF2(password, salt) er konstant
 * for sesjonen, og AES-GCM krever kun unik (key, iv)-kombinasjon.
 */
export async function encryptWithMpwKey(
  plaintext: string,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<MpwEnvelope> {
  return encryptStringWithKey(plaintext, key, salt, iterations);
}

/**
 * Dekrypterer en MPW-envelope med en allerede derivet nøkkel. Kaster hvis
 * envelope er korrupt eller key ikke matcher.
 */
export async function decryptWithMpwKey(
  envelope: MpwEnvelope,
  key: CryptoKey,
): Promise<string> {
  return decryptEnvelopeWithKey(envelope, key);
}

/**
 * Type-guard for å validere at en JSON-blob faktisk er en MpwEnvelope.
 * Brukes ved load fra Upstash for å unngå runtime-feil.
 */
export function isMpwEnvelope(value: unknown): value is MpwEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.cipher === "string" &&
    typeof v.iterations === "number"
  );
}

export const MPW_PBKDF2_ITERATIONS = PBKDF2_ITERATIONS;
