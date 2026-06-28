/**
 * Ko | Do · Vault — v4.3 Iter 1 — TenantRecord (sentral platform-database)
 *
 * Per Spec §3 + D-039. IKKE zero-knowledge — server må kunne se kontaktinfo,
 * lisensstatus, fakturadata. Lagres som AES-256-GCM-kryptert blob i sentral
 * Upstash for defense-in-depth (krever både CENTRAL_KV_REST_API_TOKEN og
 * CENTRAL_ENCRYPTION_KEY for å lese data).
 */

export type CustomerType = "b2c" | "b2b";
export type CreatedBy = "self" | "admin" | "invite";
/**
 * Plan-enum.
 * - `trial` / `monthly` / `yearly` brukes for B2C (én sub per kunde, 129/1238 kr)
 * - `b2b_semiannual` / `b2b_yearly` brukes for B2B parent-tenant (Iter 20.4 ·
 *   2026-06-26 · per-seat-pris, manuell faktura via Stripe Dashboard).
 *   - Halvår: 87 kr/seat × 6 = 522 kr/seat per 6 mnd
 *   - Helår:  87 kr/seat × 12 = 1 044 kr/seat per år
 *   Child-tenants under en B2B parent har ikke egen Stripe-subscription —
 *   deres lifecycle styres av parent (cascade lock/unlock).
 * - `free` er evigvarende test-kontoer (D-069).
 */
export type Plan =
  | "trial"
  | "monthly"
  | "yearly"
  | "b2b_semiannual"
  | "b2b_yearly"
  | "free";
export type TenantStatus =
  | "active"
  | "trial"
  | "locked"
  | "suspended" // Iter 20.1 — am-admin har midlertidig blokkert login for denne ansatt-tenanten. Data bevares, vault-unlock feiler (sentral lookup per blokker-svar 5=a, 2026-06-26).
  | "cancelled"
  | "deleted"
  | "pending"
  | "provisioning_failed"
  | "invoice_failed";

/**
 * Strukturert provisjonerings-event (D-065 · 2026-06-04).
 * Append-only logg per tenant — lar Mike spore eksakt hva som skjedde,
 * når, og hvilke feilmeldinger som kom fra eksterne APIer. Vises som
 * Live JSON-panel i TenantViewer (D-065).
 */
export type ProvisioningStage =
  | "upstash_create"
  | "vercel_create"
  | "vercel_env"
  | "vercel_redeploy"
  | "subdomain_attach"
  | "vault_live"
  | "welcome_email_sent"
  | "telegram_sent"
  | "admin_override"
  | "status_change"
  | "invite_sent"
  | "invite_accepted"
  | "tenant_deleted"
  | "tenant_suspended"
  | "tenant_unsuspended"
  | "org_admin_created"
  | "org_admin_suspended"
  | "org_admin_deleted"
  | "am_admin_mpw_setup"
  | "am_admin_mpw_reset"
  | "invite_mail_sent"
  | "stripe_customer_sync";

export type ProvisioningEventStatus = "ok" | "failed" | "retried" | "skipped";

export type ProvisioningEvent = {
  timestamp: string; // ISO 8601 UTC
  stage: ProvisioningStage;
  status: ProvisioningEventStatus;
  detail?: string;
};

export type EmailPreferences = {
  transactional: true; // alltid true — kan ikke skrus av
  lifecycle: boolean;
};

