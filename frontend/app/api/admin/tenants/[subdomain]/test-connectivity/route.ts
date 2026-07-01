/**
 * Ko | Do · Vault — D-145 (2026-02) — Test connectivity endpoint
 *
 * POST /api/admin/tenants/[subdomain]/test-connectivity
 *
 * Pinger `https://<subdomain>.kodovault.no` og returnerer HTTP-status +
 * responsetid. Brukes av `ConnectivityTestCard` i TenantViewer for å
 * verifisere at Vercel-registrering + DNS + TLS er OK — spesielt viktig
 * etter D-144 for B2B-parents hvor admin-host-attach kan feile failsoft.
 *
 * Response format:
 *   {
 *     host: "mm-admin.kodovault.no",
 *     status: "ok" | "unreachable" | "tls_error" | "http_error" | "timeout",
 *     httpStatus: 200 | 404 | ... | null,
 *     responseTimeMs: 312,
 *     error?: string
 *   }
 *
 * Beskyttet av middleware (admin-session-cookie).
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUEST_TIMEOUT_MS = 8000;

type Params = { params: Promise<{ subdomain: string }> };

type ConnectivityStatus =
  | "ok"
  | "unreachable"
  | "tls_error"
  | "http_error"
  | "timeout";

export async function POST(_req: Request, { params }: Params) {
  const { subdomain } = await params;
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const host = `${subdomain.toLowerCase().trim()}.kodovault.no`;
  const url = `https://${host}/api/status`;
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let status: ConnectivityStatus;
  let httpStatus: number | null = null;
  let error: string | undefined;

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      // Vi vil ikke følge redirects — vi vil kun se om HOSTEN svarer.
      redirect: "manual",
    });
    httpStatus = res.status;
    // 2xx, 3xx, 401, 404 er alle "hosten svarer" — det viktige er at TLS
    // fungerte og Vercel-podden ruter oss dit. 5xx tolkes som http_error.
    if (res.status >= 500) {
      status = "http_error";
      error = `HTTP ${res.status}`;
    } else {
      status = "ok";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("aborted") ||
      msg.includes("TIMEOUT") ||
      e instanceof Error && e.name === "AbortError"
    ) {
      status = "timeout";
    } else if (
      msg.includes("SSL") ||
      msg.includes("TLS") ||
      msg.includes("certificate") ||
      msg.includes("CERT_")
    ) {
      status = "tls_error";
    } else {
      // ECONNREFUSED, ECONNRESET, ENOTFOUND, ERR_CONNECTION_CLOSED etc.
      status = "unreachable";
    }
    error = msg;
  } finally {
    clearTimeout(timeout);
  }

  const responseTimeMs = Date.now() - start;

  return NextResponse.json({
    host,
    url,
    status,
    httpStatus,
    responseTimeMs,
    error,
  });
}
