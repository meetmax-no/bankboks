/**
 * Ko | Do · Vault — Iter 20.5d — Offline-tester for am-admin-backup
 *
 * Kjør:
 *   cd frontend && npx tsx lib/__tests__/am-admin-backup.test.ts
 *
 * Tester pure CSV/JSON-bygging + dekryptering + filnavn-format.
 * Ingen Upstash-dep — bare lib/platform/am-admin-backup.ts.
 */
import {
  createMpwVerifier,
  verifyMpw,
  encryptWithMpwKey,
  type MpwEnvelope,
} from "../platform/am-admin-mpw";
import {
  csvEscape,
  buildEmployeesCsv,
  buildBackupJson,
  buildBackupFilename,
  decryptEmployeeNotes,
  type BackupData,
  type BackupEmployee,
  type DecryptedEmployee,
} from "../platform/am-admin-backup";

if (typeof crypto === "undefined" || !crypto.subtle) {
  console.error("FAIL: Web Crypto API ikke tilgjengelig");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log("OK:", msg);
    passed++;
  } else {
    console.error("FAIL:", msg);
    failed++;
  }
}

async function main(): Promise<void> {
  // ─── csvEscape ──────────────────────────────────────────────────
  assert(csvEscape(null) === "", "csvEscape(null) → tom streng");
  assert(csvEscape(undefined) === "", "csvEscape(undefined) → tom streng");
  assert(csvEscape("simple") === "simple", "csvEscape(simple) — ingen escaping");
  assert(
    csvEscape("with,comma") === '"with,comma"',
    "csvEscape med komma → wrappet i quotes",
  );
  assert(
    csvEscape('with"quote') === '"with""quote"',
    "csvEscape med quote → escapet og wrappet",
  );
  assert(
    csvEscape("with\nnewline") === '"with\nnewline"',
    "csvEscape med newline → wrappet i quotes",
  );
  assert(
    csvEscape("with\r\ncrlf") === '"with\r\ncrlf"',
    "csvEscape med CRLF → wrappet i quotes",
  );
  assert(
    csvEscape("Kari, \"Ola\" og\næøå") === '"Kari, ""Ola"" og\næøå"',
    "csvEscape kombinert (komma + quote + newline + æøå)",
  );

  // ─── OWASP CSV formula-injection-mitigering ──────────────────────
  assert(
    csvEscape("=cmd|'/c calc'!A0") === "'=cmd|'/c calc'!A0",
    "csvEscape prefixer = med apostrof (Excel/Sheets formel-blokk)",
  );
  assert(
    csvEscape("+1234") === "'+1234",
    "csvEscape prefixer + med apostrof",
  );
  assert(
    csvEscape("-SUM(A1:A2)") === "'-SUM(A1:A2)",
    "csvEscape prefixer - med apostrof",
  );
  assert(
    csvEscape("@import") === "'@import",
    "csvEscape prefixer @ med apostrof",
  );
  assert(
    csvEscape("\t=evil") === "'\t=evil",
    "csvEscape prefixer TAB med apostrof",
  );
  assert(
    csvEscape("\rmalicious") === '"\'\rmalicious"',
    "csvEscape prefixer CR med apostrof + wraps i quotes pga \\r",
  );
  // Sjekk at apostrof + komma-payload både prefixes og wrappes:
  assert(
    csvEscape('=HYPERLINK("evil","x")') ===
      `"'=HYPERLINK(""evil"",""x"")"`,
    "csvEscape håndterer kombinert formula + komma + quote",
  );
  // Normal tekst skal IKKE prefixes:
  assert(
    csvEscape("Bare en vanlig notat") === "Bare en vanlig notat",
    "csvEscape lar vanlig tekst stå urørt",
  );
  assert(
    csvEscape("not-a-formula") === "not-a-formula",
    "csvEscape ord som starter med 'n' (ikke =/+/-/@) → ingen prefiks",
  );

  // ─── buildBackupFilename ─────────────────────────────────────────
  const fixedDate = new Date("2026-06-26T15:42:18");
  assert(
    buildBackupFilename("amlaw", "csv", fixedDate) ===
      "amlaw-employees-backup-2026-06-26-154218.csv",
    "filename med timestamp (CSV) — sekund-presisjon",
  );
  assert(
    buildBackupFilename("amlaw", "json", fixedDate) ===
      "amlaw-employees-backup-2026-06-26-154218.json",
    "filename med timestamp (JSON) — sekund-presisjon",
  );
  // Sjekk zero-padding på enkelt-sifret time/måned/sekund
  const earlyDate = new Date("2026-01-05T08:03:07");
  assert(
    buildBackupFilename("acme", "csv", earlyDate) ===
      "acme-employees-backup-2026-01-05-080307.csv",
    "filename zero-padding (jan 5 08:03:07)",
  );

  // ─── decryptEmployeeNotes — happy path ───────────────────────────
  const { envelope, key, salt } = await createMpwVerifier("test-mpw-42-passord");
  const noteEnv = await encryptWithMpwKey("Privat note med æøå 🔐", key, salt);
  const noteEnv2 = await encryptWithMpwKey(
    "Note med ,komma og \"quote\" og\nnewline",
    key,
    salt,
  );

  const employees: BackupEmployee[] = [
    {
      subdomain: "amlaw-kari",
      firstName: "Kari",
      lastName: "Nordmann",
      email: "kari@amlaw.no",
      contactEmail: null,
      locale: "no",
      status: "active",
      createdAt: "2026-01-15T10:00:00Z",
      noteEnvelope: noteEnv,
    },
    {
      subdomain: "amlaw-ola",
      firstName: "Ola",
      lastName: null,
      email: null,
      contactEmail: "ola@privat.no",
      locale: "no",
      status: "suspended",
      createdAt: "2026-02-01T10:00:00Z",
      noteEnvelope: null, // ingen notat
    },
    {
      subdomain: "amlaw-bob",
      firstName: "Bob",
      lastName: "Builder",
      email: "bob@amlaw.no",
      contactEmail: null,
      locale: "en",
      status: "active",
      createdAt: "2026-03-01T10:00:00Z",
      noteEnvelope: noteEnv2,
    },
  ];

  const decrypted = await decryptEmployeeNotes(employees, key);
  assert(decrypted.length === 3, "decryptEmployeeNotes returnerer alle ansatte");
  assert(
    decrypted[0].note === "Privat note med æøå 🔐",
    "note 0 dekryptert UTF-8 + emoji",
  );
  assert(decrypted[1].note === null, "note 1 null (ingen envelope)");
  assert(
    decrypted[1].noteDecryptError === false,
    "note 1 ingen decrypt-error (var bare ikke satt)",
  );
  assert(
    decrypted[2].note?.includes(",komma") === true,
    "note 2 inneholder komma",
  );

  // ─── decryptEmployeeNotes — wrong key (decrypt-error path) ───────
  const { key: wrongKey } = await createMpwVerifier("annet-passord-helt");
  const failedDecrypt = await decryptEmployeeNotes(employees, wrongKey);
  assert(
    failedDecrypt[0].note === null,
    "feil key gir note=null på envelope-rad",
  );
  assert(
    failedDecrypt[0].noteDecryptError === true,
    "feil key markerer noteDecryptError=true",
  );
  assert(
    failedDecrypt[1].noteDecryptError === false,
    "rader uten envelope markerer IKKE decrypt-error",
  );

  // ─── buildEmployeesCsv ───────────────────────────────────────────
  const csv = buildEmployeesCsv(decrypted);
  const lines = csv.split("\r\n");
  assert(
    lines[0] ===
      "subdomain,first_name,last_name,email,contact_email,locale,status,created_at,admin_note,note_status",
    "CSV header korrekt",
  );
  assert(lines.length === 5, "CSV: header + 3 rader + tom siste linje");
  assert(
    lines[1].startsWith("amlaw-kari,Kari,Nordmann,kari@amlaw.no,,no,active,"),
    "rad 1 starter med kari-data",
  );
  assert(
    lines[1].includes(",ok\r\n") || lines[1].endsWith(",ok"),
    "rad 1 ender med note_status=ok",
  );
  assert(
    lines[2].includes(",,") && lines[2].includes("amlaw-ola"),
    "rad 2 har tomme felter for null-data",
  );
  assert(
    lines[2].endsWith(",none"),
    "rad 2 note_status=none",
  );

  // CSV med decrypt-error
  const csvErr = buildEmployeesCsv(failedDecrypt);
  const errLines = csvErr.split("\r\n");
  assert(
    errLines[1].endsWith(",decrypt_error"),
    "decrypt-error markeres i CSV note_status",
  );

  // ─── buildBackupJson ─────────────────────────────────────────────
  const data: BackupData = {
    generatedAt: "2026-06-26T15:00:00Z",
    prefix: "amlaw",
    license: {
      parentSubdomain: "amlaw",
      plan: "b2b_yearly",
      maxLicenses: 10,
      activeLicenses: 3,
      trialEndsAt: null,
      nextBillingDate: "2027-06-26T00:00:00Z",
      status: "active",
    },
    employeeCount: 3,
    notedCount: 2,
    employees,
  };
  const json = buildBackupJson(data, decrypted);
  assert(json.format === "kodovault-am-admin-backup-v1", "JSON format-stempel");
  assert(json.prefix === "amlaw", "JSON prefix matcher");
  assert(json.license.plan === "b2b_yearly", "JSON license preserved");
  assert(json.employeeCount === 3, "JSON employeeCount = 3");
  assert(json.notedCount === 2, "JSON notedCount = 2");
  assert(json.decryptErrorCount === 0, "JSON decryptErrorCount = 0 (happy path)");
  assert(json.employees.length === 3, "JSON inkluderer alle ansatte");
  assert(
    json.employees[0].note === "Privat note med æøå 🔐",
    "JSON-note inneholder dekryptert UTF-8",
  );

  const jsonErr = buildBackupJson(data, failedDecrypt);
  assert(
    jsonErr.decryptErrorCount === 2,
    "JSON decryptErrorCount = 2 ved feil key",
  );

  // ─── Roundtrip-konsistens: verifier kan re-derive samme key ──────
  const unlock = await verifyMpw(envelope, "test-mpw-42-passord");
  assert(unlock !== null, "verifyMpw kan re-derive same key");
  if (unlock) {
    const reDecrypt = await decryptEmployeeNotes(employees, unlock.key);
    assert(
      reDecrypt[0].note === "Privat note med æøå 🔐",
      "Re-derivet key dekrypterer samme note",
    );
  }

  // ─── Edge: tom employees-array ───────────────────────────────────
  const emptyCsv = buildEmployeesCsv([] as DecryptedEmployee[]);
  assert(
    emptyCsv === "subdomain,first_name,last_name,email,contact_email,locale,status,created_at,admin_note,note_status\r\n",
    "tom employees-array gir kun header",
  );

  // ─── Skummel-input: subdomain med komma + quote (shouldn't happen
  // but defensive) ────────────────────────────────────────────────
  const evil: DecryptedEmployee[] = [
    {
      subdomain: "evil,bad",
      firstName: 'X"Y',
      lastName: "Z\nNew",
      email: null,
      contactEmail: null,
      locale: null,
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
      note: 'note,with"all\nshenanigans',
      noteDecryptError: false,
    },
  ];
  const evilCsv = buildEmployeesCsv(evil);
  // Parse: skal kunne re-split etter newlines uten å miste data
  assert(
    evilCsv.includes('"evil,bad"') && evilCsv.includes('"X""Y"'),
    "CSV-escaping motstår komma + quote + newline-injection",
  );

  // ─── Summary ────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
