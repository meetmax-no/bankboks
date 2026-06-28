// Eksport / import av kryptert backup (v3.0.5+).
//
// VERSJON 3 (v3.0.5): Selektiv eksport + import. Backup-fila inneholder
// et `blobs`-map med vilkårlig antall krypterte blobs. Bruker velger ved
// eksport hvilke som skal med, og ved import hvilke som skal restaureres.
//
// VERSJON 2 (v3.0): Faste `vault` + `cards`-felter. Leses fortsatt ved
// import — vi mapper internt til v3-format. Eksport produserer kun v3.
//
// VERSJON 1: Kun vault. Avvises ved import (D-001 — vi vil ikke late som
// om en gammel backup gir full sikkerhetsstatus).
//
// Master-passordet er aldri i fila. Den som importerer må kunne låse opp
// hver valgte blob med samme master-passord som ble brukt ved eksport.

import type { EncryptedVaultBlob } from "./types";
import { tHook } from "./i18n";

const ENVELOPE_KIND = "kodo-vault-backup";
const ENVELOPE_VERSION_CURRENT = 3 as const;
const ENVELOPE_VERSION_LEGACY_V2 = 2 as const;

// Kjente blob-IDer. Listen er åpen — fremtidige blobs (ID-er, dokumenter)
// kan legges til uten å endre selve format-strukturen.
export type BlobId = string;

/** V3-envelope (alltid det vi produserer). */
export interface BackupEnvelope {
  kind: typeof ENVELOPE_KIND;
  envelopeVersion: typeof ENVELOPE_VERSION_CURRENT;
  exportedAt: string; // ISO
  app: string; // "Ko | Do · Vault"
  appVersion: string;
  /** Kart fra blob-ID til kryptert blob. Kun valgte blobs er med. */
  blobs: Record<BlobId, EncryptedVaultBlob>;
  /** Liste over inkluderte blob-IDer (rask UI-validering uten å lese alle keys). */
  includedBlobs: BlobId[];
}

/** V2-format — bevart kun for parse/migrering ved import. */
interface BackupEnvelopeV2 {
  kind: typeof ENVELOPE_KIND;
  envelopeVersion: typeof ENVELOPE_VERSION_LEGACY_V2;
  exportedAt: string;
  app: string;
  appVersion: string;
  vault: EncryptedVaultBlob;
  cards: EncryptedVaultBlob | null;
}

// ---------- Export ----------

/**
 * Bygger en v3-envelope fra et kart av valgte blobs. Kalleren har ansvar for
 * å hente ferske blobs fra Upstash og bare inkludere de brukeren har valgt.
 */
export function buildEnvelope(
  blobs: Record<BlobId, EncryptedVaultBlob>,
  opts: { appVersion: string },
): BackupEnvelope {
  const includedBlobs = Object.keys(blobs).sort();
  if (includedBlobs.length === 0) {
    throw new Error(tHook("backup.error_empty"));
  }
  return {
    kind: ENVELOPE_KIND,
    envelopeVersion: ENVELOPE_VERSION_CURRENT,
    exportedAt: new Date().toISOString(),
    app: "Ko | Do · Vault",
    appVersion: opts.appVersion,
    blobs,
    includedBlobs,
  };
}

/** Utløser nedlasting via anchor-download (ingen ekstra server-roundtrip). */
export function downloadEnvelope(env: BackupEnvelope): void {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(env, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  // Filnavn reflekterer scope: full / vault-only / cards-only / multi
  const scope = describeScope(env.includedBlobs);
  a.href = url;
  a.download = `kodo-vault-backup-${scope}-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function describeScope(ids: BlobId[]): string {
  if (ids.length === 0) return "tom";
  if (ids.length === 1) return ids[0];
  if (ids.length === 2 && ids.includes("vault") && ids.includes("cards")) {
    return "full";
  }
  return ids.join("-");
}

// ---------- Import ----------

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupParseError";
  }
}

function isEncryptedVaultBlob(x: unknown): x is EncryptedVaultBlob {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.salt === "string" &&
    typeof o.iv === "string" &&
    typeof o.cipher === "string" &&
    typeof o.iterations === "number" &&
    o.iterations > 0 &&
    typeof o.updatedAt === "string"
  );
}

/**
 * Parser en backup-fil. Aksepterer både v2 og v3 — v2 migreres internt til v3.
 * Eldre versjoner avvises.
 */
export function parseEnvelope(text: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupParseError("Ugyldig JSON — fila er ikke en gyldig backup");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BackupParseError("Backup-fila har feil format");
  }
  const env = parsed as { kind?: unknown; envelopeVersion?: unknown };

  if (env.kind !== ENVELOPE_KIND) {
    throw new BackupParseError(
      "Fila er ikke en Ko | Do · Vault-backup (feil `kind`)",
    );
  }

  if (env.envelopeVersion === ENVELOPE_VERSION_CURRENT) {
    return validateV3(parsed as Partial<BackupEnvelope>);
  }

  if (env.envelopeVersion === ENVELOPE_VERSION_LEGACY_V2) {
    return migrateV2ToV3(parsed as Partial<BackupEnvelopeV2>);
  }

  throw new BackupParseError(
    `Backup-versjon ${String(env.envelopeVersion)} støttes ikke. Eksporter ny backup fra v3.0.5+.`,
  );
}

function validateV3(env: Partial<BackupEnvelope>): BackupEnvelope {
  if (!env.blobs || typeof env.blobs !== "object") {
    throw new BackupParseError("Backup mangler `blobs`-felt");
  }
  if (!Array.isArray(env.includedBlobs) || env.includedBlobs.length === 0) {
    throw new BackupParseError("Backup mangler `includedBlobs`-liste");
  }
  for (const id of env.includedBlobs) {
    if (typeof id !== "string") {
      throw new BackupParseError("Ugyldig blob-ID i `includedBlobs`");
    }
    if (!isEncryptedVaultBlob(env.blobs[id])) {
      throw new BackupParseError(`Blob "${id}" mangler eller er korrupt`);
    }
  }
  return env as BackupEnvelope;
}

function migrateV2ToV3(env: Partial<BackupEnvelopeV2>): BackupEnvelope {
  if (!isEncryptedVaultBlob(env.vault)) {
    throw new BackupParseError("Backup-vault mangler eller er korrupt");
  }
  if (env.cards !== null && env.cards !== undefined && !isEncryptedVaultBlob(env.cards)) {
    throw new BackupParseError("Backup-cards-blob er korrupt");
  }
  const blobs: Record<BlobId, EncryptedVaultBlob> = { vault: env.vault };
  if (env.cards) blobs.cards = env.cards;
  return {
    kind: ENVELOPE_KIND,
    envelopeVersion: ENVELOPE_VERSION_CURRENT,
    exportedAt: env.exportedAt ?? new Date().toISOString(),
    app: env.app ?? "Ko | Do · Vault",
    appVersion: env.appVersion ?? "v2",
    blobs,
    includedBlobs: Object.keys(blobs).sort(),
  };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Kunne ikke lese fila"));
    reader.readAsText(file);
  });
}
