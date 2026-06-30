/**
 * Ko | Do · Vault — v4.3 Iter 13 — Stripe event-handlers
 *
 * Per event-type handler. Alle returnerer `{ ok: boolean, detail?: string }`
 * og kaster ALDRI — webhook-routen returnerer 200 til Stripe så snart
 * event er registrert. Feil skrives til provisioningLog + console for
 * Mike å gjennomgå senere.
 *
 * Events vi håndterer (Mike's Stripe-konfig, Iter 11):
 *   - customer.subscription.created  → provisjoner (Upstash + Vercel)
 *   - customer.subscription.updated  → synkroniser status (best-effort)
 *   - customer.subscription.deleted  → status = "cancelled" (m/ D-069-guard)
 *   - invoice.paid                   → bekreft status = "active"
 *   - invoice.payment_failed         → status = "locked" + varsle Mike
 *                                       (m/ D-069-guard)
 *
 * Hentekjede for subdomain (metadata):
 *   1. event.data.object.metadata.subdomain  (session/subscription)
 *   2. event.data.object.subscription_details.metadata.subdomain (invoice)
 *   3. Fallback: customer-lookup via Stripe API → customer.metadata.subdomain
 */
import type Stripe from "stripe";
import { getStripeClient } from "./client";
import {
  getTenant,
  putTenant,
  appendProvisioningEvent,
  listTenants,
} from "@/lib/platform/tenant-store";
import { provisionTenantOnUpstash } from "@/lib/platform/upstash-provision";
import { provisionTenantOnVercel } from "@/lib/platform/vercel-provision";
import { notifyProvisioningFailure } from "@/lib/platform/notify";
import { sendProvisioningFailedTelegram } from "@/lib/platform/notify-telegram";
import { provisioningLogger } from "@/lib/platform/provisioning-log";
import { canAutoLock, canAutoCancel } from "@/lib/platform/lifecycle-guard";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import { sendLockedFromCancel } from "@/lib/platform/notify-email";
import { warnIfB2BHasB2CPlan } from "@/lib/platform/plan-consistency-guard";
import type { Plan, TenantRecord } from "@/lib/platform/tenant-types";

export interface HandlerResult {
  ok: boolean;
  detail?: string;
}

// ─── Metadata-lookup ──────────────────────────────────────────────────

/**
 * Hent subdomain fra event-metadata. Returnerer null hvis ikke funnet.
 * Faller tilbake på Stripe customer-lookup hvis nødvendig (ekstra API-kall).
 */
