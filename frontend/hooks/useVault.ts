"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decryptVault,
  decryptVaultWithKey,
  encryptVault,
  encryptVaultWithKey,
} from "@/lib/crypto";
import {
  clearSessionUnlock,
  markUnlockedNow,
} from "@/lib/vault-storage";
import { tHook } from "@/lib/i18n";
import {
  deleteRemoteBlob,
  fetchRemoteBlob,
  pushRemoteBlob,
} from "@/lib/vault-sync";
import {
  clearBiometric,
  clearLastMasterAt,
  dismissBiometricPrompt as dismissBioPromptStore,
  hasBiometric,
  isBiometricPromptDismissed,
  isMasterFresh as checkMasterFresh,
  loadBiometric,
  markMasterUsedNow,
  saveBiometric,
  type BiometricBlob,
} from "@/lib/biometric-store";
import {
  clearEvents as clearServerEvents,
  fetchEvents,
  reportEvent,
  type VaultEvent,
} from "@/lib/events-sync";
import type { EncryptedVaultBlob, VaultEntry, VaultPayload } from "@/lib/types";
import {
  bufferToBase64Url,
  base64UrlToBuffer,
  evaluatePrf,
  isPlatformAuthenticatorAvailable,
  isPrfLikelySupported,
  isWebAuthnSupported,
  registerBiometricCredential,
  unwrapMasterPassword,
  wrapMasterPassword,
} from "@/lib/webauthn";

export type VaultStatus =
  | "loading"
  | "needs-setup"
  | "locked"
  | "unlocked"
  | "error";

interface SessionState {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
  payload: VaultPayload;
}

export interface BiometricInfo {
  supported: boolean;
  registered: boolean;
  masterFresh: boolean;
  promptDismissed: boolean;
}

