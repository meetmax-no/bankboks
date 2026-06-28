"use client";

import {
  ClipboardX,
  CloudOff,
  FlaskConical,
  Lock,
  Package,
  RefreshCw,
  ServerCrash,
  Settings,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useIsMobile } from "@/hooks/useIsMobile";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useLocale } from "@/lib/i18n-context";

interface AppHeaderProps {
  status: "loading" | "needs-setup" | "locked" | "unlocked";
  netStatus?: "online" | "offline" | "server-error";
  refreshing?: boolean;
  clipboardEnabled?: boolean;
  /** Hvis true: vis 📦-knapp i header (v4.0-features.packages.enabled). */
  packagesEnabled?: boolean;
  /**
   * Iter 19 — true når PaywallOverlay viser paywall (status=locked eller
   * trial-utløpt). Disabler alle action-knapper unntatt Lock + Settings
   * (som rommer "Administrer abonnement" + logout). Per Mike-spec
   * (app/page.tsx linje 190-193).
   */
  paywallActive?: boolean;
  onLockClick?: () => void;
  onSearchClick?: () => void;
  onSettingsClick?: () => void;
  onPasswordLabClick?: () => void;
  onRefreshClick?: () => void;
  onClipboardClearClick?: () => void;
  onPackagesClick?: () => void;
}

