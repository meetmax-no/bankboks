/**
 * Ko | Do · Vault — D-076 tenant-status-cache + write-block tester
 *
 * Tester rene funksjoner (subdomain-parsing). Cache + RPC krever Redis
 * + admin-endepunkt og testes E2E i prod-deploy.
 *
 * Kjør: tsx lib/__tests__/tenant-status-cache.test.ts
 */
import { subdomainFromHost } from "../server/tenant-status-cache";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ ${msg}`);
    failed++;
  }
}

console.log("\n— subdomainFromHost —");

// Gyldige tenant-subdomener
assert(
  subdomainFromHost("terje.kodovault.no") === "terje",
  "terje.kodovault.no → 'terje'",
);
assert(
  subdomainFromHost("terje.kodovault.no:443") === "terje",
  "med port: terje.kodovault.no:443 → 'terje'",
);
assert(
  subdomainFromHost("ABC-123.kodovault.no") === "abc-123",
  "case-insensitive: ABC-123.kodovault.no → 'abc-123'",
);
assert(
  subdomainFromHost("mikemax.kodovault.no") === "mikemax",
  "mikemax.kodovault.no → 'mikemax'",
);

// Staging vercel.app-pattern (hvis brukt)
assert(
  subdomainFromHost("terje.kodovault.vercel.app") === "terje",
  "vercel-staging: terje.kodovault.vercel.app → 'terje'",
);

// Skal IKKE matche
assert(
  subdomainFromHost("admin.kodovault.no") === "admin",
  "admin er teknisk sett et 'subdomain' — fanges av regex (riktig oppførsel)",
);
assert(
  subdomainFromHost("kodovault.no") === null,
  "root-domain → null",
);
assert(
  subdomainFromHost("localhost") === null,
  "localhost → null",
);
assert(
  subdomainFromHost("localhost:3000") === null,
  "localhost:3000 → null",
);
assert(
  subdomainFromHost("example.com") === null,
  "annet domene → null",
);
assert(
  subdomainFromHost(null) === null,
  "null-input → null",
);
assert(
  subdomainFromHost("") === null,
  "tom string → null",
);

// Ugyldige subdomain-formater (men matcher regex)
assert(
  subdomainFromHost("ab.kodovault.no") === null,
  "for kort (2 tegn) → null",
);
assert(
  subdomainFromHost("-terje.kodovault.no") === null,
  "starter med dash → null",
);
assert(
  subdomainFromHost("terje-.kodovault.no") === null,
  "slutter med dash → null",
);

console.log(`\n${passed} bestått · ${failed} feilet`);
if (failed > 0) {
  console.error("\n✗ Tenant-status-cache tester feilet.");
  process.exit(1);
}
console.log("Alle tester bestått.\n");
