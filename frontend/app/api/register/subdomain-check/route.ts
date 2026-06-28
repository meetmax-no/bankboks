/**
 * Ko | Do · Vault — v4.3 Iter 4 — /api/register/subdomain-check
 *
 * **PUBLIC** endpoint — INGEN admin-middleware-beskyttelse. Brukes av
 * `/register`-skjemaet (Iter 7+) for debounced sanntids-validering mens
 * bruker taster subdomene.
 *
 * Gjenbruker `isSubdomainAvailable()` fra `lib/platform/subdomain.ts` —
 * samme sannhetskilde som admin-versjonen (`/api/admin/subdomain-check`)
 * og POST `/api/admin/tenants`. Server-side validering på POST /api/register
 * (Iter 7) vil også kalle samme funksjon, slik at "ledig på sjekk-tidspunkt"
 * og "fortsatt ledig ved registrering" er garantert konsistent.
 *
 * Response-shape:
 *   { available: true }
 *   { available: false, reason: "invalid_format" | "reserved" | "taken" }
 *
 * GET ?subdomain=<s>. Tom subdomain → 400 invalid_format.
 *
 * Per D-037: registrering er public, ingen e-postverifisering. Per D-039:
 * `tenantExists()`-kallet inni `isSubdomainAvailable()` slår opp i sentral
 * Upstash (kryptert blob). Endepunktet eksponerer KUN ja/nei — aldri
 * data om eksisterende tenants.
 *
 * **TODO Iter 7+:** legg på rate-limiter (10 calls/min per IP) for å
 * unngå at noen scraper hele subdomain-treet ved å spørre `?subdomain=a`,
 * `?subdomain=b`, osv. Per nå er endepunktet stub-status (Iter 4 leverer
 * kun selve sjekken — debounce er klient-side, rate-limit blir Iter 7).
 */
import { NextResponse } from "next/server";
import { isSubdomainAvailable } from "@/lib/platform/subdomain";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_SUBDOMAIN_CHECK,
} from "@/lib/platform/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Iter 6: rate-limit 60 req / IP / 60s
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_SUBDOMAIN_CHECK);
  if (!rl.allowed) {
    return NextResponse.json(
      { available: false, reason: "rate_limited" },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.resetSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_SUBDOMAIN_CHECK.limit),
          "X-RateLimit-Remaining": String(rl.remaining),
        },
      },
    );
  }

  const { searchParams } = new URL(req.url);
  const subdomain = searchParams.get("subdomain");

  if (!subdomain || typeof subdomain !== "string") {
    return NextResponse.json(
      { available: false, reason: "invalid_format" },
      { status: 400 },
    );
  }

  try {
    const result = await isSubdomainAvailable(subdomain);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[register/subdomain-check]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
