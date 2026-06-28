/**
 * Ko | Do · Vault — D-077 tenant-env-manifest-lint
 *
 * Kjør: `yarn lint:tenant-env`
 *
 * Hva sjekker scriptet?
 *
 *   For HVER `process.env.X` brukt i tenant-pod-kode (server-side API-ruter
 *   utenfor sentral-buckets per D-071, server-helpers under `lib/server/*`,
 *   samt frontend `hooks/*` + `components/*` der `NEXT_PUBLIC_*`-vars bygges
 *   inn på build-time):
 *     1. Er X listet i `TENANT_ENV_VARS` (manifestet)? ✓
 *     2. ELLER har bruken default-fallback (`??`, `||`, `?`-operator)? ✓
 *     3. ELLER er X i en whitelist av platform-vars (NODE_ENV, VERCEL_*)? ✓
 *
 *   Hvis INGEN av disse → BRUDD. Det betyr tenant-pod-koden krasjer på
 *   tenants som er provisjonert før varen ble lagt til manifestet, fordi
 *   `provisionTenantOnVercel` aldri satte den.
 *
 *   I tillegg: alle vars i manifest MÅ være referert i `provisionTenantOnVercel`
 *   sin `setProjectEnvVars`-kall — fanges ved at vi sjekker at filen
 *   leser fra `TENANT_ENV_VARS` (smoke-test mot regresjon).
 *
 * Hvorfor finnes denne?
 *   Lint:isolation håndhever D-071 så sentral-creds-imports ikke deployes
 *   til tenant-poder. D-077 lint håndhever det motsatte: env-vars som
 *   tenant-poder bruker MÅ være listet for provisjonering, ellers får
 *   nye tenants stille bug. Mike's prinsipp 2026-06-13.
 *
 * Robust mot kommentarer (//, slash-star block).
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT_API = path.join(process.cwd(), "app", "api");
const ROOT_LIB_SERVER = path.join(process.cwd(), "lib", "server");
const ROOT_HOOKS = path.join(process.cwd(), "hooks");
const ROOT_COMPONENTS = path.join(process.cwd(), "components");

// Disse banes innholdet kjører kun på admin (sentral-creds-buckets per D-071).
// Vi hopper over dem fordi de IKKE deployes til tenant-poder med samme env.
const ADMIN_ONLY_PATTERNS = [
  /\/api\/admin\//,
  /\/api\/billing\//,
  /\/api\/cron\//,
  /\/api\/webhook\//,
  /\/api\/webhooks\//,
  /\/api\/register\//,
  /\/api\/invite\//,
  /\/api\/client-config\//,
  /\/api\/internal\//,
];

// Platform/runtime-vars Vercel + Next.js setter automatisk. Trenger ikke
// provisjoneres.
const PLATFORM_WHITELIST = new Set([
  "NODE_ENV",
  "NEXT_RUNTIME",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_URL",
]);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isAdminOnly(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return ADMIN_ONLY_PATTERNS.some((re) => re.test(normalized));
}

async function walk(dir: string, exts = [".ts", ".tsx"]): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Hopp __tests__ — det er ikke deploy-kode
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      out.push(...(await walk(full, exts)));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

interface Usage {
  file: string;
  envVar: string;
  hasFallback: boolean;
}

/**
 * Finn alle `process.env.X` (eller `process.env["X"]`) i kildekoden.
 * Sjekker om bruken har en fallback-operator umiddelbart etter
 * (??, ||, ?, eller assignment med default).
 */
function findEnvUsage(src: string, file: string): Usage[] {
  const out: Usage[] = [];
  // `process.env.IDENTIFIER` eller `process.env["IDENTIFIER"]`
  const re =
    /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g;
  for (const m of src.matchAll(re)) {
    const envVar = m[1] ?? m[2];
    if (!envVar) continue;
    // Sjekk om de neste tegnene etter match indikerer fallback
    const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
    const hasFallback = /^\s*(\?\?|\|\||\?)/.test(after);
    out.push({ file, envVar, hasFallback });
  }
  return out;
}

