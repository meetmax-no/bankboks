import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { readRequestMeta } from "@/lib/server/request-meta";
import {
  checkRateLimit,
  logEvent,
  RL_MAX_FAILS,
} from "@/lib/server/events-store";
import { checkWriteBlock } from "@/lib/server/tenant-status-cache";
import { checkHostMatchesPod } from "@/lib/server/vault-host-guard";
import { bumpActivityViaRpc } from "@/lib/server/activity-rpc";

// Zero-knowledge: server ser KUN den krypterte blobben (salt + iv + cipher).
// Master-passordet er aldri sendt hit og kan ikke dekryptere uten klient-side
// PBKDF2 + AES-GCM med brukerens passord.
//
// Single-user mode: én fast Redis-key (`vault:default`). Upstash-credentials
// hentes automatisk fra env-vars (KV_REST_API_URL + KV_REST_API_TOKEN) som
// Vercel Marketplace injiserer.
//
// D-099 (2026-06-28): Host-guard via checkHostMatchesPod sjekker at request-
// host matcher denne podens NEXT_PUBLIC_CLIENT_CONFIG. Hindrer Vercel
// wildcard-fallback fra å lekke en pod sin vault til en annen tenant under
// DNS-propagasjons-vinduet. Se lib/server/vault-host-guard.ts for full RCA.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "vault:default";

function getRedis(): Redis {
  return Redis.fromEnv();
}

/**
 * D-149 (2026-02): Failsoft aktivitets-bump via internal RPC. Vault-pods
 * har ikke central-creds per D-071, så all central-write går via
 * `bumpActivityViaRpc` som posterer til admin-pod. Non-blocking.
 *
 * Read-throttling gjøres på admin-siden i `bumpDailyActivity` (opp til
 * 24 bump per dag = én per time gjennomsnittlig).
 */
async function bumpActivity(kind: "unlocks" | "writes" | "reads"): Promise<void> {
  const sub = process.env.NEXT_PUBLIC_CLIENT_CONFIG;
  if (!sub || sub === "default") return; // Ingen tenant-identitet (dev/preview)
  await bumpActivityViaRpc(sub, kind);
}

export async function GET(req: Request) {
  // D-099 sikkerhetsgrense — sjekk FØR Upstash-tilkobling.
  const hostMismatch = checkHostMatchesPod(req);
  if (hostMismatch) return hostMismatch;

  try {
    const meta = await readRequestMeta();

    // Rate-limit sjekk — etter >= RL_MAX_FAILS "unlock-fail" innenfor 15 min
    // blokkerer vi GET så brute-force ikke får tak i blobben.
    const rl = await checkRateLimit(meta.ip);
    if (rl.blocked) {
      return NextResponse.json(
        {
          error: "rate_limited",
          detail: `For mange feil-forsøk. Prøv igjen om ${Math.ceil(rl.retryAfterSec / 60)} min.`,
          retryAfterSec: rl.retryAfterSec,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        },
      );
    }

    const redis = getRedis();
    const blob = await redis.get(KEY);

    // Logg hver hent-forsøk. Fire-and-forget — ikke la logging feile
    // hele GET hvis Upstash-liste er temporarily full.
    logEvent("access", meta).catch(() => {});

    // D-149 (2026-02): fire-and-forget activity-tracking (reads).
    void bumpActivity("reads");

    return NextResponse.json({ blob: blob || null, rlFailures: rl.failures, rlMax: RL_MAX_FAILS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke hente vault fra server", detail: msg },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  // D-099 sikkerhetsgrense — sjekk FØR Upstash-skriving.
  const hostMismatch = checkHostMatchesPod(req);
  if (hostMismatch) return hostMismatch;

  // D-076 write-block: avvis 403 hvis tenant.status === "locked"
  const blocked = await checkWriteBlock(req);
  if (blocked) return blocked;

  try {
    const body = await req.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("salt" in body) ||
      !("iv" in body) ||
      !("cipher" in body)
    ) {
      return NextResponse.json(
        { error: "Ugyldig blob-struktur" },
        { status: 400 },
      );
    }
    const redis = getRedis();
    await redis.set(KEY, body);

    const meta = await readRequestMeta();
    logEvent("modify", meta).catch(() => {});

    // D-149 (2026-02): fire-and-forget activity-tracking (writes).
    void bumpActivity("writes");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke lagre vault", detail: msg },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  // D-099 sikkerhetsgrense — sjekk FØR Upstash-sletting.
  const hostMismatch = checkHostMatchesPod(req);
  if (hostMismatch) return hostMismatch;

  // D-076 write-block: avvis 403 hvis tenant.status === "locked"
  const blocked = await checkWriteBlock(req);
  if (blocked) return blocked;

  try {
    const redis = getRedis();
    await redis.del(KEY);

    const meta = await readRequestMeta();
    logEvent("reset", meta).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke slette vault", detail: msg },
      { status: 500 },
    );
  }
}
