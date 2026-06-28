// Lokal overstyring av bakgrunns-valg (user preference).
// Config (`clients/default.json`) setter default, men brukeren kan overstyre
// via Settings-panelet. Overstyring lagres i localStorage og respekteres
// ved hver sidelast.
//
// Iter 19.9.2 utvidelse:
//   - `overlay?: number` — bruker-overstyring av config.bgImageOverlay.
//     Verdi clamp-es til [0, 0.8] ved innlasting og lagring.
//   - `fixedUrl` kan nå være "gradient:<id>" for hardkodede gradienter
//     (se lib/settings/background-gradients.ts) i tillegg til Unsplash-URLer.

export type BgMode = "fixed" | "daily" | "session";

export interface BgPreference {
  mode: BgMode;
  /** Kun brukt når mode === "fixed" — URL til låst bilde, eller "gradient:<id>" */
  fixedUrl?: string;
  /**
   * Bruker-overstyring av bg-overlay (0..0.8). Hvis udefinert: fall tilbake
   * til config.bgImageOverlay (~0.10). Iter 19.9.2.
   */
  overlay?: number;
}

const KEY = "kodo-vault.bgPreference.v1";

const OVERLAY_MIN = 0;
const OVERLAY_MAX = 0.8;

function clampOverlay(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(OVERLAY_MAX, Math.max(OVERLAY_MIN, v));
}

export function loadBgPreference(): BgPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BgPreference>;
    if (
      parsed.mode === "fixed" ||
      parsed.mode === "daily" ||
      parsed.mode === "session"
    ) {
      return {
        mode: parsed.mode,
        fixedUrl:
          typeof parsed.fixedUrl === "string" ? parsed.fixedUrl : undefined,
        overlay: clampOverlay(parsed.overlay),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBgPreference(pref: BgPreference): void {
  if (typeof window === "undefined") return;
  const sanitized: BgPreference = {
    mode: pref.mode,
    fixedUrl: pref.fixedUrl,
    overlay: clampOverlay(pref.overlay),
  };
  localStorage.setItem(KEY, JSON.stringify(sanitized));
}

export function clearBgPreference(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
