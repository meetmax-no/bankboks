/**
 * Ko | Do · Vault — v4.3 Iter 8/10 — Provisjonerings-varsling
 *
 * Iter 10 (D-068): faktisk Telegram-sending implementert.
 * Resend-velkomstmail håndteres via notify-email.ts ved vault_live.
 */
import { sendProvisioningFailedTelegram } from "./notify-telegram";

export interface ProvisionFailureContext {
  subdomain: string;
  stage: "github" | "vercel" | "upstash" | "email";
  error: unknown;
  tenantEmail?: string | null;
  parentTenant?: string | null;
}

export async function notifyProvisioningFailure(
  ctx: ProvisionFailureContext,
): Promise<void> {
  const errMsg =
    ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
  console.error("[PROVISION_FAILED]", {
    subdomain: ctx.subdomain,
    stage: ctx.stage,
    error: errMsg,
    tenantEmail: ctx.tenantEmail ?? null,
    parentTenant: ctx.parentTenant ?? null,
    timestamp: new Date().toISOString(),
  });
  // Iter 10: send Telegram (fire-and-forget, kaster ikke)
  try {
    await sendProvisioningFailedTelegram({
      subdomain: ctx.subdomain,
      stage: ctx.stage,
      error: errMsg,
      tenantEmail: ctx.tenantEmail ?? undefined,
      parentTenant: ctx.parentTenant ?? undefined,
    });
  } catch (e) {
    console.error("[notify] Telegram failure varsling kastet:", e);
  }
}
