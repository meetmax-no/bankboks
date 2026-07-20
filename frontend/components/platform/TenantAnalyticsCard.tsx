"use client";
/**
 * Ko | Do · Vault — D-149 (2026-02) — Per-tenant analytics-card
 *
 * Nivå-1-tab "Analytics" i TenantDetailCard. Viser aktivitet for én
 * spesifikk tenant basert på `record.dailyActivity`. Ingen ekstra
 * API-kall — data er allerede med i tenant-record.
 *
 * Innhold:
 *   - Header med sist aktiv-pill (grønn/amber/rød/grå)
 *   - 4 KPI-kort (siste 30d): unlocks / writes / reads / aktive dager
 *   - Area-chart over daglig aktivitet (siste 30d)
 *   - Rå tabell (ekspanderbar) for granulær innsikt
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Metric, Text, Title, AreaChart, Grid } from "@tremor/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TenantRecord } from "@/lib/platform/tenant-types";
import { useAppConfig } from "@/hooks/useAppConfig";
import { clampAnalyticsConfig } from "@/lib/config";

interface Props {
  record: TenantRecord;
}

/**
 * Bygger et komplett dag-array for siste `days` dager (inkl. dager uten
 * aktivitet, satt til 0). Viktig for at grafen ikke skal ha hopp.
 */
function buildDailySeries(
  activity: TenantRecord["dailyActivity"],
  days: number,
): Array<{
  date: string;
  unlocks: number;
  writes: number;
  reads: number;
}> {
  const result: Array<{ date: string; unlocks: number; writes: number; reads: number }> = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const counts = activity?.[iso] ?? { unlocks: 0, writes: 0, reads: 0 };
    result.push({
      date: iso,
      unlocks: counts.unlocks,
      writes: counts.writes,
      reads: counts.reads,
    });
  }
  return result;
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

