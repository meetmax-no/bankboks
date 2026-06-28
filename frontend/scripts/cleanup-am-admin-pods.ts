#!/usr/bin/env tsx
/**
 * Ko | Do · Vault — D-088 (2026-06-27, Mike) — cleanup-script for
 * feilprovisionerte `<prefix>-admin`-pods.
 *
 * Lister og (valgfritt) sletter Vercel-prosjekter som matcher `kodo-kv-*-admin`-
 * mønsteret. Disse ble auto-opprettet av en tidligere agent, men er en
 * arkitekturfeil: am-admin-rolla bruker host-prefix-routing på root/admin-
 * pod og lagrer data i SENTRAL Upstash — den trenger ikke egen Vercel-pod
 * eller egen tenant-Upstash-DB.
 *
 * KJØR:
 *   cd /app/frontend
 *
 *   # Dry-run (anbefalt først — viser hva som vil slettes uten å gjøre noe):
 *   VERCEL_TOKEN=xxx VERCEL_TEAM_ID=team_xxx npx tsx scripts/cleanup-am-admin-pods.ts
 *
 *   # Faktisk sletting:
 *   VERCEL_TOKEN=xxx VERCEL_TEAM_ID=team_xxx \
 *     npx tsx scripts/cleanup-am-admin-pods.ts --confirm
 *
 *   # Slett også tilhørende Upstash-DB-er (kun hvis du har provisionert dem):
 *   VERCEL_TOKEN=xxx VERCEL_TEAM_ID=team_xxx \
 *   UPSTASH_API_KEY=xxx UPSTASH_EMAIL=xxx \
 *     npx tsx scripts/cleanup-am-admin-pods.ts --confirm --include-upstash
 *
 * SIKKERHETSGRENSER (kan ikke overstyres):
 *   - Vil ALDRI slette prosjekt som ikke matcher `kodo-kv-*-admin`-regex
 *   - Vil ALDRI slette prosjekt med subdomain "admin" (Mike's super-admin)
 *   - Vil ALDRI slette prosjekt uten "-admin"-suffiks (ekte employee-vaults)
 *   - Krever --confirm flag for å faktisk slette (default = dry-run)
 */

// Mønsteret vi vil slette — KUN B2B parent admin pods.
const ADMIN_POD_REGEX = /^kodo-kv-([a-z][a-z0-9-]{0,30}[a-z0-9])-admin$/;

export {};

// Hard-kodet exclusion-liste (kan ikke slettes av dette scriptet uansett hva).
const PROTECTED_PROJECTS = new Set([
  "kodo-kv", // root marketing
  "kodo-kv-admin", // Mike's super-admin
  "kodo-kv-www", // www-alias
]);

interface VercelProject {
  id: string;
  name: string;
  createdAt: number;
  framework: string | null;
}

interface VercelListResponse {
  projects: VercelProject[];
  pagination?: { next: number | null };
}

interface UpstashDatabase {
  database_id: string;
  database_name: string;
  region: string;
  type: string;
  user_email: string;
  endpoint: string;
}

async function listVercelProjects(
  token: string,
  teamId: string | null,
): Promise<VercelProject[]> {
  const all: VercelProject[] = [];
  let nextCursor: number | null = null;
  let page = 0;
  do {
    page++;
    const params = new URLSearchParams({ limit: "100" });
    if (teamId) params.set("teamId", teamId);
    if (nextCursor) params.set("until", String(nextCursor));
    const res = await fetch(`https://api.vercel.com/v10/projects?${params}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `Vercel list failed: HTTP ${res.status} — ${await res.text()}`,
      );
    }
    const data = (await res.json()) as VercelListResponse;
    all.push(...data.projects);
    nextCursor = data.pagination?.next ?? null;
    if (page > 50) break; // sanity
  } while (nextCursor !== null);
  return all;
}

async function deleteVercelProject(
  token: string,
  teamId: string | null,
  projectId: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (teamId) params.set("teamId", teamId);
  const res = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}?${params}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Vercel delete ${projectId} failed: HTTP ${res.status} — ${await res.text()}`,
    );
  }
}