async function findSubdomainFromEvent(
  event: Stripe.Event,
  stripeClient?: Pick<Stripe, "customers">,
): Promise<string | null> {
  const obj = event.data.object as unknown as Record<string, unknown>;

  // 1. Direkte metadata på event-objektet (session, subscription, customer).
  //    Vi støtter både `subdomain` (Stripe-checkout / subscription flyt) og
  //    `kodo_subdomain` (D-080/D-136 Mike's manuelle send-invoice-flyt som
  //    bruker namespaced keys for å unngå konflikt med Stripes egne).
  const directMeta = obj.metadata as Record<string, string> | undefined;
  if (directMeta?.subdomain) return directMeta.subdomain.toLowerCase();
  if (directMeta?.kodo_subdomain) return directMeta.kodo_subdomain.toLowerCase();

  // 2. invoice.subscription_details.metadata (Stripe Dahlia)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subDetails = (obj as any).subscription_details as
    | { metadata?: Record<string, string> }
    | undefined;
  if (subDetails?.metadata?.subdomain) {
    return subDetails.metadata.subdomain.toLowerCase();
  }
  if (subDetails?.metadata?.kodo_subdomain) {
    return subDetails.metadata.kodo_subdomain.toLowerCase();
  }

  // 3. invoice.lines.data[].metadata (Stripe-eldre/varianter)
  const lines = (obj as { lines?: { data?: Array<{ metadata?: Record<string, string> }> } }).lines;
  const lineMeta = lines?.data?.[0]?.metadata;
  if (lineMeta?.subdomain) return lineMeta.subdomain.toLowerCase();
  if (lineMeta?.kodo_subdomain) return lineMeta.kodo_subdomain.toLowerCase();

  // 4. Customer-fallback — bruker stripe.customers.retrieve
  const customerId = obj.customer as string | undefined;
  if (customerId) {
    try {
      const stripe = stripeClient ?? getStripeClient();
      const customer = (await stripe.customers.retrieve(
        customerId,
      )) as Stripe.Customer;
      const meta = customer.metadata?.subdomain;
      if (meta) return meta.toLowerCase();
      const kodoMeta = customer.metadata?.kodo_subdomain;
      if (kodoMeta) return kodoMeta.toLowerCase();
    } catch (e) {
      console.error(
        "[event-handlers] customer-fallback failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return null;
}

// ─── Plan-mapping ─────────────────────────────────────────────────────

/**
 * Map Stripe price.id tilbake til Plan-enum. Returnerer null hvis ukjent.
 *
 * B2B-prisene (Iter 20.4) krever at Mike har satt STRIPE_PRICE_B2B_SEMIANNUAL /
 * STRIPE_PRICE_B2B_YEARLY i Vercel — uten dem ignoreres B2B-events lydløst
 * (mapping returnerer null, plan-feltet endres ikke).
 */
function priceIdToPlan(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  if (priceId === process.env.STRIPE_PRICE_B2B_SEMIANNUAL) return "b2b_semiannual";
  if (priceId === process.env.STRIPE_PRICE_B2B_YEARLY) return "b2b_yearly";
  return null;
}

// ─── handleSubscriptionCreated ────────────────────────────────────────

/**
 * customer.subscription.created → provisjoner Upstash + Vercel, sett
 * status="active", lagre stripeSubscriptionId og plan.
 *
 * Idempotent: hvis tenanten allerede er provisjonert
 * (vercelProjectId && upstashDatabaseId), hopper vi over provisjonering.
 */
export async function handleSubscriptionCreated(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const subscription = event.data.object as Stripe.Subscription;
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) {
    return { ok: false, detail: "subdomain mangler i metadata" };
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return { ok: false, detail: `tenant '${subdomain}' finnes ikke` };
  }

  // Lagre subscription-ID + plan + status. Race-trygt: re-fetch rett før
  // skriving fordi invoice.paid kan ha kjørt parallelt og ha latest data.
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceIdToPlan(priceId) ?? tenant.plan;
  const fresh = (await getTenant(subdomain)) ?? tenant;

  // Iter 20.4b (D-080): cache neste fakturadato fra Stripe for lifecycle-cron-
  // effektivitet. `current_period_end` er unix-sekunder. Brukes for B2B
  // grace-lock-vurdering, og er trygg å lagre for B2C også (selv om B2C-cron
  // ikke konsulterer den i dag).
  //
  // ⚠️ Stripe API-versjon 2025-09-30+ (Acacia/Charlemagne) flyttet
  // current_period_end fra Subscription-objektet til SubscriptionItem-objektet.
  // Vi prøver topp-nivå først (eldre API) og faller tilbake til items[0]
  // (nyere API) — sikrer at nextBillingDate caches uansett API-versjon i bruk.
  const subAny = subscription as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const periodEndSec =
    subAny.current_period_end ?? subAny.items?.data?.[0]?.current_period_end;
  const nextBillingDate =
    typeof periodEndSec === "number" && Number.isFinite(periodEndSec)
      ? new Date(periodEndSec * 1000).toISOString()
      : fresh.nextBillingDate;

  await putTenant({
    ...fresh,
    stripeSubscriptionId: subscription.id,
    plan,
    status: "active",
    // pending er nå over — clear utløpstid
    pendingExpiresAt: null,
    nextBillingDate,
  });

  // D-130 (2026-02): plan-konsistens-vakt. Hvis en B2B parent ender opp
  // med en B2C-plan-verdi etter Stripe-mapping, logg advarsel (blokker
  // ikke). Vanlig årsak: STRIPE_PRICE_MONTHLY/_YEARLY ble brukt mot en
  // B2B-customer i Stripe Dashboard — bør egentlig vært B2B_*-prisen.
  warnIfB2BHasB2CPlan(
    { ...fresh, plan, status: "active", parentTenant: fresh.parentTenant },
    "stripe_subscription_created",
  );

  // Hvis allerede provisjonert (admin har retry-et manuelt) → ferdig
  if (tenant.vercelProjectId && tenant.upstashDatabaseId) {
    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "ok",
      detail: `subscription.created mottatt; allerede provisjonert (skip)`,
    });
    return { ok: true, detail: "allerede provisjonert" };
  }

  // Provisjoner Upstash → Vercel (samme mønster som /api/register, D-064)
  const onEvent = provisioningLogger(subdomain);
  try {
    const upstash = await provisionTenantOnUpstash({
      subdomain,
      onEvent,
    });
    const t1 = (await getTenant(subdomain)) ?? tenant;
    await putTenant({ ...t1, upstashDatabaseId: upstash.databaseId });

    try {
      const vercel = await provisionTenantOnVercel({
        subdomain,
        kvRestApiUrl: upstash.restUrl,
        kvRestApiToken: upstash.restToken,
        onEvent,
      });
      const t2 = (await getTenant(subdomain)) ?? t1;
      await putTenant({
        ...t2,
        vercelProjectId: vercel.projectId,
        configGenerated: true,
      });
      return { ok: true, detail: `provisjonert: vercel=${vercel.projectId}` };
    } catch (vercelErr) {
      const msg =
        vercelErr instanceof Error ? vercelErr.message : "unknown vercel error";
      // D-063: INGEN rollback av Upstash eller Vercel. Admin retter via D-055.
      await notifyProvisioningFailure({
        subdomain,
        stage: "vercel",
        error: vercelErr,
        tenantEmail: tenant.email,
      });
      const t3 = (await getTenant(subdomain)) ?? t1;
      await putTenant({ ...t3, status: "provisioning_failed" });
      return { ok: false, detail: `vercel: ${msg}` };
    }
  } catch (upstashErr) {
    const msg =
      upstashErr instanceof Error
        ? upstashErr.message
        : "unknown upstash error";
    // D-063: ingen rollback. Admin retter via D-055.
    await notifyProvisioningFailure({
      subdomain,
      stage: "upstash",
      error: upstashErr,
      tenantEmail: tenant.email,
    });
    const t = (await getTenant(subdomain)) ?? tenant;
    await putTenant({ ...t, status: "provisioning_failed" });
    return { ok: false, detail: `upstash: ${msg}` };
  }
}

