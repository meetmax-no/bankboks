// WebAuthn-helpers for Touch ID / Face ID / Windows Hello.
//
// Vi bruker PRF-utvidelsen (Pseudo-Random Function) — en deterministisk
// nøkkel-deriveringsfunksjon bundet til WebAuthn-credentialet. PRF gir oss en
// stabil 32-byte hemmelighet som vi bruker som AES-GCM-nøkkel til å wrappe
// master-passordet.
//
// Resultat: Master-passordet kan dekrypteres KUN etter biometrisk verifisering
// + tilgang til Secure Enclave / TPM. Server ser fortsatt ingenting.

import { randomBytes } from "./crypto";
import { tHook } from "./i18n";

export function isWebAuthnSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.create === "function"
  );
}

/**
 * Sjekk om browserens versjon støtter PRF-extension. PRF kreves for at vi
 * skal kunne wrappe master-passordet med en biometric-bundet nøkkel (D-001).
 * Uten PRF blir biometric en 95%-løsning — derfor skjuler vi knappen helt
 * for ikke-støttede versjoner i stedet for å tilby svakere biometric.
 *
 * Støtte:
 * - Safari 18+ (iOS 18+ / macOS Sequoia 15+): full PRF
 * - Chrome 132+: full PRF
 * - Firefox: ingen PRF (per feb 2026) — biometric ikke tilbudt
 *
 * UA-detection er normalt "code smell", men her er det den eneste pålitelige
 * måten å unngå å lage orphan-passkeys i Secure Enclave på enheter der vi
 * vet at PRF-evalueringen vil feile.
 */
export function isPrfLikelySupported(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;

  // Chromium-baserte (Chrome/Edge) — sjekk Chrome-versjon
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const isChromium = !!chromeMatch && !/OPR|Opera/.test(ua);
  if (isChromium) {
    const v = parseInt(chromeMatch[1], 10);
    return v >= 132;
  }

  // Safari (macOS + iOS Safari + iOS Chrome som er WebKit under panseret)
  const isWebKitSafari =
    /^((?!chrome|android|crios|fxios|edg|opr|opera).)*safari/i.test(ua) ||
    /CriOS|FxiOS/i.test(ua); // iOS Chrome/Firefox er Safari WebKit
  if (isWebKitSafari) {
    const versionMatch = ua.match(/Version\/(\d+)/);
    if (!versionMatch) return false;
    const v = parseInt(versionMatch[1], 10);
    return v >= 18;
  }

  // Andre browsere (Firefox desktop, etc.) — anta nei. PRF-detect via faktisk
  // WebAuthn-kall vil bekrefte. Men vi vil ikke trigge en passkey-prompt for
  // browsere vi ikke kjenner — bedre å skjule knappen.
  return false;
}

/**
 * Sjekker om plattformen har en innebygd authenticator (Touch ID, Face ID,
 * Windows Hello). Returnerer false hvis kun eksterne security-keys er
 * tilgjengelige.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ---------- Base64URL helpers (WebAuthn-formatert) ----------

export function bufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBuffer(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4);
  const padded = b64 + "=".repeat(pad);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface RegisteredCredential {
  credentialId: Uint8Array;
  prfSalt: Uint8Array;
  prfSecret: Uint8Array;
}

/**
 * Registrerer en ny platform-authenticator (Touch ID / Face ID / Windows Hello)
 * og evaluerer PRF for å hente en deterministisk 32-byte hemmelighet.
 *
 * Krever at brukeren har en innebygd biometric authenticator + at nettleseren
 * støtter PRF-utvidelsen (Chrome/Edge 116+, Safari 17+).
 */
export interface RegisterOptions {
  rpName: string;
  /** Vises i passkey-listen (Google Password Manager / iCloud Keychain) */
  userName: string;
  /** Mer venneslig visningsnavn i samme dialog */
  userDisplayName: string;
}

