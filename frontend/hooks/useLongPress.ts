"use client";
/**
 * Ko | Do · Vault — D-150 (2026-02) — useLongPress
 *
 * Generisk long-press-detector som fungerer på både touch og mouse.
 * Trigger callback etter `delayMs` ms sammenhengende trykk uten
 * bevegelse over `moveThresholdPx`.
 *
 * Cancel-logikk:
 *   - pointerup / pointerleave / pointercancel før timeren fyres
 *   - pointermove utover threshold
 *
 * Haptisk feedback: kaller `navigator.vibrate(30)` hvis tilgjengelig
 * (typisk kun mobil-Chrome, iOS Safari ignorerer).
 *
 * Bruk:
 *   const longPress = useLongPress(() => copyPassword(entry), {
 *     delayMs: 500,
 *   });
 *   <div {...longPress}>...</div>
 */
import { useCallback, useRef } from "react";

interface UseLongPressOptions {
  delayMs?: number;
  moveThresholdPx?: number;
  vibrate?: boolean;
}

export function useLongPress(
  callback: () => void,
  {
    delayMs = 500,
    moveThresholdPx = 8,
    vibrate = true,
  }: UseLongPressOptions = {},
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      firedRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate(30);
          } catch {
            // No-op
          }
        }
        callback();
      }, delayMs);
    },
    [callback, delayMs, vibrate],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPosRef.current || !timerRef.current) return;
      const dx = e.clientX - startPosRef.current.x;
      const dy = e.clientY - startPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > moveThresholdPx) {
        clear();
      }
    },
    [clear, moveThresholdPx],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasFired = firedRef.current;
      clear();
      if (wasFired) {
        // Long-press ble triggert — hindre click-eventen som følger
        // (browser genererer click etter pointerup selv om long-press fyrte).
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [clear],
  );

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    clear();
  }, [clear]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onPointerCancel,
  };
}
