/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Bulk client-config tools (D-060)
 *
 * Permanent admin-verktøy. Tre modi:
 *   - skip-existing  : kun migrer tenants UTEN egen config (recovery/initial)
 *   - merge          : deep merge default → tenant, tenant-wins (legg til nye felter)
 *   - overwrite-all  : full reset til default for ALLE (destructive)
 *
 * GET ?mode=...  → dry-run, returnerer "would_*"-actions per tenant
 * POST ?mode=... → utfør. Hver mutasjon appender notis til tenant.notes
 *                  for audit-trail.
 *
 * Beskyttet av middleware.
 */
import { NextResponse } from "next/server";
import { listTenants, putTenant } from "@/lib/platform/tenant-store";
import {
  getClientConfig,
  putClientConfig,
} from "@/lib/platform/client-config-store";
import {
  buildTenantConfig,
  mergeTenantWithDefault,
  readDefaultTemplate,
  type ClientConfigJson,
} from "@/lib/platform/tenant-config-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "skip-existing" | "merge" | "overwrite-all";

interface MigrationRow {
  subdomain: string;
  action:
    | "skipped"
    | "would_migrate"
    | "would_merge"
    | "would_overwrite"
    | "migrated"
    | "merged"
    | "overwritten"
    | "error";
  reason?: string;
}

interface MigrationSummary {
  dryRun: boolean;
  mode: Mode;
  total: number;
  migrated: number;
  merged: number;
  overwritten: number;
  skipped: number;
  errors: number;
  rows: MigrationRow[];
}

function parseMode(req: Request): Mode {
  const { searchParams } = new URL(req.url);
  const m = searchParams.get("mode");
  if (m === "merge" || m === "overwrite-all") return m;
  return "skip-existing";
}

function parseOnlyParents(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  return searchParams.get("onlyParents") === "true";
}

async function appendAuditNote(
  subdomain: string,
  text: string,
): Promise<void> {
  const tenants = await listTenants();
  const tenant = tenants.find((t) => t.subdomain === subdomain);
  if (!tenant) return;
  const ts = new Date().toISOString();
  const note = `[${ts}] System: ${text}`;
  await putTenant({
    ...tenant,
    notes: tenant.notes ? `${tenant.notes}\n${note}` : note,
  });
}

async function runMigration(
  dryRun: boolean,
  mode: Mode,
  onlyParents: boolean = false,
): Promise<MigrationSummary> {
  const tenants = await listTenants();
  // D-126 (2026-02 · Mike): B2B parents (SA) har `vercelProjectId =
  // "skipped:b2b-parent"` (D-088) eller `null` for legacy-tenants opprettet
  // før D-088. De skal LIKEVEL ha en `client-config:<prefix>-admin` i
  // Upstash siden den brukes som mal av alle ansatte under SA.
  // Filteret inkluderer derfor alle B2B parents uavhengig av Vercel-status.
  const isB2BParent = (t: (typeof tenants)[number]) =>
    t.customerType === "b2b" && t.parentTenant === null;
  const baseCandidates = tenants.filter(
    (t) => t.vercelProjectId !== null || isB2BParent(t),
  );
  const candidates = onlyParents
    ? baseCandidates.filter(isB2BParent)
    : baseCandidates;
  const summary: MigrationSummary = {
    dryRun,
    mode,
    total: candidates.length,
    migrated: 0,
    merged: 0,
    overwritten: 0,
    skipped: 0,
    errors: 0,
    rows: [],
  };

  let template: ClientConfigJson | null = null;
  if (candidates.length > 0) {
    try {
      template = await readDefaultTemplate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      return {
        ...summary,
        errors: candidates.length,
        rows: candidates.map((t) => ({
          subdomain: t.subdomain,
          action: "error",
          reason: `Kan ikke lese default-template: ${msg}`,
        })),
      };
    }
  }

  for (const t of candidates) {
    try {
      const existing = await getClientConfig(t.subdomain);

      // ── Mode: skip-existing ─────────────────────────────────────────
      if (mode === "skip-existing") {
        if (existing) {
          summary.skipped++;
          summary.rows.push({
            subdomain: t.subdomain,
            action: "skipped",
            reason: "client-config eksisterer allerede",
          });
          continue;
        }
        if (dryRun) {
          summary.rows.push({
            subdomain: t.subdomain,
            action: "would_migrate",
          });
          continue;
        }
        const config = buildTenantConfig(template!, t.subdomain);
        await putClientConfig(t.subdomain, config);
        await appendAuditNote(
          t.subdomain,
          "client-config initialisert fra default (bulk-migrering)",
        );
        summary.migrated++;
        summary.rows.push({ subdomain: t.subdomain, action: "migrated" });
        continue;
      }

      // ── Mode: merge (tenant-wins) ───────────────────────────────────
      if (mode === "merge") {
        if (!existing) {
          // Ingen eksisterende → samme som migrer
          if (dryRun) {
            summary.rows.push({
              subdomain: t.subdomain,
              action: "would_migrate",
            });
            continue;
          }
          const config = buildTenantConfig(template!, t.subdomain);
          await putClientConfig(t.subdomain, config);
          await appendAuditNote(
            t.subdomain,
            "client-config initialisert fra default (bulk-merge: ingen eksisterende)",
          );
          summary.migrated++;
          summary.rows.push({ subdomain: t.subdomain, action: "migrated" });
          continue;
        }
        if (dryRun) {
          summary.rows.push({
            subdomain: t.subdomain,
            action: "would_merge",
          });
          continue;
        }
        const merged = mergeTenantWithDefault(existing, template!);
        await putClientConfig(t.subdomain, merged);
        await appendAuditNote(
          t.subdomain,
          "client-config merget med default (tenant-wins)",
        );
        summary.merged++;
        summary.rows.push({ subdomain: t.subdomain, action: "merged" });
        continue;
      }

      // ── Mode: overwrite-all ─────────────────────────────────────────
      if (mode === "overwrite-all") {
        if (dryRun) {
          summary.rows.push({
            subdomain: t.subdomain,
            action: "would_overwrite",
          });
          continue;
        }
        const config = buildTenantConfig(template!, t.subdomain);
        await putClientConfig(t.subdomain, config);
        await appendAuditNote(
          t.subdomain,
          "client-config OVERSKREVET med default (tenant-endringer slettet)",
        );
        summary.overwritten++;
        summary.rows.push({ subdomain: t.subdomain, action: "overwritten" });
        continue;
      }
    } catch (err) {
      summary.errors++;
      const msg = err instanceof Error ? err.message : "unknown";
      summary.rows.push({
        subdomain: t.subdomain,
        action: "error",
        reason: msg,
      });
    }
  }

  return summary;
}

export async function GET(req: Request) {
  try {
    const summary = await runMigration(
      true,
      parseMode(req),
      parseOnlyParents(req),
    );
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/migrate-client-configs GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const summary = await runMigration(
      false,
      parseMode(req),
      parseOnlyParents(req),
    );
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/migrate-client-configs POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
