/**
 * Ko | Do · Vault — v4.3 Iter 8 + Iter 9 — Vercel-API auto-provisjonering (D-057 + D-064)
 *
 * Per Utviklingsplan + D-064 (2026-06-03): Upstash provisjoneres FØRST,
 * deretter opprettes Vercel-prosjekt med ekte KV-creds direkte i første
 * setProjectEnvVars-kall. Ingen PENDING_ITER_9-mønster, ingen
 * post-update av env-vars — Vercel sin første deploy har riktige creds.
 *
 * Funksjoner:
 *   - createVercelProject(subdomain) — POST /v10/projects med gitRepository
 *   - setProjectEnvVars(projectId, envs) — POST /v10/projects/{id}/env
 *   - attachSubdomain(projectId, subdomain) — POST /v10/projects/{id}/domains
 *   - provisionTenantOnVercel(input) — orkestrert flyt, krever kvRestApiUrl + kvRestApiToken
 *   - listProjectEnvVars / deleteProjectEnvVar / updateProjectEnvVar — for fremtidig vedlikehold
 *   - Retry: 3 forsøk med 60 sek mellomrom (fetchWithRetry)
 *
 * MIDLERTIDIG: alle prosjekter peker på `meetmax-no/bankboks`-repoet
 * (D-057). Når `kodo-vault-template` er klar byttes `gitRepository.repo`.
 *
 * Auth: VERCEL_API_TOKEN (Bearer). Valgfri VERCEL_TEAM_ID som ?teamId-query
 * hvis prosjektene tilhører et team.
 *
 * Node runtime.
 */
import { fetchWithRetry } from "./provision-retry";
import {
  buildTenantConfigForUpstash,
  buildTenantConfigFromParent,
} from "./tenant-config-builder";
import { putClientConfig } from "./client-config-store";
import { TENANT_ENV_VARS } from "./tenant-env-manifest";

const VERCEL_API = "https://api.vercel.com";
const PROVISION_REPO_OWNER = "meetmax-no";
const PROVISION_REPO_NAME = "bankboks";
const PROVISION_FRAMEWORK = "nextjs";
const ROOT_DOMAIN = "kodovault.no";

function getVercelToken(): string {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    throw new Error(
      "VERCEL_API_TOKEN mangler — sett i Vercel env-vars (PAT med project-scope).",
    );
  }
  return token;
}

function teamQuery(): string {
  const id = process.env.VERCEL_TEAM_ID;
  return id ? `?teamId=${encodeURIComponent(id)}` : "";
}

function vercelHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getVercelToken()}`,
    "Content-Type": "application/json",
  };
}

/**
 * Normalisert Vercel-prosjektnavn. Vercel tillater 1-100 tegn,
 * lowercase, bindestrek. Subdomain har samme format-restriksjoner.
 * Vi prefikser med "kv-" så det er tydelig hvilket SaaS-prosjektet
 * tilhører ved scanning av Vercel-dashboardet.
 */
export function vercelProjectName(subdomain: string): string {
  return `kodo-kv-${subdomain.toLowerCase().trim()}`;
}

// ─── Types (minimale — kun feltene vi bruker) ──────────────────────────

interface VercelProject {
  id: string;
  name: string;
}

interface VercelProjectWithLink {
  id: string;
  name: string;
  link?: {
    type?: string;
    repoId?: number;
    repo?: string;
    org?: string;
  };
}

interface VercelEnvVarInput {
  key: string;
  value: string;
  target: ("production" | "preview" | "development")[];
  type?: "encrypted" | "plain" | "system";
}

interface VercelProjectDomain {
  name: string;
  verified: boolean;
}

// ─── Step 1: Create project ────────────────────────────────────────────

export async function createVercelProject(
  subdomain: string,
): Promise<VercelProject> {
  const name = vercelProjectName(subdomain);
  const url = `${VERCEL_API}/v10/projects${teamQuery()}`;
  const body = {
    name,
    framework: PROVISION_FRAMEWORK,
    // Bankboks-repoet har Next.js i `frontend/`-underkatalog (per Mike 2026-06-02).
    // Uten dette vil Vercel lete etter package.json i repo-roten og feile:
    // "No Next.js version detected".
    rootDirectory: "frontend",
    gitRepository: {
      type: "github",
      repo: `${PROVISION_REPO_OWNER}/${PROVISION_REPO_NAME}`,
    },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: vercelHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel create project ${res.status}: ${text}`);
  }
  const json = (await res.json()) as VercelProject;
  return { id: json.id, name: json.name };
}