export interface UseVaultResult {
  status: VaultStatus;
  error: string | null;
  entries: VaultEntry[];
  biometric: BiometricInfo;
  loginHistory: VaultEvent[];
  loginHistoryLoading: boolean;
  refreshLoginHistory: () => Promise<void>;
  clearLoginHistory: () => Promise<void>;
  /** Ny setup — krever at server er tom (ellers må eksisterende vault låses opp) */
  setupVault: (masterPassword: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<void>;
  unlockWithBiometric: () => Promise<void>;
  registerBiometric: (masterPassword: string) => Promise<void>;
  removeBiometric: () => void;
  /**
   * Iter 19.9.2 — eksternt brukerbevis (toast-action "Fortsett") som
   * resetter idle-timeren. Brukes typisk fra vault-runtime sin
   * onAutoLockWarning-toast.
   */
  bumpAutoLockActivity: () => void;
  dismissBiometricPrompt: () => void;
  lock: () => void;
  destroyVault: () => Promise<void>;
  saveEntries: (next: VaultEntry[]) => Promise<void>;
  /** Bytt master-passord: atomisk re-kryptering av vault + side-blobs (D-062). */
  changeMasterPassword: (
    currentPassword: string,
    newPassword: string,
    reEncryptSideBlobs?: SideBlobReEncrypter,
  ) => Promise<void>;
  /** Henter krypterte vault-blob ferskt fra Upstash for backup-eksport. */
  fetchBlobForBackup: () => Promise<import("@/lib/types").EncryptedVaultBlob | null>;
  /** Brukes ved import når vault er låst: pusher importert vault-blob direkte. */
  applyImportedVault: (
    blob: import("@/lib/types").EncryptedVaultBlob,
  ) => Promise<void>;
  /** Verifiserer at oppgitt master-pwd kan dekryptere current server-vault.
   *  Brukes til å bekrefte "current master-pwd" ved selektiv backup-import
   *  når backup-pwd er forskjellig fra dagens. */
  verifyMasterPassword: (pwd: string) => Promise<boolean>;
  /** Validerer + dekrypterer en importert vault-blob med oppgitt master-pwd. */
  validateAndDecryptVault: (
    blob: import("@/lib/types").EncryptedVaultBlob,
    pwd: string,
  ) => Promise<VaultPayload>;
  /** Re-krypterer en vault-payload med target-pwd og pusher til server.
   *  Brukes ved import: payload kommer fra dekryptert backup, target-pwd
   *  bestemmes av kalleren (current vault-pwd hvis unlocked, ellers backup-pwd). */
  applyImportedVaultPayload: (
    payload: VaultPayload,
    targetPwd: string,
  ) => Promise<void>;
  /** Post-import cleanup. Hvis `vaultWasImported` er true, låses vault og
   *  biometric ryddes — brukeren må re-unlocke med backup-passord. */
  importBackup: (opts: { vaultWasImported: boolean }) => Promise<void>;
  /** Re-fetch krypter blob fra server og dekrypter med eksisterende session-nøkkel.
   *  Brukes for å hente endringer gjort fra andre enheter uten å låse vault.
   *  Hvis decrypt feiler (f.eks. master-pwd er byttet andre steder), låses vault. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** Retry initial server fetch (etter nettverksfeil) */
  retry: () => void;
}

export interface UseVaultOpts {
  autoLockMinutes?: number;
  forceMasterAfterDays?: number;
  /** Vises som "site name" i Touch ID/Passkey-dialog */
  rpName?: string;
  /** Visningsnavn i passkey-listen (Google Password Manager / iCloud Keychain) */
  userDisplayName?: string;
  /** Kalles én gang per vellykket unlock med master-pwd transient i scope.
   *  Brukes til å auto-låse opp side-blobs (cards i v3.0, ids i v3.2) som
   *  bruker samme master-pwd men egen salt (D-002/D-012). Master-pwd lagres
   *  ALDRI — kun gitt videre i denne callbacken og forsvinner etter await. */
  onMasterUnlock?: (masterPassword: string) => void | Promise<void>;
  /** Iter 19.9.2 — sek før auto-lås at varsel-callback fyres (clamp 30-120) */
  autoLockWarningSecs?: number;
  /** Iter 19.9.2 — fyres når <= autoLockWarningSecs gjenstår. Maks 1x per idle. */
  onAutoLockWarning?: () => void;
  /** Iter 19.9.2 — fyres når bruker er aktiv ETTER at advarsel er fyrt. */
  onAutoLockActivity?: () => void;
}

/**
 * D-062: Atomisk re-kryptering av side-blobs ved master-pwd-bytte.
 * vault-runtime implementerer denne. Returnerer void ved suksess, throws
 * ved feil med rollback allerede gjort.
 */
export type SideBlobReEncrypter = (
  oldPwd: string,
  newPwd: string,
) => Promise<void>;

export function useVault(
  optsOrAutoLock: UseVaultOpts | number = {},
  legacyForceMaster?: number,
): UseVaultResult {
  // Tillat både ny opts-form og gammel positional-form for bakoverkompatibilitet
  const opts: UseVaultOpts =
    typeof optsOrAutoLock === "number"
      ? {
          autoLockMinutes: optsOrAutoLock,
          forceMasterAfterDays: legacyForceMaster,
        }
      : optsOrAutoLock;
  const autoLockMinutes = opts.autoLockMinutes ?? 15;
  // Iter 19.9.2: clamp 30–120s per D-011-mønster (clipboard clear).
  const autoLockWarningSecs = Math.min(
    120,
    Math.max(30, opts.autoLockWarningSecs ?? 60),
  );
  const forceMasterAfterDays = opts.forceMasterAfterDays ?? 14;
  const rpName = opts.rpName ?? "Ko | Do · Vault";
  const userDisplayName = opts.userDisplayName ?? "Vault-bruker";
  const onMasterUnlock = opts.onMasterUnlock;
  // Holder seneste callback i ref slik at useCallback nedenfor kan kalle
  // den uten å lekke til avhengighetslisten (ellers re-rendres alle actions).
  const onMasterUnlockRef = useRef(onMasterUnlock);
  useEffect(() => {
    onMasterUnlockRef.current = onMasterUnlock;
  }, [onMasterUnlock]);

  const [status, setStatus] = useState<VaultStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [biometric, setBiometric] = useState<BiometricInfo>({
    supported: false,
    registered: false,
    masterFresh: false,
    promptDismissed: false,
  });
  const [loginHistory, setLoginHistory] = useState<VaultEvent[]>([]);
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const sessionRef = useRef<SessionState | null>(null);
  const remoteBlobRef = useRef<EncryptedVaultBlob | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const [reloadKey, setReloadKey] = useState(0);

  const refreshBiometric = useCallback(async () => {
    // PRF-extension er påkrevd for biometric — uten den blir det en 95%-løsning
    // som bryter D-001. Skjul biometric-knappen helt for ikke-støttede browsere
    // (Safari < 18 / Chrome < 132 / iOS < 18). Se D-023+ for kontekst.
    const supported =
      isWebAuthnSupported() &&
      isPrfLikelySupported() &&
      (await isPlatformAuthenticatorAvailable());
    setBiometric({
      supported,
      registered: hasBiometric(),
      masterFresh: checkMasterFresh(forceMasterAfterDays),
      promptDismissed: isBiometricPromptDismissed(),
    });
  }, [forceMasterAfterDays]);

  const refreshLoginHistory = useCallback(async () => {
    setLoginHistoryLoading(true);
    try {
      const events = await fetchEvents(100);
      setLoginHistory(events);
    } catch {
      /* swallow — UI viser tom state */
    } finally {
      setLoginHistoryLoading(false);
    }
  }, []);

  const clearLoginHistory = useCallback(async () => {
    await clearServerEvents();
    setLoginHistory([]);
  }, []);

  // Initial sync fra server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setError(null);
      try {
        const blob = await fetchRemoteBlob();
        if (cancelled) return;
        remoteBlobRef.current = blob;
        setStatus(blob ? "locked" : "needs-setup");
        await refreshBiometric();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ukjent feil");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBiometric, reloadKey]);

  // Auto-lås: wall-clock-basert (overlever sleep / backgrounded tab)
  // som setTimeout ikke gjør pålitelig.
  //
  // Iter 19.9.2: emitter `onAutoLockWarning` callback når <= warning-sek
  // gjenstår. Parent (vault-runtime) ansvarlig for å vise toast med
  // "Fortsett"-knapp som kaller `bumpAutoLockActivity()` for å resette
  // timeren. Warning fyres maks 1x per idle-periode.
  const warningFiredRef = useRef(false);
  // Lagre callbacks i refs så de er ferske inne i polling-loopen uten
  // å trigge re-mount av effecten.
  const onAutoLockWarningRef = useRef(opts.onAutoLockWarning);
  const onAutoLockActivityRef = useRef(opts.onAutoLockActivity);
  useEffect(() => {
    onAutoLockWarningRef.current = opts.onAutoLockWarning;
    onAutoLockActivityRef.current = opts.onAutoLockActivity;
  }, [opts.onAutoLockWarning, opts.onAutoLockActivity]);

  useEffect(() => {
    if (status !== "unlocked") return;

    const autoLockMs = Math.max(1, autoLockMinutes) * 60 * 1000;
    const warningMs = autoLockWarningSecs * 1000;
    const warningThreshold = Math.max(0, autoLockMs - warningMs);
    lastActivityRef.current = Date.now();
    warningFiredRef.current = false;

    const doLock = () => {
      warningFiredRef.current = false;
      sessionRef.current = null;
      setEntries([]);
      clearSessionUnlock();
      setStatus("locked");
    };

    const checkIdle = () => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= autoLockMs) {
        doLock();
        return;
      }
      if (idleMs >= warningThreshold && !warningFiredRef.current) {
        warningFiredRef.current = true;
        onAutoLockWarningRef.current?.();
      }
    };

    const bumpActivity = () => {
      lastActivityRef.current = Date.now();
      if (warningFiredRef.current) {
        warningFiredRef.current = false;
        onAutoLockActivityRef.current?.();
      }
    };

    const onVisibility = () => {
      // Når fanen/vinduet kommer tilbake i fokus etter sleep/background —
      // sjekk med én gang om for mye tid har gått.
      if (document.visibilityState === "visible") checkIdle();
    };

    // Poll hvert 15. sekund — fyrer umiddelbart når Mac våkner fra sleep.
    const intervalId = window.setInterval(checkIdle, 15_000);

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ];
    events.forEach((ev) =>
      window.addEventListener(ev, bumpActivity, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkIdle);

    return () => {
      window.clearInterval(intervalId);
      events.forEach((ev) => window.removeEventListener(ev, bumpActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkIdle);
    };
  }, [status, autoLockMinutes]);

  // ---------- Actions ----------

  const setupVault = useCallback(
    async (masterPassword: string) => {
      const payload: VaultPayload = {
        version: 1,
        entries: [],
        lastMasterAt: new Date().toISOString(),
      };
      const blob = await encryptVault(payload, masterPassword);
      await pushRemoteBlob(blob);
      remoteBlobRef.current = blob;
      const result = await decryptVault(blob, masterPassword);
      sessionRef.current = {
        key: result.key,
        salt: result.salt,
        iterations: result.iterations,
        payload: result.payload,
      };
      setEntries(result.payload.entries);
      markUnlockedNow();
      markMasterUsedNow();
      reportEvent("unlock-success");
      setStatus("unlocked");
      await refreshBiometric();
      // Trigger cards-blob (eller andre side-blobs) som bruker samme master-pwd
      try {
        await onMasterUnlockRef.current?.(masterPassword);
      } catch {
        /* side-blob-feil skal ikke blokkere vault-setup */
      }
    },
    [refreshBiometric],
  );

  const unlock = useCallback(
    async (masterPassword: string) => {
      let blob = remoteBlobRef.current;
      if (!blob) {
        blob = await fetchRemoteBlob();
        if (!blob) throw new Error(tHook("vault.error_not_found_on_server"));
        remoteBlobRef.current = blob;
      }
      let result;
      try {
        result = await decryptVault(blob, masterPassword);
      } catch (err) {
        // Feil master-passord — rapporter til server for rate-limiting
        reportEvent("unlock-fail");
        throw err;
      }
      sessionRef.current = {
        key: result.key,
        salt: result.salt,
        iterations: result.iterations,
        payload: result.payload,
      };
      setEntries(result.payload.entries);
      markUnlockedNow();
      markMasterUsedNow();
      reportEvent("unlock-success");
      setStatus("unlocked");
      await refreshBiometric();
      try {
        await onMasterUnlockRef.current?.(masterPassword);
      } catch {
        /* graceful — cards/ids kan låses opp manuelt fra fanen */
      }
    },
    [refreshBiometric],
  );

  const unlockWithBiometric = useCallback(async () => {
    const bio = loadBiometric();
    if (!bio) throw new Error(tHook("vault.error_biometric_not_active"));
    if (!checkMasterFresh(forceMasterAfterDays)) {
      throw new Error(
        `Master-passord kreves (utløpt etter ${forceMasterAfterDays} dager)`,
      );
    }
    const credentialId = base64UrlToBuffer(bio.credentialId);
    const prfSalt = base64UrlToBuffer(bio.prfSalt);
    const prfSecret = await evaluatePrf(credentialId, prfSalt);
    const iv = base64UrlToBuffer(bio.iv);
    const cipher = base64UrlToBuffer(bio.cipher);
    const masterPassword = await unwrapMasterPassword(iv, cipher, prfSecret);
    let blob = remoteBlobRef.current;
    if (!blob) {
      blob = await fetchRemoteBlob();
      if (!blob) throw new Error(tHook("vault.error_not_found_on_server"));
      remoteBlobRef.current = blob;
    }
    const result = await decryptVault(blob, masterPassword);
    sessionRef.current = {
      key: result.key,
      salt: result.salt,
      iterations: result.iterations,
      payload: result.payload,
    };
    setEntries(result.payload.entries);
    markUnlockedNow();
    reportEvent("unlock-biometric");
    setStatus("unlocked");
    await refreshBiometric();
    try {
      await onMasterUnlockRef.current?.(masterPassword);
    } catch {
      /* graceful */
    }
  }, [forceMasterAfterDays, refreshBiometric]);

  const registerBiometric = useCallback(
    async (masterPassword: string) => {
      // KRITISK Safari-fix: WebAuthn-prompten MÅ kalles umiddelbart etter
      // brukerens klikk-gesture. Tung CPU-jobb (PBKDF2 600k iter via
      // decryptVault) mellom click og navigator.credentials.create() får
      // Safari til å miste "transient user activation" og kaste feilen
      // "The document is not focused". Derfor: kall WebAuthn FØRST mens
      // user activation er fresh, deretter verifiser master-passord.
      //
      // Trade-off: hvis brukeren skriver feil master-passord blir det et
      // ubrukt credential igjen i Secure Enclave / passkey-listen. Bruker
      // må rydde manuelt (Settings → Passkeys på macOS/iOS). Sannsynlighet
      // er lav siden de akkurat skrev passordet for å nå denne flyten.
      let blob = remoteBlobRef.current;
      if (!blob) {
        blob = await fetchRemoteBlob();
        if (!blob) throw new Error(tHook("vault.error_not_found_on_server"));
      }

      const reg = await registerBiometricCredential({
        rpName,
        userName: userDisplayName.toLowerCase().replace(/\s+/g, ".") || "vault-user",
        userDisplayName,
      });

      // Verifiser master-passord ETTER WebAuthn-prompten har gått gjennom.
      // Hvis passordet er feil avbryter vi før vi lagrer biometric-blobben
      // til localStorage. Det ubrukte credentialet blir liggende i Secure
      // Enclave (uskadelig — det matcher ingen lokal biometric-blob).
      try {
        await decryptVault(blob, masterPassword);
      } catch {
        throw new Error(
          "Master-passordet er feil. Touch ID / Face ID ble ikke aktivert. " +
            "Du kan rydde det ubrukte passkey-oppslaget manuelt i Systemvalg → Passkeys.",
        );
      }

      const wrapped = await wrapMasterPassword(masterPassword, reg.prfSecret);

      const bio: BiometricBlob = {
        version: 1,
        credentialId: bufferToBase64Url(reg.credentialId),
        prfSalt: bufferToBase64Url(reg.prfSalt),
        iv: bufferToBase64Url(wrapped.iv),
        cipher: bufferToBase64Url(wrapped.cipher),
        registeredAt: new Date().toISOString(),
      };
      saveBiometric(bio);
      markMasterUsedNow();
      await refreshBiometric();
    },
    [refreshBiometric, rpName, userDisplayName],
  );

  const removeBiometric = useCallback(() => {
    clearBiometric();
    void refreshBiometric();
  }, [refreshBiometric]);

  const dismissBiometricPrompt = useCallback(() => {
    dismissBioPromptStore();
    void refreshBiometric();
  }, [refreshBiometric]);

  const lock = useCallback(() => {
    sessionRef.current = null;
    setEntries([]);
    clearSessionUnlock();
    setStatus("locked");
  }, []);

  const destroyVault = useCallback(async () => {
    try {
      await deleteRemoteBlob();
    } catch {
      /* tillat lokal cleanup selv om server feiler */
    }
    clearBiometric();
    clearLastMasterAt();
    sessionRef.current = null;
    remoteBlobRef.current = null;
    setEntries([]);
    setLoginHistory([]);
    clearSessionUnlock();
    setStatus("needs-setup");
    await refreshBiometric();
  }, [refreshBiometric]);

  const saveEntries = useCallback(async (next: VaultEntry[]) => {
    const session = sessionRef.current;
    if (!session) throw new Error(tHook("vault.error_locked"));
    const newPayload: VaultPayload = {
      ...session.payload,
      entries: next,
    };
    const blob = await encryptVaultWithKey(
      newPayload,
      session.key,
      session.salt,
      session.iterations,
    );
    await pushRemoteBlob(blob);
    remoteBlobRef.current = blob;
    sessionRef.current = { ...session, payload: newPayload };
    setEntries(next);
  }, []);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const refresh = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) {
      // Ikke unlocked — gjør en plain re-fetch
      retry();
      return;
    }
    setRefreshing(true);
    try {
      const blob = await fetchRemoteBlob();
      if (!blob) {
        // Vault er borte fra server (slettet andre steder)
        sessionRef.current = null;
        remoteBlobRef.current = null;
        setEntries([]);
        clearSessionUnlock();
        setStatus("needs-setup");
        return;
      }
      remoteBlobRef.current = blob;
      try {
        const payload = await decryptVaultWithKey(blob, session.key);
        sessionRef.current = { ...session, payload };
        setEntries(payload.entries);
      } catch {
        // Master-pwd er endret andre steder → lås
        sessionRef.current = null;
        setEntries([]);
        clearSessionUnlock();
        setStatus("locked");
      }
    } finally {
      setRefreshing(false);
    }
  }, [retry]);

  const fetchBlobForBackup = useCallback(async () => {
    // Backup skal alltid speile Upstash, ikke RAM. Vi henter ferskt fra server.
    const blob = await fetchRemoteBlob();
    remoteBlobRef.current = blob;
    return blob;
  }, []);

  const applyImportedVault = useCallback(
    async (blob: EncryptedVaultBlob) => {
      await pushRemoteBlob(blob);
      remoteBlobRef.current = blob;
    },
    [],
  );

  const verifyMasterPassword = useCallback(async (pwd: string) => {
    const blob = remoteBlobRef.current ?? (await fetchRemoteBlob());
    if (!blob) return false;
    try {
      await decryptVault(blob, pwd);
      return true;
    } catch {
      return false;
    }
  }, []);

  const validateAndDecryptVault = useCallback(
    async (blob: EncryptedVaultBlob, pwd: string): Promise<VaultPayload> => {
      const result = await decryptVault(blob, pwd);
      return result.payload;
    },
    [],
  );

  const applyImportedVaultPayload = useCallback(
    async (payload: VaultPayload, targetPwd: string) => {
      // Re-krypter med ny salt + IV (encryptVault genererer dem). Server-blobben
      // erstattes komplett. Hvis vault var unlocked, må vi re-derive session
      // siden den eksisterende session.key er knyttet til gammel salt.
      const newBlob = await encryptVault(payload, targetPwd);
      await pushRemoteBlob(newBlob);
      remoteBlobRef.current = newBlob;

      if (sessionRef.current) {
        // Vault var unlocked → bruker forventer å forbli innlogget. Vi
        // re-deriver session med ny salt. Trygt fordi vi nettopp krypterte
        // med targetPwd (det funker, ellers ville push ha kastet over.)
        const result = await decryptVault(newBlob, targetPwd);
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: result.payload,
        };
        setEntries(result.payload.entries);
      }
    },
    [],
  );

  const importBackup = useCallback(
    async (opts: { vaultWasImported: boolean }) => {
      // Kun ansvar her: rydd lokal session/biometric når en import er gjennomført.
      // Selve push-operasjonene gjøres av page.tsx via BackupBlobSource.applyImported.
      //
      // Hvis vault-blobben ble importert må vi tvinge re-unlock (ny salt/IV/pwd).
      // Hvis kun andre blobs (f.eks. cards) ble importert, kan vault-session leve
      // videre — brukeren skal slippe å låse opp på nytt.
      if (opts.vaultWasImported) {
        sessionRef.current = null;
        setEntries([]);
        clearSessionUnlock();
        clearBiometric();
        setStatus("locked");
        await refreshBiometric();
      }
    },
    [refreshBiometric],
  );

  const changeMasterPassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      reEncryptSideBlobs?: SideBlobReEncrypter,
    ) => {
      if (newPassword.length < 12) {
        throw new Error(tHook("vault.error_new_pwd_min_12"));
      }
      if (newPassword === currentPassword) {
        throw new Error(tHook("vault.error_new_pwd_must_differ"));
      }
      // D-062: atomisk re-kryptering. Rekkefølge:
      //   1. Verifiser current pwd (decrypt vault)
      //   2. Re-krypter side-blobs FØRST (cards, ids) — disse har rollback
      //      hvis senere steg feiler
      //   3. Push vault sist — "barriere": hvis dette feiler, ruller vi
      //      tilbake side-blobs
      //
      // Rasjonale: hvis vault var ny pwd og cards/ids feilet, ville bruker
      // ende opp med vault=newPwd + cards/ids=oldPwd. Verre enn rollback.

      // ── Steg 1: Verifiser current ved å dekryptere eksisterende vault ──
      let blob = remoteBlobRef.current;
      if (!blob) {
        blob = await fetchRemoteBlob();
        if (!blob) throw new Error(tHook("vault.error_not_found_on_server"));
      }
      const result = await decryptVault(blob, currentPassword);

      // ── Steg 2: Re-krypter side-blobs atomisk (cards + ids) ──
      //    reEncryptSideBlobs implementert i vault-runtime.tsx; ved feil har
      //    den allerede rullet tilbake alt den rakk å pushe.
      if (reEncryptSideBlobs) {
        await reEncryptSideBlobs(currentPassword, newPassword);
      }

      // ── Steg 3: Re-krypter vault med nytt passord (nytt salt + IV) ──
      const newPayload: VaultPayload = {
        ...result.payload,
        lastMasterAt: new Date().toISOString(),
      };
      const newBlob = await encryptVault(newPayload, newPassword);

      // ── Steg 4: Push vault til server (barriere) ──
      //    Hvis dette feiler, må side-blobs rulles tilbake. vault-runtime
      //    håndterer dette ved å fange exception fra denne funksjonen.
      try {
        await pushRemoteBlob(newBlob);
      } catch (vaultPushErr) {
        // Side-blobs er allerede på newPwd. Vault er fortsatt på oldPwd på
        // server. Vi MÅ rulle tilbake side-blobs — kast en spesiell error
        // som vault-runtime fanger og bruker til å trigge rollback.
        const err = new Error(
          `Vault-push feilet — side-blobs må rulles tilbake: ${
            vaultPushErr instanceof Error
              ? vaultPushErr.message
              : "unknown"
          }`,
        );
        err.name = "VaultPushFailedNeedsRollback";
        throw err;
      }
      remoteBlobRef.current = newBlob;

      // ── Steg 5: Oppdater lokal vault-session ──
      const newSession = await decryptVault(newBlob, newPassword);
      sessionRef.current = {
        key: newSession.key,
        salt: newSession.salt,
        iterations: newSession.iterations,
        payload: newSession.payload,
      };

      // ── Steg 6: Invalider biometric (gammel wrap brukte gammelt pwd) ──
      clearBiometric();
      markMasterUsedNow();
      reportEvent("master-changed");
      await refreshBiometric();

      // ── Steg 7: Re-derive aktive side-blob sessions med newPwd ──
      //    onMasterUnlock-callback i vault-runtime trigger
      //    rederiveSessionAfterMpChange() for cards og ids.
      try {
        await onMasterUnlockRef.current?.(newPassword);
      } catch {
        /* graceful — re-derive er beste-effort, brukeren kan låse opp på nytt */
      }
    },
    [refreshBiometric],
  );

  // Iter 19.9.2 — eksponert til vault-runtime for toast-action "Fortsett"
  const bumpAutoLockActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    warningFiredRef.current = false;
  }, []);

  return {
    status,
    error,
    entries,
    biometric,
    loginHistory,
    loginHistoryLoading,
    refreshLoginHistory,
    clearLoginHistory,
    setupVault,
    unlock,
    unlockWithBiometric,
    registerBiometric,
    removeBiometric,
    bumpAutoLockActivity,
    dismissBiometricPrompt,
    lock,
    destroyVault,
    saveEntries,
    changeMasterPassword,
    fetchBlobForBackup,
    applyImportedVault,
    verifyMasterPassword,
    validateAndDecryptVault,
    applyImportedVaultPayload,
    importBackup,
    refresh,
    refreshing,
    retry,
  };
}
