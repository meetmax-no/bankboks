// Zero-knowledge krypto-kjerne for Ko | Do · Vault.
//
// Master-passord → PBKDF2-SHA256 600 000 iterasjoner → 256-bit nøkkel
// → AES-GCM kryptering av hele entries-arrayet.
//
// Master-passord forlater ALDRI klienten. Server ser bare opaque
// salt + iv + ciphertext.

import type { EncryptedVaultBlob, VaultPayload } from "./types";
import { tHook } from "./i18n";

export const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- Base64 helpers (browser-safe) ----------

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

// ---------- Random ----------

export function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

// ---------- PBKDF2 → AES-GCM nøkkel ----------

export async function deriveKey(
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

// ---------- Encrypt / Decrypt vault payload ----------

export async function encryptVault(
  payload: VaultPayload,
  password: string,
): Promise<EncryptedVaultBlob> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);
  const plaintext = enc.encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext,
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Re-krypterer en eksisterende vault med en alleredeavledet nøkkel — billigere
 * når nøkkelen allerede ligger i minnet (vanlig CRUD-lagring).
 */
export async function encryptVaultWithKey(
  payload: VaultPayload,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<EncryptedVaultBlob> {
  const iv = randomBytes(IV_LENGTH);
  const plaintext = enc.encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext,
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iterations,
    updatedAt: new Date().toISOString(),
  };
}

export interface DecryptResult {
  payload: VaultPayload;
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

export async function decryptVault(
  blob: EncryptedVaultBlob,
  password: string,
): Promise<DecryptResult> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipher = base64ToBytes(blob.cipher);
  const iterations = blob.iterations || PBKDF2_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
  } catch {
    throw new Error("Feil master-passord");
  }
  const text = dec.decode(plainBuf);
  let payload: VaultPayload;
  try {
    payload = JSON.parse(text) as VaultPayload;
  } catch {
    throw new Error("Korrupt vault-data");
  }
  return { payload, key, salt, iterations };
}

/**
 * Dekrypter med en allerede-avledet nøkkel — bruk når brukeren er logget inn
 * og vi vil refresh blob fra server uten å spørre om master-pwd igjen.
 * Forutsetter at salt+iterations matcher (samme master-pwd ble brukt).
 */
export async function decryptVaultWithKey(
  blob: EncryptedVaultBlob,
  key: CryptoKey,
): Promise<VaultPayload> {
  const iv = base64ToBytes(blob.iv);
  const cipher = base64ToBytes(blob.cipher);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
  } catch {
    throw new Error(tHook("crypto.error_decrypt_blob_failed"));
  }
  return JSON.parse(dec.decode(plainBuf)) as VaultPayload;
}

// ---------------------------------------------------------------------------
// GENERIC PAYLOAD HELPERS — brukes av cards-blob (v3.0+) og fremtidige blobs.
// Strukturen er identisk med vault-funksjonene over, men typed som <T> slik
// at samme krypto-kjerne kan brukes for både CardsPayload og VaultPayload.
// ---------------------------------------------------------------------------

export async function encryptPayload<T>(
  payload: T,
  password: string,
): Promise<EncryptedVaultBlob> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);
  const plaintext = enc.encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext,
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iterations: PBKDF2_ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

export async function encryptPayloadWithKey<T>(
  payload: T,
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<EncryptedVaultBlob> {
  const iv = randomBytes(IV_LENGTH);
  const plaintext = enc.encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext,
  );
  return {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipherBuf)),
    iterations,
    updatedAt: new Date().toISOString(),
  };
}

export interface DecryptPayloadResult<T> {
  payload: T;
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
}

export async function decryptPayload<T>(
  blob: EncryptedVaultBlob,
  password: string,
): Promise<DecryptPayloadResult<T>> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipher = base64ToBytes(blob.cipher);
  const iterations = blob.iterations || PBKDF2_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
  } catch {
    throw new Error("Feil master-passord");
  }
  const text = dec.decode(plainBuf);
  let payload: T;
  try {
    payload = JSON.parse(text) as T;
  } catch {
    throw new Error("Korrupt blob-data");
  }
  return { payload, key, salt, iterations };
}

export async function decryptPayloadWithKey<T>(
  blob: EncryptedVaultBlob,
  key: CryptoKey,
): Promise<T> {
  const iv = base64ToBytes(blob.iv);
  const cipher = base64ToBytes(blob.cipher);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
  } catch {
    throw new Error(tHook("crypto.error_decrypt_blob_failed"));
  }
  return JSON.parse(dec.decode(plainBuf)) as T;
}

