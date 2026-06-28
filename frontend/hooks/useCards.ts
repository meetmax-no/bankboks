"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decryptPayload,
  decryptPayloadWithKey,
  encryptPayload,
  encryptPayloadWithKey,
} from "@/lib/crypto";
import {
  deleteRemoteCardsBlob,
  fetchRemoteCardsBlob,
  pushRemoteCardsBlob,
} from "@/lib/cards-sync";
import { tHook } from "@/lib/i18n";
import type {
  CardsPayload,
  EncryptedVaultBlob,
  VaultCard,
} from "@/lib/types";

// Cards-blob (`vault:default:cards`) bruker samme master-passord som hovedvault,
// men har eget salt og IV. Den er lazy-loaded — fetches først når brukeren
// faktisk åpner Cards-fanen ELLER eksplisitt kaller hooken.
//
// State-machine:
//   - "idle"     : Master-pwd ikke gitt ennå (vault låst)
//   - "loading"  : Henter blob fra Upstash
//   - "needs-init": Ingen blob på server (første gang Mike åpner Cards)
//   - "locked"   : Blob finnes, men ikke dekryptert (cards-passord != vault-passord, edge-case)
//   - "ready"    : Dekryptert + klar for CRUD
//   - "error"    : Server-feil ved fetch

export type CardsStatus =
  | "idle"
  | "loading"
  | "needs-init"
  | "locked"
  | "ready"
  | "error";

interface CardsSession {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
  payload: CardsPayload;
}

export interface UseCardsResult {
  status: CardsStatus;
  error: string | null;
  cards: VaultCard[];
  /** Stash master-pwd ephemerally i RAM. Trigger INGEN Upstash-kall.
   *  Pwd-en brukes når `activate()` kalles (lazy-load per D-002). */
  prepareWithMasterPassword: (masterPassword: string) => void;
  /** Faktisk last + dekrypter cards-blob. Kalles fra DashboardShell første
   *  gang brukeren klikker Kort-fanen. Bruker pwd-en stashet av prepare(). */
  activate: () => Promise<void>;
  /** Lagre liste — krypterer + pusher til server. */
  saveCards: (next: VaultCard[]) => Promise<void>;
  /** Tøm session OG ephemeral master-pwd (kalles ved auto-lås). */
  lock: () => void;
  /** Slett cards-blob fra server (kalles ved destroyVault). */
  destroy: () => Promise<void>;
  /** Refresh fra server uten å spørre om master-pwd igjen. */
  refresh: () => Promise<void>;
  /** Returnerer nåværende kryptert blob fra RAM-cache. Kan være null hvis cards-fanen aldri er aktivert. */
  getRemoteBlob: () => import("@/lib/types").EncryptedVaultBlob | null;
  /** Henter kryptert blob fra Upstash for backup-eksport. Dekrypterer IKKE. */
  fetchBlobForBackup: () => Promise<import("@/lib/types").EncryptedVaultBlob | null>;
  /** Returnerer ephemeralt master-pwd fra RAM (kun mens vault er ulåst). */
  getCurrentMasterPassword: () => string | null;
  /** Validerer + dekrypterer en kryptert cards-blob med oppgitt master-pwd. Kaster ved feil pwd. */
  validateAndDecrypt: (
    blob: import("@/lib/types").EncryptedVaultBlob,
    pwd: string,
  ) => Promise<CardsPayload>;
  /** Re-krypterer en payload med target-pwd og pusher til server. */
  applyImportedPayload: (
    payload: CardsPayload,
    targetPwd: string,
  ) => Promise<void>;
  /** Bytter ut server-blob med en importert versjon. Lokal session ryddes — bruker må låse opp på nytt med backup-passord. */
  applyImportedBlob: (
    blob: import("@/lib/types").EncryptedVaultBlob | null,
  ) => Promise<void>;
  /** Atomisk re-kryptering for master-pwd-bytte (D-062):
   *  fetch blob med oldPwd → decrypt → encrypt med newPwd → push.
   *  Returnerer { hadBlob: true, originalBlob } så vault-runtime kan
   *  rulle tilbake hvis senere steg feiler. Hvis ingen blob på server
   *  returneres { hadBlob: false }. */
  reEncryptInPlace: (
    oldPwd: string,
    newPwd: string,
  ) => Promise<{ hadBlob: false } | { hadBlob: true; originalBlob: import("@/lib/types").EncryptedVaultBlob }>;
  /** Re-derive aktiv session med newPwd etter at server-blob er re-kryptert.
   *  Kalles kun hvis brukeren hadde Kort-fanen aktiv (sessionRef !== null). */
  rederiveSessionAfterMpChange: (newPwd: string) => Promise<void>;
  /** Rollback: push gammel blob tilbake til server. Brukes ved feil under MP-bytte. */
  rollbackToBlob: (
    blob: import("@/lib/types").EncryptedVaultBlob,
  ) => Promise<void>;
}

