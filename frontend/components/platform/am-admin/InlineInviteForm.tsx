"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-085) — InlineInviteForm
 *
 * Kompakt invite-skjema som åpner inline i Ansatte-fanen når brukeren
 * klikker "+ Ansatt". Gjenbruker samme POST /api/am-admin/invites-flyt
 * som OrgInvitesSection, men er pakket som åpne/lukk-form i Ansatte-
 * fanen så super-admin slipper å bytte tab for å invitere noen.
 *
 * Dispatcher `am-admin:invite-created` så EmployeeListSection refresher.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";

type Locale = "no" | "sv" | "da" | "en";

const SUFFIX_RX = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

function sanitizeSuffix(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
}

function isValidSuffix(s: string): boolean {
  return s.length >= 1 && SUFFIX_RX.test(s);
}

type Props = {
  prefix: string;
  onClose: () => void;
  onCreated: () => void;
};

export function InlineInviteForm({ prefix, onClose, onCreated }: Props) {
  const { t } = useLocale();
  const [form, setForm] = useState({
    suffix: "",
    email: "",
    firstName: "",
    lastName: "",
    locale: "no" as Locale,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullSubdomain = form.suffix
    ? `${prefix}-${form.suffix}`
    : `${prefix}-`;
  const previewUrl = form.suffix
    ? `${prefix}-${form.suffix}.kodovault.no`
    : null;
  const suffixValid = isValidSuffix(form.suffix);

  const handleFirstNameChange = useCallback((raw: string) => {
    setForm((f) => {
      const next = { ...f, firstName: raw };
      if (!f.suffix && raw.trim()) {
        next.suffix = sanitizeSuffix(raw);
      }
      return next;
    });
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!suffixValid) {
        setError(t("am_admin_invites.validation_error"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/am-admin/invites", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
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
          setError(
            data.detail || data.error || t("am_admin_invites.create_failed"),
          );
          return;
        }
        window.dispatchEvent(new CustomEvent("am-admin:invite-created"));
        toast.success(
          t("am_admin_employees.toast_invite_created").replace(
            "{subdomain}",
            fullSubdomain,
          ),
        );
        onCreated();
      } catch (e2) {
        setError(
          e2 instanceof Error
            ? e2.message
            : t("am_admin_invites.network_failed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [form, fullSubdomain, onCreated, suffixValid, t],
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 bg-white/[0.02] border border-white/10 rounded-xl p-4 mb-4"
      data-testid="inline-invite-form"
    >
      <div className="flex items-stretch gap-2">
        <div className="flex items-center bg-white/5 border border-white/15 rounded-lg px-3 font-mono text-sm text-white/55 select-none">
          {prefix}-
        </div>
        <input
          type="text"
          required
          autoComplete="off"
          maxLength={30}
          placeholder="kari"
          value={form.suffix}
          onChange={(e) =>
            setForm((f) => ({ ...f, suffix: sanitizeSuffix(e.target.value) }))
          }
          className={`flex-1 px-3 py-2 rounded-lg bg-black/30 border text-sm font-mono outline-none ${
            form.suffix === "" || suffixValid
              ? "border-white/15 focus:border-blue-300/60"
              : "border-rose-400/60"
          }`}
          data-testid="inline-invite-suffix"
        />
      </div>
      {previewUrl && (
        <div
          className={`p-2 rounded-lg border text-xs font-mono ${
            suffixValid
              ? "bg-emerald-500/10 border-emerald-400/30 text-emerald-100"
              : "bg-rose-500/10 border-rose-400/30 text-rose-200"
          }`}
          data-testid="inline-invite-preview"
        >
          https://{previewUrl}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          placeholder={t("am_admin_invites.first_name_label")}
          value={form.firstName}
          onChange={(e) => handleFirstNameChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
          data-testid="inline-invite-firstname"
        />
        <input
          type="text"
          placeholder={t("am_admin_invites.last_name_label")}
          value={form.lastName}
          onChange={(e) =>
            setForm((f) => ({ ...f, lastName: e.target.value }))
          }
          className="px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
          data-testid="inline-invite-lastname"
        />
      </div>
      <input
        type="email"
        placeholder={t("am_admin_invites.email_placeholder")}
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
        data-testid="inline-invite-email"
      />
      <select
        value={form.locale}
        onChange={(e) =>
          setForm((f) => ({ ...f, locale: e.target.value as Locale }))
        }
        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-sm"
        data-testid="inline-invite-locale"
      >
        <option value="no">{t("am_admin_invites.locale_option_no")}</option>
        <option value="sv">{t("am_admin_invites.locale_option_sv")}</option>
        <option value="da">{t("am_admin_invites.locale_option_da")}</option>
        <option value="en">{t("am_admin_invites.locale_option_en")}</option>
      </select>

      {error && (
        <p className="text-xs text-rose-300" data-testid="inline-invite-error">
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
          data-testid="inline-invite-cancel"
        >
          {t("am_admin_invites.close_btn")}
        </button>
        <button
          type="submit"
          disabled={busy || !suffixValid}
          className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium"
          data-testid="inline-invite-submit"
        >
          {busy
            ? t("am_admin_invites.submit_busy")
            : t("am_admin_invites.submit_btn")}
        </button>
      </div>
    </form>
  );
}
