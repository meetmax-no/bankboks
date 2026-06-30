/**
 * Ko | Do · Vault — Iter 20.4f (2026-06-26 · D-080) —
 * POST /api/admin/tenants/[subdomain]/send-invoice
 *
 * Mikes "Send faktura"-knapp for B2B-parents. Oppretter en Stripe-faktura
 * via `invoices.create({ collection_method: "send_invoice" })` med `quantity =
 * parent.maxLicenses` og price-ID basert på valgt billing-frekvens.
 *
 * Flyt:
 *   1. Mike trykker "Send faktura" i TenantDetailCard (kun synlig for
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

  // D-133/D-135 (2026-02): idempotency-key for hele send-invoice-operasjonen.
  // Stabil per (tenant, billing, seats, dato) — hvis Mike klikker "Bekreft
  // og send" to ganger samme dag med samme parametere returnerer Stripe
  // samme invoice i stedet for å opprette en duplikat. Dato-suffiks lar
  // Mike kjøre samme operasjon dagen etter (forventet bruk: én faktura
  // per periode). Brukes på BÅDE invoiceItems.create og invoices.create
  // så hele kjeden er idempotent — ellers ville en retry attache et
  // duplikat-item til samme invoice.
  //
  // D-135 (2026-02): `:v2`-suffix tvinger ny idempotency-cache. Tidligere
  // forsøk (før D-134 MVA-fiks) lagret en faulty invoice uten automatic_tax
  // i Stripes idempotency-cache; nye kall med samme key returnerte den
  // gamle ødelagte invoicen. v2 garanterer at vi treffer Stripes API på
  // nytt med ferske parametre.
  const idempoDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const idempoBase = `b2b-invoice:${parent.subdomain}:${billing}:${parent.maxLicenses}:${idempoDate}:v2`;

  // ── Stripe: opprett Invoice + InvoiceItem (eksplisitt-bundet) + send ──
  const stripe = getStripeClient();
  try {
    // 1. Opprett invoice FØRST som draft, med
    //    `pending_invoice_items_behavior: "exclude"` så Stripe ikke trekker
    //    inn orphan-items fra tidligere mislykkede forsøk (D-135).
    //
    //    D-132 (2026-02): `auto_advance: false` — vi eier livssyklusen
    //    eksplisitt (finalize → send). Tidligere `auto_advance: true` lagde
    //    en race der Stripe auto-finaliserte og auto-sendte samtidig som vi
    //    manuelt kalte `sendInvoice`.
    //
    //    D-134 (2026-02 · MVA): `automatic_tax: { enabled: true }` — Stripe
    //    beregner og legger til norsk MVA basert på customer.address
    //    (krever Stripe Tax aktivert + customer.address satt).
    const invoice = await stripe.invoices.create(
      {
        customer: parent.stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: 14,
        auto_advance: false,
        automatic_tax: { enabled: true },
        pending_invoice_items_behavior: "exclude",
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

    if (!invoice.id) {
      throw new Error("Stripe returnerte invoice uten id");
    }

    // 2. Bind invoice item eksplisitt til denne invoice'en (D-135).
    //    `invoice: invoice.id` garanterer at item havner på vår draft —
    //    ikke i den globale "pending items"-bucketen på customer'en hvor
    //    den kunne blitt blandet med orphans fra tidligere forsøk.
    //
    //    D-131: `amount + currency` direkte (vi har ikke en one_time price-ID).
    //    D-134 (MVA): `tax_behavior: "inclusive"` — 522 kr ER prisen inkl.
    //    25% norsk MVA. Stripe beregner baklengs: netto + MVA = 522. Tidligere
    //    `"exclusive"` la MVA på toppen → kunde fakturert 522 + 25% = 652,50 kr.
    //    Mike-direktiv 2026-02: prisen til kunden skal være 522 kr inkl. MVA.
    await stripe.invoiceItems.create(
      {
        customer: parent.stripeCustomerId,
        invoice: invoice.id,
        amount: totalOre,
        currency: "nok",
        tax_behavior: "inclusive",
        description: `Ko|Do Vault B2B — ${parent.maxLicenses} seats × ${unitAmountNok} kr inkl. MVA (${billing})`,
      },
      { idempotencyKey: `${idempoBase}:item` },
    );

    // 3. Finaliser KUN hvis fakturaen er i draft-state.
    //    D-140 (2026-02): idempotency-key kan returnere en allerede-finalisert
    //    invoice fra et tidligere forsøk samme dag (status="open" eller "paid").
    //    Stripe avviser re-finalize ("This invoice is already finalized, you
    //    can't re-finalize a non-draft invoice"). Vi hopper over finalize hvis
    //    status er noe annet enn "draft" — fakturaen er allerede klar.
    let finalized = invoice;
    if (invoice.status === "draft") {
      finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    }

    // 4. D-135 MVA-diagnostikk: Stripe kan finalize en invoice med
    //    `automatic_tax.status = "failed"` eller `"requires_location_inputs"`.
    //    I begge tilfeller refuserer Stripe å sende den (samme generiske
    //    "cannot be sent right now"-feilmelding som Mike så). Hent det
    //    presise status og gi Mike en actionable feilmelding så han kan
    //    fikse oppsettet i Stripe Dashboard.
    const tax = finalized.automatic_tax;
    if (tax && tax.enabled && tax.status && tax.status !== "complete") {
      const reason = tax.disabled_reason ?? tax.status;
      throw new Error(
        `Stripe Tax: ${reason}. Verifiser at customer '${parent.stripeCustomerId}' har komplett adresse (country=NO, postnummer, by) i Stripe Dashboard og at Stripe Tax har en aktiv tax registration for Norge.`,
      );
    }

    // 5. Send fakturaen til kundens e-post.
    //    D-140 (2026-02): hvis invoicen allerede er "paid"/"void"/
    //    "uncollectible" hopper vi over send (den er ferdig-håndtert).
    //    Hvis "open" kaller vi sendInvoice — Stripe re-sender e-post-en,
    //    nyttig hvis kunden ikke fikk den første gangen.
    //    Hvis "draft" etter steg 3 er noe alvorlig galt (skulle vært
    //    finalized) — feile deterministisk.
    if (finalized.status === "draft") {
      throw new Error(
        `Kan ikke sende: invoice.status='draft' etter finalize-forsøk (uventet)`,
      );
    }
    if (finalized.status === "open") {
      await stripe.invoices.sendInvoice(invoice.id);
    }
    // status "paid", "void", "uncollectible": ikke-handling, returner success.

    // 6. Logg event på parent
    await appendProvisioningEvent(parent.subdomain, {
      timestamp: new Date().toISOString(),
      stage: "status_change",
      status: "ok",
      detail: `stripe_invoice_sent: Mike sendte faktura (${billing}, ${parent.maxLicenses} seats) → invoice=${invoice.id ?? "?"}`,
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
      detail: `stripe_invoice_sent: Send faktura feilet (${billing}): ${msg}`,
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
