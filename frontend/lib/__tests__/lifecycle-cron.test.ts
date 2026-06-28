/**
 * Ko | Do · Vault — Iter 17 (2026-06-13)
 *
 * Tester for `decideAction()` — pure logikk-funksjonen som driver
 * lifecycle-cron. Dekker:
 *   - Trial-utløp → LOCK
 *   - Trial-aktiv → NOOP
 *   - Locked dag 21 → WARN_T7
 *   - Locked dag 25 → WARN_T3
 *   - Locked dag 27 → WARN_T1
 *   - Locked dag 28 → DELETE
 *   - Locked dag 29 → DELETE (idempotent, fortsatt sletter)
 *   - D-069-guard: free-plan blokkerer auto-lock/delete
 *   - Idempotens: WARN-flagg satt → NOOP for samme varsel
 *
 * Kjør: tsx lib/__tests__/lifecycle-cron.test.ts
 */
import { strict as assert } from "node:assert";
import {
  decideAction,
  daysBetween,
  DEFAULT_SWEEP_CONFIG,
} from "../platform/lifecycle-cron";
import type { TenantRecord } from "../platform/tenant-types";

function mkTenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  const now = new Date();
  return {
    subdomain: "test",
    customerType: "B2C",
    firstName: null,
    lastName: null,
    email: "test@example.com",
    contactEmail: null,
    locale: "no",
    plan: "trial",
    status: "trial",
    createdAt: now.toISOString(),
    trialEndsAt: new Date(now.getTime() + 30 * 86400000).toISOString(),
    lockedAt: null,
    cancelledAt: null,
    deletedAt: null,
    pendingExpiresAt: null,
    cancelAtPeriodEnd: false,
    cancelEffectiveAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeInvoiceId: null,
    vercelProjectId: null,
    vercelDomainAttached: false,
    upstashDatabaseId: null,
    upstashRestUrl: null,
    upstashRestToken: null,
    vaultLive: false,
    notes: null,
    notifications: { transactional: true, lifecycle: true },
    provisioningLog: [],
    welcomeEmailSentAt: null,
    lifecycleWarningsSentAt: { t7: null, t3: null, t1: null },
    trialReminderT5SentAt: null,
    lockedNotificationSentAt: null,
    deletedNotificationSentAt: null,
    parentTenant: null,
    ...overrides,
  } as TenantRecord;
}