// ─── handleSubscriptionUpdated ────────────────────────────────────────

/**
 * customer.subscription.updated → synkroniser plan/status. Best-effort.
 *
 * Stripe statuser vi mapper:
 *   active, trialing      → behold/sett "active"
 *   past_due, unpaid      → vi venter på invoice.payment_failed-eventen
 *                           som har D-069-guarden
 *   canceled              → vi venter på subscription.deleted-eventen
 *
 * Endring av price (plan-bytte) — oppdater plan-feltet.
 */
export async function handleSubscriptionUpdated(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const subscription = event.data.object as Stripe.Subscription;
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) return { ok: false, detail: "subdomain mangler" };

  const tenant = await getTenant(subdomain);
  if (!tenant) return { ok: false, detail: `tenant '${subdomain}' mangler` };

  const priceId = subscription.items.data[0]?.price?.id;
  const newPlan = priceIdToPlan(priceId);

  const updates: Partial<TenantRecord> = {};
  if (newPlan && newPlan !== tenant.plan) {
    updates.plan = newPlan;
  }

  // Iter 19.6 (2026-06-13) + 19.7 (Dahlia-fix): Stripe Customer Portal lar
  // bruker kansellere ved periodens slutt. Stripe Basil/Dahlia (vår API
  // versjon) bruker enten `cancel_at_period_end: true` (legacy) ELLER
  // `cancel_at: <future_unix>` (newer enum-helpers som `min_period_end`).
  // Begge signaliserer SAMME UX-intensjon: "aktiv nå, kansellert senere".
  // Vi treats begge som ett — flagg true hvis enten er satt.
  // Umiddelbar kansellering fyrer i stedet `customer.subscription.deleted`
  // direkte (håndteres lenger ned).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subAny = subscription as any;
  const legacyFlag = subAny.cancel_at_period_end === true;
  const cancelAtUnix: number | null =
    typeof subAny.cancel_at === "number" ? subAny.cancel_at : null;
  const cancelAtIso = cancelAtUnix
    ? new Date(cancelAtUnix * 1000).toISOString()
    : null;
  const cancelFlag = legacyFlag || cancelAtUnix !== null;

  if (cancelFlag !== tenant.cancelAtPeriodEnd) {
    updates.cancelAtPeriodEnd = cancelFlag;
  }
  if (cancelAtIso !== tenant.cancelEffectiveAt) {
    updates.cancelEffectiveAt = cancelAtIso;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true, detail: "ingen endring" };
  }

  await putTenant({ ...tenant, ...updates });
  await appendProvisioningEvent(subdomain, {
    timestamp: new Date().toISOString(),
    stage: "status_change",
    status: "ok",
    detail: `subscription.updated: ${Object.keys(updates).join(", ")}${
      cancelFlag && cancelAtIso ? ` (cancel_at=${cancelAtIso})` : ""
    }`,
  });

  // D-130 (2026-02): plan-konsistens-vakt etter subscription.updated.
  warnIfB2BHasB2CPlan(
    { ...tenant, ...updates } as TenantRecord,
    "stripe_subscription_updated",
  );

  return { ok: true, detail: `oppdatert: ${Object.keys(updates).join(", ")}` };
}

