"use client";

// Iter 19.9.2 — Fane 1: Generelle innstillinger
//
// Innhold:
//  - LanguagePicker (kun app-språk, ikke koblet til tenant.locale)
//  - Klient (accordion, default ÅPEN) — henter tenant-data fra DB via
//    /api/tenant/info (Mike 2026-06-24: ikke fra default.json sin _meta)
//  - Konfigurasjon (accordion, default lukket) — flat <dl>-meta-liste fra config

import { useEffect, useState, type ReactNode } from "react";
import { Building2, ChevronDown, Sliders } from "lucide-react";
import type { AppConfig } from "@/lib/config";
import { APP_VERSION } from "@/lib/version";
import { LanguagePicker } from "@/components/LanguagePicker";
import { MetaList, type MetaEntry } from "@/components/settings/MetaList";
import { useLocale } from "@/lib/i18n-context";
import { formatLongDate } from "@/lib/format-date";

interface TenantInfo {
  fullName: string | null;
  email: string;
  subdomain: string;
  createdAt: string;
  locale: "no" | "sv" | "da" | "en" | null;
}

interface GeneralTabProps {
  config: AppConfig;
}

export function GeneralTab({ config }: GeneralTabProps) {
  const { t, locale } = useLocale();

  // Iter 19.9.2 — tenant-info hentes fra DB ved første render.
  // Same-origin fetch, ingen ekstra auth (subdomain-isolation er
  // sikkerhets-grensen). Last-state-tracking ikke nødvendig — tom
  // state gir em-dash som fallback i alle rader.
  const [tenant, setTenant] = useState<TenantInfo | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/tenant/info");
        if (!res.ok || aborted) return;
        const data = (await res.json()) as
          | ({ ok: true } & TenantInfo)
          | { ok: false };
        if (data.ok && !aborted) {
          setTenant({
            fullName: data.fullName,
            email: data.email,
            subdomain: data.subdomain,
            createdAt: data.createdAt,
            locale: data.locale,
          });
        }
      } catch {
        /* nettverksfeil → tenant forblir null → em-dash i alle rader */
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  // ─── Konfigurasjon-accordion: data fra config-fil (uendret) ─────────
  const envClient =
    typeof window !== "undefined"
      ? process.env.NEXT_PUBLIC_CLIENT_CONFIG || "default"
      : "default";
  const activeConfigPath = `clients/${envClient}.json`;

  const clipboardClearValue =
    config.security.clipboardEnabled === false
      ? t("settings.clipboard_off")
      : `${config.security.clipboardClearSeconds} ${t("settings.unit_sec")}`;

  const configEntries: MetaEntry[] = [
    { label: t("settings.kv_active_config"), value: activeConfigPath, mono: true },
    { label: t("settings.kv_env_set_to"), value: envClient, mono: true },
    { label: t("settings.kv_brand"), value: config.brand.name },
    { label: t("settings.kv_tagline"), value: config.brand.tagline },
    { label: t("settings.kv_categories"), value: `${config.categories.length}` },
    { label: t("settings.kv_backgrounds"), value: `${config.backgrounds?.length ?? 0}` },
    {
      label: t("settings.kv_auto_lock"),
      value: `${config.security.autoLockMinutes} ${t("settings.unit_min")}`,
    },
    {
      label: t("settings.kv_force_master"),
      value: `${config.security.forceMasterAfterDays} ${t("settings.unit_days")}`,
    },
    { label: t("settings.kv_clipboard_clear"), value: clipboardClearValue },
    { label: t("settings.kv_version"), value: APP_VERSION, mono: true },
    { label: t("settings.kv_datastore"), value: t("settings.datastore_value") },
  ];

  // ─── Klient-accordion: data fra tenant-DB (Mike-direktiv 2026-06-24) ─
  // Rekkefølge LÅST: KLIENT → E-POST → SUBDOMAIN → REGISTRERT → SPRÅK
  // NOTES fjernet helt. _meta røres ikke i koden.
  const emDash = t("common.em_dash");
  const langKey = tenant?.locale
    ? t(`settings.lang_${tenant.locale}_label`)
    : emDash;

  const clientEntries: MetaEntry[] = [
    {
      label: t("settings.kv_client"),
      value: tenant?.fullName ?? emDash,
    },
    {
      label: t("settings.kv_email"),
      value: tenant?.email ?? emDash,
      mono: true,
    },
    {
      label: t("settings.kv_subdomain"),
      value: tenant?.subdomain ? `${tenant.subdomain}.kodovault.no` : emDash,
      mono: true,
    },
    {
      label: t("settings.kv_registered"),
      value: tenant?.createdAt
        ? formatLongDate(tenant.createdAt, locale)
        : emDash,
    },
    {
      label: t("settings.kv_language_label"),
      value: langKey,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Språk */}
      <div
        data-testid="settings-language-row"
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              {t("settings.language_row_label")}
            </div>
            <div className="text-[11px] text-white/50 mt-0.5 leading-snug">
              {t("settings.language_row_help")}
            </div>
          </div>
          <LanguagePicker size="md" />
        </div>
      </div>

      {/* Klient — accordion (FØR Konfigurasjon, default åpen — Mike 2026-06-24) */}
      <Accordion
        testId="section-client"
        title={t("settings.section_client")}
        icon={<Building2 className="h-4 w-4 text-white/70" />}
        defaultOpen={true}
      >
        <MetaList entries={clientEntries} />
      </Accordion>

      {/* Konfigurasjon — accordion (default lukket) */}
      <Accordion
        testId="section-config"
        title={t("settings.section_config")}
        icon={<Sliders className="h-4 w-4 text-white/70" />}
        defaultOpen={false}
      >
        <MetaList entries={configEntries} />
      </Accordion>
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────

function Accordion({
  testId,
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  testId: string;
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden transition"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-3.5"
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
            {icon}
          </div>
          <span className="text-sm font-semibold text-white">{title}</span>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}
