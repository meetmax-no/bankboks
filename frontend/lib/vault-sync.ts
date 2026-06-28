// Klient-side helpers for å snakke med /api/vault.
// Blobben er allerede kryptert med AES-256-GCM før den sendes.

import type { EncryptedVaultBlob } from "./types";
import { tHook } from "./i18n";

const ENDPOINT = "/api/vault";

export class RateLimitedError extends Error {
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function fetchRemoteBlob(): Promise<EncryptedVaultBlob | null> {
  const res = await fetch(ENDPOINT, { cache: "no-store" });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new RateLimitedError(
      body?.detail ||
        tHook("vault.error_too_many_attempts"),
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

export async function pushRemoteBlob(blob: EncryptedVaultBlob): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lagring feilet (${res.status}): ${text}`);
  }
}

export async function deleteRemoteBlob(): Promise<void> {
  const res = await fetch(ENDPOINT, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sletting feilet (${res.status}): ${text}`);
  }
}
