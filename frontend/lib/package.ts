// Ko | Do · Vault — v4.0 Sikker overlevering: `.kodoenc`-filformat (Iter 1)
//
// Dette modulet håndterer KUN envelope-formatet (binær struktur) og
// krypto-laget (PBKDF2 + AES-256-GCM). ZIP-laget kommer i Iter 2
// (lib/package-zip.ts) — Iter 1 jobber med en opaque `payload: Uint8Array`.
//
// SPEC: /app/memory/v4.0-SPEC.md seksjon 4
// ADR:  D-001 (100% North Star), D-003 (PGP-modell, ingen expiry),
//       D-007 (ZIP STORE), D-025 (klartekst-header = minimum strukturell)
//
// BINÆR STRUKTUR:
//   [ 8 bytes  ] MAGIC          "KODOENC\0"
//   [ 2 bytes  ] VERSION (uint16-LE)  0x0001
//   [ 4 bytes  ] HEADER-LEN (uint32-LE)  N
//   [ N bytes  ] HEADER-JSON (UTF-8)
//   [ rest     ] CIPHERTEXT (AES-256-GCM, auth-tag implisitt appendet)
//
// KRYPTOGRAFISK INVARIANTE:
//   - Auth-tag binder hele HEADER-JSON som additionalData (AAD).
//     Det betyr at en angriper IKKE kan endre iterations, salt eller iv
//     i klartekst-header uten at GCM-decrypt feiler. Dette stopper f.eks.
//     "endre iterations til 1 og forsøk bruteforce"-angrep.
//   - Hver pakke har egen salt (16 bytes) + egen iv (12 bytes), random.
//   - PBKDF2 iterations = 600 000 (matcher master-vault baseline).

import { deriveKey, PBKDF2_ITERATIONS, randomBytes } from "./crypto";
import { tHook } from "./i18n";

// ---------- Konstanter ----------

export const PACKAGE_MAGIC = new Uint8Array([
  0x4b, 0x4f, 0x44, 0x4f, 0x45, 0x4e, 0x43, 0x00, // "KODOENC\0"
]);
export const PACKAGE_VERSION_CURRENT = 1 as const;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const GCM_TAG_BITS = 128;
const MAX_HEADER_LEN = 64 * 1024; // 64 KB — sanity-cap mot oppblåst header

// ---------- Typer ----------

/** Klartekst-header (minimum strukturell — D-025). */
export interface PackageHeader {
  kind: "kodo-package";
  version: 1;
  kdf: {
    algorithm: "PBKDF2-SHA256";
    iterations: number;
    saltB64: string;
  };
  cipher: {
    algorithm: "AES-256-GCM";
    ivB64: string;
    tagBits: 128;
  };
}

/** Bruks-metadata (krypterte felt — ligger inni ZIP som `_metadata.json`). */
export interface PackageMetadata {
  createdAt: string; // ISO
  appVersion: string;
  app: "Ko | Do · Vault";
  fileCount: number;
  container: "zip-store";
}

/** Parsed envelope — magic + version + header + raw bytes for re-verifikasjon. */
export interface ParsedPackage {
  magic: Uint8Array;
  version: number;
  header: PackageHeader;
  /** Raw header-JSON bytes (brukes som AAD ved decrypt — KRITISK). */
  headerJsonBytes: Uint8Array;
  /** Ciphertext + 16-byte auth-tag (Web Crypto-format). */
  ciphertext: Uint8Array;
}

// ---------- Feilklasser ----------

export class PackageParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageParseError";
  }
}

export class PackageDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageDecryptError";
  }
}

// ---------- Base64 helpers (browser + Node-safe via global atob/btoa) ----------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Envelope build ----------

export interface BuildPackageOptions {
  /** Opaque payload (i Iter 2: ZIP STORE-bytes med _metadata.json + filer). */
  payload: Uint8Array;
  /** Engangs-passord Lars taster selv (D-001 — egen sikkerhetsmodell). */
  password: string;
}

/**
 * Bygger en `.kodoenc`-envelope fra en opaque payload og engangs-passord.
 * Returnerer ferdig binær blob klar for nedlasting eller fil-skriving.
 */
