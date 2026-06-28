/**
 * Ko | Do · Vault — v4.3 Iter 9 (D-066 · 2026-06-04)
 *
 * On-demand deployment-statussjekk. Vercel-serverless tillater ikke
 * langtidskjørende background tasks, så vi bruker frontend-polling-mønster:
 *
 *   1. Provisjonerings-flyten lagrer `vercelDeploymentId` på tenant og
 *      returnerer raskt til frontend.
 *   2. Frontend (Skjerm 5) poller `/api/status?subdomain=X` hvert 2. sek.
 *   3. `/api/status` kaller `checkDeploymentOnce(subdomain)` som:
 *      - GET tenant fra Upstash
 *      - Hvis vaultLive=true: returnerer immediately
 *      - Hvis Vercel-deployment finnes: GET status fra Vercel
 *      - READY → sett vaultLive + emit vault_live event → returner
 *      - ERROR/CANCELED → sett provisioning_failed → emit failed event
 *      - Timeout (>3 min siden vercel_redeploy): emit timeout event
 *      - Ellers: ingen oppdatering, frontend poller igjen
 *
 * Per D-063: ved feil — INGEN Vercel-rollback. Admin retter via D-055.
 */
import { getDeploymentStatus } from "./vercel-provision";
import { appendProvisioningEvent, getTenant, putTenant } from "./tenant-store";
import { notifyProvisioningFailure } from "./notify";
import { sendWelcomeEmail } from "./notify-email";
import { sendVaultLiveTelegram } from "./notify-telegram";
import type { TenantRecord } from "./tenant-types";

const DEPLOYMENT_TIMEOUT_MS = 3 * 60 * 1000; // 3 min fra vercel_redeploy-event

export interface CheckResult {
  vaultLive: boolean;
  status: TenantRecord["status"];
  latestEvent: {
    stage: string;
    status: string;
    detail?: string;
    timestamp: string;
  } | null;
  recentEvents: TenantRecord["provisioningLog"];
}

/**
 * On-demand status-sjekk for én tenant. Kjøres av `/api/status` ved hver
 * frontend-poll. Returnerer alltid current snapshot — og hvis Vercel-build
 * har blitt READY/ERROR siden forrige sjekk, oppdaterer tenant-recorden
 * og skriver et nytt event.
 *
 * KASTER ALDRI — fanger alle feil og returnerer best-effort snapshot.
 */
export async function checkDeploymentOnce(
  subdomain: string,
): Promise<CheckResult | null> {
  const tenant = await getTenant(subdomain);
  if (!tenant) return null;

  // Allerede live — ingenting å sjekke
  if (tenant.vaultLive) {
    return buildResult(tenant);
  }

  // Ingen deployment å polle ennå (provisjonering ikke kommet til redeploy-stadiet)
  const redeployEvent = tenant.provisioningLog
    .filter(
      (e) => e.stage === "vercel_redeploy" && e.status === "ok",
    )
    .pop();
  if (!redeployEvent) {
    return buildResult(tenant);
  }

  const deploymentId = extractDeploymentId(redeployEvent.detail);
  if (!deploymentId) {
    return buildResult(tenant);
  }

  // Sjekk timeout
  const elapsed = Date.now() - new Date(redeployEvent.timestamp).getTime();
  if (elapsed > DEPLOYMENT_TIMEOUT_MS) {
    // Kun marker timeout én gang
    const alreadyMarked = tenant.provisioningLog.some(
      (e) => e.stage === "vault_live" && e.status === "failed",
    );
    if (!alreadyMarked) {
      await markVaultFailed(
        subdomain,
        "Timeout — deployment tok mer enn 3 minutter",
      );
    }
    const refreshed = await getTenant(subdomain);
    return refreshed ? buildResult(refreshed) : buildResult(tenant);
  }

  // Spør Vercel om deployment-state
  try {
    const dep = await getDeploymentStatus(deploymentId);
    const domain = `${tenant.subdomain}.kodovault.no`;
    // Vercel /v13/deployments/{id} returnerer `readyState` (ikke `state`).
    // Behold begge for å være robust mot API-varianter.
    const state = dep.readyState ?? dep.state;

    if (state === "READY") {
      await markVaultLive(subdomain, domain);
      const refreshed = await getTenant(subdomain);
      return refreshed ? buildResult(refreshed) : buildResult(tenant);
    }
    if (state === "ERROR" || state === "CANCELED") {
      await markVaultFailed(
        subdomain,
        `Vercel deployment ${state}: ${dep.errorMessage ?? "no error message"}`,
      );
      const refreshed = await getTenant(subdomain);
      return refreshed ? buildResult(refreshed) : buildResult(tenant);
    }
    // QUEUED / INITIALIZING / BUILDING — fortsett, frontend poller igjen
    return buildResult(tenant);
  } catch (e) {
    console.error(
      "[checkDeploymentOnce] getDeploymentStatus failed:",
      e,
    );
    return buildResult(tenant);
  }
}

