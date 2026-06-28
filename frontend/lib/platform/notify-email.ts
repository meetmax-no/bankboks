/**
 * Ko | Do · Vault — v4.3 Iter 10 (D-068 · 2026-06-04)
 *
 * Velkomstmail via Resend. Idempotensesjekk på `welcomeEmailSentAt` —
 * sendes maks én gang per tenant.
 *
 * Aktiveringsregel (samme mønster som tannlege-per):
 *   - `RESEND_API_KEY` må være satt
 *   - `EMAIL_ENABLED=true` må være satt eksplisitt
 *   - `RESEND_FROM_EMAIL` styrer From-headeren (typisk `vault@kodovault.no`
 *     etter DNS-verifisering, ellers `onboarding@resend.dev` for testing)
 *
 * Mangler en av delene → returnerer `{ skipped: true }` uten å kaste.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import type { TenantRecord } from "./tenant-types";

const REPLY_TO = "support@kodovault.no";

/**
 * Placeholder for exit-survey-lenken i deleted-confirmation-mailen.
 * Mike erstatter URL'en når Google Form'en er publisert. Inntil da
 * peker den til en stub-side på kodovault.no — ufarlig 404 hvis bruker
 * klikker tidlig.
 */
const EXIT_SURVEY_URL = "https://tally.so/r/0QG5ZA";

export interface EmailResult {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  emailId?: string;
  error?: string;
}

/**
 * Sjekker om e-post-kanalen er konfigurert + eksplisitt aktivert.
 */
function isEmailEnabled(): { ok: true; apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const enabled = process.env.EMAIL_ENABLED === "true";
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !enabled || !from) return null;
  return { ok: true, apiKey, from };
}

/**
 * Last mal fra disk og bytt ut variabler. Inline-funksjon — vi cacher ikke
 * fordi serverless lambda-instanser uansett er kortlivede.
 */
async function loadTemplate(
  locale: Locale,
  vars: Record<string, string>,
  templateName:
    | "welcome"
    | "lifecycle-warning"
    | "trial-reminder-t5"
    | "locked-from-trial"
    | "locked-from-cancel"
    | "deleted-confirmation"
    | "invite"
    | "org-admin-welcome" = "welcome",
): Promise<string> {
  const filename = `${templateName}.${locale}.html`;
  const file = path.join(
    process.cwd(),
    "lib",
    "platform",
    "email-templates",
    filename,
  );
  let html = await fs.readFile(file, "utf8");
  for (const [key, val] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, val);
  }
  return html;
}

/**
 * Locale-typen brukes både her og av template-loader. Alle fire språk er
 * førsteklasses — det er ingen "fallback til norsk" lenger. Tenant.locale
 * settes eksplisitt ved registrering (Iter 19.9).
 */
type Locale = "no" | "sv" | "da" | "en";

function resolveLocale(tenant: TenantRecord): Locale {
  switch (tenant.locale) {
    case "en":
      return "en";
    case "sv":
      return "sv";
    case "da":
      return "da";
    default:
      // Hvis tenant.locale er null/undefined/ugyldig → norsk (siste forsvar).
      // Iter 19.9 gjør locale obligatorisk ved registrering → denne grenen
      // skal ikke kunne trigges av nye tenants etter rollout.
      return "no";
  }
}

/**
 * Send velkomstmail. Idempotent — sjekker `welcomeEmailSentAt`.
 * Mottakerens e-post hentes fra `tenant.contactEmail ?? tenant.email`.
 *
 * Returnerer alltid en EmailResult; kaster aldri.
 */
