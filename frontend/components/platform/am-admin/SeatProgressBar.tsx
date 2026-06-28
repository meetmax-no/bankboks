"use client";

/**
 * Ko | Do · Vault — D-092 (2026-06-28) — Hybrid-seat progress bar.
 *
 * To-farget kapasitets-indikator i Konsoll → Ansatte:
 *   - grønn (emerald-500)  = aktive lisenser (aksepterte ansatte)
 *   - amber (amber-500)    = pending invites (status=pending, ikke utløpt)
 *   - grå tom              = ledige seats
 *
 * Brukes for å vise hybrid-seat-modellen Mike spesifiserte 2026-06-28:
 * `activeLicenses + pendingInvites ≤ maxLicenses`.
 *
 * maxLicenses=null/0 → "Ubegrenset"-mode: enkel summary uten progress bar.
 */
import { useLocale } from "@/lib/i18n-context";

type Props = {
  activeSeats: number;
  pendingSeats: number;
  maxSeats: number | null;
  /** Tooltip-tekst for hover (lokalisert) */
  tooltip?: string;
  /** Compact-modus: hopper over forklarings-tekst under */
  compact?: boolean;
};

export function SeatProgressBar({
  activeSeats,
  pendingSeats,
  maxSeats,
  tooltip,
  compact = false,
}: Props) {
  const { t } = useLocale();
  // Ubegrenset
  if (typeof maxSeats !== "number" || maxSeats <= 0) {
    return (
      <div
        data-testid="seat-progress-unlimited"
        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs"
        title={tooltip}
      >
        <span className="text-white/55">
          {t("am_admin_employees.seats_label")}
        </span>{" "}
        <span className="font-mono font-semibold text-white">
          {activeSeats}
        </span>
        {pendingSeats > 0 && (
          <span className="text-amber-300/80">
            {" "}
            + {pendingSeats} {t("am_admin_employees.seats_pending_label")}
          </span>
        )}
        <span className="text-white/45">
          {" "}
          / {t("am_admin_employees.seats_unlimited_total")}
        </span>
      </div>
    );
  }

  const usedTotal = Math.min(maxSeats, activeSeats + pendingSeats);
  const free = Math.max(0, maxSeats - usedTotal);
  const activePct = (Math.min(activeSeats, maxSeats) / maxSeats) * 100;
  const pendingPct =
    (Math.min(pendingSeats, Math.max(0, maxSeats - activeSeats)) / maxSeats) *
    100;
  const isFull = free === 0;

  return (
    <div
      data-testid="seat-progress-bar"
      className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 min-w-[200px]"
      title={tooltip}
    >
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span
          data-testid="seat-progress-label"
          className="text-[10px] uppercase tracking-wider text-white/55 font-semibold"
        >
          {t("am_admin_employees.seats_progress_label")}
        </span>
        <span className="font-mono text-xs">
          <span
            data-testid="seat-progress-active"
            className="text-emerald-300 font-semibold"
          >
            {activeSeats}
          </span>
          {pendingSeats > 0 && (
            <>
              <span className="text-white/30 mx-0.5">+</span>
              <span
                data-testid="seat-progress-pending"
                className="text-amber-300 font-semibold"
              >
                {pendingSeats}
              </span>
            </>
          )}
          <span className="text-white/45"> / </span>
          <span
            data-testid="seat-progress-max"
            className="text-white/85 font-semibold"
          >
            {maxSeats}
          </span>
        </span>
      </div>

      {/* Bar */}
      <div
        className="relative h-1.5 rounded-full bg-white/10 overflow-hidden"
        role="progressbar"
        aria-valuenow={usedTotal}
        aria-valuemin={0}
        aria-valuemax={maxSeats}
        aria-label={`${usedTotal} / ${maxSeats}`}
      >
        {/* Grønn = aktive */}
        <div
          data-testid="seat-progress-bar-active"
          className="absolute left-0 top-0 h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${activePct}%` }}
        />
        {/* Amber = pending (forskjøvet til høyre for aktive) */}
        <div
          data-testid="seat-progress-bar-pending"
          className={`absolute top-0 h-full bg-amber-500 transition-all duration-300 ${
            isFull && pendingSeats > 0 ? "animate-pulse" : ""
          }`}
          style={{
            left: `${activePct}%`,
            width: `${pendingPct}%`,
          }}
        />
      </div>

      {!compact && (
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/50">
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {t("am_admin_employees.seats_active_label")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t("am_admin_employees.seats_pending_label")}
            </span>
          </span>
          {isFull ? (
            <span
              data-testid="seat-progress-full-warning"
              className="text-amber-300 font-semibold"
            >
              {t("am_admin_employees.seats_full_label")}
            </span>
          ) : (
            <span data-testid="seat-progress-free">
              {free} {t("am_admin_employees.seats_free_label")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