export async function buildPackage(
  opts: BuildPackageOptions,
): Promise<Uint8Array> {
  if (opts.password.length < 8) {
    throw new PackageParseError(
      tHook("package.error_password_min_8"),
    );
  }
  if (opts.payload.byteLength === 0) {
    throw new PackageParseError(
      tHook("package.error_payload_empty"),
    );
  }

  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveKey(opts.password, salt, PBKDF2_ITERATIONS);

  // Bygg klartekst-header (minimum strukturell — D-025)
  const header: PackageHeader = {
    kind: "kodo-package",
    version: PACKAGE_VERSION_CURRENT,
    kdf: {
      algorithm: "PBKDF2-SHA256",
      iterations: PBKDF2_ITERATIONS,
      saltB64: bytesToBase64(salt),
    },
    cipher: {
      algorithm: "AES-256-GCM",
      ivB64: bytesToBase64(iv),
      tagBits: GCM_TAG_BITS,
    },
  };
  const headerJsonBytes = new TextEncoder().encode(JSON.stringify(header));

  if (headerJsonBytes.byteLength > MAX_HEADER_LEN) {
    throw new PackageParseError(
      `Header for stor (${headerJsonBytes.byteLength} bytes, max ${MAX_HEADER_LEN})`,
    );
  }

  // Krypter payload med headerJSON som AAD — auth-tag binder header til ciphertext
  const cipherBuf = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: headerJsonBytes as BufferSource,
      tagLength: GCM_TAG_BITS,
    },
    key,
    opts.payload as BufferSource,
  );
  const ciphertext = new Uint8Array(cipherBuf);

  // Sett sammen binær envelope: magic + version + headerLen + header + ciphertext
  const totalLen =
    PACKAGE_MAGIC.byteLength + 2 + 4 + headerJsonBytes.byteLength + ciphertext.byteLength;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  out.set(PACKAGE_MAGIC, offset);
  offset += PACKAGE_MAGIC.byteLength;

  // Version uint16-LE
  out[offset] = PACKAGE_VERSION_CURRENT & 0xff;
  out[offset + 1] = (PACKAGE_VERSION_CURRENT >> 8) & 0xff;
  offset += 2;

  // Header-len uint32-LE
  const headerLen = headerJsonBytes.byteLength;
  out[offset] = headerLen & 0xff;
  out[offset + 1] = (headerLen >> 8) & 0xff;
  out[offset + 2] = (headerLen >> 16) & 0xff;
  out[offset + 3] = (headerLen >> 24) & 0xff;
  offset += 4;

  out.set(headerJsonBytes, offset);
  offset += headerJsonBytes.byteLength;
  out.set(ciphertext, offset);

  return out;
}

// ---------- Envelope parse (uten decrypt) ----------

/**
 * Parser binær envelope til struktur. Verifiserer magic + version + header-form,
 * men decrypter IKKE ciphertext. Bruker `openPackage` til full decrypt.
 *
 * Brukes til:
 *  - Tidlig validering før vi spør om passord
 *  - Vise "Pakka er gyldig" status i UI før unlock
 */
export function parsePackageEnvelope(bytes: Uint8Array): ParsedPackage {
  if (bytes.byteLength < PACKAGE_MAGIC.byteLength + 2 + 4) {
    throw new PackageParseError(tHook("package.error_file_too_short"));
  }

  // Verifiser magic-bytes
  for (let i = 0; i < PACKAGE_MAGIC.byteLength; i++) {
    if (bytes[i] !== PACKAGE_MAGIC[i]) {
      throw new PackageParseError("Dette er ikke en gyldig Ko | Do-pakke");
    }
  }
  const magic = bytes.subarray(0, PACKAGE_MAGIC.byteLength);
  let offset = PACKAGE_MAGIC.byteLength;

  // Version uint16-LE
  const version = bytes[offset] | (bytes[offset + 1] << 8);
  offset += 2;
  if (version !== PACKAGE_VERSION_CURRENT) {
    throw new PackageParseError(
      `Pakka er laget med en nyere versjon av Ko | Do (v${version}). Oppdater appen.`,
    );
  }

  // Header-len uint32-LE
  const headerLen =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);
  offset += 4;

  if (headerLen <= 0 || headerLen > MAX_HEADER_LEN) {
    throw new PackageParseError(
      `Ugyldig header-størrelse (${headerLen} bytes) — fila er korrupt`,
    );
  }
  if (offset + headerLen > bytes.byteLength) {
    throw new PackageParseError(tHook("package.error_header_overflow"));
  }

  const headerJsonBytes = bytes.subarray(offset, offset + headerLen);
  offset += headerLen;

  // Parse header-JSON
  let header: PackageHeader;
  try {
    const text = new TextDecoder().decode(headerJsonBytes);
    header = validateHeaderShape(JSON.parse(text));
  } catch (e) {
    if (e instanceof PackageParseError) throw e;
    throw new PackageParseError("Pakka er korrupt (header-JSON er ugyldig)");
  }

  // Ciphertext er resten av fila — må være minst 16 bytes (GCM auth-tag)
  const ciphertext = bytes.subarray(offset);
  if (ciphertext.byteLength < 16) {
    throw new PackageParseError(
      "Pakka er korrupt (ciphertext mangler eller er for kort)",
    );
  }

  return { magic, version, header, headerJsonBytes, ciphertext };
}

