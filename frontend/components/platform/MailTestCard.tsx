"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 17 (2026-06-13) — Admin lifecycle-mail-testkort
 *
 * Lar Mike sende én testmail av valgt type til valgt tenant, uten å gå
 * via curl. Bygger på /api/admin/test-lifecycle-mail (middleware-beskyttet
 * — ingen Bearer trengs siden vi er inne i admin-sesjon).
 *
 * Lister tenants via /api/admin/tenants så Mike kan dropdown-velge i
 * stedet for å huske subdomain.
 *
 * Synlig i admin → Test Tools-fanen.
 */
import { useEffect, useState } from "react";
import { Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

type MailType =
  | "trial-reminder-t5"
  | "locked-from-trial"
  | "locked-from-cancel"
  | "lifecycle-warning"
  | "deleted-confirmation";

const MAIL_TYPE_LABELS: Record<MailType, string> = {
  "trial-reminder-t5": "A1 — Trial T-5 påminnelse",
  "locked-from-trial": "A2 — Trial → låst",
  "locked-from-cancel": "B1 — Kansellert → låst",
  "lifecycle-warning": "A3 — Slettes om N dager (generisk)",
  "deleted-confirmation": "A4 — Sletting bekreftet",
};

// Locale-toggle for testing — påvirker KUN testmailer fra dette panelet,
// ikke produksjons-mail som fortsatt bruker tenant.locale. "auto" =
// følg tenantens egen locale. Etter Iter 19.9 vil tenant.locale alltid
// være et eksplisitt brukervalg (NO/SV/DA/EN).
type LocaleChoice = "auto" | "no" | "sv" | "da" | "en";

const LOCALE_LABELS: Record<LocaleChoice, string> = {
  auto: "Auto (følg tenant)",
  no: "Norsk (NO)",
  sv: "Svensk (SV)",
  da: "Dansk (DA)",
  en: "Engelsk (EN)",
};

interface TenantOption {
  subdomain: string;
  status?: string;
  contactEmail?: string | null;
  email?: string;
  locale?: string;
}

interface SendResult {
  ok?: boolean;
  tenant?: {
    subdomain?: string;
    contactEmail?: string;
    locale?: string;
    effectiveLocale?: string;
    localeOverride?: string | null;
    lifecycleEmailsPref?: boolean;
  };
  emailResult?: {
    ok?: boolean;
    emailId?: string;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
  diag?: {
    EMAIL_ENABLED?: boolean;
    RESEND_API_KEY_set?: boolean;
    RESEND_FROM_EMAIL_set?: boolean;
  };
  error?: string;
}

export function MailTestCard() {
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [subdomain, setSubdomain] = useState<string>("");
  const [type, setType] = useState<MailType>("trial-reminder-t5");
  const [localeChoice, setLocaleChoice] = useState<LocaleChoice>("auto");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Last tenant-listen ved mount
  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/tenants");
        if (aborted) return;
        if (!res.ok) {
          setError(`Kunne ikke hente tenant-listen (HTTP ${res.status})`);
          setLoading(false);
          return;
        }
        const data = (await res.json()) as {
          tenants?: TenantOption[];
        };
        const list = data.tenants ?? [];
        setTenants(list);
        if (list.length > 0 && !subdomain) setSubdomain(list[0].subdomain);
        setLoading(false);
      } catch (e) {
        if (!aborted) {
          setError(e instanceof Error ? e.message : "network");
          setLoading(false);
        }
      }
    })();
    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend() {
    if (!subdomain) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/test-lifecycle-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain,
          type,
          // Send kun localeOverride hvis brukeren eksplisitt valgte NO/EN.
          // "auto" → utelat feltet → backend bruker tenant.locale som før.
          ...(localeChoice === "auto" ? {} : { localeOverride: localeChoice }),
        }),
      });
      const data = (await res.json()) as SendResult;
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
    } finally {
      setSending(false);
    }
  }

  // Avled resultat-status for badge
  const r = result?.emailResult;
  const success = r?.ok === true;
  const skipped = r?.skipped === true;

  return (
    <div
      data-testid="mail-test-card"
      className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center flex-shrink-0">
          <Mail className="h-5 w-5 text-amber-200" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-white">
            Lifecycle-mail testsending
          </h3>
          <p className="text-xs text-white/55 mt-0.5 leading-relaxed">
            Sender én mail av valgt type til valgt tenant. Ignorerer
            idempotens-flagg — du kan teste samme type flere ganger.
            Endrer ingen tenant-data.
          </p>
        </div>
      </div>

      {/* Tenant + type + locale-velger */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label
            htmlFor="mail-test-tenant"
            className="block text-[10px] uppercase tracking-wider text-white/55 mb-1.5 font-semibold"
          >
            Tenant
          </label>
          <select
            id="mail-test-tenant"
            data-testid="mail-test-tenant-select"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            disabled={loading || sending}
            className="w-full bg-neutral-900 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50 transition disabled:opacity-50"
          >
            {loading ? (
              <option>Laster…</option>
            ) : tenants.length === 0 ? (
              <option>Ingen tenants funnet</option>
            ) : (
              tenants.map((tn) => (
                <option key={tn.subdomain} value={tn.subdomain}>
                  {tn.subdomain}
                  {tn.contactEmail || tn.email
                    ? ` (${tn.contactEmail ?? tn.email})`
                    : ""}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label
            htmlFor="mail-test-type"
            className="block text-[10px] uppercase tracking-wider text-white/55 mb-1.5 font-semibold"
          >
            Mail-type
          </label>
          <select
            id="mail-test-type"
            data-testid="mail-test-type-select"
            value={type}
            onChange={(e) => setType(e.target.value as MailType)}
            disabled={sending}
            className="w-full bg-neutral-900 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50 transition disabled:opacity-50"
          >
            {(Object.keys(MAIL_TYPE_LABELS) as MailType[]).map((k) => (
              <option key={k} value={k}>
                {MAIL_TYPE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="mail-test-locale"
            className="block text-[10px] uppercase tracking-wider text-white/55 mb-1.5 font-semibold"
          >
            Språk (kun test)
          </label>
          <select
            id="mail-test-locale"
            data-testid="mail-test-locale-select"
            value={localeChoice}
            onChange={(e) => setLocaleChoice(e.target.value as LocaleChoice)}
            disabled={sending}
            className="w-full bg-neutral-900 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-400/50 transition disabled:opacity-50"
          >
            {(Object.keys(LOCALE_LABELS) as LocaleChoice[]).map((k) => (
              <option key={k} value={k}>
                {LOCALE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Send-knapp */}
      <button
        data-testid="mail-test-send-btn"
        onClick={handleSend}
        disabled={!subdomain || sending || loading}
        className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-amber-500 hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/40 text-black text-sm font-semibold transition disabled:cursor-not-allowed"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sender…
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" />
            Send testmail
          </>
        )}
      </button>

      {/* Resultat */}
      {error && (
        <div
          data-testid="mail-test-error"
          className="flex items-start gap-3 px-3 py-3 rounded-xl bg-rose-500/10 border border-rose-400/30"
        >
          <AlertCircle className="h-4 w-4 text-rose-300 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-rose-200 font-medium">{error}</div>
          </div>
        </div>
      )}

      {result && (
        <div
          data-testid="mail-test-result"
          className={`rounded-xl border p-4 ${
            success
              ? "bg-emerald-500/10 border-emerald-400/30"
              : skipped
                ? "bg-amber-500/10 border-amber-400/30"
                : "bg-rose-500/10 border-rose-400/30"
          }`}
        >
          <div className="flex items-start gap-3">
            {success ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-300 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle
                className={`h-5 w-5 flex-shrink-0 mt-0.5 ${
                  skipped ? "text-amber-300" : "text-rose-300"
                }`}
              />
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="text-sm font-semibold text-white">
                {success
                  ? `Sendt ✓ (${r?.emailId ?? "ingen ID"})`
                  : skipped
                    ? `Hoppet over: ${r?.reason ?? "?"}`
                    : `Feilet: ${r?.error ?? error ?? "?"}`}
              </div>
              {result.tenant && (
                <div className="text-xs text-white/70 space-y-0.5 font-mono">
                  <div>tenant: {result.tenant.subdomain}</div>
                  <div>til: {result.tenant.contactEmail ?? "—"}</div>
                  <div>
                    locale: {result.tenant.locale ?? "—"}
                    {result.tenant.localeOverride
                      ? ` → overstyrt til ${result.tenant.effectiveLocale} (test)`
                      : ""}
                  </div>
                  <div>
                    lifecycle-mail-pref:{" "}
                    {result.tenant.lifecycleEmailsPref ? "på" : "av"}
                  </div>
                </div>
              )}
              {result.diag && (
                <div className="text-[10px] text-white/45 font-mono">
                  EMAIL_ENABLED: {String(result.diag.EMAIL_ENABLED)} ·{" "}
                  RESEND_API_KEY:{" "}
                  {result.diag.RESEND_API_KEY_set ? "✓" : "✗"} ·{" "}
                  FROM_EMAIL:{" "}
                  {result.diag.RESEND_FROM_EMAIL_set ? "✓" : "✗"}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
