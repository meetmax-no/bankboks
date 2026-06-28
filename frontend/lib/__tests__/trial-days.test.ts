/**
 * Ko | Do · Vault — v4.3 — Test for getTrialDays() (config-drevet trial-periode)
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/trial-days.test.ts`
 *
 * Lookup-prioritet:
 *   1. Tenantens client-config i Upstash
 *   2. default.json
 *   3. Hardkodet 30
 */
import { Module } from "node:module";

const originalRequire = Module.prototype.require;

const mockStore = new Map<string, unknown>();
const fakeRedis = {
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
};

(Module.prototype as unknown as { require: typeof originalRequire }).require =
  function (this: NodeJS.Module, id: string) {
    if (id === "@upstash/redis") {
      return { Redis: function () { return fakeRedis; } };
    }
    return originalRequire.call(this, id);
  } as typeof originalRequire;

process.env.CENTRAL_KV_REST_API_URL = "https://mock.upstash.io";
process.env.CENTRAL_KV_REST_API_TOKEN = "mock-token";

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
  const { getTrialDays, getPricing, putClientConfig, deleteClientConfig } = await import(
    "../platform/client-config-store"
  );

  // ─── Test 1: per-tenant override leses (pricing.trialDays) ──────────
  console.log("\nTest 1: tenant-spesifikk pricing.trialDays vinner");
  mockStore.clear();
  await putClientConfig("alice", { pricing: { trialDays: 14 }, brand: { name: "x" } });
  const d1 = await getTrialDays("alice");
  assert(d1 === 14, `trialDays=14 fra tenant-config (fikk ${d1})`);

  // ─── Test 2: ingen tenant-config → faller til default.json ─────────
  console.log("\nTest 2: ingen tenant-config → default.json pricing.trialDays brukes");
  mockStore.clear();
  const d2 = await getTrialDays("ghost");
  // default.json har pricing.trialDays: 0 (Mike satt det globalt 2026-06-06)
  assert(d2 === 0, `default.json gir trialDays=0 (fikk ${d2})`);

  // ─── Test 3: ugyldig verdi i tenant-config → faller til default ────
  console.log("\nTest 3: ugyldig verdi (-5) → faller til default.json");
  mockStore.clear();
  await putClientConfig("bob", { pricing: { trialDays: -5 } });
  const d3 = await getTrialDays("bob");
  assert(d3 === 0, `negativ verdi forkastet, fikk default ${d3}`);

  // ─── Test 4: 0 → akseptert (ingen trial) ──────────────────────────
  console.log("\nTest 4: trialDays=0 → akseptert (ingen trial, umiddelbar fakturering)");
  mockStore.clear();
  await putClientConfig("carol", { pricing: { trialDays: 0 } });
  const d4 = await getTrialDays("carol");
  assert(d4 === 0, `0 akseptert som 'ingen trial' (fikk ${d4})`);

  // ─── Test 5: > 365 → faller til default ────────────────────────────
  console.log("\nTest 5: 999 → faller til default (over 365-grense)");
  mockStore.clear();
  await putClientConfig("dave", { pricing: { trialDays: 999 } });
  const d5 = await getTrialDays("dave");
  assert(d5 === 0, `999 forkastet, fikk default ${d5}`);

  // ─── Test 6: string-verdi → faller til default ─────────────────────
  console.log("\nTest 6: string '30' → ikke tall, faller til default");
  mockStore.clear();
  await putClientConfig("eve", { pricing: { trialDays: "30" as unknown as number } });
  const d6 = await getTrialDays("eve");
  assert(d6 === 0, `string forkastet, fikk default ${d6}`);

  // ─── Test 7: gyldig verdi 7 ────────────────────────────────────────
  console.log("\nTest 7: trialDays=7 (kort prøveperiode)");
  mockStore.clear();
  await putClientConfig("frank", { pricing: { trialDays: 7 } });
  const d7 = await getTrialDays("frank");
  assert(d7 === 7, `trialDays=7 (fikk ${d7})`);

  // ─── Test 8: gyldig verdi 365 (kant) ───────────────────────────────
  console.log("\nTest 8: trialDays=365 (øvre kant)");
  mockStore.clear();
  await putClientConfig("grace", { pricing: { trialDays: 365 } });
  const d8 = await getTrialDays("grace");
  assert(d8 === 365, `365 godtatt, fikk ${d8}`);

  // ─── Test 9: 0 fjerning fra tenant → default igjen ─────────────────
  console.log("\nTest 9: tenant-config slettet → default.json igjen");
  mockStore.clear();
  await putClientConfig("hank", { pricing: { trialDays: 21 } });
  const dBefore = await getTrialDays("hank");
  await deleteClientConfig("hank");
  const dAfter = await getTrialDays("hank");
  assert(dBefore === 21, `før slett: 21 (fikk ${dBefore})`);
  assert(dAfter === 0, `etter slett: default 0 (fikk ${dAfter})`);

  // ─── Test 10: getPricing — full struktur fra default ────────────────
  console.log("\nTest 10: getPricing() returnerer full struktur");
  mockStore.clear();
  const p10 = await getPricing("ghost");
  assert(p10.monthly === 115, `default.monthly=115 (fikk ${p10.monthly})`);
  assert(p10.yearly === 1104, `default.yearly=1104 (fikk ${p10.yearly})`);
  assert(p10.currency === "kr", `default.currency=kr (fikk ${p10.currency})`);
  assert(p10.trialDays === 0, `default.trialDays=0 (fikk ${p10.trialDays})`);

  // ─── Test 11: getPricing — per-felt override ────────────────────────
  console.log("\nTest 11: per-felt override (bare yearly satt → andre fra default)");
  mockStore.clear();
  await putClientConfig("kari", { pricing: { yearly: 999 } });
  const p11 = await getPricing("kari");
  assert(p11.yearly === 999, `tenant.yearly=999 (fikk ${p11.yearly})`);
  assert(p11.monthly === 115, `default.monthly=115 (fikk ${p11.monthly})`);
  assert(p11.currency === "kr", `default.currency=kr (fikk ${p11.currency})`);
  assert(p11.trialDays === 0, `default.trialDays=0 (fikk ${p11.trialDays})`);

  // ─── Test 12: getPricing — full tenant-override ─────────────────────
  console.log("\nTest 12: full tenant-override (alle 4 felt satt)");
  mockStore.clear();
  await putClientConfig("anna", {
    pricing: { monthly: 199, yearly: 1990, currency: "USD", trialDays: 30 },
  });
  const p12 = await getPricing("anna");
  assert(p12.monthly === 199, `tenant.monthly=199 (fikk ${p12.monthly})`);
  assert(p12.yearly === 1990, `tenant.yearly=1990 (fikk ${p12.yearly})`);
  assert(p12.currency === "USD", `tenant.currency=USD (fikk ${p12.currency})`);
  assert(p12.trialDays === 30, `tenant.trialDays=30 (fikk ${p12.trialDays})`);

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`getTrialDays + getPricing — ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
