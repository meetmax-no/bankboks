/**
 * Ko | Do · Vault — D-078a (NY · 2026-06-28) — Static analyzer for Super-admin
 * PII-isolasjon.
 *
 * Kjør:  yarn lint:d078
 *
 * BAKGRUNN
 * --------
 * D-078 sier: Mike-admin (super-admin på `admin.kodovault.no`) skal ALDRI se
 * ansatt-PII (epost, navn, invite-token, child-vault-subdomain-med-fornavn).
 * Hele B2B-employee-håndtering lever i B2B-Konsoll (`<prefix>-admin.kodovault.no`)
 * via `am-admin`-rollen.
 *
 * Bug-historikken viser at PII-lekkasjer typisk skjer ved at noen importerer
 * en B2B-Konsoll-komponent (eller den globale `InvitesSection`) inn i super-
 * admin-UI-et — slik `<InvitesSection>` ble lekk inn i `TenantViewer` i forrige
 * iterasjon. Dette skriptet hindrer at det skjer igjen.
 *
 * REGEL
 * -----
 * Filer i SUPER_ADMIN_SCOPES får IKKE importere noe i FORBIDDEN_IMPORTS,
 * med mindre filen er på EXEMPT-listen (Test Tools-kort for orphan-rydding,
 * eksplisitt godkjent av Mike 2026-06-28).
 *
 * Hvis lint-en feiler:
 *   1. Spør: trenger Mike-admin virkelig denne dataen? (D-078 sier nei.)
 *   2. Hvis ja → flytt funksjonen til B2B-Konsoll under `/platform/am-admin/`
 *   3. Hvis ja men kun for orphan-rydding → legg filen til EXEMPT-listen og
 *      oppdater D-078a i DECISIONS.md med begrunnelse.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

/**
 * Super-admin scope: alt under disse path-mønstrene har KUN lov til å se
 * org-metadata (TenantRecord-felter på parent), aldri child-PII.
 */
const SUPER_ADMIN_SCOPES: RegExp[] = [
  // Hele super-admin-UI-et
  /\/app\/platform\/admin\//,
  // Super-admin-modal
  /\/components\/platform\/TenantViewer\.tsx$/,
  // Super-admin støttekomponenter for parent-håndtering
  /\/components\/platform\/PaymentLinkModal\.tsx$/,
  /\/components\/platform\/SendTestInvoiceCard\.tsx$/,
  /\/components\/platform\/SendTestInvoiceTab\.tsx$/,
  /\/components\/platform\/ProvisioningTracker\.tsx$/,
  /\/components\/platform\/ClientConfigEditor\.tsx$/,
  /\/components\/platform\/ConfigToolsButton\.tsx$/,
  /\/components\/platform\/MailTestCard\.tsx$/,
  /\/components\/platform\/StripeTestCard\.tsx$/,
  /\/components\/platform\/CreateOrgAdminCard\.tsx$/,
  // Test Tools-kort for orphan-rydding — i scope MEN exempt (se EXEMPT_FILES).
  // Listet her så lint-en bevisst kjenner til dem og rapporterer "exempt" i
  // sammendraget, slik at vi har et synlig spor av at de er bevisst godkjent.
  /\/components\/platform\/OrgAdminListCard\.tsx$/,
  /\/components\/platform\/OrphanInvitesCard\.tsx$/,
];

/**
 * Test Tools-kort for orphan-rydding. Disse eksponerer bevisst aggregert
 * PII fordi det er eneste måte å identifisere zombie-rader på (parent
 * slettet, child-vault re-opprettet, etc.). Eksplisitt godkjent av Mike
 * 2026-06-28: "Dem skal du IKKE røre - De skal stå".
 *
 * Konsekvens: Mike SKAL kun bruke disse i et legitimt support/cleanup-
 * scenario. Hvis bruken blir hyppig → vurder audit-event (P1 i ROADMAP).
 */
const EXEMPT_FILES: RegExp[] = [
  /\/components\/platform\/OrgAdminListCard\.tsx$/,
  /\/components\/platform\/OrphanInvitesCard\.tsx$/,
];