async function main() {
  // ─── 1. Last manifest ────────────────────────────────────────────
  const manifestModule = await import(
    path.join(process.cwd(), "lib", "platform", "tenant-env-manifest.ts")
  );
  const TENANT_ENV_VARS = manifestModule.TENANT_ENV_VARS as {
    perTenant: readonly string[];
    sharedFromAdmin: readonly string[];
  };
  const manifestSet = new Set<string>([
    ...TENANT_ENV_VARS.perTenant,
    ...TENANT_ENV_VARS.sharedFromAdmin,
  ]);

  // ─── 2. Skann tenant-pod-kode ─────────────────────────────────────
  //   - `app/api/*` (server-side ruter, ekskl. sentral-buckets)
  //   - `lib/server/*` (server-helpers)
  //   - `hooks/*` + `components/*` (frontend — NEXT_PUBLIC_* bygges inn på
  //     build-time. Hvis tenant-pod build'es uten varen blir verdien
  //     `undefined`. Vi krever manifest ELLER fallback, samme regler.)
  const files = [
    ...(await walk(ROOT_API)),
    ...(await walk(ROOT_LIB_SERVER)),
    ...(await walk(ROOT_HOOKS)),
    ...(await walk(ROOT_COMPONENTS)),
  ];

  const violations: Usage[] = [];
  let scanned = 0;
  let usageCount = 0;
  for (const file of files) {
    if (isAdminOnly(file)) continue;
    scanned++;
    const src = stripComments(await fs.readFile(file, "utf8"));
    const usages = findEnvUsage(src, file);
    for (const u of usages) {
      usageCount++;
      if (manifestSet.has(u.envVar)) continue;
      if (PLATFORM_WHITELIST.has(u.envVar)) continue;
      if (u.hasFallback) continue;
      violations.push(u);
    }
  }

  // ─── 3. Bekreft at vercel-provision leser manifestet ─────────────
  const provFile = path.join(
    process.cwd(),
    "lib",
    "platform",
    "vercel-provision.ts",
  );
  const provSrc = stripComments(await fs.readFile(provFile, "utf8"));
  const readsManifest = /TENANT_ENV_VARS/.test(provSrc);

  // ─── 4. Rapporter ────────────────────────────────────────────────
  console.log(
    `\nD-077 tenant-env-manifest lint — skannet ${scanned} tenant-pod-filer, ${usageCount} process.env-bruk\n`,
  );

  if (!readsManifest) {
    console.error(
      "✗ vercel-provision.ts leser IKKE TENANT_ENV_VARS-manifestet.\n" +
        "  Refaktorer setProjectEnvVars-kallet til å iterere over manifestet.\n",
    );
    process.exit(1);
  }

  if (violations.length === 0) {
    console.log(
      "✓ Ingen brudd på D-077 — alle tenant-pod-env-vars er enten i manifest, har fallback, eller er platform-vars\n",
    );
    return;
  }

  console.error(`✗ ${violations.length} BRUDD på D-077:\n`);
  const byVar = new Map<string, Usage[]>();
  for (const v of violations) {
    if (!byVar.has(v.envVar)) byVar.set(v.envVar, []);
    byVar.get(v.envVar)!.push(v);
  }
  for (const [envVar, uses] of byVar) {
    console.error(`  ${envVar}:`);
    for (const u of uses.slice(0, 3)) {
      const rel = path.relative(process.cwd(), u.file);
      console.error(`    ${rel}`);
    }
    if (uses.length > 3) {
      console.error(`    ... og ${uses.length - 3} flere`);
    }
  }
  console.error(
    "\nFIX (velg én):" +
      "\n  1. Legg env-varen i `lib/platform/tenant-env-manifest.ts`" +
      "\n     → automatisk satt på nye tenants via provisionTenantOnVercel" +
      "\n  2. Gi bruken default-fallback (`?? \"default\"`) — for valgfrie vars" +
      "\n  3. Flytt ruten/koden til en sentral-bucket-path hvis den kun" +
      "\n     skal kjøre på admin (per D-071)" +
      "\n\nKonsekvens hvis ignorert: tenants provisjonert FØR varen ble" +
      "\nlagt til manifestet, krasjer på første kall som leser den.\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("Lint-script feilet:", e);
  process.exit(1);
});
