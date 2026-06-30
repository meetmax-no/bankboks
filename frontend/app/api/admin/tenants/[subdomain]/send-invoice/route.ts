/**
 * Ko | Do · Vault — Iter 20.4f (2026-06-26 · D-080) —
 * POST /api/admin/tenants/[subdomain]/send-invoice
 *
 * Mikes "Send testfaktura"-knapp for B2B-parents. Oppretter en Stripe-faktura
 * via `invoices.create({ collection_method: "send_invoice" })` med `quantity =
 * parent.maxLicenses` og price-ID basert på valgt billing-frekvens.
 *
 * Flyt:
 *   1. Mike trykker "Send testfaktura" i TenantDetailCard (kun synlig for
 *      B2B-parents med stripeCustomerId satt)
 *   2. Modal lar Mike velge "semiannual" (522 kr/seat × 6mnd) eller
 *      "yearly" (1 044 kr/seat × 12mnd)
 *   3. Frontend POSTer hit med `{ billing }`
 *   4. Vi oppretter et InvoiceItem på customer'en, deretter en Invoice som
 *      finaliseres + sendes (14 dagers due) via Stripe-emailen
 *   5. Når customer betaler → eksisterende `invoice.paid`-webhook plukker
 *      opp og setter `parent.plan = b2b_semiannual/b2b_yearly` +
 *      `parent.nextBillingDate` (cascade-unlock children om relevant)
 *
 * Sikkerhet: middleware-låst til `admin.kodovault.no` + krever Mike-session-
 * cookie. Returnerer 400/404 hvis tenant ikke er B2B-parent eller mangler
 * Stripe customer ID (Mike må først opprette customer i Stripe Dashboard
 * og sette stripeCustomerId via PATCH).
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { getStripeClient } from "@/lib/stripe/client";
import { getB2BPricing } from "@/lib/platform/client-config-store";
import { appendProvisioningEvent } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendInvoiceBody = {
  billing?: unknown;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const { subdomain } = await ctx.params;

  // ── Last parent-tenant + valider B2B ────────────────────────────
  const parent = await getTenant(subdomain);
  if (!parent) {
    return NextResponse.json(
      { error: "tenant_not_found", detail: `Tenant ${subdomain} finnes ikke.` },
      { status: 404 },
    );
  }
  if (parent.customerType !== "b2b" || parent.parentTenant !== null) {
    return NextResponse.json(
      {
        error: "not_a_b2b_parent",
        detail: "Faktura kan kun sendes for B2B parent-tenants.",
      },
      { status: 400 },
    );
  }
  if (!parent.stripeCustomerId) {
    return NextResponse.json(
      {
        error: "missing_stripe_customer",
        detail:
          "Parent-tenanten har ingen stripeCustomerId. Opprett kunde i Stripe Dashboard og PATCH stripeCustomerId først.",
      },
      { status: 400 },
    );
  }
  if (!parent.maxLicenses || parent.maxLicenses < 1) {
    return NextResponse.json(
      {
        error: "missing_max_licenses",
        detail:
          "Parent-tenanten må ha maxLicenses ≥ 1 før faktura kan sendes.",
      },
      { status: 400 },
    );
  }

  // ── Body-parsing + validering ───────────────────────────────────
  let body: SendInvoiceBody;
  try {
    body = (await req.json()) as SendInvoiceBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 },
    );
  }

  const billing = body.billing;
  if (billing !== "semiannual" && billing !== "yearly") {
    return NextResponse.json(
      {
        error: "invalid_billing",
        detail: "billing må være 'semiannual' eller 'yearly'.",
      },
      { status: 400 },
    );
  }

  // ── Hent per-seat-pris fra D-127 client-config (single source of truth) ──
  // D-131 (2026-02 · Mike): tidligere brukte vi STRIPE_PRICE_B2B_SEMIANNUAL/
  // _YEARLY direkte i `invoiceItems.create({ pricing: { price } })`. Det
  // feilet med "type=recurring not allowed" fordi env-ID-ene er recurring
  // subscription-priser i Stripe Dashboard — `invoiceItems` krever
  // `type=one_time`. Fiks: bygg invoice-item inline med `amount + currency`
  // basert på D-127 `getB2BPricing()` som er sannhetskilde for B2B-priser.
  // Stripe Dashboard-prisene fortsetter å brukes når en ekte subscription
  // opprettes (det er da `subscription.created`-webhook setter parent.plan).
  const pricing = await getB2BPricing(parent.subdomain);
  const unitAmountNok =
    billing === "semiannual" ? pricing.semiannualPerSeat : pricing.yearlyPerSeat;
  if (!Number.isFinite(unitAmountNok) || unitAmountNok <= 0) {
    return NextResponse.json(
      {
        error: "invalid_pricing",
        detail: `B2B pricing.${billing}PerSeat er ugyldig (${unitAmountNok}). Sjekk client-config eller default.json.`,
      },
      { status: 500 },
    );
  }
  // Stripe forventer minor units (øre for NOK). 522 kr → 52 200 øre.
  const unitAmountOre = Math.round(unitAmountNok * 100);
  const totalOre = unitAmountOre * parent.maxLicenses;

  // D-133 (2026-02): idempotency-key for hele send-invoice-operasjonen.
  // Stabil per (tenant, billing, seats, dato) — hvis Mike klikker "Bekreft
  // og send" to ganger samme dag med samme parametere returnerer Stripe
  // samme invoice i stedet for å opprette en duplikat. Dato-suffiks lar
  // Mike kjøre samme operasjon dagen etter (forventet bruk: én faktura
  // per periode). Brukes på BÅDE invoiceItems.create og invoices.create
  // så hele kjeden er idempotent — ellers ville en retry attache et
  // duplikat-item til samme invoice.
  const idempoDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const idempoBase = `b2b-invoice:${parent.subdomain}:${billing}:${parent.maxLicenses}:${idempoDate}`;

  // ── Stripe: opprett InvoiceItem + Invoice + send ───────────────
  const stripe = getStripeClient();
  try {
    // 1. Legg invoice item på customer'en. Når vi kaller invoices.create
    //    etterpå plukker Stripe opp dette pending-item'et automatisk.
    //    D-131: bruker `amount + currency` direkte (totalbeløp i øre) i
    //    stedet for `pricing.price` (som krever one_time-price-ID som vi
    //    ikke har — env-ID-ene er recurring for subscription-flowen).
    //    Description bærer per-seat-breakdown så Stripe-UI viser detaljer.
    //
    //    D-134 (2026-02 · MVA): `tax_behavior: "exclusive"` — 522 kr er
    //    pris FØR MVA, Stripe legger til 25% norsk MVA via automatic_tax.
    //    Uten dette flagges fakturaen i Stripe Dashboard og kan ikke
    //    sendes via Stripe-emailen før tax-behaviour er konfigurert.
    await stripe.invoiceItems.create(
      {
        customer: parent.stripeCustomerId,
        amount: totalOre,
        currency: "nok",
        tax_behavior: "exclusive",
        description: `Ko|Do Vault B2B — ${parent.maxLicenses} seats × ${unitAmountNok} kr (${billing})`,
      },
      { idempotencyKey: `${idempoBase}:item` },
    );

    // 2. Opprett invoice som send_invoice-collection (Stripe sender email
    //    til kunden, 14 dagers due-frist).
    //    D-132 (2026-02): `auto_advance: false` — vi eier livssyklusen
    //    eksplisitt (finalize → send). Tidligere `auto_advance: true` lagde
    //    en race der Stripe auto-finaliserte og auto-sendte samtidig som vi
    //    manuelt kalte `sendInvoice`, og Stripe svarte "This invoice cannot
    //    be sent right now" på det manuelle send-kallet.
    //
    //    D-134 (2026-02 · MVA): `automatic_tax: { enabled: true }` — Stripe
    //    beregner og legger til norsk MVA basert på customer'ens adresse
    //    (Stripe Tax må være aktivert på kontoen + customer.address satt).
    //    Sameksisterer med tax_behavior på invoice-item-et.
    const invoice = await stripe.invoices.create(
      {
        customer: parent.stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: 14,
        auto_advance: false,
        automatic_tax: { enabled: true },
        metadata: {
          kodo_subdomain: parent.subdomain,
          kodo_tenant_prefix: parent.tenantPrefix ?? "",
          kodo_billing: billing,
          kodo_max_licenses: String(parent.maxLicenses),
          kodo_source: "admin_send_invoice_btn",
        },
      },
      { idempotencyKey: `${idempoBase}:invoice` },
    );

    // 3. Finaliser eksplisitt (auto_advance=false → vi må selv).
    if (!invoice.id) {
      throw new Error("Stripe returnerte invoice uten id");
    }
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    // 4. Send fakturaen til kundens e-post. Stripe kun aksepterer dette
    //    når invoice.status === "open" (etter finalize). Hvis ikke åpen,
    //    rapporter detaljert feil i stedet for kryptisk "cannot be sent".
    if (finalized.status !== "open") {
      throw new Error(
        `Kan ikke sende: invoice.status='${finalized.status}' (forventet 'open' etter finalize)`,
      );
    }
    await stripe.invoices.sendInvoice(invoice.id);

    // 5. Logg event på parent
    await appendProvisioningEvent(parent.subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "ok",
      detail: `stripe_invoice_sent: Mike sendte testfaktura (${billing}, ${parent.maxLicenses} seats) → invoice=${invoice.id ?? "?"}`,
    });

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      amountDue: invoice.amount_due,
      currency: invoice.currency,
      dueDate: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString()
        : null,
      billing,
      quantity: parent.maxLicenses,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Logg feilen på provisioning-log slik at Mike ser den i admin-loggen
    await appendProvisioningEvent(parent.subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "failed",
      detail: `stripe_invoice_sent: Send testfaktura feilet (${billing}): ${msg}`,
    }).catch(() => {});

    return NextResponse.json(
      {
        error: "stripe_call_failed",
        detail: msg,
      },
      { status: 502 },
    );
  }
}
