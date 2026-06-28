/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /api/invite/validate (D-056)
 *
 * Public endpoint. GET ?token=<uuid>
 *
 * Verifiserer at token finnes, ikke er brukt og ikke utløpt. Returnerer
 * data ansatten trenger for å fylle ut akseptskjemaet (subdomain er låst,
 * email evt. forhåndsutfylt).
 *
 * Returnerer ALDRI parent-tenant-detaljer utover prefiks (`am`) — som er
 * synlig i selve subdomain-strengen uansett.
 *
 * Rate-limit: 60 per IP per minutt (anti-brute-force på UUID-tokens).
 */
import { NextResponse } from "next/server";
import { getInvite, putInvite } from "@/lib/platform/invite-store";
import { isInviteExpired } from "@/lib/platform/invite-types";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_INVITE_VALIDATE,
} from "@/lib/platform/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_INVITE_VALIDATE);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.resetSeconds) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 },
    );
  }

  try {
    const invite = await getInvite(token);
    if (!invite) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }
    if (invite.status === "used") {
      return NextResponse.json(
        { ok: false, error: "already_used" },
        { status: 410 },
      );
    }
    if (invite.status === "expired" || isInviteExpired(invite)) {
      // Sett status til expired hvis ikke allerede satt (best-effort)
      if (invite.status !== "expired") {
        try {
          await putInvite({ ...invite, status: "expired" });
        } catch {
          /* logg ikke — best-effort */
        }
      }
      return NextResponse.json(
        { ok: false, error: "expired" },
        { status: 410 },
      );
    }
    return NextResponse.json({
      ok: true,
      invite: {
        token: invite.token,
        subdomain: invite.subdomain,
        parentTenant: invite.parentTenant,
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        locale: invite.locale,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[invite/validate]", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}
