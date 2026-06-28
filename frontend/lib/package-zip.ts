// Ko | Do · Vault — v4.0 Sikker overlevering: ZIP-laget (Iter 2)
//
// Bygger på lib/package.ts (envelope + krypto). Dette modulet håndterer:
//   - ZIP STORE-arkivering av filer + _metadata.json (D-007, D-025)
//   - Mappe-struktur bevares fra webkitRelativePath (rad 17 i SPEC seksjon 9)
//   - Zip-Slip-sanitering per path-segment ved utpakking (SPEC 9.4)
//   - Multi-container bin-packing (D-009 — bruker velger antall containere)
//   - Single-file edge case (1 fil + N containere → tvinges til 1)
//   - Tidsestimat for kryptering + dekryptering pr filstørrelse
//
// SPEC: /app/memory/v4.0-SPEC.md seksjon 9.1, 9.2, 9.4, 9.11
//
// ⚠ JSZip 3.10.1 bruker LEGACY `compression: "STORE"`-mode for å unngå DEFLATE.
//   Ingen kompresjon — pakka skal lukkes raskt, ikke små.

import JSZip from "jszip";
import { buildPackage, openPackage, PackageMetadata } from "./package";
import { tHook } from "./i18n";

// ---------- Konstanter ----------

const METADATA_FILENAME = "_metadata.json";
const MAX_PATH_DEPTH = 8;
const MAX_PATH_SEGMENT_LEN = 100;
const MAX_PATH_TOTAL_LEN = 300;

// ---------- Typer ----------

export interface PackageFile {
  /** Bevart sti fra webkitRelativePath (eller bare filnavn hvis flat). */
  path: string;
  /** Rå filinnhold (Lars sin valgte fil). */
  bytes: Uint8Array;
}

export interface BuildContainerOptions {
  files: PackageFile[];
  password: string;
  /** Brukes til _metadata.json — settes av PackModule, ikke per fil. */
  appVersion: string;
}

export interface OpenedContainer {
  files: PackageFile[];
  metadata: PackageMetadata;
}

export interface ContainerPlan {
  /** Array av container-grupper, hver med liste av indeks i `files`. */
  groups: number[][];
  /** Total størrelse per container (bytes). */
  totalBytes: number[];
}

// ---------- Bygg én container (ZIP STORE + krypter via lib/package.ts) ----------

/**
 * Bygger én `.kodoenc`-container: ZIP STORE-arkiver filene (+ _metadata.json),
 * krypterer med opts.password, returnerer `.kodoenc`-bytes klare for nedlasting.
 */
export async function buildContainer(
  opts: BuildContainerOptions,
): Promise<Uint8Array> {
  if (opts.files.length === 0) {
    throw new Error(tHook("package_zip.error_empty_container"));
  }

  const zip = new JSZip();

  // 1. Bygg _metadata.json (klartekst-felt fra D-025-refactor)
  const metadata: PackageMetadata = {
    createdAt: new Date().toISOString(),
    appVersion: opts.appVersion,
    app: "Ko | Do · Vault",
    fileCount: opts.files.length,
    container: "zip-store",
  };
  zip.file(METADATA_FILENAME, JSON.stringify(metadata, null, 2));

  // 2. Legg til filer med bevart mappe-struktur
  // Duplikat-filnavn-håndtering: hvis to filer har samme path, legg suffix `-2`, `-3` etc.
  const usedPaths = new Set<string>([METADATA_FILENAME]);
  for (const file of opts.files) {
    const safePath = makeUniquePath(file.path, usedPaths);
    zip.file(safePath, file.bytes as Uint8Array);
    usedPaths.add(safePath);
  }

  // 3. Generer ZIP STORE-bytes (compression: STORE — D-007)
  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "STORE",
  });

  // 4. Krypter via lib/package.ts envelope
  return buildPackage({ payload: zipBytes, password: opts.password });
}

