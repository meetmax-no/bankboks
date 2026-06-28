/**
 * Ko | Do · Vault — v4.3 Iter 7.6 — Unit-tester for invite-types.ts (D-056)
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/invite-types.test.ts`
 *
 * Ren funksjonstest av buildInviteRecord + isInviteExpired (ingen Upstash).
 * Invite-store testes via integrasjon (curl mot deploy).
 */
import {
  buildInviteRecord,
  isInviteExpired,
  INVITE_TTL_DAYS,
  INVITE_TTL_SECONDS,
} from "../platform/invite-types";

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

// ─── buildInviteRecord ──────────────────────────────────────────────────
console.log("\nbuildInviteRecord — basis");
const r1 = buildInviteRecord({
  subdomain: "am-nils",
  parentTenant: "am",
});
assert(typeof r1.token === "string" && r1.token.length === 36, "token er UUID v4 (36 tegn)");
assert(r1.subdomain === "am-nils", "subdomain lowercase");
assert(r1.parentTenant === "am", "parentTenant lowercase");
assert(r1.email === null, "email defaulter til null");
assert(r1.firstName === null, "firstName defaulter til null");
assert(r1.lastName === null, "lastName defaulter til null");
assert(r1.locale === null, "locale defaulter til null");
assert(r1.usedAt === null, "usedAt defaulter til null");
assert(r1.status === "pending", "status = pending");
assert(r1.createdBy === "admin", "createdBy = admin");

console.log("\nbuildInviteRecord — case-normalisering");
const r2 = buildInviteRecord({
  subdomain: "  AM-NILS  ",
  parentTenant: "  AM  ",
  email: "  Nils@Example.NO  ",
});
assert(r2.subdomain === "am-nils", "subdomain trimmet + lowercase");
assert(r2.parentTenant === "am", "parentTenant trimmet + lowercase");
assert(r2.email === "nils@example.no", "email trimmet + lowercase");

console.log("\nbuildInviteRecord — TTL 7 dager");
const r3 = buildInviteRecord({ subdomain: "am-nils", parentTenant: "am" });
const created = new Date(r3.createdAt).getTime();
const expires = new Date(r3.expiresAt).getTime();
const diffDays = Math.round((expires - created) / (1000 * 60 * 60 * 24));
assert(diffDays === INVITE_TTL_DAYS, `expiresAt = createdAt + ${INVITE_TTL_DAYS}d (fikk ${diffDays}d)`);
assert(INVITE_TTL_SECONDS === 7 * 24 * 60 * 60, "INVITE_TTL_SECONDS = 7d");

console.log("\nbuildInviteRecord — tomme strenger");
const r4 = buildInviteRecord({
  subdomain: "am-kim",
  parentTenant: "am",
  email: "",
  firstName: "  ",
  lastName: "",
});
assert(r4.email === null, "tom email → null");
assert(r4.firstName === null, "whitespace firstName → null");
assert(r4.lastName === null, "tom lastName → null");

console.log("\nbuildInviteRecord — unike tokens");
const tokens = new Set<string>();
for (let i = 0; i < 100; i++) {
  tokens.add(buildInviteRecord({ subdomain: "am-x", parentTenant: "am" }).token);
}
assert(tokens.size === 100, "100 invite-records gir 100 unike tokens");

// ─── isInviteExpired ────────────────────────────────────────────────────
console.log("\nisInviteExpired");
const now = new Date("2026-06-15T12:00:00Z");

assert(
  isInviteExpired({ expiresAt: "2026-06-14T12:00:00Z" }, now),
  "i fortiden → expired",
);
assert(
  isInviteExpired({ expiresAt: "2026-06-15T12:00:00Z" }, now),
  "akkurat nå → expired (boundary)",
);
assert(
  !isInviteExpired({ expiresAt: "2026-06-15T12:00:01Z" }, now),
  "1 sek frem → ikke expired",
);
assert(
  !isInviteExpired({ expiresAt: "2026-06-22T12:00:00Z" }, now),
  "7 dager frem → ikke expired",
);

// ─── Resultat ───────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