async function run() {
  let passed = 0;
  let failed = 0;
  function check(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  console.log("Iter 17 — daysBetween:");

  check("samme dag → 0", () => {
    assert.equal(
      daysBetween(new Date("2026-06-13T10:00:00Z"), new Date("2026-06-13T20:00:00Z")),
      0,
    );
  });

  check("1 dag senere → 1", () => {
    assert.equal(
      daysBetween(new Date("2026-06-13T00:00:00Z"), new Date("2026-06-14T00:00:00Z")),
      1,
    );
  });

  check("28 dager senere → 28", () => {
    assert.equal(
      daysBetween(new Date("2026-06-01T00:00:00Z"), new Date("2026-06-29T00:00:00Z")),
      28,
    );
  });

  console.log("\nIter 17 — decideAction (trial-fase):");

  check("trial — utløpt → LOCK", () => {
    const t = mkTenant({
      status: "trial",
      trialEndsAt: "2026-06-10T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "LOCK");
    if (r.type === "LOCK") assert.equal(r.fromCancel, false);
  });

  check("trial — fortsatt aktiv → NOOP", () => {
    const t = mkTenant({
      status: "trial",
      trialEndsAt: "2026-07-13T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("trial — utløpt MEN free-plan → NOOP (D-069-guard)", () => {
    const t = mkTenant({
      status: "trial",
      plan: "free",
      trialEndsAt: "2026-06-10T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "NOOP");
    if (r.type === "NOOP") {
      assert.match(r.reason, /auto-lock blokkert/);
    }
  });

  check("trial — eksakt 5 dager igjen → WARN_TRIAL_T5", () => {
    const t = mkTenant({
      status: "trial",
      trialEndsAt: "2026-06-18T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "WARN_TRIAL_T5");
  });

  check("trial — T-5 allerede sendt → NOOP", () => {
    const t = mkTenant({
      status: "trial",
      trialEndsAt: "2026-06-18T00:00:00Z",
      trialReminderT5SentAt: "2026-06-13T03:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("trial — 4 dager igjen → NOOP (utenfor T-5-vinduet)", () => {
    const t = mkTenant({
      status: "trial",
      trialEndsAt: "2026-06-17T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  console.log("\nIter 17 — decideAction (locked-fase):");

  check("locked dag 0 → NOOP (for tidlig for varsel)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-13T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-13T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("locked dag 20 → NOOP (én dag før A3-vinduet)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-21T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("locked dag 21 → WARN_A3 (eneste varselsdag)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-22T03:00:00Z"));
    assert.equal(r.type, "WARN_A3");
    if (r.type === "WARN_A3") assert.equal(r.daysUntilDelete, 7);
  });

  check("locked dag 22 → NOOP (én dag forbi A3-vinduet)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-23T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("locked dag 25 → NOOP (gamle T-3 fjernet)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-26T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("locked dag 27 → NOOP (gamle T-1 fjernet)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-28T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("locked dag 28 → DELETE", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-29T03:00:00Z"));
    assert.equal(r.type, "DELETE");
  });

  check("locked dag 29 → DELETE (fortsatt sletter)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-30T03:00:00Z"));
    assert.equal(r.type, "DELETE");
  });

  check("locked dag 28 MEN free-plan → NOOP (D-069-guard)", () => {
    const t = mkTenant({
      status: "locked",
      plan: "free",
      lockedAt: "2026-06-01T00:00:00Z",
    });
    const r = decideAction(t, new Date("2026-06-29T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  console.log("\nIter 17 — decideAction (idempotens):");

  check("A3 allerede sendt → NOOP (samme dag)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
      lifecycleWarningsSentAt: {
        t7: "2026-06-22T03:00:00Z",
        t3: null,
        t1: null,
      },
    });
    const r = decideAction(t, new Date("2026-06-22T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  check("T-7 sendt, nå dag 25 → NOOP (gamle T-3 fjernet, kun A3 dag 21 nå)", () => {
    const t = mkTenant({
      status: "locked",
      lockedAt: "2026-06-01T00:00:00Z",
      lifecycleWarningsSentAt: {
        t7: "2026-06-22T03:00:00Z",
        t3: null,
        t1: null,
      },
    });
    const r = decideAction(t, new Date("2026-06-26T03:00:00Z"));
    assert.equal(r.type, "NOOP");
  });

  console.log("\nIter 17 — decideAction (irrelevante statuser):");

  check("active tenant → NOOP", () => {
    const t = mkTenant({ status: "active" });
    const r = decideAction(t, new Date());
    assert.equal(r.type, "NOOP");
  });

  check("cancelled tenant → NOOP (cron rør ikke)", () => {
    const t = mkTenant({ status: "cancelled" });
    const r = decideAction(t, new Date());
    assert.equal(r.type, "NOOP");
  });

  check("pending tenant → NOOP", () => {
    const t = mkTenant({ status: "pending" });
    const r = decideAction(t, new Date());
    assert.equal(r.type, "NOOP");
  });

  console.log("\nIter 20.4b — B2B grace-lock (D-080):");

  const MS_DAY = 86_400_000;

  check("B2B parent active + nextBilling 7d fram → NOOP", () => {
    const now = new Date("2026-07-01T12:00:00Z");
    const billing = new Date("2026-07-08T12:00:00Z");
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      plan: "b2b_semiannual",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "NOOP");
  });

  check("B2B parent active + grace utløpt (8d etter forfall) → B2B_GRACE_LOCK", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 8 * MS_DAY);
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      plan: "b2b_semiannual",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "B2B_GRACE_LOCK");
    if (r.type === "B2B_GRACE_LOCK") {
      assert.ok(r.graceExpiredAt);
      assert.ok(r.reason.includes("grace"));
    }
  });

  check("B2B parent active + i grace (3d etter forfall) → NOOP", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 3 * MS_DAY);
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      plan: "b2b_semiannual",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "NOOP");
  });

  check("B2B child (parentTenant satt) → ALDRI B2B_GRACE_LOCK", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 10 * MS_DAY);
    const t = mkTenant({
      subdomain: "acme-ola",
      customerType: "b2b",
      parentTenant: "acme",
      status: "active",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "NOOP");
  });

  check("B2C tenant → ALDRI B2B_GRACE_LOCK selv om grace-vinduet passet", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 10 * MS_DAY);
    const t = mkTenant({
      customerType: "b2c",
      parentTenant: null,
      status: "active",
      plan: "monthly",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "NOOP");
  });

  check("B2B parent uten nextBillingDate → NOOP (ingen sannhetskilde)", () => {
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      plan: "b2b_yearly",
      nextBillingDate: null,
    });
    const r = decideAction(t, new Date());
    assert.equal(r.type, "NOOP");
  });

  check("B2B parent free-plan → NOOP (D-069 blokkerer)", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 8 * MS_DAY);
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      plan: "free",
      nextBillingDate: billing.toISOString(),
    });
    const r = decideAction(t, now);
    assert.equal(r.type, "NOOP");
    if (r.type === "NOOP") {
      assert.ok(r.reason.includes("D-069") || r.reason.includes("blokkert"));
    }
  });

  // ─── Iter 20.4c — shouldBlockNewInvites integrasjon ───────────────────
  console.log("\nIter 20.4c — Invite-blokk i grace (D-080):");

  const { shouldBlockNewInvites } = await import("../platform/b2b-billing");
  const { computeB2BBillingState } = await import("../platform/b2b-billing");

  check("Parent i pre_expiry → invites tillatt", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const billing = new Date("2026-07-15T12:00:00Z");
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      nextBillingDate: billing.toISOString(),
    });
    const state = computeB2BBillingState(t, now);
    assert.equal(state.phase, "pre_expiry");
    assert.equal(shouldBlockNewInvites(state), false);
  });

  check("Parent i grace → invites blokkert", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 2 * MS_DAY);
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      nextBillingDate: billing.toISOString(),
    });
    const state = computeB2BBillingState(t, now);
    assert.equal(state.phase, "grace");
    assert.equal(shouldBlockNewInvites(state), true);
  });

  check("Parent i expired (før cron har låst) → invites fortsatt blokkert", () => {
    const billing = new Date("2026-07-15T12:00:00Z");
    const now = new Date(billing.getTime() + 10 * MS_DAY);
    const t = mkTenant({
      customerType: "b2b",
      parentTenant: null,
      status: "active",
      nextBillingDate: billing.toISOString(),
    });
    const state = computeB2BBillingState(t, now);
    assert.equal(state.phase, "expired");
    assert.equal(shouldBlockNewInvites(state), true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
