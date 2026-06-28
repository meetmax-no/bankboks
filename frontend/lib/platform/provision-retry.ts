/**
 * Ko | Do · Vault — v4.3 Iter 8 — fetch + retry helper for ekstern provisjonering
 *
 * Per Utviklingsplan Iter 8: 3 forsøk med 60 sek mellomrom.
 * Retries kun på transient feil (408, 429, 5xx). 4xx returneres til caller
 * uten retry — dette er programmatiske feil (auth, valideringsfeil).
 *
 * Node runtime ONLY (kalles fra API-routes med `runtime = "nodejs"`).
 */

export const PROVISION_MAX_ATTEMPTS = 3;
export const PROVISION_RETRY_DELAY_MS = 60_000;

/** HTTP-statuskoder vi anser som retry-bare (transient). */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

/** Promise-basert sleep — brukes i backoff. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchWithRetryOptions extends RequestInit {
  maxAttempts?: number;
  delayMs?: number;
}

/**
 * fetch med retry. Returnerer siste Response (kan være !ok hvis non-retryable).
 * Throws kun ved nettverksfeil etter siste forsøk.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? PROVISION_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? PROVISION_RETRY_DELAY_MS;
  const { maxAttempts: _ma, delayMs: _dm, ...fetchInit } = options;
  void _ma;
  void _dm;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, fetchInit);
      if (res.ok) return res;
      if (!isRetryableStatus(res.status)) return res;
      if (attempt === maxAttempts) return res;
      console.warn(
        `[provision-retry] ${url} attempt ${attempt}/${maxAttempts} failed: ${res.status}`,
      );
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      console.warn(
        `[provision-retry] ${url} attempt ${attempt}/${maxAttempts} network error:`,
        err,
      );
    }
    await sleep(delayMs);
  }
  // Skal aldri nås — for typeguard
  throw lastErr ?? new Error("fetchWithRetry: unknown failure");
}
