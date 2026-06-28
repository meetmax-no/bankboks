"use client";
/**
 * Ko | Do · Vault — Iter 20.4f (2026-06-26 · D-080) — SendTestInvoiceCard
 *
 * Mike-only-knapp i TenantDetailCard for å sende test-/første faktura til
 * en B2B-parent. Kun synlig hvis:
 *   - tenant.customerType === "b2b"
 *   - tenant.parentTenant === null  (kun parents — ikke children)
 *   - tenant.stripeCustomerId !== null
 *   - tenant.maxLicenses >= 1
 *
 * Confirm-modal lar Mike velge billing-frekvens (semiannual / yearly).
 * POST /api/admin/tenants/[subdomain]/send-invoice oppretter InvoiceItem +
 * Invoice (send_invoice-mode, 14d due) — webhook plukker opp resten.
 */
import { useState } from "react";
import { useLocale } from "@/lib/i18n-context";

type Props = {
  subdomain: string;
  customerType: string;
  parentTenant: string | null;
  stripeCustomerId: string | null;
  maxLicenses: number | null;
  contactEmail: string | null;
};

type Billing = "semiannual" | "yearly";

const PRICE_PER_SEAT: Record<Billing, number> = {
  semiannual: 522,
  yearly: 1044,
};

type SuccessResult = {
  invoiceId: string | null;
  hostedInvoiceUrl: string | null;
};

export function SendTestInvoiceCard(props: Props) {
  const { t } = useLocale();
  const {
    subdomain,
    customerType,
    parentTenant,
    stripeCustomerId,
    maxLicenses,
    contactEmail,
  } = props;

  const [billing, setBilling] = useState<Billing>("semiannual");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessResult | null>(null);

  // Kun synlig for B2B-parents (ikke children, ikke B2C)
  if (customerType !== "b2b" || parentTenant !== null) {
    return null;
  }

  const seats = maxLicenses ?? 0;
  const pricePerSeat = PRICE_PER_SEAT[billing];
  const total = seats * pricePerSeat;
  const emailLabel = contactEmail || "(ingen e-post)";

  const blocked = !stripeCustomerId || seats < 1;
  const blockReason = !stripeCustomerId
    ? t("send_invoice.no_customer")
    : seats < 1
      ? t("send_invoice.no_licenses")
      : null;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}/send-invoice`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ billing }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || "Unknown error");
        return;
      }
      setSuccess({
        invoiceId: data.invoiceId ?? null,
        hostedInvoiceUrl: data.hostedInvoiceUrl ?? null,
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const seatsLine = seats === 1
    ? t("send_invoice.preview_seats_singular")
    : t("send_invoice.preview_seats_plural").replace("{n}", String(seats));

  return (
    <section
      className="bg-white/[0.03] border border-white/10 rounded-2xl p-6"
      data-testid="send-invoice-card"
    >
      <header className="mb-3">
        <h3 className="text-base font-medium">
          {t("send_invoice.heading")}
        </h3>
        <p className="text-xs text-white/55 mt-1">
          {t("send_invoice.description")}
        </p>
      </header>

      {blocked && blockReason && (
        <div
          className="text-xs text-amber-200 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2 mb-3"
          data-testid="send-invoice-blocked"
        >
          {blockReason}
        </div>
      )}

      {!blocked && !open && !success && (
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg bg-white text-[#0b0e14] text-xs font-medium hover:bg-white/90"
          data-testid="send-invoice-open-btn"
        >
          {t("send_invoice.btn_open")}
        </button>
      )}

      {!blocked && open && (
        <div
          className="space-y-4 bg-white/[0.02] border border-white/10 rounded-xl p-4"
          data-testid="send-invoice-confirm-modal"
        >
          <h4 className="text-sm font-medium" data-testid="send-invoice-modal-title">
            {t("send_invoice.confirm_modal_title")}
          </h4>

          {/* Billing-valg */}
          <div>
            <label className="block text-xs text-white/55 mb-2">
              {t("send_invoice.billing_label")}
            </label>
            <div className="space-y-2">
              <label
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer ${
                  billing === "semiannual"
                    ? "bg-sky-500/10 border-sky-400/40"
                    : "bg-white/5 border-white/15 hover:border-white/25"
                }`}
                data-testid="send-invoice-radio-semiannual"
              >
                <input
                  type="radio"
                  name="billing"
                  value="semiannual"
                  checked={billing === "semiannual"}
                  onChange={() => setBilling("semiannual")}
                  className="accent-sky-400"
                />
                <span className="text-sm">{t("send_invoice.billing_semiannual")}</span>
              </label>
              <label
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer ${
                  billing === "yearly"
                    ? "bg-sky-500/10 border-sky-400/40"
                    : "bg-white/5 border-white/15 hover:border-white/25"
                }`}
                data-testid="send-invoice-radio-yearly"
              >
                <input
                  type="radio"
                  name="billing"
                  value="yearly"
                  checked={billing === "yearly"}
                  onChange={() => setBilling("yearly")}
                  className="accent-sky-400"
                />
                <span className="text-sm">{t("send_invoice.billing_yearly")}</span>
              </label>
            </div>
          </div>

          {/* Pris-preview */}
          <div
            className="bg-emerald-500/10 border border-emerald-400/25 rounded-lg px-3 py-2.5 text-xs text-emerald-100"
            data-testid="send-invoice-preview"
          >
            {t("send_invoice.preview_prefix")}
            <span className="font-mono text-emerald-200">{emailLabel}</span>
            {seatsLine}
            <strong className="text-emerald-100">{pricePerSeat}</strong>
            {t("send_invoice.preview_equals")}
            <strong
              className="text-emerald-100"
              data-testid="send-invoice-total"
            >
              {total.toLocaleString("nb-NO")}
            </strong>
            {t("send_invoice.preview_suffix")}
          </div>

          {error && (
            <div
              className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2"
              data-testid="send-invoice-error"
            >
              {t("send_invoice.failed_prefix")}
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void handleSubmit()}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-emerald-500/90 text-[#0b0e14] text-xs font-medium hover:bg-emerald-400 disabled:opacity-50"
              data-testid="send-invoice-confirm-btn"
            >
              {busy ? t("send_invoice.btn_busy") : t("send_invoice.btn_confirm")}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-white/5 text-xs hover:bg-white/10 disabled:opacity-50"
              data-testid="send-invoice-cancel-btn"
            >
              {t("send_invoice.btn_cancel")}
            </button>
          </div>
        </div>
      )}

      {success && (
        <div
          className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-3 text-xs"
          data-testid="send-invoice-success"
        >
          <div className="text-emerald-200 font-medium mb-1">
            {t("send_invoice.success_prefix")}
            <span className="font-mono">{success.invoiceId ?? "?"}</span>
          </div>
          {success.hostedInvoiceUrl && (
            <a
              href={success.hostedInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-300 hover:underline"
              data-testid="send-invoice-success-link"
            >
              {t("send_invoice.success_view_invoice")} →
            </a>
          )}
        </div>
      )}
    </section>
  );
}
