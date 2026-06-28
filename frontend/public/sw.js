/**
 * Ko | Do · Vault — Service Worker
 *
 * Minimal vanilla SW. INGEN next-pwa, INGEN workbox.
 *
 * Hovedformål:
 *   1. Oppfylle Chrome PWA-installasjons-kriteriene slik at
 *      `beforeinstallprompt` fyrer på Android Chrome (krever en SW som
 *      håndterer `fetch`-events — selv en pass-through holder).
 *   2. Cache-first for statiske assets (versjonerte Next.js-bundles +
 *      ikoner/fonter/bilder fra /public). Raskere repeat-loads.
 *
 * STRENG isolasjon — INGEN caching av:
 *   - `/api/*`  → krypterte vault-blobs, auth-status, billing osv.
 *                  ALDRI cachet, ALLTID network-only.
 *   - HTML-sider (route-roots) → må alltid være ferske så vault.status
 *                                reflekterer server-state.
 *   - Cross-origin requests → unngår CORS-overraskelser, kun samme origin.
 *   - Ikke-GET requests → POST/PUT/DELETE skal alltid gå nett.
 *
 * Cache-strategi: cache-first for statiske assets, network-only for resten.
 *
 * Cache-version: bumpes manuelt når ikke-hashede assets (favicon, manifest
 * ikoner) endres. Versjonerte /_next/static/* henger seg på filhash så
 * deploys opphever caching naturlig.
 */

const CACHE_VERSION = "kodo-vault-static-v2";

// Statiske-asset-extensions vi cache-first'er på.
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

// Paths som ALDRI skal cachet (network-only). Sjekkes som prefix-match.
const NETWORK_ONLY_PREFIXES = ["/api/"];

self.addEventListener("install", (event) => {
  // Tving aktivering av denne SW umiddelbart (ikke vent på reload)
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Rydd opp gamle cache-versjoner ved aktivering
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("kodo-vault-static-") && k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  const pathname = url.pathname;
  // /_next/static/* er versjonerte hash-bundles — alltid trygt å cache
  if (pathname.startsWith("/_next/static/")) return true;
  // Ekstension-basert sjekk for /public/-assets (favicons, manifest-ikoner)
  return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function shouldNetworkOnly(url) {
  return NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Kun GET-requests cachet — POST/PUT/DELETE skal alltid treffe nett
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip cross-origin (Stripe.js, Google Fonts CDN etc.) — la browser-default
  if (url.origin !== self.location.origin) return;

  // Eksplisitte network-only paths (API)
  if (shouldNetworkOnly(url)) return;

  // Cache-first for statiske assets
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          // Cache kun vellykkede same-origin responses
          if (res.ok) {
            // clone() fordi response-bodyen kun kan leses én gang
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          // Ingen fallback — bare la nettverksfeilen propagere
          throw err;
        }
      })(),
    );
    return;
  }

  // Alt annet (HTML-sider, ukjente paths) → network-only (browser default)
});
