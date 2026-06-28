/**
 * Ko | Do · Vault — Iter 20.3 — Public GET /api/tenant/status
 *
 * Per blokker-svar 5=a (2026-06-26): tenant-pod-en sjekker sentral status
 * ved vault-unlock. Hvis tenant er `suspended` (eller `deleted`/`locked`)
 * skal pod-en blokkere unlock og vise en informativ feilmelding.
 *
 * PUBLIC — ingen auth. Returnerer KUN status-felt — ingen e-post, navn
 * eller andre identifiserende data. Sub-domain er ikke hemmelig (det er
 * en URL i nettleseren), så lekkasje er begrenset til "denne kontoen
 * finnes/er suspendert/er slettet".
 *
 * Brukes IKKE av admin-UI — admin-flyt har egne autoriserte endepunkter.
 *
 * Rate-limit-strategi: lett rate-limit per IP (60/min) for å hindre at
 * en angriper enumererer alle tenants ved å gjette subdomain. Selv om
 * den ikke gir mye info, gir vi heller ikke ut for mye til offentlig.
 *
 * Node runtime.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import { checkRateLimit, getClientIp } from "@/lib/platform/rate-limit";
import { isValidSubdomainFormat } from "@/lib/platform/subdomain";
import { computeB2BBillingState } from "@/lib/platform/b2b-billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = {
  bucket: "tenant-status-lookup",
  limit: 60,
  windowSeconds: 60,
} as const;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", resetSeconds: rl.resetSeconds },
      { status: 429 },
    );
  }

  const subdomain = req.nextUrl.searchParams
    .get("subdomain")
    ?.toLowerCase()
    .trim();
  if (!subdomain) {
    return NextResponse.json(
      { error: "missing_subdomain" },
      { status: 400 },
    );
  }
  // Fast-path: avvis åpenbart-ugyldige subdomain-forsøk uten Upstash-rundtur.
  // (Iter 20.3 review-feedback: reduserer kostnad på enumererings-probing.)
  if (!isValidSubdomainFormat(subdomain)) {
    return NextResponse.json(
      { status: "unknown" },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=30" },
      },
    );
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    // Ikke avslør hvorvidt subdomain har eksistert — returner "unknown"
    // (ikke 404) slik at en angriper ikke kan distingvere "ble slettet"
    // fra "har aldri eksistert".
    return NextResponse.json(
      { status: "unknown" },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=30" },
      },
    );
  }

  // Iter 20.4 patch (2026-06-26): B2B parent-tenants har INGEN vault-URL.
  // Treat parent-record som "unknown" så `<prefix>.kodovault.no` ikke
  // returnerer parent-status. (am-admin har egen autorisert /me-endepunkt
  // for parent-statusinfo — denne ruten er for tenant-pod ved unlock.)
  if (tenant.customerType === "b2b" && tenant.parentTenant === null) {
    return NextResponse.json(
      { status: "unknown" },
      {
        status: 200,
        headers: { "Cache-Control": "public, max-age=30" },
      },
    );
  }

  return NextResponse.json(
    {
      status: tenant.status,
      // Inkluder en kort versjon-flag så pod-en kan vise målrettet melding
      // for hvert blokker-scenario uten å trenge full tekst i URL.
      suspended: tenant.status === "suspended",
      locked: tenant.status === "locked",
      cancelled: tenant.status === "cancelled",
      deleted: tenant.status === "deleted",
      // Iter 20.4c (D-080): for B2B children, inkluder parent billing-state.
      // Pod-en bruker `parent.inGracePeriod` for å vise diskret toast ved
      // innlogging når organisasjonen er i grace-perioden. `effectiveLocked`
      // er true hvis parent er locked (cascade-låst) — child's egen status
      // er allerede satt til "locked" av cron, men dette feltet eksisterer
      // for fremtidig fleksibilitet (eks: live status uten cron-roundtrip).
      ...(tenant.customerType === "b2b" && tenant.parentTenant
        ? await buildB2BChildParentInfo(tenant.parentTenant)
        : {}),
    },
    {
      status: 200,
      // 30s cache slik at pod-en ikke spør ved hvert unlock-forsøk hvis
      // bruker prøver passordet flere ganger raskt. 30s er kort nok til
      // at en suspendert ansatt blir blokkert innen rimelig tid.
      headers: { "Cache-Control": "public, max-age=30" },
    },
  );
}

/**
 * Iter 20.4c (D-080): hent parent-billing-state for en B2B child så pod-en
 * kan rendre grace-toast ved innlogging. Returnerer kun absolutt nødvendige
 * felter — vi lekker IKKE parent.email, parent.firstName, eller noe annet
 * identifiserende.
 */
async function buildB2BChildParentInfo(
  parentSubdomain: string,
): Promise<{
  parent: { inGracePeriod: boolean; graceEndsAt: string | null } | null;
}> {
  const parent = await getTenant(parentSubdomain);
  if (!parent) return { parent: null };
  const state = computeB2BBillingState(parent, new Date());
  return {
    parent: {
      inGracePeriod: state.phase === "grace" || state.phase === "expired",
      graceEndsAt: state.graceEndsAt,
    },
  };
}
