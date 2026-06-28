/**
 * Ko | Do · Vault — v4.3 Iter 5 — Stub-endepunkt for Turnstile-verifisering
 *
 * **STUB:** Verifiserer Turnstile-token mot Cloudflare. Brukes av
 * /platform/register-skjemaet for å demoere bot-filter-flyt FØR
 * Iter 7 wires inn ekte registrering.
 *
 * I Iter 7+ flyttes denne logikken inn i `POST /api/register`-route
 * (samme første-steg-validering før tenant-provisjonering starter).
 *
 * Body: { token: string }
 * Response:
 *   { ok: true }
 *   { ok: false, codes: [...] }
 *
 * Public — INGEN admin-middleware. Iter 6 legger på rate-limit.
 */
import { NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/platform/turnstile";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_VERIFY_TURNSTILE,
} from "@/lib/platform/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Iter 6: rate-limit 30 req / IP / 60s
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_VERIFY_TURNSTILE);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, codes: ["rate_limited"] },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_VERIFY_TURNSTILE.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  }

  let token: string | undefined;
  try {
    const body = (await req.json()) as { token?: string };
    token = body.token;
  } catch {
    return NextResponse.json(
      { ok: false, codes: ["invalid-json-body"] },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json(
      { ok: false, codes: ["missing-input-response"] },
      { status: 400 },
    );
  }

  const result = await verifyTurnstileToken(token, ip);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
