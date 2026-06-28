/**
 * Ko | Do · Vault — v4.3 D-069 — Static analyzer for lifecycle-guard compliance
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/lifecycle-guard-lint.test.ts`
 *
 * Skanner alle cron-ruter og webhook-handlere for tenant-status-mutationer
 * som IKKE kaller canAuto* først. Brudd er P0-bug per D-069.
 *
 * **Regel:**
 *   I filer under `app/api/cron/`, `app/api/webhooks/` eller filnavn som
 *   matcher `*-cron.ts` / `*-webhook.ts`:
 *
 *   Hvis filen mutater `tenant.status` til "locked", "cancelled" eller
 *   "deleted", ELLER setter `tenant.lockedAt`/`cancelledAt`/`deletedAt`,
 *   MÅ filen importere og kalle minst én av `canAutoLock`, `canAutoCancel`,
 *   `canAutoDelete` (eller predicates `isAutoLockable` etc) FRA
 *   `@/lib/platform/lifecycle-guard`.
 *
 *   Manuell admin-PATCH (i `app/api/admin/`) er unntatt — Mike er alltid eier.
 *
 * Robust mot kommentarer (//, /* * /).
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "app", "api");

// Mønstre vi flagger som "auto-mutation" av lifecycle-state
const STATUS_MUTATIONS = [
  /\bstatus\s*:\s*["']locked["']/,
  /\bstatus\s*:\s*["']cancelled["']/,
  /\bstatus\s*:\s*["']deleted["']/,
  /\blockedAt\s*:/,
  /\bcancelledAt\s*:/,
  /\bdeletedAt\s*:/,
];

const GUARD_USAGE = [
  /\bcanAutoLock\s*\(/,
  /\bcanAutoCancel\s*\(/,
  /\bcanAutoDelete\s*\(/,
  /\bisAutoLockable\b/,
  /\bisAutoCancellable\b/,
  /\bisAutoDeletable\b/,
];

const GUARD_IMPORT = /from\s+["']@\/lib\/platform\/lifecycle-guard["']/;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (men ikke i URLs)
}

function isAutomatedRoute(filePath: string): boolean {
  // cron + webhooks er auto-mekanismer. Admin er manuell.
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.includes("/api/cron/")) return true;
  if (normalized.includes("/api/webhooks/")) return true;
  // Iter 13 (2026-06-05): /api/webhook/ (singular) er også en webhook-rute.
  // Stripe webhook URL satt opp av Mike: https://admin.kodovault.no/api/webhook
  if (normalized.includes("/api/webhook/")) return true;
  if (/-cron\.ts$/.test(normalized)) return true;
  if (/-webhook\.ts$/.test(normalized)) return true;
  return false;
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
  matched: string;
  reason: string;
}

async function main() {
  const files = await walk(ROOT);
  const violations: Violation[] = [];
  let scanned = 0;
  let automatedFiles = 0;

  for (const file of files) {
    scanned += 1;
    if (!isAutomatedRoute(file)) continue;
    automatedFiles += 1;
    const raw = await fs.readFile(file, "utf8");
    const src = stripComments(raw);
    const mutated = STATUS_MUTATIONS.find((r) => r.test(src));
    if (!mutated) continue;
    const usesGuard = GUARD_USAGE.some((r) => r.test(src));
    const importsGuard = GUARD_IMPORT.test(src);
    if (!usesGuard || !importsGuard) {
      violations.push({
        file: path.relative(process.cwd(), file),
        matched: mutated.toString(),
        reason: !importsGuard
          ? "mangler import fra @/lib/platform/lifecycle-guard"
          : "importerer guard men kaller ikke canAuto* / isAuto* før mutation",
      });
    }
  }

  console.log(
    `\nD-069 lint — skannet ${scanned} filer, ${automatedFiles} auto-ruter (cron/webhook)\n`,
  );

  if (violations.length === 0) {
    console.log("✓ Ingen brudd på D-069 — alle auto-ruter er compliant\n");
    process.exit(0);
  }

  console.log(`✗ ${violations.length} BRUDD på D-069:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}`);
    console.log(`    matchet mønster: ${v.matched}`);
    console.log(`    grunn: ${v.reason}`);
    console.log("");
  }
  console.log(
    "FIX: Importer fra `@/lib/platform/lifecycle-guard` og kall " +
      "`canAutoLock(tenant)` (eller tilsvarende) FØR du muterer status. " +
      "Se DECISIONS.md D-069 for full beskrivelse.\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("Uventet feil i lint-skript:", e);
  process.exit(1);
});
