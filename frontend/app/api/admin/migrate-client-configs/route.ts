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

type Mode =
  | "skip-existing"
  | "merge"
  | "overwrite-all"
  | "cascade-from-parent";

interface MigrationRow {
  subdomain: string;
  action:
    | "skipped"
    | "would_migrate"
    | "would_merge"
    | "would_overwrite"
    | "would_cascade"
    | "migrated"
    | "merged"
    | "overwritten"
    | "cascaded"
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
  cascaded: number;
  skipped: number;
  errors: number;
  rows: MigrationRow[];
}

function parseMode(req: Request): Mode {
  const { searchParams } = new URL(req.url);
  const m = searchParams.get("mode");
  if (
    m === "merge" ||
    m === "overwrite-all" ||
    m === "cascade-from-parent"
  )
    return m;
  return "skip-existing";
}

function parseOnlyParents(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  return searchParams.get("onlyParents") === "true";
}

/**
 * D-128 (2026-02 · Mike): scope-velg for skip/merge/overwrite-all.
 * Default: kun B2C. Mike kan slå av/på B2C og SA uavhengig.
 * Ansatte (B2B children) er ALDRI inkludert i disse modusene — de
 * må styres via `cascade-from-parent` for å unngå utilsiktet overskriving.
 */
function parseIncludeB2C(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("includeB2C");
  // Default true hvis fraværende; tom string eller "false" → false
  if (raw === null) return true;
  return raw !== "false" && raw !== "0" && raw !== "";
}

function parseIncludeSA(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  return searchParams.get("includeSA") === "true";
}

/** D-128 (2026-02): valgfri scoping til én SA-organisasjon. */
function parseParentScope(req: Request): string | null {
  const { searchParams } = new URL(req.url);
  const p = searchParams.get("parent");
  if (!p) return null;
  return p.toLowerCase().trim() || null;
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
  scope: {
    includeB2C: boolean;
    includeSA: boolean;
  } = { includeB2C: true, includeSA: false },
  parentScope: string | null = null,
): Promise<MigrationSummary> {
  const tenants = await listTenants();
  // D-126/D-128 (2026-02 · Mike): kategorisering av tenants:
  //  - B2B parent (SA): customerType=b2b, parentTenant=null. Har
  //    vercelProjectId="skipped:b2b-parent" (D-088) eller null for legacy.
  //  - B2C: customerType=b2c, parentTenant=null
  //  - B2B child (ansatt): customerType=b2b, parentTenant !== null
  //
  // For skip/merge/overwrite-all: B2B-ansatte er ALDRI inkludert — Mike vil
  // ikke at de skal kunne treffes utilsiktet. De styres via cascade-modus.
  // B2C og SA er separate toggler.
  const isB2BParent = (t: (typeof tenants)[number]) =>
    t.customerType === "b2b" && t.parentTenant === null;
  const isB2C = (t: (typeof tenants)[number]) =>
    t.customerType === "b2c" && t.parentTenant === null;

  let candidates: typeof tenants;
  if (mode === "cascade-from-parent") {
    // Cascade opererer KUN på B2B children, valgfritt scoped til én SA.
    candidates = tenants.filter((t) => t.parentTenant !== null);
    if (parentScope) {
      candidates = candidates.filter((t) => t.parentTenant === parentScope);
    }
  } else {
    candidates = tenants.filter((t) => {
      // B2C-tenants: må ha vercelProjectId (ekte provisjonering).
      if (isB2C(t)) return scope.includeB2C && t.vercelProjectId !== null;
      // SA-tenants: inkluderes uavhengig av Vercel-status (D-088 sentinel).
      if (isB2BParent(t)) return scope.includeSA;
      // B2B-ansatte: ALDRI i skip/merge/overwrite-all (D-128).
      return false;
    });
  }
  const summary: MigrationSummary = {
    dryRun,
    mode,
    total: candidates.length,
    migrated: 0,
    merged: 0,
    overwritten: 0,
    cascaded: 0,
    skipped: 0,
    errors: 0,
    rows: [],
  };

  let template: ClientConfigJson | null = null;
  // cascade-from-parent leser parent-config i loopen, ikke default-template.
  if (candidates.length > 0 && mode !== "cascade-from-parent") {
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

  // D-128: cache parent-configs for å unngå N+1 reads under cascade.
  // Keyes på parent-prefix → ClientConfigJson | null (null = lookup gjort,
  // ikke funnet). Kun befolket i cascade-mode.
  const parentConfigCache = new Map<string, ClientConfigJson | null>();
  async function getParentConfigCached(
    parentPrefix: string,
  ): Promise<ClientConfigJson | null> {
    if (parentConfigCache.has(parentPrefix)) {
      return parentConfigCache.get(parentPrefix) ?? null;
    }
    // child.parentTenant lagrer PREFIX (D-103e), parent-subdomain er
    // `<prefix>-admin`. Vi leser fra `client-config:<prefix>-admin`.
    const parentSubdomain = `${parentPrefix}-admin`;
    const cfg = await getClientConfig(parentSubdomain);
    parentConfigCache.set(parentPrefix, cfg);
    return cfg;
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

      // ── Mode: cascade-from-parent ───────────────────────────────────
      // D-128 (2026-02 · Mike): re-spill SA-config til alle eksisterende
      // ansatte. Ansatt-recorden har `parentTenant = <prefix>` (D-103e),
      // SA-config ligger i `client-config:<prefix>-admin`. Overskriver
      // ansattens config med ferskt SA-snapshot + child-spesifikt _meta.
      if (mode === "cascade-from-parent") {
        const parentPrefix = t.parentTenant!; // garantert via candidate-filter
        const parentConfig = await getParentConfigCached(parentPrefix);
        if (!parentConfig) {
          summary.skipped++;
          summary.rows.push({
            subdomain: t.subdomain,
            action: "skipped",
            reason: `SA '${parentPrefix}-admin' mangler client-config — kjør 'Skip eksisterende' + 'Kun B2B parent-tenants' først`,
          });
          continue;
        }
        if (dryRun) {
          summary.rows.push({
            subdomain: t.subdomain,
            action: "would_cascade",
            reason: `fra SA '${parentPrefix}-admin'`,
          });
          continue;
        }
        const childConfig = buildTenantConfig(parentConfig, t.subdomain);
        await putClientConfig(t.subdomain, childConfig);
        await appendAuditNote(
          t.subdomain,
          `client-config re-cascaded fra SA '${parentPrefix}-admin' (bulk)`,
        );
        summary.cascaded++;
        summary.rows.push({
          subdomain: t.subdomain,
          action: "cascaded",
          reason: `fra SA '${parentPrefix}-admin'`,
        });
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
    // D-128: bakoverkomp — `onlyParents=true` mappes til includeSA=true, includeB2C=false.
    const onlyParents = parseOnlyParents(req);
    const scope = onlyParents
      ? { includeB2C: false, includeSA: true }
      : { includeB2C: parseIncludeB2C(req), includeSA: parseIncludeSA(req) };
    const summary = await runMigration(
      true,
      parseMode(req),
      scope,
      parseParentScope(req),
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
    const onlyParents = parseOnlyParents(req);
    const scope = onlyParents
      ? { includeB2C: false, includeSA: true }
      : { includeB2C: parseIncludeB2C(req), includeSA: parseIncludeSA(req) };
    const summary = await runMigration(
      false,
      parseMode(req),
      scope,
      parseParentScope(req),
    );
    return NextResponse.json(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/migrate-client-configs POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
