"use client";

/**
 * Ko | Do · Vault — Delt Button-komponent
 *
 * Konsoliderer button-stiler som tidligere var duplisert i AppHeader,
 * TenantViewer, admin-landing m.fl. Endringer i blå-tone / fokus-ring /
 * disabled-state gjøres ett sted.
 *
 * Farger per D-031 (B-modellen):
 *   primary     — blå (`PRIMARY_THEME.primaryButton` = blue-500/600)
 *   secondary   — glass (white/10)
 *   destructive — rose-500/600 (Slett, Lås, destruktive actions)
 *   ghost       — minimal hover (Tab-knapper, ikon-knapper i lister)
 *
 * Amber er reservert som WARNING-aksent (D-031) — IKKE som primary CTA.
 *
 * Eksisterende komponenter (CardModal, IdModal, MasterPasswordLogin osv.)
 * er IKKE rørt — kan migreres til denne komponenten gradvis ved behov.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  /** Submit-knapper i forms — eksplisitt opt-in */
  submit?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  // Per D-031 (B-modellen): primær = blå (`PRIMARY_THEME.primaryButton`),
  // destruktiv = rose, sekundær = glass/hvit/10. Amber er reservert som
  // WARNING-aksent — IKKE primary CTA.
  primary:
    "bg-blue-500 hover:bg-blue-600 text-white font-semibold border border-blue-500 hover:border-blue-600 disabled:opacity-40 disabled:cursor-not-allowed",
  secondary:
    "bg-white/10 hover:bg-white/20 text-white/85 hover:text-white border border-white/20 hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed",
  destructive:
    "bg-rose-500 hover:bg-rose-600 text-white font-semibold border border-rose-500 hover:border-rose-600 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "bg-transparent hover:bg-white/8 text-white/65 hover:text-white border border-transparent disabled:opacity-50 disabled:cursor-not-allowed",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-[11px] gap-1.5",
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-10 px-5 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "sm",
    busy = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    submit = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const finalDisabled = disabled || busy;
  return (
    <button
      ref={ref}
      type={submit ? "submit" : "button"}
      disabled={finalDisabled}
      className={[
        "inline-flex items-center justify-center rounded-lg transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40",
        fullWidth ? "w-full" : "",
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {busy ? (
        <Loader2 className={iconSize(size) + " animate-spin"} />
      ) : (
        leftIcon
      )}
      {children}
      {!busy && rightIcon}
    </button>
  );
});

function iconSize(size: ButtonSize): string {
  switch (size) {
    case "xs":
      return "h-3 w-3";
    case "sm":
      return "h-3.5 w-3.5";
    case "md":
      return "h-4 w-4";
    case "lg":
      return "h-4 w-4";
  }
}
