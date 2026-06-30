"use client";
/**
 * Ko | Do · Vault — Iter 20.8b (2026-06-26) — SendTestInvoiceTab
 *
 * Test-Tools-tab-versjon av SendTestInvoiceCard. Lar Mike velge en
 * B2B-parent-tenant fra en dropdown og sende første faktura uten
 * å først navigere til tenant-detalj-siden.
 *
 * Speiler MailTestCard-mønsteret (samme styling/dropdown-flow).
 *
 * Filtreringsregler (matcher SendTestInvoiceCard's gating):
 *   - tenant.customerType === "b2b"
 *   - tenant.parentTenant === null  (kun parents, ikke children)
 *   - tenant.stripeCustomerId !== null (må kunne motta faktura)
 *   - tenant.maxLicenses >= 1
 */
import { useEffect, useState } from "react";
import { Receipt, Loader2 } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { SendTestInvoiceCard } from "./SendTestInvoiceCard";

type EligibleTenant = {
  subdomain: string;
  customerType: string;
  parentTenant: string | null;
  stripeCustomerId: string | null;
  maxLicenses: number | null;
  contactEmail: string | null;
  firstName: string | null;
};

export function SendTestInvoiceTab() {
  const { t } = useLocale();
  const [tenants, setTenants] = useState<EligibleTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubdomain, setSelectedSubdomain] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/tenants", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { tenants?: EligibleTenant[] } = await res.json();
        if (cancelled) return;
        const eligible = (data.tenants ?? []).filter(
          (tn) =>
            tn.customerType === "b2b" &&
            tn.parentTenant === null &&
            !!tn.stripeCustomerId &&
            (tn.maxLicenses ?? 0) >= 1,
        );
        setTenants(eligible);
        if (eligible.length > 0 && selectedSubdomain === "") {
          setSelectedSubdomain(eligible[0].subdomain);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "network");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    tenants.find((tn) => tn.subdomain === selectedSubdomain) ?? null;

  return (
    <div
      data-testid="send-invoice-tab"
      className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-400/15 border border-emerald-300/30 flex items-center justify-center flex-shrink-0">
          <Receipt className="h-5 w-5 text-emerald-200" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">
            {t("send_invoice_tab.heading")}
          </h3>
          <p className="text-xs text-white/55 mt-0.5 leading-relaxed">
            {t("send_invoice_tab.description")}
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="send-invoice-tenant"
          className="block text-[10px] uppercase tracking-wider text-white/55 mb-1.5 font-semibold"
        >
          {t("send_invoice_tab.tenant_label")}
        </label>
        {loading ? (
          <div
            className="flex items-center gap-2 text-sm text-white/55 py-2"
            data-testid="send-invoice-tab-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("send_invoice_tab.loading")}
          </div>
        ) : error ? (
          <p
            className="text-sm text-rose-300"
            data-testid="send-invoice-tab-error"
          >
            {error}
          </p>
        ) : tenants.length === 0 ? (
          <p
            className="text-sm text-amber-200/85 bg-amber-500/10 border border-amber-400/25 rounded-lg p-3"
            data-testid="send-invoice-tab-empty"
          >
            {t("send_invoice_tab.no_eligible_tenants")}
          </p>
        ) : (
          <select
            id="send-invoice-tenant"
            data-testid="send-invoice-tab-tenant-select"
            value={selectedSubdomain}
            onChange={(e) => setSelectedSubdomain(e.target.value)}
            className="w-full bg-neutral-900 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50 transition"
          >
            {tenants.map((tn) => (
              <option key={tn.subdomain} value={tn.subdomain}>
                {tn.subdomain}
                {tn.firstName ? ` — ${tn.firstName}` : ""}
                {tn.contactEmail ? ` (${tn.contactEmail})` : ""}
                {" · "}
                {tn.maxLicenses ?? 0} {t("send_invoice_tab.seats_unit")}
              </option>
            ))}
          </select>
        )}
      </div>

      {selected && (
        <div data-testid="send-invoice-tab-card-wrapper">
          <SendTestInvoiceCard
            subdomain={selected.subdomain}
            customerType={selected.customerType}
            parentTenant={selected.parentTenant}
            stripeCustomerId={selected.stripeCustomerId}
            maxLicenses={selected.maxLicenses}
            contactEmail={selected.contactEmail}
          />
        </div>
      )}
    </div>
  );
}
