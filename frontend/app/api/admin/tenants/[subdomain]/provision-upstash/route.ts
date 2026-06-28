/**
 * Ko | Do · Vault — v4.3 Iter 9 (D-064) — Manuell Upstash-retry (D-055)
 *
 * POST /api/admin/tenants/[subdomain]/provision-upstash
 *
 * Per D-064 (2026-06-03): Upstash provisjoneres FØRST i hele flyten.
 * Denne retry-knappen kjører uavhengig av Vercel-status — opprett DB-en
 * og lagre databaseId på tenant. Vercel-prosjektet opprettes så via
 * "Provisjoner Vercel"-knappen (eller automatisk i registreringsflyten).
 *
 * Idempotensesjekk: 409 hvis upstashDatabaseId allerede satt.
 *
 * Beskyttet av middleware (admin-session-cookie).
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import { provisionTenantOnUpstash } from "@/lib/platform/upstash-provision";
import { notifyProvisioningFailure } from "@/lib/platform/notify";
import { provisioningLogger, logEvent } from "@/lib/platform/provisioning-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { subdomain: raw } = await params;
  const subdomain = (raw ?? "").toLowerCase().trim();
  try {
    if (!subdomain) {
      return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
    }

    const tenant = await getTenant(subdomain);
    if (!tenant) {
      return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
    }

    if (tenant.upstashDatabaseId) {
      return NextResponse.json(
        {
          error: "already_provisioned",
          databaseId: tenant.upstashDatabaseId,
        },
        { status: 409 },
      );
    }

    // ─── D-088 (2026-06-27, Mike) — arkitekturfeil-rydd ───────────────
    // B2B am-admin (`<prefix>-admin`) bruker SENTRAL Upstash for OrgAdmin-
    // records + login-events + sessions — IKKE en egen tenant-database.
    // Short-circuit: marker som "skipped" så TenantViewer kan fortsette
    // til neste steg (provision-vercel som også skipper).
    if (
      tenant.customerType === "b2b" &&
      tenant.parentTenant === null &&
      subdomain.endsWith("-admin")
    ) {
      await logEvent(
        tenant.subdomain,
        "upstash_create",
        "skipped",
        "D-088: B2B am-admin bruker sentral Upstash — ingen egen DB",
      );
      const updated = {
        ...tenant,
        upstashDatabaseId: "skipped:b2b-parent",
        status: tenant.status === "provisioning_failed" ? "trial" : tenant.status,
      };
      await putTenant(updated);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "b2b_parent_uses_central_upstash",
        databaseId: "skipped:b2b-parent",
      });
    }

    try {
      // Logg kun som retry hvis det faktisk er retry (tenant var i failed-state)
      if (tenant.status === "provisioning_failed") {
        await logEvent(
          tenant.subdomain,
          "upstash_create",
          "retried",
          "admin retry via D-055-knapp",
        );
      }
      const onEvent = provisioningLogger(tenant.subdomain);
      const upstash = await provisionTenantOnUpstash({
        subdomain: tenant.subdomain,
        onEvent,
      });
      // Suksess: hvis Vercel også er klar, kan tenant gå til "trial"/"active".
      // Hvis ikke, behold provisioning_failed til Vercel-knappen kjøres.
      const nextStatus =
        tenant.status === "provisioning_failed" && tenant.vercelProjectId
          ? "trial"
          : tenant.status;
      // Hent på nytt — onEvent har skrevet til provisioningLog mellomtiden.
      const fresh = (await getTenant(tenant.subdomain)) ?? tenant;
      await putTenant({
        ...fresh,
        upstashDatabaseId: upstash.databaseId,
        status: nextStatus,
      });
      return NextResponse.json({
        ok: true,
        databaseId: upstash.databaseId,
        databaseName: upstash.databaseName,
      });
    } catch (provisionErr) {
      console.error("[admin/provision-upstash 502]", provisionErr);
      await notifyProvisioningFailure({
        subdomain: tenant.subdomain,
        stage: "upstash",
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
        provisionErr instanceof Error ? provisionErr.message : "unknown_error";
      return NextResponse.json(
        { ok: false, error: "upstash_provision_failed", detail: msg },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[admin/provision-upstash 500]", err);
    const msg = err instanceof Error ? err.message : "unknown_error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json(
      { error: msg, stack: stack?.split("\n").slice(0, 5) },
      { status: 500 },
    );
  }
}
