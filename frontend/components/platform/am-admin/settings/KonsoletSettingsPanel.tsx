"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll → Innstillinger
 *
 * 4-fane shell IDENTISK med vault `SettingsPanel.tsx` (per Mike-direktiv):
 *   1. Generelle      — UI-språk + org-info + default e-post-locale
 *   2. Look & Feel    — Bakgrunns-modus + overlay + 9 tiles (KONSOLL-bg-preference)
 *   3. Sikkerhet      — Passord-bytte + login-historikk + logout-all + MPW-status
 *   4. Backup & Admin — Team-administrasjon + faktura + backup-eksport (super-admin)
 *
 * Visuell signatur (matches screenshot fra vault SettingsPanel):
 *   - Pill-tab-nav øverst med amber-aktiv (#f5a623) + underline-indicator
 *   - Slate-900/95 bg, hvit/10 border, glass-blur
 *   - Sticky header med tannhjul-ikon + "Innstillinger" + (ikke X — vi er
 *     inline i Konsoll, ikke modal)
 */
import { Settings } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import { KonsollGeneralTab } from "./KonsollGeneralTab";
import { KonsollLookFeelTab } from "./KonsollLookFeelTab";
import { KonsollSecurityTab } from "./KonsollSecurityTab";
import { KonsollTeamTab } from "./KonsollTeamTab";
import { KonsollBillingTab } from "./KonsollBillingTab";
import { KonsollBackupTab } from "./KonsollBackupTab";
import type { KonsollBgPreference } from "@/lib/platform/konsoll-bg-preference";
import type { Locale } from "@/lib/i18n";

type SubTab =
  | "general"
  | "look-feel"
  | "security"
  | "team"
  | "billing"
  | "backup";

type Props = {
  currentAdminId: string;
  prefix: string;
  isSuperAdmin: boolean;
  // Org-info
  companyName: string | null;
  orgNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  plan: string;
  maxLicenses: number | null;
  activeLicenses: number | null;
  pendingLicenses: number | null;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  orgEmailLocale: string | null;
  /**
   * D-141 (2026-02): Stripe-customer-ID fra parent-tenant. Sendes videre
   * til KonsollBillingTab → InvoiceHistoryCard for fakturahistorikk.
   */
  stripeCustomerId: string | null;
  // Security
  lastLoginAt: string | null;
  mpwSetup: boolean;
  // Look & Feel
  bgPref: KonsollBgPreference;
  onBgPrefChange: (next: KonsollBgPreference) => void;
  // Cross-tab handlers
  onOrgEmailLocaleChange: (next: Locale) => void;
  onGoToMpwTab: () => void;
};

export function KonsoletSettingsPanel(props: Props) {
  const { t } = useLocale();
  const [tab, setTab] = useState<SubTab>("general");

  // Tabs som ALLE admin-roller ser. Team + Backup krever super-admin
  // (de underliggende endepunktene + komponentene håndhever det også).
  // Fakturering er synlig for alle.
  type TabDef = { key: SubTab; labelKey: string };
  const tabs: TabDef[] = [
    { key: "general", labelKey: "am_admin_settings.tab_general" },
    { key: "look-feel", labelKey: "am_admin_settings.tab_look_feel" },
    { key: "security", labelKey: "am_admin_settings.tab_security" },
    ...(props.isSuperAdmin
      ? ([{ key: "team" as SubTab, labelKey: "am_admin_settings.tab_team" }] satisfies TabDef[])
      : []),
    { key: "billing", labelKey: "am_admin_settings.tab_billing" },
    ...(props.isSuperAdmin
      ? ([{ key: "backup" as SubTab, labelKey: "am_admin_settings.tab_backup" }] satisfies TabDef[])
      : []),
  ];

  // Defensiv: hvis admin (ikke super) lander på super-admin-fane via state.
  if (!props.isSuperAdmin && (tab === "team" || tab === "backup")) {
    setTab("general");
  }

  return (
    <div
      data-testid="konsoll-settings-panel"
      className="w-full bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl text-white overflow-hidden"
    >
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-3 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
          <Settings className="h-4 w-4 text-white/80" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight">
          {t("am_admin_settings.title")}
        </h3>
      </div>

      {/* ─── Sub-tab nav ────────────────────────────────────── */}
      <div className="px-5 pt-3 pb-0 border-b border-white/10">
        <div role="tablist" className="flex flex-wrap gap-1 -mb-px">
          {tabs.map((tdef) => {
            const active = tab === tdef.key;
            return (
              <button
                key={tdef.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tdef.key)}
                className={`relative px-3.5 py-2 text-sm font-medium transition focus:outline-none ${
                  active
                    ? "text-amber-300"
                    : "text-white/55 hover:text-white/85"
                }`}
                data-testid={`konsoll-settings-tab-${tdef.key}`}
              >
                {t(tdef.labelKey)}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-2 right-2 -bottom-px h-[2px] bg-amber-400 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Content ────────────────────────────────────────── */}
      <div className="p-5">
        {tab === "general" && (
          <KonsollGeneralTab
            prefix={props.prefix}
            isSuperAdmin={props.isSuperAdmin}
            companyName={props.companyName}
            orgNumber={props.orgNumber}
            contactName={props.contactName}
            contactEmail={props.contactEmail}
            contactPhone={props.contactPhone}
            plan={props.plan}
            maxLicenses={props.maxLicenses}
            activeLicenses={props.activeLicenses}
            pendingLicenses={props.pendingLicenses}
            orgEmailLocale={props.orgEmailLocale}
            onOrgEmailLocaleChange={props.onOrgEmailLocaleChange}
          />
        )}
        {tab === "look-feel" && (
          <KonsollLookFeelTab
            pref={props.bgPref}
            onChange={props.onBgPrefChange}
          />
        )}
        {tab === "security" && (
          <KonsollSecurityTab
            lastLoginAt={props.lastLoginAt}
            mpwSetup={props.mpwSetup}
            onGoToMpwTab={props.onGoToMpwTab}
          />
        )}
        {tab === "team" && props.isSuperAdmin && (
          <KonsollTeamTab currentAdminId={props.currentAdminId} />
        )}
        {tab === "billing" && (
          <KonsollBillingTab
            trialEndsAt={props.trialEndsAt}
            nextBillingDate={props.nextBillingDate}
            maxLicenses={props.maxLicenses}
            activeLicenses={props.activeLicenses}
            pendingLicenses={props.pendingLicenses}
            plan={props.plan}
            stripeCustomerId={props.stripeCustomerId}
          />
        )}
        {tab === "backup" && props.isSuperAdmin && <KonsollBackupTab />}
      </div>
    </div>
  );
}
