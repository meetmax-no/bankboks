/**
 * Ko | Do · Vault — v4.3 D-071 — Static analyzer for central-creds isolation
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/isolation-lint.test.ts`
 *
 * Skanner alle ruter under `app/api/` for bruk av "sentral-creds-imports"
 * (Stripe, central Upstash, encryption-key, Vercel API, etc.) og verifiserer
 * at de er i en GODKJENT isolasjons-bucket.
 *
 * **Regel:**
 *   Tenant Vercel-prosjekter har IKKE sentrale creds (per D-071). Hvis en
 *   ny rute bruker sentral-creds men ikke er i et godkjent bucket, vil den
 *   krasje på tenant-deploys med HTTP 500.
 *
 * **Godkjente buckets:**
 *   - `/api/admin/*`      — admin-only, kjører kun på admin.kodovault.no
 *   - `/api/billing/*`    — rewrites fra tenant til admin per D-071
 *   - `/api/internal/*`   — RPC fra tenant-poder til admin per D-076 (bearer-beskyttet)
 *   - `/api/cron/*`       — Vercel Cron, kjører kun på admin
 *   - `/api/webhook/`     — Stripe webhook, Stripe Dashboard peker til admin
 *   - `/api/webhooks/*`   — fremtidige webhooks (samme prinsipp)
 *   - `/api/register/*`   — registrering, kjører på admin/root
 *   - `/api/invite/*`     — B2B invite-accept, kjører på admin/root
 *   - `/api/client-config/` — public CORS-endpoint, kjører på admin
 *
 * **Sentral-creds-mønstre** (imports som triggerer):
 *   - `@/lib/stripe/*`                     (Stripe Secret Key)
 *   - `@/lib/platform/central-upstash`     (CENTRAL_KV_REST_API_*)
 *   - `@/lib/platform/tenant-store`        (central Upstash + encryption)
 *   - `@/lib/platform/client-config-store` (central Upstash)
 *   - `@/lib/platform/vercel-provision`    (Vercel API token)
 *   - `@/lib/platform/upstash-provision`   (Upstash account API)
 *   - `@/lib/platform/invite-store`        (central Upstash)
 *   - `@/lib/platform/provisioning-log`    (central Upstash)
 *
 * Hvis en NY rute importerer noen av disse OG ikke er i godkjent bucket,
 * må Mike enten:
 *   - Flytte ruten til et godkjent bucket, ELLER
 *   - Legge til et nytt bucket her med begrunnelse (oppdater D-071 først)
 *
 * Robust mot kommentarer (//, slash-star block).
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "app", "api");

const APPROVED_BUCKETS = [
  /\/api\/admin\//,
  /\/api\/billing\//,
  /\/api\/account\//, // Selvbetjent konto-sletting; rewritet fra tenant til admin
  /\/api\/cron\//,
  /\/api\/webhook\//,
  /\/api\/webhooks\//,
  /\/api\/register\//,
  /\/api\/invite\//,
  /\/api\/client-config\//,
  /\/api\/internal\//, // D-076: RPC fra tenant-poder til admin (status-cache)
  /\/api\/tenant\//, // Iter 19.9.2: tenant-info for SettingsPanel Fane 1 (Klient).
                      // Rewritet fra tenant til admin via next.config.mjs (samme
                      // mønster som /api/billing/* og /api/account/*).
  /\/api\/am-admin\//, // Iter 20.2/20.3: B2B org-admin-modul på <prefix>-admin-host.
                      // Routes lever på samme Vercel-prosjekt som admin og bruker
                      // sentrale creds for tenant/invite-CRUD. Host-isolasjon
                      // håndheves av middleware.
];

const CENTRAL_CREDS_IMPORTS = [
  /from\s+["']@\/lib\/stripe\/[^"']+["']/,
  /from\s+["']@\/lib\/platform\/central-upstash["']/,
  /from\s+["']@\/lib\/platform\/tenant-store["']/,
  /from\s+["']@\/lib\/platform\/client-config-store["']/,
  /from\s+["']@\/lib\/platform\/vercel-provision["']/,
  /from\s+["']@\/lib\/platform\/upstash-provision["']/,
  /from\s+["']@\/lib\/platform\/invite-store["']/,
  /from\s+["']@\/lib\/platform\/provisioning-log["']/,
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isInApprovedBucket(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return APPROVED_BUCKETS.some((re) => re.test(normalized));
}

async function walk(dir: string): Promise<string[]> {
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
      out.push(...(await walk(full)));
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  matchedImport: string;
}

async function main() {
  const files = await walk(ROOT);
  const violations: Violation[] = [];
  let scanned = 0;
  let inBucket = 0;

  for (const file of files) {
    scanned += 1;
    if (isInApprovedBucket(file)) {
      inBucket += 1;
      continue;
    }
    const raw = await fs.readFile(file, "utf8");
    const src = stripComments(raw);
    const matched = CENTRAL_CREDS_IMPORTS.find((r) => r.test(src));
    if (matched) {
      // Pull out the actual matched string for better error reporting
      const m = src.match(matched);
      violations.push({
        file: path.relative(process.cwd(), file),
        matchedImport: m ? m[0] : matched.toString(),
      });
    }
  }

  console.log(
    `\nD-071 isolation lint — skannet ${scanned} ruter, ${inBucket} i godkjente buckets\n`,
  );

  if (violations.length === 0) {
    console.log(
      "✓ Ingen brudd på D-071 — alle sentral-creds-imports er i godkjente buckets\n",
    );
    process.exit(0);
  }

  console.log(`✗ ${violations.length} BRUDD på D-071:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}`);
    console.log(`    importerer sentral-creds: ${v.matchedImport}`);
    console.log("");
  }
  console.log(
    "FIX: Flytt ruten til et godkjent bucket (admin/billing/cron/webhook/" +
      "register/invite/client-config/internal), ELLER legg til nytt bucket i denne " +
      "lint-skripten med begrunnelse i D-071 i DECISIONS.md.\n\n" +
      "Konsekvens hvis ignorert: ruten krasjer med HTTP 500 på tenant-deploys " +
      "fordi de ikke har sentral-creds (CENTRAL_KV_*, STRIPE_*, etc.)\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("Uventet feil i lint-skript:", e);
  process.exit(1);
});
