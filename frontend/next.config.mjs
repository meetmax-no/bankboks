/** @type {import('next').NextConfig} */

/**
 * Iter 13.7.1 (D-071): Tenant Vercel-prosjekter har ikke sentrale creds.
 * De rewrites /api/billing/* og /api/admin/* til admin.kodovault.no.
 *
 * VIKTIG: Vercel overskriver `x-forwarded-host` på rewrites — vi kan
 * IKKE stole på den for å bestemme subdomain. Vi appender derfor
 * `?_tenant=<sub>` til destination-URL. Tenant-prosjektet kjenner sin
 * egen subdomain via NEXT_PUBLIC_CLIENT_CONFIG (satt ved provisjonering).
 * Query-params bevares pålitelig gjennom Vercel-proxyen.
 *
 * Admin-deployen (NEXT_PUBLIC_CLIENT_CONFIG ikke satt) → ingen rewrite.
 */
const TENANT_SUBDOMAIN = process.env.NEXT_PUBLIC_CLIENT_CONFIG;
const isTenantDeploy = Boolean(TENANT_SUBDOMAIN);
const ADMIN_ORIGIN = process.env.NEXT_PUBLIC_ADMIN_ORIGIN ?? "https://admin.kodovault.no";

const nextConfig = {
  // 2026-06-05: tsc er nå ren (0 feil). Build feiler raskt på regresjon.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: [
    "*.preview.emergentagent.com",
    "*.preview.emergentcf.cloud",
  ],
  async rewrites() {
    if (!isTenantDeploy) return [];
    // VIKTIG: beforeFiles — array-form er `afterFiles` som kun firer hvis
    // ingen lokal route-fil matcher. Siden app/api/billing/*/route.ts
    // EKSISTERER lokalt (samme repo bygges på alle prosjekter), ville
    // den vunnet og rewrite ville aldri firet. beforeFiles forsikrer at
    // proxyen kjører før route-matching.
    return {
      beforeFiles: [
        {
          source: "/api/billing/:path*",
          destination: `${ADMIN_ORIGIN}/api/billing/:path*?_tenant=${TENANT_SUBDOMAIN}`,
        },
        {
          // Selvbetjent konto-sletting (GDPR art. 17). Tenant-poden eier
          // ikke sentral DB / Vercel-tokens, så sletting må kjøres på
          // admin-host'en. Subdomain medfølger som ?_tenant=<sub>.
          source: "/api/account/:path*",
          destination: `${ADMIN_ORIGIN}/api/account/:path*?_tenant=${TENANT_SUBDOMAIN}`,
        },
        {
          // Iter 19.9.2 — Klient-fanen i Settings henter tenant-info fra
          // DB (firstName/lastName, email, subdomain, createdAt, locale).
          // Tenant-poden eier ikke Upstash-creds, så lookup må kjøre på
          // admin-host'en via D-071-rewrite-mønsteret.
          source: "/api/tenant/:path*",
          destination: `${ADMIN_ORIGIN}/api/tenant/:path*?_tenant=${TENANT_SUBDOMAIN}`,
        },
      ],
    };
  },
};

export default nextConfig;
