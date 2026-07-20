/**
 * Ko | Do · Vault — D-149 (2026-02) — Vault-pod → admin RPC klient
 *
 * Kalles fra vault-rutene for å bumpe activity-tellere på central
 * Upstash. Vault-pods har ikke CENTRAL_KV_* env-vars per D-071
 * isolation, så all central-write må gå via internal RPC.
 *
 * Mønster identisk med `tenant-status-cache.ts` (D-077).
 *
 * Failsoft: kaster aldri. Logger error og fortsetter.
 */
import { resolveAdminInternalUrl } from "@/lib/server/admin-url-guard";

/**
 * D-149 — fire-and-forget activity-bump. Vault-request fortsetter selv
 * hvis admin-pod er nede eller INTERNAL_RPC_SECRET mangler.
 *
 * @param subdomain — tenant-subdomain (fra NEXT_PUBLIC_CLIENT_CONFIG)
 * @param kind — hva som skal bumpes
 */
export async function bumpActivityViaRpc(
  subdomain: string,
  kind: "unlocks" | "writes" | "reads",
): Promise<void> {
  const base = resolveAdminInternalUrl();
  const secret = process.env.INTERNAL_RPC_SECRET;
  if (!secret) {
    console.warn(
      `[activity-rpc D-149] INTERNAL_RPC_SECRET mangler på tenant-pod — bump ${kind}/${subdomain} skipped`,
    );
    return;
  }

  try {
    const res = await fetch(`${base}/api/internal/bump-activity`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ subdomain, kind }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.error(
        `[activity-rpc D-149] bump ${kind}/${subdomain} → HTTP ${res.status} @ ${base}: ${text.slice(0, 200)}`,
      );
    }
  } catch (e) {
    console.error(
      `[activity-rpc D-149] bump ${kind}/${subdomain} fetch failed @ ${base}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}
