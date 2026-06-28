/**
 * Ko | Do · Vault — v4.3 Iter 8 + Iter 9 (D-064) — Manuell Vercel-retry (D-055)
 *
 * POST /api/admin/tenants/[subdomain]/provision-vercel
 *
 * Forutsetning (D-064 · 2026-06-03): `upstashDatabaseId !== null`. Vercel
 * opprettes ALDRI uten ekte KV-creds — Upstash provisjoneres først (egen
 * retry-knapp), så Vercel henter de eksisterende REST-creds fra Upstash
 * Management API og injecter dem i første deploy.
 *
 * Idempotensesjekk: 409 hvis vercelProjectId allerede satt.
 *
 * Beskyttet av middleware (admin-session-cookie).
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import { provisionTenantOnVercel } from "@/lib/platform/vercel-provision";
import { getDatabaseRestCredentials } from "@/lib/platform/upstash-provision";
import { notifyProvisioningFailure } from "@/lib/platform/notify";
import { provisioningLogger, logEvent } from "@/lib/platform/provisioning-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { subdomain } = await params;
  try {
    const tenant = await getTenant(subdomain);
    if (!tenant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (tenant.vercelProjectId) {
      return NextResponse.json(
        {
          error: "already_provisioned",
          detail: `vercelProjectId allerede satt: ${tenant.vercelProjectId}`,
        },
        { status: 409 },
      );
    }

    // ─── D-088 (2026-06-27, Mike) — arkitekturfeil-rydd ───────────────
    // B2B parent-tenants (`<prefix>-admin`) er IKKE en vault — de er en
    // brukerrolle (am-admin) som kjører via host-prefix-routing på root-
    // admin-poden. De skal IKKE ha eget Vercel-prosjekt eller egen Upstash-
    // database.
    //
    // Tidligere flyt provisionerte feilaktig en separat Vercel-pod for
    // `<prefix>-admin` (bortkastet — am-admin lagrer ingen data i tenant-
    // Upstash; all data er i sentral Upstash). Nå short-circuiter vi: vi
    // markerer tenant som configGenerated=true uten å opprette Vercel-
    // prosjekt, og setter `vercelProjectId` til en sentinel-verdi som
    // klargjør at provisjonering er bevisst hoppet over.
    if (
      tenant.customerType === "b2b" &&
      tenant.parentTenant === null && // = denne ER selve parent-record
      subdomain.endsWith("-admin")
    ) {
      await logEvent(
        subdomain,
        "vercel_create",
        "skipped",
        "D-088: B2B am-admin routes via host-prefix på root-pod — ingen egen Vercel-deploy",
      );
      const updated = {
        ...tenant,
        // Sentinel som signaliserer "bevisst ikke provisionert" — skiller
        // seg fra null (= venter på provisjonering) og en ekte project-ID.
        vercelProjectId: "skipped:b2b-parent",
        configGenerated: true,
        status: tenant.status === "provisioning_failed" ? "trial" : tenant.status,
      };
      await putTenant(updated);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "b2b_parent_uses_host_routing",
        projectId: "skipped:b2b-parent",
        domain: `${subdomain}.kodovault.no`,
        domainVerified: false,
      });
    }

    if (!tenant.upstashDatabaseId) {
      return NextResponse.json(
        {
          error: "upstash_not_provisioned",
          detail:
            "Upstash må provisjoneres først via 'Provisjoner Upstash-instans'-knappen.",
        },
        { status: 409 },
      );
    }

    try {
      if (tenant.status === "provisioning_failed") {
        await logEvent(
          subdomain,
          "vercel_create",
          "retried",
          "admin retry via D-055-knapp",
        );
      }
      // Hent eksisterende Upstash REST-creds — vi lagrer kun databaseId
      // på tenant-recorden (creds er for sensitive til å lagre der).
      const upstashDetails = await getDatabaseRestCredentials(
        tenant.upstashDatabaseId,
      );
      const restUrl = upstashDetails.endpoint.startsWith("http")
        ? upstashDetails.endpoint
        : `https://${upstashDetails.endpoint}`;

      const onEvent = provisioningLogger(subdomain);
      const vercel = await provisionTenantOnVercel({
        subdomain,
        kvRestApiUrl: restUrl,
        kvRestApiToken: upstashDetails.rest_token,
        // Iter 20.9 (D-082): B2B parent-tenants får sentrale envs propagert.
        customerType: tenant.customerType === "b2b" ? "b2b" : "b2c",
        onEvent,
      });
      // Refresh: onEvent har skrevet til provisioningLog.
      const fresh = (await getTenant(subdomain)) ?? tenant;
      const updated = {
        ...fresh,
        vercelProjectId: vercel.projectId,
        configGenerated: true,
        status:
          fresh.status === "provisioning_failed" ? "trial" : fresh.status,
      };
      await putTenant(updated);
      return NextResponse.json({
        ok: true,
        projectId: vercel.projectId,
        domain: vercel.domain,
        domainVerified: vercel.domainVerified,
      });
    } catch (provisionErr) {
      console.error("[admin/provision-vercel 502]", provisionErr);
      const errMsg =
        provisionErr instanceof Error ? provisionErr.message : "";
      const isConfigStage =
        errMsg.includes("default-template") ||
        errMsg.includes("default.json") ||
        errMsg.includes("over 60KB");
      await notifyProvisioningFailure({
        subdomain,
        stage: isConfigStage ? "github" : "vercel",
        error: provisionErr,
        tenantEmail: tenant.contactEmail ?? undefined,
        parentTenant: tenant.parentTenant ?? undefined,
      });
      if (tenant.status !== "provisioning_failed") {
        try {
          await putTenant({ ...tenant, status: "provisioning_failed" });
        } catch {
          /* best-effort */
        }
      }
      const msg =
        provisionErr instanceof Error
          ? provisionErr.message
          : "unknown_provision_error";
      return NextResponse.json(
        { ok: false, error: "provision_failed", detail: msg },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[admin/provision-vercel 500]", err);
    const msg = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
