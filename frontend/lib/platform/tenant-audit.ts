/**
 * Ko | Do · Vault — v4.3 Iter 7.5 — Admin audit-log (D-054)
 *
 * Sammenligner gammel og ny TenantRecord, bygger audit-linjer for endringer,
 * og appender til `notes`. Selve `notes`-endringer logges IKKE (forhindrer
 * rekursjon: hver gang vi appender en linje ville notes-feltet være endret
 * og logges på nytt evig).
 *
 * Format: "[2026-06-02T14:30:00Z] Admin: <felt> endret fra <gammel> → <ny>"
 */
import type { TenantRecord } from "./tenant-types";

// Felter vi sporer i audit-log. notes er bevisst utelatt (D-054).
// Iter 19.9.9 (2026-06-25): identitets-felter lagt til så admin-redigering
// av firstName/lastName/email/locale/createdBy logges i provisioningLog.
const AUDIT_FIELDS: readonly (keyof TenantRecord)[] = [
  "status",
  "plan",
  "trialEndsAt",
  "lockedAt",
  "cancelledAt",
  "deletedAt",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "stripeInvoiceId",
  "vercelProjectId",
  "upstashDatabaseId",
  // Iter 19.9.9 — redigerbare identitets-felter i admin TenantViewer
  "firstName",
  "lastName",
  "email",
  "locale",
  "createdBy",
  // D-104 (2026-06-28) — redigerbare B2B firma-/kontakt-/faktura-felter
  // (Oversikt-fanen for B2B-tenants). Hver endring logges i provisioningLog
  // og auto-synces til Stripe Customer hvis stripeCustomerId er satt.
  "companyName",
  "orgNumber",
  // D-112: vatNumber fjernet — utledes live fra orgNumber + companyCountry
  "companyStreet",
  "companyPostalCode",
  "companyCity",
  "companyCountry",
  "contactName",
  "contactEmail",
  "contactPhone",
  "billingStreet",
  "billingPostalCode",
  "billingCity",
  "billingCountry",
  "billingEmail",
  "billingReference",
];

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

/**
 * Bygg audit-linjer for endringer mellom `oldRecord` og `newRecord`.
 * Returnerer tom array hvis ingenting er endret.
 */
export function buildAuditLines(
  oldRecord: TenantRecord,
  newRecord: TenantRecord,
): string[] {
  const ts = new Date().toISOString();
  const lines: string[] = [];

  for (const field of AUDIT_FIELDS) {
    const before = oldRecord[field];
    const after = newRecord[field];
    if (before !== after) {
      lines.push(
        `[${ts}] Admin: ${String(field)} endret fra ${formatValue(before)} → ${formatValue(after)}`,
      );
    }
  }

  // emailPreferences.lifecycle er nested — sjekk eksplisitt
  if (
    oldRecord.emailPreferences.lifecycle !==
    newRecord.emailPreferences.lifecycle
  ) {
    lines.push(
      `[${ts}] Admin: lifecycle endret fra ${oldRecord.emailPreferences.lifecycle} → ${newRecord.emailPreferences.lifecycle}`,
    );
  }

  return lines;
}

/**
 * Append audit-linjer til notes-feltet. Eksisterende notes bevares.
 */
export function appendAuditToNotes(
  existingNotes: string | null,
  auditLines: string[],
): string | null {
  if (auditLines.length === 0) return existingNotes;
  const auditBlock = auditLines.join("\n");
  if (!existingNotes) return auditBlock;
  return `${existingNotes}\n${auditBlock}`;
}
