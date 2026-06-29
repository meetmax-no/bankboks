/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Client-config store (D-060)
 *
 * Per-tenant client-config lagret i sentral Upstash som plain JSON
 * (ikke kryptert — innholdet er kategorier/branding/farger, ikke sensitivt).
 *
 * Nøkkel: `client-config:<subdomain>`
 *
 * Brukes av:
 *   - GET /api/client-config (public, leses av tenantens app i runtime)
 *   - GET/PUT /api/admin/client-config (beskyttet, brukes av admin-editor)
 *   - provisionTenantOnVercel (initiell skriving ved tenant-opprettelse)
 *
 * Node runtime ONLY.
 */
import { getCentralRedis } from "./central-upstash";
import { readDefaultTemplate, type ClientConfigJson } from "./tenant-config-builder";
import defaultClientConfig from "../../public/clients/default.json";

const KEY_PREFIX = "client-config:";

function key(subdomain: string): string {
  return `${KEY_PREFIX}${subdomain.toLowerCase().trim()}`;
}

export async function getClientConfig(
  subdomain: string,
): Promise<ClientConfigJson | null> {
  const client = getCentralRedis();
  const raw = await client.get<ClientConfigJson | null>(key(subdomain));
  return raw ?? null;
}

export async function putClientConfig(
  subdomain: string,
  config: ClientConfigJson,
): Promise<void> {
  const client = getCentralRedis();
  await client.set(key(subdomain), config);
}

export async function deleteClientConfig(
  subdomain: string,
): Promise<boolean> {
  const client = getCentralRedis();
  const removed = await client.del(key(subdomain));
  return removed > 0;
}

/**
 * Pricing-struktur i client-config (default.json + per-tenant override).
 *
 * D-127 (2026-02 · Mike): strukturert format med separate B2C og B2B
 * underobjekter. Bakoverkompatibel reader (`pickPricing`) støtter også
 * det gamle flate formatet (`pricing.monthly` / `pricing.yearly`) — eldre
 * tenant-configs i Upstash leses uten migrering.
 *
 * Stripe-flyten for B2C bruker `PricingConfig` (B2C-felter) via
 * `getPricing()` og `getTrialDays()`. B2B-priser leses via
 * `getB2BPricing()` (per-seat, semiannual + yearly, manuell faktura).
 */
export interface B2CPricingConfig {
  monthly: number;
  yearly: number;
  trialDays: number;
}

export interface B2BPricingConfig {
  semiannualPerSeat: number;
  yearlyPerSeat: number;
  trialDays: number;
}

/**
 * Returneres av `getPricing(subdomain)`. Inneholder B2C-felter direkte
 * (bakoverkompatibelt med tidligere callers — CheckoutChoice,
 * checkout-info, register/paid). For B2B-priser, bruk `getB2BPricing()`.
 */
export interface PricingConfig extends B2CPricingConfig {
  currency: string;
}

/**
 * Hardkodet ABSOLUT fallback — brukes BARE hvis BÅDE tenant-config OG
 * default.json mangler/er ulesbare. I praksis skal dette aldri trigge.
 * Verdier importeres fra `default.json` ved build-time så vi har én
 * sannhetskilde i hele kodebasen.
 */
