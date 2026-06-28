/**
 * Ko | Do · Vault — v4.3 Iter 1 — /api/admin/tenants
 *
 * GET  → list alle TenantRecords (dekryptert)
 * POST → opprett ny TenantRecord (manuelt fra TenantViewer)
 *
 * Beskyttet av middleware (admin-session-cookie kreves).
 */
import { NextResponse } from "next/server";
import {
  createTenant,
  listTenants,
} from "@/lib/platform/tenant-store";
import { addReservedPrefix, isReservedPrefixTaken } from "@/lib/platform/subdomain";
import { tenantExists } from "@/lib/platform/tenant-store";
import { countActivePendingInvites } from "@/lib/platform/invite-store";
import { countLiveActiveLicenses } from "@/lib/platform/seat-counter";
import type {
  CreateTenantInput,
  Plan,
  TenantStatus,
} from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    const tenants = await listTenants();

    // D-103/D-103c/D-103e/D-104 (Mike 2026-06-28): Berik B2B-parents med
    // LIVE seat-tall via felles helper i `lib/platform/seat-counter.ts`.
    // Vi stoler IKKE på `activeLicenses`-feltet i sentral storage — det
    // inkrementeres ved invite-accept men dekrementeres ALDRI ved delete-
    // tenant (kjent bug). Logikken bor ett sted og brukes også av
    // B2B-Konsoll (`/api/am-admin/auth/me`) så telling er konsekvent.
    //
    // Per D-078 returneres KUN aggregerte tall.
    const enriched = await Promise.all(
      tenants.map(async (t) => {
        if (
          t.customerType === "b2b" &&
          !t.parentTenant &&
          t.tenantPrefix
        ) {
          const pendingInvitesCount = await countActivePendingInvites(
            t.tenantPrefix,
          );
          const liveActiveLicenses = countLiveActiveLicenses(
            t.tenantPrefix,
            tenants,
          );
          return {
            ...t,
            activeLicenses: liveActiveLicenses,
            pendingInvitesCount,
          };
        }
        return t;
      }),
    );

    return NextResponse.json({ tenants: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/tenants GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(s);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  let body: Partial<CreateTenantInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.subdomain || typeof body.subdomain !== "string") {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }
  if (!isValidSubdomain(body.subdomain.toLowerCase())) {
    return NextResponse.json({ error: "invalid_subdomain" }, { status: 400 });
  }
  if (!body.email || !isValidEmail(body.email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (body.customerType !== "b2c" && body.customerType !== "b2b") {
    return NextResponse.json({ error: "invalid_customer_type" }, { status: 400 });
  }
  // 2026-06-02 (Mike): Admin har full overstyringsrett — `isReservedSubdomain`
  // brukes KUN i selvbetjent /api/register + /api/register/paid. Admin kan
  // opprette hva som helst, inkludert `admin`, `am-admin`, `am-nils`, osv.
  // Eneste begrensninger her er format (regex) og duplikat (tenantExists).
  if (await tenantExists(body.subdomain.toLowerCase())) {
    return NextResponse.json({ error: "subdomain_taken" }, { status: 409 });
  }
  // Iter 20.9 (2026-06-27) — eksplisitt B2B prefiks-duplikat-sjekk (D-038
  // utvidet). Forhindrer at to ulike B2B-org-er reserverer samme prefiks
  // (f.eks. "mm" → ville gjort `mm-lars` tvetydig). Standard-flyt fanges
  // også indirekte av `tenantExists("<prefix>-admin")` over, men admin
  // kan overstyre `subdomain` til noe annet enn `<prefix>-admin` — denne
  // sjekken gardererer det tilfellet.
  if (
    body.customerType === "b2b" &&
    typeof body.tenantPrefix === "string" &&
    body.tenantPrefix.trim() !== ""
  ) {
    if (await isReservedPrefixTaken(body.tenantPrefix)) {
      return NextResponse.json(
        { error: "tenant_prefix_taken", detail: body.tenantPrefix.toLowerCase() },
        { status: 409 },
      );
    }
  }
  if (body.plan !== undefined && !VALID_PLANS.includes(body.plan)) {
    return NextResponse.json({ error: "invalid_plan" }, { status: 400 });
  }
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  if (body.trialDays !== undefined) {
    if (
      typeof body.trialDays !== "number" ||
      body.trialDays < 1 ||
      body.trialDays > 365
    ) {
      return NextResponse.json(
        { error: "invalid_trial_days", detail: "1-365" },
        { status: 400 },
      );
    }
  }
  // Iter 19.9.7 locale-fix: server-side whitelist mot tampering. Klienten
  // har allerede en obligatorisk radio-knapp, men adminer kan bypasse
  // via curl. Backend skal aldri lagre ugyldige locale-verdier.
  if (
    body.locale !== undefined &&
    !["no", "sv", "da", "en"].includes(body.locale as string)
  ) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  try {
    // 2026-06-02 (Mike): adminSubdomain = subdomain for B2B (auto-utledet,
    // ikke separat input). Overskriver alltid evt. medsendt verdi for å unngå
    // inkonsistens med subdomain-feltet.
    const input = body as CreateTenantInput;
    if (input.customerType === "b2b") {
      input.adminSubdomain = input.subdomain.toLowerCase();
    }
    const record = await createTenant(input, "admin");
    // D-038 utvidet: når B2B-tenant opprettes med tenantPrefix, legg til
    // i sentral Upstash SET så `<prefix>-*` blokkeres for B2C-registrering.
    if (record.customerType === "b2b" && record.tenantPrefix) {
      try {
        await addReservedPrefix(record.tenantPrefix);
      } catch (e) {
        // Logg men ikke fail — tenant er allerede opprettet
        console.error(
          "[admin/tenants POST] addReservedPrefix failed:",
          e,
        );
      }
    }

    // D-067 (2026-06-04): admin-create returnerer raskt uten provisjonering.
    // Frontend orkestrerer provisjonering via:
    //   1. POST /api/admin/tenants/<sub>/provision-upstash (separat lambda)
    //   2. POST /api/admin/tenants/<sub>/provision-vercel  (separat lambda)
    //   3. GET  /api/status?subdomain=<sub> polling til vault_live
    // Dette gir live progresjons-feedback i admin-UI (samme tracker som Skjerm 5).

    return NextResponse.json({ tenant: record }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    if (msg.includes("finnes allerede")) {
      return NextResponse.json({ error: "tenant_exists" }, { status: 409 });
    }
    console.error("[admin/tenants POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
