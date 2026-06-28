// Lokal lagring av biometric-blob (WebAuthn-credential + wrapped master-pwd)
// + 14-dagers tving-master-passord-policy.
//
// Server ser INGENTING av dette — alt ligger i localStorage og er bundet til
// enheten via Secure Enclave / TPM (via WebAuthn-credentialet).

const BIO_KEY = "kodo-vault.biometric.v1";
const LAST_MASTER_KEY = "kodo-vault.lastMasterAt.v1";
const BIO_DISMISSED_KEY = "kodo-vault.biometric.dismissed.v1";

export interface BiometricBlob {
  version: 1;
  /** WebAuthn credentialId (base64url) */
  credentialId: string;
  /** PRF salt-input (base64) */
  prfSalt: string;
  /** AES-GCM IV (base64) */
  iv: string;
  /** Ciphertext med master-passordet (base64) */
  cipher: string;
  /** ISO-tid for når biometric ble aktivert */
  registeredAt: string;
}

export function loadBiometric(): BiometricBlob | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BIO_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BiometricBlob;
  } catch {
    return null;
  }
}

export function saveBiometric(blob: BiometricBlob): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BIO_KEY, JSON.stringify(blob));
}

export function clearBiometric(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(BIO_KEY);
  localStorage.removeItem(BIO_DISMISSED_KEY);
}

export function hasBiometric(): boolean {
  return loadBiometric() !== null;
}

// ---------- 14-dagers tving-master ----------

export function markMasterUsedNow(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_MASTER_KEY, new Date().toISOString());
}

export function getLastMasterAt(): Date | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LAST_MASTER_KEY);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function isMasterFresh(forceMasterAfterDays: number): boolean {
  const last = getLastMasterAt();
  if (!last) return false;
  const ageMs = Date.now() - last.getTime();
  const limitMs = forceMasterAfterDays * 24 * 60 * 60 * 1000;
  return ageMs < limitMs;
}

export function clearLastMasterAt(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LAST_MASTER_KEY);
}

// ---------- Dismiss-state for "Aktiver Touch ID"-prompt ----------

export function dismissBiometricPrompt(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BIO_DISMISSED_KEY, "true");
}

export function isBiometricPromptDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(BIO_DISMISSED_KEY) === "true";
}
