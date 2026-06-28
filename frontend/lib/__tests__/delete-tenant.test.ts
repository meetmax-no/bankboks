/**
 * Ko | Do · Vault — delete-tenant — minimal type/shape-tester
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/delete-tenant.test.ts`
 *
 * Strategi:
 *   Kaskade-funksjonen `deleteTenant` orkestrerer 5 lavnivå-helpers
 *   (Vercel + Upstash + central-DB + client-config + B2B-prefiks). Hver
 *   helper har sine egne tester (iter8.test.ts, iter9.test.ts). Denne
 *   filen verifiserer KUN at kaskaden:
 *     - eksporterer riktig type-signatur (DeleteResult-shape)
 *     - returnerer success=false når record ikke finnes
 *     - logger feilen i errors[] ved manglende record (idempotensesjekk)
 *
 *   Full integrasjon testes e2e i admin-UI mot ekte test-tenant.
 *
 * Vi mocker @upstash/redis ved å sette CENTRAL_KV-env-vars til verdier
 * som peker på en lokal in-memory mock. tenant-store leser dem ved første
 * getCentralRedis()-kall.
 */

// Mock @upstash/redis FØR vi importerer noe annet som leser env-vars.
const mockStore = new Map<string, unknown>();
const mockSet = new Set<string>();

import { Module } from "node:module";
const originalResolve = Module.prototype.require;
type RedisLike = {
  get: <T>(k: string) => Promise<T | null>;
  set: (k: string, v: unknown) => Promise<"OK">;
  del: (k: string) => Promise<number>;
  exists: (k: string) => Promise<0 | 1>;
  sadd: (k: string, ...v: string[]) => Promise<number>;
  srem: (k: string, ...v: string[]) => Promise<number>;
  smembers: (k: string) => Promise<string[]>;
  pipeline: () => { get: (k: string) => unknown; exec: () => Promise<unknown[]> };
};

const fakeRedis: RedisLike = {
  async get<T>(k: string) {
    return (mockStore.get(k) ?? null) as T | null;
  },
  async set(k: string, v: unknown) {
    mockStore.set(k, v);
    return "OK";
  },
  async del(k: string) {
    return mockStore.delete(k) ? 1 : 0;
  },
  async exists(k: string) {
    return mockStore.has(k) ? 1 : 0;
  },
  async sadd(_k: string, ...v: string[]) {
    let added = 0;
    for (const item of v) {
      if (!mockSet.has(item)) {
        mockSet.add(item);
        added += 1;
      }
    }
    return added;
  },
  async srem(_k: string, ...v: string[]) {
    let removed = 0;
    for (const item of v) {
      if (mockSet.delete(item)) removed += 1;
    }
    return removed;
  },
  async smembers(_k: string) {
    return Array.from(mockSet);
  },
  pipeline() {
    const ops: string[] = [];
    return {
      get(k: string) {
        ops.push(k);
        return this;
      },
      async exec() {
        return ops.map((k) => mockStore.get(k) ?? null);
      },
    };
  },
};

// Override require for @upstash/redis så getCentralRedis() får mock.
(Module.prototype as unknown as { require: typeof originalResolve }).require =
  function (this: NodeJS.Module, id: string) {
    if (id === "@upstash/redis") {
      return { Redis: function () { return fakeRedis; } };
    }
    return originalResolve.call(this, id);
  } as typeof originalResolve;

// Sett env-vars som kreves av central-upstash.ts + tenant-crypto.ts
process.env.CENTRAL_KV_REST_API_URL = "https://mock.upstash.io";
process.env.CENTRAL_KV_REST_API_TOKEN = "mock-token";
// 64 hex (32 bytes) — gyldig AES-256-key
process.env.CENTRAL_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

// Dynamic import skjer inne i runTests(), etter at mocking er på plass.

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

async function runTests() {
  const { deleteTenant } = await import("../platform/delete-tenant");
  // ─── Test 1: record ikke funnet ───────────────────────────────────────
  console.log("\ndeleteTenant — record ikke funnet (idempotens)");
  const result = await deleteTenant("ikke-eksisterer", "admin");

  assert(result.success === false, "success=false når record mangler");
  assert(
    result.errors.length > 0,
    "errors[] inneholder en notis om at record mangler",
  );
  assert(
    result.errors[0].includes("ikke-eksisterer"),
    "errors-meldingen inneholder subdomain-navnet",
  );
  assert(result.steps.vercel === "skipped", "Vercel-steg = skipped");
  assert(result.steps.upstash === "skipped", "Upstash-steg = skipped");
  assert(result.steps.centralDb === "skipped", "centralDb-steg = skipped");
  assert(result.steps.clientConfig === "skipped", "clientConfig-steg = skipped");
  assert(result.steps.b2bPrefix === "skipped", "b2bPrefix-steg = skipped");

  // ─── Test 2: shape av returverdi ──────────────────────────────────────
  console.log("\ndeleteTenant — type-shape av DeleteResult");
  assert(
    typeof result.success === "boolean",
    "success er boolean",
  );
  assert(Array.isArray(result.errors), "errors er array");
  assert(
    typeof result.steps === "object" && result.steps !== null,
    "steps er objekt",
  );
  const stepKeys = Object.keys(result.steps).sort();
  const expectedKeys = [
    "adminNotes",
    "b2bPrefix",
    "centralDb",
    "clientConfig",
    "invites",
    "mpw",
    "orgAdmins",
    "stripe",
    "upstash",
    "vercel",
  ];
  assert(
    JSON.stringify(stepKeys) === JSON.stringify(expectedKeys),
    `steps har eksakt 10 felter: ${expectedKeys.join(", ")}`,
  );

  // ─── Test 2b: meta-shape ──────────────────────────────────────────────
  assert(
    typeof result.meta === "object" && result.meta !== null,
    "meta er objekt",
  );
  const metaKeys = Object.keys(result.meta).sort();
  assert(
    JSON.stringify(metaKeys) ===
      JSON.stringify(["adminNotesDeleted", "invitesDeleted", "orgAdminsDeleted"]),
    "meta har 3 felter: adminNotesDeleted, invitesDeleted, orgAdminsDeleted",
  );

  // ─── Test 3: context-parameter aksepteres ─────────────────────────────
  console.log("\ndeleteTenant — context-parameter (admin/cron/gdpr)");
  const r1 = await deleteTenant("ikke-eksisterer", "cron");
  const r2 = await deleteTenant("ikke-eksisterer", "gdpr");
  assert(r1.success === false, "context='cron' aksepteres");
  assert(r2.success === false, "context='gdpr' aksepteres");

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────");
  console.log(`${passed} bestått · ${failed} feilet`);
  if (failed > 0) {
    console.log("\nFeilede tester:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("Alle delete-tenant-tester bestått.");
}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
