/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /api/invite/accept (D-056)
 *
 * Public endpoint. POST { token, email, firstName?, lastName?, locale? }
 *
 * Flyt (per spec 2026-06-02):
 *   1. Rate-limit (5 per IP per time)
 *   2. Verifiser token (finnes, ikke brukt, ikke utløpt)
 *   3. Valider subdomain fortsatt ledig
 *   4. Valider parent finnes og activeLicenses < maxLicenses
 *   5. Opprett TenantRecord (B2B, parentTenant, status=active, createdBy=invite)
 *   6. Inkrement parent.activeLicenses
 *   7. Marker InviteRecord som "used"
 *   8. (Iter 8) Vercel-provisjonering — TODO
 *   9. (Iter 9) Upstash-provisjonering — TODO
 *   10. (Iter 10) Velkomstmail — TODO
 *
 * Returnerer { ok: true, subdomain } — klienten redirecter til
 * <subdomain>.kodovault.no.
 */
import { NextResponse } from "next/server";
import { getInvite, putInvite } from "@/lib/platform/invite-store";
import { isInviteExpired } from "@/lib/platform/invite-types";
import {
  createTenant,
  findB2BTenantByPrefix,
  getTenant,
  putTenant,
  tenantExists,
} from "@/lib/platform/tenant-store";
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_INVITE_ACCEPT,
} from "@/lib/platform/rate-limit";
import { provisionTenantOnVercel } from "@/lib/platform/vercel-provision";
import { provisionTenantOnUpstash } from "@/lib/platform/upstash-provision";
import { notifyProvisioningFailure } from "@/lib/platform/notify";
import { provisioningLogger } from "@/lib/platform/provisioning-log";
import { isSubdomainDeployed } from "@/lib/platform/subdomain-reachable";
import type {
  CreateTenantInput,
  TenantRecord,
} from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_LOCALES = new Set(["no", "sv", "da", "en"] as const);

interface AcceptBody {
  token?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  locale?: "no" | "sv" | "da" | "en";
}