// ─── Step 2: Set env vars ──────────────────────────────────────────────

export async function setProjectEnvVars(
  projectId: string,
  envs: VercelEnvVarInput[],
): Promise<void> {
  if (envs.length === 0) return;
  // POST /v10/projects/{id}/env godtar én env per kall. Vi looper sekvensielt
  // for å unngå å treffe rate-limits og for å få tydelige feil per variabel.
  const base = `${VERCEL_API}/v10/projects/${encodeURIComponent(projectId)}/env${teamQuery()}`;
  for (const env of envs) {
    const res = await fetchWithRetry(base, {
      method: "POST",
      headers: vercelHeaders(),
      body: JSON.stringify({ type: "encrypted", ...env }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Vercel set env ${env.key} ${res.status}: ${text}`,
      );
    }
  }
}

// ─── Step 2b: Update single env var (DELETE + POST) ────────────────────
//
// Vercel sin env-API tillater ikke PATCH per (key, target)-kombinasjon.
// For å bytte verdi må vi liste, slette eksisterende, og POSTe ny.
// Brukes av Iter 9 (Upstash-provisjonering) for å bytte
// KV_REST_API_URL/TOKEN fra PENDING_ITER_9 til ekte verdier.

interface VercelEnvListItem {
  id: string;
  key: string;
  target?: string[];
}

interface VercelEnvListResponse {
  envs: VercelEnvListItem[];
}

/**
 * Lister env-vars på prosjektet. Returnerer alle entries — caller filtrerer
 * på key/target.
 */
export async function listProjectEnvVars(
  projectId: string,
): Promise<VercelEnvListItem[]> {
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/env${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: vercelHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel list env ${res.status}: ${text}`);
  }
  const json = (await res.json()) as VercelEnvListResponse;
  return json.envs ?? [];
}

/**
 * Sletter én env-entry på id.
 */
export async function deleteProjectEnvVar(
  projectId: string,
  envId: string,
): Promise<void> {
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(envId)}${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "DELETE",
    headers: vercelHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel delete env ${envId} ${res.status}: ${text}`);
  }
}

/**
 * Overskriver verdi for én env-key (target = production + preview).
 * Sletter eksisterende entries med samme key først (Vercel tillater
 * ikke duplikater per key+target), deretter POST ny.
 */
export async function updateProjectEnvVar(
  projectId: string,
  key: string,
  value: string,
): Promise<void> {
  const existing = await listProjectEnvVars(projectId);
  for (const env of existing) {
    if (env.key === key) {
      await deleteProjectEnvVar(projectId, env.id);
    }
  }
  await setProjectEnvVars(projectId, [
    {
      key,
      value,
      target: ["production", "preview"],
    },
  ]);
}

// ─── Step 3: Attach subdomain ──────────────────────────────────────────

export async function attachSubdomain(
  projectId: string,
  subdomain: string,
): Promise<VercelProjectDomain> {
  const domain = `${subdomain.toLowerCase().trim()}.${ROOT_DOMAIN}`;
  const url = `${VERCEL_API}/v10/projects/${encodeURIComponent(projectId)}/domains${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: vercelHeaders(),
    body: JSON.stringify({ name: domain }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel attach domain ${domain} ${res.status}: ${text}`);
  }
  const json = (await res.json()) as VercelProjectDomain;
  return json;
}

// ─── Slett prosjekt (tenant-sletting) ──────────────────────────────────

/**
 * Slett et Vercel-prosjekt permanent. Brukes av `deleteTenant()` i
 * `lib/platform/delete-tenant.ts`. Idempotent: 404 behandles som suksess
 * (prosjektet er allerede borte — det er målet).
 *
 * Returnerer true ved 2xx, false ved 404. Kaster på alle andre feil.
 */
export async function deleteVercelProject(projectId: string): Promise<boolean> {
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "DELETE",
    headers: vercelHeaders(),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel delete project ${res.status}: ${text}`);
  }
  return true;
}


// ─── Step 4: Get project (med git link) + trigger redeploy ─────────────
//
// D-064 (2026-06-03): Vercel sin auto-deploy ved createProject KAN starte
// før vi har satt env-vars. Vi MÅ eksplisitt trigge en ny deploy etter
// setProjectEnvVars for at den aktive builden skal ha KV_REST_API_URL/TOKEN
// med ekte verdier. Krever GitHub repoId (numerisk) som vi henter via
// project-detail-endepunktet.

/**
 * Henter full project-respons inkludert `link.repoId` (numerisk GitHub-ID).
 * Nødvendig for å POSTe en ny deploy via `triggerVercelRedeploy`.
 */
export async function getVercelProject(
  projectId: string,
): Promise<VercelProjectWithLink> {
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(projectId)}${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: vercelHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel get project ${res.status}: ${text}`);
  }
  const json = (await res.json()) as VercelProjectWithLink;
  return json;
}

/**
 * Trigger en ny produksjonsdeploy fra `main`. Brukes etter setProjectEnvVars
 * for å sikre at den aktive builden har de oppdaterte env-varsene.
 *
 * Returnerer `deploymentId` (uid) som kan polles via `getDeploymentStatus`.
 * Vercel bygger asynkront — vi venter ikke på READY-state her.
 */
export async function triggerVercelRedeploy(
  projectId: string,
  projectName: string,
  repoId: number,
): Promise<{ deploymentId: string }> {
  const url = `${VERCEL_API}/v13/deployments${teamQuery()}`;
  const body = {
    name: projectName,
    project: projectId,
    target: "production",
    gitSource: {
      type: "github" as const,
      ref: "main",
      repoId,
    },
  };
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: vercelHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel trigger redeploy ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { uid?: string; id?: string };
  const deploymentId = json.uid ?? json.id;
  if (!deploymentId) {
    throw new Error(
      `Vercel trigger redeploy: respons mangler uid/id: ${JSON.stringify(json)}`,
    );
  }
  return { deploymentId };
}


/**
 * D-066 (2026-06-04): hent deployment-status. Brukes av pollDeploymentStatus.
 * State-verdier: QUEUED, INITIALIZING, BUILDING, READY, ERROR, CANCELED.
 */
export interface VercelDeploymentStatus {
  uid: string;
  /**
   * Eldre API-versjoner returnerer `state`; nyere returnerer `readyState`.
   * Vi sjekker begge — se poll-deployment.ts.
   */
  state?:
    | "QUEUED"
    | "INITIALIZING"
    | "BUILDING"
    | "READY"
    | "ERROR"
    | "CANCELED";
  readyState?:
    | "QUEUED"
    | "INITIALIZING"
    | "BUILDING"
    | "READY"
    | "ERROR"
    | "CANCELED";
  url?: string;
  errorMessage?: string;
}

export async function getDeploymentStatus(
  deploymentId: string,
): Promise<VercelDeploymentStatus> {
  const url = `${VERCEL_API}/v13/deployments/${encodeURIComponent(deploymentId)}${teamQuery()}`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: vercelHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel get deployment ${res.status}: ${text}`);
  }
  return (await res.json()) as VercelDeploymentStatus;
}