async function listUpstashDatabases(
  apiKey: string,
  email: string,
): Promise<UpstashDatabase[]> {
  const auth = Buffer.from(`${email}:${apiKey}`).toString("base64");
  const res = await fetch("https://api.upstash.com/v2/redis/databases", {
    headers: { authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(
      `Upstash list failed: HTTP ${res.status} — ${await res.text()}`,
    );
  }
  return (await res.json()) as UpstashDatabase[];
}

async function deleteUpstashDatabase(
  apiKey: string,
  email: string,
  databaseId: string,
): Promise<void> {
  const auth = Buffer.from(`${email}:${apiKey}`).toString("base64");
  const res = await fetch(
    `https://api.upstash.com/v2/redis/database/${databaseId}`,
    { method: "DELETE", headers: { authorization: `Basic ${auth}` } },
  );
  if (!res.ok) {
    throw new Error(
      `Upstash delete ${databaseId} failed: HTTP ${res.status} — ${await res.text()}`,
    );
  }
}

function safeMatchesAdminPod(name: string): {
  match: boolean;
  prefix: string | null;
  reason?: string;
} {
  if (PROTECTED_PROJECTS.has(name)) {
    return { match: false, prefix: null, reason: "PROTECTED" };
  }
  const m = ADMIN_POD_REGEX.exec(name);
  if (!m) {
    return { match: false, prefix: null, reason: "does not match *-admin pattern" };
  }
  const prefix = m[1];
  if (prefix === "admin") {
    // "kodo-kv-admin-admin" is nonsense; protect against weird edge
    return { match: false, prefix: null, reason: "prefix=admin reserved" };
  }
  return { match: true, prefix };
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  const includeUpstash = process.argv.includes("--include-upstash");

  const vercelToken = process.env.VERCEL_TOKEN;
  const vercelTeamId = process.env.VERCEL_TEAM_ID ?? null;
  if (!vercelToken) {
    console.error("MISSING: VERCEL_TOKEN env-var. Hent fra Vercel → Settings → Tokens.");
    process.exit(1);
  }

  const upstashApiKey = process.env.UPSTASH_API_KEY;
  const upstashEmail = process.env.UPSTASH_EMAIL;
  if (includeUpstash && (!upstashApiKey || !upstashEmail)) {
    console.error(
      "MISSING: UPSTASH_API_KEY + UPSTASH_EMAIL kreves med --include-upstash.",
    );
    process.exit(1);
  }

  console.log("D-088 cleanup-script — am-admin-pod-rydding");
  console.log("=".repeat(60));
  console.log(`Mode:           ${confirm ? "DELETE (--confirm)" : "DRY-RUN"}`);
  console.log(`Vercel team:    ${vercelTeamId ?? "(personal)"}`);
  console.log(`Upstash:        ${includeUpstash ? "ENABLED" : "skipped"}`);
  console.log();

  console.log("Henter Vercel-prosjekter…");
  const projects = await listVercelProjects(vercelToken, vercelTeamId);
  console.log(`Totalt ${projects.length} prosjekter funnet.`);
  console.log();

  const matches = projects
    .map((p) => ({ project: p, check: safeMatchesAdminPod(p.name) }))
    .filter((x) => x.check.match);

  if (matches.length === 0) {
    console.log("✓ Ingen feilprovisionerte am-admin-pods funnet. Ferdig.");
    return;
  }

  console.log(`Fant ${matches.length} feilprovisionerte am-admin-pods:`);
  for (const { project, check } of matches) {
    console.log(
      `  • ${project.name.padEnd(40)} (prefix=${check.prefix}, id=${project.id}, opprettet=${new Date(project.createdAt).toISOString().slice(0, 10)})`,
    );
  }
  console.log();

  let upstashDatabases: UpstashDatabase[] = [];
  let upstashCandidates: UpstashDatabase[] = [];
  if (includeUpstash && upstashApiKey && upstashEmail) {
    console.log("Henter Upstash-databaser…");
    upstashDatabases = await listUpstashDatabases(upstashApiKey, upstashEmail);
    upstashCandidates = upstashDatabases.filter((db) =>
      matches.some((m) => db.database_name === `kodo-kv-${m.check.prefix}-admin`),
    );
    console.log(
      `Fant ${upstashCandidates.length} matchende Upstash-databaser:`,
    );
    for (const db of upstashCandidates) {
      console.log(
        `  • ${db.database_name.padEnd(40)} (${db.region}, ${db.type})`,
      );
    }
    console.log();
  }

  if (!confirm) {
    console.log("DRY-RUN — kjør på nytt med `--confirm` for å slette.");
    return;
  }

  console.log("Sletter Vercel-prosjekter…");
  for (const { project } of matches) {
    try {
      await deleteVercelProject(vercelToken, vercelTeamId, project.id);
      console.log(`  ✓ slettet ${project.name}`);
    } catch (e) {
      console.error(
        `  ✗ ${project.name}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (includeUpstash && upstashApiKey && upstashEmail) {
    console.log();
    console.log("Sletter Upstash-databaser…");
    for (const db of upstashCandidates) {
      try {
        await deleteUpstashDatabase(upstashApiKey, upstashEmail, db.database_id);
        console.log(`  ✓ slettet ${db.database_name}`);
      } catch (e) {
        console.error(
          `  ✗ ${db.database_name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  console.log();
  console.log("Ferdig.");
  console.log();
  console.log("NESTE STEG (gjør manuelt i Vercel-dashbordet):");
  console.log(
    "  1. Sørg for at admin-poden har `*.kodovault.no` wildcard-alias",
  );
  console.log(
    "     (eller eksplisitt `<prefix>-admin.kodovault.no` for hver B2B-org)",
  );
  console.log(
    "  2. Test at `https://<prefix>-admin.kodovault.no/` viser login-skjermen",
  );
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