/** Sikrer at hver fil får unik sti i ZIP. Lager `-2`, `-3` suffix om nødvendig. */
function makeUniquePath(rawPath: string, used: Set<string>): string {
  if (!used.has(rawPath)) return rawPath;

  // Split fil-navn fra extension for å sette suffix riktig
  const lastSlash = rawPath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? rawPath.slice(0, lastSlash + 1) : "";
  const fullName = lastSlash >= 0 ? rawPath.slice(lastSlash + 1) : rawPath;
  const lastDot = fullName.lastIndexOf(".");
  const base = lastDot > 0 ? fullName.slice(0, lastDot) : fullName;
  const ext = lastDot > 0 ? fullName.slice(lastDot) : "";

  let i = 2;
  while (i < 1000) {
    const candidate = `${dir}${base}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
    i++;
  }
  throw new Error("Kunne ikke generere unikt filnavn (over 1000 duplikater)");
}

// ---------- Åpne én container (decrypt + ZIP-parse + saniter paths) ----------

/**
 * Åpner en `.kodoenc`-container: decrypter via lib/package.ts, parser ZIP,
 * saniterer paths mot zip-slip og returnerer liste av filer + metadata.
 */
export async function openContainer(
  envelopeBytes: Uint8Array,
  password: string,
): Promise<OpenedContainer> {
  // 1. Decrypt envelope → zipBytes (AEAD-validert)
  const { payload: zipBytes } = await openPackage(envelopeBytes, password);

  // 2. Load ZIP
  const zip = await JSZip.loadAsync(zipBytes as Uint8Array);

  // 3. Les _metadata.json (kan mangle hvis pakka kommer fra fremtidig versjon
  //    eller en angriper har manipulert payloaden uten å bryte AEAD — usannsynlig,
  //    men håndteres defensivt)
  let metadata: PackageMetadata;
  const metaEntry = zip.file(METADATA_FILENAME);
  if (metaEntry) {
    try {
      const raw = await metaEntry.async("string");
      metadata = parseMetadata(raw);
    } catch {
      metadata = fallbackMetadata();
    }
  } else {
    metadata = fallbackMetadata();
  }

  // 4. Saniter + samle filer (hopp over _metadata.json)
  const files: PackageFile[] = [];
  const entries: { path: string; obj: JSZip.JSZipObject }[] = [];
  zip.forEach((path, obj) => {
    if (obj.dir) return;
    if (path === METADATA_FILENAME) return;
    entries.push({ path, obj });
  });

  for (const { path, obj } of entries) {
    const safePath = sanitizeZipPath(path);
    if (!safePath) continue; // skip totally-stripped paths
    const bytes = await obj.async("uint8array");
    files.push({ path: safePath, bytes });
  }

  return { files, metadata };
}

function parseMetadata(raw: string): PackageMetadata {
  const parsed = JSON.parse(raw) as Partial<PackageMetadata>;
  return {
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    appVersion:
      typeof parsed.appVersion === "string" ? parsed.appVersion : "ukjent",
    app: "Ko | Do · Vault",
    fileCount: typeof parsed.fileCount === "number" ? parsed.fileCount : 0,
    container: "zip-store",
  };
}

function fallbackMetadata(): PackageMetadata {
  return {
    createdAt: "",
    appVersion: "ukjent",
    app: "Ko | Do · Vault",
    fileCount: 0,
    container: "zip-store",
  };
}

// ---------- Zip-Slip-sanitering (SPEC seksjon 9.4) ----------

/**
 * Saniterer et path fra ZIP for å hindre zip-slip-angrep + Windows-inkompat.
 * Bevarer mappe-struktur, fjerner traversal-forsøk per segment.
 *
 * Eksempel:
 *   "../../etc/passwd"          → "etc/passwd"
 *   "Hoppeslott/../../leak.pdf" → "Hoppeslott/leak.pdf"
 *   "Hoppeslott/Underlag/skanning.pdf" → uendret
 *   "C:\Windows\System32\evil"  → "C_/Windows/System32/evil" (Windows-tegn-stripped)
 */
export function sanitizeZipPath(rawPath: string): string {
  // 1. Normaliser backslash → slash
  let s = rawPath.replace(/\\/g, "/");
  // 2. Strip ledende slashes (absolute paths)
  s = s.replace(/^\/+/, "");
  // 3. Split på "/", saniter hver segment
  const segments = s
    .split("/")
    .map((seg) => {
      // Avvis "..", ".", tomme segmenter (de fjernes fra path)
      if (seg === ".." || seg === "." || seg === "") return null;
      // Filtrer kontrolltegn + Windows-forbudte tegn
      let cleaned = seg.replace(/[\x00-\x1F<>:"|?*]/g, "_");
      // Begrens lengde pr segment
      if (cleaned.length > MAX_PATH_SEGMENT_LEN) {
        cleaned = cleaned.slice(0, MAX_PATH_SEGMENT_LEN);
      }
      return cleaned;
    })
    .filter((s): s is string => s !== null);

  // 4. Begrens total path-dybde
  if (segments.length > MAX_PATH_DEPTH) {
    segments.length = MAX_PATH_DEPTH;
  }
  // 5. Sett sammen og begrens total lengde
  let result = segments.join("/");
  if (result.length > MAX_PATH_TOTAL_LEN) {
    result = result.slice(0, MAX_PATH_TOTAL_LEN);
  }
  return result;
}

// ---------- Multi-container bin-packing (D-009) ----------

/**
 * Fordeler filer i N containere via minste-residual-bin-packing.
 * Tar største filer først, plasserer i container med lavest sum.
 * Single-file edge case: hvis kun 1 fil, returnerer alltid 1 container.
 */
export function planContainers(
  files: PackageFile[],
  requestedContainers: number,
): ContainerPlan {
  if (files.length === 0) {
    throw new Error(tHook("package_zip.error_no_files_to_plan"));
  }

  // Single-file edge case: tvinges til 1 container (D-009, rad 10 i SPEC)
  const actualContainers = Math.min(
    Math.max(1, Math.floor(requestedContainers)),
    files.length,
  );

  // Sorter indekser etter filstørrelse synkende (largest-first bin-packing)
  const sortedIndices = files
    .map((f, i) => ({ i, size: f.bytes.byteLength }))
    .sort((a, b) => b.size - a.size);

  const groups: number[][] = Array.from({ length: actualContainers }, () => []);
  const totals = new Array<number>(actualContainers).fill(0);

  for (const { i, size } of sortedIndices) {
    // Plasser i container med lavest sum
    let minIdx = 0;
    for (let k = 1; k < actualContainers; k++) {
      if (totals[k] < totals[minIdx]) minIdx = k;
    }
    groups[minIdx].push(i);
    totals[minIdx] += size;
  }

  return { groups, totalBytes: totals };
}

// ---------- Tidsestimat (D-009) ----------

/**
 * Grov estimat for kryptering basert på filstørrelse. Kalibrert mot M1 Mac
 * (PBKDF2 600k ~600ms, AES-GCM ~500 MB/s). iPhone 12+ er ~2-3x langsommere.
 *
 * Returnerer sekunder (heltall, minimum 1).
 */
export function estimateEncryptSeconds(totalBytes: number): number {
  const pbkdf2Ms = 600; // konstant — uavhengig av størrelse
  const aesMbPerSec = 500; // M1 Mac
  const aesMs = (totalBytes / (aesMbPerSec * 1024 * 1024)) * 1000;
  const zipOverheadMs = 100; // small per-call setup
  const totalMs = pbkdf2Ms + aesMs + zipOverheadMs;
  return Math.max(1, Math.round(totalMs / 1000));
}

/** Estimat for utpakking — typisk litt raskere enn encrypt (ingen zip-bygging). */
export function estimateDecryptSeconds(totalBytes: number): number {
  const pbkdf2Ms = 600;
  const aesMbPerSec = 500;
  const aesMs = (totalBytes / (aesMbPerSec * 1024 * 1024)) * 1000;
  const totalMs = pbkdf2Ms + aesMs;
  return Math.max(1, Math.round(totalMs / 1000));
}

// ---------- Validation hjelpere (UI bruker disse) ----------

/**
 * Kontrollerer at total filstørrelse er under tenant-grense og ingen enkeltfil
 * er for stor. Kaster med meningsfull melding hvis ikke.
 */
export function validateFileSize(
  files: PackageFile[],
  maxFileSizeMB: number,
): void {
  const maxBytes = maxFileSizeMB * 1024 * 1024;
  let total = 0;
  for (const file of files) {
    if (file.bytes.byteLength > maxBytes) {
      throw new Error(
        `Filen "${file.path}" er ${formatBytes(file.bytes.byteLength)} — overskrider grensen på ${maxFileSizeMB} MB`,
      );
    }
    total += file.bytes.byteLength;
  }
  // Total grense settes per container, ikke per fil-liste — kalleren splitter
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
