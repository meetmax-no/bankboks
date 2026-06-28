/**
 * Sentrale farge-tokens per feature. Endre ÉN konstant her hvis du vil
 * bytte fargen til en hel feature (f.eks. pakker fra emerald → teal).
 *
 * Bakgrunn: Tailwind kan ikke plukke opp `bg-${color}-500` direkte (PurgeCSS
 * fjerner det), så vi må hardcode klasse-strenger. Hver feature har sitt
 * eget tema-objekt slik at man bytter ved å endre dette filen — ingen leting
 * etter `emerald` på tvers av 8 komponenter.
 *
 * Brand-retningslinjer (B-modellen, godkjent 2026-02):
 *   blue    — generell primær (Lagre, Edit, OK, Lås)
 *   emerald — Pakker-feature (alle stages, banners, header-knapp)
 *   violet  — Password-Lab-modul
 *   amber   — Warnings (clipboard-clear, "ikke trekkes tilbake")
 *   rose    — Slett / feil
 */

export interface FeatureTheme {
  /** Primær handlings-knapp (bg + hover). F.eks. «Krypter og last ned». */
  primaryButton: string;
  /** Sekundær / ghost-knapp som beholder feature-aksent på border. */
  secondaryButton: string;
  /** Hover-state for runde header-ikoner (40x40). */
  iconHover: string;
  /** Inline-tekst-aksent (link, "Generer sterkt passord"). */
  accentText: string;
  /** Hover-versjon av accentText. */
  accentTextHover: string;
  /** Liten ikon-farge inne i suksess-banners osv. */
  iconColor: string;
  /** Suksess-banner: border + bg-tint + tekst. */
  successBanner: string;
  /** Spinner-farge under encrypt/decrypt. */
  spinnerColor: string;
  /** Container-valg "valgt"-state (radio-button + ring). */
  selectedBorder: string;
  /** Container-valg "valgt"-state bakgrunn-tint. */
  selectedBg: string;
  /** Radio-button "valgt"-state (border + fill). */
  radioSelectedBorder: string;
  /** Radio-button "valgt"-state fyll. */
  radioSelectedFill: string;
  /** Fokus-ring-farge på input-felt. */
  inputFocusBorder: string;
  /** Solid border-farge for fokus-rammers hjørne-markører i kamera-flowen.
   *  Ingen opacity — skal være helt synlig over mørk video-bakgrunn. */
  cornerMarker: string;
  /** Aktiv toggle-state (bg + border + tekst) for binære valg som
   *  cropper-aspect-lock og lignende. Skille seg fra `selected*` ved at det
   *  er en interaktiv tilstand, ikke et radio-valg. */
  toggleActive: string;
  /** Ghost-knapp med feature-aksent KUN på border + tekst (white-bakgrunn).
   *  Brukes for sekundære aksent-handlinger som "Finjuster" der vi ikke vil
   *  ha solid feature-tint i bakgrunn (det reserveres for toggleActive). */
  accentOutlineButton: string;
}

/** Pakker — sikker overlevering (.kodoenc). Bytt fra emerald → annet ved å bytte alle tokens her. */
export const PACKAGES_THEME: FeatureTheme = {
  primaryButton: "bg-emerald-500 hover:bg-emerald-600",
  secondaryButton: "bg-white/10 hover:bg-white/20 border border-white/20",
  iconHover: "hover:bg-emerald-300/15 hover:border-emerald-300/40 hover:text-emerald-200",
  accentText: "text-emerald-300",
  accentTextHover: "hover:text-emerald-200",
  iconColor: "text-emerald-300",
  successBanner: "border border-emerald-400/50 bg-emerald-500/15 text-emerald-100",
  spinnerColor: "text-emerald-300",
  selectedBorder: "border-emerald-300/60",
  selectedBg: "bg-emerald-400/10",
  radioSelectedBorder: "border-emerald-300",
  radioSelectedFill: "bg-emerald-400",
  inputFocusBorder: "focus:border-emerald-300/60",
  cornerMarker: "border-emerald-300",
  toggleActive: "bg-emerald-500/15 border-emerald-300/40 text-emerald-100",
  accentOutlineButton: "bg-white/10 hover:bg-white/15 border border-emerald-300/40 text-emerald-100",
};

