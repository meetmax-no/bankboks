/**
 * Ko | Do · Vault — v4.3 Iter 2 — Subdomene-validering
 *
 * Tre rene utility-funksjoner for å bestemme om et subdomene er gyldig,
 * reservert eller tilgjengelig. Ingen UI, ingen API-endpoints.
 *
 * Brukes av:
 *   - Iter 4: `/register`-skjema (sanntids-sjekk, via public endpoint i Iter 4)
 *   - Iter 7: `/api/register` server-side validering
 *   - Iter 1: gjenbrukes evt. i `/api/admin/tenants` POST for konsistens
 *
 * Per spec og Mike-bekreftelse 2026-06-01.
 */
import { tenantExists } from "./tenant-store";
import { getCentralRedis } from "./central-upstash";
import reservedConfig from "./reserved-subdomains.json";

const RESERVED_PREFIXES_KEY = "platform:reserved-prefixes";

/**
 * v4.3 Iter 7.5 — B2B prefiks-beskyttelse (D-038 utvidet 2026-06-02).
 *
 * Når Mike oppretter en B2B-tenant med `tenantPrefix: "am"` legges "am" til
 * i sentral Upstash SET `platform:reserved-prefixes`. Da blokkeres ALLE
 * subdomener som starter med "am-" for B2C selvbetjent registrering — kun
 * bedrifts-admin kan opprette `am-nils`, `am-kim`, osv. via Iter 20.
 *
 * Eksempel:
 *   tenantPrefix "am" registrert →
 *     "am-nils"  blokkert ✅ (B2B-ansatt-territorium)
 *     "am-admin" blokkert ✅ (D-038 *-admin uansett)
 *     "amanda"   IKKE blokkert ✅ (starter ikke med "am-")
 *     "am"       blokkert hvis i RESERVED_SUBDOMAINS, ellers fritt
 *
 * Sentral Upstash er sannhetskilde — fungerer på tvers av Vercel-instanser.
 */
export async function getReservedPrefixes(): Promise<string[]> {
  try {
    const client = getCentralRedis();
    const members = (await client.smembers(RESERVED_PREFIXES_KEY)) as
      | string[]
      | null;
    return members ?? [];
  } catch (err) {
    // Iter 20.9 (2026-06-27) — Fail-open med STRUKTURERT ALERT.
    //
    // Hvis sentral Upstash er nede, blokkér IKKE registrering — bedre å la
    // én tvilsom B2C-registrering slippe igjennom enn å låse hele platform-
    // selvbetjening. Men dette MÅ varsles tydelig så Mike oppdager det.
    //
    // [ALERT][platform:reserved-prefixes] er en greppable tag som log-
    // aggregator (Vercel Logs, Logflare, Sentry) kan filtrere på og sende
    // varsel ved første treff i prod. Når Sentry kobles inn senere — bytt
    // til Sentry.captureException(err, { tags: { area: "subdomain" }}).
    console.error(
      "[ALERT][platform:reserved-prefixes] getReservedPrefixes failed — " +
        "B2C-prefiks-sjekk er midlertidig deaktivert (fail-open). " +
        "Sjekk Upstash-status og UPSTASH_CENTRAL_* env-vars.",
      err,
    );
    return [];
  }
}

/**
 * Iter 20.9 (2026-06-27): Eksplisitt prefiks-duplikat-sjekk for
 * `POST /api/admin/tenants`. Forhindrer at to ulike B2B-org-er får samme
 * `tenantPrefix` (f.eks. "mm" for både "MeetMax" og "Mini Media"), noe
 * som ville gjort B2B-ansatt-subdomenet (`mm-lars`) tvetydig.
 *
 * Den indirekte sjekken via `tenantExists("<prefix>-admin")` fanger
 * standard-tilfellet, men ikke hvis admin overstyrer `subdomain` til
 * noe som ikke matcher `<prefix>-admin`-mønsteret. Denne sjekken
 * gardererer det.
 *
 * Returnerer true hvis prefiksen ALLEREDE er registrert (kollisjon).
 */
export async function isReservedPrefixTaken(prefix: string): Promise<boolean> {
  const clean = prefix.toLowerCase().trim();
  if (!clean) return false;
  try {
    const client = getCentralRedis();
    const isMember = await client.sismember(RESERVED_PREFIXES_KEY, clean);
    return isMember === 1;
  } catch (err) {
    // Fail-open her også — hvis Upstash er nede vil hele
    // opprettelsen feile på `addReservedPrefix` uansett. Logg med
    // samme ALERT-tag.
    console.error(
      "[ALERT][platform:reserved-prefixes] isReservedPrefixTaken failed — " +
        "duplikat-sjekk hoppet over.",
      err,
    );
    return false;
  }
}

/**
 * Legg til prefiks ved B2B-tenant-opprettelse. Idempotent (Redis SADD).
 * Kalles fra POST /api/admin/tenants når customerType === "b2b" og
 * tenantPrefix er satt.
 */
export async function addReservedPrefix(prefix: string): Promise<void> {
  const clean = prefix.toLowerCase().trim();
  if (!clean) return;
  const client = getCentralRedis();
  await client.sadd(RESERVED_PREFIXES_KEY, clean);
}

/**
 * Fjern prefiks ved B2B-tenant-sletting. Idempotent (Redis SREM).
 * KUN trygt å kalle hvis `activeLicenses === 0` — verifisering må skje
 * i DELETE-handleren før dette kalles.
 */
