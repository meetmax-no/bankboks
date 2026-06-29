/**
 * Ko | Do · Vault — D-127 (2026-02) — Strukturert pricing-test
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/pricing-structured.test.ts`
 *
 * Verifiserer det nye nested formatet:
 *   - `pricing.b2c.{monthly, yearly, trialDays}` leses av getPricing/getTrialDays
 *   - `pricing.b2b.{semiannualPerSeat, yearlyPerSeat, trialDays}` leses av getB2BPricing
 *   - Bakoverkomp: legacy flat `pricing.monthly` leses fortsatt hvis nested mangler
 *   - Per-felt fallback over begge formater
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
  const { getTrialDays, getPricing, getB2BPricing, putClientConfig } =
    await import("../platform/client-config-store");

  // ─── Test 1: default.json B2C nested struktur ───────────────────────
  console.log("\nTest 1: default.json → pricing.b2c.{monthly,yearly,trialDays}");
  mockStore.clear();
  const p1 = await getPricing("noone");
  assert(p1.monthly === 115, `default.b2c.monthly=115 (fikk ${p1.monthly})`);
  assert(p1.yearly === 1104, `default.b2c.yearly=1104 (fikk ${p1.yearly})`);
  assert(p1.currency === "kr", `default.currency=kr (fikk ${p1.currency})`);
  assert(p1.trialDays === 0, `default.b2c.trialDays=0 (fikk ${p1.trialDays})`);

  // ─── Test 2: default.json B2B nested struktur ───────────────────────
  console.log("\nTest 2: default.json → pricing.b2b.{semiannualPerSeat,yearlyPerSeat,trialDays}");
  mockStore.clear();
  const b1 = await getB2BPricing("noone");
  assert(
    b1.semiannualPerSeat === 522,
    `default.b2b.semiannualPerSeat=522 (fikk ${b1.semiannualPerSeat})`,
  );
  assert(
    b1.yearlyPerSeat === 1044,
    `default.b2b.yearlyPerSeat=1044 (fikk ${b1.yearlyPerSeat})`,
  );
  assert(b1.trialDays === 0, `default.b2b.trialDays=0 (fikk ${b1.trialDays})`);

  // ─── Test 3: nytt nested tenant-override (B2C) ──────────────────────
  console.log("\nTest 3: tenant nested pricing.b2c override vinner");
  mockStore.clear();
  await putClientConfig("nestedb2c", {
    pricing: {
      currency: "EUR",
      b2c: { monthly: 9, yearly: 99, trialDays: 14 },
    },
  });
  const p3 = await getPricing("nestedb2c");
  assert(p3.monthly === 9, `tenant.b2c.monthly=9 (fikk ${p3.monthly})`);
  assert(p3.yearly === 99, `tenant.b2c.yearly=99 (fikk ${p3.yearly})`);
  assert(p3.currency === "EUR", `tenant.currency=EUR (fikk ${p3.currency})`);
  assert(p3.trialDays === 14, `tenant.b2c.trialDays=14 (fikk ${p3.trialDays})`);

  // ─── Test 4: nested tenant-override (B2B) ───────────────────────────
  console.log("\nTest 4: tenant nested pricing.b2b override vinner");
  mockStore.clear();
  await putClientConfig("nestedb2b", {
    pricing: {
      b2b: { semiannualPerSeat: 300, yearlyPerSeat: 600, trialDays: 45 },
    },
  });
  const b4 = await getB2BPricing("nestedb2b");
  assert(
    b4.semiannualPerSeat === 300,
    `tenant.b2b.semiannualPerSeat=300 (fikk ${b4.semiannualPerSeat})`,
  );
  assert(
    b4.yearlyPerSeat === 600,
    `tenant.b2b.yearlyPerSeat=600 (fikk ${b4.yearlyPerSeat})`,
  );
  assert(b4.trialDays === 45, `tenant.b2b.trialDays=45 (fikk ${b4.trialDays})`);

  // ─── Test 5: bakoverkompatibilitet — flat legacy format ─────────────
  console.log("\nTest 5: legacy flat format leses fortsatt");
  mockStore.clear();
  await putClientConfig("legacy", {
    pricing: { monthly: 200, yearly: 2000, currency: "USD", trialDays: 7 },
  });
  const p5 = await getPricing("legacy");
  assert(p5.monthly === 200, `legacy.monthly=200 (fikk ${p5.monthly})`);
  assert(p5.yearly === 2000, `legacy.yearly=2000 (fikk ${p5.yearly})`);
  assert(p5.currency === "USD", `legacy.currency=USD (fikk ${p5.currency})`);
  assert(p5.trialDays === 7, `legacy.trialDays=7 (fikk ${p5.trialDays})`);

  // ─── Test 6: getTrialDays leser fra nested ──────────────────────────
  console.log("\nTest 6: getTrialDays leser b2c.trialDays");
  mockStore.clear();
  await putClientConfig("trial", {
    pricing: { b2c: { trialDays: 21 } },
  });
  const d6 = await getTrialDays("trial");
  assert(d6 === 21, `b2c.trialDays=21 leses (fikk ${d6})`);

  // ─── Test 7: B2B ugyldig verdi (negativ) → faller til default ───────
  console.log("\nTest 7: tenant.b2b.semiannualPerSeat=-1 forkastes");
  mockStore.clear();
  await putClientConfig("badb2b", {
    pricing: { b2b: { semiannualPerSeat: -1, yearlyPerSeat: 800 } },
  });
  const b7 = await getB2BPricing("badb2b");
  assert(
    b7.semiannualPerSeat === 522,
    `negativ forkastet → default 522 (fikk ${b7.semiannualPerSeat})`,
  );
  assert(
    b7.yearlyPerSeat === 800,
    `gyldig yearlyPerSeat=800 beholdt (fikk ${b7.yearlyPerSeat})`,
  );

  // ─── Test 8: B2B trialDays > 365 → faller til default ───────────────
  console.log("\nTest 8: tenant.b2b.trialDays=999 forkastes");
  mockStore.clear();
  await putClientConfig("trialcap", {
    pricing: { b2b: { trialDays: 999 } },
  });
  const b8 = await getB2BPricing("trialcap");
  assert(b8.trialDays === 0, `999 forkastet → default 0 (fikk ${b8.trialDays})`);

  // ─── Test 9: per-felt fallback over nested+default ──────────────────
  console.log("\nTest 9: tenant.b2c.yearly satt, andre felter fra default");
  mockStore.clear();
  await putClientConfig("partial", {
    pricing: { b2c: { yearly: 555 } },
  });
  const p9 = await getPricing("partial");
  assert(p9.yearly === 555, `tenant.b2c.yearly=555 (fikk ${p9.yearly})`);
  assert(p9.monthly === 115, `default.b2c.monthly=115 (fikk ${p9.monthly})`);
  assert(p9.trialDays === 0, `default.b2c.trialDays=0 (fikk ${p9.trialDays})`);
  assert(p9.currency === "kr", `default.currency=kr (fikk ${p9.currency})`);

  // ─── Test 10: nested har prioritet OVER flat hvis begge er satt ─────
  console.log("\nTest 10: nested b2c vinner over flat legacy hvis begge eksisterer");
  mockStore.clear();
  await putClientConfig("mixed", {
    pricing: {
      monthly: 999, // legacy flat — skal IKKE vinne
      b2c: { monthly: 50 }, // nytt nested — vinner
    },
  });
  const p10 = await getPricing("mixed");
  assert(
    p10.monthly === 50,
    `nested b2c.monthly=50 vinner over flat 999 (fikk ${p10.monthly})`,
  );

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`D-127 strukturert pricing — ${passed} passed, ${failed} failed`);
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