function pickB2C(
  pricing: Record<string, unknown> | undefined,
): Partial<B2CPricingConfig> | null {
  if (!pricing) return null;
  // Foretrekk nested `pricing.b2c.*`, fallback til flat `pricing.{monthly,yearly,trialDays}`.
  const nested = pricing.b2c;
  const obj =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : pricing;
  const out: Partial<B2CPricingConfig> = {};
  if (typeof obj.monthly === "number" && Number.isFinite(obj.monthly) && obj.monthly >= 0) {
    out.monthly = obj.monthly;
  }
  if (typeof obj.yearly === "number" && Number.isFinite(obj.yearly) && obj.yearly >= 0) {
    out.yearly = obj.yearly;
  }
  if (typeof obj.trialDays === "number" && Number.isFinite(obj.trialDays)) {
    const v = Math.floor(obj.trialDays);
    if (v >= 0 && v <= 365) out.trialDays = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const HARDCODED_PRICING_FALLBACK: PricingConfig = {
  monthly: pickB2C(defaultClientConfig.pricing as Record<string, unknown> | undefined)?.monthly ?? 115,
  yearly: pickB2C(defaultClientConfig.pricing as Record<string, unknown> | undefined)?.yearly ?? 1104,
  currency:
    (defaultClientConfig.pricing as Record<string, unknown> | undefined)?.currency &&
    typeof (defaultClientConfig.pricing as Record<string, unknown>).currency === "string"
      ? ((defaultClientConfig.pricing as Record<string, unknown>).currency as string)
      : "kr",
  trialDays: pickB2C(defaultClientConfig.pricing as Record<string, unknown> | undefined)?.trialDays ?? 0,
};

const HARDCODED_B2B_FALLBACK: B2BPricingConfig = {
  semiannualPerSeat: 522,
  yearlyPerSeat: 1044,
  trialDays: 0,
};

/**
 * Henter samlet B2C pricing-objekt for en tenant.
 *
 * Lookup-prioritet:
 *   1. Tenantens client-config i Upstash (`pricing.b2c.*` eller flat legacy)
 *   2. default.json (`pricing.b2c.*`)
 *   3. Hardkodet fallback (skal aldri trigge i normal drift)
 *
 * Hver enkelt verdi valideres uavhengig — hvis bare `trialDays` mangler i
 * tenant-config, brukes default.json sin `trialDays` (per-felt fallback).
 *
 * Returverdien er flat (`monthly/yearly/currency/trialDays`) for å beholde
 * bakoverkompatibilitet med eksisterende callers. B2B-priser leses via
 * `getB2BPricing()`.
 */
export async function getPricing(subdomain: string): Promise<PricingConfig> {
  const tenantPricing = pickPricing(await getClientConfig(subdomain));
  let defaultPricing: Partial<PricingConfig> = {};
  try {
    defaultPricing = pickPricing(await readDefaultTemplate()) ?? {};
  } catch {
    /* default.json ikke lesbar — bruk hardkodet fallback */
  }

  // Per-felt fallback: tenant → default → hardkodet
  return {
    monthly:
      tenantPricing?.monthly ??
      defaultPricing.monthly ??
      HARDCODED_PRICING_FALLBACK.monthly,
    yearly:
      tenantPricing?.yearly ??
      defaultPricing.yearly ??
      HARDCODED_PRICING_FALLBACK.yearly,
    currency:
      tenantPricing?.currency ??
      defaultPricing.currency ??
      HARDCODED_PRICING_FALLBACK.currency,
    trialDays:
      tenantPricing?.trialDays ??
      defaultPricing.trialDays ??
      HARDCODED_PRICING_FALLBACK.trialDays,
  };
}

/**
 * Henter `trialDays` for en tenant. Tynn wrapper rundt `getPricing()`
 * som beholder kompatibilitet med Stripe checkout-flyten (Scenario C).
 *
 * Returnerer alltid et heltall 0 ≤ n ≤ 365. `0` betyr "ingen trial,
 * fakturer umiddelbart" — Stripe får da IKKE `trial_period_days`-feltet.
 */
export async function getTrialDays(subdomain: string): Promise<number> {
  const { trialDays } = await getPricing(subdomain);
  return trialDays;
}

/**
 * D-127 (2026-02): Henter B2B per-seat-pricing for en tenant.
 *
 * Lookup-prioritet:
 *   1. Tenantens client-config (`pricing.b2b.*`)
 *   2. default.json (`pricing.b2b.*`)
 *   3. Hardkodet fallback (semiannual=522, yearly=1044, trial=0)
 *
 * Returverdien inkluderer `currency` separat — kall `getPricing()` for
 * å hente valuta hvis du trenger den.
 */
export async function getB2BPricing(
  subdomain: string,
): Promise<B2BPricingConfig> {
  const tenantB2B = pickB2BPricing(await getClientConfig(subdomain));
  let defaultB2B: Partial<B2BPricingConfig> = {};
  try {
    defaultB2B = pickB2BPricing(await readDefaultTemplate()) ?? {};
  } catch {
    /* default.json ikke lesbar — bruk hardkodet fallback */
  }
  return {
    semiannualPerSeat:
      tenantB2B?.semiannualPerSeat ??
      defaultB2B.semiannualPerSeat ??
      HARDCODED_B2B_FALLBACK.semiannualPerSeat,
    yearlyPerSeat:
      tenantB2B?.yearlyPerSeat ??
      defaultB2B.yearlyPerSeat ??
      HARDCODED_B2B_FALLBACK.yearlyPerSeat,
    trialDays:
      tenantB2B?.trialDays ??
      defaultB2B.trialDays ??
      HARDCODED_B2B_FALLBACK.trialDays,
  };
}

/**
 * Plukker B2C-pricing fra en client-config og validerer hvert felt.
 * Returnerer kun de feltene som er gyldige — caller gjør per-felt fallback.
 *
 * Aksepterer både nytt nested format (`pricing.b2c.*`) og legacy flat
 * format (`pricing.monthly`/`pricing.yearly`/`pricing.trialDays`) for
 * bakoverkompatibilitet med tenant-configs lagret før D-127.
 */
function pickPricing(
  config: ClientConfigJson | null,
): Partial<PricingConfig> | null {
  if (!config) return null;
  const raw = config.pricing;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const b2c = pickB2C(obj);
  const out: Partial<PricingConfig> = { ...(b2c ?? {}) };

  if (typeof obj.currency === "string" && obj.currency.length > 0 && obj.currency.length <= 8) {
    out.currency = obj.currency;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * D-127 (2026-02): plukker B2B-pricing fra en client-config og validerer
 * hvert felt. Leser kun fra nested `pricing.b2b.*` (ingen legacy-flat-form
 * — B2B-priser var aldri lagret flatt).
 */
function pickB2BPricing(
  config: ClientConfigJson | null,
): Partial<B2BPricingConfig> | null {
  if (!config) return null;
  const pricing = config.pricing;
  if (!pricing || typeof pricing !== "object" || Array.isArray(pricing)) return null;
  const b2b = (pricing as Record<string, unknown>).b2b;
  if (!b2b || typeof b2b !== "object" || Array.isArray(b2b)) return null;
  const obj = b2b as Record<string, unknown>;
  const out: Partial<B2BPricingConfig> = {};

  if (
    typeof obj.semiannualPerSeat === "number" &&
    Number.isFinite(obj.semiannualPerSeat) &&
    obj.semiannualPerSeat >= 0
  ) {
    out.semiannualPerSeat = obj.semiannualPerSeat;
  }
  if (
    typeof obj.yearlyPerSeat === "number" &&
    Number.isFinite(obj.yearlyPerSeat) &&
    obj.yearlyPerSeat >= 0
  ) {
    out.yearlyPerSeat = obj.yearlyPerSeat;
  }
  if (typeof obj.trialDays === "number" && Number.isFinite(obj.trialDays)) {
    const v = Math.floor(obj.trialDays);
    if (v >= 0 && v <= 365) out.trialDays = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Lifecycle-konfig (D-075 · 2026-06-13).
 * Tidslinjen for trial → locked → deleted.
 */
export interface LifecycleConfig {
  trialDays: number;
  trialWarningDaysBefore: number;
  lockToDeleteDays: number;
  deleteWarningDaysBefore: number;
}

const HARDCODED_LIFECYCLE_FALLBACK: LifecycleConfig = {
  trialDays: 30,
  trialWarningDaysBefore: 5,
  lockToDeleteDays: 28,
  deleteWarningDaysBefore: 7,
};

/**
 * Henter lifecycle-konfig for en tenant. Lookup-prioritet:
 *   1. Tenantens client-config i Upstash (`lifecycle`-objekt)
 *   2. default.json (`lifecycle`-objekt)
 *   3. Hardkodet fallback (30/5/28/7)
 */
export async function getLifecycle(
  subdomain: string,
): Promise<LifecycleConfig> {
  const tenantLifecycle = pickLifecycle(await getClientConfig(subdomain));
  let defaultLifecycle: Partial<LifecycleConfig> = {};
  try {
    defaultLifecycle = pickLifecycle(await readDefaultTemplate()) ?? {};
  } catch {
    /* default.json ikke lesbar — bruk hardkodet fallback */
  }

  return {
    trialDays:
      tenantLifecycle?.trialDays ??
      defaultLifecycle.trialDays ??
      HARDCODED_LIFECYCLE_FALLBACK.trialDays,
    trialWarningDaysBefore:
      tenantLifecycle?.trialWarningDaysBefore ??
      defaultLifecycle.trialWarningDaysBefore ??
      HARDCODED_LIFECYCLE_FALLBACK.trialWarningDaysBefore,
    lockToDeleteDays:
      tenantLifecycle?.lockToDeleteDays ??
      defaultLifecycle.lockToDeleteDays ??
      HARDCODED_LIFECYCLE_FALLBACK.lockToDeleteDays,
    deleteWarningDaysBefore:
      tenantLifecycle?.deleteWarningDaysBefore ??
      defaultLifecycle.deleteWarningDaysBefore ??
      HARDCODED_LIFECYCLE_FALLBACK.deleteWarningDaysBefore,
  };
}

function pickLifecycle(
  config: ClientConfigJson | null,
): Partial<LifecycleConfig> | null {
  if (!config) return null;
  const raw = (config as Record<string, unknown>).lifecycle;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: Partial<LifecycleConfig> = {};

  const fields: Array<keyof LifecycleConfig> = [
    "trialDays",
    "trialWarningDaysBefore",
    "lockToDeleteDays",
    "deleteWarningDaysBefore",
  ];
  for (const k of fields) {
    if (typeof obj[k] === "number" && Number.isFinite(obj[k])) {
      const v = Math.floor(obj[k] as number);
      if (v >= 0 && v <= 365) out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
