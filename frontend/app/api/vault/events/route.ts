import { NextResponse } from "next/server";
import { readRequestMeta } from "@/lib/server/request-meta";
import {
  clearEvents,
  listEvents,
  logEvent,
  recordFailure,
  resetFailures,
  type EventKind,
} from "@/lib/server/events-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_REPORTABLE: Record<string, EventKind> = {
  "unlock-success": "unlock-success",
  "unlock-fail": "unlock-fail",
  "unlock-biometric": "unlock-biometric",
  "master-changed": "master-changed",
};

/** GET — hent siste N events */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || 100;
    const events = await listEvents(limit);
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke hente hendelser", detail: msg },
      { status: 500 },
    );
  }
}

/** POST — klienten rapporterer {kind: "unlock-success" | "unlock-fail" | ...} */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawKind = typeof body?.kind === "string" ? body.kind : "";
    const kind = CLIENT_REPORTABLE[rawKind];
    if (!kind) {
      return NextResponse.json(
        { error: "Ugyldig event-type" },
        { status: 400 },
      );
    }

    const meta = await readRequestMeta();
    const ev = await logEvent(kind, meta);

    // Oppdater rate-limit-teller
    if (kind === "unlock-fail") {
      const failures = await recordFailure(meta.ip);
      return NextResponse.json({ ok: true, event: ev, failures });
    }
    if (kind === "unlock-success" || kind === "unlock-biometric") {
      await resetFailures(meta.ip);
    }
    return NextResponse.json({ ok: true, event: ev });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke lagre event", detail: msg },
      { status: 500 },
    );
  }
}

/** DELETE — tøm hele event-loggen */
export async function DELETE() {
  try {
    await clearEvents();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json(
      { error: "Kunne ikke slette hendelser", detail: msg },
      { status: 500 },
    );
  }
}
