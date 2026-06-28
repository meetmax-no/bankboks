/**
 * Ko | Do · Vault — v4.3 Iter 2 — Unit-tester for subdomain.ts
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/subdomain.test.ts`
 *
 * Mocker `tenantExists` via module-injection slik at testene kjøres uten
 * sentral Upstash. Dette holder testene rene og deterministiske —
 * tenant-store sine egne integrasjons-tester (manuell curl mot prod) dekker
 * Upstash-laget separat.
 */

import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_MAX_LENGTH,
  isReservedSubdomain,
  isValidSubdomainFormat,
  startsWithReservedPrefix,
} from "../platform/subdomain";

// ─── Helpers ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

// ─── isValidSubdomainFormat ─────────────────────────────────────────────
console.log("\nisValidSubdomainFormat — gyldige verdier");
assert(isValidSubdomainFormat("terje"), "vanlig navn 'terje'");
assert(isValidSubdomainFormat("abc"), "3 tegn 'abc' (minimum)");
assert(isValidSubdomainFormat("a12"), "3 tegn alfanumerisk 'a12'");
assert(isValidSubdomainFormat("lisbeth-k"), "bindestrek 'lisbeth-k'");
assert(isValidSubdomainFormat("co1-foo2-bar3"), "flere bindestreker");
assert(isValidSubdomainFormat("a".repeat(30)), "30 tegn (maks)");

console.log("\nisValidSubdomainFormat — ugyldige verdier");
assert(!isValidSubdomainFormat(""), "tom streng");
assert(!isValidSubdomainFormat("a"), "1 tegn 'a' (under minimum 3)");
assert(!isValidSubdomainFormat("am"), "2 tegn 'am' (under minimum 3)");
assert(!isValidSubdomainFormat("a".repeat(31)), "31 tegn (over maks)");
assert(!isValidSubdomainFormat("TERJE"), "uppercase 'TERJE'");
assert(!isValidSubdomainFormat("Terje"), "blandet case 'Terje'");
assert(!isValidSubdomainFormat("-foo"), "starter med bindestrek '-foo'");
assert(!isValidSubdomainFormat("foo-"), "slutter med bindestrek 'foo-'");
assert(!isValidSubdomainFormat("foo.bar"), "punktum 'foo.bar'");
assert(!isValidSubdomainFormat("foo_bar"), "underscore 'foo_bar'");
assert(!isValidSubdomainFormat("foo bar"), "mellomrom 'foo bar'");
assert(!isValidSubdomainFormat("æøå"), "norske tegn 'æøå'");
assert(!isValidSubdomainFormat(null as unknown as string), "null");
assert(!isValidSubdomainFormat(undefined as unknown as string), "undefined");
assert(!isValidSubdomainFormat(123 as unknown as string), "number");

// ─── isReservedSubdomain ────────────────────────────────────────────────
console.log("\nisReservedSubdomain — eksakte reserverte");
assert(isReservedSubdomain("admin"), "admin");
assert(isReservedSubdomain("api"), "api");
assert(isReservedSubdomain("www"), "www");
assert(isReservedSubdomain("kodovault"), "kodovault");
assert(isReservedSubdomain("vault"), "vault");
assert(isReservedSubdomain("mike"), "mike");
assert(isReservedSubdomain("michael"), "michael");
assert(isReservedSubdomain("pay"), "pay (fra utvidelsen)");
assert(isReservedSubdomain("docs"), "docs (fra utvidelsen)");
assert(isReservedSubdomain("blog"), "blog (fra utvidelsen)");
assert(isReservedSubdomain("cdn"), "cdn (fra utvidelsen)");
assert(isReservedSubdomain("mx"), "mx (fra utvidelsen)");

console.log("\nisReservedSubdomain — case-insensitive + trim");
assert(isReservedSubdomain("ADMIN"), "uppercase 'ADMIN'");
assert(isReservedSubdomain("Admin"), "capitalize 'Admin'");
assert(isReservedSubdomain("  admin  "), "med whitespace '  admin  '");

console.log("\nisReservedSubdomain — *-admin mønster (B2C-default: reservert)");
assert(isReservedSubdomain("am-admin"), "am-admin (default = B2C → reservert)");
assert(isReservedSubdomain("hansen-admin"), "hansen-admin");
assert(isReservedSubdomain("acme-corp-admin"), "acme-corp-admin");
assert(isReservedSubdomain("x-admin"), "x-admin (1-tegns prefix)");

console.log("\nisReservedSubdomain — *-admin mønster (B2B: tillatt)");
assert(
  !isReservedSubdomain("am-admin", { allowAdminSuffix: true }),
  "am-admin med allowAdminSuffix → IKKE reservert (B2B-bedrifts-admin)",
);
assert(
  !isReservedSubdomain("hansen-admin", { allowAdminSuffix: true }),
  "hansen-admin med allowAdminSuffix → IKKE reservert",
);
assert(
  isReservedSubdomain("admin", { allowAdminSuffix: true }),
  "admin (eksakt match) → reservert selv med allowAdminSuffix",
);

console.log("\nstartsWithReservedPrefix — B2B prefiks-blokkering");
assert(
  startsWithReservedPrefix("am-nils", ["am"]),
  "am-nils starter med am- → blokkert",
);
assert(
  startsWithReservedPrefix("acme-anna", ["am", "acme"]),
  "acme-anna mot flere prefikser → blokkert",
);
assert(
  !startsWithReservedPrefix("amanda", ["am"]),
  "amanda starter ikke med am- → IKKE blokkert (kritisk!)",
);
assert(
  !startsWithReservedPrefix("am", ["am"]),
  "am eksakt match (uten bindestrek etter) → IKKE blokkert av prefiks-regel",
);
assert(
  !startsWithReservedPrefix("foobar", ["am", "acme"]),
  "foobar mot urelaterte prefikser → IKKE blokkert",
);
assert(
  !startsWithReservedPrefix("am-nils", []),
  "tom prefiks-liste → ingenting blokkert",
);
assert(
  !startsWithReservedPrefix("am-nils", [""]),
  "tom streng som prefiks ignoreres → IKKE blokkert",
);

console.log("\nisReservedSubdomain — ikke reservert");
assert(!isReservedSubdomain("terje"), "terje (vanlig navn)");
assert(!isReservedSubdomain("lisbeth"), "lisbeth");
assert(!isReservedSubdomain("admin-foo"), "admin-foo (admin er prefix, ikke suffix)");
assert(!isReservedSubdomain("administrator"), "administrator (ikke eksakt match)");
assert(!isReservedSubdomain("acme"), "acme (vanlig firma)");
assert(!isReservedSubdomain("am"), "am (B2B-prefix uten -admin-suffix)");

// ─── Sanity: hele listen er lowercase ───────────────────────────────────
console.log("\nRESERVED_SUBDOMAINS — sanity");
let allLowercase = true;
for (const s of RESERVED_SUBDOMAINS) {
  if (s !== s.toLowerCase()) {
    allLowercase = false;
    break;
  }
}
assert(allLowercase, "alle reserverte er lowercase");
assert(RESERVED_SUBDOMAINS.size >= 30, `liste har ${RESERVED_SUBDOMAINS.size} entries (≥ 30)`);
assert(SUBDOMAIN_MAX_LENGTH === 30, "SUBDOMAIN_MAX_LENGTH = 30");

// ─── Resultat ───────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
