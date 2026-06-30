"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — am-admin Konsoll
 *
 * Refaktor: Innstillinger-fanen byttet til vault-stil `KonsoletSettingsPanel`
 * med 4 sub-tabs (Generelle / Look & Feel / Sikkerhet / Backup & Admin).
 * Bakgrunn nå styrt av `konsoll-bg-preference` (separat localStorage-nøkkel
 * fra vault). Footer-strip ("Zero-knowledge · PBKDF2 600k · …") nederst på
 * alle faner.
 *
 * Top-bar: 3 faner — Ansatte (alle) · MPW (super-admin) · Innstillinger (alle).
 * Tidligere "Innstillinger super-admin-only" har vi løsnet: alle admin-roller
 * trenger generelle/look&feel/sikkerhet for SEG SELV, men Backup & Admin-sub-
 * fanen rendres kun for super-admin.
 */
import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Users, KeyRound, Settings } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { findGradient } from "@/lib/settings/background-gradients";
import { EmployeeListSection } from "@/components/platform/am-admin/EmployeeListSection";
import { BillingStatusBanner } from "@/components/platform/am-admin/BillingStatusBanner";
import { MpwProvider } from "@/components/platform/am-admin/MpwContext";
import { MpwSection } from "@/components/platform/am-admin/MpwSection";
import { ChangePasswordForm } from "@/components/platform/am-admin/ChangePasswordForm";
import { KonsoletSettingsPanel } from "@/components/platform/am-admin/settings/KonsoletSettingsPanel";
import { KonsollFooter } from "@/components/platform/am-admin/KonsollFooter";
import {
  loadKonsollBgPreference,
  saveKonsollBgPreference,
  KONSOLL_BG_DEFAULT,
  type KonsollBgPreference,
} from "@/lib/platform/konsoll-bg-preference";
import type { B2BBillingState } from "@/lib/platform/b2b-billing";
import type { Locale } from "@/lib/i18n";

type OrgAdminPublic = {
  id: string;
  tenantPrefix: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "super-admin" | "admin";
  createdAt: string;
  createdBy: string;
  suspended: boolean;
  forcePasswordReset: boolean;
  lastLoginAt?: string;
};

type ParentInfo = {
  subdomain: string | null;
  status: string;
  plan: string;
  trialEndsAt: string | null;
  nextBillingDate: string | null;
  maxLicenses: number | null;
  activeLicenses: number | null;
  pendingLicenses: number | null;
  billingState: B2BBillingState | null;
  companyName: string | null;
  orgNumber: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  locale: string | null;
  /**
   * D-141 (2026-02): Stripe-customer-ID for parent-tenant. Brukes av
   * Konsoll → Innstillinger → Fakturering (KonsollBillingTab) for å vise
   * fakturahistorikk via `/api/am-admin/invoices`.
   */
  stripeCustomerId: string | null;
};

type MeResponse = {
  session: { iat: number; exp: number };
  admin: OrgAdminPublic;
  parent: ParentInfo | null;
};

type TabId = "employees" | "mpw" | "settings";

