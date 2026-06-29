/**
 * Ko | Do · Vault — v4.3 Iter 0 (revidert) + Iter 20.2
 *
 * Middleware beskytter to separate admin-flyter:
 *
 *  1. **Mike's super-admin** på `admin.kodovault.no`:
 *       - `/platform/admin/*` + `/api/admin/*` ruter
 *       - HMAC-session via `kodo_admin_session`-cookie
 *       - Public ruter: /api/admin/session/start, /api/admin/logout
 *
 *  2. **am-admin (B2B org-admin)** på `<prefix>-admin.kodovault.no` (Iter 20.2):
 *       - `/platform/am-admin/*` + `/api/am-admin/*` ruter
 *       - HMAC-session via `kodo_org_admin_session`-cookie
 *       - Public ruter: /api/am-admin/auth/login, /api/am-admin/auth/logout
 *       - Host MÅ matche `<prefix>-admin.<base>` ELLER være dev-host med
 *         `?orgAdminPrefix=<prefix>` query-param
 *
 * Edge runtime — kun Web Crypto via `verifyAdminSession` / `verifyOrgAdminSession`.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_HOST,
  ADMIN_SESSION_COOKIE,
  verifyAdminSession,
} from "@/lib/platform/admin-auth";
import {
  ORG_ADMIN_HOST_SUFFIX,
  ORG_ADMIN_SESSION_COOKIE,
  extractOrgAdminPrefix,
  verifyOrgAdminSession,
} from "@/lib/platform/org-admin-auth";

export const config = {
  matcher: [
    "/platform/admin/:path*",
    "/api/admin/:path*",
    "/platform/am-admin/:path*",
    "/api/am-admin/:path*",
    // Iter 20.9 (D-083, Mike 2026-06-27): clean URL på am-admin host.
    // `/` viser login ELLER dashboard ELLER tvinget-bytte-form avhengig
    // av session + forcePasswordReset-flagget. INGEN `/login` eller
    // `/change-password`-ruter eksponert — alt skjer på `/`.
    "/",
  ],
};

// Iter 20.9 (D-083): Clean-URL → internal path mapping.
// Tom — `/` håndteres dynamisk inline. Beholder objektet for fremtidige
// utvidelser og for å unngå undefined-tilgang.
const AM_ADMIN_CLEAN_URL_MAP: Record<string, string> = {};

// Mike-admin public-ruter (uten gyldig session, men host-låst)
const PUBLIC_ADMIN_PATHS = new Set<string>([
  "/api/admin/session/start",
  "/api/admin/logout",
]);

// am-admin public-ruter (login + logout)
const PUBLIC_ORG_ADMIN_PATHS = new Set<string>([
  "/api/am-admin/auth/login",
  "/api/am-admin/auth/logout",
  "/platform/am-admin/login",
]);

function getHost(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-host");
  const host = (fwd ?? req.headers.get("host") ?? "").toLowerCase();
  return host.split(":")[0];
}

function isDevHost(host: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".preview.emergentagent.com") ||
    host.endsWith(".preview.emergentcf.cloud") ||
    host.endsWith(".vercel.app")
  );
}

function isMikeAdminHost(host: string): boolean {
  if (host === ADMIN_HOST) return true;
  if (isDevHost(host)) return true; // dev: hver host kan agere admin-host
  return false;
}

function isOrgAdminPath(pathname: string): boolean {
  return (
    pathname.startsWith("/platform/am-admin") ||
    pathname.startsWith("/api/am-admin")
  );
}

function isMikeAdminPath(pathname: string): boolean {
  return (
    pathname.startsWith("/platform/admin") || pathname.startsWith("/api/admin")
  );
}

export async function middleware(req: NextRequest) {
  const host = getHost(req);
  const { pathname } = req.nextUrl;

  // ────────────────────────────────────────────────────────────────
  // Iter 20.9 (D-083): Clean URL-rewrite for am-admin host.
  //
  // Mønster (samme som admin.kodovault.no):
  //   `/`                  → login-skjema (ingen session) ELLER dashboard
  //   `/change-password`   → passordbytte-side (krever session)
  //   Brukeren ser ALDRI /platform/am-admin/... i URL-baren.
  // ────────────────────────────────────────────────────────────────
  const amAdminPrefixForRewrite = extractOrgAdminPrefix(host, null);
  const isAmAdminHost = amAdminPrefixForRewrite !== null;

  // Static mapping (`/change-password` osv.) — `/` håndteres dynamisk.
  let internalRewriteTarget: string | null =
    isAmAdminHost && AM_ADMIN_CLEAN_URL_MAP[pathname]
      ? AM_ADMIN_CLEAN_URL_MAP[pathname]
      : null;

  // Dynamisk håndtering av `/`: login-side hvis ikke autentisert, dashboard
  // hvis autentisert. forcePasswordReset håndteres av dashboard-siden selv.
  let rootDynamic = false;
  if (isAmAdminHost && pathname === "/") {
    rootDynamic = true;
    const cookie = req.cookies.get(ORG_ADMIN_SESSION_COOKIE)?.value;
    const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
    const session = await verifyOrgAdminSession(cookie, secret);
    if (!session) {
      // Ingen session → vis login-skjema. Rewrite til login-siden (URL
      // beholder `/` i baren).
      const url = req.nextUrl.clone();
      url.pathname = "/platform/am-admin/login";
      return NextResponse.rewrite(url);
    }
    // Cross-org-isolasjon: session.prefix MÅ matche host-prefix.
    if (session.prefix !== amAdminPrefixForRewrite) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    // Gyldig session → vis dashboard.
    const url = req.nextUrl.clone();
    url.pathname = "/platform/am-admin";
    return NextResponse.rewrite(url);
  }

  const effectivePathname = internalRewriteTarget ?? pathname;

  // Hvis vi IKKE har en clean-URL-mapping OG pathname ikke er en admin-sti,
  // er det en pass-through.
  if (
    !internalRewriteTarget &&
    !rootDynamic &&
    !isOrgAdminPath(pathname) &&
    !isMikeAdminPath(pathname)
  ) {
    return NextResponse.next();
  }

  // Helper: returner enten rewrite (clean URL) eller next (intern URL)
  const okResponse = (): NextResponse => {
    if (internalRewriteTarget) {
      const url = req.nextUrl.clone();
      url.pathname = internalRewriteTarget;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  };

  // ────────────────────────────────────────────────────────────────
  // Route 1: am-admin ruter (/platform/am-admin/* og /api/am-admin/*)
  // ────────────────────────────────────────────────────────────────
  if (isOrgAdminPath(effectivePathname)) {
    const fallback = req.nextUrl.searchParams.get("orgAdminPrefix");
    const prefix = extractOrgAdminPrefix(host, fallback);

    // Sjekk om host er gyldig am-admin-host (ELLER dev-host med fallback)
    const hostOk =
      prefix !== null ||
      (isDevHost(host) && effectivePathname === "/platform/am-admin/login");
    if (!hostOk) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Public-paths trenger ingen session (kun host-validering ovenfor)
    if (PUBLIC_ORG_ADMIN_PATHS.has(effectivePathname)) {
      return okResponse();
    }
    // D-114 (2026-06-29): Public branding-endpoint — match på prefix.
    if (effectivePathname.startsWith("/api/am-admin/branding/")) {
      return okResponse();
    }

    // Krever gyldig session
    const cookie = req.cookies.get(ORG_ADMIN_SESSION_COOKIE)?.value;
    const secret = process.env.ORG_ADMIN_SESSION_SECRET ?? "";
    const session = await verifyOrgAdminSession(cookie, secret);

    if (!session) {
      if (effectivePathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "unauthorized", detail: "am-admin-session mangler eller er utløpt." },
          { status: 401 },
        );
      }
      // Iter 20.9 (D-083): På am-admin-host redirecter vi til CLEAN `/`
      // (root viser login-skjema). På dev-host bruker vi intern login-sti.
      const loginUrl = new URL(isAmAdminHost ? "/" : "/platform/am-admin/login", req.url);
      if (fallback) loginUrl.searchParams.set("orgAdminPrefix", fallback);
      return NextResponse.redirect(loginUrl);
    }

    // Cross-org-isolasjon: session.prefix MÅ matche host-prefix.
    if (prefix && session.prefix !== prefix) {
      if (effectivePathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "forbidden", detail: "Session-prefix matcher ikke host-prefix." },
          { status: 403 },
        );
      }
      return new NextResponse("Forbidden", { status: 403 });
    }

    return okResponse();
  }

  // ────────────────────────────────────────────────────────────────
  // Route 2: Mike-admin ruter (/platform/admin/* og /api/admin/*)
  // ────────────────────────────────────────────────────────────────
  if (isMikeAdminPath(pathname)) {
    if (!isMikeAdminHost(host)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (PUBLIC_ADMIN_PATHS.has(pathname)) {
      return NextResponse.next();
    }

    const cookie = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const secret = process.env.ADMIN_SESSION_SECRET ?? "";
    const session = await verifyAdminSession(cookie, secret);

    if (!session) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "unauthorized", detail: "Admin-session mangler eller er utløpt." },
          { status: 401 },
        );
      }
      const loginUrl = new URL("/", req.url);
      loginUrl.searchParams.set("adminRedirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  }

  // Skal aldri komme hit (matcher-config begrenser oss til admin/am-admin)
  return NextResponse.next();
}

// Re-eksport for at config-objektet skal trekke i ORG_ADMIN_HOST_SUFFIX
// via dependency-tree (eslint kan ellers tro at importen er ubrukt).
void ORG_ADMIN_HOST_SUFFIX;
