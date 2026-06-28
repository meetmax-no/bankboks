/**
 * Ko | Do · Vault — v4.3 Iter 14.5 — /api/cron/cleanup-pending-tenants
 *
 * Vercel Cron-jobb. Rydder pending tenants som ikke fullførte Stripe
 * Checkout innen 30 minutter (`pendingExpiresAt < now`).
 *
 * Bakgrunn: når bruker registrerer en betalt plan via /api/register/paid,
 * opprettes TenantRecord med `status: "pending"` og `pendingExpiresAt =
 * now + 30min`. Hvis bruker avbryter Stripe Checkout (eller bare lukker
 * fanen), står tenanten orphan. Webhook `checkout.session.expired` fyrer
 * etter 24 timer, men:
 *   - hvis Stripe ikke fyrer event-en (rate limits, deres downtime)
 *   - eller hvis Mike ikke har aktivert event-en i Stripe Dashboard
 *   - eller hvis vår webhook-handler er nede mens event-en fyrer
 * → da er denne cron-en backstop som rydder uansett.
 *
 * Vercel cron-konfig (vercel.json) skal kjøre denne hver time.
 *
 * Beskyttet via `CRON_SECRET` (Bearer-header) eller Vercel sin
 * `x-vercel-cron`-header — samme mønster som andre cron-jobber.
 *
 * D-069: Tenants opprettet via admin-test-knapp har `createdBy: "admin"`
 * → `canAutoDelete()` returnerer false → de SKAL ikke auto-ryddes.
 * Mike må slette dem manuelt fra admin-modulen. Dette er bevisst design:
 * test-data skal være synlig så Mike vet hva som ligger der.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { listTenants } from "@/lib/platform/tenant-store";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import { canAutoDelete } from "@/lib/platform/lifecycle-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron") === "1") return true;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }
  return false;
}

interface CleanupSummary {
  scanned: number;
  candidates: number;
  deleted: string[];
  skipped: { subdomain: string; reason: string }[];
  errors: { subdomain: string; error: string }[];
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary: CleanupSummary = {
    scanned: 0,
    candidates: 0,
    deleted: [],
    skipped: [],
    errors: [],
  };

  try {
    const tenants = await listTenants();
    summary.scanned = tenants.length;
    const now = Date.now();

    for (const tenant of tenants) {
      // Bare pending tenants er kandidater
      if (tenant.status !== "pending") continue;
      if (!tenant.pendingExpiresAt) continue;

      const expiresAtMs = Date.parse(tenant.pendingExpiresAt);
      if (isNaN(expiresAtMs) || expiresAtMs > now) continue;

      summary.candidates += 1;

      // D-069: canAutoDelete-sjekk FØR kaskade kalles
      const guard = canAutoDelete(tenant);
      if (!guard.allowed) {
        summary.skipped.push({
          subdomain: tenant.subdomain,
          reason: guard.reason ?? "D-069 blokkert",
        });
        continue;
      }

      // Kjør kaskade-deleten (rydder Stripe + sentral DB; Vercel/Upstash
      // er typisk "skipped" for pending fordi de aldri ble provisjonert)
      try {
        const result = await deleteTenant(tenant.subdomain, "cron");
        if (result.success) {
          summary.deleted.push(tenant.subdomain);
        } else {
          summary.errors.push({
            subdomain: tenant.subdomain,
            error: result.errors.join("; "),
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        summary.errors.push({ subdomain: tenant.subdomain, error: msg });
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[cron/cleanup-pending-tenants]", err);
    return NextResponse.json(
      { ok: false, error: msg, ...summary },
      { status: 500 },
    );
  }
}