/**
 * Forbudte imports i super-admin-scope.
 *
 * Hver entry har et regex som matcher import-strengen og en kort
 * begrunnelse for hvorfor det er en D-078-lekkasje.
 *
 * D-106 (2026-06-28): Listen er endret fra "hele am-admin-mappen" til
 * spesifikke PII-lekkende komponenter. SeatProgressBar og KonsollFooter
 * inneholder kun aggregerte tall/branding (ingen PII) og er trygt å
 * gjenbruke i super-admin-UI per D-105 (anti-duplisering).
 */
const FORBIDDEN_IMPORTS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /from\s+["'](?:\.\/|@\/components\/platform\/)InvitesSection["']/,
    reason:
      "InvitesSection lister invite-records med epost/navn/token — kun for B2B-Konsoll",
  },
  {
    pattern:
      /from\s+["'][^"']*am-admin\/(?:EmployeeListSection|InlineInviteForm|OrgInvitesSection|TeamManagementSection|AdminNotesModal|MpwSection|MpwContext|BackupSection|ChangePasswordForm|BillingStatusBanner)["']/,
    reason:
      "B2B-Konsoll-komponent som eksponerer ansatt-PII (epost, navn, invite-token, etc.)",
  },
];

interface Violation {
  file: string;
  matchedImport: string;
  reason: string;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function isInSuperAdminScope(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return SUPER_ADMIN_SCOPES.some((re) => re.test(normalized));
}

function isExempt(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return EXEMPT_FILES.some((re) => re.test(normalized));
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
    if (e.name === "node_modules" || e.name === ".next") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (
      e.isFile() &&
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))
    ) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  // Skann begge mapper hvor super-admin-scope kan ligge
  const filesApp = await walk(path.join(ROOT, "app", "platform", "admin"));
  const filesComponents = await walk(
    path.join(ROOT, "components", "platform"),
  );
  const allFiles = [...filesApp, ...filesComponents];

  const violations: Violation[] = [];
  let scanned = 0;
  let inScope = 0;
  let exempt = 0;

  for (const file of allFiles) {
    scanned += 1;
    if (!isInSuperAdminScope(file)) continue;
    inScope += 1;
    if (isExempt(file)) {
      exempt += 1;
      continue;
    }
    const raw = await fs.readFile(file, "utf8");
    const src = stripComments(raw);
    for (const { pattern, reason } of FORBIDDEN_IMPORTS) {
      const m = src.match(pattern);
      if (m) {
        violations.push({
          file: path.relative(ROOT, file),
          matchedImport: m[0],
          reason,
        });
      }
    }
  }

  console.log(
    `\nD-078a PII-isolasjon lint — skannet ${scanned} filer, ${inScope} i super-admin-scope, ${exempt} exempt (Test Tools)\n`,
  );

  if (violations.length === 0) {
    console.log(
      "✓ Ingen brudd på D-078 — super-admin-UI eksponerer ikke ansatt-PII\n",
    );
    process.exit(0);
  }

  console.log(`✗ ${violations.length} BRUDD på D-078:\n`);
  for (const v of violations) {
    console.log(`  ${v.file}`);
    console.log(`    forbudt import: ${v.matchedImport}`);
    console.log(`    årsak: ${v.reason}`);
    console.log("");
  }
  console.log(
    "FIX: Fjern import-en fra super-admin-scope. All B2B-employee-håndtering\n" +
      "(invites, ansatt-liste, admin-notater) skal leve i B2B-Konsoll under\n" +
      "`/components/platform/am-admin/` og `/app/platform/am-admin/`.\n\n" +
      "Hvis dette er en bevisst Test Tools-utvidelse for orphan-rydding,\n" +
      "legg filen til EXEMPT_FILES i `lib/__tests__/d078-pii-lint.test.ts`\n" +
      "OG dokumenter begrunnelsen i D-078a i DECISIONS.md.\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("Uventet feil i D-078a lint-skript:", e);
  process.exit(1);
});
