/**
 * Ko | Do · Vault — Iter 20.2 + 20.4c — GET /api/am-admin/auth/me
 *
 * Returnerer current session-payload + admin-public-record (uten passwordHash).
 * Brukes av UI-shell for å vise innlogget bruker. Krever gyldig session
 * (middleware sjekker).
 *
 * Iter 20.4c (2026-06-26 · D-080): inkluderer parent-tenant billing-state
 * så am-admin-UI kan rendre riktig faktura-banner (pre_expiry/grace/expired)
 * og deaktivere "Ny invitasjon" i grace-/expired-fasen.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ORG_ADMIN_SESSION_COOKIE,
  verifyOrgAdminSession,
} from "@/lib/platform/org-admin-auth";
import { getOrgAdmin } from "@/lib/platform/org-admin-store";
import { toOrgAdminPublic } from "@/lib/platform/org-admin-types";
import { findB2BTenantByPrefix, listTenants } from "@/lib/platform/tenant-store";
import { countLiveActiveLicenses } from "@/lib/platform/seat-counter";
import { countActivePendingInvites } from "@/lib/platform/invite-store";
import {
  computeB2BBillingState,
  type B2BBillingState,
} from "@/lib/platform/b2b-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Iter 20.9 (Mike 2026-06-28): Self-heal av "zombie-session" — en cookie
 * som er kryptografisk gyldig, men hvor OrgAdmin-recorden er slettet
 * (typisk etter D-091 cascade-delete av parent-tenanten). Tidligere
 * returnerte vi 404 «admin_not_found», som førte til en redirect-loop:
 * middleware lot brukeren passere fordi cookien var gyldig → dashbordet
 * kalte /auth/me → 404 → UI redirectet til `/` → middleware sendte til
 * dashbordet igjen. Resultat: blå skjerm som henger.
 *
 * Fiks: når sessionen er tom (verken cookie eller verifiserer), ELLER
 * når admin-recorden er borte / suspended, returnerer vi 401 og rydder
 * cookien. UI behandler 401 som «ikke logget inn» og redirecter til `/`,
 * og middleware ser ingen gyldig cookie → rewriter til login.
 */
function clearedUnauthorizedResponse(
  errorCode: "unauthorized" | "admin_not_found" | "account_suspended",
) {
  const res = NextResponse.json({ error: errorCode }, { status: 401 });
  res.cookies.set({
    name: ORG_ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(ORG_ADMIN_SESSION_COOKIE)?.value;
  const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
  const session = await verifyOrgAdminSession(cookie, secret);

  if (!session) {
    return clearedUnauthorizedResponse("unauthorized");
  }

  const admin = await getOrgAdmin(session.prefix, session.adminId);
  if (!admin) {
    // Zombie-session: cookie OK, men admin-record slettet (cascade-delete
    // av parent eller manuell sletting). Behandle som ikke-innlogget.
    return clearedUnauthorizedResponse("admin_not_found");
  }
  if (admin.suspended) {
    // Suspendert admin skal heller ikke ha aktiv session.
    return clearedUnauthorizedResponse("account_suspended");
  }

  // Iter 20.4c (D-080): hent parent-tenant og beregn billing-state.
  // Hvis parent ikke finnes (edge-case: admin-konto opprettet før parent),
  // returnerer vi billingState=null så UI kan håndtere graciøst.
  //
  // D-103e/D-104 (Mike 2026-06-28): activeLicenses må telles LIVE — det
  // lagrede feltet inkrementeres ved invite-accept men dekrementeres aldri
  // ved delete-tenant. Vi henter hele tenant-listen og teller ikke-slettede
  // children med matching `parentTenant === parent.tenantPrefix` (samme
  // logikk som /api/admin/tenants GET D-103e-fixen).
  let billingState: B2BBillingState | null = null;
  let parentSubdomain: string | null = null;
  let liveActiveLicenses = 0;
  let pendingLicenses = 0;
  const allTenants = await listTenants();
  const parent =
    allTenants.find(
      (t) => t.customerType === "b2b" && t.tenantPrefix === session.prefix,
    ) ?? null;
  if (parent) {
    billingState = computeB2BBillingState(parent, new Date());
    parentSubdomain = parent.subdomain;
    // D-103e/D-104: live seat-telling via felles helper. Aktive = ikke-
    // slettede children med parentTenant === prefix. Pending = aktive
    // invites (status="pending", ikke utløpt). Logikken bor i
    // `lib/platform/seat-counter.ts` så Super-admin og Konsoll teller likt.
    liveActiveLicenses = countLiveActiveLicenses(
      parent.tenantPrefix ?? "",
      allTenants,
    );
    pendingLicenses = await countActivePendingInvites(parent.tenantPrefix ?? "");
  }

  return NextResponse.json({
    session: {
      iat: session.iat,
      exp: session.exp,
    },
    admin: toOrgAdminPublic(admin),
    parent: parent
      ? {
          subdomain: parentSubdomain,
          status: parent.status,
          plan: parent.plan,
          trialEndsAt: parent.trialEndsAt,
          nextBillingDate: parent.nextBillingDate,
          maxLicenses: parent.maxLicenses,
          activeLicenses: liveActiveLicenses,
          pendingLicenses,
          billingState,
          // Iter 20.9 (D-084): leveres til ConsoleShell-headeren slik at
          // org-navnet vises i venstre pill. Org-info-tab leser også
          // tilstøtende felter (orgNumber, contact*).
          companyName: parent.companyName,
          orgNumber: parent.orgNumber,
          contactName: parent.contactName,
          contactEmail: parent.contactEmail,
          contactPhone: parent.contactPhone,
          // Iter 20.9 (D-086): default e-post-locale for org, vises i
          // Innstillinger → Generelle. Kun super-admin kan endre.
          locale: parent.locale,
        }
      : null,
  });
}