export async function POST(req: Request) {
  // 1. Rate-limit
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT_INVITE_ACCEPT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.resetSeconds) } },
    );
  }

  let body: AcceptBody;
  try {
    body = (await req.json()) as AcceptBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
  }
  if (!EMAIL_RX.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  // Iter 19.9 Fase 2: Obligatorisk locale-valg. Aksepterer kun de 4 språkene.
  // Tidligere falt vi tilbake til invite.locale ved manglende request-locale —
  // den gjettlogikken er fjernet. Klienten MÅ alltid sende et eksplisitt valg.
  if (body.locale === undefined || body.locale === null) {
    return NextResponse.json({ ok: false, error: "missing_locale" }, { status: 400 });
  }
  if (!VALID_LOCALES.has(body.locale)) {
    return NextResponse.json({ ok: false, error: "invalid_locale" }, { status: 400 });
  }

  try {
    // 2. Verifiser token
    const invite = await getInvite(token);
    if (!invite) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (invite.status === "used") {
      return NextResponse.json({ ok: false, error: "already_used" }, { status: 410 });
    }
    if (invite.status === "expired" || isInviteExpired(invite)) {
      try {
        await putInvite({ ...invite, status: "expired" });
      } catch {
        /* best-effort */
      }
      return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
    }

    // 3. Subdomain fortsatt ledig?
    if (await tenantExists(invite.subdomain)) {
      return NextResponse.json(
        { ok: false, error: "subdomain_taken" },
        { status: 409 },
      );
    }
    // D-098 (2026-06-28, Mike) — defense-in-depth: aktiv HEAD-sjekk mot
    // <subdomain>.kodovault.no. Fanger orphan Vercel-deploys som lever
    // utenfor sentral DB (typisk fra tidligere tester der tenanten ble
    // slettet sentralt men Vercel-prosjektet ikke ble ryddet). Uten denne
    // sjekken ville accept-flyten lykkes sentralt, men brukeren ble
    // redirected til den orphan-deploy-en — som har sin egen Upstash-
    // backend med tilfeldig gammel data. Mike's selv-test 2026-06-28:
    // `mm-max`-vault viste 21 oppføringer fra en tidligere test fordi
    // den orphan Vercel/Upstash-paret levde igjen.
    if (await isSubdomainDeployed(invite.subdomain)) {
      return NextResponse.json(
        {
          ok: false,
          error: "subdomain_orphan",
          detail:
            "Dette subdomenet peker allerede på en eksisterende vault (sannsynligvis en tidligere deploy som ikke ble ryddet opp). Kontakt support for å rydde opp.",
        },
        { status: 409 },
      );
    }

    // 4. Parent finnes + lisens-tak ikke nådd
    const parent = await findB2BTenantByPrefix(invite.parentTenant);
    if (!parent) {
      return NextResponse.json(
        { ok: false, error: "parent_not_found" },
        { status: 404 },
      );
    }
    if (
      typeof parent.maxLicenses === "number" &&
      typeof parent.activeLicenses === "number" &&
      parent.activeLicenses >= parent.maxLicenses
    ) {
      return NextResponse.json(
        { ok: false, error: "max_licenses_reached" },
        { status: 409 },
      );
    }

    // 5. Opprett B2B child-tenant
    const input: CreateTenantInput = {
      subdomain: invite.subdomain,
      email,
      customerType: "b2b",
      firstName: body.firstName ?? invite.firstName ?? undefined,
      lastName: body.lastName ?? invite.lastName ?? undefined,
      plan: parent.plan,
      status: "active",
      lifecycleEmails: true,
      locale: body.locale,
    };
    const childRecord = await createTenant(input, "invite");
    // Sett parentTenant-feltet på child (createTenant defaulter til null
    // for B2B, men her må vi peke tilbake til parent-prefikset).
    childRecord.parentTenant = invite.parentTenant;
    await putTenant(childRecord);

    // 6. Inkrement parent.activeLicenses
    const updatedParent: TenantRecord = {
      ...parent,
      activeLicenses: (parent.activeLicenses ?? 0) + 1,
    };
    await putTenant(updatedParent);

    // 7. Marker invitasjon som brukt
    await putInvite({
      ...invite,
      status: "used",
      usedAt: new Date().toISOString(),
    });

    // D-065: log invite_accepted på den nye child-tenanten OG parent
    try {
      const { logEvent } = await import("@/lib/platform/provisioning-log");
      await logEvent(
        invite.subdomain,
        "invite_accepted",
        "ok",
        `via token=${invite.token.slice(0, 8)}… parent=${invite.parentTenant}`,
      );
      if (parent) {
        await logEvent(
          parent.subdomain,
          "invite_accepted",
          "ok",
          `child=${invite.subdomain} email=${email}`,
        );
      }
    } catch (e) {
      console.error("[invite/accept] log invite_accepted failed:", e);
    }

    // D-064: Upstash FØRST, deretter Vercel med ekte KV-creds.
    // D-065: provisjonerings-events logges i sanntid.
    const onEvent = provisioningLogger(invite.subdomain);
    let finalRecord = childRecord;
    try {
      const upstash = await provisionTenantOnUpstash({
        subdomain: invite.subdomain,
        onEvent,
      });
      const t1 = await getTenant(invite.subdomain);
      if (t1) {
        finalRecord = { ...t1, upstashDatabaseId: upstash.databaseId };
        await putTenant(finalRecord);
      }

      try {
        const vercel = await provisionTenantOnVercel({
          subdomain: invite.subdomain,
          kvRestApiUrl: upstash.restUrl,
          kvRestApiToken: upstash.restToken,
          onEvent,
        });
        const t2 = await getTenant(invite.subdomain);
        if (t2) {
          finalRecord = {
            ...t2,
            vercelProjectId: vercel.projectId,
            configGenerated: true,
          };
          await putTenant(finalRecord);
        }
      } catch (vercelErr) {
        const errMsg = vercelErr instanceof Error ? vercelErr.message : "";
        const isConfigStage =
          errMsg.includes("default-template") ||
          errMsg.includes("default.json") ||
          errMsg.includes("over 60KB");
        await notifyProvisioningFailure({
          subdomain: invite.subdomain,
          stage: isConfigStage ? "github" : "vercel",
          error: vercelErr,
          tenantEmail: email,
          parentTenant: invite.parentTenant,
        });
        const t3 = await getTenant(invite.subdomain);
        if (t3) {
          finalRecord = { ...t3, status: "provisioning_failed" };
          try {
            await putTenant(finalRecord);
          } catch (e) {
            console.error(
              "[invite/accept] could not mark vercel provisioning_failed:",
              e,
            );
          }
        }
      }
    } catch (upstashErr) {
      await notifyProvisioningFailure({
        subdomain: invite.subdomain,
        stage: "upstash",
        error: upstashErr,
        tenantEmail: email,
        parentTenant: invite.parentTenant,
      });
      const t4 = await getTenant(invite.subdomain);
      if (t4) {
        finalRecord = { ...t4, status: "provisioning_failed" };
        try {
          await putTenant(finalRecord);
        } catch (e) {
          console.error("[invite/accept] could not mark provisioning_failed:", e);
        }
      }
    }

    // TODO(Iter 10): send velkomstmail via Resend

    return NextResponse.json({
      ok: true,
      subdomain: invite.subdomain,
      status: finalRecord.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[invite/accept]", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}
