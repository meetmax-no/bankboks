"use client";

// Iter 19.9.2 — Shared <dl> flat-liste for Konfigurasjon + Klient i Fane 1.
// Per Mike-spec: 120px label / 1fr value, monospace 12px, gull dt (faded),
// hvit dd. Ingen kant per rad — flat liste innenfor accordion-boksen.

import type { ReactNode } from "react";

export interface MetaEntry {
  label: string;
  value: ReactNode;
  /** True: render value med monospace-bg (active-config, env, versjon, file). */
  mono?: boolean;
}

interface MetaListProps {
  entries: MetaEntry[];
}

export function MetaList({ entries }: MetaListProps) {
  return (
    <dl
      className="grid gap-1.5 font-mono text-[12px] leading-snug"
      data-testid="settings-meta-list"
    >
      {entries.map((e, i) => (
        <div
          key={`${e.label}-${i}`}
          className="grid grid-cols-[120px_1fr] gap-3 items-baseline"
        >
          <dt className="text-white/45 uppercase tracking-wider text-[10px] font-semibold">
            {e.label}
          </dt>
          <dd
            className={
              e.mono
                ? "text-[var(--kodo-accent)] font-mono break-all"
                : "text-white/90 break-words"
            }
          >
            {e.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