// ─── Orchestration ─────────────────────────────────────────────────────

export interface ProvisionVercelInput {
  subdomain: string;
  /**
   * D-064: KV-creds er nå OBLIGATORISKE — Upstash provisjoneres FØRST,
   * og ekte verdier settes direkte i Vercel sin første deploy. Ingen
   * PENDING_ITER_9-mønster.
   */
  kvRestApiUrl: string;
  kvRestApiToken: string;
  /**
   * Iter 20.9 (D-082, 2026-06-27): tenant-type. Bestemmer om B2B-spesifikke
   * env-vars (CENTRAL_KV_*, ORG_ADMIN_SESSION_SECRET m.fl.) skal propageres
   * til prosjektet. B2C-tenants får IKKE disse (D-071 isolasjon).
   */
  customerType?: "b2c" | "b2b";
  /**
   * D-126 (2026-02 · Mike): SA-config arv. Hvis satt, prøv å hente
   * `client-config:<parentSubdomain>` fra Upstash som mal for child sin
   * config. Hvis parent-config ikke finnes, fallback til `default.json`
   * og logg en advarsel via `onEvent`.
   *
   * Brukes av invite/accept (B2B child) og admin retry-flyt for child-
   * tenants. B2C self-service har ingen parent og setter dette null.
   */
  parentSubdomain?: string | null;
  /**
   * D-065: callback for sanntids-logging av events. Skal IKKE kaste —
   * logging-feil må ikke avbryte provisjonering.
   */
  onEvent?: (event: ProvisionEvent) => Promise<void>;
}

