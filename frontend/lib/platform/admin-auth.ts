/**
 * Ko | Do · Vault — v4.3 Iter 0 (revidert) — Admin-auth helpers
 *
 * Kun for Mike sin admin-konsoll på `admin.kodovault.no`.
 * Per D-035 + Mike's beslutning 2026-06-01:
 *   admin.kodovault.no + vault unlocked = admin-tilgang.
 *
 * Ingen separat admin-pwd. Ingen Argon2id. Ingen credentials-generator.
 * Klienten kaller `POST /api/admin/session/start` automatisk etter vault-unlock.
 * Server-side beskyttelse: host-lock + SameSite=Strict + HMAC-signert cookie
 * (ADMIN_SESSION_SECRET).
 *
 * Cookie-format: `payload.signature`
 *   payload   = base64url(JSON({ iat: <unix-sec>, exp: <unix-sec> }))
 *   signature = base64url(HMAC-SHA256(ADMIN_SESSION_SECRET, payload))
 *
 * Verifisering bruker Web Crypto (`crypto.subtle`) slik at det fungerer både i
 * Edge runtime (middleware) og Node runtime (API-routes).
 */

export const ADMIN_SESSION_COOKIE = "kodo_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 timer
export const ADMIN_HOST = "admin.kodovault.no";

// ─────────────────────────────────────────────────────────────────────────────
// Base64url (Edge-safe — bruker btoa/atob)
// ─────────────────────────────────────────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const normalised = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(normalised);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

// Constant-time string-compare — unngår timing-orakel ved signatur-sjekk.
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC-SHA256 (Web Crypto — fungerer i Edge + Node)
// ─────────────────────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return base64urlEncode(new Uint8Array(sig));
}

// ─────────────────────────────────────────────────────────────────────────────
// Session cookie — sign + verify
// ─────────────────────────────────────────────────────────────────────────────

export type AdminSessionPayload = {
  iat: number; // issued-at (unix sec)
  exp: number; // expiry (unix sec)
};

/**
 * Lag en signert session-cookie-verdi. Kun kalles fra /api/admin/login
 * etter Argon2id-verifisering av admin-pwd.
 */
export async function signAdminSession(secret: string): Promise<string> {
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET mangler");
  }
  const now = Math.floor(Date.now() / 1000);
  const payload: AdminSessionPayload = {
    iat: now,
    exp: now + ADMIN_SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * Verifiser en session-cookie-verdi. Returnerer payload hvis gyldig, ellers null.
 * Trygg å kalle fra Edge runtime (middleware) — kun Web Crypto.
 */
export async function verifyAdminSession(
  cookieValue: string | undefined | null,
  secret: string,
): Promise<AdminSessionPayload | null> {
  if (!cookieValue || !secret) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  // Re-signer payload og sammenlign signaturer constant-time.
  let expectedSig: string;
  try {
    expectedSig = await hmacSign(secret, payloadB64);
  } catch {
    return null;
  }
  if (!timingSafeEqualString(signature, expectedSig)) return null;

  // Parse payload + sjekk expiry.
  let payload: AdminSessionPayload;
  try {
    const json = new TextDecoder().decode(base64urlDecode(payloadB64));
    payload = JSON.parse(json) as AdminSessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.exp) return null;

  return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Argon2id pwd-verifisering fjernet i revidert Iter 0 (2026-06-01).
// Admin-auth er nå rent vault-unlock-basert (D-035) — ingen pwd på server.
// ─────────────────────────────────────────────────────────────────────────────