export type TenantRecord = {
  // ═══ IDENTIFIKASJON ═══
  subdomain: string;
  customerType: CustomerType;

  // ═══ B2C KONTAKT ═══
  // Per D-044 + D-051: navn er valgfri men ALLTID initialisert som null
  firstName: string | null;
  lastName: string | null;
  email: string;

  // ═══ B2B — FIRMA INFO ═══
  companyName: string | null;
  orgNumber: string | null;
  vatNumber: string | null;
  companyStreet: string | null;
  companyPostalCode: string | null;
  companyCity: string | null;
  companyCountry: string | null;

  // ═══ B2B — KONTAKTPERSON ═══
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  // ═══ B2B — FAKTURA ═══
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  billingEmail: string | null;
  billingReference: string | null;

  // ═══ B2B — LISENSER ═══
  adminSubdomain: string | null;
  tenantPrefix: string | null;
  maxLicenses: number | null;
  /**
   * D-111 (Mike 2026-06-29): activeLicenses er IKKE LENGER lagret i sentral
   * storage — det inkrementerte ved invite/accept men ble aldri dekrementert
   * ved delete-tenant → drift over tid. Beregnes nå LIVE via
   * `countLiveActiveLicenses(prefix, allTenants)` i seat-counter.ts.
   * Feltet beholdes som OPTIONAL response-only (samme mønster som
   * `pendingInvitesCount` under) — API-rutene populerer det, men det
   * skal ALDRI skrives tilbake til Upstash.
   */
  activeLicenses?: number;
  parentTenant: string | null;
  /**
   * D-103 (Mike 2026-06-28): Aggregert antall aktive pending-invites for
   * B2B-parents. Settes IKKE i sentral storage — beregnes på-flua i
   * `GET /api/admin/tenants` for parent-rader. Per D-078 er kun aggregerte
   * tall lov for Super-admin (ingen PII).
   */
  pendingInvitesCount?: number;

  // ═══ PLAN ═══
  plan: Plan;
  status: TenantStatus;

  // ═══ E-POST PREFERANSER ═══
  emailPreferences: EmailPreferences;

  // ═══ DATOER (ISO 8601 UTC) ═══
  createdAt: string;
  trialEndsAt: string;
  lockedAt: string | null;
  cancelledAt: string | null;
  deletedAt: string | null;
  /**
   * Iter 20.3 (2026-06-26): for ansatt-tenants som er suspendert av am-admin.
   * Settes når status → "suspended", nulles ved unsuspend. Data bevares,
   * vault-pod blokkerer unlock så lenge feltet ikke er null (eller status er
   * "suspended" — pod-en bruker `/api/tenant/status`-lookup).
   */
  suspendedAt: string | null;
  /**
   * Iter 12 (D-049 · 2026-06-05): for tenants som har valgt betalt plan
   * og er midt i Stripe Checkout-flyten (status="pending"). Hvis bruker
   * ikke fullfører innen 30 min etter /api/register/paid, kan en cleanup-
   * cron rydde tenant + Stripe customer. null for alle andre statuser.
   */
  pendingExpiresAt: string | null;
  /**
   * Iter 19.6 (2026-06-13): true når bruker har bedt om kansellering i
   * Stripe Customer Portal med "cancel at period end" (default-modus).
   * Abonnementet er fortsatt `status="active"` til perioden faktisk
   * utløper, da kommer `customer.subscription.deleted` og status flippes
   * til "cancelled". Vises i Settings-UI som "Aktiv frem til <dato>".
   */
  cancelAtPeriodEnd: boolean;
  /**
   * Iter 19.6: ISO-timestamp for når den kansellerte perioden faktisk
   * utløper (Stripe `subscription.cancel_at`). null hvis ikke kansellert
   * eller ved umiddelbar kansellering.
   */
  cancelEffectiveAt: string | null;

  // ═══ STRIPE ═══ (D-049: just-in-time — null inntil bruker konverterer)
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeInvoiceId: string | null;

  // ═══ B2B FAKTURERING ═══ (Iter 20.4 · 2026-06-26)
  /**
   * Cached fra Stripe `subscription.current_period_end` ved `invoice.paid` /
   * `subscription.created`-webhook. Brukes av lifecycle-cron for å avgjøre
   * grace-status uten Stripe API-rundtur. ISO 8601 UTC. null før første
   * faktura er betalt (eller for B2C / child-tenants som ikke har egen
   * subscription). Per blokker-svar 3=C: Stripe er sannhet, vi cacher.
   */
  nextBillingDate: string | null;
  /**
   * Settes på B2B child-tenant når parent er cascade-låst pga utløpt grace
   * (parent.nextBillingDate + 7 dager passert uten betaling). Status flippes
   * til "locked" samtidig. Når parent betaler igjen (`invoice.paid`-webhook),
   * cascade-unlock'er vi alle children med dette feltet satt og resetter
   * status til "active". null på alle andre tenants.
   */
  parentLockedAt: string | null;

  // ═══ CONFIG / INFRASTRUKTUR ═══
  configGenerated: boolean;
  vercelProjectId: string | null;
  upstashDatabaseId: string | null;
  /**
   * D-066 (2026-06-04): vault er "live" når vercel-deployment har state READY.
   * Settes true av pollDeploymentStatus etter vellykket build.
   */
  vaultLive: boolean;
  vaultLiveAt: string | null;

  // ═══ METADATA ═══
  createdBy: CreatedBy;
  locale: "no" | "sv" | "da" | "en" | null;
  notes: string | null;

  // ═══ PROVISJONERINGS-LOGG ═══ (D-065 · 2026-06-04)
  // Strukturert append-only logg av alle provisjonerings-hendelser.
  // Eksisterende tenants får automatisk [] ved første load (se tenant-store).
  provisioningLog: ProvisioningEvent[];

  // ═══ VARSLING (D-068 · 2026-06-04 · Iter 10) ═══
  // Idempotensesjekk — velkomstmail sendes maks én gang per tenant.
  welcomeEmailSentAt: string | null;

  // ═══ ITER 17 LIFECYCLE-VARSLER (2026-06-13) ═══
  /**
   * Idempotensesjekk per varseltype for "T-N dager før sletting"-eposter.
   * Cron-en (Iter 17) sender T-7, T-3, T-1 (dag 21, 25, 27 etter lock).
   * Hver verdi er ISO-timestamp for når akkurat den ble sendt — null
   * betyr "ennå ikke sendt". Etter sending settes feltet og må ikke
   * skrives på nytt, selv om cron tilfeldigvis kjører to ganger i samme
   * vindu.
   */
  lifecycleWarningsSentAt: {
    t7: string | null;
    t3: string | null;
    t1: string | null;
  };
  /**
   * Iter 17 full mail-pakke (2026-06-13): T-5 trial-reminder, sendt fra
   * cron når status=trial og daysUntilTrialEnd === 5. Idempotent.
   */
  trialReminderT5SentAt: string | null;
  /**
   * Iter 17 full mail-pakke: bekreftelse på at kontoen ble låst. Settes
   * av cron (trial → locked) eller webhook (subscription.deleted → locked).
   * Felles for spor A og spor B — én send per tenant per lock-event.
   */
  lockedNotificationSentAt: string | null;
  /**
   * Iter 17 full mail-pakke: "kontoen er nå slettet"-bekreftelse, sendt
   * av cron RETT FØR `deleteTenant()` fjerner tenant-recorden. Lagres på
   * recorden så vi kan revisor-spore at brukeren faktisk fikk varselet
   * (selv om feltet forsvinner med recorden ved sletting).
   */
  deletedNotificationSentAt: string | null;
};

