"use client";

/**
 * PasswordLab bruker violet-aksent (D-031 B-modellen).
 * Unntak: emerald-300 på "✓ kopiert"-ikon er universell suksess-feedback.
 * Header-knappen som åpner Lab har også violet hover (AppHeader.tsx).
 * For sentral token-bruk: lib/feature-theme.ts → LAB_THEME.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Dice5,
  Eraser,
  Eye,
  EyeOff,
  FlaskConical,
  Info,
  RefreshCw,
  Sparkles,
  Type,
  Wand2,
  X,
} from "lucide-react";
import { copyWithAutoClear } from "@/lib/clipboard";
import { toast } from "sonner";
import { useLocale } from "@/lib/i18n-context";
import {
  DEFAULT_GEN_OPTS,
  generatePassword,
  type GeneratorOptions,
} from "@/lib/password-generator";
import {
  DEFAULT_PASSPHRASE_OPTS,
  generatePassphrase,
  type PassphraseOptions,
  type PassphraseSeparator,
} from "@/lib/passphrase-generator";
import {
  analyzeStrength,
  scoreColor,
  scoreLabel,
  type StrengthResult,
} from "@/lib/password-strength";

type GenMode = "chars" | "phrase";

const ALL_OFF: GeneratorOptions = {
  length: 12,
  uppercase: false,
  lowercase: false,
  digits: false,
  symbols: false,
  excludeSimilar: false,
};

const SEPARATORS: PassphraseSeparator[] = ["+", "-", "_", "."];

interface PasswordLabProps {
  open: boolean;
  /** Pre-fyll "Test passord"-feltet når laben åpnes (f.eks. passordet
   *  brukeren nettopp skrev inn i master/entry-feltet som trigget laben) */
  initialTestPassword?: string;
  /** Hvis satt, vil "Bruk dette"-knappen i generator-seksjonen sende
   *  det genererte passordet tilbake hit og lukke laben. */
  onUsePassword?: (pwd: string) => void;
  clipboardClearSeconds?: number;
  /** Når false, skjules kopier-knappen i generator-seksjonen (D-017). */
  clipboardEnabled?: boolean;
  onClose: () => void;
}

