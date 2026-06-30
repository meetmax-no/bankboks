/**
 * Ko | Do · Vault — D-139 (2026-02) — Per-kunde fakturahistorikk
 *
 * Vises i TenantDetailCard → "Stripe & Fakturaer"-tab for B2B-parents med
 * stripeCustomerId. Lister Stripe-fakturaer + sum-rad for valgt periode.
 *
 * Datofilter: siste 30d / 90d / 365d / alle. Default 90d.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2, ExternalLink, FileText, RefreshCw } from "lucide-react";

type Period = "30d" | "90d" | "365d" | "all";

interface InvoiceRow {
  id: string;
  number: string | null;
  created: number;
  status: string | null;
  amount_due_minor: number;
  amount_paid_minor: number;
  total_minor: number;
  tax_minor: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  paid_at: number | null;
  collection_method: string | null;
  kodo_billing: string | null;
  kodo_max_licenses: string | null;
}

interface Summary {
  count: number;
  total_amount_minor: number;
  total_tax_minor: number;
  total_paid_minor: number;
  currency: string;
  period: Period;
}

interface ApiResponse {
  invoices: InvoiceRow[];
  summary: Summary;
}

const PERIOD_LABELS: Record<Period, string> = {
  "30d": "Siste 30 dager",
  "90d": "Siste 90 dager",
  "365d": "Siste år",
  all: "Alle",
};

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  draft: "bg-white/10 text-white/60 border-white/15",
  void: "bg-red-500/10 text-red-300 border-red-500/30",
  uncollectible: "bg-red-500/15 text-red-300 border-red-500/30",
};

function formatMinor(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  const formatted = new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
  return `${formatted} ${currency.toUpperCase()}`;
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function InvoiceHistoryCard({
  endpoint,
  stripeCustomerId,
}: {
  /**
   * D-141 (2026-02): URL-agnostisk endepunkt så samme komponent kan brukes
   * av både Mike-admin (`/api/admin/tenants/[subdomain]/invoices`) og
   * SuperAdmin am-admin (`/api/am-admin/invoices`). Komponenten appender
   * `?period=...` automatisk.
   */
  endpoint: string;
  stripeCustomerId: string | null | undefined;
}) {
  const [period, setPeriod] = useState<Period>("90d");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(p: Period = period) {
    if (!stripeCustomerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}?period=${p}`, {
        credentials: "same-origin",
      });
      const body = (await res.json()) as ApiResponse | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `HTTP ${res.status}`);
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, endpoint]);

  if (!stripeCustomerId) {
    return (
      <div
        data-testid="invoice-history-no-customer"
        className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-xs text-white/55"
      >
        Ingen Stripe-customer registrert. Sett <code>stripeCustomerId</code> for å se fakturahistorikk.
      </div>
    );
  }

  return (
    <div
      data-testid="invoice-history-card"
      className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
    >
      {/* Header med filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-white/65" />
          <h3 className="text-xs font-mono uppercase tracking-wide text-white/85">
            Fakturahistorikk
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <select
            data-testid="invoice-history-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="text-xs font-mono px-2 py-1 rounded bg-black/40 border border-white/15 text-white/90 focus:outline-none focus:border-blue-500/60"
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="invoice-history-refresh"
            onClick={() => void load(period)}
            disabled={loading}
            className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-50 transition flex items-center gap-1.5"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Oppdater
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          data-testid="invoice-history-error"
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2"
        >
          Feil: {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.invoices.length === 0 && (
        <div
          data-testid="invoice-history-empty"
          className="text-xs text-white/55 italic py-6 text-center"
        >
          Ingen fakturaer i {PERIOD_LABELS[period].toLowerCase()}.
        </div>
      )}

      {/* Tabell */}
      {data && data.invoices.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table
            data-testid="invoice-history-table"
            className="w-full text-xs"
          >
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-white/45 font-mono">
                <th className="text-left px-2 py-1.5 font-normal">Nummer</th>
                <th className="text-left px-2 py-1.5 font-normal">Dato</th>
                <th className="text-left px-2 py-1.5 font-normal">Status</th>
                <th className="text-right px-2 py-1.5 font-normal">Beløp</th>
                <th className="text-right px-2 py-1.5 font-normal">Hvorav MVA</th>
                <th className="text-left px-2 py-1.5 font-normal">Betalt</th>
                <th className="text-center px-2 py-1.5 font-normal">PDF / Web</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr
                  key={inv.id}
                  data-testid={`invoice-row-${inv.id}`}
                  className="border-t border-white/5 hover:bg-white/[0.03]"
                >
                  <td className="px-2 py-1.5 font-mono text-white/85">
                    {inv.number ?? inv.id.slice(0, 12)}
                  </td>
                  <td className="px-2 py-1.5 text-white/70">
                    {formatDate(inv.created)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                        STATUS_STYLE[inv.status ?? ""] ??
                        "bg-white/10 text-white/55 border-white/15"
                      }`}
                    >
                      {inv.status ?? "?"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-white/85">
                    {formatMinor(inv.total_minor, inv.currency)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-white/55">
                    {formatMinor(inv.tax_minor, inv.currency)}
                  </td>
                  <td className="px-2 py-1.5 text-white/60">
                    {inv.paid_at ? formatDate(inv.paid_at) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {inv.invoice_pdf && (
                        <a
                          href={inv.invoice_pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`invoice-pdf-${inv.id}`}
                          title="Last ned PDF"
                          className="text-white/55 hover:text-white"
                        >
                          PDF
                        </a>
                      )}
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`invoice-link-${inv.id}`}
                          title="Åpne i Stripe"
                          className="text-blue-300 hover:text-blue-200 inline-flex items-center gap-0.5"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                data-testid="invoice-history-summary"
                className="border-t-2 border-white/15 font-mono text-white/85"
              >
                <td className="px-2 py-2 text-[10px] uppercase tracking-wide text-white/55">
                  Sum ({data.summary.count})
                </td>
                <td colSpan={2}></td>
                <td className="px-2 py-2 text-right">
                  {formatMinor(data.summary.total_amount_minor, data.summary.currency)}
                </td>
                <td className="px-2 py-2 text-right text-white/65">
                  {formatMinor(data.summary.total_tax_minor, data.summary.currency)}
                </td>
                <td
                  colSpan={2}
                  className="px-2 py-2 text-[10px] text-white/55 text-right"
                >
                  Betalt: {formatMinor(data.summary.total_paid_minor, data.summary.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-[10px] text-white/40 leading-relaxed">
        Fakturaer hentes direkte fra Stripe. Voided/uncollectible-fakturaer er ekskludert fra sum-raden.
      </p>
    </div>
  );
}
