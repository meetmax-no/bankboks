"use client";

// Laster klient-spesifikk config:
// - "default" → /clients/default.json (static fil i tenantens egen app)
// - <subdomain> → admin.kodovault.no/api/client-config?id=<subdomain>
//   (sentral Upstash via CORS — D-060)
// Fallback-kjede ved feil:
//   1. localStorage-cache <24t (D-061)
//   2. /clients/default.json (static fallback)
//   3. FALLBACK_CONFIG (kompilert default)

import { useEffect, useState } from "react";
import { FALLBACK_CONFIG, clampImageConfig, type AppConfig } from "@/lib/config";

export type ConfigStatus = "loading" | "ready" | "error";

interface UseAppConfigResult {
  config: AppConfig;
  status: ConfigStatus;
  error: string | null;
  requestedClient: string;
  activeClient: string;
}

const DEFAULT_CLIENT = "default";

// Admin-host som serverer /api/client-config. Override via env-var hvis du
// flytter admin-modulen til annet host.
//
// 2026-06-24: defensive guard mot typo i env-var. Tidligere hadde en
// tenant `NEXT_PUBLIC_ADMIN_CONFIG_HOST=https://admin.kodovaul.no` (typo)
// satt via D-077-propagering fra admin. Resultat: alle client-config-
// fetches → DNS-fail → tomme Klient-fanen + branded 500. Defensiv guard:
// hvis env-verdien ikke peker på et `.kodovault.no`-host, fall tilbake til
// hardkodet default. Logger en warning så feilen er synlig i console.
const ADMIN_HOST_FALLBACK = "https://admin.kodovault.no";

function resolveAdminConfigHost(): string {
  const envValue = process.env.NEXT_PUBLIC_ADMIN_CONFIG_HOST?.trim();
  if (!envValue) return ADMIN_HOST_FALLBACK;
  try {
    const u = new URL(envValue);
    const ok =
      u.hostname === "kodovault.no" || u.hostname.endsWith(".kodovault.no");
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useAppConfig] NEXT_PUBLIC_ADMIN_CONFIG_HOST="${envValue}" ` +
          `peker ikke på *.kodovault.no — sannsynligvis typo i Vercel-env. ` +
          `Faller tilbake til "${ADMIN_HOST_FALLBACK}".`,
      );
      return ADMIN_HOST_FALLBACK;
    }
    return envValue;
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[useAppConfig] NEXT_PUBLIC_ADMIN_CONFIG_HOST="${envValue}" ` +
        `er ikke en gyldig URL. Faller tilbake til "${ADMIN_HOST_FALLBACK}".`,
    );
    return ADMIN_HOST_FALLBACK;
  }
}

const ADMIN_CONFIG_HOST = resolveAdminConfigHost();

// localStorage-cache (D-061): beskytter mot admin.kodovault.no-nedetid.
// Eksisterende tenants overlever 24t uten å miste branding.
const CACHE_KEY_PREFIX = "kodo-config:";
const CACHE_TS_SUFFIX = ":ts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function cacheKey(subdomain: string): string {
  return `${CACHE_KEY_PREFIX}${subdomain}`;
}

function cacheTsKey(subdomain: string): string {
  return `${cacheKey(subdomain)}${CACHE_TS_SUFFIX}`;
}

function writeCache(subdomain: string, data: AppConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(subdomain), JSON.stringify(data));
    window.localStorage.setItem(cacheTsKey(subdomain), String(Date.now()));
  } catch {
    /* localStorage avslått eller full — ignorer, neste fetch prøver igjen */
  }
}

function readCache(subdomain: string): AppConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const tsRaw = window.localStorage.getItem(cacheTsKey(subdomain));
    if (!tsRaw) return null;
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || Date.now() - ts > CACHE_MAX_AGE_MS) {
      return null;
    }
    const raw = window.localStorage.getItem(cacheKey(subdomain));
    if (!raw) return null;
    return JSON.parse(raw) as AppConfig;
  } catch {
    return null;
  }
}

async function fetchDefaultConfig(): Promise<AppConfig> {
  const res = await fetch(`/clients/${DEFAULT_CLIENT}.json`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for clients/${DEFAULT_CLIENT}.json`);
  }
  const data = (await res.json()) as AppConfig;
  return normalizeConfig(data);
}

async function fetchTenantConfig(subdomain: string): Promise<AppConfig> {
  const url = `${ADMIN_CONFIG_HOST}/api/client-config?id=${encodeURIComponent(subdomain)}`;
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const body = (await res.json()) as
    | { ok: true; config: AppConfig }
    | { ok: false; error: string };
  if (!body.ok) {
    throw new Error(`client-config ${body.error}`);
  }
  return normalizeConfig(body.config);
}

/**
 * Clamp sikkerhets-relaterte verdier slik at `default.json` eller
 * klient-config ikke kan sette verdier som bryter North Star (D-001).
 *
 * Clipboard auto-clear (D-011):
 *   - Min 10 sek (kortere enn det rekker du ikke å lime inn)
 *   - Max 120 sek (2 min — for å holde sikkerhet høy)
 *   - Default fallback: 30 sek hvis feltet mangler helt
 */
function normalizeConfig(cfg: AppConfig): AppConfig {
  const raw = cfg.security?.clipboardClearSeconds;
  let clipboardClearSeconds = 30;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    clipboardClearSeconds = Math.max(10, Math.min(120, Math.round(raw)));
  }
  return {
    ...cfg,
    security: {
      ...cfg.security,
      clipboardClearSeconds,
    },
    image: clampImageConfig(cfg.image),
  };
}

export function useAppConfig(): UseAppConfigResult {
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [status, setStatus] = useState<ConfigStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const requestedClient =
    process.env.NEXT_PUBLIC_CLIENT_CONFIG?.trim() || DEFAULT_CLIENT;
  const [activeClient, setActiveClient] = useState<string>(requestedClient);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // "default" → static fil. Alt annet → sentral Upstash via admin-host.
        const data =
          requestedClient === DEFAULT_CLIENT
            ? await fetchDefaultConfig()
            : await fetchTenantConfig(requestedClient);
        if (!cancelled) {
          setConfig(data);
          setActiveClient(requestedClient);
          setStatus("ready");
          // D-061: cache vellykket tenant-fetch for offline-resilience
          if (requestedClient !== DEFAULT_CLIENT) {
            writeCache(requestedClient, data);
          }
        }
      } catch (primaryErr) {
        if (requestedClient !== DEFAULT_CLIENT) {
          // D-061: prøv localStorage-cache først (admin.kodovault.no kan være nede)
          const cached = readCache(requestedClient);
          if (cached && !cancelled) {
            setConfig(normalizeConfig(cached));
            setActiveClient(requestedClient);
            setStatus("ready");
            setError(
              `admin.kodovault.no svarer ikke — bruker cachet config (<24t gammel).`,
            );
            return;
          }
          // Cache mangler eller for gammel → fallback til default.json
          try {
            const data = await fetchDefaultConfig();
            if (!cancelled) {
              setConfig(data);
              setActiveClient(DEFAULT_CLIENT);
              setStatus("ready");
              setError(
                `Fant ikke client-config for "${requestedClient}" — bruker default i stedet.`,
              );
            }
            return;
          } catch {
            /* fall-through */
          }
        }
        if (!cancelled) {
          setError(
            primaryErr instanceof Error ? primaryErr.message : "Ukjent feil",
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestedClient]);

  return { config, status, error, requestedClient, activeClient };
}
