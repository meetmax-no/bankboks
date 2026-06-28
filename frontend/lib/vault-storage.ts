// Lokal lagring av kryptert vault-blob.
//
// I V1 lagrer vi i localStorage (online-only modell — Upstash kommer i Fase 5
// og vil bruke samme blob-format via /api/vault).
//
// Server ser KUN den krypterte blobben + salt + iv. Master-passordet
// blir aldri sendt eller lagret.

import type { EncryptedVaultBlob } from "./types";

const VAULT_KEY = "kodo-vault.blob.v1";
const SESSION_LAST_UNLOCK = "kodo-vault.session.lastUnlockAt";

export function loadEncryptedBlob(): EncryptedVaultBlob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EncryptedVaultBlob;
  } catch {
    return null;
  }
}

export function saveEncryptedBlob(blob: EncryptedVaultBlob): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(VAULT_KEY, JSON.stringify(blob));
}

export function clearEncryptedBlob(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(VAULT_KEY);
}

export function hasVault(): boolean {
  return loadEncryptedBlob() !== null;
}

// ---------- Session-tracking (siste master-pålogging) ----------

export function markUnlockedNow(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSION_LAST_UNLOCK, new Date().toISOString());
}

export function getSessionUnlockedAt(): Date | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_LAST_UNLOCK);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function clearSessionUnlock(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_LAST_UNLOCK);
}
