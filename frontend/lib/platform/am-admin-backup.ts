/**
 * Ko | Do · Vault — Iter 20.5d (2026-06-26) — am-admin backup-eksport
 *
 * Klient-side helpers for å bygge CSV- og JSON-backup-filer fra
 * `/api/am-admin/backup/data` + dekryptere adminNotes-envelopene med
 * MPW-nøkkelen.
 *
 * Per user-svar 1=B (2026-06-26): am-admin-spesifikt CSV-format (IKKE
 * Bitwarden) — dette er en org-backup, ikke passord-eksport.
 *
 * Per user-svar 2=B: filnavn `<prefix>-employees-backup-YYYY-MM-DD-HHMM`.
 *
 * D-113 (Mike 2026-06-29): Backup-strukturen utvidet med ADMIN- og
 * INVITE-rader. CSV har nå én fane med "type"-kolonne (admin/employee/invite).
 * JSON har separate `admin` og `invites`-felter ved siden av `employees`.
 */
import {
  decryptWithMpwKey,
  type MpwEnvelope,
} from "./am-admin-mpw";

export type BackupEmployee = {
  subdomain: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactEmail: string | null;
  locale: string | null;
  status: string;
  createdAt: string;
  noteEnvelope: MpwEnvelope | null;
};

export type BackupInvite = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  locale: string | null;
  status: string; // "pending"
  createdAt: string;
};

export type BackupAdmin = {
  subdomain: string;
  email: string | null;
  contactEmail: string | null;
  locale: string | null;
  status: string;
  createdAt: string;
};

export type BackupLicense = {
  parentSubdomain: string | null;
  plan: string | null;
  maxLicenses: number | null;
  activeLicenses: number | null;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  status: string | null;
};

export type BackupData = {
  generatedAt: string;
  prefix: string;
  license: BackupLicense;
  admin: BackupAdmin | null;
  employeeCount: number;
  inviteCount: number;
  notedCount: number;
  employees: BackupEmployee[];
  invites: BackupInvite[];
};

export type DecryptedEmployee = Omit<BackupEmployee, "noteEnvelope"> & {
  note: string | null;
  noteDecryptError: boolean;
  /**
   * D-109 (2026-06-28, Mike): hvis backup tas mens MPW er LÅST eller IKKE
   * satt, bevarer vi notatets envelope som JSON-streng. Da kan brukeren
   * restore senere med samme MPW. Hvis MPW var ulåst: dette feltet er null
   * og `note` har klartekst.
   */
  noteEnvelopeJson?: string | null;
};

/**
 * D-109 (Mike 2026-06-28): Backup når MPW er låst eller ikke satt — bevarer
 * envelope-formatet uten å dekryptere. Brukes når `decryptEmployeeNotes`
 * IKKE kan kjøres (ingen MPW-key tilgjengelig).
 */
export function mapEmployeesPreservingEnvelope(
  employees: BackupEmployee[],
): DecryptedEmployee[] {
  return employees.map((emp) => ({
    subdomain: emp.subdomain,
    firstName: emp.firstName,
    lastName: emp.lastName,
    email: emp.email,
    contactEmail: emp.contactEmail,
    locale: emp.locale,
    status: emp.status,
    createdAt: emp.createdAt,
    note: null,
    noteDecryptError: false,
    noteEnvelopeJson: emp.noteEnvelope
      ? JSON.stringify(emp.noteEnvelope)
      : null,
  }));
}

/**
 * Dekrypterer alle adminNotes-envelopes med en derivet MPW-nøkkel.
 * Forsetter selv om enkeltdekryptering feiler (markeres med
 * `noteDecryptError: true` så CSV/JSON viser at noe var korrupt).
 */
export async function decryptEmployeeNotes(
  employees: BackupEmployee[],
  key: CryptoKey,
): Promise<DecryptedEmployee[]> {
  return Promise.all(
    employees.map(async (emp) => {
      if (!emp.noteEnvelope) {
        return {
          subdomain: emp.subdomain,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          contactEmail: emp.contactEmail,
          locale: emp.locale,
          status: emp.status,
          createdAt: emp.createdAt,
          note: null,
          noteDecryptError: false,
        };
      }
      try {
        const note = await decryptWithMpwKey(emp.noteEnvelope, key);
        return {
          subdomain: emp.subdomain,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          contactEmail: emp.contactEmail,
          locale: emp.locale,
          status: emp.status,
          createdAt: emp.createdAt,
          note,
          noteDecryptError: false,
        };
      } catch {
        return {
          subdomain: emp.subdomain,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          contactEmail: emp.contactEmail,
          locale: emp.locale,
          status: emp.status,
          createdAt: emp.createdAt,
          note: null,
          noteDecryptError: true,
        };
      }
    }),
  );
}

// ─── CSV-bygging (RFC 4180-kompatibel) ─────────────────────────────────

/**
 * Escape en celle for CSV. RFC 4180 + OWASP CSV formula-injection
 * mitigering:
 *   - " escapes som ""
 *   - Hvis cellen inneholder ", komma eller newline → wrap i ""
 *   - Hvis cellen starter med =, +, -, @, TAB eller CR → prefiks med
 *     apostrof (') for å hindre Excel/Sheets fra å eksekvere som formel
 *   - null/undefined → tom streng
 *
 * Apostrof-prefiks er OWASP-anbefalt mønster: Excel viser apostrofen
 * IKKE i cellen (skjult prefiks-marker), så am-admin ser fortsatt
 * notatet rent.
 */
