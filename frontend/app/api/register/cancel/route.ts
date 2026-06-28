/**
 * Ko | Do · Vault — v4.3 Iter 14.6 — POST /api/register/cancel
 *
 * Brukes når Stripe redirecter til cancel_url (bruker avbrøt Checkout).
 * Frigjør subdomenet umiddelbart ved å kalle kaskaden — i stedet for
 * å vente på cron (~1t) eller `checkout.session.expired` (~24t).
 *
 * Sikkerhetsguards (uten å kreve auth — endpointet er public fordi
 * cancel_url må fungere før bruker har en session hos oss):
 *   1. Subdomain MÅ være en gyldig pending TenantRecord
 *   2. status === "pending" — kan ikke "kansellere" en active tenant
 *   3. pendingExpiresAt MÅ være satt og være i fremtiden — beskyttelse
 *      mot tilfeldige requests; allerede utløpte ryddes av cron
 *
 * NB: vi sjekker IKKE `createdBy` her. Cron skipper admin-opprettede
 * tenants (D-069), men cancel-endepunktet skal ALLTID rydde fordi
 * brukeren har eksplisitt klikket avbryt i Stripe.
 *
 * Worst case ved misbruk: en angriper som vet en pending subdomain kan
 * rydde det noen minutter tidligere enn cron. Tenanten har ingen data
 * (Vercel/Upstash er ikke provisjonert ennå), så ingen verdi går tapt.
 * Subdomenet frigjøres bare litt tidligere.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { deleteTenant } from "@/lib/platform/delete-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CancelRequestBody {
  subdomain?: string;
}

export async function POST(req: Request) {
  let body: CancelRequestBody;
  try {
    body = (await req.json()) as CancelRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const subdomain = body.subdomain?.trim().toLowerCase() ?? "";
  if (!subdomain) {
    return NextResponse.json(
      { error: "missing_subdomain" },
      { status: 400 },
    );
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    // Allerede ryddet (av cron, webhook, eller dette endepunktet)
    // — returner ok så frontend ikke kaster feilmelding på bruker.
    return NextResponse.json({ ok: true, detail: "allerede borte" });
  }

  // Guard 1: kun pending kan ryddes via dette endepunktet
  if (tenant.status !== "pending") {
    return NextResponse.json(
      {
        ok: false,
        error: "not_pending",
        detail: `status='${tenant.status}' — kan ikke kansellere`,
      },
      { status: 409 },
    );
  }

  // NB: vi sjekker IKKE createdBy her. Selv om cron (D-069) skipper
  // admin-opprettede tenants, skal cancel-endepunktet ALLTID rydde —
  // bruker (eller Mike via test-knappen) har eksplisitt klikket
  // avbryt i Stripe Checkout, så vi respekterer det signalet uansett.

  // Guard 2: pendingExpiresAt må være satt og fortsatt gyldig
  if (!tenant.pendingExpiresAt) {
    return NextResponse.json(
      { ok: false, error: "no_pending_expires", detail: "ingen utløpstid satt" },
      { status: 409 },
    );
  }
  const expiresAtMs = Date.parse(tenant.pendingExpiresAt);
  if (isNaN(expiresAtMs) || expiresAtMs < Date.now()) {
    // Allerede utløpt — la cron rydde i sin neste runde
    return NextResponse.json({
      ok: true,
      detail: "allerede utløpt — cron rydder",
    });
  }

  // Kjør kaskaden (rydder Stripe customer + sentral DB; Vercel/Upstash
  // er typisk "skipped" for pending fordi de aldri ble provisjonert)
  try {
    const result = await deleteTenant(subdomain, "cron");
    if (!result.success) {
      console.error(
        `[register/cancel ${subdomain}] kaskade feilet:`,
        result.errors,
      );
      return NextResponse.json(
        { ok: false, error: "cascade_failed", detail: result.errors.join("; ") },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, subdomain });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[register/cancel ${subdomain}]`, err);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}
