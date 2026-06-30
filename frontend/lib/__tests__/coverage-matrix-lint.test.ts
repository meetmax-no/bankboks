/**
 * Ko | Do · Vault — Iter 19.9.11 (2026-06-25) — Coverage-matrix lint
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/coverage-matrix-lint.test.ts`
 *
 * Skanner faktiske route-filer under `app/api/{admin,cron,account}/` og
 * verifiserer at hver "operasjonell" rute er referert i minst én av
 * coverage-matrisene i `memory/DECISIONS.md`. Forhindrer regresjons-
 * blindsoner som Iter 19.9.8 LocaleRadioGroup-saken (admin-flyter
 * glemt 12 dager etter Iter 19.9-launch).
 *
 * **Regel:**
 *   Hver ny rute under admin/ cron/ account/ skal enten:
 *     (a) Refereres i minst én matrise i DECISIONS.md "Sjekk-mal for
 *         feature-dekning"-seksjonen, ELLER
 *     (b) Stå på EXEMPT-listen under (med kommentar om hvorfor).
 *
 *   Hvis hverken (a) eller (b) → lint-feil, fork-agent må bestemme:
 *     - Er ruten en del av en eksisterende kryssflyt-feature? → legg i
 *       relevant matrise.
 *     - Er ruten en operasjonell utility (login, migration, debug)? →
 *       legg på EXEMPT.
 *     - Er det en ny kryssflyt-feature? → bygg ny matrise fra malen.
 *
 * **EXEMPT-listen** skal være KORT og hver oppføring må ha begrunnelse.
 * Hvis listen vokser over ~15 ruter, vurder om malen er for streng.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const DECISIONS_PATH = join(REPO_ROOT, "..", "memory", "DECISIONS.md");

/**
 * Ruter som bevisst IKKE skal være i en coverage-matrise. Hver oppføring
 * må ha en kort begrunnelse. Hvis du legger til en ny rute her, dokumenter
 * hvorfor den er en operasjonell utility og ikke en del av en kryssflyt-
 * feature.
 *
 * Format: paths relative til `frontend/` (eks: `app/api/admin/login/route.ts`).
 */