export function AppHeader({
  status,
  netStatus = "online",
  refreshing = false,
  clipboardEnabled = true,
  packagesEnabled = false,
  paywallActive = false,
  onLockClick,
  onSearchClick,
  onSettingsClick,
  onPasswordLabClick,
  onRefreshClick,
  onClipboardClearClick,
  onPackagesClick,
}: AppHeaderProps) {
  const { config } = useAppConfig();
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const brand = config.brand;

  const statusBadge = (() => {
    if (status === "unlocked") {
      return (
        <span
          data-testid="header-status-unlocked"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/30 text-[9px] font-bold uppercase tracking-wider text-emerald-200"
          title={t("header.status_unlocked_tooltip")}
        >
          <ShieldCheck className="h-2.5 w-2.5" />
          {t("header.status_unlocked_label")}
        </span>
      );
    }
    if (status === "locked") {
      return (
        <span
          data-testid="header-status-locked"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/10 border border-white/20 text-[9px] font-bold uppercase tracking-wider text-white/70"
          title={t("header.status_locked_tooltip")}
        >
          <Lock className="h-2.5 w-2.5" />
          {t("header.status_locked_label")}
        </span>
      );
    }
    return null;
  })();

  const netBadge = (() => {
    if (netStatus === "offline") {
      return (
        <span
          data-testid="header-net-offline"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-400/40 text-[9px] font-bold uppercase tracking-wider text-rose-200"
          title={t("header.net_offline_tooltip")}
        >
          <CloudOff className="h-2.5 w-2.5" />
          {t("header.net_offline_label")}
        </span>
      );
    }
    if (netStatus === "server-error") {
      return (
        <span
          data-testid="header-net-server-error"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/40 text-[9px] font-bold uppercase tracking-wider text-amber-200"
          title={t("header.net_server_error_tooltip")}
        >
          <ServerCrash className="h-2.5 w-2.5" />
          {t("header.net_server_error_label")}
        </span>
      );
    }
    return (
      <span
        data-testid="header-net-online"
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-400/10 border border-emerald-300/20 text-[9px] font-bold uppercase tracking-wider text-emerald-300/80"
        title={t("header.net_online_tooltip")}
      >
        <Wifi className="h-2.5 w-2.5" />
        {!isMobile && t("header.net_online_label")}
      </span>
    );
  })();

  const [brandPrefix, brandSuffix] = (() => {
    const parts = brand.name.split("·").map((s) => s.trim());
    if (parts.length >= 2) return [parts[0], parts.slice(1).join(" · ")];
    return [brand.name, ""];
  })();

  const unlocked = status === "unlocked";

  // v4.3 Iter 1 — "Hopp til admin"-snarvei. Kun synlig når host = admin.kodovault.no
  // (+ dev/preview-hosts) OG vault er unlocked. Skjuler seg automatisk for alle
  // andre tenants. Mounted-flag for å unngå hydration-mismatch.
  const [isAdminHost, setIsAdminHost] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname.toLowerCase();
    const match =
      host === "admin.kodovault.no" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".preview.emergentagent.com") ||
      host.endsWith(".preview.emergentcf.cloud") ||
      host.endsWith(".vercel.app");
    setIsAdminHost(match);
  }, []);

  return (
    <header
      data-testid="app-header"
      className="absolute top-0 left-0 right-0 z-20"
    >
      <div className="max-w-3xl mx-auto flex items-start justify-between gap-3 px-4 sm:px-6 py-4 sm:py-5">
        {/* Tittel + badges under */}
        <div className="flex flex-col min-w-0 gap-2">
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight drop-shadow-lg leading-none truncate">
            <span className="text-white/85">{brandPrefix}</span>
            {brandSuffix && (
              <>
                <span className="mx-1.5 sm:mx-2 text-white/50">·</span>
                <span className="font-semibold text-white">{brandSuffix}</span>
              </>
            )}
          </h1>
          <div className="flex items-center gap-1.5 flex-wrap">
            {statusBadge}
            {netBadge}
          </div>
        </div>

        {/* Action-ikoner — skjult på mobil (vises i MobileBottomBar), desktop én rad.
            Søk-knappen er fjernet fra header (v2.9.5+) — Cmd+K-hint vises i desktop-footer.
            LanguagePicker (v4.2 D-036) håndteres separat utenfor max-w-3xl-containeren
            for å hugge viewport-høyre-kanten på desktop. */}
        <div className="hidden sm:flex sm:items-center gap-2 flex-shrink-0">
          {unlocked && isAdminHost && !paywallActive && (
            <Link
              data-testid="header-jump-to-admin-btn"
              href="/platform/admin"
              prefetch={false}
              className="h-10 px-3 flex items-center justify-center gap-1.5 rounded-full bg-white/10 hover:bg-blue-300/15 border border-white/20 hover:border-blue-300/40 text-white/85 hover:text-blue-200 text-sm font-medium transition"
              aria-label={t("header.jump_to_admin_aria")}
              title={t("header.jump_to_admin_tooltip")}
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden md:inline">{t("header.jump_to_admin_label")}</span>
            </Link>
          )}

          {unlocked && onPasswordLabClick && (
            <button
              data-testid="header-password-lab-btn"
              onClick={onPasswordLabClick}
              disabled={paywallActive}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-violet-300/15 border border-white/20 hover:border-violet-300/40 text-white/85 hover:text-violet-200 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/10 disabled:hover:border-white/20 disabled:hover:text-white/85"
              aria-label={t("header.password_lab_aria")}
              title={paywallActive ? t("header.paywall_disabled_tooltip") : t("header.password_lab_tooltip")}
            >
              <FlaskConical className="h-4 w-4" />
            </button>
          )}

          {unlocked && onRefreshClick && (
            <button
              data-testid="header-refresh-btn"
              onClick={onRefreshClick}
              disabled={refreshing || paywallActive}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-blue-300/15 border border-white/20 hover:border-blue-300/40 text-white/85 hover:text-blue-200 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10 disabled:hover:border-white/20 disabled:hover:text-white/85"
              aria-label={t("header.refresh_aria")}
              title={paywallActive ? t("header.paywall_disabled_tooltip") : t("header.refresh_tooltip")}
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </button>
          )}

          {unlocked && clipboardEnabled && onClipboardClearClick && (
            <button
              data-testid="header-clipboard-clear-btn"
              onClick={onClipboardClearClick}
              disabled={paywallActive}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-amber-300/15 border border-white/20 hover:border-amber-300/40 text-white/85 hover:text-amber-200 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/10 disabled:hover:border-white/20 disabled:hover:text-white/85"
              aria-label={t("header.clipboard_clear_aria")}
              title={paywallActive ? t("header.paywall_disabled_tooltip") : t("header.clipboard_clear_tooltip")}
            >
              <ClipboardX className="h-4 w-4" />
            </button>
          )}

          {unlocked && packagesEnabled && onPackagesClick && (
            <button
              data-testid="header-packages-btn"
              onClick={onPackagesClick}
              disabled={paywallActive}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-emerald-300/15 border border-white/20 hover:border-emerald-300/40 text-white/85 hover:text-emerald-200 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/10 disabled:hover:border-white/20 disabled:hover:text-white/85"
              aria-label={t("header.packages_aria")}
              title={paywallActive ? t("header.paywall_disabled_tooltip") : t("header.packages_tooltip")}
            >
              <Package className="h-4 w-4" />
            </button>
          )}

          {unlocked && onSettingsClick && (
            <button
              data-testid="header-settings-btn"
              onClick={onSettingsClick}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-blue-300/15 border border-white/20 hover:border-blue-300/40 text-white/85 hover:text-blue-200 transition"
              aria-label={t("header.settings_aria")}
              title={t("header.settings_tooltip")}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          {unlocked && onLockClick && (
            <button
              data-testid="header-lock-btn"
              onClick={onLockClick}
              className="h-10 px-4 flex items-center justify-center gap-1.5 rounded-full bg-white/10 hover:bg-blue-300/15 border border-white/20 hover:border-blue-300/40 text-white/85 hover:text-blue-200 text-sm font-medium transition"
              aria-label={t("header.lock_aria")}
              title={t("header.lock_tooltip")}
            >
              <Lock className="h-4 w-4" />
              <span>{t("header.lock_label")}</span>
            </button>
          )}
        </div>
      </div>

      {/* LanguagePicker (v4.2 D-036) — vises KUN når ikke-unlocked. Når innlogget
          flyttes språkvalg inn i SettingsPanel for å holde header ren.

          Posisjonering:
          - Mobil (<sm): top-1/2 vertikalt sentrert + right-4 (uendret per Mike-feedback)
          - Desktop (sm+): SKJULT her. LanguagePicker rendres i stedet under login-
            formen (i app/page.tsx) for å holde naturlig hierarki: form = primær,
            språk = sekundær. */}
      {!unlocked && (
        <div
          data-testid="header-language-picker-wrapper"
          className="absolute z-10 top-1/2 -translate-y-1/2 right-4 sm:hidden"
        >
          <LanguagePicker size="sm" />
        </div>
      )}
    </header>
  );
}
