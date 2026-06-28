/**
 * Ko | Do · Vault — Iter 20.3 — am-admin invitasjoner
 *
 * GET  → list invitasjoner for am-admin sin egen tenantPrefix
 * POST → opprett ny invitasjon + send auto-mail via Resend
 *
 * Speiler `/api/admin/invites` men autoriserer via am-admin-session.
 * Cross-org: alle handlinger er begrenset til admin.tenantPrefix.
 *
 * Per blokker-svar 1=b (per-org subdomain) og Mike-direktiv 2026-06-26
 * om auto-invite-mail.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAmAdmin } from "@/lib/platform/am-admin-session-helper";
import {
  createInvite,
  listInvitesForParent,
  putInvite,
  countActivePendingInvites,
} from "@/lib/platform/invite-store";
import {
  findB2BTenantByPrefix,
  listTenants,
  tenantExists,
} from "@/lib/platform/tenant-store";
import { countLiveActiveLicenses } from "@/lib/platform/seat-counter";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import { sendInviteEmail } from "@/lib/platform/notify-email";
import { logEvent } from "@/lib/platform/provisioning-log";
import type { CreateInviteInput } from "@/lib/platform/invite-types";
import {
  computeB2BBillingState,
  shouldBlockNewInvites,
} from "@/lib/platform/b2b-billing";
import { buildInviteUrl } from "@/lib/platform/invite-url";
import { isSubdomainDeployed } from "@/lib/platform/subdomain-reachable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_LOCALES = new Set(["no", "sv", "da", "en"]);

export async function GET(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const invites = await listInvitesForParent(admin.tenantPrefix);
  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  let body: Partial<CreateInviteInput>;
  try {
    body = (await req.json()) as Partial<CreateInviteInput>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // parentTenant overstyres alltid til admin.tenantPrefix — am-admin
  // kan ikke opprette invites i annen org.
  const parentTenant = admin.tenantPrefix;
  const subdomain = body.subdomain?.toLowerCase().trim() ?? "";
  if (!subdomain) {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }
  if (!isValidSubdomainFormat(subdomain)) {
    return NextResponse.json({ error: "invalid_subdomain" }, { status: 400 });
  }
  if (!subdomain.startsWith(parentTenant + "-")) {
    return NextResponse.json(
      {
        error: "invalid_subdomain_prefix",
        detail: `Subdomenet må starte med "${parentTenant}-".`,
      },
      { status: 400 },
    );
  }
  if (body.email && !EMAIL_RX.test(body.email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (body.locale && !VALID_LOCALES.has(body.locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  // Parent + lisens-tak-sjekk
  const parent = await findB2BTenantByPrefix(parentTenant);
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  // Iter 20.4c (D-080 · 2026-06-26): blokker nye invitasjoner hvis parent
  // er i grace- eller expired-fasen. Eksisterende ansatte fungerer fortsatt,
  // men am-admin må først betale forfalt faktura før hen kan invitere flere.
  // Per blokker-svar 4=B: tillat all annen forvaltning (suspendere, slette).
  const billingState = computeB2BBillingState(parent, new Date());
  if (shouldBlockNewInvites(billingState)) {
    return NextResponse.json(
      {
        error: "grace_period_active",
        detail:
          "Abonnementet til organisasjonen er utløpt. Forny faktureringen før du oppretter nye invitasjoner.",
        phase: billingState.phase,
        graceEndsAt: billingState.graceEndsAt,
      },
      { status: 403 },
    );
  }

  if (await tenantExists(subdomain)) {
    return NextResponse.json({ error: "subdomain_taken" }, { status: 409 });
  }
  // D-098 (2026-06-28, Mike): aktiv reachability-sjekk. Sentral DB-registeret
  // er IKKE komplett — manuelt-provisjonerte B2C-vaults eksisterer som
  // Vercel-deploys uten å være registrert. Vi HEAD-er hosten for å fange
  // de tilfellene. Uten dette ville en super-admin kunne lage en invite
  // for et subdomene som tilhører noen andres deployede vault, og accept-
  // flyten ville sende invitasjons-mottakeren rett dit.
  if (await isSubdomainDeployed(subdomain)) {
    return NextResponse.json(
      {
        error: "subdomain_taken_external",
        detail: `Subdomenet ${subdomain}.kodovault.no peker allerede på en eksisterende vault. Velg et annet subdomene.`,
      },
      { status: 409 },
    );
  }
  // D-092 (2026-06-28) — Hybrid-seat:
  // activeLicenses + activeInvites (pending, ikke utløpt) ≤ maxLicenses.
  // maxLicenses=null eller 0 → skipper sjekken (B2C eller ubegrenset).
  // D-111 (2026-06-29): activeLicenses tellet LIVE.
  if (typeof parent.maxLicenses === "number" && parent.maxLicenses > 0) {
    const allTenants = await listTenants();
    const activeLicenses = countLiveActiveLicenses(parentTenant, allTenants);
    const pendingInvites = await countActivePendingInvites(parentTenant);
    const inUse = activeLicenses + pendingInvites;
    if (inUse >= parent.maxLicenses) {
      return NextResponse.json(
        {
          error: "max_licenses_reached",
          detail: `${activeLicenses} aktive + ${pendingInvites} pending = ${inUse} av ${parent.maxLicenses} lisenser i bruk. Frigjør seat ved å slette pending-invite eller utvid lisensen.`,
          activeLicenses,
          pendingInvites,
          maxLicenses: parent.maxLicenses,
        },
        { status: 409 },
      );
    }
  }

  const invite = await createInvite({
    subdomain,
    parentTenant,
    email: body.email,
    firstName: body.firstName,
    lastName: body.lastName,
    locale: body.locale,
    createdBy: "am-admin",
    // D-095 (2026-06-28): snapshot-FK mot parent
    parentTenantCreatedAt: parent.createdAt,
  });
  const inviteUrl = buildInviteUrl(invite.token, invite.parentTenant);

  // Auto-mail via Resend (idempotent — sjekker mailSentAt)
  let mailResult: { ok: boolean; reason?: string } = { ok: false, reason: "not_attempted" };
  if (invite.email) {
    const orgName =
      [parent.firstName, parent.lastName].filter(Boolean).join(" ").trim() ||
      parent.subdomain;
    const sendResult = await sendInviteEmail({
      recipientEmail: invite.email,
      recipientFirstName: invite.firstName,
      recipientLocale: invite.locale,
      orgName,
      inviteUrl,
    });
    if (sendResult.ok) {
      const now = new Date().toISOString();
      await putInvite({ ...invite, mailSentAt: now });
      invite.mailSentAt = now;
      mailResult = { ok: true };
    } else {
      mailResult = { ok: false, reason: sendResult.reason ?? sendResult.error };
    }
  }

  // Audit på parent
  try {
    await logEvent(
      parent.subdomain,
      "invite_sent",
      "ok",
      `child=${subdomain} email=${invite.email ?? "(none)"} by=${admin.email} (am-admin)`,
    );
    if (mailResult.ok) {
      await logEvent(
        parent.subdomain,
        "invite_mail_sent",
        "ok",
        `child=${subdomain}`,
      );
    }
  } catch (e) {
    console.error("[am-admin/invites POST] log feilet:", e);
  }

  return NextResponse.json(
    { invite, inviteUrl, mailSent: mailResult.ok, mailDetail: mailResult.reason },
    { status: 201 },
  );
}
