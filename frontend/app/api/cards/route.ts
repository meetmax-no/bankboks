import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { readRequestMeta } from "@/lib/server/request-meta";
import { logEvent } from "@/lib/server/events-store";
import { checkWriteBlock } from "@/lib/server/tenant-status-cache";
import { checkHostMatchesPod } from "@/lib/server/vault-host-guard";

// Zero-knowledge: server ser KUN den krypterte blobben (salt + iv + cipher).
// Master-passordet er aldri sendt hit. Cards-blob bruker SAMME master-passord
// som hovedvault, men ulik salt — derfor egen Upstash-key.
//
// Single-user mode: én fast Redis-key (`vault:default:cards`).
// Upstash-credentials kommer fra env (KV_REST_API_URL + KV_REST_API_TOKEN).
//
// D-099 (2026-06-28): host-guard via checkHostMatchesPod — se vault/route.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "vault:default:cards";

function getRedis(): Redis {
  return Redis.fromEnv();
}

export async function GET(req: Request) {
  const hostMismatch = checkHostMatchesPod(req);
  if (hostMismatch) return hostMismatch;

  try {
    const redis = getRedis();
    const blob = await redis.get(KEY);

    // Bruk samme event-stream som hovedvault — gir én samlet logg
    const meta = await readRequestMeta();
    logEvent("access", meta).catch(() => {});

    return NextResponse.json({ blob: blob || null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke hente kort fra server", detail: msg },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke lagre kort", detail: msg },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
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
      { error: "Kunne ikke slette kort-blob", detail: msg },
      { status: 500 },
    );
  }
}