// ─── handleSubscriptionDeleted ────────────────────────────────────────

/**
 * customer.subscription.deleted → status="locked" (Iter 17 full pakke).
 *
 * REVISJON 2026-06-13: tidligere satte denne status="cancelled". Det
 * gjorde at cron (Iter 17) IKKE plukket opp kansellerte kunder for
 * varsler eller sletting — kansellerte tenants ble fanget i en
 * "cancelled"-limbo for alltid.
 *
 * Ny oppførsel: status="locked" + lockedAt=now. `cancelledAt` settes
 * også som "hvorfor ble den låst"-spor. Cron-en plukker opp lock'en
 * og kjører WARN_T7/T3/T1 + DELETE på samme 28-dagers vindu som
 * trial-utløp (D-075).
 *
 * D-069: MÅ kalle canAutoCancel() — free-plan tenants kan ikke
 * auto-cancelles (samme guard som før, regelen gjelder også for
 * "lock som konsekvens av cancel").
 *
 * Iter 17 mail-pakke: sender B1 ("Abonnementet er kansellert — kontoen
 * er låst") etter at status er satt. Idempotent via
 * `lockedNotificationSentAt`.
 */
export async function handleSubscriptionDeleted(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) return { ok: false, detail: "subdomain mangler" };

  const tenant = await getTenant(subdomain);
  if (!tenant) return { ok: false, detail: `tenant '${subdomain}' mangler` };

  // D-069-guard (lifecycle-guard.ts → canAutoCancel speiler "auto-lock"
  // for kansellerings-sti — vi reuser den)
  const guard = canAutoCancel(tenant);
  if (!guard.allowed) {
    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "ok",
      detail: `subscription.deleted blokkert: ${guard.reason}`,
    });
    return { ok: true, detail: `D-069 blokkert: ${guard.reason}` };
  }

  const now = new Date().toISOString();
  const lockedTenant: TenantRecord = {
    ...tenant,
    status: "locked",
    lockedAt: now,
    // "Hvorfor"-spor: cancelledAt settes selv om status er "locked".
    // Cron-en + admin-UI bruker dette feltet til å skille spor A (trial-
    // utløp) fra spor B (cancel) for korrekt mail-mal og status-label.
    cancelledAt: now,
    // Iter 19.6: når abonnementet faktisk er slettet, er pending-cancel-
    // flaggene ikke lenger relevante.
    cancelAtPeriodEnd: false,
    cancelEffectiveAt: null,
  };
  await putTenant(lockedTenant);
  await appendProvisioningEvent(subdomain, {
    timestamp: now,
    stage: "status_change",
    status: "ok",
    detail: "subscription.deleted → status=locked + cancelledAt=now (Iter 17 spor B)",
  });

  // Send B1-mail (kun én gang per tenant per lock-event)
  if (!lockedTenant.lockedNotificationSentAt) {
    const mail = await sendLockedFromCancel(lockedTenant);
    if (mail.ok === true || mail.skipped === true) {
      await putTenant({
        ...lockedTenant,
        lockedNotificationSentAt: now,
      });
    }
    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: mail.ok === false ? "failed" : "ok",
      detail: `B1 cancel-locked mail: ${
        mail.ok
          ? `sendt (${mail.emailId ?? "?"})`
          : mail.skipped
            ? `hoppet (${mail.reason ?? "?"})`
            : `feilet: ${mail.error ?? "?"}`
      }`,
    });
  }

  return { ok: true, detail: "locked (cancel) + B1-mail" };
}

// ─── handleInvoicePaid ────────────────────────────────────────────────

/**
 * invoice.paid → bekreft status="active". Lagre stripeInvoiceId.
 *
 * Fires hver fakturasyklus (månedlig/årlig). Hvis bruker var i `trial`
 * eller `locked`, flytter dette dem tilbake til `active`.
 */
