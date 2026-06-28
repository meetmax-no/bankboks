/**
 * Ko | Do · Vault — D-105 (NY · 2026-06-28) — Anti-dupliserings-lint
 *
 * Kjør:  yarn lint:d105
 *
 * BAKGRUNN
 * --------
 * D-105 (DECISIONS.md): "Alle komponenter og all logikk skal gjenbrukes fra
 * ett sted. Ingen duplisering."
 *
 * Dette skriptet skanner kode-basen for kjente duplisering-mønstre. Listen
 * utvides hver gang vi oppdager en ny duplisering — så denne filen vokser
 * over tid og blir vår institusjonelle hukommelse av "hvor vi har duplisert
 * før, så ikke gjør det igjen".
 *
 * MØNSTRE SOM FANGES
 * ------------------
 * 1. Inline child-tenant-counting-løkke utenfor `lib/platform/seat-counter.ts`
 *    - Skal bruke `countLiveActiveLicenses(prefix, tenants)` i stedet.
 *
 * 2. Inline `${activeLicenses}/{maxLicenses}`-tekst-counter utenfor
 *    `<SeatProgressBar>`-komponenten
 *    - Skal bruke `<SeatProgressBar activeSeats=... pendingSeats=... maxSeats=... />`.
 *
 * NYE MØNSTRE
 * -----------
 * Når Mike oppdager en ny duplisering, legges et nytt mønster til DUPLICATE_
 * PATTERNS-arrayen med:
 *   - `name`: kort navn på mønsteret
 *   - `pattern`: regex som matcher den dupliserte koden
 *   - `canonicalSource`: filen som er sannhetskilden
 *   - `fix`: kort instruks om hvordan ekstrahere
 *   - `exemptFiles`: filer som er kilden (skal ikke flagge seg selv)
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

interface DuplicatePattern {
  name: string;
  pattern: RegExp;
  canonicalSource: string;
  fix: string;
  exemptFiles: RegExp[];
}

const DUPLICATE_PATTERNS: DuplicatePattern[] = [
  {
    name: "inline-seat-counting-loop",
    // Ser etter en for-løkke som teller children med parentTenant === <prefix>
    // og hopper over deletedAt. Dette er DEN spesifikke duplikatet vi har
    // fanget i to ruter (D-103e fix).
    pattern:
      /for\s*\([^)]*tenants?\)\s*\{[^}]*parentTenant[^}]*deletedAt[^}]*\+\+/s,
    canonicalSource: "lib/platform/seat-counter.ts → countLiveActiveLicenses()",
    fix:
      "Erstatt løkken med: `const liveActiveLicenses = countLiveActiveLicenses(prefix, allTenants);`",
    exemptFiles: [/lib\/platform\/seat-counter\.ts$/],
  },
  {
    name: "inline-seat-text-counter",
    // Ser etter template-literal eller JSX som rendrer activeLicenses /
    // maxLicenses som ren tekst. Eksempler:
    //   `${props.activeLicenses ?? 0} / ${props.maxLicenses ?? 0}`
    //   {`${a} / ${b}`}
    //   {props.activeLicenses ?? 0} / {props.maxLicenses ?? 0}
    pattern:
      /\$\{[^}]*activeLicenses[^}]*\}\s*\/\s*\$\{[^}]*maxLicenses[^}]*\}/,
    canonicalSource:
      "components/platform/am-admin/SeatProgressBar.tsx → <SeatProgressBar>",
    fix:
      "Erstatt tekst-telleren med <SeatProgressBar activeSeats={...} pendingSeats={...} maxSeats={...} />",
    exemptFiles: [
      /components\/platform\/am-admin\/SeatProgressBar\.tsx$/,
      // API-ruter rendrer ikke React — feilmeldings-strenger som inneholder
      // "X/Y lisenser i bruk" er ikke UI-counter-duplisering, men en
      // server-side besked til klienten.
      /^app\/api\//,
      // D-105-lint-filen selv inneholder mønsteret som regex-eksempel —
      // ikke ekte duplisering.
      /lib\/__tests__\/d105-duplication-lint\.test\.ts$/,
    ],
  },
  {
    name: "inline-hybrid-seat-render",
    // D-106 (2026-06-28): inline JSX som rendrer "X+Y/Z"-mønster (hybrid-
    // seat: active + pending / max) utenfor SeatProgressBar. Dette var
    // duplikatet vi fant i tenant-list-raden (TenantViewer linje 760-801).
    // Matcher mønsteret `{active}+{pending}/{max}` med faktiske referanser.
    pattern:
      /\{\s*active(?:Licenses|Seats)?[^}]*\}\s*\+\s*\{\s*pending(?:Seats|InvitesCount|Licenses)?[^}]*\}/,
    canonicalSource:
      "components/platform/am-admin/SeatProgressBar.tsx → <SeatProgressBar>",
    fix:
      "Erstatt inline `{active}+{pending}/{max}`-JSX med <SeatProgressBar compact />",
    exemptFiles: [
      /components\/platform\/am-admin\/SeatProgressBar\.tsx$/,
      /lib\/__tests__\/d105-duplication-lint\.test\.ts$/,
    ],
  },
];

interface Violation {
  patternName: string;
  file: string;
  excerpt: string;
  fix: string;
  canonicalSource: string;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
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
  const filesApp = await walk(path.join(ROOT, "app"));
  const filesComponents = await walk(path.join(ROOT, "components"));
  const filesLib = await walk(path.join(ROOT, "lib"));
  const allFiles = [...filesApp, ...filesComponents, ...filesLib];

  const violations: Violation[] = [];
  let scanned = 0;

  for (const file of allFiles) {
    scanned += 1;
    const raw = await fs.readFile(file, "utf8");
    const src = stripComments(raw);
    const relPath = path.relative(ROOT, file).replaceAll("\\", "/");
    for (const dp of DUPLICATE_PATTERNS) {
      if (dp.exemptFiles.some((re) => re.test(relPath))) continue;
      const m = src.match(dp.pattern);
      if (m) {
        const excerpt =
          m[0].length > 120 ? `${m[0].slice(0, 117)}...` : m[0];
        violations.push({
          patternName: dp.name,
          file: relPath,
          excerpt: excerpt.replace(/\s+/g, " ").trim(),
          fix: dp.fix,
          canonicalSource: dp.canonicalSource,
        });
      }
    }
  }

  console.log(
    `\nD-105 anti-dupliserings-lint — skannet ${scanned} filer, ${DUPLICATE_PATTERNS.length} mønstre\n`,
  );

  if (violations.length === 0) {
    console.log(
      "✓ Ingen brudd på D-105 — ingen kjente duplisering-mønstre funnet\n",
    );
    process.exit(0);
  }

  console.log(`✗ ${violations.length} BRUDD på D-105:\n`);
  for (const v of violations) {
    console.log(`  [${v.patternName}] ${v.file}`);
    console.log(`    fant:    ${v.excerpt}`);
    console.log(`    kilde:   ${v.canonicalSource}`);
    console.log(`    fix:     ${v.fix}`);
    console.log("");
  }
  console.log(
    "D-105 ABSOLUTT REGEL: ingen duplisering. Ekstraher til shared module\n" +
      "og oppdater alle call-sites. Hvis duplisering er teknisk nødvendig\n" +
      "(f.eks. tenant-pod-isolasjon), legg filen til `exemptFiles` for\n" +
      "mønsteret OG dokumenter unntaket i D-105-seksjonen i DECISIONS.md.\n",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error("Uventet feil i D-105 lint-skript:", e);
  process.exit(1);
});
