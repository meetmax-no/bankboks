// Klient-side helpers for å snakke med /api/ids.
// Blob-en er allerede AES-256-GCM-kryptert før den sendes (zero-knowledge).
// Mønsteret er parallelt til lib/cards-sync.ts.

import type { EncryptedVaultBlob } from "./types";
import { tHook } from "./i18n";

const ENDPOINT = "/api/ids";

export class IdsRateLimitedError extends Error {
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "IdsRateLimitedError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function fetchRemoteIdsBlob(): Promise<EncryptedVaultBlob | null> {
  const res = await fetch(ENDPOINT, { cache: "no-store" });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new IdsRateLimitedError(
      body?.detail || tHook("ids.error_too_many_attempts"),
      Number(body?.retryAfterSec) || 900,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Server returnerte ${res.status}: ${text}`);
  }
  const data = await res.json();
  return (data.blob as EncryptedVaultBlob) || null;
}

export async function pushRemoteIdsBlob(blob: EncryptedVaultBlob): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lagring av ID-er feilet (${res.status}): ${text}`);
  }
}

export async function deleteRemoteIdsBlob(): Promise<void> {
  const res = await fetch(ENDPOINT, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sletting av ID-blob feilet (${res.status}): ${text}`);
  }
}