export async function handleInvoicePaid(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const invoice = event.data.object as unknown as Stripe.Invoice;
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) return { ok: false, detail: "subdomain mangler" };

  const tenant = await getTenant(subdomain);
  if (!tenant) return { ok: false, detail: `tenant '${subdomain}' mangler` };

  // Race-condition-trygg: re-fetch tenant rett før vi skriver. Stripe
  // sender invoice.paid og subscription.created tett (millisekunder), og
  // begge handlers leser+skriver tenant. Hvis vi spreader en stale tenant,
  // kan vi overskrive status="active" satt av subscription.created tilbake
  // til "pending" — det skjedde i prod 2026-06-06 (stripe-test-zsd049).
  const fresh = (await getTenant(subdomain)) ?? tenant;

  const updates: Partial<TenantRecord> = {
    stripeInvoiceId: invoice.id ?? null,
  };

  // Iter 20.4b (D-080): cache neste fakturadato fra Stripe invoice. Subscription-
  // fakturaer har period.end på linje-objektet (unix-sekunder). For ikke-
  // subscription-fakturaer er det ingenting å cache, så vi beholder forrige verdi.
  const lineItems = (invoice as unknown as {
    lines?: { data?: Array<{ period?: { end?: number } }> };
  }).lines?.data;
  const periodEndSec = lineItems?.[0]?.period?.end;
  if (typeof periodEndSec === "number" && Number.isFinite(periodEndSec)) {
    updates.nextBillingDate = new Date(periodEndSec * 1000).toISOString();
  }

  // invoice.paid bekrefter betaling — flipp "pending"/"trial"/"locked"
  // til "active". "active" forblir "active". "cancelled"/"deleted"
  // rører vi ikke (de er endelige).
  const wasLocked = fresh.status === "locked";
  if (
    fresh.status === "trial" ||
    fresh.status === "locked" ||
    fresh.status === "pending"
  ) {
    updates.status = "active";
    updates.lockedAt = null;
    // Hvis invoice.paid kommer FØR subscription.created, vil pendingExpiresAt
    // ikke være null ennå. Vi clear-er det her også for sikkerhet.
    updates.pendingExpiresAt = null;
  }

  await putTenant({ ...fresh, ...updates });
  await appendProvisioningEvent(subdomain, {
    timestamp: new Date().toISOString(),
    stage: "status_change",
    status: "ok",
    detail: `invoice.paid id=${invoice.id ?? "?"} → status=${updates.status ?? fresh.status}`,
  });

  // Iter 20.4b (D-080): cascade-unlock B2B children hvis denne tenanten er
  // en B2B parent som nettopp gikk fra locked → active. Vi henter ALLE
  // tenants (samme mønster som lifecycle-cron) og finner barn med
  // parentLockedAt satt.
  if (
    wasLocked &&
    updates.status === "active" &&
    fresh.customerType === "b2b" &&
    fresh.parentTenant === null
  ) {
    const cascadeResult = await cascadeUnlockB2BChildren(subdomain);
    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: cascadeResult.errors === 0 ? "ok" : "failed",
      detail: `b2b_cascade_unlock: ${cascadeResult.unlocked}/${cascadeResult.scanned} children gjenopprettet${cascadeResult.errors ? ` (${cascadeResult.errors} feil)` : ""}`,
    });
  }

  return { ok: true, detail: `paid` };
}

/**
 * Iter 20.4b (D-080): cascade-unlock B2B children når parent betaler.
 * Itererer alle tenants, finner barn med `parentTenant === parentSubdomain`
 * og `parentLockedAt !== null`, og setter status="active" + parentLockedAt=null.
 *
 * Eksportert som standalone for unit-testing.
 */
