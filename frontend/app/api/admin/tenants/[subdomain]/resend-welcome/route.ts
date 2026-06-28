/**
 * Ko | Do · Vault — v4.3 Iter 10 (D-068) — Re-send velkomstmail
 *
 * POST /api/admin/tenants/[subdomain]/resend-welcome
 *
 * Force-sender velkomstmail på nytt, selv om `welcomeEmailSentAt` allerede
 * er satt. Brukes når mail havnet i spam eller kunden ba om ny kopi.
 *
 * Logger event på provisioningLog. Beskyttet av middleware (admin-cookie).
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant, appendProvisioningEvent } from "@/lib/platform/tenant-store";
import { sendWelcomeEmail } from "@/lib/platform/notify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { subdomain } = await params;
  try {
    const tenant = await getTenant(subdomain);
    if (!tenant) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Nullstill welcomeEmailSentAt midlertidig så sendWelcomeEmail ikke
    // skipper på idempotens
    const original = tenant.welcomeEmailSentAt;
    const tForSend = { ...tenant, welcomeEmailSentAt: null };
    const result = await sendWelcomeEmail(tForSend);

    if (result.ok) {
      const t = (await getTenant(subdomain)) ?? tenant;
      await putTenant({
        ...t,
        welcomeEmailSentAt: new Date().toISOString(),
      });
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "welcome_email_sent",
        status: "retried",
        detail: `admin re-send · Resend id=${result.emailId ?? "?"} til ${tenant.contactEmail ?? tenant.email}`,
      });
      return NextResponse.json({
        ok: true,
        emailId: result.emailId,
        previouslySentAt: original,
      });
    }

    if (result.skipped) {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "welcome_email_sent",
        status: "failed",
        detail: `admin re-send skipped: ${result.reason}`,
      });
      return NextResponse.json(
        { ok: false, error: "skipped", reason: result.reason },
        { status: 409 },
      );
    }

    await appendProvisioningEvent(subdomain, {
      timestamp: new Date().toISOString(),
      stage: "welcome_email_sent",
      status: "failed",
      detail: `admin re-send: ${result.error ?? "ukjent"}`,
    });
    return NextResponse.json(
      { ok: false, error: result.error ?? "unknown_error" },
      { status: 502 },
    );
  } catch (e) {
    console.error("[admin/resend-welcome 500]", e);
    const msg = e instanceof Error ? e.message : "unknown_error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
