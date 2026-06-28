/**
 * Ko | Do · Vault — v4.3 Iter 14.9 — POST /api/admin/tenants/[subdomain]/sync-stripe
 *
 * Henter sannhetsdata fra Stripe og synkroniserer TenantRecord:
 *   1. Hent customer via stripeCustomerId
 *   2. List alle subscriptions for customer
 *   3. Hvis aktiv (status: "active" eller "trialing"): sett tenant.status="active"
 *      + stripeSubscriptionId + plan fra price-ID
 *   4. Hvis "past_due"/"unpaid": sett tenant.status="locked" (D-069-trygt;
 *      manuelt admin-handling = explicit override av D-069)
 *   5. Hvis "canceled"/null: rør IKKE status (admin avgjør manuelt)
 *
 * Brukes som race-condition-recovery + generell "stress-test"-handling.
 * Idempotent — kan kjøres så ofte Mike vil.
 *
 * Returnerer { before, after, changes } så admin ser hva som ble endret.
 */
import { NextResponse } from "next/server";
import { getTenant, putTenant } from "@/lib/platform/tenant-store";
import { getStripeClient } from "@/lib/stripe/client";
import type { Plan, TenantRecord } from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subdomain: string }> };

function priceIdToPlan(priceId: string | undefined | null): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_YEARLY) return "yearly";
  return null;
}

