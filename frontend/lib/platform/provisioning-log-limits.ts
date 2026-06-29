/**
 * Ko | Do · Vault — D-123 (2026-06-29) — provisioning-log-limits
 *
 * Provisjonerings-loggen vokser uendelig hvis vi ikke gjør noe.
 *
 *   • B2B-parent (am-admin): høyt event-volum — hver ansatt-opprettelse,
 *     -sletting (D-118), plan-bytte og Stripe-event logges på parent.
 *     50 ansatte × 2 år ≈ 500–800 events.
 *   • B2C-tenant (standalone eller barn-av-B2B): lavt volum — 6 vault-
 *     provisjonerings-events + sporadiske admin-handlinger. 10–15 events
 *     selv over 5 år.
 *
 * Asymmetriske grenser (Mike-direktiv 2026-06-29):
 *   • adminProvisioningLogMax  = 1000  (for customerType === "b2b" parent)
 *   • tenantProvisioningLogMax = 100   (for alle andre)
 *   • Hardcoded fallback        = 100  (hvis default.json mangler key)
 *
 * Konfig leses fra `public/clients/default.json` (build-time import via
 * resolveJsonModule). Endring der + redeploy = ny grense.
 */
import defaultClientConfig from "../../public/clients/default.json";
import type { TenantRecord, ProvisioningEvent } from "./tenant-types";

const FALLBACK = 100;

interface ProvisioningLogConfig {
  adminProvisioningLogMax?: number;
  tenantProvisioningLogMax?: number;
}

function readConfig(): ProvisioningLogConfig {
  // default.json kan strukturelt mangle "provisioningLog"-blokken. Tving
  // gjennom unknown for å trygt narrow før bruk.
  const cfg = (
    defaultClientConfig as unknown as {
      provisioningLog?: ProvisioningLogConfig;
    }
  ).provisioningLog;
  return cfg ?? {};
}

function clampPositiveInt(v: number | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

/**
 * Returnerer maks antall events vi tar vare på for én tenant.
 * Rekkefølge:
 *   1. default.json provisioningLog.{adminProvisioningLogMax | tenantProvisioningLogMax}
 *      basert på customerType.
 *   2. Hardcoded fallback (100).
 */
export function getProvisioningLogMax(record: TenantRecord): number {
  const cfg = readConfig();
  const isB2BParent =
    record.customerType === "b2b" && record.parentTenant === null;
  const limit = isB2BParent
    ? clampPositiveInt(cfg.adminProvisioningLogMax)
    : clampPositiveInt(cfg.tenantProvisioningLogMax);
  return limit ?? FALLBACK;
}

/**
 * Returnerer en (potensielt) trunkert versjon av `events`. Beholder de
 * SISTE `limit` (nyligste først bevart). Hvis lengden allerede er innenfor
 * grensen returneres samme array-referanse (no-op).
 */
export function truncateProvisioningLog(
  events: ProvisioningEvent[],
  limit: number,
): ProvisioningEvent[] {
  if (events.length <= limit) return events;
  return events.slice(events.length - limit);
}
