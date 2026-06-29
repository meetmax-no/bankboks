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
const MAX_TRIM_MARKERS = 10;

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
 *
 * Grensen gjelder KUN "ekte" events. Trim-markere (stage === "log_trimmed")
 * lever på siden — de er beskyttet fra trunkering og caps separat på
 * `MAX_TRIM_MARKERS` (10).
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
 * Bygger en trim-marker som logger hvor mye som ble kuttet.
 *
 * `detail`-feltet bruker et maskinlesbart format slik at UI kan parse ut
 * count + total-since hvis ønskelig:
 *   `cut=NNN total=NNNN`
 * I tillegg legger vi til en menneske-lesbar suffiks for tilfeller der
 * detail vises rått (CSV-backup, raw audit-log).
 */
function makeTrimMarker(cut: number, total: number): ProvisioningEvent {
  return {
    timestamp: new Date().toISOString(),
    stage: "log_trimmed",
    status: "ok",
    detail: `cut=${cut} total=${total}`,
  };
}

function parseMarkerTotal(detail: string | undefined): number {
  if (!detail) return 0;
  const m = /total=(\d+)/.exec(detail);
  if (!m) return 0;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * D-124 (2026-06-29): trim-markere lever på TOPPEN av loggen (nyeste først,
 * indeks 0..N-1), beskyttet fra trunkering. Ekte events lever etter
 * markerne, kronologisk.
 *
 * Hvis lengden på ekte events overstiger `limit`:
 *   1. Kutt eldste ekte events (slice(-limit))
 *   2. Lag ny trim-marker som logger hvor mye ble kuttet + total-så-langt
 *   3. Prepend til marker-listen
 *   4. Cap marker-listen til MAX_TRIM_MARKERS (10) — dropp eldste
 *
 * Returnerer original-array-referansen (no-op) hvis ingen trunkering trengs.
 */
export function truncateProvisioningLog(
  events: ProvisioningEvent[],
  limit: number,
): ProvisioningEvent[] {
  // Split markers vs real events. Markers lever fortløpende på toppen,
  // men splittfunksjonen er robust mot ikke-sortert input.
  const markers: ProvisioningEvent[] = [];
  const real: ProvisioningEvent[] = [];
  for (const e of events) {
    if (e.stage === "log_trimmed") markers.push(e);
    else real.push(e);
  }
  if (real.length <= limit) return events; // ingen trunkering trengs → no-op

  // Trim de eldste ekte events. `cut` = antall fjernet i denne runden.
  const cut = real.length - limit;
  const keptReal = real.slice(-limit);

  // Total-siden = sist sett total + dette kuttet (kumulativt). Vi tar
  // dette fra den NYESTE eksisterende markeren (markers[0] hvis nyeste-
  // først, ellers første marker vi finner).
  const prevTotal =
    markers.length > 0 ? parseMarkerTotal(markers[0]?.detail) : 0;
  const newMarker = makeTrimMarker(cut, prevTotal + cut);

  // Nyeste marker først → cap til MAX_TRIM_MARKERS (dropper eldste).
  const newMarkers = [newMarker, ...markers].slice(0, MAX_TRIM_MARKERS);

  return [...newMarkers, ...keptReal];
}
