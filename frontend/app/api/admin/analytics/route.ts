/**
 * Ko | Do · Vault — D-149 (2026-02) — SuperAdmin analytics endpoint
 *
 * GET /api/admin/analytics?days=30|90|365
 *
 * Returnerer aggregat-analytics på tvers av alle tenants med `dailyActivity`
 * populert. Beskyttet av admin-session-middleware.
 *
 * Response:
 *   {
 *     totals: {
 *       activeTenantsToday: number,
 *       activeTenantsLast30d: number,
 *       totalUnlocks30d: number,
 *       totalWrites30d: number,
 *       totalReads30d: number,
 *     },
 *     dailyAggregate: [
 *       { date: "2026-02-01", unlocks: 12, writes: 8, reads: 45, activeTenants: 7 },
 *       ...
 *     ],
 *     topActive: [
 *       { subdomain, companyName, unlocks30d, writes30d, plan, customerType }
 *     ],  // Top 10
 *     churnRisk: [
 *       { subdomain, companyName, lastActivityDate, daysSinceActivity, plan }
 *     ],  // 60+ dager uten aktivitet
 *     planDistribution: {
 *       "b2c_monthly": { count, totalUnlocks30d },
 *       "b2c_yearly": { ... },
 *       ...
 *     }
 *   }
 *
 * Ingen PII, kun aggregat.
 */
import { NextResponse } from "next/server";
import { listTenants } from "@/lib/platform/tenant-store";
import type { TenantRecord } from "@/lib/platform/tenant-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

function findLastActivityDate(
  activity: TenantRecord["dailyActivity"],
): string | null {
  if (!activity) return null;
  const dates = Object.keys(activity).sort();
  for (let i = dates.length - 1; i >= 0; i--) {
    const d = dates[i]!;
    const counts = activity[d]!;
    if (counts.unlocks > 0 || counts.writes > 0 || counts.reads > 0) {
      return d;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days") ?? "30";
  const days = Math.max(1, Math.min(365, parseInt(daysParam, 10) || 30));
  const cutoffIso = daysAgoIso(days);
  const today = todayIso();

  const tenants = await listTenants();

  // 1. Bygg dailyAggregate for hele perioden
  const aggregate: Record<
    string,
    { unlocks: number; writes: number; reads: number; activeTenants: Set<string> }
  > = {};

  let activeTenantsToday = 0;
  let activeTenantsLast30d = 0;
  let totalUnlocks30d = 0;
  let totalWrites30d = 0;
  let totalReads30d = 0;

  const topActiveRaw: Array<{
    tenant: TenantRecord;
    unlocks30d: number;
    writes30d: number;
  }> = [];

  const churnRiskRaw: Array<{
    tenant: TenantRecord;
    lastActivityDate: string | null;
    daysSinceActivity: number;
  }> = [];

  const planDistribution: Record<string, { count: number; totalUnlocks30d: number }> = {};

  for (const tenant of tenants) {
    const activity = tenant.dailyActivity;
    let tenantUnlocks30d = 0;
    let tenantWrites30d = 0;
    let tenantReads30d = 0;
    let isActiveToday = false;
    let isActiveLast30d = false;

    if (activity) {
      for (const [dateIso, counts] of Object.entries(activity)) {
        if (dateIso < cutoffIso) continue;

        if (!aggregate[dateIso]) {
          aggregate[dateIso] = {
            unlocks: 0,
            writes: 0,
            reads: 0,
            activeTenants: new Set(),
          };
        }
        aggregate[dateIso].unlocks += counts.unlocks;
        aggregate[dateIso].writes += counts.writes;
        aggregate[dateIso].reads += counts.reads;
        if (counts.unlocks > 0 || counts.writes > 0 || counts.reads > 0) {
          aggregate[dateIso].activeTenants.add(tenant.subdomain);
        }

        tenantUnlocks30d += counts.unlocks;
        tenantWrites30d += counts.writes;
        tenantReads30d += counts.reads;

        if (dateIso === today && (counts.unlocks > 0 || counts.writes > 0 || counts.reads > 0)) {
          isActiveToday = true;
        }
        if (counts.unlocks > 0 || counts.writes > 0 || counts.reads > 0) {
          isActiveLast30d = true;
        }
      }
    }

    if (isActiveToday) activeTenantsToday += 1;
    if (isActiveLast30d) activeTenantsLast30d += 1;
    totalUnlocks30d += tenantUnlocks30d;
    totalWrites30d += tenantWrites30d;
    totalReads30d += tenantReads30d;

    // Top-aktive kandidater — kun tenants med aktivitet
    if (tenantUnlocks30d > 0 || tenantWrites30d > 0) {
      topActiveRaw.push({ tenant, unlocks30d: tenantUnlocks30d, writes30d: tenantWrites30d });
    }

    // Plan-fordeling
    const plan = tenant.plan ?? "unknown";
    if (!planDistribution[plan]) {
      planDistribution[plan] = { count: 0, totalUnlocks30d: 0 };
    }
    planDistribution[plan].count += 1;
    planDistribution[plan].totalUnlocks30d += tenantUnlocks30d;

    // Churn-varsel: 60+ dager siden sist aktivitet (eller aldri)
    const lastActivityDate = findLastActivityDate(activity);
    const daysSince = lastActivityDate === null
      ? 9999
      : daysBetween(lastActivityDate, today);
    if (daysSince >= 60) {
      churnRiskRaw.push({ tenant, lastActivityDate, daysSinceActivity: daysSince });
    }
  }

  const dailyAggregate = Object.entries(aggregate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      date,
      unlocks: agg.unlocks,
      writes: agg.writes,
      reads: agg.reads,
      activeTenants: agg.activeTenants.size,
    }));

  const topActive = topActiveRaw
    .sort((a, b) => b.unlocks30d - a.unlocks30d)
    .slice(0, 10)
    .map(({ tenant, unlocks30d, writes30d }) => ({
      subdomain: tenant.subdomain,
      companyName: tenant.companyName ?? tenant.email,
      unlocks30d,
      writes30d,
      plan: tenant.plan,
      customerType: tenant.customerType,
    }));

  const churnRisk = churnRiskRaw
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity)
    .slice(0, 50)
    .map(({ tenant, lastActivityDate, daysSinceActivity }) => ({
      subdomain: tenant.subdomain,
      companyName: tenant.companyName ?? tenant.email,
      lastActivityDate,
      daysSinceActivity: daysSinceActivity === 9999 ? null : daysSinceActivity,
      plan: tenant.plan,
      customerType: tenant.customerType,
    }));

  return NextResponse.json({
    totals: {
      activeTenantsToday,
      activeTenantsLast30d,
      totalUnlocks30d,
      totalWrites30d,
      totalReads30d,
      totalTenants: tenants.length,
    },
    dailyAggregate,
    topActive,
    churnRisk,
    planDistribution,
    period: { days, cutoffIso, todayIso: today },
  });
}