/**
 * Minimal input for å opprette en B2C trial-record manuelt via admin-viewer.
 * Det meste utledes/defaultes — full B2B-input kommer i Iter 20.
 */
export type CreateTenantInput = {
  subdomain: string;
  email: string;
  customerType: CustomerType;
  firstName?: string;
  lastName?: string;
  plan?: Plan;
  status?: TenantStatus;
  // Per D-052: admin kan overstyre 30-dagers default (1-365). Selvbetjent
  // registrering bruker default. Validering i route-handler.
  trialDays?: number;
  lifecycleEmails?: boolean;
  locale?: "no" | "sv" | "da" | "en";
  notes?: string;
  // B2B-felter (valgfrie — full validering i Iter 20)
  companyName?: string;
  orgNumber?: string;
  vatNumber?: string;
  companyStreet?: string;
  companyPostalCode?: string;
  companyCity?: string;
  companyCountry?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  billingStreet?: string;
  billingPostalCode?: string;
  billingCity?: string;
  billingCountry?: string;
  billingEmail?: string;
  billingReference?: string;
  adminSubdomain?: string;
  tenantPrefix?: string;
  maxLicenses?: number;
};

import defaultClientConfig from "../../public/clients/default.json";

/**
 * Eneste sannhetskilde for default trial-lengde:
 * `public/clients/default.json` → `pricing.trialDays`.
 *
 * Importert direkte (sync) så denne sync-funksjonen kan bruke den uten å
 * gå via Upstash. Hvis Mike endrer default.json → ny build → ny default.
 * Validering: 0-365 (0 = ingen trial, fakturer umiddelbart).
 */
function getDefaultTrialDays(): number {
  const raw = defaultClientConfig.pricing?.trialDays;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const v = Math.floor(raw);
  if (v < 0 || v > 365) return 0;
  return v;
}