function validateHeaderShape(h: unknown): PackageHeader {
  if (!h || typeof h !== "object") {
    throw new PackageParseError(tHook("package.error_header_not_object"));
  }
  const obj = h as Record<string, unknown>;
  if (obj.kind !== "kodo-package") {
    throw new PackageParseError(tHook("package.error_header_kind_invalid"));
  }
  if (obj.version !== 1) {
    throw new PackageParseError(`Ukjent header-versjon: ${String(obj.version)}`);
  }
  const kdf = obj.kdf as Record<string, unknown> | undefined;
  if (
    !kdf ||
    kdf.algorithm !== "PBKDF2-SHA256" ||
    typeof kdf.iterations !== "number" ||
    kdf.iterations < 100_000 || // D-001 — 100k er minimumsbaseline (vault bruker 600k)
    typeof kdf.saltB64 !== "string"
  ) {
    throw new PackageParseError("Header.kdf er ugyldig eller har for svake parametre");
  }
  const cipher = obj.cipher as Record<string, unknown> | undefined;
  if (
    !cipher ||
    cipher.algorithm !== "AES-256-GCM" ||
    typeof cipher.ivB64 !== "string" ||
    cipher.tagBits !== 128
  ) {
    throw new PackageParseError("Header.cipher er ugyldig");
  }
  return obj as unknown as PackageHeader;
}

// ---------- Decrypt ----------

/**
 * Åpner en `.kodoenc`-pakke med oppgitt passord. Returnerer klartekst payload
 * (i Iter 2: ZIP STORE-bytes klare for JSZip.load()).
 *
 * @throws {PackageParseError} hvis fila ikke er en gyldig pakke
 * @throws {PackageDecryptError} hvis passordet er feil ELLER fila er tamperet
 *   (GCM-auth-tag fanger begge — vi kan ikke skille dem fra hverandre, og det
 *   er bevisst valg per D-001 — ingen lekkasje av "feil passord vs. tamper").
 */
export async function openPackage(
  bytes: Uint8Array,
  password: string,
): Promise<{ payload: Uint8Array; header: PackageHeader }> {
  const parsed = parsePackageEnvelope(bytes);
  return openParsedPackage(parsed, password);
}

/** Variant der envelope er allerede parset (sparer dobbelt parsing i UI). */
export async function openParsedPackage(
  parsed: ParsedPackage,
  password: string,
): Promise<{ payload: Uint8Array; header: PackageHeader }> {
  const salt = base64ToBytes(parsed.header.kdf.saltB64);
  const iv = base64ToBytes(parsed.header.cipher.ivB64);
  const key = await deriveKey(password, salt, parsed.header.kdf.iterations);

  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as BufferSource,
        additionalData: parsed.headerJsonBytes as BufferSource,
        tagLength: GCM_TAG_BITS,
      },
      key,
      parsed.ciphertext as BufferSource,
    );
  } catch {
    // GCM auth-fail = ENTEN feil passord ELLER tampered ciphertext/header.
    // Vi gir samme melding for begge — angriper skal ikke kunne skille.
    throw new PackageDecryptError(tHook("package.error_wrong_pwd_or_corrupt"));
  }

  return {
    payload: new Uint8Array(plainBuf),
    header: parsed.header,
  };
}
