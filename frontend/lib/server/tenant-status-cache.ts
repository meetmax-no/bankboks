/**
 * Ko | Do · Vault — D-076 Tenant status cache + write-block helper
 *
 * Brukes av vault-data write-ruter (PUT/DELETE på /api/vault, /api/cards,
 * /api/ids, og POST /api/invite/accept) for å håndheve paywall server-side
 * når `tenant.status === "locked"` (eller "cancelled"/"deleted").
 *
 * Arkitektur (D-076):
 *   - Tenant-poden eier ikke central-creds — kan ikke lese tenant.status
 *     direkte fra sentral Upstash.
 *   - I stedet cacher vi `{status, lockedAt}` i tenant-podens egen Upstash
 *     med TTL 5 min. Ved miss fetcher vi via signert RPC fra admin.
 *   - Akseptert sync-vindu maks 5 min mellom Stripe-webhook og write-block.
 *
 * Subdomain-utledning:
 *   Tenant-poden vet sin egen subdomain via `host`-header (D-046:
 *   subdomain er identitet). Helperen parser host-en i hver write-rute.
 */
import { Redis } from "@upstash/redis";

const CACHE_KEY = "tenant:status:cache";
const CACHE_TTL_SECONDS = 300; // 5 min — D-076 akseptert sync-vindu

export type LockedStatus = "locked" | "cancelled" | "deleted";
export type TenantStatusSnapshot = {
  status: string;
  lockedAt: string | null;
};

export class TenantLockedError extends Error {
  readonly status: LockedStatus;
  readonly lockedAt: string | null;
  constructor(status: LockedStatus, lockedAt: string | null) {
    super(`tenant is ${status}`);
    this.name = "TenantLockedError";
    this.status = status;
    this.lockedAt = lockedAt;
  }
}

/**
 * Parse subdomain fra host-header. `<sub>.kodovault.no` → `<sub>`.
 * Returnerer null hvis host ikke matcher mønsteret (f.eks. localhost
 * under utvikling — da gir vi opp og lar bruker passere).
 */
export function subdomainFromHost(host: string | null): string | null {
  if (!host) return null;
  const lower = host.toLowerCase().split(":")[0]; // strip port
  // Match `<sub>.kodovault.no` eller `<sub>.kodovault.vercel.app` (staging)
  const m = lower.match(/^([a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.kodovault\./);
  return m ? m[1] : null;
}

/**
 * Hent tenant-status fra lokal cache. Ved miss → fetch fra admin RPC.
 * Throws hvis RPC feiler — kalleren må bestemme om det skal være
 * fail-open eller fail-closed.
 */
export async function getTenantStatus(
  subdomain: string,
): Promise<TenantStatusSnapshot> {
  const redis = Redis.fromEnv();

  // ─── 1. Cache hit? ────────────────────────────────────────────────
  const cached = await redis.get<TenantStatusSnapshot>(CACHE_KEY);
  if (cached && typeof cached === "object" && "status" in cached) {
    return cached;
  }

  // ─── 2. Cache miss → fetch fra admin ─────────────────────────────
  const adminUrl =
    process.env.ADMIN_INTERNAL_URL ?? "https://admin.kodovault.no";
  const secret = process.env.INTERNAL_RPC_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_RPC_SECRET not configured");
  }

  const res = await fetch(
    `${adminUrl}/api/internal/tenant-status?sub=${encodeURIComponent(subdomain)}`,
    {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`tenant-status RPC failed: ${res.status}`);
  }
  const data = (await res.json()) as
    | { ok: true; status: string; lockedAt: string | null }
    | { ok: false; error: string };
  if (!data.ok) {
    throw new Error(`tenant-status RPC error: ${data.error}`);
  }

  const snapshot: TenantStatusSnapshot = {
    status: data.status,
    lockedAt: data.lockedAt,
  };

  // ─── 3. Skriv til cache, fire-and-forget ─────────────────────────
  await redis.set(CACHE_KEY, snapshot, { ex: CACHE_TTL_SECONDS });

  return snapshot;
}

/**
 * Throws `TenantLockedError` hvis tenant er låst/avbestilt/slettet.
 * Brukes som første linje i alle vault-data write-handlers.
 *
 * Fail-open ved nettverksfeil: hvis vi ikke kan kontakte admin og det
 * ikke er noe i cache, lar vi requesten gå gjennom. Alternativet (fail-
 * closed) ville gjort tenant-pods helt avhengig av admin-uptime — for
 * dyrt for et best-effort write-block.
 */
export async function assertTenantNotLocked(
  subdomain: string,
): Promise<void> {
  let snapshot: TenantStatusSnapshot;
  try {
    snapshot = await getTenantStatus(subdomain);
  } catch (e) {
    // Fail-open. Logg for observability.
    console.warn(
      `[tenant-status-cache] fail-open for ${subdomain}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  if (
    snapshot.status === "locked" ||
    snapshot.status === "cancelled" ||
    snapshot.status === "deleted"
  ) {
    throw new TenantLockedError(
      snapshot.status as LockedStatus,
      snapshot.lockedAt,
    );
  }
}

/**
 * Helper for write-ruter: kjør sjekken og returner en 403-response hvis
 * tenant er låst. Kalleren returnerer responsen direkte.
 *
 * Eksempel:
 *   const blocked = await checkWriteBlock(req);
 *   if (blocked) return blocked;
 *
 * Returnerer `null` hvis writes er tillatt.
 */
export async function checkWriteBlock(
  req: Request,
): Promise<Response | null> {
  const host = req.headers.get("host");
  const subdomain = subdomainFromHost(host);
  if (!subdomain) {
    // Lokalt/utvikling — tillat
    return null;
  }
  try {
    await assertTenantNotLocked(subdomain);
    return null;
  } catch (e) {
    if (e instanceof TenantLockedError) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "tenant_locked",
          status: e.status,
          lockedAt: e.lockedAt,
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    // Andre feil → fail-open (allerede logget i assertTenantNotLocked)
    return null;
  }
}
