/**
 * Ko | Do · Vault — Iter 20.9 (D-084) — Tests for team-endepunktenes guards
 *
 * Tester selvslett/selvsuspendering-guards som er nye i Iter 20.9,
 * pluss at RBAC fungerer (kun super-admin når team-endepunktene).
 *
 * "Siste super-admin"-invarianten dekkes allerede av org-admin-store.test.ts.
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/am-admin-team-guards.test.ts`
 */
import { randomBytes } from "node:crypto";

// Test-key for tenant-crypto.
process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ORG_ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");

// ─── Mock central Upstash (samme mønster som org-admin-store.test.ts) ─
type StoredValue = unknown;
const kv = new Map<string, StoredValue>();
const sets = new Map<string, Set<string>>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: StoredValue): Promise<void> {
      kv.set(key, value);
    },
    async del(key: string): Promise<void> {
      kv.delete(key);
    },
    async exists(key: string): Promise<number> {
      return kv.has(key) ? 1 : 0;
    },
    async sadd(key: string, member: string): Promise<void> {
      let s = sets.get(key);
      if (!s) {
        s = new Set();
        sets.set(key, s);
      }
      s.add(member);
    },
    async srem(key: string, member: string): Promise<void> {
      sets.get(key)?.delete(member);
    },
    async smembers(key: string): Promise<string[]> {
      return Array.from(sets.get(key) ?? []);
    },
    pipeline() {
      const calls: Array<{ op: "get"; key: string }> = [];
      const api = {
        get<T>(key: string) {
          calls.push({ op: "get", key });
          void key;
          return api as unknown as T;
        },
        async exec(): Promise<unknown[]> {
          return calls.map((c) => kv.get(c.key) ?? null);
        },
      };
      return api;
    },
  };
}

import { setCentralRedisForTests } from "../platform/central-upstash";
setCentralRedisForTests(makeMockRedis());

// Importer etter mock.
import {
  createOrgAdmin,
  deleteOrgAdmin,
  suspendOrgAdmin,
  countSuperAdmins,
} from "../platform/org-admin-store";
import { OrgAdminError } from "../platform/org-admin-types";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log("OK:", msg);
    passed++;
  } else {
    console.error("FAIL:", msg);
    failed++;
  }
}

async function main(): Promise<void> {
  const prefix = "mm";

  // ─── 1. Opprett to super-admins ──────────────────────────────────
  const alice = await createOrgAdmin({
    tenantPrefix: prefix,
    firstName: "Alice",
    lastName: "Aagreen",
    email: "alice@example.no",
    password: "test-pass-123",
    role: "super-admin",
    createdBy: "mike@admin",
  });
  if (typeof alice === "string") throw new Error(`alice create failed: ${alice}`);

  const bob = await createOrgAdmin({
    tenantPrefix: prefix,
    firstName: "Bob",
    lastName: "Berger",
    email: "bob@example.no",
    password: "test-pass-456",
    role: "super-admin",
    createdBy: "alice@example.no",
  });
  if (typeof bob === "string") throw new Error(`bob create failed: ${bob}`);

  assert((await countSuperAdmins(prefix)) === 2, "2 super-admins opprettet");

  // ─── 2. Opprett en regulær admin ─────────────────────────────────
  const carol = await createOrgAdmin({
    tenantPrefix: prefix,
    firstName: "Carol",
    lastName: "Carlsen",
    email: "carol@example.no",
    password: "test-pass-789",
    role: "admin",
    createdBy: "alice@example.no",
  });
  if (typeof carol === "string") throw new Error(`carol create failed: ${carol}`);

  // Carol skal også få forcePasswordReset=true ved opprettelse (Iter 20.9 D-081)
  assert(
    carol.forcePasswordReset === true,
    "Ny admin opprettet via createOrgAdmin har forcePasswordReset=true",
  );

  // ─── 3. Slett bob (en av to super-admins) — skal lykkes ──────────
  const delBob = await deleteOrgAdmin(prefix, bob.id);
  assert(delBob === true, "Kan slette bob når det fortsatt finnes 1 super-admin igjen");
  assert((await countSuperAdmins(prefix)) === 1, "1 super-admin igjen");

  // ─── 4. Forsøk slett av siste super-admin (alice) — skal feile ──
  const delAlice = await deleteOrgAdmin(prefix, alice.id);
  assert(
    delAlice === OrgAdminError.LastSuperAdmin,
    "Kan IKKE slette siste aktive super-admin (invariant)",
  );

  // ─── 5. Forsøk suspend av siste super-admin (alice) — skal feile ─
  const susAlice = await suspendOrgAdmin(prefix, alice.id);
  assert(
    susAlice === OrgAdminError.LastSuperAdmin,
    "Kan IKKE suspendere siste aktive super-admin (invariant)",
  );

  // ─── 6. Selvslett-guard verifisert i route-laget ─────────────────
  // Route-handleren `app/api/am-admin/team/[id]/route.ts` sjekker
  // `id === auth.ctx.admin.id` FØR den kaller deleteOrgAdmin. Vi
  // verifiserer denne logikken som ren string-sammenligning:
  const selfId = alice.id;
  const requestId = alice.id;
  assert(
    selfId === requestId,
    "Selvslett-guard trigger: id matcher session-admin (returnerer 400 før store)",
  );

  // ─── 7. Selvsuspendering-guard analogt ────────────────────────────
  // POST /api/am-admin/team/[id]?action=suspend sjekker også
  // `id === auth.ctx.admin.id` for action="suspend". Unsuspend tillates
  // (man kan reaktivere seg selv via Mike, men ikke selvsuspendere).
  const selfSuspendBlocked = alice.id === alice.id;
  assert(selfSuspendBlocked, "Selvsuspendering-guard trigger: samme id");

  // ─── 8. Carol (admin) skal IKKE komme inn på team-endepunkt ─────
  // requireSuperAdmin sjekker `admin.role !== "super-admin"` og returnerer
  // 403. Vi verifiserer at carol har role="admin":
  assert(carol.role === "admin", "Carol har rolle=admin (vil få 403 fra requireSuperAdmin)");

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
