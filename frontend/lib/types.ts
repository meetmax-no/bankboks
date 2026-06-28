// Felles typer for vault-data.
// Hver entry inneholder klartekst — DETTE OBJEKTET ER KUN I MINNE
// etter dekryptering. Det blir aldri sendt til server.

export interface VaultEntry {
  id: string;
  title: string;
  username?: string;
  password: string;
  url?: string;
  category?: string; // category key
  notes?: string;
  favorite?: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/**
 * Dette er strukturen som krypteres som ÉN AES-GCM blob og lagres på server.
 * Ingenting annet enn `entries` skal lagres i klartekst.
 */
export interface VaultPayload {
  version: 1;
  entries: VaultEntry[];
  // Tidspunkt vi sist brukte master-passord (for 14-dagers logikk).
  // Dette ligger inne i den krypterte payloaden så server ikke ser det.
  lastMasterAt?: string;
}

/**
 * Dette er det som faktisk lagres lokalt + på server.
 * Alt utenfor `cipher` er offentlig metadata; selve passord-listen
 * ligger AES-GCM-kryptert i `cipher`.
 */
export interface EncryptedVaultBlob {
  version: 1;
  /** PBKDF2 salt (base64, 16 bytes) */
  salt: string;
  /** AES-GCM IV (base64, 12 bytes) */
  iv: string;
  /** Ciphertext + auth-tag (base64) */
  cipher: string;
  /** Iterasjoner brukt ved derivering (lar oss bumpe senere) */
  iterations: number;
  /** ISO-tid for siste lagring */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// CARDS — Blob 2 (v3.0, D-012/D-013/D-015)
// Egen Upstash-key `vault:default:cards`. Samme master-passord, ulik salt.
// Lazy-loaded — hentes kun når brukeren bytter til Cards-fanen.
// ---------------------------------------------------------------------------

export type CardType = "credit" | "debit" | "virtual" | "reward";

/**
 * Strukturert kort-oppføring. Felt-spec definert i [DECISIONS.md D-015].
 * Foto-felt (photoFront/photoBack) kommer i Iter 4 (v3.0 final),
 * men typen reserverer plass slik at nyere klienter ikke faller på et eldre blob.
 */
export interface VaultCard {
  id: string;
  /** Påkrevd */
  title: string;
  cardType: CardType;
  cardNumber: string;
  holderName: string;
  expiryMonth: string; // "MM"
  expiryYear: string; // "YYYY"
  /** Valgfritt */
  cvv?: string;
  pin?: string;
  issuer?: string;
  photoFront?: string; // base64, kommer i Iter 4
  photoBack?: string; // base64, kommer i Iter 4
  customerServicePhone?: string;
  customerServiceUrl?: string;
  lostCardPhone?: string;
  notes?: string;
  favorite?: boolean;
  rewardProgram?: string;
  annualFee?: string;
  /** Automatisk */
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/**
 * Klartekst-payload som krypteres som ÉN AES-GCM blob til vault:default:cards.
 */
export interface CardsPayload {
  version: 1;
  cards: VaultCard[];
}

// ---------------------------------------------------------------------------
// IDS — Blob 3 (v4.1, D-033)
// Egen Upstash-key `vault:default:ids`. Samme master-passord, ulik salt.
// Lazy-loaded — hentes kun når brukeren bytter til ID-fanen.
// Spec: /app/memory/v4.1-SPEC.md §3 (4 ID-typer) + §4 (vedlegg).
// ---------------------------------------------------------------------------

/** ID-vedlegg. Maks 1 per ID. Bilde re-encodes til JPEG 80% / 1600px før lagring.
 *  PDF lagres som-er. Hard maks 1 MB etter komprimering (Spec §4.2). */
export interface IdAttachment {
  /** `image/jpeg`, `image/png`, `image/webp` eller `application/pdf`. */
  mime: string;
  /** Base64-encoded payload (uten data:-prefix). */
  data: string;
  /** Original filnavn hvis kjent (fil-picker / drag-drop). Tomt for kamera. */
  name?: string;
  /** ISO-tid for når vedlegget ble lagt til. */
  addedAt: string;
  /** Størrelse i bytes (decoded), brukes til kvote-sjekk. */
  bytes: number;
}

/** Felles felt for alle ID-typer. Spec §3.1–§3.4. */
interface IdBase {
  id: string;
  /** Visningsnavn brukeren ser i listen. Default = type-navn + utsteder. */
  title: string;
  /** 0–3 vedlegg per ID (Mike-utvidelse 2026-02 etter Vercel-test).
   *  Brukeren legger til så mange som trengs (typisk: pass=1, førerkort=2,
   *  ID-kort=1–2, helse=1). Hard maks `MAX_ATTACHMENTS_PER_ID` (3). */
  attachments?: IdAttachment[];
  notes?: string;
  favorite?: boolean;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Spec §3.1 — Pass 🛂 */
export interface PassId extends IdBase {
  kind: "pass";
  /** Påkrevd */
  nation: string; // "Norge" | "Sverige" | "Annet"
  passportNumber: string;
  expiryDate: string; // ISO date (YYYY-MM-DD)
  /** Valgfritt */
  issuedBy?: string;
  issuedDate?: string; // ISO date
}

/** Spec §3.2 — Førerkort 🚗 */
export interface DriverId extends IdBase {
  kind: "driver";
  /** Påkrevd */
  country: string; // "Norge" | "EU" | "Annet"
  licenseNumber: string;
  /** En eller flere klasser, f.eks. ["B", "BE", "A1"]. */
  classes: string[];
  expiryDate: string; // ISO date
  /** Valgfritt */
  issuedDate?: string;
}

/** Spec §3.3 — ID-kort 🆔 (BankID, nasjonal ID, ansatte-ID, medlemskort). */
export interface IdCardId extends IdBase {
  kind: "id-card";
  /** Påkrevd */
  type: string; // "Nasjonal-ID" | "Ansatt-ID" | "Medlemskort"
  issuer: string; // "Stortinget" | "Compendia" | "Tekna"
  number: string;
  /** Valgfritt */
  issuedDate?: string;
  expiryDate?: string; // kan være tomt — varig medlemskap
}

/** Spec §3.4 — Helsekort / forsikring 🏥 */
export interface HealthId extends IdBase {
  kind: "health";
  /** Påkrevd */
  type: string; // "Helsetrygdekort" | "Reiseforsikring" | "Bilforsikring" | "Annet"
  company: string; // "NAV" | "If" | "Gjensidige"
  policyNumber: string;
  validTo: string; // ISO date — "Gyldig til"
  /** Valgfritt */
  contactPhone?: string;
  contactEmail?: string;
  validFrom?: string;
}

/** Discriminated union over de 4 ID-typene. */
export type VaultId = PassId | DriverId | IdCardId | HealthId;

export type IdKind = VaultId["kind"];

/** Klartekst-payload som krypteres som ÉN AES-GCM blob til vault:default:ids. */
export interface IdsPayload {
  version: 1;
  ids: VaultId[];
}
