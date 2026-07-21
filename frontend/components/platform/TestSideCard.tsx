"use client";
/**
 * Ko | Do · Vault — D-152 (2026-02) — Test-side wrapper-kort
 *
 * Ny sub-tab under Test Tools. Erstatter den gule "Test-side"-knappen i
 * admin-header. Følger samme mønster som ConfigToolsCard/RateLimitCard.
 */
import Link from "next/link";
import { Sparkles, ExternalLink } from "lucide-react";

export function TestSideCard() {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 space-y-4"
      data-testid="test-side-card"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-medium">Test-side (/platform/test)</h3>
      </div>
      <p className="text-xs text-white/60 leading-relaxed">
        Sandbox-side med diverse eksperimentelle komponenter og test-flyter.
        Bruk denne for å prøve ut nye ideer uten å påvirke ekte tenants eller
        prod-data.
      </p>
      <div>
        <Link
          data-testid="test-side-open-link"
          href="/platform/test"
          prefetch={false}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-amber-400/10 hover:bg-amber-400/20 text-amber-200 hover:text-amber-100 border border-amber-300/30 hover:border-amber-300/50 transition text-xs font-medium"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Åpne test-side
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Link>
      </div>
    </div>
  );
}
