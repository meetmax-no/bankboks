"use client";
/**
 * Ko | Do · Vault — Iter 20.3 patch + 20.4c — OrgInvitesSection
 *
 * Forenklet "+ Ny invitasjon"-skjema for am-admin. Listen over invitasjoner
 * vises nå i EmployeeListSection (unified ansatt-tabell) — denne komponenten
 * inneholder KUN opprett-skjemaet.
 *
 * UX:
 *   - Navnefeltet (suffix) er primært. Når am-admin skriver "kari" vises
 *     live forhåndsvisning: `mm-kari.kodovault.no`.
 *   - Fornavn/etternavn/e-post er sekundære felter.
 *   - Etter opprettelse dispatcher vi `am-admin:invite-created`-event så
 *     EmployeeListSection refresher uten reload.
 *
 * Iter 20.4c (D-080): mottar `billingPhase` fra parent. I grace/expired-
 * fasen deaktiveres "+ Ny invitasjon"-knappen + forklarings-tekst.
 */
import { useCallback, useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import type { B2BBillingPhase } from "@/lib/platform/b2b-billing";

type Props = {
  prefix: string;
  /** Iter 20.4c: parent billing-phase fra /me — null = ukjent (vis som normal). */
  billingPhase?: B2BBillingPhase | null;
};

type Locale = "no" | "sv" | "da" | "en";

// Subdomain-suffix: a-z0-9, kan ha bindestrek i midten, max 30 tegn
const SUFFIX_RX = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

function sanitizeSuffix(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

function isValidSuffix(s: string): boolean {
  return s.length >= 1 && SUFFIX_RX.test(s);
}

export function OrgInvitesSection({ prefix, billingPhase = null }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    suffix: "",
    email: "",
    firstName: "",
    lastName: "",
    locale: "no" as Locale,
  });
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    inviteUrl: string;
    mailSent: boolean;
  } | null>(null);

  // Iter 20.4c (D-080): blokker UI-handling hvis parent er i grace eller
  // expired. POST-endepunktet returnerer også 403, men vi vil ikke at
  // skjemaet i det hele tatt skal være åpnelig.
  const invitesBlocked =
    billingPhase === "grace" || billingPhase === "expired";

  const fullSubdomain = form.suffix
    ? `${prefix}-${form.suffix}`
    : `${prefix}-`;
  const previewUrl = form.suffix
    ? `${prefix}-${form.suffix}.kodovault.no`
    : null;
  const suffixIsValid = isValidSuffix(form.suffix);

  const handleSuffixChange = useCallback((raw: string) => {
    setForm((f) => ({ ...f, suffix: sanitizeSuffix(raw) }));
  }, []);

  // Auto-forslå suffix fra fornavn hvis suffix er tomt
  const handleFirstNameChange = useCallback((raw: string) => {
    setForm((f) => {
      const next = { ...f, firstName: raw };
      if (!f.suffix && raw.trim()) {
        next.suffix = sanitizeSuffix(raw);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!suffixIsValid) {
        setCreateError(t("am_admin_invites.validation_error"));
        return;
      }
      setBusy(true);
      setCreateError(null);
      setLastResult(null);
      try {
        const res = await fetch("/api/am-admin/invites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            subdomain: fullSubdomain,
            email: form.email || undefined,
            firstName: form.firstName || undefined,
            lastName: form.lastName || undefined,
            locale: form.locale,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCreateError(data.detail || data.error || t("am_admin_invites.create_failed"));
          return;
        }
        setLastResult({
          inviteUrl: data.inviteUrl,
          mailSent: data.mailSent ?? false,
        });
        setForm({
          suffix: "",
          email: "",
          firstName: "",
          lastName: "",
          locale: "no",
        });
        // Si fra til EmployeeListSection at den må refreshe
        window.dispatchEvent(new CustomEvent("am-admin:invite-created"));
      } catch (e) {
        setCreateError(e instanceof Error ? e.message : t("am_admin_invites.network_failed"));
      } finally {
        setBusy(false);
      }
    },
    [form, fullSubdomain, suffixIsValid, t],
  );

  return (
    <section
      className="bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl p-6"
      data-testid="org-invites-section"
    >
      <header className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-medium">{t("am_admin_invites.heading")}</h2>
          <p className="text-xs text-white/55">
            {t("am_admin_invites.description")}
          </p>
        </div>
        {!open && !invitesBlocked && (
          <button
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-white text-[#0b0e14] text-xs font-medium hover:bg-white/90"
            data-testid="org-invites-open-create"
          >
            {t("am_admin_invites.new_btn")}
          </button>
        )}
        {invitesBlocked && (
          <button
            disabled
            className="px-3 py-1.5 rounded-lg bg-white/10 text-white/40 text-xs font-medium cursor-not-allowed"
            data-testid="org-invites-blocked-btn"
            title={t("am_admin_invites.blocked_tooltip")}
          >
            {t("am_admin_invites.new_btn_disabled")}
          </button>
        )}
      </header>

      {invitesBlocked && (
        <div
          className="text-xs bg-rose-500/10 border border-rose-400/25 text-rose-100/85 rounded-lg px-3 py-2.5 mb-3"
          data-testid="org-invites-blocked-message"
          role="status"
        >
          {t("am_admin_invites.blocked_message")}
        </div>
      )}

      {open && (
        <form
          onSubmit={handleCreate}
          className="space-y-4 bg-white/[0.02] border border-white/10 rounded-xl p-4"
          data-testid="org-invites-create-form"
        >
          {/* Subdomain-felt med live preview */}
          <div>
            <label
              htmlFor="org-invite-suffix"
              className="block text-xs text-white/55 mb-1.5"
            >
              {t("am_admin_invites.suffix_label")}
            </label>
            <div className="flex items-stretch gap-2">
              <div className="flex items-center bg-white/5 border border-white/15 rounded-lg px-3 font-mono text-sm text-white/55 select-none">
                {prefix}-
              </div>
              <input
                id="org-invite-suffix"
                type="text"
                required
                autoComplete="off"
                maxLength={30}
                placeholder="kari"
                value={form.suffix}
                onChange={(e) => handleSuffixChange(e.target.value)}
                className={`flex-1 px-3 py-2 rounded-lg bg-white/5 border text-sm font-mono outline-none ${
                  form.suffix === "" || suffixIsValid
                    ? "border-white/15 focus:border-blue-300/60"
                    : "border-rose-400/60"
                }`}
                data-testid="org-invites-suffix"
                aria-describedby="org-invite-preview"
              />
            </div>
            {/* Live forhåndsvisning */}
            {previewUrl && (
              <div
                id="org-invite-preview"
                className={`mt-2 p-2.5 rounded-lg border text-xs ${
                  suffixIsValid
                    ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-100"
                    : "bg-rose-500/10 border-rose-400/30 text-rose-200"
                }`}
                data-testid="org-invites-url-preview"
              >
                <span className="text-white/55 mr-1">{t("am_admin_invites.url_preview_label")}</span>
                <span
                  className="font-mono font-medium"
                  data-testid="org-invites-url-preview-value"
                >
                  https://{previewUrl}
                </span>
              </div>
            )}
          </div>

          {/* Navn-felter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="org-invite-firstname"
                className="block text-xs text-white/55 mb-1.5"
              >
                {t("am_admin_invites.first_name_label")}
              </label>
              <input
                id="org-invite-firstname"
                type="text"
                placeholder="Kari"
                value={form.firstName}
                onChange={(e) => handleFirstNameChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-sm"
                data-testid="org-invites-first-name"
              />
            </div>
            <div>
              <label
                htmlFor="org-invite-lastname"
                className="block text-xs text-white/55 mb-1.5"
              >
                {t("am_admin_invites.last_name_label")}
              </label>
              <input
                id="org-invite-lastname"
                type="text"
                placeholder="Nordmann"
                value={form.lastName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lastName: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-sm"
                data-testid="org-invites-last-name"
              />
            </div>
          </div>

          {/* E-post */}
          <div>
            <label
              htmlFor="org-invite-email"
              className="block text-xs text-white/55 mb-1.5"
            >
              {t("am_admin_invites.email_label")}
            </label>
            <input
              id="org-invite-email"
              type="email"
              placeholder={t("am_admin_invites.email_placeholder")}
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-sm"
              data-testid="org-invites-email"
            />
          </div>

          {/* Språk */}
          <div>
            <label
              htmlFor="org-invite-locale"
              className="block text-xs text-white/55 mb-1.5"
            >
              {t("am_admin_invites.locale_label")}
            </label>
            <select
              id="org-invite-locale"
              value={form.locale}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  locale: e.target.value as Locale,
                }))
              }
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-sm"
              data-testid="org-invites-locale"
            >
              <option value="no">{t("am_admin_invites.locale_option_no")}</option>
              <option value="sv">{t("am_admin_invites.locale_option_sv")}</option>
              <option value="da">{t("am_admin_invites.locale_option_da")}</option>
              <option value="en">{t("am_admin_invites.locale_option_en")}</option>
            </select>
          </div>

          {createError && (
            <div
              className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded px-3 py-2"
              data-testid="org-invites-create-error"
            >
              {createError}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !suffixIsValid}
              className="px-4 py-2 rounded-lg bg-white text-[#0b0e14] text-xs font-medium hover:bg-white/90 disabled:opacity-50"
              data-testid="org-invites-submit"
            >
              {busy
                ? t("am_admin_invites.submit_busy")
                : t("am_admin_invites.submit_btn")}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateError(null);
                setLastResult(null);
              }}
              className="px-4 py-2 rounded-lg bg-white/5 text-xs hover:bg-white/10"
            >
              {t("am_admin_invites.close_btn")}
            </button>
          </div>
        </form>
      )}

      {lastResult && (
        <div
          className="bg-emerald-500/5 border border-emerald-400/25 rounded-xl p-3 mt-3 text-xs"
          data-testid="org-invites-result"
        >
          <div className="text-emerald-200 font-medium mb-1">
            {lastResult.mailSent
              ? t("am_admin_invites.success_with_email")
              : t("am_admin_invites.success_without_email")}
          </div>
          <div className="font-mono break-all text-white/70">
            {lastResult.inviteUrl}
          </div>
        </div>
      )}
    </section>
  );
}
