/**
 * Ko | Do · Vault — D-077 Tenant env-var manifest
 *
 * Single source of truth for hvilke env-vars tenant-Vercel-prosjekter trenger.
 * `provisionTenantOnVercel` leser denne listen og setter dem alle automatisk.
 * Lint-skriptet `tenant-env-manifest.test.ts` håndhever konsistens med kode-bruk.
 *
 * Når du legger til en ny `process.env.X`-bruk i tenant-pod-kode (alt utenfor
 * sentral-buckets per D-071), MÅ varen også inn her ELLER ha default-fallback
 * i koden. Lint-en feiler ellers.
 *
 * **Kategorier:**
 *   - `perTenant`: unik verdi per tenant — settes av provisjoneringen
 *     med tenant-spesifikke data (subdomain, tenant-Upstash-creds)
 *   - `sharedFromAdmin`: felles verdi propagert fra admin sin egen env
 *     (samme verdi i alle tenant-deploys)
 *
 * Optional vars (med default i koden) trenger IKKE være listet her.
 */

export const TENANT_ENV_VARS = {
  /**
   * Per-tenant unike verdier. Settes eksplisitt av provisjoneringen med
   * tenant-spesifikke data — provisjoneringen vet hvilken verdi som
   * tilhører hvilken tenant.
   */
  perTenant: [
    "NEXT_PUBLIC_CLIENT_CONFIG", // = subdomain
    "KV_REST_API_URL", // tenant-Upstash REST URL
    "KV_REST_API_TOKEN", // tenant-Upstash REST token
  ] as const,

  /**
   * Felles verdier propagert fra admin sin egen `process.env`. Samme
   * verdi i alle tenant-deploys. Provisjonering FAILER hvis admin
   * mangler en av disse — vi vil ikke ende med stille feil.
   */
  sharedFromAdmin: [
    "INTERNAL_RPC_SECRET", // D-076 — write-block RPC bearer
    "ADMIN_INTERNAL_URL", // D-077 — tenant-pod → admin RPC base URL
    "NEXT_PUBLIC_ADMIN_CONFIG_HOST", // D-077 — frontend config-fetch host
  ] as const,

  /**
   * Iter 20.9 (D-082, 2026-06-27): B2B parent-tenants (`<prefix>-admin`)
   * trenger sentral Upstash-tilgang for å lese OrgAdmin-records, signere
   * am-admin login-cookies og sende velkomstmail. B2C-tenants får IKKE
   * disse (D-071 isolasjon bevart).
   *
   * Provisjoneringen inkluderer disse KUN når input.customerType === "b2b".
   */
  sharedFromAdminB2BParent: [
    "CENTRAL_KV_REST_API_URL",
    "CENTRAL_KV_REST_API_TOKEN",
    "CENTRAL_ENCRYPTION_KEY",
    "ORG_ADMIN_SESSION_SECRET",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "EMAIL_ENABLED",
  ] as const,
} as const;

export type PerTenantEnvKey = (typeof TENANT_ENV_VARS.perTenant)[number];
export type SharedFromAdminEnvKey =
  (typeof TENANT_ENV_VARS.sharedFromAdmin)[number];
export type SharedFromAdminB2BParentEnvKey =
  (typeof TENANT_ENV_VARS.sharedFromAdminB2BParent)[number];
