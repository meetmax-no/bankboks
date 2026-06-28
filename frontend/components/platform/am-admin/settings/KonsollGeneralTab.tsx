"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll Generelle
 *
 * Innhold:
 *   1. SPRÅK (din) — LanguagePicker (4 flagg) — kun denne enheten/browseren
 *   2. ORG-INFO — read-only (firmanavn, prefix, org.nr, kontakt, plan, lisenser)
 *   3. DEFAULT E-POST-SPRÅK (org) — kun super-admin kan endre
 */
import { useState } from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";
import type { Locale } from "@/lib/i18n";
import { SeatProgressBar } from "../SeatProgressBar";

type Props = {
  prefix: string;
  isSuperAdmin: boolean;
  companyName: string | null;
  orgNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  plan: string;
  maxLicenses: number | null;
  activeLicenses: number | null;
  pendingLicenses: number | null;
  /** Org default e-post-locale (fra parent.locale) */
  orgEmailLocale: string | null;
  onOrgEmailLocaleChange: (next: Locale) => void;
};

const LOCALE_FLAGS: Record<Locale, { flag: string; label: string }> = {
  no: { flag: "🇳🇴", label: "Norsk" },
  sv: { flag: "🇸🇪", label: "Svenska" },
  da: { flag: "🇩🇰", label: "Dansk" },
  en: { flag: "🇬🇧", label: "English" },
};

export function KonsollGeneralTab(props: Props) {
  const { t, locale: uiLocale, setLocale } = useLocale();
  const [orgLocaleBusy, setOrgLocaleBusy] = useState(false);
  const [orgLocale, setOrgLocaleState] = useState<Locale | null>(
    (props.orgEmailLocale as Locale | null) ?? null,
  );

  const handleUiLocaleChange = (next: Locale) => {
    setLocale(next);
  };

  const handleOrgLocaleChange = async (next: Locale) => {
    setOrgLocaleBusy(true);
    try {
      const res = await fetch("/api/am-admin/org/locale", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }
      setOrgLocaleState(next);
      props.onOrgEmailLocaleChange(next);
      toast.success(t("am_admin_settings.org_locale_saved"));
    } finally {
      setOrgLocaleBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ─── SPRÅK (din) ───────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-general-ui-locale"
      >
        <SectionTitle>{t("am_admin_settings.ui_locale_heading")}</SectionTitle>
        <p className="text-[11px] text-white/45 mb-3 mt-1">
          {t("am_admin_settings.ui_locale_help")}
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LOCALE_FLAGS) as Locale[]).map((loc) => {
            const meta = LOCALE_FLAGS[loc];
            const active = uiLocale === loc;
            return (
              <button
                key={loc}
                onClick={() => handleUiLocaleChange(loc)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition ${
                  active
                    ? "bg-amber-400/15 border-amber-400/60 text-white"
                    : "bg-white/[0.03] border-white/10 text-white/70 hover:text-white hover:border-white/30"
                }`}
                data-testid={`konsoll-ui-locale-${loc}`}
                aria-pressed={active}
              >
                <span className="text-base leading-none">{meta.flag}</span>
                <span>{meta.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ─── ORG-INFO (read-only) ─────────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-general-org-info"
      >
        <SectionTitle>{t("am_admin_org_info.heading")}</SectionTitle>
        <p className="text-[11px] text-white/45 mb-3 mt-1">
          {t("am_admin_org_info.description")}
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field
            label={t("am_admin_org_info.field_company")}
            value={props.companyName ?? "—"}
          />
          <Field
            label={t("am_admin_org_info.field_prefix")}
            value={props.prefix}
            mono
          />
          <Field
            label={t("am_admin_org_info.field_org_number")}
            value={props.orgNumber ?? "—"}
            mono
          />
          <Field
            label={t("am_admin_org_info.field_plan")}
            value={props.plan}
            mono
          />
          <Field
            label={t("am_admin_org_info.field_contact_name")}
            value={props.contactName ?? "—"}
          />
          <Field
            label={t("am_admin_org_info.field_contact_email")}
            value={props.contactEmail ?? "—"}
            mono
          />
          <Field
            label={t("am_admin_org_info.field_contact_phone")}
            value={props.contactPhone ?? "—"}
            mono
          />
          {/* D-105 (2026-06-28): bruker felles <SeatProgressBar> i stedet
              for inline tekst-teller. Spenner over to kolonner for å gi
              progress-baren plass. */}
          <div className="sm:col-span-2">
            <dt className="text-white/45 text-[10px] uppercase tracking-wide mb-1">
              {t("am_admin_org_info.field_seats")}
            </dt>
            <SeatProgressBar
              activeSeats={props.activeLicenses ?? 0}
              pendingSeats={props.pendingLicenses ?? 0}
              maxSeats={props.maxLicenses}
            />
          </div>
        </dl>
      </section>

      {/* ─── DEFAULT E-POST-SPRÅK (org) ────────────────────────────── */}
      <section
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
        data-testid="konsoll-general-org-locale"
      >
        <SectionTitle>{t("am_admin_settings.org_locale_heading")}</SectionTitle>
        <p className="text-[11px] text-white/45 mb-3 mt-1">
          {t("am_admin_settings.org_locale_help")}
        </p>
        {props.isSuperAdmin ? (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LOCALE_FLAGS) as Locale[]).map((loc) => {
              const meta = LOCALE_FLAGS[loc];
              const active = orgLocale === loc;
              return (
                <button
                  key={loc}
                  onClick={() => void handleOrgLocaleChange(loc)}
                  disabled={orgLocaleBusy}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition disabled:opacity-50 ${
                    active
                      ? "bg-amber-400/15 border-amber-400/60 text-white"
                      : "bg-white/[0.03] border-white/10 text-white/70 hover:text-white hover:border-white/30"
                  }`}
                  data-testid={`konsoll-org-locale-${loc}`}
                >
                  <span className="text-base leading-none">{meta.flag}</span>
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="text-sm text-white/55"
            data-testid="konsoll-org-locale-readonly"
          >
            {orgLocale
              ? `${LOCALE_FLAGS[orgLocale].flag} ${LOCALE_FLAGS[orgLocale].label}`
              : "—"}
            <span className="block text-[11px] text-white/35 mt-1">
              {t("am_admin_settings.org_locale_super_admin_only")}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.12em]">
      {children}
    </h3>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-white/45 text-[10px] uppercase tracking-wide mb-0.5">
        {label}
      </dt>
      <dd className={`text-white/85 text-sm ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
