"use client";
/**
 * Ko | Do · Vault — D-152 (2026-02) — Rate-Limit wrapper-kort
 *
 * Ny sub-tab under Test Tools. Innkapsler eksisterende RateLimitResetButton
 * (fra TenantViewer) i en beskrivelse + toggle-knapp for konsistens med
 * Testing-sub-taben.
 */
import { Timer } from "lucide-react";
import { RateLimitResetButton } from "./RateLimitResetButton";

export function RateLimitCard() {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4"
      data-testid="rate-limit-card"
    >
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-medium">Rate-Limit reset</h3>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Nullstill rate-limit-tellere for spesifikke buckets (login, checkout,
        email osv.). Nyttig når du tester flyter og har blitt låst ute pga
        egne test-forsøk.
      </p>
      <div className="flex items-center gap-2">
        <RateLimitResetButton />
      </div>
      <p className="text-[11px] text-white/45 leading-relaxed pt-2 border-t border-white/10">
        Kun for testing. Bruk aldri i produksjon uten grunn — legitimt brute-force-forsøk
        skal ikke resettes.
      </p>
    </div>
  );
}
