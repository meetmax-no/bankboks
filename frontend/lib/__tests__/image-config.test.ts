// Offline test for clampImageConfig (D-016 sikrer at korrupt JSON ikke kan
// gi farlige verdier — North Star D-001 anvendt på config).
//
// Kjøres med: npx tsx /app/frontend/lib/__tests__/image-config.test.ts

import { clampImageConfig, DEFAULT_IMAGE_CONFIG } from "../config";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

// 1) Tom input → defaults
const empty = clampImageConfig(undefined);
assert(empty.maxWidth === 1200, "tom input → maxWidth 1200");
assert(empty.maxHeight === 750, "tom input → maxHeight 750");
assert(empty.quality === 0.75, "tom input → quality 0.75");
assert(empty.format === "image/jpeg", "tom input → JPEG");

// 2) Rimelige verdier passerer uendret
const ok = clampImageConfig({
  maxWidth: 1024,
  maxHeight: 600,
  quality: 0.85,
  format: "image/webp",
});
assert(ok.maxWidth === 1024, "rimelig maxWidth bevart");
assert(ok.maxHeight === 600, "rimelig maxHeight bevart");
assert(ok.quality === 0.85, "rimelig quality bevart");
assert(ok.format === "image/webp", "WEBP bevart");

// 3) Absurd lave verdier → clamped opp
const tooSmall = clampImageConfig({
  maxWidth: 100,
  maxHeight: 50,
  quality: 0.1,
});
assert(tooSmall.maxWidth === 400, "for lav maxWidth → clamped til 400");
assert(tooSmall.maxHeight === 300, "for lav maxHeight → clamped til 300");
assert(tooSmall.quality === 0.5, "for lav quality → clamped til 0.5");

// 4) Absurd høye verdier → clamped ned
const tooBig = clampImageConfig({
  maxWidth: 5000,
  maxHeight: 4000,
  quality: 1.0,
});
assert(tooBig.maxWidth === 2400, "for høy maxWidth → clamped til 2400");
assert(tooBig.maxHeight === 1800, "for høy maxHeight → clamped til 1800");
assert(tooBig.quality === 0.95, "quality 1.0 → clamped til 0.95");

// 5) Ugyldig format → JPEG fallback
const badFormat = clampImageConfig({
  // @ts-expect-error testing invalid value
  format: "image/png",
});
assert(badFormat.format === "image/jpeg", "ugyldig format → JPEG fallback");

// 6) NaN/null/string for tall → defaults
const garbage = clampImageConfig({
  // @ts-expect-error testing invalid types
  maxWidth: "stor",
  maxHeight: NaN,
  // @ts-expect-error testing invalid types
  quality: null,
});
assert(
  garbage.maxWidth === DEFAULT_IMAGE_CONFIG.maxWidth,
  "string maxWidth → default",
);
assert(
  garbage.maxHeight === DEFAULT_IMAGE_CONFIG.maxHeight,
  "NaN maxHeight → default",
);
assert(
  garbage.quality === DEFAULT_IMAGE_CONFIG.quality,
  "null quality → default",
);

// 7) Negative tall → clamped opp til min
const negative = clampImageConfig({
  maxWidth: -1000,
  maxHeight: -500,
  quality: -0.5,
});
assert(negative.maxWidth === 400, "negativ maxWidth → 400 (min)");
assert(negative.maxHeight === 300, "negativ maxHeight → 300 (min)");
assert(negative.quality === 0.5, "negativ quality → 0.5 (min)");

console.log("\n7/7 image-config tests passed");
