/**
 * Ko | Do · Vault — Iter 17 (D-070-revisjon 2026-06-13)
 *
 * Tester for `tenantHasPaidHistory()` + `deleteStripeCustomer()` med
 * bevaringsregelen. Sikrer at betalte tenants ALDRI får customer slettet.
 *
 * Kjør med: tsx lib/__tests__/stripe-cleanup-d070.test.ts
 */
import { strict as assert } from "node:assert";
import {
  tenantHasPaidHistory,
  deleteStripeCustomer,
} from "../stripe/cleanup";
import type { TenantRecord, ProvisioningEvent } from "../platform/tenant-types";

// ─── Minimal tenant-stub (kun feltene tenantHasPaidHistory leser) ──────
function stub(
  overrides: Partial<Pick<TenantRecord, "stripeSubscriptionId" | "provisioningLog">> = {},
): Pick<TenantRecord, "stripeSubscriptionId" | "provisioningLog"> {
  return {
    stripeSubscriptionId: null,
    provisioningLog: [],
    ...overrides,
  };
}

function event(
  partial: Partial<ProvisioningEvent> & { stage: ProvisioningEvent["stage"]; detail?: string },
): ProvisioningEvent {
  return {
    timestamp: new Date().toISOString(),
    status: "ok",
    ...partial,
  };
}

async function run() {
  let passed = 0;
  let failed = 0;
  function check(name: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      })
      .catch((e) => {
        console.error(`  ✗ ${name}`);
        console.error(`    ${e instanceof Error ? e.message : String(e)}`);
        failed++;
      });
  }

  console.log("D-070-revisjon — tenantHasPaidHistory:");

  await check("ren trial (ingen subscription, tom logg) → false", () => {
    assert.equal(tenantHasPaidHistory(stub()), false);
  });

  await check("subscription satt → true (primær markør)", () => {
    assert.equal(
      tenantHasPaidHistory(stub({ stripeSubscriptionId: "sub_abc123" })),
      true,
    );
  });

  await check(
    "ingen subscription men 'invoice.paid'-event i log → true (defensiv)",
    () => {
      assert.equal(
        tenantHasPaidHistory(
          stub({
            provisioningLog: [
              event({
                stage: "status_change",
                detail: "invoice.paid id=in_xxx → status=active",
              }),
            ],
          }),
        ),
        true,
      );
    },
  );

  await check("annen status_change-event uten invoice.paid-prefiks → false", () => {
    assert.equal(
      tenantHasPaidHistory(
        stub({
          provisioningLog: [
            event({ stage: "status_change", detail: "subscription.created mottatt" }),
          ],
        }),
      ),
      false,
    );
  });

  await check("event med stage != status_change ignoreres", () => {
    assert.equal(
      tenantHasPaidHistory(
        stub({
          provisioningLog: [
            event({ stage: "vault_live", detail: "invoice.paid pga test" }),
          ],
        }),
      ),
      false,
    );
  });

  console.log("\nD-070-revisjon — deleteStripeCustomer:");

  await check("null customerId → skipped", async () => {
    const r = await deleteStripeCustomer(null, { hasPaidHistory: false });
    assert.equal(r.status, "skipped");
  });

  await check("hasPaidHistory=true → preserved (uten å kalle Stripe)", async () => {
    let calls = 0;
    const fakeStripe = {
      customers: {
        del: async () => {
          calls++;
          return {} as never;
        },
      },
    } as unknown as Parameters<typeof deleteStripeCustomer>[2];
    const r = await deleteStripeCustomer(
      "cus_paid_user",
      { hasPaidHistory: true },
      fakeStripe,
    );
    assert.equal(r.status, "preserved");
    assert.equal(calls, 0, "stripe.customers.del SKAL IKKE kalles for betalt tenant");
  });

  await check("hasPaidHistory=false + customer-id → ok (kaller Stripe)", async () => {
    let calls = 0;
    let calledWith = "";
    const fakeStripe = {
      customers: {
        del: async (id: string) => {
          calls++;
          calledWith = id;
          return {} as never;
        },
      },
    } as unknown as Parameters<typeof deleteStripeCustomer>[2];
    const r = await deleteStripeCustomer(
      "cus_trial_user",
      { hasPaidHistory: false },
      fakeStripe,
    );
    assert.equal(r.status, "ok");
    assert.equal(calls, 1);
    assert.equal(calledWith, "cus_trial_user");
  });

  await check("Stripe 404 → ok (idempotent)", async () => {
    const fakeStripe = {
      customers: {
        del: async () => {
          const err: { statusCode: number; code: string; message: string } = {
            statusCode: 404,
            code: "resource_missing",
            message: "No such customer",
          };
          throw err;
        },
      },
    } as unknown as Parameters<typeof deleteStripeCustomer>[2];
    const r = await deleteStripeCustomer(
      "cus_gone",
      { hasPaidHistory: false },
      fakeStripe,
    );
    assert.equal(r.status, "ok");
    assert.match(r.detail ?? "", /allerede slettet/);
  });

  await check("Stripe 500 → failed", async () => {
    const fakeStripe = {
      customers: {
        del: async () => {
          throw new Error("internal_server_error");
        },
      },
    } as unknown as Parameters<typeof deleteStripeCustomer>[2];
    const r = await deleteStripeCustomer(
      "cus_x",
      { hasPaidHistory: false },
      fakeStripe,
    );
    assert.equal(r.status, "failed");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
