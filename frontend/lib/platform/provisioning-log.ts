/**
 * Ko | Do · Vault — v4.3 Iter 9 (D-065) — Provisjonerings-logg-callbacks
 *
 * Felles helpers for å lage `onEvent`-callbacks som persisterer hver
 * provisjonerings-hendelse til `tenant.provisioningLog` i sanntid. Brukes
 * av /api/register, /api/invite/accept, /api/admin/tenants og
 * D-055-retry-rutene.
 *
 * Sanntids-logging gjør at Mike kan refreshe TenantViewer og se progresjon
 * mens flyten kjører — Live JSON-panel viser eksakt hva som har skjedd.
 */
import { appendProvisioningEvent } from "./tenant-store";
import type {
  ProvisioningEvent,
  ProvisioningStage,
} from "./tenant-types";

/**
 * Bygg en onEvent-callback som persisterer hver event til tenant-recorden.
 * Den returnerte funksjonen kaster ALDRI — logging-feil skal ikke avbryte
 * provisjoneringen.
 */
export function provisioningLogger(subdomain: string) {
  return async (event: {
    stage: ProvisioningStage;
    status: "ok" | "failed";
    detail?: string;
  }): Promise<void> => {
    const fullEvent: ProvisioningEvent = {
      timestamp: new Date().toISOString(),
      stage: event.stage,
      status: event.status,
      detail: event.detail,
    };
    await appendProvisioningEvent(subdomain, fullEvent);
  };
}

/**
 * Logg en enkelt ad-hoc event (admin-override, status-change, invite-sent osv.)
 * uten å gå via provisjonerings-API-callbackene.
 */
export async function logEvent(
  subdomain: string,
  stage: ProvisioningStage,
  status: "ok" | "failed" | "retried" | "skipped",
  detail?: string,
): Promise<void> {
  await appendProvisioningEvent(subdomain, {
    timestamp: new Date().toISOString(),
    stage,
    status,
    detail,
  });
}
