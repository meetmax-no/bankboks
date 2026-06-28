// Klient-side helpers for å snakke med /api/cards.
// Blob-en er allerede AES-256-GCM-kryptert før den sendes (zero-knowledge).
// Mønsteret er parallelt til lib/vault-sync.ts.

import type { EncryptedVaultBlob } from "./types";
import { tHook } from "./i18n";

const ENDPOINT = "/api/cards";

export class CardsRateLimitedError extends Error {
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = "CardsRateLimitedError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function fetchRemoteCardsBlob(): Promise<EncryptedVaultBlob | null> {
  const res = await fetch(ENDPOINT, { cache: "no-store" });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new CardsRateLimitedError(
      body?.detail || tHook("cards.error_too_many_attempts"),
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

export async function pushRemoteCardsBlob(blob: EncryptedVaultBlob): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blob),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lagring av kort feilet (${res.status}): ${text}`);
  }
}

export async function deleteRemoteCardsBlob(): Promise<void> {
  const res = await fetch(ENDPOINT, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sletting av kort-blob feilet (${res.status}): ${text}`);
  }
}
