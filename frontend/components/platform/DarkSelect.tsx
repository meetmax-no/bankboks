"use client";

/**
 * Ko | Do · Vault — D-116 (2026-06-29) — DarkSelect
 *
 * Custom dropdown bygget av divs — IKKE native <select>. Native popup-meny
 * styres av OS-en (særlig Safari/macOS og Chrome) og lar seg ikke style.
 * Custom her for å garantere mørk popup matchende resten av admin-temaet
 * på alle browsere. Lukker på klikk utenfor + Escape.
 *
 * Ekstrahert fra TenantViewer.tsx i D-116 så InlineInviteForm + andre
 * am-admin-flater kan gjenbruke samme komponent (D-105 anti-duplisering).
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PRIMARY_THEME } from "@/lib/feature-theme";

export function DarkSelect({
  testId,
  value,
  onChange,
  options,
  size = "md",
  disabled = false,
}: {
  testId: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonCls =
    size === "sm"
      ? "pl-2.5 pr-7 py-1.5 text-xs"
      : "px-3 py-2 pr-9 text-sm";
  const chevronPos = size === "sm" ? "right-2 h-3 w-3" : "right-3 h-4 w-4";

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentLabel =
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        data-testid={testId}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full text-left cursor-pointer ${buttonCls} rounded-lg bg-white/5 hover:bg-white/10 border ${
          open ? "border-blue-300/60" : "border-white/15 hover:border-white/25"
        } text-white outline-none ${PRIMARY_THEME.inputFocusBorder} transition disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {currentLabel}
      </button>
      <ChevronDown
        className={`absolute ${chevronPos} top-1/2 -translate-y-1/2 ${
          open ? PRIMARY_THEME.accentText : "text-white/55"
        } pointer-events-none transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
      {open && (
        <ul
          role="listbox"
          data-testid={`${testId}-menu`}
          className="absolute z-50 left-0 mt-1.5 min-w-full w-max max-w-[90vw] max-h-80 overflow-y-auto rounded-xl border border-white/20 bg-neutral-900/95 backdrop-blur-xl p-1.5 shadow-2xl animate-slide-up"
        >
          {options.map((o) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                data-testid={`${testId}-opt-${o.value}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`px-2.5 py-2 text-sm cursor-pointer rounded-md transition flex items-center gap-2 whitespace-nowrap ${
                  selected
                    ? `bg-blue-400/15 ${PRIMARY_THEME.accentText} font-medium`
                    : "text-white/90 hover:bg-white/10"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-3.5 text-center text-[11px] font-bold ${
                    selected ? PRIMARY_THEME.accentText : "text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className="flex-1 truncate">{o.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
