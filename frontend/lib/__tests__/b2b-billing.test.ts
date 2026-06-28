/**
 * Ko | Do · Vault — Iter 20.4 — Offline-tester for B2B fakturerings-fase
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/b2b-billing.test.ts`
 *
 * Strategi: ren pure-logic, ingen Upstash / Stripe. Bygger mock TenantRecord
 * og kaller `computeB2BBillingState(tenant, now)` med forskjellige tids-
 * scenarier. Verifiserer alle 7 faser + edge-cases.
 */
import { buildTenantRecord } from "../platform/tenant-types";
import {
  computeB2BBillingState,
  shouldBlockNewInvites,
  shouldShowEmployeeGraceToast,
  B2B_GRACE_DAYS,
} from "../platform/b2b-billing";
import type { TenantRecord } from "../platform/tenant-types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✓", msg);
}

const MS_DAY = 86_400_000;

function makeB2BParent(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const base = buildTenantRecord(
    {
      subdomain: "acme",
      email: "admin@acme.no",
      customerType: "b2b",
      tenantPrefix: "acme",
      maxLicenses: 10,
    },
    "admin",
  );
  return { ...base, ...overrides };
}

function makeB2BChild(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const base = buildTenantRecord(
    {
      subdomain: "acme-ola",
      email: "ola@acme.no",
      customerType: "b2b",
    },
    "invite",
  );
  return { ...base, parentTenant: "acme", ...overrides };
}

// ─── Test 1: B2C får alltid "n/a" ─────────────────────────────────────
function test1_b2c_returns_n_a() {
  console.log("\n▶ Test 1: B2C får alltid 'n/a'");
  const tenant = buildTenantRecord(
    { subdomain: "lars", email: "lars@example.no", customerType: "b2c" },
    "self",
  );
  const state = computeB2BBillingState(tenant, new Date());
  assert(state.phase === "n/a", "B2C → phase='n/a'");
}

// ─── Test 2: B2B child får "n/a" (kun parent har faktura) ─────────────
function test2_b2b_child_returns_n_a() {
  console.log("\n▶ Test 2: B2B child får 'n/a'");
  const child = makeB2BChild({ status: "active" });
  const state = computeB2BBillingState(child, new Date());
  assert(state.phase === "n/a", "B2B child → phase='n/a'");
}

// ─── Test 3: Trial-fase med dager igjen ───────────────────────────────
function test3_trial_phase() {
  console.log("\n▶ Test 3: Trial-fase");
  const now = new Date("2026-07-01T12:00:00Z");
  const trialEnd = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "trial",
    trialEndsAt: trialEnd.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "trial", "phase='trial'");
  assert(state.daysUntilTrialEnd === 14, `daysUntilTrialEnd=14, fikk ${state.daysUntilTrialEnd}`);
}

// ─── Test 4: Trial utløpt men ikke flippet → 0 dager ──────────────────
function test4_trial_expired_not_flipped() {
  console.log("\n▶ Test 4: Trial utløpt men ikke flippet");
  const now = new Date("2026-08-01T12:00:00Z");
  const trialEnd = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "trial",
    trialEndsAt: trialEnd.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "trial", "phase='trial' (cron har ikke kjørt ennå)");
  assert(state.daysUntilTrialEnd === 0, "daysUntilTrialEnd=0");
}

// ─── Test 5: Active uten nextBillingDate → phase='active' ─────────────
function test5_active_no_billing_date() {
  console.log("\n▶ Test 5: Active uten nextBillingDate");
  const parent = makeB2BParent({ status: "active", nextBillingDate: null });
  const state = computeB2BBillingState(parent, new Date());
  assert(state.phase === "active", "phase='active'");
  assert(state.daysUntilNextBilling === null, "daysUntilNextBilling=null");
}

// ─── Test 6: Active 14 dager fra neste faktura → "active" ─────────────
function test6_active_far_from_billing() {
  console.log("\n▶ Test 6: Active 14 dager fra neste faktura");
  const now = new Date("2026-07-01T12:00:00Z");
  const billing = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "active", "phase='active'");
  assert(state.daysUntilNextBilling === 14, `daysUntilNextBilling=14, fikk ${state.daysUntilNextBilling}`);
}

// ─── Test 7: Pre-expiry 5 dager før faktura ───────────────────────────
function test7_pre_expiry_phase() {
  console.log("\n▶ Test 7: Pre-expiry 5 dager før faktura");
  const now = new Date("2026-07-10T12:00:00Z");
  const billing = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "pre_expiry", "phase='pre_expiry'");
  assert(state.daysUntilNextBilling === 5, "daysUntilNextBilling=5");
  assert(state.graceEndsAt !== null, "graceEndsAt satt");
}

// ─── Test 8: Pre-expiry på dag 7 (grenseverdi) ────────────────────────
function test8_pre_expiry_boundary() {
  console.log("\n▶ Test 8: Pre-expiry på dag 7 (grenseverdi)");
  const now = new Date("2026-07-08T12:00:00Z");
  const billing = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "pre_expiry", "dag 7 = pre_expiry");
  assert(state.daysUntilNextBilling === 7, "daysUntilNextBilling=7");
}

// ─── Test 9: Grace-fase (faktura passert) ─────────────────────────────
function test9_grace_phase() {
  console.log("\n▶ Test 9: Grace-fase");
  const now = new Date("2026-07-17T12:00:00Z");
  const billing = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "grace", "phase='grace'");
  assert(state.daysUntilLock === 5, `daysUntilLock=5, fikk ${state.daysUntilLock}`);
}

