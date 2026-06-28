/**
 * Ko | Do · Vault — v4.3 Iter 1 — /api/admin/tenants/[subdomain]
 *
 * GET    → hent én TenantRecord
 * DELETE → slett TenantRecord
 *
 * Beskyttet av middleware. Idempotent DELETE.
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import { markInvitesAsChildDeleted } from "@/lib/platform/invite-store";
import { validateOrgNumber } from "@/lib/platform/org-number-validation";
import { getStripeClient } from "@/lib/stripe/client";
import type {
  CreatedBy,
  Plan,
  TenantStatus,
} from "@/lib/platform/tenant-types";
import { buildAuditLines } from "@/lib/platform/tenant-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

const VALID_PLANS: Plan[] = [
  "trial",
  "monthly",
  "yearly",
  "b2b_semiannual",
  "b2b_yearly",
  "free",
];
const VALID_STATUSES: TenantStatus[] = [
  "active",
  "trial",
  "locked",
  "cancelled",
  "deleted",
  "pending",
  "provisioning_failed",
  "invoice_failed",
];
const VALID_LOCALES = ["no", "sv", "da", "en"] as const;

// Enkel e-post-validering (samme som /api/register-flyten).
function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// ISO-dato eller null (string blir nullet ved tom streng)
function parseIsoOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  if (v === "") return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  return v.trim() === "" ? null : v.trim();
}

export async function GET(_req: Request, { params }: Params) {
  const { subdomain } = await params;
  try {
    const record = await getTenant(subdomain);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ tenant: record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/tenants GET one]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { subdomain } = await params;
  let body: {
    plan?: Plan;
    status?: TenantStatus;
    lifecycleEmails?: boolean;
    trialEndsAt?: string | null;
    lockedAt?: string | null;
    cancelledAt?: string | null;
    cancelEffectiveAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    deletedAt?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeInvoiceId?: string | null;
    notes?: string | null;
    // Iter 19.9.9 — redigerbare identitets-felter
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
    locale?: "no" | "sv" | "da" | "en" | null;
    createdBy?: string;
    // D-104 (2026-06-28) — redigerbare B2B firma-/kontakt-/faktura-felter
    companyName?: string | null;
    orgNumber?: string | null;
    vatNumber?: string | null;
    companyStreet?: string | null;
    companyPostalCode?: string | null;
    companyCity?: string | null;
    companyCountry?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    billingStreet?: string | null;
    billingPostalCode?: string | null;
    billingCity?: string | null;
    billingCountry?: string | null;
    billingEmail?: string | null;
    billingReference?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const before = await getTenant(subdomain);
    if (!before) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Clone slik at vi kan sammenligne for audit-log
    const record = { ...before, emailPreferences: { ...before.emailPreferences } };

    if (body.plan !== undefined) {
      if (!VALID_PLANS.includes(body.plan)) {
        return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
      }
      record.plan = body.plan;
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: "invalid_status" }, { status: 400 });
      }
      record.status = body.status;
    }
    if (body.lifecycleEmails !== undefined) {
      record.emailPreferences = {
        transactional: true,
        lifecycle: !!body.lifecycleEmails,
      };
    }

    // D-054: lifecycle-datoer kan settes eller nullstilles
    const dateFields = [
      "trialEndsAt",
      "lockedAt",
      "cancelledAt",
      "cancelEffectiveAt",
      "deletedAt",
    ] as const;
    for (const f of dateFields) {
      if (body[f] !== undefined) {
        const parsed = parseIsoOrNull(body[f]);
        if (parsed === undefined) {
          return NextResponse.json(
            { error: "invalid_date", field: f },
            { status: 400 },
          );
        }
        if (f === "trialEndsAt" && parsed === null) {
          return NextResponse.json(
            { error: "invalid_date", field: "trialEndsAt", detail: "kan ikke nullstilles" },
            { status: 400 },
          );
        }
        (record as Record<string, unknown>)[f] = parsed;
      }
    }

    // D-053: manuell Stripe-kobling
    const stripeFields = [
      "stripeCustomerId",
      "stripeSubscriptionId",
      "stripeInvoiceId",
    ] as const;
    for (const f of stripeFields) {
      if (body[f] !== undefined) {
        const parsed = strOrNull(body[f]);
        if (parsed === undefined) {
          return NextResponse.json(
            { error: "invalid_string", field: f },
            { status: 400 },
          );
        }
        (record as Record<string, unknown>)[f] = parsed;
      }
    }

    // Iter 19.7 (2026-06-13): admin kan manuelt overstyre cancelAtPeriodEnd.
    if (body.cancelAtPeriodEnd !== undefined) {
      record.cancelAtPeriodEnd = body.cancelAtPeriodEnd === true;
    }

    // Iter 19.9.9 — redigerbare identitets-felter i admin TenantViewer.
    // firstName/lastName/createdBy = fritekst, email valideres mot regex,
    // locale whitelistmes mot 4-språks-settet. Hver endring fanges av
    // buildAuditLines og appendes til provisioningLog automatisk.
    if (body.firstName !== undefined) {
      const parsed = strOrNull(body.firstName);
      if (parsed === undefined) {
        return NextResponse.json(
          { error: "invalid_string", field: "firstName" },
          { status: 400 },
        );
      }
      record.firstName = parsed;
    }
    if (body.lastName !== undefined) {
      const parsed = strOrNull(body.lastName);
      if (parsed === undefined) {
        return NextResponse.json(
          { error: "invalid_string", field: "lastName" },
          { status: 400 },
        );
      }
      record.lastName = parsed;
    }
    if (body.email !== undefined) {
      if (!isValidEmail(body.email)) {
        return NextResponse.json(
          { error: "invalid_email" },
          { status: 400 },
        );
      }
      record.email = body.email.toLowerCase().trim();
    }
    if (body.locale !== undefined) {
      if (
        body.locale !== null &&
        !VALID_LOCALES.includes(body.locale as (typeof VALID_LOCALES)[number])
      ) {
        return NextResponse.json(
          { error: "invalid_locale" },
          { status: 400 },
        );
      }
      record.locale = body.locale;
    }
    if (body.createdBy !== undefined) {
      // Fritekst per Mike-direktiv 2026-06-25. Verifiserer kun at det er
      // en ikke-tom streng — lifecycle-guard sjekker `=== "admin"` så ingen
      // andre verdier endrer atferd nedstrøms.
      if (typeof body.createdBy !== "string" || body.createdBy.trim() === "") {
        return NextResponse.json(
          { error: "invalid_string", field: "createdBy" },
          { status: 400 },
        );
      }
      record.createdBy = body.createdBy.trim() as CreatedBy;
    }

    // D-104 (2026-06-28) — B2B firma-/kontakt-/faktura-felter redigerbare
    // i Oversikt-fanen. Hvert felt valideres individuelt, tomme strenger
    // koerseres til null. orgNumber valideres via samme `validateOrgNumber()`
    // som brukes i opprettelses-skjemaet (norsk/svensk/dansk mod-11/Luhn).
    const B2B_STRING_FIELDS = [
      "companyName",
      "orgNumber",
      "vatNumber",
      "companyStreet",
      "companyPostalCode",
      "companyCity",
      "companyCountry",
      "contactName",
      "contactPhone",
      "billingStreet",
      "billingPostalCode",
      "billingCity",
      "billingCountry",
      "billingReference",
    ] as const;
    for (const f of B2B_STRING_FIELDS) {
      if (body[f] !== undefined) {
        const parsed = strOrNull(body[f]);
        if (parsed === undefined) {
          return NextResponse.json(
            { error: "invalid_string", field: f },
            { status: 400 },
          );
        }
        (record as Record<string, unknown>)[f] = parsed;
      }
    }
    // orgNumber: server-side checksum-validering. Bruker det landet som er
    // EFFEKTIVT etter PATCH (kan endres i samme request). Tomt org.nr er ok.
    if (body.orgNumber !== undefined && record.orgNumber) {
      const effectiveCountry = record.companyCountry ?? "";
      const orgCheck = validateOrgNumber(record.orgNumber, effectiveCountry);
      if (!orgCheck.valid) {
        return NextResponse.json(
          {
            error: "invalid_org_number",
            field: "orgNumber",
            detail: orgCheck.reason,
          },
          { status: 400 },
        );
      }
    }
    // contactEmail og billingEmail valideres som e-post hvis satt
    for (const f of ["contactEmail", "billingEmail"] as const) {
      if (body[f] !== undefined) {
        const v = body[f];
        if (v === null || v === "") {
          record[f] = null;
        } else if (!isValidEmail(v)) {
          return NextResponse.json(
            { error: "invalid_email", field: f },
            { status: 400 },
          );
        } else {
          record[f] = (v as string).toLowerCase().trim();
        }
      }
    }

    // D-065: strukturerte events for status- og felt-endringer skrives til
    // provisioningLog (konto-loggen). Notes forblir ren brukerredigert tekst.
    // (Tidligere D-054 appendet audit-linjer til notes — fjernet 2026-06-13
    // siden D-065 dekker behovet og duplisering forvirret bruker.)
    const auditLines = buildAuditLines(before, record);

    if (body.notes !== undefined) {
      const cleaned = strOrNull(body.notes);
      record.notes = cleaned ?? null;
    }

    const statusChanged = before.status !== record.status;
    if (statusChanged) {
      record.provisioningLog = [
        ...record.provisioningLog,
        {
          timestamp: new Date().toISOString(),
          stage: "status_change",
          status: "ok",
          detail: `${before.status} → ${record.status}`,
        },
      ];
    }
    if (auditLines.length > 0 && !statusChanged) {
      record.provisioningLog = [
        ...record.provisioningLog,
        {
          timestamp: new Date().toISOString(),
          stage: "admin_override",
          status: "ok",
          detail: auditLines.join("; "),
        },
      ];
    }

    await putTenant(record);

    // D-104 (2026-06-28) — Stripe Customer auto-sync.
    // Hvis (a) tenant er B2B, (b) har stripeCustomerId satt, og (c) minst
    // ett av Stripe-relevante feltene er endret → push oppdatering til Stripe
    // Customer-objektet. Brukerens valg 2026-06-28: kun for B2B-tenanter
    // med stripeCustomerId. Ingen grunn til å synce noe som ikke er koblet
    // til Stripe ennå.
    //
    // Vi feiler IKKE PATCH hvis Stripe-update feiler — local lagring er
    // allerede commit-et. Loggføres som "stripe_sync_failed"-event så Mike
    // ser det i konto-loggen og kan retry manuelt via "Sync Stripe"-knappen.
    if (
      record.customerType === "b2b" &&
      record.stripeCustomerId &&
      typeof record.stripeCustomerId === "string"
    ) {
      const stripeRelevantChanged =
        before.companyName !== record.companyName ||
        before.contactEmail !== record.contactEmail ||
        before.contactPhone !== record.contactPhone ||
        before.companyStreet !== record.companyStreet ||
        before.companyPostalCode !== record.companyPostalCode ||
        before.companyCity !== record.companyCity ||
        before.companyCountry !== record.companyCountry;
      if (stripeRelevantChanged) {
        try {
          const stripe = getStripeClient();
          await stripe.customers.update(record.stripeCustomerId, {
            name: record.companyName ?? undefined,
            email:
              record.contactEmail ??
              record.billingEmail ??
              record.email ??
              undefined,
            phone: record.contactPhone ?? undefined,
            address: {
              line1: record.companyStreet ?? undefined,
              postal_code: record.companyPostalCode ?? undefined,
              city: record.companyCity ?? undefined,
              country: record.companyCountry ?? undefined,
            },
          });
          record.provisioningLog = [
            ...record.provisioningLog,
            {
              timestamp: new Date().toISOString(),
              stage: "stripe_customer_sync",
              status: "ok",
              detail: `synced to ${record.stripeCustomerId}`,
            },
          ];
          // Persister log-tillegget (best-effort — feil her ignoreres).
          await putTenant(record).catch(() => undefined);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("[admin/tenants PATCH] stripe sync failed:", e);
          record.provisioningLog = [
            ...record.provisioningLog,
            {
              timestamp: new Date().toISOString(),
              stage: "stripe_customer_sync",
              status: "failed",
              detail: msg,
            },
          ];
          await putTenant(record).catch(() => undefined);
          // Returner suksess for lokal lagring, men inkluder sync-warning
          return NextResponse.json({
            tenant: record,
            warning: "stripe_sync_failed",
            stripeError: msg,
          });
        }
      }
    }

    return NextResponse.json({ tenant: record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/tenants PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { subdomain } = await params;
  try {
    // D-038: B2B-parent med aktive lisenser kan ikke slettes — admin må først
    // slette barn-tenantene. Beholdes som hard-blokk pre-kaskaden så vi ikke
    // begynner å rive ned Vercel/Upstash for så å havne i halv-tilstand.
    const tenant = await getTenant(subdomain);
    if (
      tenant &&
      tenant.customerType === "b2b" &&
      tenant.tenantPrefix &&
      (tenant.activeLicenses ?? 0) > 0
    ) {
      return NextResponse.json(
        {
          error: "active_licenses_exist",
          detail: `Kan ikke slette — ${tenant.activeLicenses} aktive lisenser under prefikset "${tenant.tenantPrefix}".`,
        },
        { status: 409 },
      );
    }

    // Kaskade-sletting: Vercel + Upstash + client-config + sentral DB +
    // B2B-prefiks. Soft-failure per steg; success=true betyr at sentral DB
    // er faktisk slettet (caller kan tolke det som "tenant er borte").
    const result = await deleteTenant(subdomain, "admin");

    // D-101 (Mike 2026-06-28): Arkiv-markering — sett childDeletedAt på alle
    // invite-records som peker på dette subdomenet. Bevarer historikken
    // (audit-trail) men UI markerer dem som "Arkivert" istedenfor som
    // hengende orphans. Soft-failure: hvis stempling feiler, fortsetter vi.
    if (result.success) {
      try {
        const stamped = await markInvitesAsChildDeleted(subdomain);
        if (stamped > 0) {
          console.info(
            `[admin/tenants DELETE] arkivert ${stamped} invite(s) for ${subdomain}`,
          );
        }
      } catch (archiveErr) {
        console.warn(
          `[admin/tenants DELETE] kunne ikke arkivere invites for ${subdomain}:`,
          archiveErr,
        );
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/tenants DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
