/**
 * Ko | Do · Vault — v4.3 Iter 7 — POST /api/register (trial-registrering)
 *
 * Public endpoint. Komplett trial-registrering uten provisjonering.
 *
 * Flyt:
 *   1. Rate-limit (bucket "register", delt med /api/register/paid — D-048)
 *   2. Parse + valider input (firstName, lastName valgfri; email + subdomain
 *      påkrevd per D-044)
 *   3. Verifiser Turnstile-token (D-049: bot-filter)
 *   4. Valider subdomain-format + ikke reservert + ikke tatt
 *      (gjenbruker isSubdomainAvailable — samme sannhetskilde som
 *      /api/register/subdomain-check)
 *   5. Bygg TenantRecord { status: "trial", trialEndsAt: now+30d,
 *      stripeCustomerId: undefined per D-049 }
 *   6. Skriv til sentral Upstash (createTenant)
 *   7. Returner { ok: true, subdomain, trialEndsAt }
 *
 * **IKKE inkludert i denne iter (kommer i 8-10):**
 *   - Vercel-prosjekt-provisjonering
 *   - Upstash-instans-opprettelse
 *   - clients/<subdomain>.json-generering (vil bli dynamisk via Vercel-API)
 *
 * Per D-049: Stripe customer opprettes ALDRI her — kun ved konvertering
 * via /api/billing/create-checkout (Iter 12.5).
 *
 * Per D-044: firstName/lastName er valgfri. email + subdomain påkrevd.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { isSubdomainAvailable } from "@/lib/platform/subdomain";
import { createTenant, getTenant, putTenant } from "@/lib/platform/tenant-store";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_REGISTER,
} from "@/lib/platform/rate-limit";
import { verifyTurnstileToken } from "@/lib/platform/turnstile";
import { provisionTenantOnVercel } from "@/lib/platform/vercel-provision";
import { provisionTenantOnUpstash } from "@/lib/platform/upstash-provision";
import { notifyProvisioningFailure } from "@/lib/platform/notify";
import { provisioningLogger } from "@/lib/platform/provisioning-log";
import type { CreateTenantInput } from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterRequestBody {
  subdomain?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  lifecycleEmails?: boolean;
  locale?: "no" | "sv" | "da" | "en";
  turnstileToken?: string;
}

interface RegisterErrorResponse {
  ok: false;
  error:
    | "rate_limited"
    | "invalid_json"
    | "missing_email"
    | "invalid_email"
    | "missing_subdomain"
    | "invalid_subdomain"
    | "reserved_subdomain"
    | "subdomain_taken"
    | "missing_locale"
    | "invalid_locale"
    | "missing_turnstile"
    | "turnstile_failed"
    | "internal_error";
  detail?: string;
}

interface RegisterSuccessResponse {
  ok: true;
  subdomain: string;
  trialEndsAt: string;
}

export async function POST(req: Request) {
  // ─── 1. Rate-limit ─────────────────────────────────────────────
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_REGISTER);
  if (!rl.allowed) {
    return errorResponse(
      "rate_limited",
      `Maks ${RATE_LIMIT_REGISTER.limit} registreringer per IP per 24 timer.`,
      429,
      {
        "Retry-After": String(rl.resetSeconds),
        "X-RateLimit-Limit": String(RATE_LIMIT_REGISTER.limit),
        "X-RateLimit-Remaining": String(rl.remaining),
      },
    );
  }

  // ─── 2. Parse + valider input ─────────────────────────────────────
  let body: RegisterRequestBody;
  try {
    body = (await req.json()) as RegisterRequestBody;
  } catch {
    return errorResponse("invalid_json", undefined, 400);
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email) return errorResponse("missing_email", undefined, 400);
  if (!EMAIL_RX.test(email)) {
    return errorResponse("invalid_email", undefined, 400);
  }

  const subdomain = body.subdomain?.trim().toLowerCase() ?? "";
  if (!subdomain) return errorResponse("missing_subdomain", undefined, 400);

  // Iter 19.9 Fase 2: Obligatorisk locale-valg. Aksepterer kun de 4 språkene
  // som har full mal-pakke (NO/SV/DA/EN). Backend fallback til "no" var
  // bevisst fjernet — vi gjetter ikke språk lenger.
  if (body.locale === undefined || body.locale === null) {
    return errorResponse("missing_locale", undefined, 400);
  }
  if (
    body.locale !== "no" &&
    body.locale !== "sv" &&
    body.locale !== "da" &&
    body.locale !== "en"
  ) {
    return errorResponse(
      "invalid_locale",
      `locale='${body.locale}' støttes ikke (kun no/sv/da/en)`,
      400,
    );
  }

  // ─── 3. Verifiser Turnstile ──────────────────────────────────────
  // I produksjon (med TURNSTILE_SECRET_KEY satt) krever vi alltid token.
  // Lokalt uten secret er turnstile-modulen fail-closed ("missing-secret-key")
  // — så vi kan ikke teste registrering lokalt uten config. Det er greit:
  // ekte registrering må testes på Vercel.
  if (process.env.TURNSTILE_SECRET_KEY) {
    if (!body.turnstileToken) {
      return errorResponse("missing_turnstile", undefined, 400);
    }
    const ts = await verifyTurnstileToken(body.turnstileToken, ip);
    if (!ts.ok) {
      return errorResponse(
        "turnstile_failed",
        (ts.codes ?? []).join(", ") || undefined,
        400,
      );
    }
  }

  // ─── 4. Valider subdomain (format + reservert + tatt) ──────────────
  let availability;
  try {
    availability = await isSubdomainAvailable(subdomain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[register] isSubdomainAvailable failed:", err);
    return errorResponse("internal_error", msg, 500);
  }
  if (!availability.available) {
    if (availability.reason === "invalid_format") {
      return errorResponse("invalid_subdomain", undefined, 400);
    }
    if (availability.reason === "reserved") {
      return errorResponse("reserved_subdomain", undefined, 400);
    }
    if (availability.reason === "taken") {
      return errorResponse("subdomain_taken", undefined, 409);
    }
  }

  // ─── 5-6. Bygg + skriv TenantRecord ────────────────────────────────
  const input: CreateTenantInput = {
    subdomain,
    email,
    customerType: "b2c",
    firstName: body.firstName?.trim() || undefined,
    lastName: body.lastName?.trim() || undefined,
    plan: "trial",
    status: "trial",
    lifecycleEmails: body.lifecycleEmails ?? true,
    locale: body.locale,
  };

  try {
    const record = await createTenant(input, "self");

    // D-064: Upstash FØRST, deretter Vercel med ekte KV-creds.
    // D-065: hver provisjonerings-hendelse logges i sanntid til provisioningLog.
    const onEvent = provisioningLogger(record.subdomain);
    let finalStatus = record.status;
    let projectId: string | null = null;
    let upstashDatabaseId: string | null = null;
    try {
      const upstash = await provisionTenantOnUpstash({
        subdomain: record.subdomain,
        onEvent,
      });
      upstashDatabaseId = upstash.databaseId;
      // Ny tenant — refresh fra store etter logger-skriving, så vi ikke
      // overskriver provisioningLog som onEvent allerede har skrevet.
      const t1 = await getTenant(record.subdomain);
      if (t1) {
        await putTenant({ ...t1, upstashDatabaseId: upstash.databaseId });
      }

      try {
        const vercel = await provisionTenantOnVercel({
          subdomain: record.subdomain,
          kvRestApiUrl: upstash.restUrl,
          kvRestApiToken: upstash.restToken,
          onEvent,
        });
        projectId = vercel.projectId;
        const t2 = await getTenant(record.subdomain);
        if (t2) {
          await putTenant({
            ...t2,
            vercelProjectId: vercel.projectId,
            configGenerated: true,
          });
        }
      } catch (vercelErr) {
        const errMsg = vercelErr instanceof Error ? vercelErr.message : "";
        const isConfigStage =
          errMsg.includes("default-template") ||
          errMsg.includes("default.json") ||
          errMsg.includes("over 60KB");
        await notifyProvisioningFailure({
          subdomain: record.subdomain,
          stage: isConfigStage ? "github" : "vercel",
          error: vercelErr,
          tenantEmail: email,
        });
        finalStatus = "provisioning_failed";
        const t3 = await getTenant(record.subdomain);
        if (t3) {
          try {
            await putTenant({ ...t3, status: finalStatus });
          } catch (e) {
            console.error("[register] could not mark provisioning_failed:", e);
          }
        }
      }
    } catch (upstashErr) {
      await notifyProvisioningFailure({
        subdomain: record.subdomain,
        stage: "upstash",
        error: upstashErr,
        tenantEmail: email,
      });
      finalStatus = "provisioning_failed";
      const t4 = await getTenant(record.subdomain);
      if (t4) {
        try {
          await putTenant({ ...t4, status: finalStatus });
        } catch (e) {
          console.error("[register] could not mark provisioning_failed:", e);
        }
      }
    }

    // TODO(Iter 10): send velkomstmail via Resend

    const response: RegisterSuccessResponse = {
      ok: true,
      subdomain: record.subdomain,
      trialEndsAt: record.trialEndsAt,
    };
    void projectId; // reservert for fremtidig respons-utvidelse
    void upstashDatabaseId;
    void finalStatus;
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[register] createTenant failed:", err);
    // createTenant kaster ved konflikt (race condition mellom
    // subdomain-check og createTenant — usannsynlig men mulig).
    if (msg.includes("finnes allerede") || msg.includes("already exists")) {
      return errorResponse("subdomain_taken", msg, 409);
    }
    return errorResponse("internal_error", msg, 500);
  }
}

function errorResponse(
  error: RegisterErrorResponse["error"],
  detail: string | undefined,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  const body: RegisterErrorResponse = { ok: false, error };
  if (detail) body.detail = detail;
  return NextResponse.json(body, { status, headers });
}
