// Iter 19.9.2 — Hardkodede gradient-bakgrunner.
//
// Tre dark-tone gradienter inspirert av kodo-editor. Tilpasset fullskjerm:
//  - Spread i vw/vh (viewport-relativ) i stedet for fast piksel
//  - Opasitet boostet vs kodo-editor (2x) — synlig fargespill
//
// Auto-overlay-0: når en gradient velges i Settings, settes
// bg-overlay automatisk til 0 (se handleBgPickImage i app/page.tsx).
// Mike-direktiv 2026-06-24.

export interface GradientBg {
  id: string;
  name: string;
  css: string;
}

export const GRADIENT_BACKGROUNDS: readonly GradientBg[] = [
  {
    id: "slate-night",
    name: "Slate Night",
    css: "radial-gradient(120vw 80vh at 10% -10%, rgba(52, 211, 153, 0.28), transparent 50%), radial-gradient(110vw 75vh at 110% 0%, rgba(99, 102, 241, 0.25), transparent 55%), radial-gradient(90vw 70vh at 50% 110%, rgba(244, 114, 182, 0.18), transparent 55%), #0a1024",
  },
  {
    id: "aurora",
    name: "Aurora",
    css: "radial-gradient(130vw 90vh at 0% 0%, rgba(16, 185, 129, 0.40), transparent 50%), radial-gradient(120vw 80vh at 100% 100%, rgba(99, 102, 241, 0.35), transparent 55%), radial-gradient(90vw 70vh at 50% 50%, rgba(168, 85, 247, 0.25), transparent 60%), #0a0e1a",
  },
  {
    id: "sunset",
    name: "Sunset",
    css: "radial-gradient(130vw 90vh at 0% 100%, rgba(249, 115, 22, 0.42), transparent 50%), radial-gradient(120vw 80vh at 100% 0%, rgba(236, 72, 153, 0.35), transparent 55%), radial-gradient(90vw 70vh at 50% 50%, rgba(251, 191, 36, 0.20), transparent 60%), #1a0b14",
  },
] as const;

export const GRADIENT_PREFIX = "gradient:";

export function isGradientUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && url.startsWith(GRADIENT_PREFIX);
}

export function gradientIdFromUrl(url: string): string | null {
  if (!isGradientUrl(url)) return null;
  return url.slice(GRADIENT_PREFIX.length);
}

export function gradientUrlFromId(id: string): string {
  return `${GRADIENT_PREFIX}${id}`;
}

export function findGradient(id: string): GradientBg | undefined {
  return GRADIENT_BACKGROUNDS.find((g) => g.id === id);
}
