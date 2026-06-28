/**
 * Ko | Do · Vault — Iter 20.9 (D-099, Mike 2026-06-28)
 *
 * KRITISK SIKKERHETSGRENSE — forhindrer cross-tenant data-lekkasje via
 * Vercel wildcard-fallback når tenant-deploys er i DNS-propagasjons-vinduet.
 *
 * Scenario som denne sjekken stopper:
 *   1. Bruker klikker invite-lenke → accept-flyten oppretter ny tenant
 *      `mm-nils.kodovault.no` med egen Vercel-pod + egen Upstash.
 *   2. Brukeren redirectes til `mm-nils.kodovault.no` umiddelbart, men
 *      DNS/Vercel-domain-mapping er IKKE klar ennå (typisk vindu 10-60s).
 *   3. Wildcard `*.kodovault.no` faller tilbake til admin-poden (eller
 *      en annen pod) som har sin EGEN Upstash med `vault:default` (e.l.) satt.
 *   4. Browser leser den FREMMEDE poden's vault-data → katastrofalt
 *      zero-knowledge-brudd (Mike's selv-test 2026-06-28: brand-new
 *      `mm-nils`-vault viste 21 oppføringer fra admin-podens vault).
 *
 * Forsvar: hver pod kjenner sitt egne subdomene via NEXT_PUBLIC_CLIENT_CONFIG
 * env-var (satt av provisjonering). Hvis request-Host IKKE matcher
 * `<expected>.kodovault.no`, avviser vi med 404 — som om vaulten ikke
 * eksisterer. Browseren reagerer på 404 ved å vise setup-skjerm (tom
 * vault), som er korrekt oppførsel.
 *
 * Admin-poden (ingen NEXT_PUBLIC_CLIENT_CONFIG) tillates kun for host
 * `admin.kodovault.no` eller dev/preview-hoster.
 */
import { NextResponse } from "next/server";

/**
 * Returnerer `null` hvis host er gyldig for denne poden, eller en 404-respons
 * hvis det er host-mismatch (wildcard-fallback).
 */
export function checkHostMatchesPod(req: Request): NextResponse | null {
  const expected = process.env.NEXT_PUBLIC_CLIENT_CONFIG?.trim().toLowerCase();
  const hostHeader =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const host = hostHeader.toLowerCase().split(":")[0];

  // Dev/preview: localhost og *.preview.* og *.vercel.app — tillat alle
  // (vi har ikke wildcard-fallback-problemet i dev).
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".preview.emergentagent.com") ||
    host.endsWith(".preview.emergentcf.cloud") ||
    host.endsWith(".vercel.app")
  ) {
    return null;
  }

  // Produksjon: NEXT_PUBLIC_CLIENT_CONFIG må være satt på tenant-pods.
  // Hvis ikke satt, er dette admin-poden (kun lov for admin.kodovault.no).
  if (!expected) {
    if (host !== "admin.kodovault.no") {
      console.warn(
        `[vault-host-guard] BLOCKED: pod uten NEXT_PUBLIC_CLIENT_CONFIG fikk request for host="${host}". Wildcard-fallback?`,
      );
      return NextResponse.json(
        { blob: null, error: "wrong_pod", detail: "Vault ikke tilgjengelig på denne hosten." },
        { status: 404 },
      );
    }
    return null;
  }

  // Tenant-pod: host MÅ matche `<expected>.kodovault.no`.
  const expectedHost = `${expected}.kodovault.no`;
  if (host !== expectedHost) {
    console.warn(
      `[vault-host-guard] BLOCKED: pod="${expected}" fikk request for host="${host}" (forventet "${expectedHost}"). Wildcard-fallback?`,
    );
    return NextResponse.json(
      { blob: null, error: "wrong_pod", detail: "Vault ikke tilgjengelig på denne hosten." },
      { status: 404 },
    );
  }
  return null;
}