/** Lab — Password Lab. Lilla. */
export const LAB_THEME: FeatureTheme = {
  primaryButton: "bg-violet-500 hover:bg-violet-600",
  secondaryButton: "bg-white/10 hover:bg-white/20 border border-white/20",
  iconHover: "hover:bg-violet-300/15 hover:border-violet-300/40 hover:text-violet-200",
  accentText: "text-violet-300",
  accentTextHover: "hover:text-violet-200",
  iconColor: "text-violet-300",
  successBanner: "border border-violet-400/50 bg-violet-500/15 text-violet-100",
  spinnerColor: "text-violet-300",
  selectedBorder: "border-violet-300/60",
  selectedBg: "bg-violet-400/10",
  radioSelectedBorder: "border-violet-300",
  radioSelectedFill: "bg-violet-400",
  inputFocusBorder: "focus:border-violet-300/60",
  cornerMarker: "border-violet-300",
  toggleActive: "bg-violet-500/15 border-violet-300/40 text-violet-100",
  accentOutlineButton: "bg-white/10 hover:bg-white/15 border border-violet-300/40 text-violet-100",
};

/** Standard primær (blå) — alt som ikke har egen feature-farge. */
export const PRIMARY_THEME: FeatureTheme = {
  primaryButton: "bg-blue-500 hover:bg-blue-600",
  secondaryButton: "bg-white/10 hover:bg-white/20 border border-white/20",
  iconHover: "hover:bg-blue-300/15 hover:border-blue-300/40 hover:text-blue-200",
  accentText: "text-blue-300",
  accentTextHover: "hover:text-blue-200",
  iconColor: "text-blue-300",
  successBanner: "border border-blue-400/50 bg-blue-500/15 text-blue-100",
  spinnerColor: "text-blue-300",
  selectedBorder: "border-blue-300/60",
  selectedBg: "bg-blue-400/10",
  radioSelectedBorder: "border-blue-300",
  radioSelectedFill: "bg-blue-400",
  inputFocusBorder: "focus:border-blue-300/60",
  cornerMarker: "border-blue-300",
  toggleActive: "bg-blue-500/15 border-blue-300/40 text-blue-100",
  accentOutlineButton: "bg-white/10 hover:bg-white/15 border border-blue-300/40 text-blue-100",
};

/** IDs — v4.1 ID-blob (Pass, Førerkort, ID-kort, Helse/forsikring).
 *  Orange er en egen feature-farge per D-031 (B-modellen, utvidet 2026-02).
 *  Mønster speiler PACKAGES_THEME — Mike-beslutning sign-off i v4.1-SPEC §6.6. */
export const IDS_THEME: FeatureTheme = {
  primaryButton: "bg-orange-500 hover:bg-orange-600",
  secondaryButton: "bg-white/10 hover:bg-white/20 border border-white/20",
  iconHover: "hover:bg-orange-300/15 hover:border-orange-300/40 hover:text-orange-200",
  accentText: "text-orange-300",
  accentTextHover: "hover:text-orange-200",
  iconColor: "text-orange-300",
  successBanner: "border border-orange-400/50 bg-orange-500/15 text-orange-100",
  spinnerColor: "text-orange-300",
  selectedBorder: "border-orange-300/60",
  selectedBg: "bg-orange-400/10",
  radioSelectedBorder: "border-orange-300",
  radioSelectedFill: "bg-orange-400",
  inputFocusBorder: "focus:border-orange-300/60",
  cornerMarker: "border-orange-300",
  toggleActive: "bg-orange-500/15 border-orange-300/40 text-orange-100",
  accentOutlineButton: "bg-white/10 hover:bg-white/15 border border-orange-300/40 text-orange-100",
};

/** Warning-aksent (clipboard, "ikke trekkes tilbake"). Brukes som sub-aksent, ikke primær-tema. */
export const WARNING_HOVER = "hover:bg-amber-300/15 hover:border-amber-300/40 hover:text-amber-200";
