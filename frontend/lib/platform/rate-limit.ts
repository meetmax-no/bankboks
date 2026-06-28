/**
 * Ko | Do · Vault — v4.3 Iter 6 — Sentral rate-limiter
 *
 * Per-IP teller med Upstash INCR + EXPIRE (atomisk via pipeline). Brukes
 * for å beskytte public registreringsendepunkter mot bot-spam.
 *
 * KONFIG (per Mike 2026-06-02):
 *   POST /api/register             → 2 per IP / 24t (deler teller med /paid)
 *   POST /api/register/paid        → 2 per IP / 24t (deler teller med /register)
 *   GET  /api/register/subdomain-check    → 60 per IP / 60s
 *   POST /api/register/verify-turnstile   → 30 per IP / 60s
 *
 * Delt teller mellom /register og /register/paid hindrer at en bot kan
 * registrere 2 trial + 2 paid = 4 kontoer fra samme IP. Bruker samme
 * `bucket: "register"` i kallet fra begge endepunkter.
 *
 * Sentral Upstash (D-039) er sannhetskilde — fungerer på tvers av Vercel
 * serverless-instanser. In-memory ville feilet ved cold-start.
 *
 * Returnerer ALDRI exception ved Upstash-feil — vi vil heller la requesten
 * gå gjennom enn å blokkere all trafikk hvis Upstash er nede (fail-open).
 * Feiler kun ved overskredet grense (fail-closed på selve rate-limit-logikken).
 *
 * Node runtime ONLY.
 */
import { getCentralRedis } from "./central-upstash";

export interface RateLimitConfig {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

const KEY_PREFIX = "platform:ratelimit:";

/**
 * Sjekk og inkrementer teller for gitt IP+bucket. Returnerer hvorvidt
 * forespørselen skal slippes gjennom.
 *
 * Implementasjon: INCR + EXPIRE i pipeline. Første kall i et vindu setter
 * key = 1 og TTL = windowSeconds. Påfølgende kall innen vinduet bare INCR-er.
 * Når TTL utløper resettes telleren automatisk.
 */
export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const key = `${KEY_PREFIX}${config.bucket}:${ip}`;

  try {
    const client = getCentralRedis();
    // Pipeline = atomisk fra klientens perspektiv. Upstash REST garanterer
    // at INCR + EXPIRE kjører i rekkefølge mot samme nøkkel.
    const pipeline = client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, config.windowSeconds, "NX"); // sett TTL kun ved første INCR
    pipeline.ttl(key);
    const results = (await pipeline.exec()) as [number, number, number];
    const count = results[0];
    const ttl = results[2];

    const remaining = Math.max(0, config.limit - count);
    const resetSeconds = ttl > 0 ? ttl : config.windowSeconds;
    return {
      allowed: count <= config.limit,
      remaining,
      resetSeconds,
    };
  } catch (err) {
    // Fail-open: hvis Upstash er nede, slipp requesten gjennom og logg.
    // Vi vil heller risikere noen bot-requests enn å DOS-e oss selv.
    console.error("[rate-limit] Upstash error — failing open:", err);
    return {
      allowed: true,
      remaining: config.limit,
      resetSeconds: config.windowSeconds,
    };
  }
}

/**
 * Hent klient-IP fra Next.js Request. Vercel setter `x-forwarded-for` med
 * komma-separert kjede. Vi tar første verdi (faktisk klient-IP, ikke proxy).
 *
 * Fallback til "unknown" hvis header mangler — da rate-limites alle slike
 * requests sammen (forsiktig estimat, ikke perfekt men bedre enn null).
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// ─── Forhåndskonfigurerte buckets ──────────────────────────────────────
// Importer disse direkte fra route-handlers i stedet for å duplisere
// limit/window per endepunkt.

/** /api/register + /api/register/paid — DELER TELLER (samme bucket). */
export const RATE_LIMIT_REGISTER: RateLimitConfig = {
  bucket: "register",
  limit: 2,
  windowSeconds: 24 * 60 * 60,
};

/** /api/register/subdomain-check — 60 per minutt. */
export const RATE_LIMIT_SUBDOMAIN_CHECK: RateLimitConfig = {
  bucket: "subdomain-check",
  limit: 60,
  windowSeconds: 60,
};

/** /api/register/verify-turnstile — 30 per minutt. */
export const RATE_LIMIT_VERIFY_TURNSTILE: RateLimitConfig = {
  bucket: "verify-turnstile",
  limit: 30,
  windowSeconds: 60,
};

/** /api/invite/validate — 60 per IP per minutt (forhindrer token-brute-force). */
export const RATE_LIMIT_INVITE_VALIDATE: RateLimitConfig = {
  bucket: "invite-validate",
  limit: 60,
  windowSeconds: 60,
};

/** /api/invite/accept — 5 per IP per time (ansatten kun trenger ett kall). */
export const RATE_LIMIT_INVITE_ACCEPT: RateLimitConfig = {
  bucket: "invite-accept",
  limit: 5,
  windowSeconds: 60 * 60,
};
