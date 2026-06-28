/**
 * Ko | Do · Vault — v4.3 Iter 10 (D-068 · 2026-06-04)
 *
 * Telegram-varsling til Mike via Bot API. Brukes til:
 *   - vault_live: "✅ Ny vault live: <subdomain>.kodovault.no"
 *   - provisioning_failed: "❌ Provisjonering feilet: <subdomain> (<stage>)"
 *
 * Aktiveringsregel (samme mønster som tannlege-per):
 *   - `TELEGRAM_BOT_TOKEN` må være satt
 *   - `TELEGRAM_CHAT_ID` må være satt (med minus for grupper)
 *   - `TELEGRAM_ENABLED=true` må være satt eksplisitt
 *
 * Mangler en av delene → returnerer `{ skipped: true }` uten å kaste.
 */
import type { TenantRecord } from "./tenant-types";

const TELEGRAM_API = "https://api.telegram.org";

export interface TelegramResult {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

function isTelegramEnabled():
  | { ok: true; botToken: string; chatId: string }
  | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const enabled = process.env.TELEGRAM_ENABLED === "true";
  if (!botToken || !chatId || !enabled) return null;
  return { ok: true, botToken, chatId };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendTelegramMessage(text: string): Promise<TelegramResult> {
  const cfg = isTelegramEnabled();
  if (!cfg) {
    return {
      skipped: true,
      reason: "telegram_disabled (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_ENABLED mangler)",
    };
  }
  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${cfg.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Telegram ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

/**
 * Send "ny vault live"-varsel til Mike.
 */
export async function sendVaultLiveTelegram(
  tenant: TenantRecord,
): Promise<TelegramResult> {
  const name = [tenant.firstName, tenant.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const text = [
    `✅ <b>Ny vault live</b>`,
    `${escapeHtml(tenant.subdomain)}.kodovault.no`,
    "",
    name ? `Kunde: ${escapeHtml(name)}` : null,
    `Plan: ${escapeHtml(tenant.plan)}`,
    `Customer: ${escapeHtml(tenant.customerType)}`,
    `Opprettet: ${escapeHtml(tenant.createdAt)}`,
  ]
    .filter(Boolean)
    .join("\n");
  return sendTelegramMessage(text);
}

/**
 * Send provisjonerings-feil-varsel til Mike.
 */
export async function sendProvisioningFailedTelegram(args: {
  subdomain: string;
  stage: string;
  error: string;
  tenantEmail?: string;
  parentTenant?: string;
}): Promise<TelegramResult> {
  const text = [
    `❌ <b>Provisjonering feilet</b>`,
    `${escapeHtml(args.subdomain)}.kodovault.no`,
    "",
    `Stage: ${escapeHtml(args.stage)}`,
    args.tenantEmail ? `Epost: ${escapeHtml(args.tenantEmail)}` : null,
    args.parentTenant ? `Parent: ${escapeHtml(args.parentTenant)}` : null,
    "",
    `Feil:\n<code>${escapeHtml(args.error).slice(0, 1000)}</code>`,
  ]
    .filter(Boolean)
    .join("\n");
  return sendTelegramMessage(text);
}