export function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // OWASP CSV-injection-mitigering. Sjekkes FØR quote-wrapping.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// D-113 (Mike 2026-06-29): "type"-kolonne skiller admin/employee/invite-rader.
const CSV_COLUMNS = [
  "type",
  "subdomain",
  "first_name",
  "last_name",
  "email",
  "contact_email",
  "locale",
  "status",
  "created_at",
  "admin_note",
  "note_status",
] as const;

function noteStatusOf(e: DecryptedEmployee): string {
  // D-109 (Mike 2026-06-28): note_status fire verdier:
  //   "ok"             — note dekryptert (klartekst i note-kolonnen)
  //   "encrypted"      — note bevart som envelope-JSON (MPW låst/usatt)
  //   "decrypt_error"  — dekryptering feilet (korrupt envelope eller feil MPW)
  //   "none"           — ingen note registrert for ansatt
  if (e.noteDecryptError) return "decrypt_error";
  if (e.note !== null) return "ok";
  if (e.noteEnvelopeJson) return "encrypted";
  return "none";
}

/**
 * Bygg en CSV-streng med ALLE 3 rad-typer (admin + employees + invites) i
 * samme fane. Bruker `\r\n` per RFC 4180. Rad-typen kjennes på "type"-
 * kolonnen — strict-CSV-parsere kan filtrere på den.
 */
export function buildBackupCsv(
  admin: BackupAdmin | null,
  employees: DecryptedEmployee[],
  invites: BackupInvite[],
): string {
  const header = CSV_COLUMNS.join(",");
  const rows: string[] = [];

  // ADMIN-rad (én, hvis parent-tenanten finnes)
  if (admin) {
    rows.push(
      [
        csvEscape("admin"),
        csvEscape(admin.subdomain),
        csvEscape(null), // first_name
        csvEscape(null), // last_name
        csvEscape(admin.email),
        csvEscape(admin.contactEmail),
        csvEscape(admin.locale),
        csvEscape(admin.status),
        csvEscape(admin.createdAt),
        csvEscape(null), // admin_note
        csvEscape("none"), // note_status
      ].join(","),
    );
  }

  // EMPLOYEE-rader (children)
  for (const e of employees) {
    const status = noteStatusOf(e);
    // Når status === "encrypted", skriv envelope-JSON i note-kolonnen så
    // restore er mulig fra CSV-en alene.
    const noteCell = e.note !== null ? e.note : (e.noteEnvelopeJson ?? null);
    rows.push(
      [
        csvEscape("employee"),
        csvEscape(e.subdomain),
        csvEscape(e.firstName),
        csvEscape(e.lastName),
        csvEscape(e.email),
        csvEscape(e.contactEmail),
        csvEscape(e.locale),
        csvEscape(e.status),
        csvEscape(e.createdAt),
        csvEscape(noteCell),
        csvEscape(status),
      ].join(","),
    );
  }

  // INVITE-rader (pending, ikke utløpt)
  for (const inv of invites) {
    rows.push(
      [
        csvEscape("invite"),
        csvEscape(null), // subdomain (ikke tildelt ennå)
        csvEscape(inv.firstName),
        csvEscape(inv.lastName),
        csvEscape(inv.email),
        csvEscape(null), // contact_email (ikke aktuelt for invites)
        csvEscape(inv.locale),
        csvEscape(inv.status),
        csvEscape(inv.createdAt),
        csvEscape(null), // admin_note (ikke aktuelt for invites)
        csvEscape("none"), // note_status
      ].join(","),
    );
  }

  return [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * @deprecated D-113: bruk buildBackupCsv. Beholdt for bakoverkompat.
 */
export function buildEmployeesCsv(employees: DecryptedEmployee[]): string {
  return buildBackupCsv(null, employees, []);
}

// ─── JSON-bygging ──────────────────────────────────────────────────────

export type BackupJson = {
  format: "kodovault-am-admin-backup-v2";
  generatedAt: string;
  prefix: string;
  license: BackupLicense;
  admin: BackupAdmin | null;
  employeeCount: number;
  inviteCount: number;
  notedCount: number;
  decryptErrorCount: number;
  employees: DecryptedEmployee[];
  invites: BackupInvite[];
};

export function buildBackupJson(
  data: BackupData,
  decrypted: DecryptedEmployee[],
): BackupJson {
  return {
    format: "kodovault-am-admin-backup-v2",
    generatedAt: data.generatedAt,
    prefix: data.prefix,
    license: data.license,
    admin: data.admin,
    employeeCount: data.employeeCount,
    inviteCount: data.inviteCount,
    notedCount: data.notedCount,
    decryptErrorCount: decrypted.filter((e) => e.noteDecryptError).length,
    employees: decrypted,
    invites: data.invites,
  };
}

// ─── Filnavn ───────────────────────────────────────────────────────────

/**
 * Filnavn-mønster: `<prefix>-employees-backup-YYYY-MM-DD-HHMMSS.<ext>`
 * Per user-svar 2=B (2026-06-26): timestamp inkludert for å unngå
 * overskrivingskonflikter ved flere backuper samme dag. Sekund-
 * presisjon hindrer kollisjon ved rask dobbeltklikk (iter-17 LOW-fix).
 */
export function buildBackupFilename(
  prefix: string,
  ext: "csv" | "json",
  now: Date = new Date(),
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${prefix}-employees-backup-${yyyy}-${mm}-${dd}-${hh}${mi}${ss}.${ext}`;
}
