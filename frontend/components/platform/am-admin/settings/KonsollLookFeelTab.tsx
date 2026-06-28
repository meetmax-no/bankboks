"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll Look & Feel
 *
 * Klone av vault `LookFeelTab.tsx` UI-mønster (3 modus + overlay slider
 * + 9 tiles), men persisterer i en SEPARAT localStorage-nøkkel
 * `kodo-konsoll-bg.v1` via `lib/platform/konsoll-bg-preference.ts`.
 *
 * Per D-086 a=3 (2026-06-27): "Samme katalog, separat localStorage-nøkkel".
 * Vi importerer photo-katalogen direkte fra `clients/default.json` via
 * fetch ved mount (samme som vault gjør), og gjenbruker `GRADIENT_BACKGROUNDS`.
 */
import { useEffect, useState } from "react";
import { Calendar, Check, Pin, Shuffle, type LucideIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import {
  GRADIENT_BACKGROUNDS,
  gradientUrlFromId,
  isGradientUrl,
} from "@/lib/settings/background-gradients";
import type {
  KonsollBgMode,
  KonsollBgPreference,
} from "@/lib/platform/konsoll-bg-preference";

type PhotoBg = { name: string; url: string };

type Props = {
  pref: KonsollBgPreference;
  onChange: (next: KonsollBgPreference) => void;
};

export function KonsollLookFeelTab({ pref, onChange }: Props) {
  const { t } = useLocale();
  const [photos, setPhotos] = useState<PhotoBg[]>([]);

  // Last photo-katalogen fra default.json (samme som vault). Hvis fetch
  // feiler, viser vi kun gradientene — ikke kritisk.
  useEffect(() => {
    void fetch("/clients/default.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.backgrounds)) {
          setPhotos((json.backgrounds as PhotoBg[]).slice(0, 6));
        }
      })
      .catch(() => {
        /* graciøst — kun gradienter vises */
      });
  }, []);

  const currentUrl =
    pref.fixedUrl ??
    (pref.mode === "fixed" ? gradientUrlFromId("aurora") : undefined);
  const overlay = pref.overlay ?? 0.05;

  const setMode = (mode: KonsollBgMode) => {
    onChange({ ...pref, mode });
  };
  const setOverlay = (next: number) => {
    onChange({ ...pref, overlay: next });
  };
  const pickBg = (url: string) => {
    const isGradient = url.startsWith("gradient:");
    onChange({
      ...pref,
      mode: "fixed",
      fixedUrl: url,
      // Gradienter ser best ut uten overlay; bilder beholder bruker-overlay.
      overlay: isGradient ? 0 : (pref.overlay ?? 0.05),
    });
  };

  return (
    <div className="space-y-5">
      <section
        data-testid="konsoll-settings-background-section"
        className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
      >
        <SectionTitle>{t("am_admin_settings.bg_section_title")}</SectionTitle>

        {/* Modus-pills */}
        <div className="mt-3">
          <div className="text-[11px] font-semibold text-white/55 uppercase tracking-wider mb-2">
            {t("am_admin_settings.bg_mode_label")}
          </div>
          <div className="inline-flex bg-white/[0.04] border border-white/10 rounded-xl p-[3px] gap-[2px]">
            <ModePill
              active={pref.mode === "fixed"}
              onClick={() => setMode("fixed")}
              icon={Pin}
              testId="konsoll-rotate-mode-fixed"
            >
              {t("am_admin_settings.bg_rotate_fixed_label")}
            </ModePill>
            <ModePill
              active={pref.mode === "daily"}
              onClick={() => setMode("daily")}
              icon={Calendar}
              testId="konsoll-rotate-mode-daily"
            >
              {t("am_admin_settings.bg_rotate_daily_label")}
            </ModePill>
            <ModePill
              active={pref.mode === "session"}
              onClick={() => setMode("session")}
              icon={Shuffle}
              testId="konsoll-rotate-mode-session"
            >
              {t("am_admin_settings.bg_rotate_session_label")}
            </ModePill>
          </div>
        </div>

        {/* Overlay slider */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
              {t("am_admin_settings.bg_overlay_label")}
            </span>
            <span
              data-testid="konsoll-overlay-value"
              className="text-[11px] font-mono text-[var(--kodo-accent,#f5a623)]"
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
            onChange={(e) => setOverlay(parseFloat(e.target.value))}
            className="kodo-konsoll-slider w-full"
            data-testid="konsoll-overlay-slider"
            aria-label={t("am_admin_settings.bg_overlay_label")}
          />
          <p className="mt-2 text-[10px] text-white/40 leading-relaxed">
            {t("am_admin_settings.bg_overlay_help")}
          </p>
        </div>

        {/* Tiles */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-white/55 uppercase tracking-wider">
              {t("am_admin_settings.bg_tiles_label")}
            </span>
            {pref.mode !== "fixed" && (
              <span className="text-[10px] text-white/40 italic">
                {t("am_admin_settings.bg_tiles_fallback_note")}
              </span>
            )}
          </div>

          <div
            data-testid="konsoll-bg-tiles"
            className="grid grid-cols-3 sm:grid-cols-3 gap-2.5"
          >
            {GRADIENT_BACKGROUNDS.map((g) => {
              const url = gradientUrlFromId(g.id);
              const isActive = currentUrl === url;
              return (
                <BgTile
                  key={`gradient-${g.id}`}
                  testId={`konsoll-bg-tile-gradient-${g.id}`}
                  name={g.name}
                  category="gradient"
                  active={isActive}
                  previewStyle={{ background: g.css }}
                  onClick={() => pickBg(url)}
                />
              );
            })}
            {photos.map((bg) => {
              const isActive =
                !isGradientUrl(currentUrl) && currentUrl === bg.url;
              return (
                <BgTile
                  key={bg.url}
                  testId={`konsoll-bg-tile-photo-${bg.name}`}
                  name={bg.name}
                  category="photo"
                  active={isActive}
                  previewStyle={{
                    backgroundImage: `url("${bg.url}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                  onClick={() => pickBg(bg.url)}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[10px] text-white/40 leading-relaxed">
            {t("am_admin_settings.bg_tiles_help")}
          </p>
        </div>
      </section>

      <style jsx global>{`
        .kodo-konsoll-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          outline: none;
        }
        .kodo-konsoll-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: #f5a623;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(245, 166, 35, 0.4);
          border: 0;
        }
        .kodo-konsoll-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #f5a623;
          border-radius: 50%;
          cursor: pointer;
          border: 0;
        }
      `}</style>
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
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition whitespace-nowrap ${
        active
          ? "bg-amber-400 text-black font-semibold shadow"
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
      className={`group relative flex flex-col rounded-xl overflow-hidden border text-left transition ${
        active
          ? "border-amber-400 shadow-[0_0_0_2px_#f5a623]"
          : "border-white/10 hover:border-white/25 hover:-translate-y-0.5"
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
            ? t("am_admin_settings.bg_cat_gradient")
            : t("am_admin_settings.bg_cat_photo")}
        </span>
      </div>
      {active && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-amber-400 text-black flex items-center justify-center font-bold text-[10px] shadow">
          <Check className="h-3 w-3" strokeWidth={3} />
        </div>
      )}
    </button>
  );
}
