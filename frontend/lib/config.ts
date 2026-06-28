// Typer for klient-config (public/clients/<name>.json)

import type { Locale } from "./i18n";

export interface ClientMeta {
  client?: string;
  createdAt?: string;
  createdBy?: string;
  notes?: string;
}

export interface CategoryConfig {
  key: string;
  label: string;
  icon: string;
  color: string;
}

export interface SecurityConfig {
  autoLockMinutes: number;
  /** Iter 19.9.2 — sek før auto-lås at advarsel vises. Default 60, clamp 30-120. */
  autoLockWarningSecs?: number;
  forceMasterAfterDays: number;
  clipboardClearSeconds: number;
  /**
   * Når `true`: kopier-knapper er aktive med 120s auto-tømming (default).
   * Når `false`: "tett skip"-modus — kopier-knapper er borte, brukeren ser
   * passordet på skjerm og taster manuelt. Passord rører ALDRI clipboard,
   * så det kan ikke lekke til Universal Clipboard, Paste-app, extensions, etc.
   * (D-017)
   */
  clipboardEnabled?: boolean;
  /** Hvor mange siste hendelser vises i Settings (default 10) */
  loginHistoryCount?: number;
}

export type SortMode = "favorite" | "title" | "lastModified";
export type ViewMode = "list" | "grouped";

export interface UiConfig {
  defaultSort: SortMode;
  showFavoritesFirst: boolean;
  dateLocale: string;
  /** Initial view-modus for passord-listen. Brukeren kan toggle i session,
   *  men neste session starter fra denne verdien. (D-018 multi-tenant) */
  passwordsViewMode?: ViewMode;
  /** Tilsvarende for kort-listen */
  cardsViewMode?: ViewMode;
  /** Tilsvarende for ID-listen */
  idsViewMode?: ViewMode;
}

export interface BrandConfig {
  name: string;
  tagline: string;
}

export type BackgroundRotateMode = "fixed" | "daily" | "session" | "random";

export interface BackgroundImage {
  url: string;
  name: string;
}

export type ImageFormat = "image/jpeg" | "image/webp";

/**
 * Bilde-komprimering for kort-foto (D-016). Verdiene clamp-es ved innlesning
 * i `lib/config.ts/clampImageConfig` for å forhindre at en korrupt JSON gir
 * ulesbart eller absurd stor blob.
 */
export interface ImageConfig {
  maxWidth: number; // clamp 400-2400
  maxHeight: number; // clamp 300-1800
  quality: number; // clamp 0.5-0.95
  format: ImageFormat;
}

export interface AppConfig {
  _meta?: ClientMeta;
  brand: BrandConfig;
  backgrounds: BackgroundImage[];
  rotate: BackgroundRotateMode;
  /**
   * Mørkleggings-overlay over HELE bg-bildet (0-1). Samme verdi i begge
   * browsere. Standard 0.10 — bildet beholder ~90% av sin opprinnelige
   * lys/farge. Sett til 0 for ingen mørkning, opp mot 0.5 for kraftigere
   * demping. Se D-022.
   */
  bgImageOverlay?: number;
  /**
   * Stor blur-styrke (CSS-lengde, f.eks. "24px" eller "32px") i Chrome /
   * Firefox / Edge. Påvirker alle elementer med `backdrop-blur-xl`-klassen
   * (hoved-glass-kort, modaler, paneler). Påvirker IKKE `backdrop-blur-sm`
   * (små badges/pills) — de er bevisst lavere. Standard "24px".
   */
  backdropBlurChrome?: string;
  /**
   * Stor blur-styrke (CSS-lengde) i Safari. Tilsvarende `backdropBlurChrome`,
   * men kan justeres separat fordi Safari sin blur rendrer svakere.
   * Standard "24px" — bumpes til "32px" eller mer hvis ønsket. Se D-022.
   */
  backdropBlurSafari?: string;
  /**
   * Kort-bakgrunn (bg-color med alpha) i Chrome / Firefox / Edge. Settes via
   * CSS-variabel `--kodo-card-bg` på `:root`. Standard `rgba(255,255,255,0.10)`
   * (= `bg-white/10`). Chrome håndterer lys glass fint pga sterk gaussian-blur.
   */
  cardBgChrome?: string;
  /**
   * Kort-bakgrunn i Safari. Standard `rgba(30,41,59,0.85)` (= `bg-slate-800/85`).
   * Safari får tilnærmet solid mørk slate fordi blur er svak — det garanterer
   * lesbarhet uavhengig av bg-bilde. Eksempler:
   *   "rgba(30,41,59,0.85)"   → slate-800/85
   *   "rgba(15,23,42,0.85)"   → slate-900/85 (mørkere)
   *   "rgba(38,38,38,0.85)"   → zinc-800/85 (nøytral grå)
   *   "rgba(28,25,23,0.85)"   → stone-900/85 (varm grå)
   * Se D-022.
   */
  cardBgSafari?: string;
  mobileSolidBackground?: boolean;
  mobileSolidColor?: string;
  categories: CategoryConfig[];
  security: SecurityConfig;
  ui: UiConfig;
  image: ImageConfig;
  /**
   * v4.2 — Tenant-default for språkdrakt (D-036). Hvis satt, brukes som
   * fallback når brukeren ikke har eksplisitt valg i localStorage og
   * navigator.language ikke matcher no/sv/da. Hard fallback i kode er "no".
   * Verdier: "no" | "sv" | "da" (ISO 639-1).
   */
  defaultLocale?: Locale;
  /**
   * v4.0 — Sikker overlevering. Pakk-feature på/av per tenant.
   * Når enabled=true: 📦-knapp vises i AppHeader (Lars-flyt) OG som "Pakk ut"-knapp
   * på login-siden (Anna-flyt — Iter 4).
   * Når enabled=false: ingen UI-spor av pakker.
   * Se /app/memory/v4.0-SPEC.md seksjon 3 og rad 14.
   */
  features?: FeaturesConfig;
}

