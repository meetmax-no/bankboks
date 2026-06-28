/**
 * Ko | Do · Vault — Iter 20.2 — am-admin (B2B org-admin) auth-helpers
 *
 * Speiler `admin-auth.ts`-mønsteret men for `<prefix>-admin.kodovault.no`
 * (per blokker-svar 1=b, 2026-06-26).
 *
 * Cookie-format: `payload.signature`
 *   payload   = base64url(JSON({ iat, exp, adminId, prefix, role }))
 *   signature = base64url(HMAC-SHA256(ORG_ADMIN_SESSION_SECRET, payload))
 *
 * Web Crypto only — fungerer i både Edge (middleware) og Node (API routes).
 *
 * SEPARATE COOKIE FRA MIKE'S ADMIN — slik at en kompromittert am-admin-session
 * ikke kan brukes mot `admin.kodovault.no` (eller omvendt). Per D-078.
 */

import type { OrgAdminRole } from "./org-admin-types";

export const ORG_ADMIN_SESSION_COOKIE = "kodo_org_admin_session";
export const ORG_ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 timer

/** Host-suffix som identifiserer en am-admin-host. */
export const ORG_ADMIN_HOST_SUFFIX = "-admin.kodovault.no";

/** Rate-limit bucket for am-admin-login (sjekkes i auth/login route). */
export const ORG_ADMIN_LOGIN_RATE_LIMIT = {
  bucket: "org-admin-login",
  /** 10 forsøk per IP per 15 min — gir rom for legitim brukerfeil, men
   *  bremser brute-force. Etter 10 må man vente 15 min uansett IP. */
  limit: 10,
  windowSeconds: 15 * 60,
} as const;

// ────────────────────────────────────────────────────────────────────
// Base64url (Edge-safe — bruker btoa/atob)
// ────────────────────────────────────────────────────────────────────

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
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

// ────────────────────────────────────────────────────────────────────
// Session cookie
// ────────────────────────────────────────────────────────────────────

export type OrgAdminSessionPayload = {
  /** issued-at (unix sec). */
  iat: number;
  /** expiry (unix sec). */
  exp: number;
  /** OrgAdmin.id (UUID v4). */
  adminId: string;
  /** Hvilken tenantPrefix denne admin tilhører — håndhever isolasjon. */
  prefix: string;
  /** Rolle ved utstedelse — middleware kan bruke for tilgangs-sjekk. */
  role: OrgAdminRole;
};

export async function signOrgAdminSession(
  secret: string,
  data: { adminId: string; prefix: string; role: OrgAdminRole },
): Promise<string> {
  if (!secret) throw new Error("ORG_ADMIN_SESSION_SECRET mangler");
  const now = Math.floor(Date.now() / 1000);
  const payload: OrgAdminSessionPayload = {
    iat: now,
    exp: now + ORG_ADMIN_SESSION_TTL_SECONDS,
    adminId: data.adminId,
    prefix: data.prefix.toLowerCase(),
    role: data.role,
  };
  const payloadB64 = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await hmacSign(secret, payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifyOrgAdminSession(
  cookieValue: string | undefined | null,
  secret: string,
): Promise<OrgAdminSessionPayload | null> {
  if (!cookieValue || !secret) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  let expectedSig: string;
  try {
    expectedSig = await hmacSign(secret, payloadB64);
  } catch {
    return null;
  }
  if (!timingSafeEqualString(signature, expectedSig)) return null;

  let payload: OrgAdminSessionPayload;
  try {
    const json = new TextDecoder().decode(base64urlDecode(payloadB64));
    payload = JSON.parse(json) as OrgAdminSessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.adminId !== "string" ||
    typeof payload.prefix !== "string" ||
    (payload.role !== "super-admin" && payload.role !== "admin")
  ) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.exp) return null;

  return payload;
}

// ────────────────────────────────────────────────────────────────────
// Host-parsing — `<prefix>-admin.kodovault.no` og dev-aliaser
// ────────────────────────────────────────────────────────────────────

/**
 * Trekk ut tenant-prefix fra host. Returnerer prefix på lowercase eller
 * null hvis host ikke matcher am-admin-mønsteret.
 *
 * I produksjon: `<prefix>-admin.kodovault.no`
 * I dev/preview: bruker `?orgAdminPrefix=<prefix>` query-param som override
 * (siden vi ikke har wildcard på preview-hosts).
 */
export function extractOrgAdminPrefix(
  host: string,
  fallbackPrefix?: string | null,
): string | null {
  const h = host.toLowerCase().split(":")[0];

  // Mike's host er IKKE en am-admin-host (selv om den ender på "admin.kodovault.no")
  if (h === "admin.kodovault.no") return null;

  // Match `<prefix>-admin.kodovault.no` (literal suffix)
  if (h.endsWith(ORG_ADMIN_HOST_SUFFIX)) {
    const prefix = h.slice(0, -ORG_ADMIN_HOST_SUFFIX.length);
    if (prefix.length > 0 && /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(prefix)) {
      return prefix;
    }
    return null;
  }

  // Dev/preview-fallback: bruk query-param-prefix hvis host er en dev-host
  if (
    fallbackPrefix &&
    (h === "localhost" ||
      h === "127.0.0.1" ||
      h.endsWith(".preview.emergentagent.com") ||
      h.endsWith(".preview.emergentcf.cloud") ||
      h.endsWith(".vercel.app"))
  ) {
    const p = fallbackPrefix.toLowerCase();
    if (/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(p)) return p;
  }

  return null;
}

/** Sjekk om host er en am-admin-host (men IKKE Mike's admin-host). */
export function isOrgAdminHost(
  host: string,
  fallbackPrefix?: string | null,
): boolean {
  return extractOrgAdminPrefix(host, fallbackPrefix) !== null;
}
