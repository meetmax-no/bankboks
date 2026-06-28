/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — am-admin login-events
 *
 * Logger hver vellykkede am-admin-innlogging i Upstash for visning i
 * Konsoll → Innstillinger → Sikkerhet. 90-dagers historikk per admin,
 * begrenset til siste 50 events for å unngå ubegrenset vekst.
 *
 * Datastruktur: Upstash sorted-set keyed by adminId, score = timestamp,
 * member = JSON-serialisert event. ZADD ved login, ZRANGEBYSCORE ved fetch
 * (med 90-dagers cutoff), ZREMRANGEBYSCORE periodisk for å fjerne gammelt.
 *
 * Vi krypterer IKKE event-payloaden — den inneholder kun IP (allerede synlig
 * i nettverks-laget), user-agent (offentlig) og timestamp. Ingen passord eller
 * sensitive felter. Krypteringsoverhead ikke verdt det for security-audit-data
 * som ofte skal leses.
 *
 * Node runtime ONLY.
 */
import { getCentralRedis } from "./central-upstash";

const LOGIN_EVENTS_KEY_PREFIX = "org-admin-login-events:";
const MAX_EVENTS_PER_ADMIN = 50;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export type OrgAdminLoginEvent = {
  /** Unix-ms-timestamp. Også brukt som score i sorted-set. */
  ts: number;
  /** Klient-IP fra X-Forwarded-For, eller "unknown". */
  ip: string;
  /** User-agent (truncated til 200 tegn). */
  ua: string;
  /** Host som brukeren logget inn på (mm-admin.kodovault.no). */
  host: string;
};

function key(adminId: string): string {
  return `${LOGIN_EVENTS_KEY_PREFIX}${adminId}`;
}

/**
 * Logg en vellykket innlogging. Best-effort — feiler stille hvis Redis er
 * nede, fordi login ikke skal blokkeres av audit-svikt.
 */
export async function recordLoginEvent(
  adminId: string,
  event: OrgAdminLoginEvent,
): Promise<void> {
  try {
    const redis = getCentralRedis();
    const member = JSON.stringify(event);
    // Upstash zadd: { score: ts, member: jsonString }
    await redis.zadd(key(adminId), { score: event.ts, member });
    // Prune: behold de siste MAX_EVENTS_PER_ADMIN events. ZREMRANGEBYRANK
    // med (0, -MAX-1) fjerner alle utenom de siste MAX.
    await redis.zremrangebyrank(
      key(adminId),
      0,
      -(MAX_EVENTS_PER_ADMIN + 1),
    );
  } catch (err) {
    console.warn(
      "[recordLoginEvent] failed (best-effort):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Hent login-historikk for en admin, sortert nyest først. Default 90 dager,
 * maks MAX_EVENTS_PER_ADMIN events.
 */
export async function listLoginEvents(
  adminId: string,
  days = 90,
): Promise<OrgAdminLoginEvent[]> {
  try {
    const redis = getCentralRedis();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    // ZRANGEBYSCORE med rev=true: nyest først.
    const members = (await redis.zrange(key(adminId), cutoff, "+inf", {
      byScore: true,
      rev: false,
    })) as string[];
    const events: OrgAdminLoginEvent[] = [];
    for (const raw of members) {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.ts === "number"
        ) {
          events.push(parsed as OrgAdminLoginEvent);
        }
      } catch {
        // Ignorer korrupt event — kanskje gammel format.
      }
    }
    // Sorter nyest først (defensiv — Upstash returnerer i score-ASC orden).
    events.sort((a, b) => b.ts - a.ts);
    return events;
  } catch (err) {
    console.warn(
      "[listLoginEvents] failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Slett alle login-events for en admin. Brukes ved sletting av admin-konto
 * (GDPR — purge ved konto-sletting).
 */
export async function deleteLoginEvents(adminId: string): Promise<void> {
  try {
    const redis = getCentralRedis();
    await redis.del(key(adminId));
  } catch (err) {
    console.warn(
      "[deleteLoginEvents] failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export const _LOGIN_EVENTS_INTERNAL = {
  NINETY_DAYS_MS,
  MAX_EVENTS_PER_ADMIN,
  key,
};