function daysSinceIso(iso: string): number {
  const from = new Date(`${iso}T00:00:00Z`).getTime();
  const to = Date.now();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * Bruker samme fargeterskler som tenant-liste-pill for konsistens.
 */
function activityBadge(daysSince: number | null): {
  label: string;
  colorClass: string;
} {
  if (daysSince === null) {
    return {
      label: "Ingen aktivitet registrert",
      colorClass: "bg-white/5 border-white/15 text-white/50",
    };
  }
  if (daysSince === 0) {
    return {
      label: "Aktiv i dag",
      colorClass: "bg-emerald-400/15 border-emerald-400/40 text-emerald-200",
    };
  }
  if (daysSince < 7) {
    return {
      label: `${daysSince}d siden`,
      colorClass: "bg-emerald-400/15 border-emerald-400/40 text-emerald-200",
    };
  }
  if (daysSince < 30) {
    return {
      label: `${daysSince}d siden`,
      colorClass: "bg-amber-400/15 border-amber-400/40 text-amber-200",
    };
  }
  return {
    label: `${daysSince}d siden`,
    colorClass: "bg-rose-500/15 border-rose-500/40 text-rose-200",
  };
}

export function TenantAnalyticsCard({ record }: Props) {
  const { config } = useAppConfig();
  const analyticsCfg = useMemo(
    () => clampAnalyticsConfig(config.analytics),
    [config.analytics],
  );

  const [days, setDays] = useState<number>(analyticsCfg.defaultPeriodDays);
  const [showRawTable, setShowRawTable] = useState(false);

  // Hvis config endres slik at gjeldende `days` ikke er en gyldig periode
  // lenger, resett til default.
  useEffect(() => {
    if (!analyticsCfg.periodDays.includes(days)) {
      setDays(analyticsCfg.defaultPeriodDays);
    }
  }, [analyticsCfg, days]);

  const lastActivityDate = useMemo(
    () => findLastActivityDate(record.dailyActivity),
    [record.dailyActivity],
  );
  const daysSince = lastActivityDate ? daysSinceIso(lastActivityDate) : null;
  const badge = activityBadge(daysSince);

  const series = useMemo(
    () => buildDailySeries(record.dailyActivity, days),
    [record.dailyActivity, days],
  );

  const totals = useMemo(() => {
    let unlocks = 0;
    let writes = 0;
    let reads = 0;
    let activeDays = 0;
    for (const d of series) {
      unlocks += d.unlocks;
      writes += d.writes;
      reads += d.reads;
      if (d.unlocks > 0 || d.writes > 0 || d.reads > 0) activeDays++;
    }
    return { unlocks, writes, reads, activeDays };
  }, [series]);

  const hasAnyActivity = totals.unlocks + totals.writes + totals.reads > 0;

  return (
    <div className="space-y-4" data-testid="tenant-analytics-card">
      {/* Header: sist aktiv-pill + periode-picker */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-3 py-1 rounded-full border ${badge.colorClass}`}
            data-testid="tenant-analytics-last-active-badge"
          >
            {lastActivityDate ? `Sist aktiv: ${lastActivityDate} · ${badge.label}` : badge.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
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
              data-testid={`tenant-analytics-period-${d}d`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI-kort */}
      <Grid numItemsSm={2} numItemsLg={4} className="gap-3">
        <Card decoration="top" decorationColor="amber" data-testid="tenant-kpi-unlocks">
          <Text>Unlocks {days}d</Text>
          <Metric>{totals.unlocks.toLocaleString("nb-NO")}</Metric>
          <Text className="text-xs mt-1">
            snitt {(totals.unlocks / days).toFixed(1)}/dag
          </Text>
        </Card>
        <Card decoration="top" decorationColor="violet" data-testid="tenant-kpi-writes">
          <Text>Writes {days}d</Text>
          <Metric>{totals.writes.toLocaleString("nb-NO")}</Metric>
          <Text className="text-xs mt-1">
            snitt {(totals.writes / days).toFixed(1)}/dag
          </Text>
        </Card>
        <Card decoration="top" decorationColor="sky" data-testid="tenant-kpi-reads">
          <Text>Reads {days}d</Text>
          <Metric>{totals.reads.toLocaleString("nb-NO")}</Metric>
          <Text className="text-xs mt-1">
            snitt {(totals.reads / days).toFixed(1)}/dag
          </Text>
        </Card>
        <Card decoration="top" decorationColor="emerald" data-testid="tenant-kpi-active-days">
          <Text>Aktive dager</Text>
          <Metric>{totals.activeDays.toLocaleString("nb-NO")}</Metric>
          <Text className="text-xs mt-1">
            av {days} mulige ({Math.round((totals.activeDays / days) * 100)}%)
          </Text>
        </Card>
      </Grid>

      {/* Area-chart */}
      <Card data-testid="tenant-analytics-chart">
        <Title>Aktivitet over tid</Title>
        <Text className="text-xs mt-1 text-white/45">
          Unlocks, writes og reads per dag
        </Text>
        {hasAnyActivity ? (
          <>
            <AreaChart
              className="mt-4 h-72"
              data={series}
              index="date"
              categories={["unlocks", "writes", "reads"]}
              colors={["amber", "violet", "sky"]}
              yAxisWidth={56}
              minValue={0}
              valueFormatter={(v: number) => Math.round(v).toString()}
              showLegend={false}
              showGridLines
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
                <span className="inline-block w-3 h-3 rounded-sm bg-sky-400" />
                Reads
              </span>
            </div>
          </>
        ) : (
          <div className="py-12 text-center">
            <Text className="text-white/45">
              Ingen aktivitet i denne perioden.
            </Text>
            <Text className="text-xs text-white/35 mt-2">
              Tenanten har enten ikke logget inn ennå, eller aktiviteten er
              eldre enn valgt periode.
            </Text>
          </div>
        )}
      </Card>

      {/* Rå tabell (ekspanderbar) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <button
          onClick={() => setShowRawTable((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-xs text-white/70 hover:text-white transition"
          data-testid="tenant-analytics-toggle-raw"
        >
          {showRawTable ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          <span>Rå daglig tabell ({series.length} dager)</span>
        </button>
        {showRawTable && (
          <div className="px-4 pb-4 overflow-auto max-h-80">
            <table className="w-full text-xs" data-testid="tenant-analytics-raw-table">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-white/45 border-b border-white/10">
                  <th className="py-1.5 pr-2 font-medium">Dato</th>
                  <th className="py-1.5 px-2 font-medium text-right">Unlocks</th>
                  <th className="py-1.5 px-2 font-medium text-right">Writes</th>
                  <th className="py-1.5 px-2 font-medium text-right">Reads</th>
                </tr>
              </thead>
              <tbody>
                {series
                  .slice()
                  .reverse()
                  .map((d) => {
                    const empty = d.unlocks + d.writes + d.reads === 0;
                    return (
                      <tr
                        key={d.date}
                        className={`border-b border-white/5 last:border-0 ${
                          empty ? "text-white/30" : ""
                        }`}
                      >
                        <td className="py-1 pr-2 font-mono">{d.date}</td>
                        <td className="py-1 px-2 text-right font-mono">
                          {d.unlocks}
                        </td>
                        <td className="py-1 px-2 text-right font-mono">
                          {d.writes}
                        </td>
                        <td className="py-1 px-2 text-right font-mono">
                          {d.reads}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
