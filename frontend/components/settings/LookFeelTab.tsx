"use client";

// Iter 19.9.2 — Fane 2: Look & Feel
//
// Innhold:
//  - Bakgrunns-modus (Fast / Daglig / Tilfeldig)
//  - Overlay opacity slider (0..0.8)
//  - 9 bakgrunns-tiles: 3 hardkodede gradienter + 6 Unsplash-bilder (slice)
//
// TEMA-velger fjernet 2026-06-24 (Mike-direktiv) — endret kun amber-accent
// i selve SettingsPanel, ikke resten av appen. Amber-accenten beholdes
// som :root-CSS-variabel (--kodo-accent = #f5a623).
//
// Lagres i localStorage (enhetsspesifikt, ikke server-side).

import { Calendar, Check, Pin, Shuffle, type LucideIcon } from "lucide-react";
import type { AppConfig } from "@/lib/config";
import type { BgMode } from "@/lib/bg-preference";
import {
  GRADIENT_BACKGROUNDS,
  gradientUrlFromId,
  isGradientUrl,
} from "@/lib/settings/background-gradients";
import { useLocale } from "@/lib/i18n-context";

interface LookFeelTabProps {
  config: AppConfig;
  currentBackground?: string;
  bgMode: BgMode;
  overlay: number;
  onBgModeChange: (mode: BgMode) => void;
  onBgPickImage: (url: string) => void;
  onOverlayChange: (overlay: number) => void;
}

