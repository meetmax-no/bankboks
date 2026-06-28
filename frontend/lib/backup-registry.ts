// Backup-registry: dynamisk liste over hvilke blobs som kan eksporteres/importeres.
//
// Hvert hook (useVault, useCards, fremtidig useIds osv.) eksponerer en
// `BackupBlobSource` med ID, label og funksjoner for fetch/validate/apply.
// Backup-modalene leser registret og rendrer checkboxer dynamisk —
// fremtidige blobs (v3.2 ID-er, v4.5 dokumenter) krever INGEN endring i
// selve backup-flyten.
//
// IMPORT-FLOW (v3.0.5+):
//   1. validateAndDecrypt(blob, backupPwd) → klartekst payload
//   2. Kalleren bestemmer target-pwd (current master-pwd hvis unlocked,
//      ellers backup-pwd)
//   3. applyImportedPayload(payload, targetPwd) → re-krypter + push
//
// Dette betyr at importert backup-data alltid lagres med dagens master-pwd
// (når mulig) — bruker mister aldri current pwd ved data-gjenoppretting.

import type { EncryptedVaultBlob } from "./types";
import type { BlobId } from "./backup";

export interface BackupBlobSource {
  id: BlobId;
  /** Visningsnavn i modal — f.eks. "Passord", "Kort". */
  label: string;
  /**
   * Antall oppføringer (hvis kjent fra dekryptert state). Kan være `null`
   * hvis blobben ikke er aktivert/dekryptert ennå (lazy-load D-002).
   */
  itemCount: number | null;
  /**
   * Henter ferskt kryptert blob fra Upstash. Returnerer `null` hvis ingen
   * blob finnes på server. Skal IKKE dekryptere — backup skal speile server.
   */
  fetchFromServer: () => Promise<EncryptedVaultBlob | null>;
  /**
   * Validerer + dekrypterer en kryptert blob med oppgitt master-pwd.
   * Kaster ved feil pwd. Returnerer klartekst payload som `unknown` —
   * hooken vet sin konkrete type, kalleren trenger den ikke.
   */
  validateAndDecrypt: (
    blob: EncryptedVaultBlob,
    pwd: string,
  ) => Promise<unknown>;
  /**
   * Re-krypterer payload med target-pwd og pusher til server. Brukes ved
   * import: payload kommer fra `validateAndDecrypt`, target-pwd bestemmes
   * av kalleren basert på vault-state og pwd-sammenligning.
   */
  applyImportedPayload: (payload: unknown, targetPwd: string) => Promise<void>;
}
