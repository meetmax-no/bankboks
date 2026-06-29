/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Tenant config-builder (D-060)
 *
 * Pure helper: les `public/clients/default.json` fra filsystemet,
 * mutér `_meta.client` + `_meta.createdAt`, returner som JSON-objekt.
 *
 * Resultatet skrives til sentral Upstash som `client-config:<subdomain>`
 * (se client-config-store.ts) — IKKE til GitHub, IKKE til Vercel env-var.
 *
 * Node runtime ONLY (bruker fs.promises).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_TEMPLATE_REL_PATH = "public/clients/default.json";

export type ClientConfigJson = Record<string, unknown>;

/** Pure: mutér _meta. Eksportert for unit-test. */
export function buildTenantConfig(
  template: ClientConfigJson,
  subdomain: string,
  now: Date = new Date(),
): ClientConfigJson {
  const existingMeta =
    (template._meta && typeof template._meta === "object"
      ? (template._meta as Record<string, unknown>)
      : {}) ?? {};
  return {
    ...template,
    _meta: {
      ...existingMeta,
      client: subdomain,
      createdAt: now.toISOString(),
      createdBy: "Ko | Do Consult",
    },
  };
}

/** Les default-template fra deployed admin-app's filsystem. */
export async function readDefaultTemplate(): Promise<ClientConfigJson> {
  const templatePath = path.join(process.cwd(), DEFAULT_TEMPLATE_REL_PATH);
  let raw: string;
  try {
    raw = await fs.readFile(templatePath, "utf8");
  } catch (err) {
    throw new Error(
      `Kan ikke lese default-template fra ${templatePath}: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
  try {
    return JSON.parse(raw) as ClientConfigJson;
  } catch (err) {
    throw new Error(
      `default.json er ugyldig JSON: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
}

/** Hovedoperasjon: les template + mutér for tenant. */
export async function buildTenantConfigForUpstash(
  subdomain: string,
): Promise<ClientConfigJson> {
  const template = await readDefaultTemplate();
  return buildTenantConfig(template, subdomain.toLowerCase().trim());
}

/**
 * D-126 (2026-02 · Mike): SA-config arv for B2B-ansatte.
 *
 * Når en B2B child-tenant (ansatt) opprettes via invite, brukes parentens
 * `client-config:<prefix>-admin` som mal i stedet for global `default.json`.
 * Dette gjør at en SuperAdmin kan tilpasse logoer/farger/kategorier én gang
 * for hele organisasjonen sin og få det propagert til alle nye ansatte.
 *
 * Returnerer `null` hvis parent-config ikke finnes (ringt-er må fallback
 * til `buildTenantConfigForUpstash()` og logge en advarsel).
 *
 * Brukes av `provisionTenantOnVercel` når `parentSubdomain` er satt.
 */
export async function buildTenantConfigFromParent(
  parentSubdomain: string,
  childSubdomain: string,
): Promise<ClientConfigJson | null> {
  // Dynamic import for å unngå sirkulær avhengighet (client-config-store
  // importerer fra denne fila).
  const { getClientConfig } = await import("./client-config-store");
  const parentConfig = await getClientConfig(parentSubdomain);
  if (!parentConfig) return null;
  return buildTenantConfig(parentConfig, childSubdomain.toLowerCase().trim());
}

// ─── Deep merge (D-060) ─────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function arrayOfKeyedObjects(arr: unknown[]): boolean {
  return (
    arr.length > 0 &&
    arr.every(
      (item) =>
        isPlainObject(item) &&
        typeof (item as Record<string, unknown>).key === "string",
    )
  );
}

/**
 * Deep merge med tenant-wins (D-060):
 *   - Primitiver: tenant-wins hvis satt; default fyller hvis tenant mangler
 *   - Plain objekter: rekursiv merge
 *   - Arrays av {key:string,...}: union-på-key, tenant-wins ved konflikt
 *   - Andre arrays: tenant-wins (behold deres helt)
 *   - `_meta`: spesialbehandlet — tenant beholder createdAt/createdBy, men
 *      defaults legges til hvis nye felter
 *
 * Brukes av `mode=merge` i /api/admin/migrate-client-configs.
 */
export function mergeTenantWithDefault(
  tenant: ClientConfigJson,
  defaultTemplate: ClientConfigJson,
): ClientConfigJson {
  const result: ClientConfigJson = {};
  const allKeys = new Set<string>([
    ...Object.keys(defaultTemplate),
    ...Object.keys(tenant),
  ]);

  for (const k of allKeys) {
    const dv = defaultTemplate[k];
    const tv = tenant[k];

    if (!(k in tenant)) {
      result[k] = dv;
      continue;
    }
    if (!(k in defaultTemplate)) {
      result[k] = tv;
      continue;
    }
    if (isPlainObject(dv) && isPlainObject(tv)) {
      result[k] = mergeTenantWithDefault(tv, dv);
      continue;
    }
    if (Array.isArray(dv) && Array.isArray(tv)) {
      if (arrayOfKeyedObjects(dv) && arrayOfKeyedObjects(tv)) {
        // Union-på-key, tenant-wins
        const seen = new Map<string, Record<string, unknown>>();
        for (const item of tv as Record<string, unknown>[]) {
          seen.set(item.key as string, item);
        }
        for (const item of dv as Record<string, unknown>[]) {
          if (!seen.has(item.key as string)) {
            seen.set(item.key as string, item);
          }
        }
        result[k] = Array.from(seen.values());
      } else {
        result[k] = tv; // tenant-wins
      }
      continue;
    }
    // Primitiv eller mismatchede typer → tenant-wins
    result[k] = tv;
  }

  return result;
}
