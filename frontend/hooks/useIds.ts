"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decryptPayload,
  decryptPayloadWithKey,
  encryptPayload,
  encryptPayloadWithKey,
} from "@/lib/crypto";
import {
  deleteRemoteIdsBlob,
  fetchRemoteIdsBlob,
  pushRemoteIdsBlob,
} from "@/lib/ids-sync";
import { tHook } from "@/lib/i18n";
import type {
  EncryptedVaultBlob,
  IdAttachment,
  IdsPayload,
  VaultId,
} from "@/lib/types";

/**
 * Bakover-kompatibel migrering 2026-02:
 * Tidligere IdBase hadde `attachment?: IdAttachment` (singular). Vi byttet til
 * `attachments?: IdAttachment[]` (0–3). Ved decrypt sjekker vi om noen ID-er
 * har gammel singular-felt og konverterer transparent til array. Lagring skjer
 * ALLTID med ny struktur — neste save fjerner legacy-feltet for godt.
 */
function migrateLegacyAttachments(ids: VaultId[]): VaultId[] {
  return ids.map((id) => {
    const legacy = (id as VaultId & { attachment?: IdAttachment }).attachment;
    if (legacy && !id.attachments) {
      // Konverter til array, dropp legacy-feltet ved neste save
      const { attachment: _drop, ...rest } = id as VaultId & {
        attachment?: IdAttachment;
      };
      return { ...rest, attachments: [legacy] } as VaultId;
    }
    return id;
  });
}

// IDs-blob (`vault:default:ids`) bruker samme master-passord som hovedvault,
// men har eget salt og IV (D-002/D-033). Den er lazy-loaded — fetches først når
// brukeren faktisk åpner ID-fanen ELLER eksplisitt kaller hooken.
//
// State-machine (speil av useCards):
//   - "idle"      : Master-pwd ikke gitt ennå (vault låst)
//   - "loading"   : Henter blob fra Upstash
//   - "needs-init": Ingen blob på server (første gang Lars åpner ID-er)
//   - "locked"    : Blob finnes, men ikke dekryptert (annet master-pwd, edge-case)
//   - "ready"     : Dekryptert + klar for CRUD
//   - "error"     : Server-feil ved fetch

export type IdsStatus =
  | "idle"
  | "loading"
  | "needs-init"
  | "locked"
  | "ready"
  | "error";

interface IdsSession {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
  payload: IdsPayload;
}

export interface UseIdsResult {
  status: IdsStatus;
  error: string | null;
  ids: VaultId[];
  /** Stash master-pwd ephemerally i RAM. Trigger INGEN Upstash-kall.
   *  Pwd-en brukes når `activate()` kalles (lazy-load per D-002). */
  prepareWithMasterPassword: (masterPassword: string) => void;
  /** Faktisk last + dekrypter ID-blob. Kalles fra DashboardShell første
   *  gang brukeren klikker ID-fanen. Bruker pwd-en stashet av prepare(). */
  activate: () => Promise<void>;
  /** Lagre liste — krypterer + pusher til server. */
  saveIds: (next: VaultId[]) => Promise<void>;
  /** Tøm session OG ephemeral master-pwd (kalles ved auto-lås). */
  lock: () => void;
  /** Slett ID-blob fra server (kalles ved destroyVault). */
  destroy: () => Promise<void>;
  /** Refresh fra server uten å spørre om master-pwd igjen. */
  refresh: () => Promise<void>;
  /** Returnerer nåværende kryptert blob fra RAM-cache. */
  getRemoteBlob: () => EncryptedVaultBlob | null;
  /** Henter kryptert blob fra Upstash for backup-eksport. Dekrypterer IKKE. */
  fetchBlobForBackup: () => Promise<EncryptedVaultBlob | null>;
  /** Returnerer ephemeralt master-pwd fra RAM (kun mens vault er ulåst). */
  getCurrentMasterPassword: () => string | null;
  /** Validerer + dekrypterer en kryptert ID-blob med oppgitt master-pwd. Kaster ved feil pwd. */
  validateAndDecrypt: (
    blob: EncryptedVaultBlob,
    pwd: string,
  ) => Promise<IdsPayload>;
  /** Re-krypterer en payload med target-pwd og pusher til server. */
  applyImportedPayload: (
    payload: IdsPayload,
    targetPwd: string,
  ) => Promise<void>;
  /** Bytter ut server-blob med en importert versjon. Lokal session ryddes —
   *  bruker må låse opp på nytt med backup-passord. */
  applyImportedBlob: (blob: EncryptedVaultBlob | null) => Promise<void>;
  /** D-062: Atomisk re-kryptering for master-pwd-bytte. */
  reEncryptInPlace: (
    oldPwd: string,
    newPwd: string,
  ) => Promise<{ hadBlob: false } | { hadBlob: true; originalBlob: EncryptedVaultBlob }>;
  /** D-062: Re-derive session etter MP-bytte hvis ID-fanen var aktiv. */
  rederiveSessionAfterMpChange: (newPwd: string) => Promise<void>;
  /** D-062: Rollback push av gammel blob. */
  rollbackToBlob: (blob: EncryptedVaultBlob) => Promise<void>;
}