function Konsoll() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useLocale();
  const fallbackPrefix = params.get("orgAdminPrefix");

  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("employees");
  const [bgPref, setBgPref] = useState<KonsollBgPreference>(KONSOLL_BG_DEFAULT);
  const [mpwSetup, setMpwSetup] = useState(false);

  // Hydrer bg-preferanse fra localStorage etter mount (unngå SSR-mismatch).
  useEffect(() => {
    setBgPref(loadKonsollBgPreference());
  }, []);

  const handleBgPrefChange = useCallback((next: KonsollBgPreference) => {
    setBgPref(next);
    saveKonsollBgPreference(next);
  }, []);

  const refetchMe = useCallback(() => {
    void fetch("/api/am-admin/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: MeResponse) => setMe(data))
      .catch(() => {
        const loginUrl = fallbackPrefix
          ? `/platform/am-admin/login?orgAdminPrefix=${encodeURIComponent(fallbackPrefix)}`
          : "/";
        router.replace(loginUrl);
      });
  }, [router, fallbackPrefix]);

  useEffect(() => {
    void fetch("/api/am-admin/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: MeResponse) => setMe(data))
      .catch(() => {
        const loginUrl = fallbackPrefix
          ? `/platform/am-admin/login?orgAdminPrefix=${encodeURIComponent(fallbackPrefix)}`
          : "/";
        router.replace(loginUrl);
      })
      .finally(() => setLoading(false));
  }, [router, fallbackPrefix]);

  // Hent MPW-status (om satt opp) for Sikkerhet-fanen.
  useEffect(() => {
    void fetch("/api/am-admin/mpw/status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { setup?: boolean } | null) => {
        if (data && typeof data.setup === "boolean") setMpwSetup(data.setup);
      })
      .catch(() => {
        /* graciøst */
      });
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch("/api/am-admin/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    const loginUrl = fallbackPrefix
      ? `/platform/am-admin/login?orgAdminPrefix=${encodeURIComponent(fallbackPrefix)}`
      : "/platform/am-admin/login";
    router.replace(loginUrl);
  }, [router, fallbackPrefix]);

  const handleOrgLocaleChange = useCallback((next: Locale) => {
    setMe((prev) =>
      prev?.parent
        ? { ...prev, parent: { ...prev.parent, locale: next } }
        : prev,
    );
  }, []);

  // Beregn faktisk bakgrunn fra preference. Returnerer et "kind"-tagged
  // objekt slik at render-laget kan velge gradient-div vs Next/Image
  // (samme mønster som vault-`app/page.tsx` linje 785-825).
  const bg = (() => {
    const url = bgPref.fixedUrl;
    if (!url) {
      const aurora = findGradient("aurora");
      return {
        kind: "gradient" as const,
        css: aurora?.css ?? "#0b0e14",
      };
    }
    if (url.startsWith("gradient:")) {
      const gid = url.slice("gradient:".length);
      const g = findGradient(gid);
      return { kind: "gradient" as const, css: g?.css ?? "#0b0e14" };
    }
    return { kind: "photo" as const, url };
  })();
  const overlay = bgPref.overlay ?? 0.05;

  // Fallback-style brukes som <main> bg-CSS for gradient-tilfellet.
  // For photo lar vi <main> være transparent og rendrer <Image fill> i
  // et eget absolutt-posisjonert wrapper på z-0 (samme z-stacking-mønster
  // som vault `app/page.tsx`).
  const mainStyle: React.CSSProperties =
    bg.kind === "gradient" ? { background: bg.css } : {};

  if (loading) {
    return (
      <main
        className="min-h-screen text-white/90 flex items-center justify-center relative"
        style={mainStyle}
      >
        {bg.kind === "photo" && (
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            <Image
              key={`konsoll-bg-${bg.url}`}
              src={bg.url}
              alt=""
              fill
              className="object-cover"
              priority
              data-testid="konsoll-bg-image"
            />
          </div>
        )}
        <div className="relative text-sm text-white/55">{t("am_admin.loading")}</div>
      </main>
    );
  }

  if (!me) return null;

  // Tvinget passord-reset rendres inline før Konsoll vises.
  if (me.admin.forcePasswordReset) {
    return (
      <main
        className="min-h-screen text-white/90 flex items-center justify-center p-4 relative"
        style={mainStyle}
        data-testid="am-admin-forced-reset-shell"
      >
        {bg.kind === "photo" && (
          <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
            <Image
              key={`konsoll-bg-${bg.url}`}
              src={bg.url}
              alt=""
              fill
              className="object-cover"
              priority
            />
          </div>
        )}
        <ChangePasswordForm forced={true} onSuccess={refetchMe} />
      </main>
    );
  }

  const isSuperAdmin = me.admin.role === "super-admin";
  const orgLabel = me.parent?.companyName || me.admin.tenantPrefix;
  const billingPhase = me.parent?.billingState?.phase ?? null;

  // Tab-array:
  //   - Ansatte: alle
  //   - MPW: super-admin
  //   - Innstillinger: ALLE (sub-fanene har sin egen RBAC for Backup&Admin)
  type TabDef = { id: TabId; labelKey: string; Icon: typeof Users };
  const tabs: TabDef[] = [
    { id: "employees", labelKey: "am_admin_konsoll.tab_employees", Icon: Users },
    ...(isSuperAdmin
      ? ([{ id: "mpw" as TabId, labelKey: "am_admin_konsoll.tab_mpw", Icon: KeyRound }] satisfies TabDef[])
      : []),
    { id: "settings", labelKey: "am_admin_konsoll.tab_settings", Icon: Settings },
  ];

  // Defensiv: hvis admin er logget inn og forsøker å treffe MPW via state.
  if (!isSuperAdmin && activeTab === "mpw") {
    setActiveTab("employees");
  }

  return (
    <main
      className="min-h-screen text-white/90 relative"
      style={mainStyle}
      data-testid="am-admin-konsoll"
    >
      {/* Photo-bakgrunn — Next/Image med fill, pakket i absolute wrapper
          (samme mønster som vault `app/page.tsx`). Vi bruker IKKE `-z-10` her
          fordi `<main>` ikke skaper en stacking context (ingen z-index/isolate),
          og `-z-10` ville rømt ut og lagt bildet bak `<body>`-bakgrunnen. */}
      {bg.kind === "photo" && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <Image
            key={`konsoll-bg-${bg.url}`}
            src={bg.url}
            alt=""
            fill
            className="object-cover"
            priority
            data-testid="konsoll-bg-image"
          />
        </div>
      )}

      {/* Overlay-lag for å mørklegge bakgrunnen. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `rgba(0,0,0,${overlay})` }}
        aria-hidden
      />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* ─── Glass-pill header ────────────────────────────────── */}
        <header
          className="flex items-center justify-between gap-4 mb-6 px-5 py-3 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/15 shadow-lg"
          data-testid="konsoll-header"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold whitespace-nowrap">
              Ko|Do · {t("am_admin_konsoll.brand_label")}
            </span>
            <span className="text-white/30">·</span>
            <div
              className="text-sm font-medium truncate"
              data-testid="konsoll-org-name"
            >
              {orgLabel}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-medium" data-testid="konsoll-user-name">
                {me.admin.firstName} {me.admin.lastName}
              </div>
              <div className="text-[10px] text-white/55" data-testid="konsoll-user-role">
                {isSuperAdmin
                  ? t("am_admin.role_super_admin")
                  : t("am_admin.role_admin")}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/15 text-xs transition-colors"
              data-testid="konsoll-logout-btn"
            >
              {t("am_admin.logout_btn")}
            </button>
          </div>
        </header>

        {/* ─── Billing-banner ──────────────────────────────────── */}
        {me.parent?.billingState && (
          <div className="mb-4" data-testid="konsoll-billing-banner-wrap">
            <BillingStatusBanner
              state={me.parent.billingState}
              trialEndsAt={me.parent.trialEndsAt}
              nextBillingDate={me.parent.nextBillingDate}
            />
          </div>
        )}

        {/* ─── Top-tabs ─────────────────────────────────────── */}
        <nav
          className="flex items-center backdrop-blur-xl bg-white/[0.04] border border-white/15 rounded-full p-1 mb-6 w-fit shadow-lg"
          role="tablist"
          aria-label={t("am_admin_konsoll.tabs_aria")}
          data-testid="konsoll-tabs"
        >
          {tabs.map(({ id, labelKey, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                role="tab"
                aria-selected={active}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                  active
                    ? "bg-blue-500 text-white shadow"
                    : "text-white/65 hover:text-white/95"
                }`}
                data-testid={`konsoll-tab-${id}`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* ─── Tab-innhold ─────────────────────────────────────── */}
        <div className="space-y-6">
          {activeTab === "employees" && (
            <EmployeeListSection
              prefix={me.admin.tenantPrefix}
              companyName={me.parent?.companyName ?? null}
              maxLicenses={me.parent?.maxLicenses ?? null}
              billingPhase={billingPhase}
            />
          )}

          {activeTab === "mpw" && isSuperAdmin && (
            <MpwSection isSuperAdmin={isSuperAdmin} />
          )}

          {activeTab === "settings" && (
            <KonsoletSettingsPanel
              currentAdminId={me.admin.id}
              prefix={me.admin.tenantPrefix}
              isSuperAdmin={isSuperAdmin}
              companyName={me.parent?.companyName ?? null}
              orgNumber={me.parent?.orgNumber ?? null}
              contactName={me.parent?.contactName ?? null}
              contactEmail={me.parent?.contactEmail ?? null}
              contactPhone={me.parent?.contactPhone ?? null}
              plan={me.parent?.plan ?? "—"}
              maxLicenses={me.parent?.maxLicenses ?? null}
              activeLicenses={me.parent?.activeLicenses ?? null}
              pendingLicenses={me.parent?.pendingLicenses ?? null}
              trialEndsAt={me.parent?.trialEndsAt ?? null}
              nextBillingDate={me.parent?.nextBillingDate ?? null}
              orgEmailLocale={me.parent?.locale ?? null}
              stripeCustomerId={me.parent?.stripeCustomerId ?? null}
              lastLoginAt={me.admin.lastLoginAt ?? null}
              mpwSetup={mpwSetup}
              bgPref={bgPref}
              onBgPrefChange={handleBgPrefChange}
              onOrgEmailLocaleChange={handleOrgLocaleChange}
              onGoToMpwTab={() => {
                if (isSuperAdmin) setActiveTab("mpw");
              }}
            />
          )}
        </div>

        {/* Footer-strip på alle faner */}
        <KonsollFooter />
      </div>
    </main>
  );
}

export default function AmAdminKonsollPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#0b0e14] text-white/55 flex items-center justify-center text-sm">
          …
        </main>
      }
    >
      <MpwProvider>
        <Konsoll />
      </MpwProvider>
    </Suspense>
  );
}