const EXEMPT_ROUTES: Record<string, string> = {
  // Auth/session — admin-only operasjonelle utilities
  "app/api/admin/session/start/route.ts": "Admin-login token-utstedelse — ingen tenant-data",
  "app/api/admin/logout/route.ts": "Admin-logout token-invalidering — ingen tenant-data",

  // Engangs-migrasjoner og debug-tools
  "app/api/admin/migrate-client-configs/route.ts": "Engangs-migrasjon (Iter 8.3) — kjøres manuelt, ingen runtime-flyt",
  "app/api/admin/test-lifecycle-mail/route.ts": "Test-trigger for lifecycle-mailer (referert i Matrise 3 som test-entry)",
  "app/api/admin/test-register-paid/route.ts": "Test-trigger for paid-register-flyt (intern QA)",

  // Provisjonerings-pipeline — sub-steg av deleteTenant/createTenant
  "app/api/admin/tenants/[subdomain]/provision-vercel/route.ts": "Sub-steg i provisjoneringskjede, ikke selvstendig entry-point",
  "app/api/admin/tenants/[subdomain]/provision-upstash/route.ts": "Sub-steg i provisjoneringskjede, ikke selvstendig entry-point",
  "app/api/admin/tenants/[subdomain]/sync-stripe/route.ts": "Manuell Stripe-resync, vises i admin UI som debug-knapp",
  "app/api/admin/tenants/[subdomain]/send-invoice/route.ts": "Iter 20.4f · D-080: Mike sender faktura til B2B-parent (semiannual/yearly). Webhook handler dekker resten via D-080-matrise.",
  "app/api/admin/tenants/[subdomain]/test-checkout/route.ts": "Test-trigger for Stripe checkout (intern QA)",
  "app/api/admin/tenants/[subdomain]/first-org-admin/route.ts":
    "D-107 (Mike 2026-06-28): GET-only lookup av opprinnelig super-admin for visning i Lisens & B2B-fanen. Beskyttet av middleware, leser kun, ikke en sidekanal.",

  // Operasjonelle små-endepunkter
  "app/api/admin/subdomain-check/route.ts": "Live-validering av subdomene under registrering (ingen state-mutering)",
  "app/api/admin/rate-limit/route.ts": "Rate-limit status-readout for admin-dashbord (ingen tenant-flyt)",
  "app/api/admin/client-config/route.ts": "JSON-editor for tenant client-config (admin-only CRUD, vises i ClientConfigEditor)",

  // D-091 (2026-06-28) — Org-admin liste/sletting (Test Tools)
  "app/api/admin/org-admins/all/route.ts":
    "D-091: Super-admin lister alle org-admins på tvers av prefiks (admin-only utility, ingen tenant-data-flyt)",
  "app/api/admin/org-admins/bulk-delete/route.ts":
    "D-091: Super-admin bulk-sletter valgte org-admins + cascade (admin-only utility, ingen tenant-data-flyt)",

  // D-092 (2026-06-28) — Hybrid-seat-status for Konsoll
  "app/api/am-admin/seat-status/route.ts":
    "D-092: am-admin henter seats-status (activeLicenses + pendingInvites / maxLicenses) — read-only, ingen kryssflyt",

  // D-114 (2026-06-29) — Public branding for login-side
  "app/api/am-admin/branding/[prefix]/route.ts":
    "D-114: Public read-only firmanavn for am-admin login-side (Mike 2026-06-29). Returnerer kun prefix + companyName — ingen sensitiv data, ingen tenant-flyt.",

  // D-094 (2026-06-28) — Orphan invites liste/sletting (Test Tools)
  "app/api/admin/orphan-invites/all/route.ts":
    "D-094: Super-admin lister alle invites på tvers av prefiks med orphan-flagg (admin-only utility, ingen tenant-data-flyt)",
  "app/api/admin/orphan-invites/bulk-delete/route.ts":
    "D-094: Super-admin bulk-sletter valgte invites (admin-only utility, ingen tenant-data-flyt)",

  // Invites — kandidat for egen matrise når Iter 20 B2B-flyt er fullført,
  // men foreløpig ikke kryssflyt (kun én entry-point: admin-create + accept-rute).
  "app/api/admin/invites/route.ts": "B2B invite-create (én entry-point, ikke kryssflyt enda — vurder Matrise når Iter 20 ferdig)",
  "app/api/admin/invites/[token]/route.ts": "B2B invite GET/DELETE (admin-only utility)",
  "app/api/cron/cleanup-pending/route.ts": "B2B invite-utløp (expiresAt < now → status=expired) — del av invite-flyt, vurder Matrise når Iter 20 ferdig",

  // Iter 20 — am-admin B2B-flyt. Dekket av Matrise 6 i DECISIONS.md
  // (lagt til i Iter 20.6 etter at hele am-admin-stacken ble static-verified).
  "app/api/am-admin/auth/login/route.ts":
    "am-admin login (Iter 20.2) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/auth/logout/route.ts":
    "am-admin logout (Iter 20.2) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/auth/me/route.ts":
    "am-admin session-info (Iter 20.2) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/auth/change-password/route.ts":
    "am-admin passordbytte (Iter 20.9 / D-081) — tvinget reset ved første innlogging + frivillig bytte. Verifiserer current via bcrypt, krever min 12 tegn + zxcvbn ≥ 3 klient-side, clear-er forcePasswordReset-flagget.",
  "app/api/am-admin/tenants/route.ts":
    "am-admin liste ansatte (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/tenants/[subdomain]/route.ts":
    "am-admin slett ansatt (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/tenants/[subdomain]/suspend/route.ts":
    "am-admin suspender ansatt (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/tenants/[subdomain]/unsuspend/route.ts":
    "am-admin reaktiver ansatt (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/invites/route.ts":
    "am-admin invitasjoner GET/POST (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/invites/[token]/route.ts":
    "am-admin invite resend/slett (Iter 20.3) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/mpw/status/route.ts":
    "am-admin MPW status (Iter 20.5b) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/mpw/setup/route.ts":
    "am-admin MPW setup (Iter 20.5b) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/mpw/route.ts":
    "am-admin MPW reset / Glemt MPW (Iter 20.5b) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/employees/[subdomain]/notes/route.ts":
    "am-admin admin-notater GET/PUT/DELETE (Iter 20.5c) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/backup/data/route.ts":
    "am-admin backup-data aggregator (Iter 20.5d) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
  "app/api/am-admin/team/route.ts":
    "am-admin team-administrasjon GET/POST (Iter 20.9 / D-084) — super-admin gating via requireSuperAdmin, sender velkomstmail med forcePasswordReset",
  "app/api/am-admin/team/[id]/route.ts":
    "am-admin team-handlinger DELETE/POST(suspend|unsuspend) (Iter 20.9 / D-084) — håndhever 'siste super-admin'-invariant + selvslett/selvsuspendering-guard",
  "app/api/am-admin/auth/history/route.ts":
    "am-admin login-historikk GET (Iter 20.9 / D-086) — sorted-set Upstash, kun egen historikk, 90-dagers cutoff",
  "app/api/am-admin/auth/logout-all/route.ts":
    "am-admin logout-all-devices POST (Iter 20.9 / D-086) — bumper sessionsInvalidatedAt + clear current cookie",
  "app/api/am-admin/org/locale/route.ts":
    "am-admin org default e-post-locale PATCH (Iter 20.9 / D-086) — super-admin only, oppdaterer parent.locale",
  "app/api/admin/tenants/[subdomain]/create-org-admin/route.ts":
    "Mike oppretter første am-admin (Iter 20.2) — dekket av Matrise 6 i DECISIONS.md (Iter 20.6)",
};