export async function sendWelcomeEmail(
  tenant: TenantRecord,
): Promise<EmailResult> {
  if (tenant.welcomeEmailSentAt) {
    return { skipped: true, reason: "already_sent" };
  }
  const to = tenant.contactEmail ?? tenant.email;
  if (!to) {
    return { skipped: true, reason: "missing_recipient_email" };
  }
  const enabled = isEmailEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason: "email_disabled (RESEND_API_KEY / EMAIL_ENABLED / RESEND_FROM_EMAIL mangler)",
    };
  }
  try {
    const locale = resolveLocale(tenant);
    const firstName = (tenant.firstName ?? "").trim() || fallbackName(locale);
    const html = await loadTemplate(locale, {
      firstName,
      subdomain: tenant.subdomain,
    });
    const subject = welcomeSubject(locale);

    const resend = new Resend(enabled.apiKey);
    const result = await resend.emails.send({
      from: enabled.from,
      to: [to],
      subject,
      html,
      replyTo: REPLY_TO,
    });
    if (result.error) {
      return {
        ok: false,
        error: result.error.message ?? "unknown_resend_error",
      };
    }
    return { ok: true, emailId: result.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

/**
 * Fallback-tiltale når tenant.firstName mangler. Brukes i alle CTA-mailer.
 * Holdt naturlig per språk — ikke direkte oversettelse av "there".
 */
function fallbackName(locale: Locale): string {
  switch (locale) {
    case "en":
      return "there";
    case "sv":
      return "där";
    case "da":
      return "der";
    case "no":
    default:
      return "deg";
  }
}

function welcomeSubject(locale: Locale): string {
  switch (locale) {
    case "en":
      return "Your Ko | Do · Vault is ready 🔐";
    case "sv":
      return "Ditt Ko | Do · Vault är klart 🔐";
    case "da":
      return "Din Ko | Do · Vault er klar 🔐";
    case "no":
    default:
      return "Din Ko | Do · Vault er klar 🔐";
  }
}

/**
 * A3 lifecycle-warning reason-text. Én setning som beskriver HVORFOR
 * brukeren er låst (trial utløp vs. abonnement kansellert).
 * Limes inn i mal-malen som {{reasonText}} og må gli naturlig.
 */
function lifecycleReasonText(
  locale: Locale,
  fromCancel: boolean,
  lockedAtStr: string,
): string {
  if (locale === "en") {
    return fromCancel
      ? `Your subscription was cancelled on ${lockedAtStr} and the account was locked.`
      : `Your trial ended on ${lockedAtStr} and the account was locked.`;
  }
  if (locale === "sv") {
    return fromCancel
      ? `Ditt abonnemang sades upp ${lockedAtStr} och kontot låstes.`
      : `Din provperiod upphörde ${lockedAtStr} och kontot låstes.`;
  }
  if (locale === "da") {
    return fromCancel
      ? `Dit abonnement blev annulleret ${lockedAtStr} og kontoen blev låst.`
      : `Din prøveperiode udløb ${lockedAtStr} og kontoen blev låst.`;
  }
  // norsk (default)
  return fromCancel
    ? `Abonnementet ditt ble kansellert ${lockedAtStr} og kontoen ble låst.`
    : `Prøveperioden din utløp ${lockedAtStr} og kontoen ble låst.`;
}

function lifecycleWarningSubject(
  locale: Locale,
  daysLeft: number,
  dayWord: string,
): string {
  switch (locale) {
    case "en":
      return `Your vault will be deleted in ${daysLeft} ${dayWord}`;
    case "sv":
      return `Ditt valv raderas om ${daysLeft} ${dayWord}`;
    case "da":
      return `Din vault slettes om ${daysLeft} ${dayWord}`;
    case "no":
    default:
      return `Vault'en din slettes om ${daysLeft} ${dayWord}`;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Iter 17 (2026-06-13) — Lifecycle-varsler (T-7, T-3, T-1)
// ───────────────────────────────────────────────────────────────────────

export type WarningType = "t7" | "t3" | "t1";

/**
 * Send "vault'en din slettes om N dager"-varsel. Idempotensesjekken
 * gjøres AV KALLSIDEN (cron-route) via `tenant.lifecycleWarningsSentAt[type]`
 * — denne funksjonen kjører ALDRI sin egen lookup, slik at unit-tester
 * og admin-manuell-resend er mulig.
 *
 * Returnerer alltid en EmailResult; kaster aldri.
 */
export async function sendLifecycleWarning(
  tenant: TenantRecord,
  type: WarningType,
  deleteDate: Date,
): Promise<EmailResult> {
  const to = tenant.contactEmail ?? tenant.email;
  if (!to) {
    return { skipped: true, reason: "missing_recipient_email" };
  }
  if (tenant.emailPreferences?.lifecycle === false) {
    // Admin har eksplisitt slått av lifecycle-eposter for denne tenanten
    // (B2B-kontrakt e.l.). Hopp uten å oppdatere "sent at"-feltet — vi
    // vil prøve igjen hvis flagget skrus på senere.
    return { skipped: true, reason: "lifecycle_emails_disabled_for_tenant" };
  }
  const enabled = isEmailEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason: "email_disabled (RESEND_API_KEY / EMAIL_ENABLED / RESEND_FROM_EMAIL mangler)",
    };
  }

  const daysLeftMap: Record<WarningType, number> = { t7: 7, t3: 3, t1: 1 };
  const daysLeft = daysLeftMap[type];

  try {
    const locale = resolveLocale(tenant);
    const firstName = (tenant.firstName ?? "").trim() || fallbackName(locale);
    const dayWord = formatDayWord(daysLeft, locale);
    const lockedAtStr = formatDateOnly(tenant.lockedAt, locale);
    const deleteDateStr = formatDateOnly(deleteDate.toISOString(), locale);
    // Reason-text bestemmes av hvorfor tenant ble låst:
    //   - cancelledAt satt → bruker kansellerte abonnement (spor B)
    //   - cancelledAt null → trial utløp (spor A)
    // Skal være ÉN setning som glir naturlig inn i template-flyten.
    const fromCancel = tenant.cancelledAt !== null;
    const reasonText = lifecycleReasonText(locale, fromCancel, lockedAtStr);
    const html = await loadTemplate(
      locale,
      {
        firstName,
        subdomain: tenant.subdomain,
        daysLeft: String(daysLeft),
        dayWord,
        lockedAt: lockedAtStr,
        deleteDate: deleteDateStr,
        reasonText,
      },
      "lifecycle-warning",
    );
    const subject = lifecycleWarningSubject(locale, daysLeft, dayWord);

    const resend = new Resend(enabled.apiKey);
    const result = await resend.emails.send({
      from: enabled.from,
      to: [to],
      subject,
      html,
      replyTo: REPLY_TO,
    });
    if (result.error) {
      return {
        ok: false,
        error: result.error.message ?? "unknown_resend_error",
      };
    }
    return { ok: true, emailId: result.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

function formatDayWord(n: number, locale: Locale): string {
  switch (locale) {
    case "en":
      return n === 1 ? "day" : "days";
    case "sv":
      return n === 1 ? "dag" : "dagar";
    case "da":
      return n === 1 ? "dag" : "dage";
    case "no":
    default:
      return n === 1 ? "dag" : "dager";
  }
}

function formatDateOnly(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    // Locale-til-Intl-mapping. Bruker landspesifikke BCP47-tagger så
    // Intl.DateTimeFormat gir naturlig formatering per land:
    //   nb-NO → "12. juni 2026"
    //   sv-SE → "12 juni 2026"  (Sverige: ingen punktum etter dag)
    //   da-DK → "12. juni 2026"
    //   en-GB → "12 June 2026"
    const intlLocale =
      locale === "en"
        ? "en-GB"
        : locale === "sv"
          ? "sv-SE"
          : locale === "da"
            ? "da-DK"
            : "nb-NO";
    return d.toLocaleDateString(intlLocale, {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ───────────────────────────────────────────────────────────────────────
// Iter 17 FULL pakke (2026-06-13) — A1/A2/B1/A4/B3-maler
// ───────────────────────────────────────────────────────────────────────

/**
 * Bygg HTML-blokken for "Stripe-historikk bevares til {date}"-seksjonen
 * i deleted-confirmation-mailen. Returneres tom streng ("") for tenants
 * uten betalt historikk — da skjules hele blokken i template'en.
 *
 * Datoen er `deletedAt + 5 år` per norsk bokføringslov.
 */
function renderStripeHistoryBlock(locale: Locale, deletedAt: Date): string {
  const retentionUntil = new Date(deletedAt);
  retentionUntil.setFullYear(retentionUntil.getFullYear() + 5);
  const date = formatDateOnly(retentionUntil.toISOString(), locale);

  const copy: Record<Locale, { heading: string; body: string }> = {
    no: {
      heading: "Stripe-historikk",
      body: `Transaksjonshistorikken din bevares hos Stripe til <strong style="color:#ffffff;">${date}</strong> (5 år per bokføringsloven). Du kan be om en kopi når som helst.`,
    },
    sv: {
      heading: "Stripe-historik",
      body: `Din transaktionshistorik sparas hos Stripe till <strong style="color:#ffffff;">${date}</strong> (5 år enligt norska bokföringslagen). Du kan begära en kopia när som helst.`,
    },
    da: {
      heading: "Stripe-historik",
      body: `Din transaktionshistorik opbevares hos Stripe indtil <strong style="color:#ffffff;">${date}</strong> (5 år iht. norsk bogføringslov). Du kan til enhver tid bede om en kopi.`,
    },
    en: {
      heading: "Stripe history",
      body: `Your transaction history is retained by Stripe until <strong style="color:#ffffff;">${date}</strong> (5 years per the Norwegian Bookkeeping Act). You can request a copy at any time.`,
    },
  };

  const { heading, body } = copy[locale];
  return `<tr><td style="padding-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#888888;line-height:1.7;">
          <strong style="color:#ffffff;">${heading}:</strong><br>
          ${body}
        </p>
      </td></tr>`;
}

/**
 * Sjekk om e-postkanalen er på + tenant tillater lifecycle-mail.
 * Returnerer EmailResult ved skip, ellers null (= klar til send).
 */
function precheckEmail(tenant: TenantRecord): EmailResult | null {
  const to = tenant.contactEmail ?? tenant.email;
  if (!to) return { skipped: true, reason: "missing_recipient_email" };
  if (tenant.emailPreferences?.lifecycle === false) {
    return { skipped: true, reason: "lifecycle_emails_disabled_for_tenant" };
  }
  const enabled = isEmailEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason: "email_disabled (RESEND_API_KEY / EMAIL_ENABLED / RESEND_FROM_EMAIL mangler)",
    };
  }
  return null;
}

/**
 * Felles send-runner for lifecycle-mailer (alle med samme mottaker-felt
 * og format). Sammenligner mot precheck så vi ikke duplikatkode.
 *
 * Subject-objektet inneholder ÉN streng per støttet språk slik at vi får
 * compile-tid-feilmelding hvis vi glemmer SV eller DA for et nytt mal-sett.
 */
async function sendLifecycleEmail(
  tenant: TenantRecord,
  template:
    | "trial-reminder-t5"
    | "locked-from-trial"
    | "locked-from-cancel"
    | "deleted-confirmation",
  subject: { no: string; sv: string; da: string; en: string },
  extraVars: Record<string, string>,
): Promise<EmailResult> {
  const pre = precheckEmail(tenant);
  if (pre) return pre;
  const enabled = isEmailEnabled();
  if (!enabled) return { skipped: true, reason: "email_disabled" };
  const to = tenant.contactEmail ?? tenant.email;
  if (!to) return { skipped: true, reason: "missing_recipient_email" };

  const locale = resolveLocale(tenant);
  const firstName = (tenant.firstName ?? "").trim() || fallbackName(locale);
  try {
    const html = await loadTemplate(
      locale,
      {
        firstName,
        subdomain: tenant.subdomain,
        ...extraVars,
      },
      template,
    );
    const resend = new Resend(enabled.apiKey);
    const result = await resend.emails.send({
      from: enabled.from,
      to: [to],
      subject: subject[locale],
      html,
      replyTo: REPLY_TO,
    });
    if (result.error) {
      return { ok: false, error: result.error.message ?? "unknown_resend_error" };
    }
    return { ok: true, emailId: result.data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown_error" };
  }
}

/**
 * A1 — T-5 trial-reminder. Sendes når dag = trialEndsAt - 5.
 * Bruker `trialEndsAt` som tekstvariabel (ikke `deleteDate`).
 */
export async function sendTrialReminderT5(
  tenant: TenantRecord,
): Promise<EmailResult> {
  const locale = resolveLocale(tenant);
  return sendLifecycleEmail(
    tenant,
    "trial-reminder-t5",
    {
      no: "Prøveperioden utløper om 5 dager",
      sv: "Din provperiod upphör om 5 dagar",
      da: "Din prøveperiode udløber om 5 dage",
      en: "Your trial ends in 5 days",
    },
    {
      trialEndsAt: formatDateOnly(tenant.trialEndsAt, locale),
    },
  );
}

/**
 * A2 — "Prøveperioden er over, kontoen er låst". Sendes av cron ved
 * LOCK-action når tenant kom fra status=trial (ikke fra cancel).
 */
export async function sendLockedFromTrial(
  tenant: TenantRecord,
  deleteDate: Date,
): Promise<EmailResult> {
  const locale = resolveLocale(tenant);
  return sendLifecycleEmail(
    tenant,
    "locked-from-trial",
    {
      no: "Prøveperioden er over — kontoen er låst",
      sv: "Provperioden är slut — kontot är låst",
      da: "Prøveperioden er forbi — kontoen er låst",
      en: "Your trial has ended — account locked",
    },
    {
      deleteDate: formatDateOnly(deleteDate.toISOString(), locale),
    },
  );
}

/**
 * B1 — "Abonnementet er kansellert, kontoen er låst". Sendes av webhook
 * etter at handleSubscriptionDeleted setter status=locked.
 */
export async function sendLockedFromCancel(
  tenant: TenantRecord,
): Promise<EmailResult> {
  const locale = resolveLocale(tenant);
  // Delete-dato beregnes fra lockedAt + 28d
  const lockedAt = tenant.lockedAt ? new Date(tenant.lockedAt) : new Date();
  const deleteDate = new Date(lockedAt.getTime());
  deleteDate.setUTCDate(deleteDate.getUTCDate() + 28);
  return sendLifecycleEmail(
    tenant,
    "locked-from-cancel",
    {
      no: "Abonnementet er kansellert — kontoen er låst",
      sv: "Abonnemanget är uppsagt — kontot är låst",
      da: "Abonnementet er annulleret — kontoen er låst",
      en: "Subscription cancelled — account locked",
    },
    {
      deleteDate: formatDateOnly(deleteDate.toISOString(), locale),
    },
  );
}

/**
 * A4/B3 — "Kontoen er nå slettet". Sendes RETT FØR `deleteTenant()`
 * fjerner tenant-recorden (cron-flow), eller via snapshot ETTER for
 * GDPR-selvbetjent sletting (se `sendDeletedConfirmationFromSnapshot`).
 *
 * Stripe-history-blokken vises kun for betalende kunder
 * (`stripeSubscriptionId !== null`). Retention-datoen er deletedAt + 5 år
 * per bokføringsloven.
 *
 * Exit-survey-lenken peker til {@link EXIT_SURVEY_URL} — placeholder inntil
 * Mike publiserer den faktiske Google Form'en. Bytt ut konstanten der.
 */
export async function sendDeletedConfirmation(
  tenant: TenantRecord,
  deletedAt: Date = new Date(),
): Promise<EmailResult> {
  const locale = resolveLocale(tenant);
  const hasPaidHistory = tenant.stripeSubscriptionId !== null;
  return sendLifecycleEmail(
    tenant,
    "deleted-confirmation",
    {
      no: "Takk for at du brukte Ko | Do · Vault",
      sv: "Tack för att du använde Ko | Do · Vault",
      da: "Tak fordi du brugte Ko | Do · Vault",
      en: "Thank you for using Ko | Do · Vault",
    },
    {
      stripeHistoryBlock: hasPaidHistory
        ? renderStripeHistoryBlock(locale, deletedAt)
        : "",
      exitSurveyUrl: EXIT_SURVEY_URL,
    },
  );
}

/**
 * Snapshot-variant av A4/B3 for GDPR-selvbetjent sletting.
 *
 * `deleteTenant()` fjerner TenantRecord før vi får sendt mailen, så vi
 * bygger et minimum-snapshot av relevante felter FØR sletting og bruker
 * den her. Returnerer samme EmailResult-shape som `sendDeletedConfirmation`.
 *
 * Konstrueres internt ved å bygge en in-memory TenantRecord-stub med kun
 * de feltene `sendLifecycleEmail` faktisk leser (subdomain, firstName,
 * contactEmail/email, locale, emailPreferences, stripeSubscriptionId).
 */
export async function sendDeletedConfirmationFromSnapshot(snapshot: {
  subdomain: string;
  firstName: string | null;
  email: string;
  contactEmail: string | null;
  locale: TenantRecord["locale"];
  hadStripeSubscription: boolean;
  emailPreferences: TenantRecord["emailPreferences"];
  deletedAt: Date;
}): Promise<EmailResult> {
  // Bygg in-memory stub som matcher signaturene som sendLifecycleEmail
  // og resolveLocale leser. Tomme/null-verdier for alt vi ikke bruker.
  const stub = {
    subdomain: snapshot.subdomain,
    firstName: snapshot.firstName,
    email: snapshot.email,
    contactEmail: snapshot.contactEmail,
    locale: snapshot.locale,
    emailPreferences: snapshot.emailPreferences,
    stripeSubscriptionId: snapshot.hadStripeSubscription ? "preserved" : null,
  } as unknown as TenantRecord;
  return sendDeletedConfirmation(stub, snapshot.deletedAt);
}

/**
 * Test-only export: internal renderingshelpers eksponeres for unit-tester.
 * Dette er IKKE en offentlig API — ikke bruk fra produksjonskode utenfor
 * denne filen. Symbolet `__testHelpers` brukes som tydelig flagg på at
 * dette kun er test-overflate (samme konvensjon som Next.js + React-team).
 */
export const __testHelpers = {
  resolveLocale,
  formatDayWord,
  formatDateOnly,
  fallbackName,
  welcomeSubject,
  lifecycleReasonText,
  lifecycleWarningSubject,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Iter 20.3 — Invite-mail (B2B ansatt-invitasjon)
// ─────────────────────────────────────────────────────────────────────

const INVITE_SUBJECTS: Record<Locale, string> = {
  no: "Du er invitert til Ko|Do Vault",
  en: "You're invited to Ko|Do Vault",
  sv: "Du är inbjuden till Ko|Do Vault",
  da: "Du er inviteret til Ko|Do Vault",
};

/**
 * Send invite-mail med invite-lenken. Idempotent via `mailSentAt` på
 * InviteRecord — kallere må sjekke før kall og sette feltet etterpå.
 *
 * Param `recipientEmail` er invite.email (kan være null → skipped).
 * Param `recipientLocale` defaulter til "no" hvis null.
 * Param `orgName` er enten parent.firstName+lastName eller fall-back til
 * parent.subdomain ("am" osv).
 */
export async function sendInviteEmail(opts: {
  recipientEmail: string | null;
  recipientFirstName: string | null;
  recipientLocale: "no" | "sv" | "da" | "en" | null;
  orgName: string;
  inviteUrl: string;
}): Promise<EmailResult> {
  if (!opts.recipientEmail) {
    return { skipped: true, reason: "missing_recipient_email" };
  }
  const enabled = isEmailEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason:
        "email_disabled (RESEND_API_KEY / EMAIL_ENABLED / RESEND_FROM_EMAIL mangler)",
    };
  }
  const locale: Locale = (opts.recipientLocale ?? "no") as Locale;
  try {
    const firstName =
      (opts.recipientFirstName ?? "").trim() || fallbackName(locale);
    const html = await loadTemplate(
      locale,
      {
        firstName,
        orgName: opts.orgName,
        inviteUrl: opts.inviteUrl,
      },
      "invite",
    );
    const resend = new Resend(enabled.apiKey);
    const result = await resend.emails.send({
      from: enabled.from,
      to: [opts.recipientEmail],
      subject: INVITE_SUBJECTS[locale],
      html,
      replyTo: REPLY_TO,
    });
    if (result.error) {
      return {
        ok: false,
        error: result.error.message ?? "unknown_resend_error",
      };
    }
    return { ok: true, emailId: result.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Iter 20.9 (D-081) — Org-admin velkomstmail
// ─────────────────────────────────────────────────────────────────────

const ORG_ADMIN_WELCOME_SUBJECTS: Record<Locale, string> = {
  no: "Velkommen som administrator — Ko|Do · Vault",
  sv: "Välkommen som administratör — Ko|Do · Vault",
  da: "Velkommen som administrator — Ko|Do · Vault",
  en: "Welcome as administrator — Ko|Do · Vault",
};

/**
 * Send velkomstmail til en ny B2B am-admin etter at Mike har opprettet
 * kontoen via `POST /api/admin/tenants/[subdomain]/create-org-admin`.
 *
 * Mailen inneholder:
 *   - Adresse til adminpanelet (`<prefix>-admin.kodovault.no`)
 *   - E-post + midlertidig passord (tydelig markert som engangsbruk)
 *   - Beskjed om at passord MÅ byttes ved første innlogging
 *
 * Returnerer alltid en EmailResult; kaster aldri.
 */
export async function sendOrgAdminWelcome(opts: {
  recipientEmail: string;
  recipientFirstName: string;
  recipientLocale: Locale;
  companyName: string;
  adminUrl: string;
  tempPassword: string;
}): Promise<EmailResult> {
  const enabled = isEmailEnabled();
  if (!enabled) {
    return {
      skipped: true,
      reason:
        "email_disabled (RESEND_API_KEY / EMAIL_ENABLED / RESEND_FROM_EMAIL mangler)",
    };
  }
  const locale = opts.recipientLocale;
  try {
    const firstName =
      (opts.recipientFirstName ?? "").trim() || fallbackName(locale);
    const html = await loadTemplate(
      locale,
      {
        firstName,
        companyName: opts.companyName,
        adminUrl: opts.adminUrl,
        email: opts.recipientEmail,
        tempPassword: opts.tempPassword,
      },
      "org-admin-welcome",
    );
    const resend = new Resend(enabled.apiKey);
    const result = await resend.emails.send({
      from: enabled.from,
      to: [opts.recipientEmail],
      subject: ORG_ADMIN_WELCOME_SUBJECTS[locale],
      html,
      replyTo: REPLY_TO,
    });
    if (result.error) {
      return {
        ok: false,
        error: result.error.message ?? "unknown_resend_error",
      };
    }
    return { ok: true, emailId: result.data?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown_error",
    };
  }
}