export function LookFeelTab({
  config,
  currentBackground,
  bgMode,
  overlay,
  onBgModeChange,
  onBgPickImage,
  onOverlayChange,
}: LookFeelTabProps) {
  const { t } = useLocale();

  // 6 Unsplash-bilder fra config (kapper hvis det er flere).
  const photoTiles = (config.backgrounds ?? []).slice(0, 6);

  return (
    <div className="space-y-5">
      {/* BAKGRUNN */}
      <section
        data-testid="settings-background-section"
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
      >
        <SectionTitle>{t("settings.bg_section_title")}</SectionTitle>

        {/* Modus-pills */}
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-white/55 uppercase tracking-wider mb-2">
            {t("settings.bg_mode_label")}
          </div>
          <div className="inline-flex bg-white/[0.04] border border-white/10 rounded-xl p-[3px] gap-[2px]">
            <ModePill
              active={bgMode === "fixed"}
              onClick={() => onBgModeChange("fixed")}
              icon={Pin}
              testId="rotate-mode-fixed"
            >
              {t("settings.bg_rotate_fixed_label")}
            </ModePill>
            <ModePill
              active={bgMode === "daily"}
              onClick={() => onBgModeChange("daily")}
              icon={Calendar}
              testId="rotate-mode-daily"
            >
              {t("settings.bg_rotate_daily_label")}
            </ModePill>
            <ModePill
              active={bgMode === "session"}
              onClick={() => onBgModeChange("session")}
              icon={Shuffle}
              testId="rotate-mode-session"
            >
              {t("settings.bg_rotate_session_label")}
            </ModePill>
          </div>
        </div>

        {/* Overlay slider */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
              {t("settings.bg_overlay_label")}
            </span>
            <span
              data-testid="overlay-value"
              className="text-[11px] font-mono text-[var(--kodo-accent)]"
            >
              {Math.round(overlay * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            value={overlay}
            onChange={(e) => onOverlayChange(parseFloat(e.target.value))}
            className="kodo-settings-slider w-full"
            data-testid="overlay-slider"
            aria-label={t("settings.bg_overlay_label")}
          />
          <p className="mt-2 text-[10px] text-white/40 leading-relaxed">
            {t("settings.bg_overlay_help")}
          </p>
        </div>

        {/* Tiles */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
              {t("settings.bg_tiles_label")}
            </span>
            {bgMode !== "fixed" && (
              <span className="text-[10px] text-white/40 italic">
                {t("settings.bg_tiles_fallback_note")}
              </span>
            )}
          </div>

          <div
            data-testid="settings-bg-tiles"
            className="grid grid-cols-3 sm:grid-cols-3 gap-2.5"
          >
            {/* 3 hardkodede gradienter først */}
            {GRADIENT_BACKGROUNDS.map((g) => {
              const url = gradientUrlFromId(g.id);
              const isActive = currentBackground === url;
              return (
                <BgTile
                  key={`gradient-${g.id}`}
                  testId={`bg-tile-gradient-${g.id}`}
                  name={g.name}
                  category="gradient"
                  active={isActive}
                  previewStyle={{ background: g.css }}
                  onClick={() => onBgPickImage(url)}
                />
              );
            })}

            {/* 6 Unsplash-bilder */}
            {photoTiles.map((bg) => {
              const isActive =
                !isGradientUrl(currentBackground) &&
                currentBackground === bg.url;
              return (
                <BgTile
                  key={bg.url}
                  testId={`bg-tile-photo-${bg.name}`}
                  name={bg.name}
                  category="photo"
                  active={isActive}
                  previewStyle={{
                    backgroundImage: `url("${bg.url}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                  onClick={() => onBgPickImage(bg.url)}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-white/40 leading-relaxed">
            {t("settings.bg_tiles_help")}
          </p>
        </div>
      </section>

      {/* Tailwind kan ikke styre :: -pseudoer på input[range] direkte —
          plain CSS via styled-jsx for thumb + track. */}
      <style jsx global>{`
        .kodo-settings-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          outline: none;
        }
        .kodo-settings-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: var(--kodo-accent);
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 8px var(--kodo-accent-glow);
          border: 0;
        }
        .kodo-settings-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: var(--kodo-accent);
          border-radius: 50%;
          cursor: pointer;
          border: 0;
          box-shadow: 0 2px 8px var(--kodo-accent-glow);
        }
        .kodo-settings-slider:focus-visible {
          box-shadow: 0 0 0 3px var(--kodo-accent-glow);
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.12em]">
      {children}
    </h3>
  );
}

function ModePill({
  active,
  onClick,
  icon: Icon,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)] ${
        active
          ? "bg-[var(--kodo-accent)] text-[var(--kodo-accent-ink)] font-semibold shadow-[0_4px_12px_-4px_var(--kodo-accent-glow)]"
          : "text-white/65 hover:text-white"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
    </button>
  );
}

function BgTile({
  testId,
  name,
  category,
  active,
  previewStyle,
  onClick,
}: {
  testId: string;
  name: string;
  category: "gradient" | "photo";
  active: boolean;
  previewStyle: React.CSSProperties;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      title={name}
      className={`group relative flex flex-col rounded-xl overflow-hidden border text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)] ${
        active
          ? "border-[var(--kodo-accent)] shadow-[0_0_0_2px_var(--kodo-accent),0_12px_24px_-8px_var(--kodo-accent-glow)]"
          : "border-white/10 hover:border-white/25 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.4)]"
      }`}
    >
      <div
        className="h-20 bg-slate-950 border-b border-white/10"
        style={previewStyle}
        aria-hidden="true"
      />
      <div className="px-2.5 py-1.5 flex items-center justify-between gap-1.5">
        <span className="text-[11px] font-medium text-white/95 truncate">
          {name}
        </span>
        <span
          className={`text-[9px] font-mono uppercase tracking-[0.08em] px-1.5 py-0.5 rounded ${
            category === "gradient"
              ? "bg-indigo-500/15 text-indigo-300"
              : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {category === "gradient"
            ? t("settings.bg_cat_gradient")
            : t("settings.bg_cat_photo")}
        </span>
      </div>
      {active && (
        <div
          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--kodo-accent)] text-[var(--kodo-accent-ink)] flex items-center justify-center font-bold text-[10px] shadow-[0_4px_12px_-2px_var(--kodo-accent-glow)]"
          aria-hidden="true"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}