export async function removeReservedPrefix(prefix: string): Promise<void> {
  const clean = prefix.toLowerCase().trim();
  if (!clean) return;
  const client = getCentralRedis();
  await client.srem(RESERVED_PREFIXES_KEY, clean);
}

/**
 * Pure helper: gitt et subdomene og en liste reserverte prefikser, sjekk
 * om subdomenet starter med noen av dem (etterfulgt av "-").
 *
 * Eksportert separat for unit-testing uten Upstash.
 */
export function startsWithReservedPrefix(
  subdomain: string,
  prefixes: readonly string[],
): boolean {
  const s = subdomain.toLowerCase().trim();
  return prefixes.some((p) => {
    const clean = p.toLowerCase().trim();
    return clean !== "" && s.startsWith(clean + "-");
  });
}

/**
 * Eksakte-match reserverte subdomener. Lowercase. Aldri tilgjengelig for
 * selvregistrering, uansett hvilken plan.
 *
 * **Sannhetskilde:** `lib/platform/reserved-subdomains.json` (4 seksjoner:
 * system_dns, platform_app_roles, environments, kodo_specific). Mike kan
 * editere fritt der — endringer slår inn ved neste Vercel-deploy.
 *
 * `*-admin`-mønster håndteres separat i `isReservedSubdomain()` — reservert
 * for B2B-provisjonering (D-038). Det er en *regel*, ikke et navn, derfor
 * holdes den i kode.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  ...reservedConfig.system_dns,
  ...reservedConfig.platform_app_roles,
  ...reservedConfig.environments,
  ...reservedConfig.kodo_specific,
]);

/** Maks lengde — konsistent med eksisterende regex i `/api/admin/tenants` POST. */
export const SUBDOMAIN_MAX_LENGTH = 30;
export const SUBDOMAIN_MIN_LENGTH = 3;

/**
 * Sjekker at subdomenet matcher: kun a-z, 0-9, bindestrek; må starte og
 * slutte med bokstav/siffer; lengde 3-30 tegn (Mike 2026-06-01: industri-
 * standard er minimum 3 — Vercel/GitHub-konvensjon).
 *
 * Eksempler:
 *   ✅ "terje", "abc", "lisbeth-k", "a12"
 *   ❌ "TE" (for kort), "TERJE" (uppercase), "-foo", "foo-", "" (tom)
 *
 * Tomme strenger og ikke-strenger returnerer false (typeguard for kall fra
 * usanitarisert input).
 */
export function isValidSubdomainFormat(subdomain: unknown): boolean {
  if (typeof subdomain !== "string") return false;
  if (
    subdomain.length < SUBDOMAIN_MIN_LENGTH ||
    subdomain.length > SUBDOMAIN_MAX_LENGTH
  ) {
    return false;
  }
  // Min 3 tegn: start-bokstav/siffer + 1-28 mellom-tegn + slutt-bokstav/siffer.
  return /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(subdomain);
}

/**
 * Sjekker om subdomenet er reservert. Forutsetter at input allerede er
 * lowercase trimmet — vi normaliserer defensivt likevel.
 *
 * Logikk:
 *   1. Eksakt match i `RESERVED_SUBDOMAINS` → reservert
 *   2. Ender med `-admin` → reservert KUN HVIS `allowAdminSuffix === false`
 *      (B2B-provisjonering bruker `<prefix>-admin` per D-038 + Mike-spek
 *      2026-06-02 — admin må kunne opprette `am-admin` for "Advokatfirma AM".
 *      Selvbetjent B2C-registrering har `allowAdminSuffix: false` → blokkert
 *      som før.)
 *
 * Returnerer true hvis reservert.
 */
export function isReservedSubdomain(
  subdomain: string,
  opts: { allowAdminSuffix?: boolean } = {},
): boolean {
  const normalized = subdomain.toLowerCase().trim();
  if (RESERVED_SUBDOMAINS.has(normalized)) return true;
  if (!opts.allowAdminSuffix && normalized.endsWith("-admin")) return true;
  return false;
}

/**
 * Klassifisering av hvorfor et subdomene ikke er tilgjengelig.
 */
export type SubdomainAvailability =
  | { available: true }
  | { available: false; reason: "invalid_format" | "reserved" | "taken" };

/**
 * Async tilgjengelighets-sjekk. `opts.allowAdminSuffix === true` lar
 * admin opprette `*-admin`-subdomener (B2B-bedrifts-admin per D-038).
 * Default `false` — selvbetjent B2C-registrering blokkerer `*-admin`.
 */
export async function isSubdomainAvailable(
  subdomain: string,
  opts: { allowAdminSuffix?: boolean; allowReservedPrefix?: boolean } = {},
): Promise<SubdomainAvailability> {
  const normalized = subdomain.toLowerCase().trim();
  if (!isValidSubdomainFormat(normalized)) {
    return { available: false, reason: "invalid_format" };
  }
  if (isReservedSubdomain(normalized, opts)) {
    return { available: false, reason: "reserved" };
  }
  // D-038 utvidet — sjekk B2B-prefikser (med mindre admin overrider for
  // bedrifts-egen oppretting av `<prefix>-<ansatt>`).
  if (!opts.allowReservedPrefix) {
    const prefixes = await getReservedPrefixes();
    if (startsWithReservedPrefix(normalized, prefixes)) {
      return { available: false, reason: "reserved" };
    }
  }
  const taken = await tenantExists(normalized);
  if (taken) {
    return { available: false, reason: "taken" };
  }
  return { available: true };
}
