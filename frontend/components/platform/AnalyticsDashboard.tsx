"use client";
/**
 * Ko | Do · Vault — D-149 (2026-02) — SuperAdmin Analytics
 *
 * Ny top-nivå-tab som viser aggregat-analytics på tvers av alle tenants.
 * Kilde: `GET /api/admin/analytics?days=30|90|365`.
 *
 * Innhold:
 *   - Periode-picker (30/90/365 dager)
 *   - KPI-kort: aktive tenants i dag, MAU 30d, unlocks 30d
 *   - Linje-graf: DAU + unlocks over tid (inline SVG, ingen dependency)
 *   - Top 10 mest aktive tenants (tabell)
 *   - Churn-risk: tenants uten aktivitet 60+ dager (tabell)
 *   - Plan-fordeling (bar-chart via CSS)
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BarChart3, TrendingUp, TrendingDown, Users, Activity } from "lucide-react";

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
  period: { days: number; cutoffIso: string; todayIso: string };
};

export function AnalyticsDashboard() {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(true);
    fetch(`/api/admin/analytics?days=${days}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setData(d as AnalyticsResponse))
      .catch(() => toast.error("Kunne ikke hente analytics"))
      .finally(() => setBusy(false));
  }, [days]);

  return (
    <div className="space-y-5" data-testid="analytics-dashboard">
      {/* Periode-picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-white/45 uppercase tracking-wider">
          Periode:
        </span>
        {([30, 90, 365] as const).map((d) => (
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
        {busy && (
          <span className="text-[11px] text-white/45 ml-2">Laster…</span>
        )}
      </div>

      {data && (
        <>
          {/* KPI-kort */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={<Users className="h-4 w-4" />}
              label="Aktive i dag"
              value={data.totals.activeTenantsToday}
              subtext={`av ${data.totals.totalTenants} tenants`}
              testId="kpi-active-today"
            />
            <KpiCard
              icon={<Activity className="h-4 w-4" />}
              label={`Aktive siste ${days}d`}
              value={data.totals.activeTenantsLast30d}
              subtext={`${Math.round((data.totals.activeTenantsLast30d / Math.max(data.totals.totalTenants, 1)) * 100)}% av total`}
              testId="kpi-active-period"
            />
            <KpiCard
              icon={<BarChart3 className="h-4 w-4" />}
              label={`Unlocks ${days}d`}
              value={data.totals.totalUnlocks30d}
              subtext={`snitt ${Math.round(data.totals.totalUnlocks30d / days)}/dag`}
              testId="kpi-unlocks"
            />
            <KpiCard
              icon={<BarChart3 className="h-4 w-4" />}
              label={`Writes ${days}d`}
              value={data.totals.totalWrites30d}
              subtext={`snitt ${Math.round(data.totals.totalWrites30d / days)}/dag`}
              testId="kpi-writes"
            />
          </div>

          {/* Linje-graf */}
          <ActivityLineChart data={data.dailyAggregate} />

          {/* Top-aktive + Churn-risk side ved side */}
          <div className="grid md:grid-cols-2 gap-4">
            <TopActiveTable rows={data.topActive} />
            <ChurnRiskTable rows={data.churnRisk} />
          </div>

          {/* Plan-fordeling */}
          <PlanDistribution data={data.planDistribution} />
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subtext,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  subtext: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-white/60 mb-2">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-semibold tracking-tight">
        {value.toLocaleString("nb-NO")}
      </div>
      <div className="text-[11px] text-white/45 mt-1">{subtext}</div>
    </div>
  );
}

