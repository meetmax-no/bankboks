/**
 * Ko | Do · Vault — Service Worker cache-strategy rules
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/sw-cache-rules.test.ts`
 *
 * SW-en (`public/sw.js`) bruker tre interne predikat-funksjoner som
 * bestemmer cache-strategi:
 *   - isStaticAsset(url)    → cache-first
 *   - shouldNetworkOnly(url) → ALDRI cache (API)
 *   - resten                 → network-only (browser default)
 *
 * Vi speiler logikken her som ren funksjon og verifiserer at klassifiseringen
 * er korrekt for alle relevante paths. Endrer du logikken i sw.js må du
 * oppdatere disse funksjonene.
 */

// Module marker — gjør denne filen til en TS-modul (ikke ambient script).
// Uten dette ville `function assert` kollidert med samme-navnet i andre
// test-script-filer (TS deler globalt namespace for ambient scripts).
export {};

const STATIC_EXTENSIONS = [
  ".js",
  ".css",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".ico",
];

const NETWORK_ONLY_PREFIXES = ["/api/"];

function isStaticAsset(pathname: string): boolean {
  if (pathname.startsWith("/_next/static/")) return true;
  return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function shouldNetworkOnly(pathname: string): boolean {
  return NETWORK_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
}

type Strategy = "cache-first" | "network-only-explicit" | "network-only-default";

function classify(pathname: string): Strategy {
  if (shouldNetworkOnly(pathname)) return "network-only-explicit";
  if (isStaticAsset(pathname)) return "cache-first";
  return "network-only-default";
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

// ─── /api/* ALDRI cachet ─────────────────────────────────────────────────
console.log("\n1. /api/* — alltid network-only");
const apiPaths = [
  "/api/vault",
  "/api/vault/events",
  "/api/account/delete",
  "/api/billing/portal",
  "/api/admin/login",
  "/api/cron/lifecycle-sweep",
  "/api/webhook",
  "/api/register/paid",
  "/api/invite/accept",
];
for (const p of apiPaths) {
  assert(
    classify(p) === "network-only-explicit",
    `${p} → network-only (eksplisitt)`,
  );
}

// ─── /_next/static/* cache-first (hashede bundles) ──────────────────────
console.log("\n2. /_next/static/* — cache-first (versjonerte hashes)");
const nextStaticPaths = [
  "/_next/static/chunks/abc123.js",
  "/_next/static/css/main-deadbeef.css",
  "/_next/static/media/Inter.woff2",
  "/_next/static/chunks/pages/_app-xyz.js",
];
for (const p of nextStaticPaths) {
  assert(classify(p) === "cache-first", `${p} → cache-first`);
}

// ─── /public/-assets via extension-match ────────────────────────────────
console.log("\n3. /public/-assets (favicons, manifest-ikoner, bilder)");
const publicAssets = [
  "/favicon.ico",
  "/favicon-96x96.png",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
];
for (const p of publicAssets) {
  assert(classify(p) === "cache-first", `${p} → cache-first`);
}

// ─── HTML-sider (route-roots) network-only ──────────────────────────────
console.log("\n4. HTML-sider — network-only (default), aldri cachet");
const htmlRoutes = [
  "/",
  "/billing/upgrade",
  "/billing/success",
  "/billing/error",
  "/invite",
  "/platform/admin",
  "/platform/test",
  "/colors",
];
for (const p of htmlRoutes) {
  assert(
    classify(p) === "network-only-default",
    `${p} → network-only (default)`,
  );
}

// ─── site.webmanifest behandles som default network-only ────────────────
// (har ikke en av STATIC_EXTENSIONS-endingene). Det er greit fordi Chrome
// uansett henter den ved hver SW-install — den er liten.
console.log("\n5. /site.webmanifest — network-only (ikke i extension-listen)");
assert(
  classify("/site.webmanifest") === "network-only-default",
  "/site.webmanifest → network-only (default, ikke i extension-listen)",
);

// ─── /sw.js seg selv ── må ALDRI cachet ─────────────────────────────────
// /sw.js har .js-endelse → ville matchet cache-first regelen. Browser
// håndterer SW-fil spesielt (24t max-age uansett, ignorerer cache), så
// dette er fortsatt trygt — men la oss dokumentere oppførselen.
console.log("\n6. /sw.js — matcher .js-regel, men browser har spesialregel");
assert(
  classify("/sw.js") === "cache-first",
  "/sw.js: vil bli cachet av SW, men browseren overstyrer (24t max-age)",
);

// ─── Edge cases ─────────────────────────────────────────────────────────
console.log("\n7. Edge cases");
assert(
  classify("/api") === "network-only-default",
  "/api (uten trailing slash) → network-only-default (ikke prefix-match med '/api/')",
);
assert(
  classify("/api/") === "network-only-explicit",
  "/api/ (med trailing slash) → network-only-explicit",
);
assert(
  classify("/_next/data/abc.json") === "network-only-default",
  "/_next/data/* (server-data, ikke statisk) → network-only-default",
);
assert(
  classify("/_next/image") === "network-only-default",
  "/_next/image (Next image optimizer, dynamisk pathname uten query) → network-only-default",
);

console.log("\n✓ SW cache-strategi-reglene validert");
