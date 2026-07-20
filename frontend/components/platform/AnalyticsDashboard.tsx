"use client";
/**
 * Ko | Do · Vault — D-149 (2026-02) — SuperAdmin Analytics (Tremor)
 *
 * Bruker @tremor/react for KPI-cards, area-chart og bar-list. Data
 * fra `GET /api/admin/analytics?days=<N>&churnDays=<M>&topLimit=<K>`.
 *
 * Konfigurasjon: periode-verdier + churn-terskel + top-limit leses fra
 * `default.json → analytics`-blokken (via useAppConfig). Mike kan justere
 * uten kode-endring.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  Metric,
  Text,
  Title,
  AreaChart,
  BarList,
  Grid,
  Flex,
} from "@tremor/react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { clampAnalyticsConfig } from "@/lib/config";

type AnalyticsResponse = {
  totals: {
    activeTenantsToday: number;
    activeTenantsLast30d: number;
    totalUnlocks30d: number;
    totalWrites30d: number;
    totalReads30d: number;
    totalTenants: number;
  };
  dailyAggregate: Array<{
    date: string;
    unlocks: number;
    writes: number;
    reads: number;
    activeTenants: number;
  }>;
  topActive: Array<{
    subdomain: string;
    companyName: string;
    unlocks30d: number;
    writes30d: number;
    plan: string | null;
    customerType: string;
  }>;
  churnRisk: Array<{
    subdomain: string;
    companyName: string;
    lastActivityDate: string | null;
    daysSinceActivity: number | null;
    plan: string | null;
    customerType: string;
  }>;
  planDistribution: Record<string, { count: number; totalUnlocks30d: number }>;
  period: {
    days: number;
    cutoffIso: string;
    todayIso: string;
    churnRiskDays: number;
    topActiveLimit: number;
  };
};

export function AnalyticsDashboard() {
  const { config } = useAppConfig();
  const analyticsCfg = useMemo(
    () => clampAnalyticsConfig(config.analytics),
    [config.analytics],
  );

  const [days, setDays] = useState<number>(analyticsCfg.defaultPeriodDays);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Hvis config-endring gjør at gjeldende `days` ikke lenger er en gyldig
  // periode, hopp tilbake til default.
  useEffect(() => {
    if (!analyticsCfg.periodDays.includes(days)) {
      setDays(analyticsCfg.defaultPeriodDays);
    }
  }, [analyticsCfg, days]);

  useEffect(() => {
    setBusy(true);
    const params = new URLSearchParams({
      days: String(days),
      churnDays: String(analyticsCfg.churnRiskDays),
      topLimit: String(analyticsCfg.topActiveLimit),
    });
    fetch(`/api/admin/analytics?${params.toString()}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d as AnalyticsResponse))
      .catch(() => toast.error("Kunne ikke hente analytics"))
      .finally(() => setBusy(false));
  }, [days, analyticsCfg.churnRiskDays, analyticsCfg.topActiveLimit]);

  return (
    <div className="space-y-5" data-testid="analytics-dashboard">
      {/* Periode-picker */}
      <Flex justifyContent="start" className="gap-2 flex-wrap">
        <Text className="text-xs uppercase tracking-wider text-white/45">
          Periode:
        </Text>
        {analyticsCfg.periodDays.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              days === d
                ? "bg-amber-400/15 border-amber-400/60 text-amber-100"
                : "bg-white/5 border-white/10 text-white/55 hover:text-white/85"
            }`}
            data-testid={`analytics-period-${d}d`}
          >
            {d} dager
          </button>
        ))}
        {busy && <Text className="text-xs text-white/45 ml-2">Laster…</Text>}
      </Flex>

      {data && (
        <>
          {/* KPI-kort */}
          <Grid numItemsSm={2} numItemsLg={4} className="gap-3">
            <Card data-testid="kpi-active-today" decoration="top" decorationColor="amber">
              <Text>Aktive i dag</Text>
              <Metric>{data.totals.activeTenantsToday.toLocaleString("nb-NO")}</Metric>
              <Text className="text-xs mt-1">
                av {data.totals.totalTenants} tenants
              </Text>
            </Card>
            <Card data-testid="kpi-active-period" decoration="top" decorationColor="emerald">
              <Text>Aktive siste {days}d</Text>
              <Metric>{data.totals.activeTenantsLast30d.toLocaleString("nb-NO")}</Metric>
              <Text className="text-xs mt-1">
                {Math.round(
                  (data.totals.activeTenantsLast30d /
                    Math.max(data.totals.totalTenants, 1)) *
                    100,
                )}
                % av total
              </Text>
            </Card>
            <Card data-testid="kpi-unlocks" decoration="top" decorationColor="sky">
              <Text>Unlocks {days}d</Text>
              <Metric>{data.totals.totalUnlocks30d.toLocaleString("nb-NO")}</Metric>
              <Text className="text-xs mt-1">
                snitt {Math.round(data.totals.totalUnlocks30d / days)}/dag
              </Text>
            </Card>
            <Card data-testid="kpi-writes" decoration="top" decorationColor="violet">
              <Text>Writes {days}d</Text>
              <Metric>{data.totals.totalWrites30d.toLocaleString("nb-NO")}</Metric>
              <Text className="text-xs mt-1">
                snitt {Math.round(data.totals.totalWrites30d / days)}/dag
              </Text>
            </Card>
          </Grid>

          {/* Area-chart: aktivitet over tid */}
          <Card data-testid="analytics-line-chart">
            <Title>Aktivitet over tid</Title>
            <Text className="text-xs mt-1 text-white/45">
              Unlocks, writes og aktive tenants per dag
            </Text>
            {data.dailyAggregate.length > 0 ? (
              <>
                <AreaChart
                  className="mt-4 h-80"
                  data={data.dailyAggregate}
                  index="date"
                  categories={["unlocks", "writes", "activeTenants"]}
                  colors={["amber", "violet", "emerald"]}
                  yAxisWidth={56}
                  minValue={0}
                  valueFormatter={(v: number) => Math.round(v).toString()}
                  showLegend={false}
                  showGridLines
                  showAnimation
                  startEndOnly
                  curveType="monotone"
                />
                <div className="flex items-center justify-center gap-5 text-xs text-white/60 mt-4 flex-wrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-amber-400" />
                    Unlocks
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-violet-400" />
                    Writes
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" />
                    Aktive tenants
                  </span>
                </div>
              </>
            ) : (
              <Text className="text-white/45 py-8 text-center">
                Ingen aktivitets-data ennå.
              </Text>
            )}
          </Card>

          {/* Top-aktive + Churn-risk side ved side */}
          <Grid numItemsMd={2} className="gap-4">
            <Card data-testid="analytics-top-active">
              <Title>Top {analyticsCfg.topActiveLimit} mest aktive</Title>
              <Text className="text-xs mt-1">Ranking etter unlocks {days}d</Text>
              {data.topActive.length > 0 ? (
                <BarList
                  className="mt-4"
                  data={data.topActive.map((t) => ({
                    name: t.companyName,
                    value: t.unlocks30d,
                  }))}
                  color="emerald"
                />
              ) : (
                <Text className="text-white/45 py-4">
                  Ingen aktivitet i perioden.
                </Text>
              )}
            </Card>

            <Card data-testid="analytics-churn-risk">
              <Title>Churn-risk ({analyticsCfg.churnRiskDays}+ dager inaktiv)</Title>
              <Text className="text-xs mt-1">Tenants uten aktivitet</Text>
              {data.churnRisk.length > 0 ? (
                <BarList
                  className="mt-4"
                  data={data.churnRisk.slice(0, 10).map((r) => ({
                    name: r.companyName,
                    value:
                      r.daysSinceActivity === null
                        ? 999
                        : r.daysSinceActivity,
                  }))}
                  color="red"
                />
              ) : (
                <Text className="text-white/45 py-4">Ingen churn-risk 🎉</Text>
              )}
            </Card>
          </Grid>

          {/* Plan-fordeling */}
          <Card data-testid="analytics-plan-distribution">
            <Title>Plan-fordeling</Title>
            <Text className="text-xs mt-1">Antall tenants + unlocks per plan</Text>
            <BarList
              className="mt-4"
              data={Object.entries(data.planDistribution)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([plan, v]) => ({
                  name: `${plan} · ${v.count} tenants`,
                  value: v.totalUnlocks30d,
                }))}
              color="amber"
            />
          </Card>
        </>
      )}
    </div>
  );
}