/**
 * Globber alle route.ts-filer under de definerte mappene.
 */
function findRoutes(): string[] {
  const dirs = [
    "app/api/admin",
    "app/api/am-admin",
    "app/api/cron",
    "app/api/account",
  ];
  const found: string[] = [];
  for (const dir of dirs) {
    const fullDir = join(REPO_ROOT, dir);
    if (!existsSync(fullDir)) continue;
    // Bruk find via execSync — enklere enn rekursiv glob i Node.
    try {
      const output = execSync(`find ${fullDir} -name route.ts -type f`, {
        encoding: "utf-8",
      });
      output
        .split("\n")
        .filter((l) => l.trim())
        .map((p) => relative(REPO_ROOT, p))
        .forEach((p) => found.push(p));
    } catch {
      // dir tom eller utilgjengelig — skip
    }
  }
  return found.sort();
}

/**
 * Leser DECISIONS.md og finner alle filsti-referanser. Vi ser etter
 * paths som starter med "app/api/" eller "lib/platform/" inne i
 * "Sjekk-mal"-seksjonen.
 */
function readReferencedPaths(): Set<string> {
  if (!existsSync(DECISIONS_PATH)) {
    throw new Error(`DECISIONS.md ikke funnet på ${DECISIONS_PATH}`);
  }
  const content = readFileSync(DECISIONS_PATH, "utf-8");

  // Trekk ut alt etter "Sjekk-mal for feature-dekning" til slutten av fila.
  const sectionStart = content.indexOf("Sjekk-mal for feature-dekning");
  if (sectionStart === -1) {
    throw new Error(
      'DECISIONS.md mangler seksjon "Sjekk-mal for feature-dekning". ' +
        "Forventet at Iter 19.9.9 dokumentet skulle være på plass.",
    );
  }
  const matrixSection = content.slice(sectionStart);

  // Match path-referanser i markdown-tabeller (typisk `path/to/file.ts`
  // omkranset av backticks). Inkluder også `app/api/.../route.ts`-paths
  // som vises uten backticks (defensiv).
  const referenced = new Set<string>();
  const backtickRe = /`([a-z][\w/[\]-]*\.(?:ts|tsx))`/gi;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(matrixSection)) !== null) {
    referenced.add(match[1]);
  }

  // Naive plain-text path-match (uten backtick) — fanger opp paths som
  // glipper ut av markdown-tabell-syntax.
  const plainRe = /\bapp\/api\/[\w/[\]-]+\/route\.ts\b/g;
  while ((match = plainRe.exec(matrixSection)) !== null) {
    referenced.add(match[0]);
  }

  return referenced;
}

function main() {
  const routes = findRoutes();
  const referenced = readReferencedPaths();

  const orphans: string[] = [];
  for (const route of routes) {
    if (referenced.has(route)) continue;
    if (route in EXEMPT_ROUTES) continue;
    orphans.push(route);
  }

  // Sanity-sjekk: hvis en rute står i EXEMPT men ikke finnes på disk —
  // flagg det så listen ikke fyller seg med døde oppføringer.
  const deadExempts: string[] = [];
  for (const exemptPath of Object.keys(EXEMPT_ROUTES)) {
    if (!routes.includes(exemptPath)) {
      deadExempts.push(exemptPath);
    }
  }

  console.log(`\n[coverage-matrix-lint] Skannet ${routes.length} ruter`);
  console.log(
    `[coverage-matrix-lint] ${referenced.size} unike path-referanser funnet i DECISIONS.md`,
  );
  console.log(`[coverage-matrix-lint] ${Object.keys(EXEMPT_ROUTES).length} ruter på EXEMPT-listen`);

  let failed = false;

  if (orphans.length > 0) {
    failed = true;
    console.error(
      `\n[coverage-matrix-lint] FEIL — ${orphans.length} ruter er hverken i DECISIONS.md-matriser eller på EXEMPT-listen:\n`,
    );
    for (const o of orphans) {
      console.error(`  ❌ ${o}`);
    }
    console.error(
      "\n  Fiks: enten legg ruten i en eksisterende matrise i memory/DECISIONS.md, ",
    );
    console.error(
      "  bygg en ny matrise fra malen, eller legg den på EXEMPT_ROUTES i denne fila",
    );
    console.error("  med en kort begrunnelse.\n");
  }

  if (deadExempts.length > 0) {
    failed = true;
    console.error(
      `\n[coverage-matrix-lint] FEIL — ${deadExempts.length} ruter på EXEMPT-listen finnes ikke på disk:\n`,
    );
    for (const d of deadExempts) {
      console.error(`  ❌ ${d}`);
    }
    console.error(
      "\n  Fiks: fjern oppføringen fra EXEMPT_ROUTES (ruten er trolig flyttet/slettet).\n",
    );
  }

  if (failed) {
    process.exit(1);
  }

  console.log("\n✓ Coverage-matrix-lint grønt — alle ruter dekket eller exempt\n");
}

main();