export async function POST(req: Request, { params }: Params) {
  const { subdomain } = await params;
  // dry-run: ?dryRun=1 ELLER body { dryRun: true } — beregner diff uten å skrive.
  // Mike krever eksplisitt bekreftelse før noe synkroniseres.
  const url = new URL(req.url);
  let dryRun = url.searchParams.get("dryRun") === "1";
  if (!dryRun) {
    try {
      const body = (await req.clone().json().catch(() => null)) as { dryRun?: boolean } | null;
      if (body?.dryRun === true) dryRun = true;
    } catch {
      /* ignore */
    }
  }
  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!tenant.stripeCustomerId) {
    return NextResponse.json(
      { error: "no_stripe_customer", detail: "Tenant har ingen stripeCustomerId — ingenting å synce." },
      { status: 409 },
    );
  }

  const stripe = getStripeClient();
  let subscriptions;
  try {
    subscriptions = await stripe.subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: "all",
      limit: 10,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "stripe_error", detail: msg },
      { status: 502 },
    );
  }

  // Foretrekk aktive subscriptions først, deretter trialing
  const sorted = [...subscriptions.data].sort((a, b) => {
    const score = (s: typeof a) =>
      s.status === "active" ? 0
      : s.status === "trialing" ? 1
      : s.status === "past_due" ? 2
      : s.status === "unpaid" ? 3
      : 4;
    return score(a) - score(b);
  });
  const primary = sorted[0];

  const before = {
    status: tenant.status,
    plan: tenant.plan,
    stripeSubscriptionId: tenant.stripeSubscriptionId,
    pendingExpiresAt: tenant.pendingExpiresAt,
    cancelAtPeriodEnd: tenant.cancelAtPeriodEnd,
    cancelEffectiveAt: tenant.cancelEffectiveAt,
  };

  const updates: Partial<TenantRecord> = {};
  const reasons: string[] = [];

  if (!primary) {
    reasons.push("Ingen subscriptions funnet hos Stripe.");
  } else {
    // Synkroniser subscription-ID hvis ulik
    if (tenant.stripeSubscriptionId !== primary.id) {
      updates.stripeSubscriptionId = primary.id;
      reasons.push(`stripeSubscriptionId: ${tenant.stripeSubscriptionId ?? "null"} → ${primary.id}`);
    }
    // Synkroniser plan hvis price-ID gjenkjennes
    const newPlan = priceIdToPlan(primary.items.data[0]?.price?.id);
    if (newPlan && newPlan !== tenant.plan) {
      updates.plan = newPlan;
      reasons.push(`plan: ${tenant.plan} → ${newPlan}`);
    }
    // Iter 19.6 + 19.7 (Dahlia-fix): synk cancel_at_period_end + cancel_at
    // fra Stripe. Stripe Basil/Dahlia kan bruke ENTEN `cancel_at_period_end`
    // (legacy) eller `cancel_at` direkte (newer). Begge betyr samme
    // UX-intensjon: aktiv nå, kanselleres senere.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const primAny = primary as any;
    const stripeLegacyFlag = primAny.cancel_at_period_end === true;
    const stripeCancelAtUnix: number | null =
      typeof primAny.cancel_at === "number" ? primAny.cancel_at : null;
    const stripeCancelAtIso = stripeCancelAtUnix
      ? new Date(stripeCancelAtUnix * 1000).toISOString()
      : null;
    const stripeCancelFlag = stripeLegacyFlag || stripeCancelAtUnix !== null;
    if (stripeCancelFlag !== tenant.cancelAtPeriodEnd) {
      updates.cancelAtPeriodEnd = stripeCancelFlag;
      reasons.push(
        `cancelAtPeriodEnd: ${tenant.cancelAtPeriodEnd} → ${stripeCancelFlag}`,
      );
    }
    if (stripeCancelAtIso !== tenant.cancelEffectiveAt) {
      updates.cancelEffectiveAt = stripeCancelAtIso;
      reasons.push(
        `cancelEffectiveAt: ${tenant.cancelEffectiveAt ?? "null"} → ${stripeCancelAtIso ?? "null"}`,
      );
    }
    // Status-mapping basert på Stripe subscription.status
    if (primary.status === "active" || primary.status === "trialing") {
      if (tenant.status !== "active") {
        updates.status = "active";
        updates.lockedAt = null;
        updates.pendingExpiresAt = null;
        reasons.push(`status: ${tenant.status} → active (Stripe: ${primary.status})`);
      }
    } else if (primary.status === "past_due" || primary.status === "unpaid") {
      if (tenant.status !== "locked") {
        updates.status = "locked";
        if (!tenant.lockedAt) updates.lockedAt = new Date().toISOString();
        reasons.push(`status: ${tenant.status} → locked (Stripe: ${primary.status})`);
      }
    } else if (primary.status === "canceled") {
      reasons.push(
        `Stripe: ${primary.status} — admin må bestemme om tenant skal slettes (cancelled)`,
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      synced: false,
      stripeStatus: primary?.status ?? "no_subscription",
      stripeSubscriptionId: primary?.id ?? null,
      reasons,
      before,
      proposed: null,
    });
  }

  // Beregn "proposed" (det som VILLE blitt skrevet) — vises i dry-run-preview.
  const proposed = {
    status: updates.status ?? before.status,
    plan: updates.plan ?? before.plan,
    stripeSubscriptionId:
      updates.stripeSubscriptionId !== undefined
        ? updates.stripeSubscriptionId
        : before.stripeSubscriptionId,
    pendingExpiresAt:
      updates.pendingExpiresAt !== undefined
        ? updates.pendingExpiresAt
        : before.pendingExpiresAt,
    cancelAtPeriodEnd:
      updates.cancelAtPeriodEnd !== undefined
        ? updates.cancelAtPeriodEnd
        : before.cancelAtPeriodEnd,
    cancelEffectiveAt:
      updates.cancelEffectiveAt !== undefined
        ? updates.cancelEffectiveAt
        : before.cancelEffectiveAt,
  };

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      synced: false,
      stripeStatus: primary?.status ?? "no_subscription",
      stripeSubscriptionId: primary?.id ?? null,
      reasons,
      before,
      proposed,
    });
  }

  // Re-fetch + skriv (race-trygt)
  const fresh = (await getTenant(subdomain)) ?? tenant;
  await putTenant({ ...fresh, ...updates });
  const after = await getTenant(subdomain);

  return NextResponse.json({
    ok: true,
    dryRun: false,
    synced: true,
    stripeStatus: primary?.status ?? "no_subscription",
    stripeSubscriptionId: primary?.id ?? null,
    reasons,
    before,
    proposed,
    after: after
      ? {
          status: after.status,
          plan: after.plan,
          stripeSubscriptionId: after.stripeSubscriptionId,
          pendingExpiresAt: after.pendingExpiresAt,
          cancelAtPeriodEnd: after.cancelAtPeriodEnd,
          cancelEffectiveAt: after.cancelEffectiveAt,
        }
      : null,
  });
}