export type ProvisionEvent = {
  stage:
    | "upstash_create"
    | "vercel_create"
    | "vercel_env"
    | "vercel_redeploy"
    | "subdomain_attach";
  status: "ok" | "failed";
  detail?: string;
};

export interface ProvisionVercelResult {
  projectId: string;
  projectName: string;
  domain: string;
  domainVerified: boolean;
  deploymentId: string;
}

/**
 * Hele Vercel-provisjonerings-flyten. Forutsetter at Upstash er provisjonert
 * og at `kvRestApiUrl`/`kvRestApiToken` har ekte verdier.
 *
 * Idempotens er IKKE garantert — caller må sjekke `tenant.vercelProjectId === null`
 * før dette kalles for å unngå dobbel provisjonering.
 *
 * Ved feil: kaster med beskrivelse. Caller setter `status: "provisioning_failed"`
 * og varsler via notify.ts. Hvis Upstash-DB allerede eksisterer (orphan etter
 * Vercel-feil) — admin kan retry-e Vercel som vil bruke samme Upstash-DB.
 */
export async function provisionTenantOnVercel(
  input: ProvisionVercelInput,
): Promise<ProvisionVercelResult> {
  const subdomain = input.subdomain.toLowerCase().trim();
  const emit = async (event: ProvisionEvent) => {
    if (input.onEvent) {
      try {
        await input.onEvent(event);
      } catch (e) {
        console.error("[provisionTenantOnVercel] onEvent failed:", e);
      }
    }
  };

  // 1. Create project
  let project;
  try {
    project = await createVercelProject(subdomain);
    await emit({
      stage: "vercel_create",
      status: "ok",
      detail: `projectId=${project.id} name=${project.name}`,
    });
  } catch (e) {
    await emit({
      stage: "vercel_create",
      status: "failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  // 2. Skriv tenant-config til sentral Upstash (D-060): tenantens app
  //    fetcher dette fra admin.kodovault.no/api/client-config ved runtime.
  //    Bankboks-repoet blir ikke rørt — alt sentralt i Upstash.
  //
  //    D-126 (2026-02 · Mike): hvis `parentSubdomain` er satt og parent-
  //    config eksisterer i Upstash, brukes den som mal i stedet for global
  //    `default.json`. Dette gjør at en B2B SuperAdmin kan tilpasse config
  //    én gang for hele org-en og få det automatisk arvet til alle ansatte.
  let tenantConfig;
  if (input.parentSubdomain) {
    tenantConfig = await buildTenantConfigFromParent(
      input.parentSubdomain,
      subdomain,
    );
    if (!tenantConfig) {
      // Parent har ingen client-config i Upstash — fallback til default.json
      // + logg advarsel så admin kan kjøre migreringen i Config-verktøy.
      await emit({
        stage: "vercel_env",
        status: "ok",
        detail: `[D-126] parent '${input.parentSubdomain}' mangler client-config — fallback til default.json. Kjør Config-verktøy → 'Skip eksisterende' for å initialisere parent.`,
      });
      tenantConfig = await buildTenantConfigForUpstash(subdomain);
    }
  } else {
    tenantConfig = await buildTenantConfigForUpstash(subdomain);
  }
  await putClientConfig(subdomain, tenantConfig);

  // 3. Set env vars — alle creds er ekte, ingen plassholdere (D-064).
  //    D-077: env-vars leses fra `TENANT_ENV_VARS`-manifestet. Lint-skriptet
  //    `tenant-env-manifest.test.ts` håndhever at all tenant-pod-kode bruker
  //    env-vars som er listet her — så vi får aldri stille mangel-feil.
  const perTenantValues: Record<(typeof TENANT_ENV_VARS.perTenant)[number], string> = {
    NEXT_PUBLIC_CLIENT_CONFIG: subdomain,
    KV_REST_API_URL: input.kvRestApiUrl,
    KV_REST_API_TOKEN: input.kvRestApiToken,
  };

  // Shared-from-admin: les fra admin sin egen process.env. FAILER hardt
  // hvis admin mangler en av dem — vi vil ikke ende med tenants som
  // stille fail-open'er pga manglende creds.
  const sharedFromAdmin: Array<{ key: string; value: string }> = [];
  for (const key of TENANT_ENV_VARS.sharedFromAdmin) {
    const value = process.env[key];
    if (!value) {
      throw new Error(
        `${key} mangler på admin — kan ikke propagere til tenant (D-077). ` +
          "Sett env-var i admin-Vercel-prosjektet før provisjonering.",
      );
    }
    sharedFromAdmin.push({ key, value });
  }

  // Iter 20.9 (D-082): B2B parent-tenants får i tillegg sentrale envs.
  if (input.customerType === "b2b") {
    for (const key of TENANT_ENV_VARS.sharedFromAdminB2BParent) {
      const value = process.env[key];
      if (!value) {
        throw new Error(
          `${key} mangler på admin — kan ikke propagere til B2B parent (D-082). ` +
            "Sett env-var i admin-Vercel-prosjektet før provisjonering.",
        );
      }
      sharedFromAdmin.push({ key, value });
    }
  }

  try {
    await setProjectEnvVars(project.id, [
      ...TENANT_ENV_VARS.perTenant.map((key) => ({
        key,
        value: perTenantValues[key],
        target: ["production", "preview"] as ("production" | "preview" | "development")[],
      })),
      ...sharedFromAdmin.map(({ key, value }) => ({
        key,
        value,
        target: ["production", "preview"] as ("production" | "preview" | "development")[],
      })),
    ]);
    await emit({
      stage: "vercel_env",
      status: "ok",
      detail: `env-vars satt: ${[
        ...TENANT_ENV_VARS.perTenant,
        ...TENANT_ENV_VARS.sharedFromAdmin,
      ].join(", ")}`,
    });
  } catch (e) {
    await emit({
      stage: "vercel_env",
      status: "failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  // 4. D-064: Trigger eksplisitt redeploy MED de nye env-vars.
  //    createVercelProject kan ha startet en auto-deploy umiddelbart (før
  //    setProjectEnvVars rakk å kjøre), som da bygges uten KV-creds.
  //    Den nye deployen er den som blir aktiv produksjons-deploy.
  let deploymentId: string;
  try {
    const detail = await getVercelProject(project.id);
    const repoId = detail.link?.repoId;
    if (!repoId) {
      throw new Error(
        `Vercel project ${project.id} mangler link.repoId — kan ikke trigge redeploy. Sjekk at gitRepository ble korrekt koblet ved createProject.`,
      );
    }
    const dep = await triggerVercelRedeploy(project.id, project.name, repoId);
    deploymentId = dep.deploymentId;
    await emit({
      stage: "vercel_redeploy",
      status: "ok",
      detail: `deploymentId=${deploymentId} ref=main repoId=${repoId}`,
    });
  } catch (e) {
    await emit({
      stage: "vercel_redeploy",
      status: "failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  // 5. Attach subdomain (uavhengig av deploy-status)
  let dom;
  try {
    dom = await attachSubdomain(project.id, subdomain);
    await emit({
      stage: "subdomain_attach",
      status: "ok",
      detail: `${dom.name} verified=${dom.verified}`,
    });
  } catch (e) {
    await emit({
      stage: "subdomain_attach",
      status: "failed",
      detail: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  return {
    projectId: project.id,
    projectName: project.name,
    domain: dom.name,
    domainVerified: dom.verified,
    deploymentId,
  };
}
