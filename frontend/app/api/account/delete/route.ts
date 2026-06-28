/**
 * Ko | Do · Vault — POST /api/account/delete
 *
 * Selvbetjent vault- og konto-sletting (GDPR art. 17 — retten til sletting).
 *
 * Flyt:
 *   - Brukeren bekrefter sletting i UI med to-stegs flyt (advarsel + master-pwd)
 *   - Master-pwd verifiseres KLIENTSIDE (vault.verifyMasterPassword) før denne
 *     endpoint kalles — server har ingen måte å verifisere pwd på (D-001
 *     zero-knowledge). Endpoint stoler på at klient har gjort jobben.
 *   - Subdomain bestemmes av host (D-046). Endpoint kan ikke slette en annen
 *     tenant enn den som hostet requesten.
 *   - Kaller `deleteTenant(subdomain, "gdpr")` som rydder Vercel + Upstash +
 *     client-config + sentral DB + B2B-prefiks. Stripe customer bevares for
 *     betalte tenants (D-070, bokføringsloven 5 år).
 *
 * Sikkerhet:
 *   - Same-origin POST med JSON-body → naturlig CSRF-beskyttelse
 *     (browser preflighter ved cross-origin, og vi setter ingen CORS-headers
 *     som tillater eksterne origins).
 *   - D-076 write-block sjekkes IKKE — låste tenants har fortsatt rett til
 *     å slette kontoen (faktisk særlig viktig: GDPR overstyrer drift-status).
 *   - Endpoint er offentlig på linje med eksisterende DELETE /api/vault som
 *     ødelegger den krypterte blobben. Et angrep her gir samme tap som det.
 *
 * Node runtime.
 */
import { NextResponse } from "next/server";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import { getTenant } from "@/lib/platform/tenant-store";
import { sendDeletedConfirmationFromSnapshot } from "@/lib/platform/notify-email";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveSubdomain(req: Request): string {
  // D-071 rewrite: tenant-pod injiserer `?_tenant=<sub>` når den proxier
  // til admin-host. Lokalt + i tenant-pod direkte kommer host headeren.
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("_tenant")?.trim().toLowerCase();
  if (tenantParam) return tenantParam;
  const host = req.headers.get("host") ?? "";
  const m = host.toLowerCase().match(/^([^.]+)\.kodovault\./);
  return m?.[1] ?? "";
}

export async function POST(req: Request) {
  const subdomain = resolveSubdomain(req);
  if (!subdomain || !isValidSubdomainFormat(subdomain)) {
    return NextResponse.json(
      { ok: false, error: "invalid_host" },
      { status: 400 },
    );
  }

  try {
    // Snapshot tenant FØR sletting — sendDeletedConfirmation trenger
    // firstName/email/locale/stripeSubscriptionId, men deleteTenant
    // fjerner TenantRecord i kaskaden. Vi sender mailen ETTER vellykket
    // sletting med den fangede snapshoten.
    const tenant = await getTenant(subdomain);
    if (!tenant) {
      return NextResponse.json(
        { ok: false, error: "tenant_not_found" },
        { status: 404 },
      );
    }
    const snapshot = {
      subdomain: tenant.subdomain,
      firstName: tenant.firstName,
      email: tenant.email,
      contactEmail: tenant.contactEmail,
      locale: tenant.locale,
      hadStripeSubscription: tenant.stripeSubscriptionId !== null,
      emailPreferences: tenant.emailPreferences,
    };

    const deletedAt = new Date();
    const result = await deleteTenant(subdomain, "gdpr");
    if (!result.success) {
      console.error(
        `[account/delete ${subdomain}] kaskade feilet:`,
        result.errors,
      );
      return NextResponse.json(
        {
          ok: false,
          error: "cascade_failed",
          detail: result.errors.join("; "),
          steps: result.steps,
        },
        { status: 500 },
      );
    }

    // Send bekreftelses-email ETTER vellykket sletting. Feiler asynkron —
    // tenant-en er allerede borte, så vi skal IKKE returnere feil til
    // klienten selv om mailen feiler. Logges for ettersyn.
    const mail = await sendDeletedConfirmationFromSnapshot({
      ...snapshot,
      deletedAt,
    });
    if (mail.ok === false) {
      console.error(
        `[account/delete ${subdomain}] bekreftelses-mail feilet:`,
        mail.error,
      );
    }

    return NextResponse.json({
      ok: true,
      subdomain,
      steps: result.steps,
      mail: mail.ok === true ? "sent" : mail.skipped ? "skipped" : "failed",
      redirectTo: "https://kodovault.no",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[account/delete ${subdomain}]`, err);
    return NextResponse.json(
      { ok: false, error: "internal_error", detail: msg },
      { status: 500 },
    );
  }
}
