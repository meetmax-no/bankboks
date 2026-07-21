"use client";
/**
 * Ko | Do · Vault — D-152 (2026-02) — Config-Verktøy wrapper-kort
 *
 * Ny sub-tab under Admin Tools. Innkapsler eksisterende ConfigToolsButton
 * (path-basert smart-merge) i en beskrivelse + toggle-knapp for konsistens
 * med Testing-sub-taben (StripeTestCard-mønster).
 */
import { Settings2 } from "lucide-react";
import { ConfigToolsButton } from "./ConfigToolsButton";

export function ConfigToolsCard() {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4"
      data-testid="config-tools-card"
    >
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-violet-300" />
        <h3 className="text-sm font-medium">Config-Verktøy (bulk-migrering)</h3>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Kjør bulk-operasjoner på tenant-client-configs. Modi: skip-existing,
        merge, smart-merge (konflikt-analyse), overwrite-all og
        re-cascade fra SA-mal. Åpner en modal med Dry-run/Kjør-flyt og
        path-basert policy-picker for smart-merge.
      </p>
      <div className="flex items-center gap-2">
        <ConfigToolsButton />
      </div>
      <p className="text-[11px] text-white/45 leading-relaxed pt-2 border-t border-white/10">
        Kjør alltid Dry-run først. Kjør er disabled til dry-run beviser at det
        er endringer å utføre. Alle mutasjoner audit-logges i tenant.notes.
      </p>
    </div>
  );
}
