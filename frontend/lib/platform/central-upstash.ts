/**
 * Ko | Do · Vault — Sentral Upstash-klient (delt singleton).
 *
 * Brukes av:
 *   - tenant-store.ts (TenantRecord CRUD)
 *   - rate-limit.ts (per-IP teller)
 *
 * Krever env-vars `CENTRAL_KV_REST_API_URL` + `_TOKEN` per D-039.
 * (Aliaser `CENTRAL_UPSTASH_URL/TOKEN` støttes for bakoverkompabilitet
 * med tidligere docs.)
 */
import { Redis } from "@upstash/redis";

let _client: Redis | null = null;

/**
 * Test-only seam: lar tester injisere en mock-Redis-klient. Brukes av
 * `lib/__tests__/*-store.test.ts` for å kjøre offline uten Upstash-creds.
 * MÅ aldri kalles fra produksjonskode. Pass `null` for å resette.
 */
export function setCentralRedisForTests(client: unknown): void {
  _client = client as Redis | null;
}

export function getCentralRedis(): Redis {
  if (_client) return _client;
  const url =
    process.env.CENTRAL_KV_REST_API_URL ??
    process.env.CENTRAL_UPSTASH_URL ??
    // Iter 20.9 (Mike 2026-06-27): Vercel KV-integrasjonen lagrer creds
    // automatisk med disse navnene. Støttes som 3. fallback så vi slipper
    // duplisert konfigurering.
    process.env.KV_REST_API_URL ??
    "";
  const token =
    process.env.CENTRAL_KV_REST_API_TOKEN ??
    process.env.CENTRAL_UPSTASH_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    "";
  if (!url || !token) {
    throw new Error(
      "Sentral Upstash mangler config: sett CENTRAL_KV_REST_API_URL + CENTRAL_KV_REST_API_TOKEN (eller KV_REST_API_URL/TOKEN fra Vercel KV-integrasjon) i Vercel env-vars.",
    );
  }
  _client = new Redis({ url, token });
  return _client;
}
