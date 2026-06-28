/**
 * Ko | Do · Vault — v4.3 Iter 6.x — Admin rate-limit reset
 *
 * DELETE /api/admin/rate-limit
 *   ?bucket=<register|subdomain-check|verify-turnstile|invite-validate|invite-accept>
 *   &ip=<IP>     (valgfri — default = caller's IP)
 *   &all=true    (valgfri — sletter ALLE IPer for bucket)
 *
 * Bruksområde: Mike treffer 2/24t-grensen på `register` mens han tester
 * provisjonering. I stedet for å vente eller bytte IP nullstilles
 * telleren via admin-konsollen.
 *
 * Beskyttet av middleware (admin-session-cookie kreves).
 */
import { NextResponse } from "next/server";
import { getCentralRedis } from "@/lib/platform/central-upstash";
import { getClientIp } from "@/lib/platform/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_PREFIX = "platform:ratelimit:";
const VALID_BUCKETS = new Set([
  "register",
  "subdomain-check",
  "verify-turnstile",
  "invite-validate",
  "invite-accept",
]);

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket");
  const ip = searchParams.get("ip") ?? getClientIp(req);
  const all = searchParams.get("all") === "true";

  if (!bucket || !VALID_BUCKETS.has(bucket)) {
    return NextResponse.json(
      {
        error: "invalid_bucket",
        detail: `Valid buckets: ${Array.from(VALID_BUCKETS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const client = getCentralRedis();
    if (all) {
      // SCAN + DEL alle IPer for denne bucketen
      const pattern = `${KEY_PREFIX}${bucket}:*`;
      const collected: string[] = [];
      let cursor = "0";
      do {
        const result = (await client.scan(cursor, {
          match: pattern,
          count: 100,
        })) as [string, string[]];
        cursor = result[0];
        collected.push(...result[1]);
      } while (cursor !== "0");

      let deleted = 0;
      for (const k of collected) {
        deleted += await client.del(k);
      }
      return NextResponse.json({
        ok: true,
        bucket,
        scope: "all",
        deleted,
        keys: collected,
      });
    }

    const key = `${KEY_PREFIX}${bucket}:${ip}`;
    const deleted = await client.del(key);
    return NextResponse.json({
      ok: true,
      bucket,
      ip,
      deleted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/rate-limit DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET — viser current counter for diagnostikk */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bucket = searchParams.get("bucket");
  const ip = searchParams.get("ip") ?? getClientIp(req);

  if (!bucket || !VALID_BUCKETS.has(bucket)) {
    return NextResponse.json(
      { error: "invalid_bucket" },
      { status: 400 },
    );
  }

  try {
    const client = getCentralRedis();
    const key = `${KEY_PREFIX}${bucket}:${ip}`;
    const count = await client.get<number>(key);
    const ttl = await client.ttl(key);
    return NextResponse.json({
      bucket,
      ip,
      count: count ?? 0,
      ttlSeconds: ttl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/rate-limit GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
