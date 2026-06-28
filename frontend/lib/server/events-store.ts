// Server-side event-log + per-IP rate-limiter backed by Upstash Redis.
//
// Events:
//   access              — GET /api/vault (auto — server)
//   unlock-success      — klient rapporterer etter vellykket decrypt
//   unlock-fail         — klient rapporterer etter feil master
//   unlock-biometric    — klient rapporterer (Touch/Face ID)
//   modify              — PUT /api/vault (auto — server)
//   master-changed      — klient rapporterer (bytte master-pwd)
//   reset               — DELETE /api/vault (auto — server)
//
// Rate-limit: per-IP "unlock-fail"-teller med 15 min TTL. Ved ≥10 feil
// returnerer vault-route 429 på GET (nekter å levere blobben).

import { Redis } from "@upstash/redis";
import type { RequestMeta } from "./request-meta";
import { formatLocation } from "./request-meta";

export const EVENTS_KEY = "vault:default:events";
export const RL_PREFIX = "vault:default:ratelimit:";

export const MAX_EVENTS = 200; // server-side hard cap
export const RL_WINDOW_SEC = 15 * 60; // 15 min
export const RL_MAX_FAILS = 10;

export type EventKind =
  | "access"
  | "unlock-success"
  | "unlock-fail"
  | "unlock-biometric"
  | "modify"
  | "master-changed"
  | "reset";

export interface VaultEvent {
  id: string; // uuid-ish
  at: string; // ISO
  kind: EventKind;
  ip: string;
  device: string; // "Chrome · macOS"
  userAgent: string;
  location?: string; // "Oslo, NO"
  country?: string;
  city?: string;
}

function getRedis(): Redis {
  return Redis.fromEnv();
}

function newId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Append event til head av liste. Trunker til MAX_EVENTS.
 * Bruker LPUSH + LTRIM (atomisk nok for single-user).
 */
export async function logEvent(
  kind: EventKind,
  meta: RequestMeta,
): Promise<VaultEvent> {
  const ev: VaultEvent = {
    id: newId(),
    at: new Date().toISOString(),
    kind,
    ip: meta.ip,
    device: meta.deviceSummary,
    userAgent: meta.userAgent,
    location: formatLocation(meta),
    country: meta.country,
    city: meta.city,
  };
  const redis = getRedis();
  // Lagre som JSON-string. Upstash auto-serialiserer, men LPUSH vil se objektet
  // ok. For maksimal kompatibilitet lagrer vi JSON.
  await redis.lpush(EVENTS_KEY, JSON.stringify(ev));
  await redis.ltrim(EVENTS_KEY, 0, MAX_EVENTS - 1);
  return ev;
}

export async function listEvents(limit: number = 100): Promise<VaultEvent[]> {
  const redis = getRedis();
  const clamped = Math.max(1, Math.min(limit, MAX_EVENTS));
  const raw = await redis.lrange(EVENTS_KEY, 0, clamped - 1);
  const out: VaultEvent[] = [];
  for (const item of raw || []) {
    try {
      if (typeof item === "string") {
        out.push(JSON.parse(item) as VaultEvent);
      } else if (item && typeof item === "object") {
        // Upstash har allerede deserialisert
        out.push(item as VaultEvent);
      }
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export async function clearEvents(): Promise<void> {
  const redis = getRedis();
  await redis.del(EVENTS_KEY);
}

// ---------- Rate limiting ----------

export interface RateLimitState {
  blocked: boolean;
  failures: number;
  retryAfterSec: number;
}

export async function checkRateLimit(ip: string): Promise<RateLimitState> {
  if (!ip || ip === "unknown") {
    return { blocked: false, failures: 0, retryAfterSec: 0 };
  }
  const redis = getRedis();
  const key = RL_PREFIX + ip;
  const raw = await redis.get<number | string>(key);
  const failures = Number(raw) || 0;
  if (failures >= RL_MAX_FAILS) {
    const ttl = await redis.ttl(key);
    return {
      blocked: true,
      failures,
      retryAfterSec: ttl > 0 ? ttl : RL_WINDOW_SEC,
    };
  }
  return { blocked: false, failures, retryAfterSec: 0 };
}

export async function recordFailure(ip: string): Promise<number> {
  if (!ip || ip === "unknown") return 0;
  const redis = getRedis();
  const key = RL_PREFIX + ip;
  const v = await redis.incr(key);
  // Sett TTL kun første gang for å unngå å skyve vinduet
  if (v === 1) {
    await redis.expire(key, RL_WINDOW_SEC);
  }
  return v;
}

export async function resetFailures(ip: string): Promise<void> {
  if (!ip || ip === "unknown") return;
  const redis = getRedis();
  await redis.del(RL_PREFIX + ip);
}
