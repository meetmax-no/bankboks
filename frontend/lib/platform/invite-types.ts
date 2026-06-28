/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — Invitasjonslenke (D-056)
 *
 * Datamodell for InviteRecord. Mike (eller fremtidig am-admin i v4.4.1)
 * oppretter en invitasjonslenke for en ansatt. Ansatt klikker lenken,
 * fullfører skjemaet, og en ny TenantRecord opprettes automatisk under
 * parentTenant (B2B-prefiks).
 *
 * Per spec 2026-06-02. Lagres AES-256-GCM-kryptert i sentral Upstash —
 * inneholder e-post, så defense-in-depth gjelder her som for TenantRecord.
 */
export type InviteStatus = "pending" | "used" | "expired";

export type InviteRecord = {
  token: string;          // UUID v4 engangstoken
  subdomain: string;      // Forhåndsdefinert: "am-nils"
  parentTenant: string;   // tenantPrefix til parent B2B-tenant, f.eks. "am"
  email: string | null;   // Valgfri — forhåndsutfylt i skjema
  firstName: string | null;
  lastName: string | null;
  locale: "no" | "sv" | "da" | "en" | null;
  createdAt: string;      // ISO 8601 UTC
  expiresAt: string;      // createdAt + 7 dager
  usedAt: string | null;  // Settes når ansatt har opprettet vault
  status: InviteStatus;
  /**
   * Iter 7.6: kun "admin" (Mike). Iter 20.3 introduserer "am-admin"
   * for B2B-bedrifters egne admins som oppretter invitasjoner i sin org.
   */
  createdBy: "admin" | "am-admin";
  /**
   * Iter 20.3: timestamp (ISO 8601 UTC) for når invite-mail ble sendt via Resend.
   * Brukes som idempotens-flagg slik at samme invite ikke får dobbelt-mail.
   * null = mail enda ikke sendt (eller mail er deaktivert).
   */
  mailSentAt: string | null;
  /**
   * Iter 20.9 (D-095, 2026-06-28): snapshot-FK mot parent-TenantRecord.
   * Settes til `parent.createdAt` ved invite-opprettelse. Eksakt match
   * (parent.createdAt === child.parentTenantCreatedAt) erstatter
   * tidligere `<`-heuristikk på predates_parent. null = legacy-record
   * fra før D-095 ble deploy'et.
   */
  parentTenantCreatedAt?: string | null;
  /**
   * Iter 20.9 (D-101, Mike 2026-06-28): arkiv-flagg for child-vault.
   * Settes når child-tenanten (`subdomain`) slettes fra Super-admin
   * Konsoll ETTER at invite er konsumert. Verdi: ISO 8601 UTC timestamp
   * for sletting. Invite-recorden forblir (audit-historikk), men UI
   * markerer den som "Arkivert" i stedet for å skjule den eller flagge
   * som rød orphan. null/undefined = child finnes fortsatt eller invite
   * er ikke konsumert.
   */
  childDeletedAt?: string | null;
};

export type CreateInviteInput = {
  subdomain: string;
  parentTenant: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  locale?: "no" | "sv" | "da" | "en";
  /** Iter 20.3: hvem oppretter invitasjonen. Default "admin" (Mike). */
  createdBy?: "admin" | "am-admin";
  /**
   * D-095 (2026-06-28): snapshot av parent.createdAt for FK-link.
   * Null hvis utelatt (legacy fra før D-095).
   */
  parentTenantCreatedAt?: string | null;
};

export const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_SECONDS = INVITE_TTL_DAYS * 24 * 60 * 60;

/**
 * Bygg en ny InviteRecord. Token genereres med crypto.randomUUID() (RFC 4122 v4).
 */
export function buildInviteRecord(input: CreateInviteInput): InviteRecord {
  const now = new Date();
  const exp = new Date(now);
  exp.setUTCDate(exp.getUTCDate() + INVITE_TTL_DAYS);

  const s = (v: string | undefined): string | null =>
    v && v.trim() !== "" ? v.trim() : null;

  return {
    token: crypto.randomUUID(),
    subdomain: input.subdomain.toLowerCase().trim(),
    parentTenant: input.parentTenant.toLowerCase().trim(),
    email: input.email ? input.email.toLowerCase().trim() : null,
    firstName: s(input.firstName),
    lastName: s(input.lastName),
    locale: input.locale ?? null,
    createdAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    usedAt: null,
    status: "pending",
    createdBy: input.createdBy ?? "admin",
    mailSentAt: null,
    // D-095 (2026-06-28): snapshot-FK mot parent
    parentTenantCreatedAt: input.parentTenantCreatedAt ?? null,
  };
}

/**
 * Returnerer true hvis invitasjonen er gått ut på dato basert på `expiresAt`.
 * Brukes både ved validate (avvise ansatt) og av cron (markere som expired).
 */
export function isInviteExpired(
  record: Pick<InviteRecord, "expiresAt">,
  now: Date = new Date(),
): boolean {
  return new Date(record.expiresAt).getTime() <= now.getTime();
}