export function PasswordLab({
  open,
  initialTestPassword,
  onUsePassword,
  clipboardClearSeconds = 30,
  clipboardEnabled = true,
  onClose,
}: PasswordLabProps) {
  const { t } = useLocale();
  const [testPwd, setTestPwd] = useState("");
  const [testShow, setTestShow] = useState(false);
  const [strength, setStrength] = useState<StrengthResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_GEN_OPTS);
  const [phraseOpts, setPhraseOpts] = useState<PassphraseOptions>(
    DEFAULT_PASSPHRASE_OPTS,
  );
  const [mode, setMode] = useState<GenMode>("chars");
  const [generated, setGenerated] = useState<string>("");
  const [genCopied, setGenCopied] = useState(false);

  // Pre-fyll test-feltet når laben åpnes (hvis kallsted oppgir passord),
  // reset alt ved lukking.
  useEffect(() => {
    if (open) {
      setTestPwd(initialTestPassword || "");
    } else {
      setTestPwd("");
      setStrength(null);
      setGenerated("");
      setGenCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced strength-analyse
  useEffect(() => {
    if (!open) return;
    if (testPwd.length === 0) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    setAnalyzing(true);
    const t = setTimeout(async () => {
      try {
        const r = await analyzeStrength(testPwd);
        if (!cancelled) setStrength(r);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [testPwd, open]);

  // Første generering når modalen åpnes
  useEffect(() => {
    if (open && !generated) {
      try {
        setGenerated(
          mode === "phrase"
            ? generatePassphrase(phraseOpts)
            : generatePassword(opts),
        );
      } catch {
        /* minst én tegntype mangler — bruker må velge */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const regenerate = useCallback(() => {
    try {
      if (mode === "phrase") {
        setGenerated(generatePassphrase(phraseOpts));
      } else {
        setGenerated(generatePassword(opts));
      }
      setGenCopied(false);
    } catch (err) {
      setGenerated("");
      console.warn(err);
    }
  }, [mode, opts, phraseOpts]);

  // Auto-regenerer når modus byttes
  useEffect(() => {
    if (open) regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const copyGenerated = useCallback(async () => {
    if (!generated) return;
    await copyWithAutoClear(generated, clipboardClearSeconds, (success) => {
      if (success) {
        toast.info(t("lab.toast_cleared_suffix"));
      }
    });
    setGenCopied(true);
    setTimeout(() => setGenCopied(false), 2000);
  }, [generated, clipboardClearSeconds]);

  const handleUse = useCallback(() => {
    if (!generated || !onUsePassword) return;
    onUsePassword(generated);
    onClose();
  }, [generated, onUsePassword, onClose]);

  const genValid = useMemo(
    () => opts.uppercase || opts.lowercase || opts.digits || opts.symbols,
    [opts],
  );

  if (!open) return null;

  return (
    <div
      data-testid="password-lab-overlay"
      className="fixed inset-0 z-[62] bg-black/70 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="password-lab"
        className="w-full max-w-2xl my-8 bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl text-white animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-900/95 backdrop-blur-xl rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-400/15 border border-violet-300/30 flex items-center justify-center">
              <FlaskConical className="h-4 w-4 text-violet-200" />
            </div>
            <div>
              <h3 className="text-lg font-semibold tracking-tight">
                {t("lab.title")}
              </h3>
              <div className="text-[10px] text-white/45">
                {t("lab.subtitle")}
              </div>
            </div>
          </div>
          <button
            data-testid="password-lab-close"
            onClick={onClose}
            className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Test passord */}
          <Section
            testId="lab-section-test"
            title={t("lab.section_test_title")}
            icon={<FlaskConical className="h-4 w-4 text-white/70" />}
            subtitle={t("lab.section_test_subtitle")}
          >
            <div className="relative">
              <input
                data-testid="lab-test-input"
                type={testShow ? "text" : "password"}
                value={testPwd}
                onChange={(e) => setTestPwd(e.target.value)}
                placeholder={t("lab.test_placeholder")}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore
                data-form-type="other"
                spellCheck={false}
                className="w-full bg-white/5 border border-white/15 rounded-lg pl-3 pr-10 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400/40 font-mono"
              />
              <button
                type="button"
                onClick={() => setTestShow((v) => !v)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10 transition"
                aria-label={testShow ? t("common.hide") : t("common.show")}
              >
                {testShow ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {testPwd.length > 0 && (
              <StrengthMeter
                pwd={testPwd}
                strength={strength}
                analyzing={analyzing}
              />
            )}
          </Section>

          {/* Generer passord */}
          <Section
            testId="lab-section-generate"
            title={t("lab.section_generate_title")}
            icon={<Wand2 className="h-4 w-4 text-white/70" />}
            subtitle={
              mode === "phrase"
                ? `${phraseOpts.wordCount} ${t("lab.section_generate_subtitle_phrase_suffix")}`
                : `${opts.length} ${t("lab.section_generate_subtitle_chars_suffix")}`
            }
          >
            {/* Mode-tabs */}
            <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 mb-3">
              <button
                type="button"
                data-testid="lab-mode-chars"
                onClick={() => setMode("chars")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  mode === "chars"
                    ? "bg-violet-500/20 text-white shadow-inner"
                    : "text-white/55 hover:text-white/80"
                }`}
              >
                <Type className="h-3.5 w-3.5" />
                {t("lab.mode_chars")}
              </button>
              <button
                type="button"
                data-testid="lab-mode-phrase"
                onClick={() => setMode("phrase")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                  mode === "phrase"
                    ? "bg-violet-500/20 text-white shadow-inner"
                    : "text-white/55 hover:text-white/80"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t("lab.mode_phrase")}
              </button>
            </div>

            {/* Generated output */}
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white/5 border border-white/10">
              <code
                data-testid="lab-generated-pwd"
                className="flex-1 font-mono text-sm text-white/95 truncate select-all"
                title={generated}
              >
                {generated || (
                  <span className="text-white/40">
                    {mode === "phrase" ? "—" : t("lab.placeholder_pick_type")}
                  </span>
                )}
              </code>
              <button
                type="button"
                onClick={regenerate}
                disabled={mode === "chars" && !genValid}
                data-testid="lab-regen-btn"
                className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
                aria-label={t("lab.regen_aria")}
                title={t("lab.regen_tooltip")}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              {clipboardEnabled && (
                <button
                  type="button"
                  onClick={copyGenerated}
                  disabled={!generated}
                  data-testid="lab-copy-btn"
                  className="p-1.5 rounded text-white/60 hover:text-white hover:bg-white/10 transition disabled:opacity-30"
                  aria-label={t("common.copy_aria")}
                  title={`Kopier (slettes om ${clipboardClearSeconds}s)`}
                >
                  {genCopied ? (
                    <Check className="h-4 w-4 text-emerald-300" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>

            {mode === "chars" ? (
              <>
                {/* Lengde-slider */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                      Lengde
                    </label>
                    <span className="text-xs font-mono text-white/85">
                      {opts.length}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={64}
                    step={1}
                    value={opts.length}
                    onChange={(e) =>
                      setOpts({ ...opts, length: Number(e.target.value) })
                    }
                    data-testid="lab-length-slider"
                    className="w-full accent-violet-400"
                  />
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
                  <Toggle
                    testId="lab-toggle-upper"
                    label="A-Z"
                    hint="Store"
                    checked={opts.uppercase}
                    onChange={(v) => setOpts({ ...opts, uppercase: v })}
                  />
                  <Toggle
                    testId="lab-toggle-lower"
                    label="a-z"
                    hint={t("lab.charset_lower_hint")}
                    checked={opts.lowercase}
                    onChange={(v) => setOpts({ ...opts, lowercase: v })}
                  />
                  <Toggle
                    testId="lab-toggle-digits"
                    label="0-9"
                    hint="Tall"
                    checked={opts.digits}
                    onChange={(v) => setOpts({ ...opts, digits: v })}
                  />
                  <Toggle
                    testId="lab-toggle-symbols"
                    label="!@#$"
                    hint="Symboler"
                    checked={opts.symbols}
                    onChange={(v) => setOpts({ ...opts, symbols: v })}
                  />
                  <Toggle
                    testId="lab-toggle-similar"
                    label="0Ol1I"
                    hint={t("lab.charset_exclude_similar_hint")}
                    checked={opts.excludeSimilar}
                    onChange={(v) =>
                      setOpts({ ...opts, excludeSimilar: v })
                    }
                  />
                </div>

                {/* Quick actions */}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button
                    type="button"
                    data-testid="lab-quick-clear"
                    onClick={() =>
                      setOpts({ ...ALL_OFF, length: opts.length })
                    }
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-xs font-medium text-white/70 transition"
                  >
                    <Eraser className="h-3.5 w-3.5" />
                    Fjern alle
                  </button>
                  <button
                    type="button"
                    data-testid="lab-quick-default"
                    onClick={() =>
                      setOpts({ ...DEFAULT_GEN_OPTS, length: opts.length })
                    }
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-xs font-medium text-white/70 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Standard
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Antall ord */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                      Antall ord
                    </label>
                    <span className="text-xs font-mono text-white/85">
                      {phraseOpts.wordCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={6}
                    step={1}
                    value={phraseOpts.wordCount}
                    onChange={(e) =>
                      setPhraseOpts({
                        ...phraseOpts,
                        wordCount: Number(e.target.value),
                      })
                    }
                    data-testid="lab-phrase-count-slider"
                    className="w-full accent-violet-400"
                  />
                </div>

                {/* Separator */}
                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-white/60 uppercase tracking-wider mb-1.5">
                    Separator
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {SEPARATORS.map((s) => {
                      const active = phraseOpts.separator === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          data-testid={`lab-phrase-sep-${s}`}
                          onClick={() =>
                            setPhraseOpts({ ...phraseOpts, separator: s })
                          }
                          aria-pressed={active}
                          className={`px-3 py-2 rounded-xl border text-center font-mono text-sm transition ${
                            active
                              ? "bg-violet-500/15 border-violet-400/60 text-white"
                              : "bg-white/5 border-white/10 text-white/55 hover:bg-white/10 hover:border-white/20"
                          }`}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Stor forbokstav */}
                <div className="mt-3">
                  <Toggle
                    testId="lab-phrase-cap"
                    label="Xxxx"
                    hint={t("lab.charset_capitalize_hint")}
                    checked={phraseOpts.capitalize}
                    onChange={(v) =>
                      setPhraseOpts({ ...phraseOpts, capitalize: v })
                    }
                  />
                </div>

                <p className="mt-3 text-[10px] text-white/45 leading-relaxed">
                  Norsk ordliste · 607 vanlige ord uten Æ/Ø/Å · ~9 bits
                  entropi per ord. {phraseOpts.wordCount} ord ≈{" "}
                  {Math.round(phraseOpts.wordCount * 9.25)} bits.
                </p>
              </>
            )}

            {onUsePassword && (
              <button
                type="button"
                onClick={handleUse}
                disabled={!generated}
                data-testid="lab-use-btn"
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-sm font-semibold shadow transition disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                Bruk dette passordet
              </button>
            )}
          </Section>

          {/* Om sterke passord */}
          <Section
            testId="lab-section-learn"
            title={t("lab.section_learn_title")}
            icon={<BookOpen className="h-4 w-4 text-white/70" />}
            defaultOpen={false}
          >
            <div className="space-y-3 text-[12px] text-white/70 leading-relaxed">
              <Learn title={t("lab.learn_length_title")}>
                {t("lab.learn_length_body")}
              </Learn>
              <Learn title={t("lab.learn_patterns_title")}>
                <code>P@ssw0rd!</code>, <code>qwerty123</code>,{" "}
                <code>Sommer2026</code>{t("lab.learn_patterns_body_suffix")}
              </Learn>
              <Learn title={t("lab.learn_phrases_title")}>
                {t("lab.learn_phrases_body_prefix")}
                <code>måne-kaktus-reim-vaskebjørn-42</code>
                {t("lab.learn_phrases_body_suffix")}
              </Learn>
              <Learn title={t("lab.learn_kodo_title")}>
                {t("lab.learn_kodo_body")}
              </Learn>
              <Learn title={t("lab.learn_zxcvbn_title")}>
                {t("lab.learn_zxcvbn_body_1")}
                <em>{t("lab.learn_zxcvbn_body_2")}</em>
                {t("lab.learn_zxcvbn_body_3")}
                <code>qwerty</code>
                {t("lab.learn_zxcvbn_body_4")}
                <em>{t("lab.learn_zxcvbn_body_5")}</em>
                {t("lab.learn_zxcvbn_body_6")}
                <code>@</code>
                {t("lab.learn_zxcvbn_body_7")}
              </Learn>
            </div>
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-white/10 bg-white/[0.03] text-[10px] text-white/40 rounded-b-2xl">
          {t("lab.footer_privacy_note")}
        </div>
      </div>
    </div>
  );
}

// ---------- Sub-components ----------

function Section({
  testId,
  title,
  icon,
  subtitle,
  defaultOpen = true,
  children,
}: {
  testId: string;
  title: string;
  icon: ReactNode;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border bg-white/[0.04] border-white/10 transition"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-3.5"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center">
            {icon}
          </div>
          <span className="text-sm font-semibold text-white">{title}</span>
          {subtitle && (
            <span className="text-[11px] text-white/40 font-medium">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-white/40 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-3.5 pb-3.5">{children}</div>}
    </div>
  );
}

function StrengthMeter({
  pwd,
  strength,
  analyzing,
}: {
  pwd: string;
  strength: StrengthResult | null;
  analyzing: boolean;
}) {
  const score = strength?.score ?? 0;
  return (
    <div data-testid="lab-strength-meter" className="mt-3 space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-white/70">
          {strength ? scoreLabel(score) : analyzing ? "Analyserer…" : "—"}
        </span>
        {strength && (
          <span className="font-mono text-white/50">
            Knekk-tid:{" "}
            <span className="text-white/85">{strength.crackTime}</span>
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            data-testid={`lab-strength-bar-${i}`}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              strength && i <= score
                ? scoreColor(score as 0 | 1 | 2 | 3 | 4)
                : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40 font-mono">
        <span>{pwd.length} tegn</span>
        {strength && (
          <span>{Math.round(strength.guessesLog10 * 3.32)} bits entropi</span>
        )}
      </div>
      {strength?.warning && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-400/20 text-[11px] text-amber-100">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{strength.warning}</span>
        </div>
      )}
      {strength && strength.suggestions.length > 0 && (
        <ul className="space-y-1 text-[11px] text-white/60">
          {strength.suggestions.map((s, i) => (
            <li
              key={i}
              data-testid={`lab-suggestion-${i}`}
              className="flex items-start gap-1.5"
            >
              <span className="text-white/30 mt-0.5">›</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({
  testId,
  label,
  hint,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition ${
        checked
          ? "bg-violet-500/15 border-violet-400/60 text-white"
          : "bg-white/5 border-white/10 text-white/55 hover:bg-white/10 hover:border-white/20"
      }`}
    >
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
          checked
            ? "bg-violet-400 border-violet-300"
            : "bg-white/5 border-white/25"
        }`}
      >
        {checked && <Check className="h-3 w-3 text-slate-900" />}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-mono font-semibold truncate">{label}</div>
        <div className="text-[10px] text-white/45 truncate">{hint}</div>
      </div>
    </button>
  );
}

function Learn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
      <div className="text-[12px] font-semibold text-white/90 mb-0.5">
        {title}
      </div>
      <div className="text-[11px] text-white/65 leading-relaxed">
        {children}
      </div>
    </div>
  );
}
