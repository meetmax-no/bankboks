/**
 * Ko | Do · Vault — v4.3 Iter 9 — Upstash Management API auto-provisjonering
 *
 * Per Utviklingsplan Iter 9 + spec linje 297-299:
 *   - createUpstashDatabase(subdomain) — POST /v2/redis/database
 *   - getDatabaseRestCredentials(databaseId) — henter REST URL + token
 *   - provisionTenantOnUpstash(subdomain) — orkestrerer hele flyten
 *
 * Per Mike 2026 (Iter 9): Ved Upstash-feil rull IKKE tilbake Vercel.
 * Marker tenant `provisioning_failed`, varsle via notify.ts, admin retry-er
 * via D-055-knappen.
 *
 * Auth: Basic Auth med base64(EMAIL:API_KEY) per Upstash Management API.
 *   - UPSTASH_MANAGEMENT_EMAIL (kontoens innloggings-epost)
 *   - UPSTASH_MANAGEMENT_API_KEY (PAT generert i Upstash-konsollen)
 *
 * Region: global database med primary_region `eu-west-1` (Dublin) — Upstash
 * sin regional-API er deprecated per 2026. Tom `read_regions` gjør at vi
 * effektivt får en EU-only DB (GDPR + lavest latens for Skandinavia).
 *
 * Node runtime.
 */
import { fetchWithRetry } from "./provision-retry";

const UPSTASH_API = "https://api.upstash.com";
const UPSTASH_PRIMARY_REGION = "eu-west-1";

/**
 * Normalisert Upstash-databasenavn. Samme prefiks som Vercel-prosjektet
 * (`kodo-kv-<subdomain>`) så Mike kan korrelere visuelt i begge dashboard.
 */
export function upstashDatabaseName(subdomain: string): string {
  return `kodo-kv-${subdomain.toLowerCase().trim()}`;
}

function getBasicAuthHeader(): string {
  const email = process.env.UPSTASH_MANAGEMENT_EMAIL;
  const apiKey = process.env.UPSTASH_MANAGEMENT_API_KEY;
  if (!email) {
    throw new Error(
      "UPSTASH_MANAGEMENT_EMAIL mangler — sett i Vercel env-vars (konto-epost).",
    );
  }
  if (!apiKey) {
    throw new Error(
      "UPSTASH_MANAGEMENT_API_KEY mangler — sett i Vercel env-vars (Management PAT).",
    );
  }
  const token = Buffer.from(`${email}:${apiKey}`).toString("base64");
  return `Basic ${token}`;
}

function upstashHeaders(): Record<string, string> {
  return {
    Authorization: getBasicAuthHeader(),
    "Content-Type": "application/json",
  };
}

// ─── Types (kun feltene vi bruker fra Upstash-API) ──────────────────────

export interface UpstashDatabaseCreated {
  database_id: string;
  database_name: string;
  region: string;
  // Mange Upstash-respons-felt utelatt — vi bryr oss kun om id + REST-creds.
  endpoint?: string;
  rest_token?: string;
  read_only_rest_token?: string;
}

export interface UpstashDatabaseDetails {
  database_id: string;
  database_name: string;
  region: string;
  endpoint: string;
  rest_token: string;
}

// ─── Step 1: Create database ────────────────────────────────────────────

/**
 * Oppretter en Upstash Redis-database (global modell, primary_region
 * `eu-west-1`). Regional-API er deprecated per 2026 — global med kun
 * `primary_region` og tom `read_regions` gir samme oppførsel som regional
 * (én EU-node, GDPR + latens for Skandinavia).
 *
 * Upstash returnerer typisk REST-credentials direkte i create-responsen.
 * Hvis ikke (eldre kontoer / nytt API-skema), faller vi tilbake til
 * separat hent-kall via getDatabaseRestCredentials.
 */
