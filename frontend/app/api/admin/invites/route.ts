/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — /api/admin/invites (D-056)
 *
 * GET ?parentTenant=<prefix>  → list invitasjoner for én parent
 * POST                         → opprett ny invitasjon
 *
 * Beskyttet av middleware (admin-session-cookie). Returnerer alltid
 * den fulle invitasjonslenken slik at Mike kan kopiere direkte.
 */
import { NextResponse } from "next/server";
import {
  createInvite,
  listInvitesForParent,
} from "@/lib/platform/invite-store";
import { findB2BTenantByPrefix, tenantExists } from "@/lib/platform/tenant-store";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import type { CreateInviteInput } from "@/lib/platform/invite-types";
import { buildInviteUrl } from "@/lib/platform/invite-url";
import { isSubdomainDeployed } from "@/lib/platform/subdomain-reachable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_LOCALES = new Set(["no", "sv", "da", "en"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parentTenant = searchParams.get("parentTenant")?.toLowerCase().trim();
  if (!parentTenant) {
    return NextResponse.json(
      { error: "missing_parent_tenant" },
      { status: 400 },
    );
  }
  try {
    const invites = await listInvitesForParent(parentTenant);
    return NextResponse.json({ invites });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/invites GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Partial<CreateInviteInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parentTenant = body.parentTenant?.toLowerCase().trim() ?? "";
  if (!parentTenant) {
    return NextResponse.json(
      { error: "missing_parent_tenant" },
      { status: 400 },
    );
  }

  const subdomain = body.subdomain?.toLowerCase().trim() ?? "";
  if (!subdomain) {
    return NextResponse.json({ error: "missing_subdomain" }, { status: 400 });
  }
  if (!isValidSubdomainFormat(subdomain)) {
    return NextResponse.json({ error: "invalid_subdomain" }, { status: 400 });
  }
  // Admin oppretter invitasjon — subdomenet MÅ starte med parent-prefiks
  // for å unngå at en ansatt-konto havner utenfor bedriftens territorium.
  if (!subdomain.startsWith(parentTenant + "-")) {
    return NextResponse.json(
      {
        error: "invalid_subdomain_prefix",
        detail: `Subdomenet må starte med "${parentTenant}-".`,
      },
      { status: 400 },
    );
  }

  if (body.email !== undefined && body.email !== "") {
    if (!EMAIL_RX.test(body.email)) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
    }
  }
  if (body.locale !== undefined && !VALID_LOCALES.has(body.locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  try {
    // 1. Parent eksisterer og er B2B
    const parent = await findB2BTenantByPrefix(parentTenant);
    if (!parent) {
      return NextResponse.json(
        { error: "parent_not_found" },
        { status: 404 },
      );
    }
    // 2. Subdomain ikke allerede tatt av en TenantRecord
    if (await tenantExists(subdomain)) {
      return NextResponse.json(
        { error: "subdomain_taken" },
        { status: 409 },
      );
    }
    // D-098 (2026-06-28, Mike): aktiv reachability-sjekk mot Vercel.
    // Sentral DB er ikke komplett — manuelt-provisjonerte B2C-vaults
    // finnes som Vercel-deploys uten sentral registrering. Uten denne
    // sjekken kunne en super-admin lage invite for subdomene som tilhører
    // noen andres deployede vault, og accept-flyten ville redirecte
    // ofret rett dit.
    if (await isSubdomainDeployed(subdomain)) {
      return NextResponse.json(
        {
          error: "subdomain_taken_external",
          detail: `Subdomenet ${subdomain}.kodovault.no peker allerede på en eksisterende vault. Velg et annet subdomene.`,
        },
        { status: 409 },
      );
    }
    // 3. Lisens-tak: activeLicenses < maxLicenses
    if (
      typeof parent.maxLicenses === "number" &&
      typeof parent.activeLicenses === "number" &&
      parent.activeLicenses >= parent.maxLicenses
    ) {
      return NextResponse.json(
        {
          error: "max_licenses_reached",
          detail: `${parent.activeLicenses}/${parent.maxLicenses} lisenser i bruk.`,
        },
        { status: 409 },
      );
    }
    // 4. Opprett invitasjon
    const invite = await createInvite({
      subdomain,
      parentTenant,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      locale: body.locale,
      createdBy: "admin",
      // D-095 (2026-06-28): snapshot-FK mot parent
      parentTenantCreatedAt: parent.createdAt,
    });
    const inviteUrl = buildInviteUrl(invite.token, invite.parentTenant);

    // Iter 20.3: Auto-mail via Resend (idempotent via mailSentAt)
    let mailSent = false;
    let mailDetail: string | undefined;
    if (invite.email) {
      const { sendInviteEmail } = await import("@/lib/platform/notify-email");
      const { putInvite } = await import("@/lib/platform/invite-store");
      const orgName =
        [parent.firstName, parent.lastName].filter(Boolean).join(" ").trim() ||
        parent.subdomain;
      const r = await sendInviteEmail({
        recipientEmail: invite.email,
        recipientFirstName: invite.firstName,
        recipientLocale: invite.locale,
        orgName,
        inviteUrl,
      });
      if (r.ok) {
        const now = new Date().toISOString();
        await putInvite({ ...invite, mailSentAt: now });
        invite.mailSentAt = now;
        mailSent = true;
      } else {
        mailDetail = r.reason ?? r.error;
      }
    }
    // D-065: log invite_sent på parent-tenanten (child eksisterer ikke ennå)
    // Bruker `parent` fra ytre scope (allerede hentet på linje 106).
    try {
      const { logEvent } = await import("@/lib/platform/provisioning-log");
      await logEvent(
        parent.subdomain,
        "invite_sent",
        "ok",
        `child=${subdomain} email=${body.email}`,
      );
      if (mailSent) {
        await logEvent(
          parent.subdomain,
          "invite_mail_sent",
          "ok",
          `child=${subdomain}`,
        );
      }
    } catch (e) {
      console.error("[admin/invites POST] log invite_sent failed:", e);
    }
    return NextResponse.json(
      { invite, inviteUrl, mailSent, mailDetail },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/invites POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
