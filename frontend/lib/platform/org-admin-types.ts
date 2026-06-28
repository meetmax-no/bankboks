/**
 * Ko | Do · Vault — Iter 20.1 — OrgAdmin-datamodell (B2B am-admin)
 *
 * Per D-078 + D-079 (2026-06-26):
 *   - OrgAdmin er en B2B-bedrifts admin-konto for `<prefix>-admin.kodovault.no`-flyten.
 *   - Lagres på sentral Upstash under `org-admin:<tenantPrefix>:admin:<id>`
 *     som AES-256-GCM-kryptert blob (samme defense-in-depth som TenantRecord).
 *   - `passwordHash` er bcrypt — server MÅ kunne verifisere ved login.
 *   - MPW (D-079) krypterer KUN org-interne data (backup-eksport + admin-notater
 *     i `adminNotes`-felt på TenantRecord, ikke OrgAdmin selv).
 *   - "Minst 1 super-admin per org"-invariant håndheves i store.
 */

export type OrgAdminRole = "super-admin" | "admin";

export type OrgAdmin = {
  /** UUID v4 — primær-ID for org-admin-objektet. */
  id: string;
  /** Hvilken B2B-parent denne admin tilhører (tenantPrefix på parent). */
  tenantPrefix: string;
  /** Fornavn — vises i UI. */
  firstName: string;
  /** Etternavn — vises i UI. */
  lastName: string;
  /** E-post — også login-identifikator. Lowercase, unik per tenantPrefix. */
  email: string;
  /** bcrypt $2b$12$… — server-side verifisering ved login. */
  passwordHash: string;
  /**
   * super-admin: kan administrere admin-brukere + ansatte
   * admin: kan kun administrere ansatte
   */
  role: OrgAdminRole;
  /** ISO 8601 UTC — opprettet-tidspunkt. */
  createdAt: string;
  /**
   * Hvem opprettet kontoen.
   *   - "mike@admin" — første super-admin opprettet av Mike i super-admin-konsoll
   *   - "<email>" — opprettet av en eksisterende org-super-admin
   */
  createdBy: string;
  /**
   * Soft-suspendering. Hvis true blokkeres login (sjekkes i auth-flyt
   * etter passordverifisering). Reverserbart — data bevares.
   */
  suspended: boolean;
  /**
   * Iter 20.9 (D-081, 2026-06-27): tvinger admin til å bytte passord ved
   * neste innlogging. Settes til `true` ved opprettelse (Mike har valgt
   * midlertidig passord). Settes til `false` etter vellykket bytte via
   * `/api/am-admin/auth/change-password`.
   *
   * Login-endepunktet returnerer flagget så UI kan redirecte til
   * `/platform/am-admin/change-password` før dashbordet vises.
   */
  forcePasswordReset: boolean;
  /**
   * Iter 20.9 (D-086, 2026-06-27): Konsoll → Innstillinger → Sikkerhet.
   * Unix-sekunder. Sessions med `iat < sessionsInvalidatedAt` avvises av
   * `requireAmAdmin`. Bumps når brukeren klikker "Logg ut alle enheter".
   * Hvis 0/null: ingen invalidering.
   */
  sessionsInvalidatedAt?: number;
  /**
   * Iter 20.9 (D-086, 2026-06-27): tidspunkt for siste vellykkede innlogging
   * (ISO 8601 UTC). Vises i Sikkerhet-fanen. Settes av login-endepunktet.
   */
  lastLoginAt?: string;
  /**
   * Iter 20.9 (D-095, 2026-06-28): snapshot-FK mot parent-TenantRecord.
   * Settes til `parent.createdAt` ved opprettelse. Brukes for å detektere
   * orphan via EKSAKT match (parent.createdAt === child.parentTenantCreatedAt)
   * istedenfor heuristikk på createdAt-ordning. null = legacy-record fra
   * før D-095 ble deploy'et (vil fylles av migrasjons-script).
   */
  parentTenantCreatedAt?: string | null;
  /**
   * D-107 (2026-06-28, Mike): markerer den FØRSTE super-adminen opprettet
   * ved B2B-onboarding. Brukes til å vise "opprinnelig kontaktperson" i
   * Lisens & B2B-fanen i super-admin TenantViewer.
   */
  isFirstSuperAdmin?: boolean;
};

/**
 * Input for å opprette en ny OrgAdmin. Tar plaintext-passord — store
 * bcrypt-hasher før persistering. `id`, `createdAt`, `suspended` settes
 * automatisk.
 */
export type CreateOrgAdminInput = {
  tenantPrefix: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: OrgAdminRole;
  createdBy: string;
  /**
   * D-095 (2026-06-28): snapshot av parent.createdAt for FK-link.
   * Hvis utelatt lagres `null` og recorden behandles som legacy ved
   * orphan-deteksjon (årsak `link_missing`).
   */
  parentTenantCreatedAt?: string | null;
};

/**
 * Returner et serialiserbart "public view" av en OrgAdmin uten passwordHash.
 * Brukes når vi sender admin-data tilbake til UI eller logger til
 * provisioningLog. Sikrer at hashen aldri lekker ut av server-grensen.
 */
export type OrgAdminPublic = Omit<OrgAdmin, "passwordHash">;

export function toOrgAdminPublic(admin: OrgAdmin): OrgAdminPublic {
  const { passwordHash: _passwordHash, ...rest } = admin;
  void _passwordHash;
  return rest;
}

/**
 * Feilkoder fra org-admin-store. Brukes både som return-verdier og som
 * stable strings til UI-mapping.
 */
export const OrgAdminError = {
  NotFound: "org_admin_not_found",
  EmailAlreadyExists: "org_admin_email_exists",
  LastSuperAdmin: "org_admin_last_super_admin",
  InvalidTenantPrefix: "org_admin_invalid_tenant_prefix",
  InvalidEmail: "org_admin_invalid_email",
  InvalidRole: "org_admin_invalid_role",
  WeakPassword: "org_admin_weak_password",
} as const;

export type OrgAdminErrorCode = (typeof OrgAdminError)[keyof typeof OrgAdminError];
