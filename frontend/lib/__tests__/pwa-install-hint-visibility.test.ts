/**
 * Ko | Do · Vault — PWAInstallHint visibility rules
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/pwa-install-hint-visibility.test.ts`
 *
 * Testene speiler reglene i `components/platform/PWAInstallHint.tsx`.
 * Vi tester regel-evalueringen som ren funksjon — uten å montere React-tre.
 */

type VaultStatus = "loading" | "needs-setup" | "locked" | "unlocked" | "error";

// Module marker — denne filen er en TS-modul (ikke ambient script).
// Uten dette ville `function assert` kollidert med samme-navnet funksjon
// i andre test-script-filer (TS deler globalt namespace for ambient scripts).
export {};

interface ShouldShowBannerInput {
  platform: "ios-safari" | "android-chrome" | null;
  isStandalone: boolean;
  dismissed: boolean;
  vaultStatus: VaultStatus;
  forceOverride: boolean;
}

/**
 * Pure-funksjon-speiling av regelsettet i PWAInstallHint.
 * Endrer du logikken i komponenten må du oppdatere denne funksjonen — og
 * omvendt. Tester her er sikkerhetsnett mot regresjon.
 */
function shouldShowBanner(input: ShouldShowBannerInput): boolean {
  if (!input.platform) return false; // Regel 1
  if (input.isStandalone) return false; // Regel 2
  if (input.forceOverride) return true; // QA-bypass for regel 3+4
  if (input.dismissed) return false; // Regel 3 — alltid, ingen unntak
  if (input.vaultStatus !== "needs-setup") return false; // Regel 4
  return true;
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

const baseline: ShouldShowBannerInput = {
  platform: "ios-safari",
  isStandalone: false,
  dismissed: false,
  vaultStatus: "needs-setup",
  forceOverride: false,
};

// ─── Regel 1: plattform ─────────────────────────────────────────────────
assert(
  shouldShowBanner({ ...baseline, platform: "ios-safari" }) === true,
  "1a. iOS Safari + needs-setup + ingen dismiss → vises",
);
assert(
  shouldShowBanner({ ...baseline, platform: "android-chrome" }) === true,
  "1b. Android Chrome + needs-setup + ingen dismiss → vises",
);
assert(
  shouldShowBanner({ ...baseline, platform: null }) === false,
  "1c. Ukjent plattform (desktop/Firefox) → skjules",
);

// ─── Regel 2: standalone-modus ──────────────────────────────────────────
assert(
  shouldShowBanner({ ...baseline, isStandalone: true }) === false,
  "2. Standalone-modus → skjules (allerede installert)",
);
assert(
  shouldShowBanner({
    ...baseline,
    isStandalone: true,
    forceOverride: true,
  }) === false,
  "2b. Standalone slår selv force-override (fysisk begrensning, ikke regel)",
);

// ─── Regel 3: dismiss alltid respekteres ────────────────────────────────
assert(
  shouldShowBanner({ ...baseline, dismissed: true }) === false,
  "3a. Dismissed + needs-setup → skjules (dismiss alltid respekteres)",
);
assert(
  shouldShowBanner({
    ...baseline,
    dismissed: true,
    vaultStatus: "unlocked",
  }) === false,
  "3b. Dismissed + unlocked → skjules",
);
assert(
  shouldShowBanner({
    ...baseline,
    dismissed: true,
    forceOverride: true,
  }) === true,
  "3c. Dismissed + force-override → vises (QA-bypass virker)",
);

// ─── Regel 4: kun needs-setup ───────────────────────────────────────────
assert(
  shouldShowBanner({ ...baseline, vaultStatus: "needs-setup" }) === true,
  "4a. needs-setup → vises (onboarding mode)",
);
assert(
  shouldShowBanner({ ...baseline, vaultStatus: "locked" }) === false,
  "4b. locked → skjules (returning customer, ikke onboarding)",
);
assert(
  shouldShowBanner({ ...baseline, vaultStatus: "unlocked" }) === false,
  "4c. unlocked → skjules (ferdig onboardet)",
);
assert(
  shouldShowBanner({ ...baseline, vaultStatus: "loading" }) === false,
  "4d. loading → skjules (transient state)",
);
assert(
  shouldShowBanner({ ...baseline, vaultStatus: "error" }) === false,
  "4e. error → skjules",
);

// ─── Force-override scenarier ───────────────────────────────────────────
assert(
  shouldShowBanner({
    ...baseline,
    vaultStatus: "unlocked",
    forceOverride: true,
  }) === true,
  "5a. Force-override + unlocked → vises (QA kan teste på prod)",
);
assert(
  shouldShowBanner({
    ...baseline,
    vaultStatus: "locked",
    forceOverride: true,
  }) === true,
  "5b. Force-override + locked → vises",
);
assert(
  shouldShowBanner({
    ...baseline,
    dismissed: true,
    vaultStatus: "locked",
    forceOverride: true,
  }) === true,
  "5c. Force-override bypasser BÅDE dismiss og status-sjekken",
);
assert(
  shouldShowBanner({
    ...baseline,
    platform: null,
    forceOverride: true,
  }) === false,
  "5d. Force-override på desktop/Firefox → skjules (plattform er fysisk)",
);

// ─── Kombinasjons-matrise: dismissed × vault-status ─────────────────────
const statuses: VaultStatus[] = [
  "loading",
  "needs-setup",
  "locked",
  "unlocked",
  "error",
];
for (const s of statuses) {
  // Med dismiss: alltid skjult (med mindre force)
  assert(
    shouldShowBanner({ ...baseline, dismissed: true, vaultStatus: s }) === false,
    `6.${s}. dismissed + ${s} → skjules`,
  );
  // Uten dismiss: kun needs-setup viser
  const expectedNoDismiss = s === "needs-setup";
  assert(
    shouldShowBanner({ ...baseline, dismissed: false, vaultStatus: s }) ===
      expectedNoDismiss,
    `7.${s}. uten dismiss + ${s} → ${expectedNoDismiss ? "vises" : "skjules"}`,
  );
}

console.log("\n✓ Alle PWA-install-banner-regler validert");
