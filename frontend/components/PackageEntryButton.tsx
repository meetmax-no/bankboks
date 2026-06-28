"use client";

import { PackageOpen } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";

interface PackageEntryButtonProps {
  onClick: () => void;
  /**
   * Plassering: "login" = under master-pwd-feltet på login (Anna-flyt),
   * "header" = brukes IKKE (header har sin egen 📦-knapp). Reservert for
   * fremtidig variant.
   */
  variant?: "login";
}

/**
 * "Pakk ut en pakke"-knapp på login-siden. Vises kun når
 * `features.packages.enabled === true` i tenant-config.
 *
 * Anna kommer hit fra e-post: hun klikker for å åpne en .kodoenc hun har
 * mottatt — uten å ha vault, uten konto, uten noe. Helt zero-knowledge.
 *
 * SPEC: /app/memory/v4.0-SPEC.md seksjon 2.1
 */
export function PackageEntryButton({
  onClick,
  variant = "login",
}: PackageEntryButtonProps) {
  const { t } = useLocale();
  if (variant !== "login") return null;
  return (
    <button
      data-testid="login-unpack-package-btn"
      type="button"
      onClick={onClick}
      className="w-full h-10 rounded-lg bg-white/5 hover:bg-emerald-500/15 border border-white/15 hover:border-emerald-300/40 text-white/75 hover:text-emerald-100 text-sm font-medium transition flex items-center justify-center gap-2 group"
    >
      <PackageOpen className="h-4 w-4 text-emerald-300/80 group-hover:text-emerald-200 transition" />
      <span>{t("package_entry.login_button")}</span>
    </button>
  );
}