export async function registerBiometricCredential(
  opts: RegisterOptions,
): Promise<RegisteredCredential> {
  if (!isWebAuthnSupported()) {
    throw new Error(tHook("webauthn.error_not_supported"));
  }
  const userId = randomBytes(16);
  const createChallenge = randomBytes(32);
  const prfSalt = randomBytes(32);

  // Safari-defensiv: forsøk å gi dokumentet eksplisitt fokus rett før
  // WebAuthn-kallet. Safari kaster "The document is not focused" hvis
  // window-fokus er på DevTools, popup eller annen app. Funker bare hvis
  // user activation fortsatt er gyldig (vi er innenfor click-handleren).
  try {
    window.focus();
  } catch {
    /* noop — best effort */
  }

  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: createChallenge as BufferSource,
        rp: { id: window.location.hostname, name: opts.rpName },
        user: {
          id: userId as BufferSource,
          name: opts.userName,
          displayName: opts.userDisplayName,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        authenticatorSelection: {
          userVerification: "required",
          authenticatorAttachment: "platform",
          // "preferred" er den tryggeste allround-innstillingen:
          // - Android/Chrome: Google Password Manager krever discoverable
          //   credentials for å levere PRF. Med "discouraged" får vi ikke PRF.
          // - macOS 15 / iOS 18: Safari støtter PRF også for syncede Passkeys.
          // - Windows Hello: fungerer likt i begge moduser.
          residentKey: "preferred",
          requireResidentKey: false,
        },
        timeout: 60_000,
        // Be om PRF-eval allerede under create() — hvis browseren støtter det
        // (Chrome 132+ / Safari 18+), slipper vi en ekstra biometric-prompt.
        extensions: {
          prf: { eval: { first: prfSalt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    // Safari kaster "The document is not focused" når WebAuthn kalles uten
    // gyldig user activation eller når window-fokus er på DevTools / annen
    // app. Gi en menneskelig feilmelding som hjelper brukeren videre.
    const msg = err instanceof Error ? err.message : String(err);
    if (/document is not focused/i.test(msg)) {
      throw new Error(tHook("webauthn.error_safari_focus_register"));
    }
    throw err;
  }

  if (!cred) throw new Error(tHook("webauthn.error_register_aborted"));

  const ext = cred.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
  };

  // Noen browsere (eldre Chrome) rapporterer enabled:true uten å eksponere
  // `results` i create-output — da må vi gjøre en separat get()-runde.
  // Eldre Safari (<iOS 18) rapporterer enabled:false for iCloud-synced keys.
  if (ext.prf?.enabled === false) {
    throw new Error(tHook("webauthn.error_prf_unsupported"));
  }

  const credentialId = new Uint8Array(cred.rawId);

  // Bruk PRF-resultatet fra create() hvis det finnes (1 prompt totalt).
  // Ellers: gjør en get()-runde (2 prompts, men nødvendig fallback).
  let prfSecret: Uint8Array;
  const firstFromCreate = ext.prf?.results?.first;
  if (firstFromCreate) {
    prfSecret = new Uint8Array(firstFromCreate);
  } else {
    prfSecret = await evaluatePrf(credentialId, prfSalt);
  }

  return { credentialId, prfSalt, prfSecret };
}

/**
 * Trigger biometrisk verifisering og evaluer PRF for å gjenskape den samme
 * 32-byte hemmeligheten som ble brukt til å wrappe master-passordet.
 */
export async function evaluatePrf(
  credentialId: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  if (!isWebAuthnSupported()) {
    throw new Error(tHook("webauthn.error_not_supported"));
  }
  const challenge = randomBytes(32);

  // Safari-defensiv: se kommentar i registerBiometricCredential.
  try {
    window.focus();
  } catch {
    /* noop — best effort */
  }

  let auth: PublicKeyCredential | null;
  try {
    auth = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        allowCredentials: [
          {
            id: credentialId as BufferSource,
            type: "public-key",
            // Ikke sett transports — la nettleseren velge.
            // Android: Google Password Manager bruker "internal" eller "hybrid".
            // iOS: Passkeys via iCloud kan også bruke "hybrid".
          },
        ],
        userVerification: "required",
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: prfSalt as BufferSource } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/document is not focused/i.test(msg)) {
      throw new Error(tHook("webauthn.error_safari_focus_eval"));
    }
    throw err;
  }

  if (!auth) throw new Error(tHook("webauthn.error_verify_aborted"));

  const ext = auth.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new Error(tHook("webauthn.error_prf_eval_failed"));
  }
  return new Uint8Array(first);
}

// ---------- AES-GCM-wrap av master-passord med PRF-secret ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function wrapMasterPassword(
  masterPassword: string,
  prfSecret: Uint8Array,
): Promise<{ iv: Uint8Array; cipher: Uint8Array }> {
  const key = await crypto.subtle.importKey(
    "raw",
    prfSecret as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = randomBytes(12);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(masterPassword),
  );
  return { iv, cipher: new Uint8Array(cipherBuf) };
}

export async function unwrapMasterPassword(
  iv: Uint8Array,
  cipher: Uint8Array,
  prfSecret: Uint8Array,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    prfSecret as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
  } catch {
    throw new Error(tHook("webauthn.error_decrypt_failed"));
  }
  return dec.decode(plain);
}