async function cascadeUnlockB2BChildren(
  parentSubdomain: string,
): Promise<{ scanned: number; unlocked: number; errors: number }> {
  const all = await listTenants();
  const candidates = all.filter(
    (t) =>
      t.parentTenant === parentSubdomain &&
      t.parentLockedAt !== null &&
      t.status === "locked",
  );
  let unlocked = 0;
  let errors = 0;
  const now = new Date().toISOString();
  for (const child of candidates) {
    try {
      await putTenant({
        ...child,
        status: "active",
        lockedAt: null,
        parentLockedAt: null,
      });
      await appendProvisioningEvent(child.subdomain, {
        timestamp: now,
        stage: "status_change",
        status: "ok",
        detail: `b2b_cascade_unlock: parent='${parentSubdomain}' betalte (invoice.paid)`,
      });
      unlocked++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[handleInvoicePaid] cascade-unlock child=${child.subdomain} feilet:`,
        msg,
      );
      errors++;
    }
  }
  return { scanned: candidates.length, unlocked, errors };
}

// ─── handleInvoicePaymentFailed ───────────────────────────────────────

/**
 * invoice.payment_failed → status="locked", lockedAt=now, varsle Mike.
 *
 * D-069: MÅ kalle canAutoLock() — free-plan kan ikke auto-låses.
 */
export async function handleInvoicePaymentFailed(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const invoice = event.data.object as unknown as Stripe.Invoice;
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) return { ok: false, detail: "subdomain mangler" };

  const tenant = await getTenant(subdomain);
  if (!tenant) return { ok: false, detail: `tenant '${subdomain}' mangler` };

  // D-069-guard
  const guard = canAutoLock(tenant);
  if (!guard.allowed) {
    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "ok",
      detail: `payment_failed blokkert: ${guard.reason}`,
    });
    return { ok: true, detail: `D-069 blokkert: ${guard.reason}` };
  }

  const now = new Date().toISOString();
  await putTenant({
    ...tenant,
    status: "locked",
    lockedAt: now,
  });
  await appendProvisioningEvent(subdomain, {
    timestamp: now,
    stage: "status_change",
    status: "failed",
    detail: `invoice.payment_failed id=${invoice.id ?? "?"} → status=locked`,
  });

  // Varsle Mike via Telegram (fire-and-forget)
  try {
    await sendProvisioningFailedTelegram({
      subdomain,
      stage: "stripe_payment",
      error: `Faktura feilet for ${tenant.email}. Stripe invoice=${invoice.id ?? "?"}.`,
      tenantEmail: tenant.email,
    });
  } catch (e) {
    console.error("[handleInvoicePaymentFailed] telegram failed:", e);
  }

  return { ok: true, detail: "locked" };
}

// ─── handleCheckoutSessionExpired ─────────────────────────────────────

/**
 * checkout.session.expired → rydd opp pending tenant + Stripe customer.
 *
 * Stripe fires denne ~24t etter at en Checkout-session er opprettet uten
 * å bli fullført. Vi bruker den til å rydde:
 *   - TenantRecord i sentral Upstash (hvis fortsatt "pending")
 *   - Stripe customer + alle subscriptions (via kaskaden)
 *   - Vercel/Upstash er ikke provisjonert ennå (skjer først på
 *     subscription.created), så de stegene blir "skipped"
 *
 * Idempotent: hvis tenant ikke lenger er "pending" (bruker har fullført
 * en ny session og er nå active) → ignorer og returner ok.
 *
 * D-070 caller-ansvar: kaskaden er authoritativ for sletting, vi caller
 * den med context="cron" så audit-loggen viser hvor sletting kom fra.
 */
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const subdomain = await findSubdomainFromEvent(event);
  if (!subdomain) return { ok: false, detail: "subdomain mangler" };

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    // Ingenting å rydde — kanskje allerede slettet av cron eller admin
    return { ok: true, detail: `tenant '${subdomain}' allerede borte` };
  }

  // Hvis tenant ikke lenger er pending → bruker har sannsynligvis fullført
  // en parallell session og er nå active. Ikke slett.
  if (tenant.status !== "pending") {
    return {
      ok: true,
      detail: `status='${tenant.status}' (ikke pending) — ignorerer expired`,
    };
  }

  // Logg expired-eventet før vi sletter
  await appendProvisioningEvent(subdomain, {
    timestamp: new Date().toISOString(),
    stage: "status_change",
    status: "ok",
    detail: `checkout.session.expired → kaskade-sletting startet`,
  });

  // Kall kaskaden — den rydder Stripe customer + sentral DB.
  // Vercel/Upstash er aldri provisjonert for pending → blir "skipped".
  const deleteResult = await deleteTenant(subdomain, "cron");

  if (!deleteResult.success) {
    return {
      ok: false,
      detail: `kaskade feilet: ${deleteResult.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    detail: `pending tenant slettet (stripe=${deleteResult.steps.stripe}, db=${deleteResult.steps.centralDb})`,
  };
}

