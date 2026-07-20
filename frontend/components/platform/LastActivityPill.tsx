"use client";
/**
 * Ko | Do · Vault — D-149c (2026-02) — Sist aktiv-pill for tenant-listen
 *
 * Kompakt pill som viser hvor lenge siden en tenant sist var aktiv.
 * Fargekoding:
 *   - Grønn (<7d)  — aktivt bruk
 *   - Amber (7-29d) — begynner å bli stille
 *   - Rød (≥30d)   — churn-risk
 *   - Grå          — aldri aktiv (ny/uinnlogget tenant)
 *
 * Data leses direkte fra `tenant.dailyActivity` — ingen ekstra API-kall.
 */
import type { TenantRecord } from "@/lib/platform/tenant-types";

interface Props {
  dailyActivity: TenantRecord["dailyActivity"];
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

export function LastActivityPill({ dailyActivity }: Props) {
  const lastIso = findLastActivityDate(dailyActivity);
  const days = lastIso ? daysSinceIso(lastIso) : null;

  let label: string;
  let colorClass: string;

  if (days === null) {
    label = "Aldri aktiv";
    colorClass = "bg-white/5 border-white/15 text-white/40";
  } else if (days === 0) {
    label = "Aktiv i dag";
    colorClass = "bg-emerald-400/15 border-emerald-400/40 text-emerald-200";
  } else if (days < 7) {
    label = `${days}d siden`;
    colorClass = "bg-emerald-400/15 border-emerald-400/40 text-emerald-200";
  } else if (days < 30) {
    label = `${days}d siden`;
    colorClass = "bg-amber-400/15 border-amber-400/40 text-amber-200";
  } else {
    label = `${days}d siden`;
    colorClass = "bg-rose-500/15 border-rose-500/40 text-rose-200";
  }

  return (
    <span
      className={`text-[10px] px-2.5 py-0.5 rounded-full border font-mono ${colorClass}`}
      data-testid="tenant-last-activity-pill"
      title={
        lastIso
          ? `Sist aktivitet: ${lastIso}`
          : "Tenanten har aldri logget inn eller gjort en handling som registreres"
      }
    >
      {label}
    </span>
  );
}