function buildResult(tenant: TenantRecord): CheckResult {
  const log = tenant.provisioningLog;
  const latest = log.length > 0 ? log[log.length - 1] : null;
  return {
    vaultLive: tenant.vaultLive,
    status: tenant.status,
    latestEvent: latest
      ? {
          stage: latest.stage,
          status: latest.status,
          detail: latest.detail,
          timestamp: latest.timestamp,
        }
      : null,
    // D-067 fix (2026-06-04): returner hele loggen (begrenset til 50 for
    // å holde respons-størrelsen liten). Sjekklisten i frontend trenger
    // alle stages, ikke bare de siste 5 — ved retry kan upstash_create
    // ligge tidlig i loggen.
    recentEvents: log.slice(-50),
  };
}

function extractDeploymentId(detail?: string): string | null {
  if (!detail) return null;
  const m = detail.match(/deploymentId=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function markVaultLive(subdomain: string, domain: string): Promise<void> {
  const now = new Date().toISOString();
  const tenant = await getTenant(subdomain);
  if (!tenant) return;
  await putTenant({
    ...tenant,
    vaultLive: true,
    vaultLiveAt: now,
    status: tenant.status === "provisioning_failed" ? "trial" : tenant.status,
  });
  await appendProvisioningEvent(subdomain, {
    timestamp: now,
    stage: "vault_live",
    status: "ok",
    detail: `${domain} er live`,
  });

  // Iter 10 (D-068): velkomstmail + Telegram fire-and-forget.
  // Hent fersk tenant-record (vault_live er nå skrevet inn).
  const refreshed = (await getTenant(subdomain)) ?? tenant;
  try {
    const emailResult = await sendWelcomeEmail(refreshed);
    if (emailResult.ok) {
      // Marker som sendt + logg event
      const t = (await getTenant(subdomain)) ?? refreshed;
      await putTenant({
        ...t,
        welcomeEmailSentAt: new Date().toISOString(),
      });
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "welcome_email_sent",
        status: "ok",
        detail: `Resend id=${emailResult.emailId ?? "?"} til ${refreshed.contactEmail ?? refreshed.email}`,
      });
    } else if (emailResult.skipped) {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "welcome_email_sent",
        status: "ok",
        detail: `skipped: ${emailResult.reason}`,
      });
    } else {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "welcome_email_sent",
        status: "failed",
        detail: emailResult.error ?? "ukjent feil",
      });
    }
  } catch (e) {
    console.error("[markVaultLive] sendWelcomeEmail kastet:", e);
  }

  try {
    const telegramResult = await sendVaultLiveTelegram(refreshed);
    if (telegramResult.ok) {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "telegram_sent",
        status: "ok",
        detail: "vault_live varsel sendt",
      });
    } else if (telegramResult.skipped) {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "telegram_sent",
        status: "ok",
        detail: `skipped: ${telegramResult.reason}`,
      });
    } else {
      await appendProvisioningEvent(subdomain, {
        timestamp: new Date().toISOString(),
        stage: "telegram_sent",
        status: "failed",
        detail: telegramResult.error ?? "ukjent feil",
      });
    }
  } catch (e) {
    console.error("[markVaultLive] sendVaultLiveTelegram kastet:", e);
  }

  console.log(`[vault_live] ${subdomain} → ${domain}`);
}

async function markVaultFailed(
  subdomain: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const tenant = await getTenant(subdomain);
  if (!tenant) return;
  await putTenant({ ...tenant, status: "provisioning_failed" });
  await appendProvisioningEvent(subdomain, {
    timestamp: now,
    stage: "vault_live",
    status: "failed",
    detail: reason,
  });
  try {
    await notifyProvisioningFailure({
      subdomain,
      stage: "vercel",
      error: new Error(reason),
      tenantEmail: tenant.contactEmail ?? tenant.email,
      parentTenant: tenant.parentTenant ?? undefined,
    });
  } catch (e) {
    console.error("[markVaultFailed] notify failed:", e);
  }
}