/** Feature-flagg per tenant. Brukes til å skru pakke-modul av/på. */
export interface FeaturesConfig {
  packages?: PackagesConfig;
  /** v4.1 — ID-blob (Pass, Førerkort, ID-kort, Helse/forsikring).
   *  Se /app/memory/v4.1-SPEC.md §3 og §6.1. */
  ids?: IdsFeatureConfig;
}

export interface IdsFeatureConfig {
  /** Master-toggle for hele ID-modulen. Hvis false: ingen 🆔-fane noe sted. */
  enabled: boolean;
  /** Vis 🆔-knappen i AppHeader + MobileBottomBar. Default true når enabled. */
  showInApp: boolean;
}

export interface PackagesConfig {
  /**
   * Vis "Pakk ut en pakke"-knappen på LOGIN-siden (Anna-flyt). Når true:
   * Anna kommer fra e-post og kan pakke ut uten å logge inn.
   */
  showOnLogin: boolean;
  /**
   * Vis 📦-knappen i appen (Lars-flyt — pakk inn + pakk ut når innlogget).
   * Når true: 📦-ikon i AppHeader + MobileBottomBar.
   */
  showInApp: boolean;
  /**
   * Maks total-størrelse per pakke (container). Standard 50 MB — iPhone-trygt.
   * Mike som tenant-eier kan heve manuelt for desktop-only tenants (SPEC 9.3).
   * Ingen clamp — vi stoler på leverandør (rad 4 i SPEC seksjon 9).
   */
  maxFileSizeMB: number;
  /** Reservert for fremtid. null = alle typer tillatt (default). */
  allowedMimeTypes?: string[] | null;
}

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  maxWidth: 1200,
  maxHeight: 750,
  quality: 0.75,
  format: "image/jpeg",
};

/** Clamp brukeropplyste verdier til trygge grenser (D-016 + D-001). */
export function clampImageConfig(input: Partial<ImageConfig> | undefined): ImageConfig {
  const cfg = { ...DEFAULT_IMAGE_CONFIG, ...(input || {}) };
  const maxWidth = clampNum(cfg.maxWidth, 400, 2400, DEFAULT_IMAGE_CONFIG.maxWidth);
  const maxHeight = clampNum(
    cfg.maxHeight,
    300,
    1800,
    DEFAULT_IMAGE_CONFIG.maxHeight,
  );
  const quality = clampNum(
    cfg.quality,
    0.5,
    0.95,
    DEFAULT_IMAGE_CONFIG.quality,
  );
  const format: ImageFormat =
    cfg.format === "image/webp" || cfg.format === "image/jpeg"
      ? cfg.format
      : "image/jpeg";
  return { maxWidth, maxHeight, quality, format };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

export const FALLBACK_CONFIG: AppConfig = {
  brand: { name: "Ko | Do · Vault", tagline: "Din digitale nøkkelring" },
  backgrounds: [],
  rotate: "daily",
  bgImageOverlay: 0.10,
  backdropBlurChrome: "24px",
  backdropBlurSafari: "24px",
  cardBgChrome: "rgba(255, 255, 255, 0.10)",
  cardBgSafari: "rgba(30, 41, 59, 0.85)",
  mobileSolidBackground: false,
  mobileSolidColor: "#1A1A1A",
  categories: [
    { key: "personal", label: "Personlig", color: "#4ade80", icon: "🏠" },
    { key: "other", label: "Annet", color: "#94a3b8", icon: "📁" },
  ],
  security: {
    autoLockMinutes: 15,
    autoLockWarningSecs: 60,
    forceMasterAfterDays: 14,
    clipboardClearSeconds: 120,
    clipboardEnabled: true,
  },
  ui: {
    defaultSort: "favorite",
    showFavoritesFirst: true,
    dateLocale: "nb-NO",
    passwordsViewMode: "list",
    cardsViewMode: "list",
    idsViewMode: "list",
  },
  image: DEFAULT_IMAGE_CONFIG,
  defaultLocale: "no",
};
