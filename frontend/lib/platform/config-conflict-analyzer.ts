/**
 * Ko | Do · Vault — D-149 (2026-02) — Config-conflict-analyzer
 *
 * Path-basert konflikt-detektor for SuperAdmin bulk-config-verktøy.
 *
 * Bygger på tanken: i stedet for å tvinge Mike å bestemme per-tenant
 * (skalerer ikke til 50-75 tenants), grupperer vi konflikter per PATH
 * i default.json → tenant-configs. Én policy-avgjørelse per path (via
 * radio-valg i UI) løser alle tenants samtidig.
 *
 * Sensitive paths (`brand.*`, `backgrounds`, `categories`, `_meta.*`)
 * er default på "tenant vinner" for å hindre uhell-overskriving.
 */

export type ClientConfigJson = Record<string, unknown>;

/**
 * Top-level nøkler i default.json som er "tenant-eid" og default på
 * "tenant vinner". Mike kan overstyre per path, men UI markerer dem
 * med varsel-farge.
 */
const SENSITIVE_TOP_LEVEL_KEYS = new Set([
  "brand",
  "backgrounds",
  "categories",
  "_meta",
]);

export function isSensitivePath(path: string): boolean {
  const top = path.split(".")[0] ?? "";
  return SENSITIVE_TOP_LEVEL_KEYS.has(top);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/**
 * Flatten et objekt til Map<dot-path, value>. Arrays behandles som
 * "leaf values" — hele arrayet er én verdi (ikke rekursivt utpakket).
 * Dette matcher mikes intent: "endre `analytics.periodDays` som en
 * enhet, ikke per array-element".
 */
export function flattenPaths(
  obj: unknown,
  prefix = "",
): Map<string, unknown> {
  const result = new Map<string, unknown>();
  if (!isPlainObject(obj)) {
    if (prefix) result.set(prefix, obj);
    return result;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) {
      const nested = flattenPaths(v, p);
      for (const [np, nv] of nested) result.set(np, nv);
    } else {
      // Arrays, primitives, null → leaf
      result.set(p, v);
    }
  }
  return result;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  // Dyp lik for JSON-serialiserbare verdier (nok for config-blobs).
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export interface PathConflict {
  path: string;
  sensitive: boolean;
  defaultValue: unknown;
  /** Antall tenants som helt mangler denne pathen. Auto-legges til ved merge. */
  tenantsMissing: number;
  /** Antall tenants som har SAMME verdi som default. Ingen konflikt. */
  tenantsMatchingDefault: number;
  /** Antall tenants med annen verdi enn default. */
  tenantsInConflict: number;
  /** Subdomains for tenants i konflikt (nyttig for V2-per-tenant-drill-down). */
  conflictingSubdomains: string[];
}

/**
 * Analyser default-template mot alle tenant-configs og produser en
 * path-basert konflikt-tabell.
 *
 * Return-shape er JSON-serialiserbar for direkte return fra API.
 */
export function analyzeConflicts(
  defaultTemplate: ClientConfigJson,
  tenants: Array<{ subdomain: string; config: ClientConfigJson | null }>,
): PathConflict[] {
  const defaultFlat = flattenPaths(defaultTemplate);
  const conflicts: PathConflict[] = [];

  for (const [path, defaultValue] of defaultFlat) {
    // _meta.client/createdAt/createdBy er per-tenant unike og skal ALDRI
    // pushes fra default. Filtrer bort.
    if (
      path === "_meta.client" ||
      path === "_meta.createdAt" ||
      path === "_meta.createdBy"
    ) {
      continue;
    }
    let missing = 0;
    let matching = 0;
    const conflictSubs: string[] = [];

    for (const t of tenants) {
      if (!t.config) {
        missing++;
        continue;
      }
      const flat = flattenPaths(t.config);
      if (!flat.has(path)) {
        missing++;
      } else if (valuesEqual(flat.get(path), defaultValue)) {
        matching++;
      } else {
        conflictSubs.push(t.subdomain);
      }
    }

    conflicts.push({
      path,
      sensitive: isSensitivePath(path),
      defaultValue,
      tenantsMissing: missing,
      tenantsMatchingDefault: matching,
      tenantsInConflict: conflictSubs.length,
      conflictingSubdomains: conflictSubs,
    });
  }

  // Sortér: konflikter først (mest interessante), deretter matching, missing.
  conflicts.sort((a, b) => {
    if (a.tenantsInConflict !== b.tenantsInConflict) {
      return b.tenantsInConflict - a.tenantsInConflict;
    }
    return a.path.localeCompare(b.path);
  });

  return conflicts;
}

/**
 * Smart-merge: bruker en policy-map (path → "default" | "tenant") for å
 * bestemme hvem som vinner ved konflikt. Nye paths (missing i tenant)
 * legges alltid til fra default. Paths uten policy-oppføring får default
 * "tenant vinner" — trygg default matcher eksisterende `merge`-modus.
 */
export function smartMerge(
  tenant: ClientConfigJson,
  defaultTemplate: ClientConfigJson,
  policies: Record<string, "default" | "tenant">,
): ClientConfigJson {
  const defaultFlat = flattenPaths(defaultTemplate);
  const tenantFlat = flattenPaths(tenant);
  const outputFlat = new Map<string, unknown>();

  // Start med alle tenant-verdier (inkl. paths som ikke finnes i default —
  // f.eks. tenant-spesifikke overrides som ikke skal røres).
  for (const [p, v] of tenantFlat) outputFlat.set(p, v);

  // Behandle paths fra default.
  for (const [p, dv] of defaultFlat) {
    // _meta.client/createdAt/createdBy: bevar tenantens eksisterende
    if (
      p === "_meta.client" ||
      p === "_meta.createdAt" ||
      p === "_meta.createdBy"
    ) {
      continue;
    }
    if (!tenantFlat.has(p)) {
      // Tenant mangler → legg til fra default (ingen konflikt)
      outputFlat.set(p, dv);
      continue;
    }
    if (valuesEqual(tenantFlat.get(p), dv)) {
      continue; // Ingen endring
    }
    // Konflikt: sjekk policy
    const policy = policies[p] ?? "tenant";
    if (policy === "default") {
      outputFlat.set(p, dv);
    }
    // Ellers behold tenant-verdien (allerede satt i outputFlat)
  }

  // Un-flatten tilbake til nested objekt.
  return unflattenPaths(outputFlat);
}

/**
 * Konverter Map<dot-path, value> tilbake til nested objekt.
 * Håndterer at leaf-verdier kan være arrays/primitives.
 */
export function unflattenPaths(
  flat: Map<string, unknown>,
): ClientConfigJson {
  const result: Record<string, unknown> = {};
  for (const [path, value] of flat) {
    const parts = path.split(".");
    let cur: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      const next = cur[key];
      if (!isPlainObject(next)) {
        cur[key] = {};
      }
      cur = cur[key] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  }
  return result;
}