// ─── Test 10: Grace boundary — 6 dager passert (siste grace-dag) ──────
function test10_grace_last_day() {
  console.log("\n▶ Test 10: Grace siste dag");
  const now = new Date("2026-07-21T12:00:00Z");
  const billing = new Date("2026-07-15T12:00:00Z");
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "grace", "siste grace-dag = grace");
  assert(state.daysUntilLock === 1, `daysUntilLock=1, fikk ${state.daysUntilLock}`);
}

// ─── Test 11: Expired-fase ────────────────────────────────────────────
function test11_expired_phase() {
  console.log("\n▶ Test 11: Expired-fase (grace utløpt)");
  const billing = new Date("2026-07-15T12:00:00Z");
  const now = new Date(billing.getTime() + (B2B_GRACE_DAYS + 1) * MS_DAY);
  const parent = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const state = computeB2BBillingState(parent, now);
  assert(state.phase === "expired", "phase='expired'");
}

// ─── Test 12: Locked-fase ─────────────────────────────────────────────
function test12_locked_phase() {
  console.log("\n▶ Test 12: Locked-fase");
  const parent = makeB2BParent({ status: "locked" });
  const state = computeB2BBillingState(parent, new Date());
  assert(state.phase === "locked", "phase='locked'");
}

// ─── Test 13: shouldBlockNewInvites — grace/expired blokkerer ─────────
function test13_should_block_invites() {
  console.log("\n▶ Test 13: shouldBlockNewInvites");
  const billing = new Date("2026-07-15T12:00:00Z");
  const inGrace = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const stateGrace = computeB2BBillingState(
    inGrace,
    new Date("2026-07-17T12:00:00Z"),
  );
  assert(shouldBlockNewInvites(stateGrace), "grace → blokker invites");

  const stateActive = computeB2BBillingState(
    inGrace,
    new Date("2026-07-01T12:00:00Z"),
  );
  assert(!shouldBlockNewInvites(stateActive), "active → tillat invites");

  const stateTrial = computeB2BBillingState(
    makeB2BParent({
      status: "trial",
      trialEndsAt: new Date("2026-07-30T12:00:00Z").toISOString(),
    }),
    new Date("2026-07-15T12:00:00Z"),
  );
  assert(!shouldBlockNewInvites(stateTrial), "trial → tillat invites");
}

// ─── Test 14: shouldShowEmployeeGraceToast ────────────────────────────
function test14_employee_grace_toast() {
  console.log("\n▶ Test 14: shouldShowEmployeeGraceToast");
  const billing = new Date("2026-07-15T12:00:00Z");
  const inGrace = makeB2BParent({
    status: "active",
    nextBillingDate: billing.toISOString(),
  });
  const stateGrace = computeB2BBillingState(
    inGrace,
    new Date("2026-07-17T12:00:00Z"),
  );
  assert(
    shouldShowEmployeeGraceToast(stateGrace),
    "grace → vis ansatt-toast",
  );

  const statePreExpiry = computeB2BBillingState(
    inGrace,
    new Date("2026-07-10T12:00:00Z"),
  );
  assert(
    !shouldShowEmployeeGraceToast(statePreExpiry),
    "pre_expiry → IKKE vis ansatt-toast (skremme ikke unødig)",
  );
}

// ─── Test 15: Suspended/cancelled/deleted parent → "n/a" ──────────────
function test15_other_statuses_return_n_a() {
  console.log("\n▶ Test 15: Andre statuser → 'n/a'");
  const suspended = makeB2BParent({ status: "suspended" });
  assert(
    computeB2BBillingState(suspended, new Date()).phase === "n/a",
    "suspended → n/a",
  );
  const cancelled = makeB2BParent({ status: "cancelled" });
  assert(
    computeB2BBillingState(cancelled, new Date()).phase === "n/a",
    "cancelled → n/a",
  );
  const pending = makeB2BParent({ status: "pending" });
  assert(
    computeB2BBillingState(pending, new Date()).phase === "n/a",
    "pending → n/a",
  );
}

// ─── Test 16: B2B default trial = 45 dager (Iter 20.4) ────────────────
function test16_b2b_default_trial_45d() {
  console.log("\n▶ Test 16: B2B default trial = 45 dager");
  const parent = makeB2BParent(); // ingen overrides → default
  const created = new Date(parent.createdAt);
  const trialEnd = new Date(parent.trialEndsAt);
  const days = Math.round((trialEnd.getTime() - created.getTime()) / MS_DAY);
  assert(days === 45, `B2B trial=45d, fikk ${days}d`);
}

// ─── Kjør alle ─────────────────────────────────────────────────────────
function main() {
  test1_b2c_returns_n_a();
  test2_b2b_child_returns_n_a();
  test3_trial_phase();
  test4_trial_expired_not_flipped();
  test5_active_no_billing_date();
  test6_active_far_from_billing();
  test7_pre_expiry_phase();
  test8_pre_expiry_boundary();
  test9_grace_phase();
  test10_grace_last_day();
  test11_expired_phase();
  test12_locked_phase();
  test13_should_block_invites();
  test14_employee_grace_toast();
  test15_other_statuses_return_n_a();
  test16_b2b_default_trial_45d();
  console.log("\n✅ b2b-billing.test.ts — alle 16 tester passert");
}

main();
