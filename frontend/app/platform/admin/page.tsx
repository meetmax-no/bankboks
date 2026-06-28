"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 1 — /platform/admin (samlet admin-konsoll)
 *
 * Per Mike's feedback 2026-06-01: alt admin-arbeid skjer på én URL. Ingen
 * sub-routes. TenantViewer er default-view. Tab-systemet er forberedt for
 * Iter 20 (B2B-modul) — for nå er Tenants den eneste aktive tab.
 *
 * Beskyttet av middleware. "Lås" matcher AppHeader's lock-knapp 1:1 — kaller
 * vault.lock() som sletter admin-cookie automatisk via auto-lock-hook i
 * app/page.tsx, og brukeren havner på låst vault.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FlaskConical,
  Lock,
  ShieldCheck,
  Sparkles,
  Users,
  Vault,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { useVaultRuntime } from "@/lib/vault-runtime";
import { TenantViewer } from "@/components/platform/TenantViewer";
import { StripeTestCard } from "@/components/platform/StripeTestCard";
import { MailTestCard } from "@/components/platform/MailTestCard";
import { SendTestInvoiceTab } from "@/components/platform/SendTestInvoiceTab";
import { OrgAdminListCard } from "@/components/platform/OrgAdminListCard";
import { OrphanInvitesCard } from "@/components/platform/OrphanInvitesCard";
type AdminTab = "tenants" | "b2b" | "test-tools";

export default function AdminLandingPage() {
  const { t } = useLocale();
  const { vault } = useVaultRuntime();
  const [tab, setTab] = useState<AdminTab>("tenants");

  // v4.3 Iter 2.x — CMD+R / hard navigation logger ut.
  //
  // Per D-001 zero-knowledge: master-pwd-derivert nøkkel bor kun i RAM. Etter
  // en sidefornying (CMD+R) eller åpning i ny fane er vault.status alltid
  // "locked" (eller "needs-setup") fordi React-treet er reinstansiert. Den
  // HMAC-signerte admin-cookien (TTL 8t) lever derimot videre, så middleware
  // slipper brukeren inn — men UI-en sitter da med en "tom" vault bak seg.
  //
  // VaultRuntimeProvider sin auto-logout fyrer KUN ved transition
  // unlocked → !unlocked. Den fanger ikke en fersk mount der vault aldri var
  // unlocked i denne lifecyclen.
  //
  // Fix: når admin-siden monteres og vault.status har lagt seg (≠ "loading")
  // men er noe annet enn "unlocked", rydder vi cookien og redirecter til
  // vault-login med `?adminRedirect=/platform/admin` slik at bruker kommer
  // tilbake hit etter at de har låst opp på nytt.
  useEffect(() => {
    if (vault.status === "loading") return;
    if (vault.status === "unlocked") return;
    if (typeof window === "undefined") return;
    fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
    })
      .catch(() => {
        /* ignorér — cookien er uansett borte ved redirect */
      })
      .finally(() => {
        window.location.href = "/?adminRedirect=/platform/admin";
      });
  }, [vault.status]);

  function onLock() {
    // Lås vault i RAM. Side-effekten i VaultRuntimeProvider POSTer
    // /api/admin/logout og rydder cards/ids automatisk. Vi tvinger så
    // en full reload til "/" slik at brukeren havner på vault-login
    // på samme admin-host (admin.kodovault.no/) i stedet for å henge
    // igjen på /platform/admin etter at cookien er ryddet.
    vault.lock();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }

  return (
    <div
      data-testid="admin-landing-page"
      className="min-h-screen w-full bg-neutral-950 text-white"
    >
      {/* Top bar */}
      <div className="border-b border-white/10 bg-neutral-950/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full bg-blue-500/10 border border-blue-400/30 p-2">
              <ShieldCheck className="h-4 w-4 text-blue-300" />
            </div>
            <div className="min-w-0">
              <h1
                data-testid="admin-landing-title"
                className="text-sm font-semibold tracking-tight"
              >
                {t("admin_landing.title")}
              </h1>
              <p className="text-[10px] text-white/50">
                {t("admin_landing.subtitle")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              data-testid="admin-jump-to-test-btn"
              href="/platform/test"
              prefetch={false}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm rounded-full bg-amber-400/10 hover:bg-amber-400/15 text-amber-200 hover:text-amber-100 border border-amber-300/30 hover:border-amber-300/50 transition font-medium"
              aria-label={t("admin_landing.jump_to_test_aria")}
              title={t("admin_landing.jump_to_test_tooltip")}
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">{t("admin_landing.jump_to_test")}</span>
            </Link>
            <Link
              data-testid="admin-jump-to-vault-btn"
              href="/"
              prefetch={false}
              className="inline-flex items-center justify-center gap-1.5 h-10 px-3 text-sm rounded-full bg-white/10 hover:bg-blue-300/15 text-white/85 hover:text-blue-200 border border-white/20 hover:border-blue-300/40 transition font-medium"
            >
              <Vault className="h-4 w-4" />
              <span className="hidden sm:inline">{t("admin_landing.jump_to_vault")}</span>
            </Link>
            <button
              data-testid="admin-lock-btn"
              onClick={onLock}
              className="h-10 px-4 flex items-center justify-center gap-1.5 rounded-full bg-white/10 hover:bg-blue-300/15 border border-white/20 hover:border-blue-300/40 text-white/85 hover:text-blue-200 text-sm font-medium transition"
              aria-label={t("header.lock_aria")}
              title={t("header.lock_tooltip")}
            >
              <Lock className="h-4 w-4" />
              <span>{t("header.lock_label")}</span>
            </button>
          </div>
        </div>

        {/* Tab-rad */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-1">
          <TabButton
            active={tab === "tenants"}
            onClick={() => setTab("tenants")}
            testId="admin-tab-tenants"
            icon={<Users className="h-3.5 w-3.5" />}
            label={t("admin_landing.module_tenants_title")}
          />
          <TabButton
            active={tab === "b2b"}
            onClick={() => setTab("b2b")}
            testId="admin-tab-b2b"
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            label={t("admin_landing.module_b2b_title")}
          />
          <TabButton
            active={tab === "test-tools"}
            onClick={() => setTab("test-tools")}
            testId="admin-tab-test-tools"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            label={t("admin_landing.module_test_tools_title")}
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {tab === "tenants" && <TenantViewer defaultCustomerType="b2c" />}
        {tab === "test-tools" && (
          <>
            <OrgAdminListCard />
            <OrphanInvitesCard />
            <StripeTestCard />
            <MailTestCard />
            <SendTestInvoiceTab />
          </>
        )}
        {tab === "b2b" && <TenantViewer defaultCustomerType="b2b" />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  testId,
  icon,
  label,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition border-b-2 ${
        active
          ? "text-blue-200 border-blue-400"
          : disabled
          ? "text-white/30 border-transparent cursor-not-allowed"
          : "text-white/60 hover:text-white border-transparent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