export function useCards(): UseCardsResult {
  const [status, setStatus] = useState<CardsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<VaultCard[]>([]);
  const sessionRef = useRef<CardsSession | null>(null);
  const remoteBlobRef = useRef<EncryptedVaultBlob | null>(null);
  // Ephemeral master-pwd. Lever kun mellom unlock og auto-lås. Samme livssyklus
  // som vault session.key (begge tømmes av lock()). Brukes kun til å derivere
  // cards-nøkkel ved første activate() — ikke for noe annet.
  const ephemeralPwdRef = useRef<string | null>(null);

  // Reset alt når komponenten unmounts (forsiktig, men ikke kritisk)
  useEffect(() => {
    return () => {
      sessionRef.current = null;
      ephemeralPwdRef.current = null;
    };
  }, []);

  const prepareWithMasterPassword = useCallback((masterPassword: string) => {
    ephemeralPwdRef.current = masterPassword;
    // Status forblir "idle" — vi skal ikke vise "loading" før brukeren faktisk
    // ber om cards-fanen. D-002: lazy-load.
  }, []);

  const activate = useCallback(async () => {
    // Hvis allerede aktivert, no-op
    if (sessionRef.current) return;
    const masterPassword = ephemeralPwdRef.current;
    if (!masterPassword) {
      setError(tHook("cards.error_master_pwd_unavailable"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const blob = await fetchRemoteCardsBlob();
      remoteBlobRef.current = blob;

      if (!blob) {
        // Første gang — opprett tom blob med samme master-pwd
        const initialPayload: CardsPayload = { version: 1, cards: [] };
        const newBlob = await encryptPayload<CardsPayload>(
          initialPayload,
          masterPassword,
        );
        await pushRemoteCardsBlob(newBlob);
        remoteBlobRef.current = newBlob;
        const result = await decryptPayload<CardsPayload>(
          newBlob,
          masterPassword,
        );
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: result.payload,
        };
        setCards([]);
        setStatus("ready");
        return;
      }

      // Eksisterende blob — dekrypter
      try {
        const result = await decryptPayload<CardsPayload>(
          blob,
          masterPassword,
        );
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: result.payload,
        };
        setCards(result.payload.cards || []);
        setStatus("ready");
      } catch {
        // Cards-blob har annet master-pwd enn vault — sjelden, men kan skje
        // ved import av delvis backup. Brukeren må håndtere manuelt senere.
        setStatus("locked");
        setError(
          "Kort-databasen krypteres med et annet passord enn vault. Kontakt support.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukjent feil");
      setStatus("error");
    }
  }, []);

  const saveCards = useCallback(async (next: VaultCard[]) => {
    const session = sessionRef.current;
    if (!session) throw new Error(tHook("cards.error_not_unlocked"));
    const newPayload: CardsPayload = {
      ...session.payload,
      cards: next,
    };
    const blob = await encryptPayloadWithKey<CardsPayload>(
      newPayload,
      session.key,
      session.salt,
      session.iterations,
    );
    await pushRemoteCardsBlob(blob);
    remoteBlobRef.current = blob;
    sessionRef.current = { ...session, payload: newPayload };
    setCards(next);
  }, []);

  const lock = useCallback(() => {
    sessionRef.current = null;
    ephemeralPwdRef.current = null;
    setCards([]);
    setStatus("idle");
    setError(null);
  }, []);

  const destroy = useCallback(async () => {
    try {
      await deleteRemoteCardsBlob();
    } catch {
      /* tillat lokal cleanup selv om server feiler */
    }
    sessionRef.current = null;
    remoteBlobRef.current = null;
    ephemeralPwdRef.current = null;
    setCards([]);
    setStatus("idle");
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const blob = await fetchRemoteCardsBlob();
      if (!blob) {
        // Borte fra server (slettet andre steder) — reset state
        sessionRef.current = null;
        remoteBlobRef.current = null;
        setCards([]);
        setStatus("idle");
        return;
      }
      remoteBlobRef.current = blob;
      try {
        const payload = await decryptPayloadWithKey<CardsPayload>(
          blob,
          session.key,
        );
        sessionRef.current = { ...session, payload };
        setCards(payload.cards || []);
      } catch {
        // Master-pwd er endret andre steder → tving re-unlock
        sessionRef.current = null;
        setCards([]);
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh feilet");
    }
  }, []);

  const getRemoteBlob = useCallback(() => remoteBlobRef.current, []);

  const fetchBlobForBackup = useCallback(async () => {
    // Hvis vi allerede har blobben i RAM (cards-fanen var åpnet), bruk den.
    if (remoteBlobRef.current) return remoteBlobRef.current;
    // Ellers: hent direkte fra Upstash. Vi dekrypterer IKKE — backup-fila
    // skal inneholde den krypterte blobben uansett. Cache i RAM så
    // påfølgende activate() slipper ekstra roundtrip.
    const blob = await fetchRemoteCardsBlob();
    remoteBlobRef.current = blob;
    return blob;
  }, []);

  /** Returnerer master-pwd fra RAM hvis vault er ulåst, ellers null.
   *  Brukes av backup-import for å sammenligne backup-pwd med current pwd. */
  const getCurrentMasterPassword = useCallback(
    () => ephemeralPwdRef.current,
    [],
  );

  /** Validerer en kryptert cards-blob mot et oppgitt pwd ved å forsøke
   *  dekryptering. Kaster hvis pwd er feil. Returnerer dekryptert payload. */
  const validateAndDecrypt = useCallback(
    async (blob: EncryptedVaultBlob, pwd: string): Promise<CardsPayload> => {
      const result = await decryptPayload<CardsPayload>(blob, pwd);
      return result.payload;
    },
    [],
  );

  /** Re-krypterer en cards-payload med target-pwd (ny salt + IV) og pusher
   *  til Upstash. Brukes ved backup-import: payload kommer fra dekryptert
   *  backup-blob, target-pwd er current master-pwd (eller backup-pwd hvis
   *  vault er låst — kalleren bestemmer).
   *
   *  Hvis vault er ulåst og target-pwd matcher current ephemeral pwd
   *  (= alltid sant ved smart re-kryptering, fordi vi nettopp kalte
   *  verifyMasterPassword på den), re-deriver vi session umiddelbart slik at
   *  Kort-fanen oppdateres automatisk — bruker slipper manuell tab-bytte. */
  const applyImportedPayload = useCallback(
    async (payload: CardsPayload, targetPwd: string) => {
      const newBlob = await encryptPayload<CardsPayload>(payload, targetPwd);
      await pushRemoteCardsBlob(newBlob);
      remoteBlobRef.current = newBlob;

      const ephemeralPwd = ephemeralPwdRef.current;
      if (ephemeralPwd && ephemeralPwd === targetPwd) {
        // Vault unlocked + target = current pwd → re-derive session direkte
        // så Kort-fanen viser ny data umiddelbart (fix for "import henger"-bug).
        const result = await decryptPayload<CardsPayload>(newBlob, targetPwd);
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: result.payload,
        };
        setCards(result.payload.cards || []);
        setStatus("ready");
      } else {
        // Vault låst eller pwd-mismatch der target ≠ ephemeral pwd → reset.
        // Bruker må låse opp på nytt (i låst tilstand) eller bruker er ferdig
        // (sjelden case hvor target = backup-pwd ≠ current).
        sessionRef.current = null;
        setCards([]);
        setStatus("idle");
      }
      setError(null);
    },
    [],
  );

  const applyImportedBlob = useCallback(
    async (blob: EncryptedVaultBlob | null) => {
      if (blob) {
        await pushRemoteCardsBlob(blob);
        remoteBlobRef.current = blob;
      } else {
        // Backup hadde ingen kort — slett evt eksisterende blob på server
        try {
          await deleteRemoteCardsBlob();
        } catch {
          /* graceful — backup-flow fortsetter selv hvis sletting feiler */
        }
        remoteBlobRef.current = null;
      }
      // Lokal session må ryddes — bruker må låse opp på nytt med backup-pwd
      sessionRef.current = null;
      ephemeralPwdRef.current = null;
      setCards([]);
      setStatus("idle");
      setError(null);
    },
    [],
  );

  /**
   * D-062: Atomisk re-kryptering for master-pwd-bytte.
   * Fetcher blob fra server med oldPwd, decrypter, re-krypterer med newPwd,
   * pusher tilbake. Returnerer originalBlob for evt rollback.
   *
   * Endrer IKKE lokal session-state — vault-runtime håndterer det via
   * rederiveSessionAfterMpChange() etter at hele atomiske operasjonen er OK.
   */
  const reEncryptInPlace = useCallback(
    async (
      oldPwd: string,
      newPwd: string,
    ): Promise<
      { hadBlob: false } | { hadBlob: true; originalBlob: EncryptedVaultBlob }
    > => {
      const original = await fetchRemoteCardsBlob();
      if (!original) return { hadBlob: false };
      // Decrypt med gammelt pwd
      const decrypted = await decryptPayload<CardsPayload>(original, oldPwd);
      // Encrypt med nytt pwd (ny salt + IV genereres av encryptPayload)
      const reEncrypted = await encryptPayload<CardsPayload>(
        decrypted.payload,
        newPwd,
      );
      await pushRemoteCardsBlob(reEncrypted);
      remoteBlobRef.current = reEncrypted;
      return { hadBlob: true, originalBlob: original };
    },
    [],
  );

  /**
   * D-062: Etter at server-blobben er re-kryptert til newPwd, re-derive
   * aktiv session så Kort-fanen fortsetter å fungere uten manuell unlock.
   * Kun hvis cards-fanen var aktiv (sessionRef !== null).
   */
  const rederiveSessionAfterMpChange = useCallback(
    async (newPwd: string) => {
      const blob = remoteBlobRef.current;
      if (!blob || !sessionRef.current) {
        // Cards ikke aktiv — bare oppdater ephemeral pwd, lazy-load henter ved neste activate
        ephemeralPwdRef.current = newPwd;
        return;
      }
      const result = await decryptPayload<CardsPayload>(blob, newPwd);
      sessionRef.current = {
        key: result.key,
        salt: result.salt,
        iterations: result.iterations,
        payload: result.payload,
      };
      ephemeralPwdRef.current = newPwd;
      setCards(result.payload.cards || []);
    },
    [],
  );

  /**
   * D-062: Rollback ved feil under MP-bytte. Pusher gammel blob til server.
   */
  const rollbackToBlob = useCallback(async (blob: EncryptedVaultBlob) => {
    await pushRemoteCardsBlob(blob);
    remoteBlobRef.current = blob;
  }, []);

  return {
    status,
    error,
    cards,
    prepareWithMasterPassword,
    activate,
    saveCards,
    lock,
    destroy,
    refresh,
    getRemoteBlob,
    fetchBlobForBackup,
    getCurrentMasterPassword,
    validateAndDecrypt,
    applyImportedPayload,
    applyImportedBlob,
    reEncryptInPlace,
    rederiveSessionAfterMpChange,
    rollbackToBlob,
  };
}
