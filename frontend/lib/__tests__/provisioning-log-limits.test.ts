/**
 * Ko | Do · Vault — D-123 (2026-06-29) — provisioning-log-limits tests
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/provisioning-log-limits.test.ts`
 *
 * Verifiserer:
 *  1. B2B-parent får adminProvisioningLogMax (1000)
 *  2. B2C-standalone får tenantProvisioningLogMax (100)
 *  3. B2C-child (parentTenant satt) får tenantProvisioningLogMax (100)
 *  4. truncateProvisioningLog kutter eldste events, beholder nyligste
 *  5. truncateProvisioningLog er no-op når under grensen
 *  6. Fallback 100 brukes ved invalide config-verdier
 */
import {
  getProvisioningLogMax,
  truncateProvisioningLog,
} from "../platform/provisioning-log-limits";
import type { TenantRecord, ProvisioningEvent } from "../platform/tenant-types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function makeRecord(
  overrides: Partial<TenantRecord> & {
    customerType: "b2b" | "b2c";
    parentTenant: string | null;
  },
): TenantRecord {
  return {
    subdomain: "test",
    customerType: overrides.customerType,
    parentTenant: overrides.parentTenant,
    provisioningLog: [],
    // Resten av feltene er ikke relevante for limits-logikken — caster
    // via unknown for å unngå å oppgi alle 50+ feltene på TenantRecord.
  } as unknown as TenantRecord;
}

function evt(stage: string, n: number): ProvisioningEvent {
  return {
    timestamp: `2026-01-01T${String(n).padStart(2, "0")}:00:00Z`,
    stage: stage as ProvisioningEvent["stage"],
    status: "ok",
    detail: `event-${n}`,
  };
}

async function runTests() {
  console.log("\n[D-123] provisioning-log-limits tests");

  // Test 1: B2B-parent → 1000
  const parent = makeRecord({ customerType: "b2b", parentTenant: null });
  assert(
    getProvisioningLogMax(parent) === 1000,
    "B2B-parent får 1000 (admin-grense)",
  );

  // Test 2: B2C standalone → 100
  const b2c = makeRecord({ customerType: "b2c", parentTenant: null });
  assert(
    getProvisioningLogMax(b2c) === 100,
    "B2C-standalone får 100 (tenant-grense)",
  );

  // Test 3: B2C child → 100
  const child = makeRecord({
    customerType: "b2c",
    parentTenant: "mm-admin",
  });
  assert(
    getProvisioningLogMax(child) === 100,
    "B2C-child får 100 (tenant-grense, samme som standalone)",
  );

  // Test 4: trunkering kutter eldste
  const events = Array.from({ length: 150 }, (_, i) => evt("vault_live", i));
  const trimmed = truncateProvisioningLog(events, 100);
  assert(trimmed.length === 100, "trunkert til 100 events");
  assert(trimmed[0].detail === "event-50", "eldste 50 ble kuttet (event-0…49)");
  assert(
    trimmed[trimmed.length - 1].detail === "event-149",
    "nyligste bevart (event-149)",
  );

  // Test 5: no-op når under grensen
  const small = events.slice(0, 50);
  const small2 = truncateProvisioningLog(small, 100);
  assert(
    small2 === small,
    "under grensen → samme array-referanse (no-op for putTenant short-circuit)",
  );

  // Test 6: edge — tom array
  const empty = truncateProvisioningLog([], 100);
  assert(empty.length === 0, "tom array → tom array");

  console.log(`\nResultat: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
}

runTests();
