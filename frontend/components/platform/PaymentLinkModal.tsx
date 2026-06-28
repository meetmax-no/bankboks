"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 14.8 — PaymentLinkModal
 *
 * Modal som lar Mike opprette en pending tenant + Stripe Checkout-session
 * for å sende en direkte betalingslink til en kunde.
 *
 * To faser:
 *   1. Form — Mike fyller ut kunde-data
 *   2. Suksess — viser URL'en med kopier-knapp + "lukk"-aksjon
 *
 * Variant A1: når kunden betaler, auto-provisjoneres alt via eksisterende
 * webhook-flyt (Iter 13).
 */
import { useState } from "react";
import { Copy, Check, Loader2, X, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/Button";
import {
  LocaleRadioGroup,
  type Locale,
} from "@/components/platform/LocaleRadioGroup";
import { useLocale } from "@/lib/i18n-context";

type Plan = "monthly" | "yearly";
type CustomerType = "b2c" | "b2b";

interface PaymentLinkSuccess {
  ok: true;
  subdomain: string;
  email: string;
  plan: Plan;
  customerType: CustomerType;
  url: string;
  sessionId: string;
  expiresAt: string;
}

interface PaymentLinkError {
  ok?: false;
  error: string;
  detail?: string;
  stage?: string;
}

export function PaymentLinkModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLocale();
  const [form, setForm] = useState({
    subdomain: "",
    email: "",
    firstName: "",
    lastName: "",
    plan: "monthly" as Plan,
    customerType: "b2c" as CustomerType,
    // Iter 19.9.7 locale-fix: obligatorisk i selvbetjent registrering
    // siden Iter 19.9; også her i admin-flyt så lifecycle-mailer går på
    // riktig språk fra første sekund.
    locale: null as Locale | null,
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<PaymentLinkSuccess | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Iter 19.9.7 locale-fix: blokker submit hvis locale mangler.
    // Guard plassert FØR setBusy(true) for å unngå 1-tick busy-flicker.
    if (!form.locale) {
      setError(t("admin_tenants.error_locale_required"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/create-payment-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as
        | PaymentLinkSuccess
        | PaymentLinkError;
      if (!res.ok || !("ok" in data) || !data.ok) {
        const errData = data as PaymentLinkError;
        setError(
          `${errData.error ?? `HTTP ${res.status}`}${errData.stage ? ` (${errData.stage})` : ""}${errData.detail ? `: ${errData.detail}` : ""}`,
        );
        setBusy(false);
        return;
      }
      setSuccess(data);
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network_error");
      setBusy(false);
    }
  }

  async function copyToClipboard() {
    if (!success?.url) return;
    try {
      await navigator.clipboard.writeText(success.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — gammel nettleser
    }
  }

  function closeAndReset() {
    setForm({
      subdomain: "",
      email: "",
      firstName: "",
      lastName: "",
      plan: "monthly",
      customerType: "b2c",
      locale: null,
      notes: "",
    });
    setError(null);
    setSuccess(null);
    setCopied(false);
    if (success) onCreated();
    onClose();
  }

  return (
    <div
      data-testid="payment-link-modal"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-amber-400/25 rounded-2xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-500/15 border border-amber-400/30 p-2">
              <Mail className="h-4 w-4 text-amber-300" />
            </div>
            <div>
              <h3
                data-testid="payment-link-title"
                className="text-base font-semibold tracking-tight text-amber-100"
              >
                {success ? "Betalingslink klar" : "Send betalingslink"}
              </h3>
              <p className="text-xs text-white/55 mt-0.5">
                {success
                  ? "Kopier URL og send til kunden via din valgte kanal"
                  : "Auto-provisjoneres når kunden betaler"}
              </p>
            </div>
          </div>
          <button
            data-testid="payment-link-close"
            onClick={closeAndReset}
            className="text-white/55 hover:text-white"
            aria-label="Lukk"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!success ? (
          <form onSubmit={onSubmit} className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Subdomain *"
                testid="pl-subdomain"
                value={form.subdomain}
                onChange={(v) =>
                  setForm({ ...form, subdomain: v.toLowerCase() })
                }
                placeholder="kari-bedrift"
                required
                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                hint=".kodovault.no"
              />
              <Field
                label="E-post *"
                testid="pl-email"
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
                type="email"
                placeholder="kari@bedrift.no"
                required
              />
              <Field
                label="Fornavn"
                testid="pl-first-name"
                value={form.firstName}
                onChange={(v) => setForm({ ...form, firstName: v })}
                placeholder="Kari"
              />
              <Field
                label="Etternavn"
                testid="pl-last-name"
                value={form.lastName}
                onChange={(v) => setForm({ ...form, lastName: v })}
                placeholder="Hansen"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-white/55 mb-1.5 block">
                  Plan *
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <PillToggle
                    testid="pl-plan-monthly"
                    active={form.plan === "monthly"}
                    onClick={() => setForm({ ...form, plan: "monthly" })}
                    label="115 kr/mnd"
                  />
                  <PillToggle
                    testid="pl-plan-yearly"
                    active={form.plan === "yearly"}
                    onClick={() => setForm({ ...form, plan: "yearly" })}
                    label="1 104 kr/år"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-white/55 mb-1.5 block">
                  Type *
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <PillToggle
                    testid="pl-type-b2c"
                    active={form.customerType === "b2c"}
                    onClick={() =>
                      setForm({ ...form, customerType: "b2c" })
                    }
                    label="Privat"
                  />
                  <PillToggle
                    testid="pl-type-b2b"
                    active={form.customerType === "b2b"}
                    onClick={() =>
                      setForm({ ...form, customerType: "b2b" })
                    }
                    label="Bedrift"
                  />
                </div>
              </div>
            </div>

            <Field
              label="Notater (intern)"
              testid="pl-notes"
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
              placeholder="Kontekst, kontaktkanal, etc."
            />

            {/* Iter 19.9.7 locale-fix: obligatorisk språkvalg, gjenbruker
                LocaleRadioGroup fra selvbetjenings-registrering (Iter 19.9). */}
            <LocaleRadioGroup
              value={form.locale}
              onChange={(loc) => setForm({ ...form, locale: loc })}
              label={t("register.field_locale")}
            />

            {error && (
              <div
                data-testid="payment-link-error"
                className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200 font-mono break-all"
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={closeAndReset}
                data-testid="payment-link-cancel"
              >
                Avbryt
              </Button>
              <Button
                submit
                variant="primary"
                disabled={busy || !form.subdomain || !form.email || !form.locale}
                data-testid="payment-link-submit"
                leftIcon={
                  busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : undefined
                }
              >
                {busy ? "Genererer…" : "Generer link"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-5 space-y-4">
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 space-y-2">
              <div className="text-xs text-emerald-300/80 uppercase tracking-wider">
                Opprettet
              </div>
              <div className="space-y-0.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/55">Subdomain:</span>
                  <span
                    data-testid="payment-link-result-subdomain"
                    className="font-mono text-emerald-100"
                  >
                    {success.subdomain}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">E-post:</span>
                  <span className="text-emerald-100">{success.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/55">Plan:</span>
                  <span className="text-emerald-100">
                    {success.plan === "monthly" ? "Månedlig" : "Årlig"}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] uppercase tracking-wider text-white/55 mb-1.5 block">
                Betalingslink
              </label>
              <div className="rounded-lg border border-amber-400/30 bg-black/40 p-3">
                <div
                  data-testid="payment-link-url"
                  className="font-mono text-[11px] text-amber-100 break-all leading-relaxed"
                >
                  {success.url}
                </div>
              </div>
              <div className="text-[10px] text-white/40 mt-1.5">
                Utløper om 30 minutter (
                {new Date(success.expiresAt).toLocaleTimeString("no-NO", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                ). Vault auto-provisjoneres når kunden betaler.
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={copyToClipboard}
                data-testid="payment-link-copy"
                leftIcon={
                  copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )
                }
              >
                {copied ? "Kopiert!" : "Kopier link"}
              </Button>
              <a
                href={success.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="payment-link-open"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-white/15 hover:border-white/30 hover:bg-white/5 text-white text-xs font-medium transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Forhåndsvis i Stripe
              </a>
              <Button
                variant="secondary"
                onClick={closeAndReset}
                data-testid="payment-link-done"
              >
                Ferdig
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  testid,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  pattern,
  hint,
}: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  pattern?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-white/55 mb-1.5 block">
        {label}
      </label>
      <div className="relative">
        <input
          data-testid={testid}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          pattern={pattern}
          className="w-full h-9 px-3 rounded-lg bg-black/40 border border-white/15 text-sm text-white placeholder-white/30 outline-none focus:border-amber-300/60 transition"
        />
        {hint && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/40 font-mono pointer-events-none">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function PillToggle({
  testid,
  active,
  onClick,
  label,
}: {
  testid: string;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`h-9 rounded-lg text-xs font-medium transition ${
        active
          ? "bg-amber-500/20 border border-amber-400/50 text-amber-100"
          : "bg-black/30 border border-white/15 text-white/70 hover:border-white/30"
      }`}
    >
      {label}
    </button>
  );
}
