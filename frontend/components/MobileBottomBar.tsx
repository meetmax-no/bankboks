"use client";

import { type ReactNode } from "react";
import {
  ClipboardX,
  FlaskConical,
  Lock,
  Package,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface MobileBottomBarProps {
  refreshing?: boolean;
  brand: string;
  client: string;
  version: string;
  clipboardEnabled?: boolean;
  packagesEnabled?: boolean;
  /**
   * Iter 19 — true når PaywallOverlay viser paywall. Disabler alle
   * action-knapper unntatt Settings + Lock. Speiler AppHeader-logikken.
   */
  paywallActive?: boolean;
  onSearchClick: () => void;
  onPasswordLabClick: () => void;
  onRefreshClick: () => void;
  onSettingsClick: () => void;
  onLockClick: () => void;
  onClipboardClearClick?: () => void;
  onPackagesClick?: () => void;
}

/**
 * Bunn-navigasjon for mobil. Vises kun under sm-breakpoint.
 * Inneholder hoved-handlingene + et lite branding-strip øverst.
 *
 * Antall ikoner: 5-7 avhengig av clipboardEnabled + packagesEnabled.
 */
export function MobileBottomBar({
  refreshing = false,
  brand,
  client,
  version,
  clipboardEnabled = true,
  packagesEnabled = false,
  paywallActive = false,
  onSearchClick,
  onPasswordLabClick,
  onRefreshClick,
  onSettingsClick,
  onLockClick,
  onClipboardClearClick,
  onPackagesClick,
}: MobileBottomBarProps) {
  const { t } = useLocale();
  const showClip = clipboardEnabled && !!onClipboardClearClick;
  const showPkg = packagesEnabled && !!onPackagesClick;
  const iconCount = 5 + (showClip ? 1 : 0) + (showPkg ? 1 : 0);
  const gridCols =
    iconCount === 7
      ? "grid-cols-7"
      : iconCount === 6
        ? "grid-cols-6"
        : "grid-cols-5";
  return (
    <nav
      data-testid="mobile-bottom-bar"
      className="sm:hidden fixed bottom-0 left-0 right-0 z-30 backdrop-blur-xl border-t border-white/20 pb-[env(safe-area-inset-bottom)]"
    >
      {/* Branding-strip — erstatter footeren på mobil */}
      <div className="text-[10px] text-center text-white/55 py-1 border-b border-white/5 truncate px-3">
        <span className="text-white/80 font-medium">{brand}</span>
        <span className="mx-1 text-white/30">·</span>
        <span>{t("mobile_bar.brand_by")} {client}</span>
        <span className="mx-1 text-white/30">·</span>
        <span className="font-mono text-white/70">{version}</span>
      </div>

      <div className={`grid ${gridCols} gap-1 px-2 py-2`}>
        <BarBtn
          testId="bottom-search-btn"
          icon={<Search className="h-6 w-6" />}
          label={t("mobile_bar.label_search")}
          disabled={paywallActive}
          onClick={onSearchClick}
        />
        <BarBtn
          testId="bottom-lab-btn"
          icon={<FlaskConical className="h-6 w-6" />}
          label={t("mobile_bar.label_lab")}
          disabled={paywallActive}
          onClick={onPasswordLabClick}
        />
        {showClip && (
          <BarBtn
            testId="bottom-clipboard-clear-btn"
            icon={<ClipboardX className="h-6 w-6" />}
            label={t("mobile_bar.label_clipboard_clear")}
            disabled={paywallActive}
            onClick={onClipboardClearClick!}
          />
        )}
        <BarBtn
          testId="bottom-refresh-btn"
          icon={
            <RefreshCw
              className={`h-6 w-6 ${refreshing ? "animate-spin" : ""}`}
            />
          }
          label={t("mobile_bar.label_refresh")}
          disabled={refreshing || paywallActive}
          onClick={onRefreshClick}
        />
        {showPkg && (
          <BarBtn
            testId="bottom-packages-btn"
            icon={<Package className="h-6 w-6" />}
            label={t("mobile_bar.label_packages")}
            disabled={paywallActive}
            onClick={onPackagesClick!}
          />
        )}
        <BarBtn
          testId="bottom-settings-btn"
          icon={<Settings className="h-6 w-6" />}
          label={t("mobile_bar.label_settings")}
          onClick={onSettingsClick}
        />
        <BarBtn
          testId="bottom-lock-btn"
          icon={<Lock className="h-6 w-6" />}
          label={t("mobile_bar.label_lock")}
          onClick={onLockClick}
        />
      </div>
    </nav>
  );
}

function BarBtn({
  testId,
  icon,
  label,
  disabled,
  onClick,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex flex-col items-center justify-center gap-0.5 h-14 rounded-xl text-white/75 hover:text-white hover:bg-white/10 active:bg-white/15 transition disabled:opacity-50"
    >
      {icon}
      <span className="text-[9px] font-semibold uppercase tracking-wider">
        {label}
      </span>
    </button>
  );
}