export function useIds(): UseIdsResult {
  const [status, setStatus] = useState<IdsStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<VaultId[]>([]);
  const sessionRef = useRef<IdsSession | null>(null);
  const remoteBlobRef = useRef<EncryptedVaultBlob | null>(null);
  // Ephemeral master-pwd. Lever kun mellom unlock og auto-lås. Samme livssyklus
  // som vault session.key (begge tømmes av lock()). Brukes kun til å derivere
  // IDs-nøkkel ved første activate() — ikke for noe annet.
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
    // ber om ID-fanen. D-002: lazy-load.
  }, []);

  const activate = useCallback(async () => {
    // Hvis allerede aktivert, no-op
    if (sessionRef.current) return;
    const masterPassword = ephemeralPwdRef.current;
    if (!masterPassword) {
      setError(tHook("ids.error_master_pwd_unavailable"));
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const blob = await fetchRemoteIdsBlob();
      remoteBlobRef.current = blob;

      if (!blob) {
        // Første gang — opprett tom blob med samme master-pwd
        const initialPayload: IdsPayload = { version: 1, ids: [] };
        const newBlob = await encryptPayload<IdsPayload>(
          initialPayload,
          masterPassword,
        );
        await pushRemoteIdsBlob(newBlob);
        remoteBlobRef.current = newBlob;
        const result = await decryptPayload<IdsPayload>(newBlob, masterPassword);
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: result.payload,
        };
        setIds([]);
        setStatus("ready");
        return;
      }

      // Eksisterende blob — dekrypter
      try {
        const result = await decryptPayload<IdsPayload>(blob, masterPassword);
        const migratedIds = migrateLegacyAttachments(result.payload.ids || []);
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: { ...result.payload, ids: migratedIds },
        };
        setIds(migratedIds);
        setStatus("ready");
      } catch {
        // ID-blob har annet master-pwd enn vault — sjelden, men kan skje
        // ved import av delvis backup. Brukeren må håndtere manuelt senere.
        setStatus("locked");
        setError(
          "ID-databasen krypteres med et annet passord enn vault. Kontakt support.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ukjent feil");
      setStatus("error");
    }
  }, []);

  const saveIds = useCallback(async (next: VaultId[]) => {
    const session = sessionRef.current;
    if (!session) throw new Error(tHook("ids.error_not_unlocked"));
    const newPayload: IdsPayload = {
      ...session.payload,
      ids: next,
    };
    const blob = await encryptPayloadWithKey<IdsPayload>(
      newPayload,
      session.key,
      session.salt,
      session.iterations,
    );
    await pushRemoteIdsBlob(blob);
    remoteBlobRef.current = blob;
    sessionRef.current = { ...session, payload: newPayload };
    setIds(next);
  }, []);

  const lock = useCallback(() => {
    sessionRef.current = null;
    ephemeralPwdRef.current = null;
    setIds([]);
    setStatus("idle");
    setError(null);
  }, []);

  const destroy = useCallback(async () => {
    try {
      await deleteRemoteIdsBlob();
    } catch {
      /* tillat lokal cleanup selv om server feiler */
    }
    sessionRef.current = null;
    remoteBlobRef.current = null;
    ephemeralPwdRef.current = null;
    setIds([]);
    setStatus("idle");
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      const blob = await fetchRemoteIdsBlob();
      if (!blob) {
        // Borte fra server (slettet andre steder) — reset state
        sessionRef.current = null;
        remoteBlobRef.current = null;
        setIds([]);
        setStatus("idle");
        return;
      }
      remoteBlobRef.current = blob;
      try {
        const payload = await decryptPayloadWithKey<IdsPayload>(
          blob,
          session.key,
        );
        const migratedIds = migrateLegacyAttachments(payload.ids || []);
        sessionRef.current = {
          ...session,
          payload: { ...payload, ids: migratedIds },
        };
        setIds(migratedIds);
      } catch {
        // Master-pwd er endret andre steder → tving re-unlock
        sessionRef.current = null;
        setIds([]);
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh feilet");
    }
  }, []);

  const getRemoteBlob = useCallback(() => remoteBlobRef.current, []);

  const fetchBlobForBackup = useCallback(async () => {
    // Hvis vi allerede har blobben i RAM (ID-fanen var åpnet), bruk den.
    if (remoteBlobRef.current) return remoteBlobRef.current;
    // Ellers: hent direkte fra Upstash. Vi dekrypterer IKKE — backup-fila
    // skal inneholde den krypterte blobben uansett.
    const blob = await fetchRemoteIdsBlob();
    remoteBlobRef.current = blob;
    return blob;
  }, []);

  const getCurrentMasterPassword = useCallback(
    () => ephemeralPwdRef.current,
    [],
  );

  const validateAndDecrypt = useCallback(
    async (blob: EncryptedVaultBlob, pwd: string): Promise<IdsPayload> => {
      const result = await decryptPayload<IdsPayload>(blob, pwd);
      return result.payload;
    },
    [],
  );

  const applyImportedPayload = useCallback(
    async (payload: IdsPayload, targetPwd: string) => {
      const newBlob = await encryptPayload<IdsPayload>(payload, targetPwd);
      await pushRemoteIdsBlob(newBlob);
      remoteBlobRef.current = newBlob;

      const ephemeralPwd = ephemeralPwdRef.current;
      if (ephemeralPwd && ephemeralPwd === targetPwd) {
        // Vault unlocked + target = current pwd → re-derive session direkte
        // så ID-fanen viser ny data umiddelbart.
        const result = await decryptPayload<IdsPayload>(newBlob, targetPwd);
        const migratedIds = migrateLegacyAttachments(result.payload.ids || []);
        sessionRef.current = {
          key: result.key,
          salt: result.salt,
          iterations: result.iterations,
          payload: { ...result.payload, ids: migratedIds },
        };
        setIds(migratedIds);
        setStatus("ready");
      } else {
        sessionRef.current = null;
        setIds([]);
        setStatus("idle");
      }
      setError(null);
    },
    [],
  );

  const applyImportedBlob = useCallback(
    async (blob: EncryptedVaultBlob | null) => {
      if (blob) {
        await pushRemoteIdsBlob(blob);
        remoteBlobRef.current = blob;
      } else {
        // Backup hadde ingen ID-er — slett evt eksisterende blob på server
        try {
          await deleteRemoteIdsBlob();
        } catch {
          /* graceful — backup-flow fortsetter selv hvis sletting feiler */
        }
        remoteBlobRef.current = null;
      }
      // Lokal session må ryddes — bruker må låse opp på nytt med backup-pwd
      sessionRef.current = null;
      ephemeralPwdRef.current = null;
      setIds([]);
      setStatus("idle");
      setError(null);
    },
    [],
  );

  /** D-062: Atomisk re-kryptering for master-pwd-bytte. */
  const reEncryptInPlace = useCallback(
    async (
      oldPwd: string,
      newPwd: string,
    ): Promise<
      { hadBlob: false } | { hadBlob: true; originalBlob: EncryptedVaultBlob }
    > => {
      const original = await fetchRemoteIdsBlob();
      if (!original) return { hadBlob: false };
      const decrypted = await decryptPayload<IdsPayload>(original, oldPwd);
      const reEncrypted = await encryptPayload<IdsPayload>(
        decrypted.payload,
        newPwd,
      );
      await pushRemoteIdsBlob(reEncrypted);
      remoteBlobRef.current = reEncrypted;
      return { hadBlob: true, originalBlob: original };
    },
    [],
  );

  /** D-062: Re-derive aktiv session etter MP-bytte hvis ID-fanen var åpen. */
  const rederiveSessionAfterMpChange = useCallback(
    async (newPwd: string) => {
      const blob = remoteBlobRef.current;
      if (!blob || !sessionRef.current) {
        ephemeralPwdRef.current = newPwd;
        return;
      }
      const result = await decryptPayload<IdsPayload>(blob, newPwd);
      const migratedIds = migrateLegacyAttachments(result.payload.ids || []);
      sessionRef.current = {
        key: result.key,
        salt: result.salt,
        iterations: result.iterations,
        payload: { ...result.payload, ids: migratedIds },
      };
      ephemeralPwdRef.current = newPwd;
      setIds(migratedIds);
    },
    [],
  );

  /** D-062: Rollback push av gammel blob ved feil under MP-bytte. */
  const rollbackToBlob = useCallback(async (blob: EncryptedVaultBlob) => {
    await pushRemoteIdsBlob(blob);
    remoteBlobRef.current = blob;
  }, []);

  return {
    status,
    error,
    ids,
    prepareWithMasterPassword,
    activate,
    saveIds,
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