/**
 * B2B trial-default (Iter 20.4 · 2026-06-26). B2B-organisasjoner får 45
 * dager gratis prøveperiode — lengre enn B2C fordi onboarding av flere
 * ansatte tar tid. Overstyres av `input.trialDays` hvis super-admin angir
 * eksplisitt verdi i Mikes admin-flyt.
 */
export const B2B_DEFAULT_TRIAL_DAYS = 45;

/**
 * Bygg en ny TenantRecord med ALLE felter eksplisitt initialisert (D-051).
 * Tomme felter får `null`, aldri `undefined`. Det gir konsistent struktur,
 * forutsigbar livssyklus-logikk, og forenkler UI-filtrering.
 */
export function buildTenantRecord(
  input: CreateTenantInput,
  createdBy: CreatedBy,
): TenantRecord {
  const now = new Date();
  // Validering: 0-365 (0 = ingen trial). Caller kan eksplisitt sette
  // input.trialDays for å overstyre default. B2C → default.json (30d),
  // B2B → 45d (Iter 20.4 · 2026-06-26).
  const trialDays =
    typeof input.trialDays === "number" &&
    input.trialDays >= 0 &&
    input.trialDays <= 365
      ? input.trialDays
      : input.customerType === "b2b"
        ? B2B_DEFAULT_TRIAL_DAYS
        : getDefaultTrialDays();
  const trialEnd = new Date(now);
  trialEnd.setUTCDate(trialEnd.getUTCDate() + trialDays);

  // Helper: tomme strenger → null, ellers verdien
  const s = (v: string | undefined): string | null =>
    v && v.trim() !== "" ? v : null;
  const n = (v: number | undefined): number | null =>
    typeof v === "number" ? v : null;

  return {
    subdomain: input.subdomain.toLowerCase(),
    customerType: input.customerType,
    firstName: s(input.firstName),
    lastName: s(input.lastName),
    email: input.email.toLowerCase(),

    // B2B firma
    companyName: s(input.companyName),
    orgNumber: s(input.orgNumber),
    vatNumber: s(input.vatNumber),
    companyStreet: s(input.companyStreet),
    companyPostalCode: s(input.companyPostalCode),
    companyCity: s(input.companyCity),
    companyCountry: s(input.companyCountry),

    // B2B kontakt
    contactName: s(input.contactName),
    contactEmail: input.contactEmail
      ? input.contactEmail.toLowerCase()
      : null,
    contactPhone: s(input.contactPhone),

    // B2B faktura
    billingStreet: s(input.billingStreet),
    billingPostalCode: s(input.billingPostalCode),
    billingCity: s(input.billingCity),
    billingCountry: s(input.billingCountry),
    billingEmail: input.billingEmail
      ? input.billingEmail.toLowerCase()
      : null,
    billingReference: s(input.billingReference),

    // B2B lisens
    adminSubdomain: s(input.adminSubdomain),
    tenantPrefix: s(input.tenantPrefix),
    maxLicenses: n(input.maxLicenses),
    // D-111: activeLicenses fjernet — beregnes live via seat-counter.ts
    parentTenant: null,

    plan: input.plan ?? "trial",
    status: input.status ?? "trial",
    emailPreferences: {
      transactional: true,
      lifecycle: input.lifecycleEmails ?? true,
    },

    createdAt: now.toISOString(),
    trialEndsAt: trialEnd.toISOString(),
    lockedAt: null,
    cancelledAt: null,
    deletedAt: null,
    suspendedAt: null,
    pendingExpiresAt: null,
    cancelAtPeriodEnd: false,
    cancelEffectiveAt: null,

    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeInvoiceId: null,

    // Iter 20.4: B2B fakturerings-cache. null inntil første invoice.paid.
    nextBillingDate: null,
    parentLockedAt: null,

    configGenerated: false,
    vercelProjectId: null,
    upstashDatabaseId: null,
    vaultLive: false,
    vaultLiveAt: null,
    welcomeEmailSentAt: null,
    lifecycleWarningsSentAt: { t7: null, t3: null, t1: null },
    trialReminderT5SentAt: null,
    lockedNotificationSentAt: null,
    deletedNotificationSentAt: null,

    createdBy,
    locale: input.locale ?? null,
    notes: s(input.notes),
    provisioningLog: [],
  };
}
