/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll-bg-preference
 *
 * Wrapper rundt vault-`lib/bg-preference.ts` med separat localStorage-
 * nøkkel "kodo-konsoll-bg.v1" og default Aurora-gradient. Holder bg-valg
 * for am-admin Konsoll uavhengig av brukerens personlige vault-bg.
 *
 * Per Mike-direktiv (D-086 a=3, 2026-06-27): "Samme katalog (9 tiles),
 * separat localStorage-nøkkel". Vi gjenbruker `GRADIENT_BACKGROUNDS` +
 * `clients/default.json`-photos, men persisterer i en egen nøkkel.
 */
export type KonsollBgMode = "fixed" | "daily" | "session";

export interface KonsollBgPreference {
  mode: KonsollBgMode;
  fixedUrl?: string;
  overlay?: number;
}

const KEY = "kodo-konsoll-bg.v1";
const OVERLAY_MIN = 0;
const OVERLAY_MAX = 0.8;

/** Default: Aurora-gradient + 5 % overlay (matcher Mike's screenshot). */
export const KONSOLL_BG_DEFAULT: KonsollBgPreference = {
  mode: "fixed",
  fixedUrl: "gradient:aurora",
  overlay: 0.05,
};

function clampOverlay(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return Math.min(OVERLAY_MAX, Math.max(OVERLAY_MIN, v));
}

export function loadKonsollBgPreference(): KonsollBgPreference {
  if (typeof window === "undefined") return KONSOLL_BG_DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return KONSOLL_BG_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<KonsollBgPreference>;
    if (
      parsed.mode === "fixed" ||
      parsed.mode === "daily" ||
      parsed.mode === "session"
    ) {
      return {
        mode: parsed.mode,
        fixedUrl:
          typeof parsed.fixedUrl === "string" ? parsed.fixedUrl : undefined,
        overlay: clampOverlay(parsed.overlay) ?? KONSOLL_BG_DEFAULT.overlay,
      };
    }
    return KONSOLL_BG_DEFAULT;
  } catch {
    return KONSOLL_BG_DEFAULT;
  }
}

export function saveKonsollBgPreference(pref: KonsollBgPreference): void {
  if (typeof window === "undefined") return;
  const sanitized: KonsollBgPreference = {
    mode: pref.mode,
    fixedUrl: pref.fixedUrl,
    overlay: clampOverlay(pref.overlay) ?? KONSOLL_BG_DEFAULT.overlay,
  };
  localStorage.setItem(KEY, JSON.stringify(sanitized));
}