export async function createUpstashDatabase(
  subdomain: string,
): Promise<UpstashDatabaseCreated> {
  const name = upstashDatabaseName(subdomain);
  const url = `${UPSTASH_API}/v2/redis/database`;
  const body = {
    name,
    region: "global",
    primary_region: UPSTASH_PRIMARY_REGION,
    read_regions: [] as string[],
    tls: true,
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: upstashHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash create database ${res.status}: ${text}`);
  }
  const json = (await res.json()) as UpstashDatabaseCreated;
  if (!json.database_id) {
    throw new Error(
      `Upstash create database: mangler database_id i respons: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

// ─── Step 2: Get database details (REST URL + token) ────────────────────

/**
 * Henter database-detaljer (inkludert REST-endepunkt + token). Brukes
 * når create-responsen ikke inneholder credentials direkte.
 */
export async function getDatabaseRestCredentials(
  databaseId: string,
): Promise<UpstashDatabaseDetails> {
  const url = `${UPSTASH_API}/v2/redis/database/${encodeURIComponent(databaseId)}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: upstashHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash get database ${res.status}: ${text}`);
  }
  const json = (await res.json()) as UpstashDatabaseDetails;
  if (!json.endpoint || !json.rest_token) {
    throw new Error(
      `Upstash get database: mangler endpoint/rest_token i respons: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

// ─── Orchestration ──────────────────────────────────────────────────────

export interface ProvisionUpstashResult {
  databaseId: string;
  databaseName: string;
  restUrl: string;
  restToken: string;
}

export interface ProvisionUpstashInput {
  subdomain: string;
  /**
   * D-065: callback for sanntids-logging. Skal IKKE kaste.
   */
  onEvent?: (event: {
    stage: "upstash_create";
    status: "ok" | "failed";
    detail?: string;
  }) => Promise<void>;
}

/**
 * Hele Upstash-provisjonerings-flyten:
 *   1. Opprett database i eu-west-1
 *   2. Hent REST-credentials (fra create-respons hvis tilgjengelig,
 *      ellers separat GET-kall)
 *
 * Returnerer alt caller trenger for å sette KV_REST_API_URL/TOKEN på
 * tenantens Vercel-prosjekt.
 *
 * Idempotens er IKKE garantert — caller MÅ sjekke `tenant.upstashDatabaseId
 * === null` før dette kalles for å unngå dobbel-opprettelse.
 *
 * Ved feil: kaster med beskrivelse. Caller setter `status: "provisioning_failed"`
 * og varsler via notify.ts. INGEN Vercel-rollback (per Mike Iter 9).
 */
export async function provisionTenantOnUpstash(
  input: string | ProvisionUpstashInput,
): Promise<ProvisionUpstashResult> {
  // Backward-compatible: aksepter både `provisionTenantOnUpstash("acme")`
  // og `provisionTenantOnUpstash({ subdomain: "acme", onEvent })`.
  const cfg: ProvisionUpstashInput =
    typeof input === "string" ? { subdomain: input } : input;
  const normalized = cfg.subdomain.toLowerCase().trim();
  const emit = async (
    status: "ok" | "failed",
    detail?: string,
  ): Promise<void> => {
    if (cfg.onEvent) {
      try {
        await cfg.onEvent({ stage: "upstash_create", status, detail });
      } catch (e) {
        console.error("[provisionTenantOnUpstash] onEvent failed:", e);
      }
    }
  };

  try {
    // 1. Create database
    const created = await createUpstashDatabase(normalized);

    // 2. Hent REST URL + token. Hvis tilstede i create-respons, gjenbruk;
    //    ellers gjør et eget GET-kall.
    let restUrl: string;
    let restToken: string;
    if (created.endpoint && created.rest_token) {
      // Upstash endpoint er typisk en hostname; REST URL prefikser med https://
      restUrl = created.endpoint.startsWith("http")
        ? created.endpoint
        : `https://${created.endpoint}`;
      restToken = created.rest_token;
    } else {
      const details = await getDatabaseRestCredentials(created.database_id);
      restUrl = details.endpoint.startsWith("http")
        ? details.endpoint
        : `https://${details.endpoint}`;
      restToken = details.rest_token;
    }

    await emit(
      "ok",
      `databaseId=${created.database_id} name=${created.database_name} region=global primary=eu-west-1`,
    );

    return {
      databaseId: created.database_id,
      databaseName: created.database_name,
      restUrl,
      restToken,
    };
  } catch (e) {
    await emit("failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}


// ─── Slett database (tenant-sletting) ──────────────────────────────────

/**
 * Slett en Upstash-database permanent. Brukes av `deleteTenant()` i
 * `lib/platform/delete-tenant.ts`. Idempotent: 404 behandles som suksess
 * (databasen er allerede borte — det er målet).
 *
 * Returnerer true ved 2xx, false ved 404. Kaster på alle andre feil.
 */
export async function deleteUpstashDatabase(
  databaseId: string,
): Promise<boolean> {
  const url = `${UPSTASH_API}/v2/redis/database/${encodeURIComponent(databaseId)}`;
  const res = await fetchWithRetry(url, {
    method: "DELETE",
    headers: upstashHeaders(),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash delete database ${res.status}: ${text}`);
  }
  return true;
}