function ActivityLineChart({
  data,
}: {
  data: AnalyticsResponse["dailyAggregate"];
}) {
  const chart = useMemo(() => {
    if (data.length === 0) return null;
    const maxValue = Math.max(...data.map((d) => d.unlocks), 1);
    const width = 800;
    const height = 200;
    const padX = 40;
    const padY = 20;
    const chartWidth = width - padX * 2;
    const chartHeight = height - padY * 2;

    const xStep = data.length > 1 ? chartWidth / (data.length - 1) : 0;
    const points = data.map((d, i) => {
      const x = padX + i * xStep;
      const y = padY + chartHeight - (d.unlocks / maxValue) * chartHeight;
      return { x, y, ...d };
    });

    const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
    return { points, polylinePoints, maxValue, width, height, padX, padY, chartHeight };
  }, [data]);

  if (!chart) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-white/50 text-sm">
        Ingen aktivitets-data ennå.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-testid="analytics-line-chart">
      <h4 className="text-sm font-medium mb-3">
        Unlocks over tid
        <span className="text-[10px] text-white/45 ml-2 font-normal">
          (topp {chart.maxValue.toLocaleString("nb-NO")}/dag)
        </span>
      </h4>
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <polyline
          points={chart.polylinePoints}
          fill="none"
          stroke="rgb(251, 191, 36)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {chart.points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="rgb(251, 191, 36)"
            opacity="0.7"
          >
            <title>{`${p.date}: ${p.unlocks} unlocks, ${p.writes} writes, ${p.activeTenants} aktive tenants`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function TopActiveTable({ rows }: { rows: AnalyticsResponse["topActive"] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-testid="analytics-top-active">
      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-emerald-400" />
        Top 10 mest aktive
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-white/45 py-4">Ingen aktivitet i perioden.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-white/45 border-b border-white/10">
              <th className="py-1.5 pr-2 font-medium">Tenant</th>
              <th className="py-1.5 px-2 font-medium">Plan</th>
              <th className="py-1.5 px-2 font-medium text-right">Unlocks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subdomain} className="border-b border-white/5 last:border-0">
                <td className="py-1.5 pr-2 truncate max-w-[20ch]">{r.companyName}</td>
                <td className="py-1.5 px-2 font-mono text-white/60 text-[10px]">{r.plan ?? "—"}</td>
                <td className="py-1.5 px-2 text-right font-mono">{r.unlocks30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ChurnRiskTable({ rows }: { rows: AnalyticsResponse["churnRisk"] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-testid="analytics-churn-risk">
      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
        <TrendingDown className="h-4 w-4 text-red-400" />
        Churn-risk (60+ dager inaktiv)
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-white/45 py-4">Ingen churn-risk 🎉</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-white/45 border-b border-white/10">
              <th className="py-1.5 pr-2 font-medium">Tenant</th>
              <th className="py-1.5 px-2 font-medium text-right">Dager inaktiv</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.subdomain} className="border-b border-white/5 last:border-0">
                <td className="py-1.5 pr-2 truncate max-w-[20ch]">{r.companyName}</td>
                <td className="py-1.5 px-2 text-right font-mono text-red-300">
                  {r.daysSinceActivity === null ? "aldri" : `${r.daysSinceActivity}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlanDistribution({
  data,
}: {
  data: AnalyticsResponse["planDistribution"];
}) {
  const entries = Object.entries(data).sort(
    ([, a], [, b]) => b.count - a.count,
  );
  const maxCount = Math.max(...entries.map(([, v]) => v.count), 1);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4" data-testid="analytics-plan-distribution">
      <h4 className="text-sm font-medium mb-3">Plan-fordeling</h4>
      <div className="space-y-2">
        {entries.map(([plan, v]) => (
          <div key={plan} className="flex items-center gap-3 text-xs">
            <span className="font-mono text-white/70 min-w-[140px]">{plan}</span>
            <div className="flex-1 h-6 bg-white/5 rounded overflow-hidden">
              <div
                className="h-full bg-amber-400/60 rounded"
                style={{ width: `${(v.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="font-mono text-white/85 min-w-[30px] text-right">
              {v.count}
            </span>
            <span className="font-mono text-white/45 min-w-[80px] text-right text-[10px]">
              {v.totalUnlocks30d} unlocks
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
