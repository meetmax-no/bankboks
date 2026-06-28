// Server-side parse av request-metadata (IP, User-Agent, geolocation).
// Utviklet for Vercel — bruker `x-vercel-ip-*`-headere som injiseres
// gratis av Vercel edge. Faller tilbake til `x-forwarded-for` på andre
// hosts. Ingen tredjeparts geoIP.

import { headers as nextHeaders } from "next/headers";

export interface RequestMeta {
  ip: string;
  userAgent: string;
  deviceSummary: string; // "Chrome · macOS"
  country?: string; // "NO"
  city?: string; // "Oslo"
  region?: string; // "Oslo"
}

export async function readRequestMeta(): Promise<RequestMeta> {
  const h = await nextHeaders();

  const ip =
    h.get("x-vercel-ip-address") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";

  const userAgent = h.get("user-agent") || "unknown";

  // Vercel geo headers (gratis, ingen 3rd party)
  const country = h.get("x-vercel-ip-country") || undefined;
  const city = h.get("x-vercel-ip-city")
    ? decodeURIComponent(h.get("x-vercel-ip-city") as string)
    : undefined;
  const region = h.get("x-vercel-ip-country-region") || undefined;

  return {
    ip,
    userAgent,
    deviceSummary: parseUserAgent(userAgent),
    country,
    city,
    region,
  };
}

/**
 * Minimalistisk UA-parser — nok for "Chrome · macOS"-visning.
 * Unngår ekstra dependency (ua-parser-js = ~20 KB).
 */
export function parseUserAgent(ua: string): string {
  if (!ua || ua === "unknown") return "ukjent enhet";

  // Browser
  let browser = "Ukjent";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";

  // OS
  let os = "Ukjent";
  if (/Windows NT/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua) && !/Mobile/.test(ua)) os = "macOS";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(ua)) os = "Linux";

  return `${browser} · ${os}`;
}

/** Formatter geo-lokasjon for visning: "Oslo, NO" eller bare "NO" */
export function formatLocation(meta: RequestMeta): string | undefined {
  if (meta.city && meta.country) return `${meta.city}, ${meta.country}`;
  if (meta.country) return meta.country;
  return undefined;
}
