// Passord-styrkeanalyse via zxcvbn — industristandard brukt av 1Password,
// Bitwarden, Dropbox. Sjekker mot dictionary-attacks, vanlige mønstre,
// tastatur-walks, gjentagelser osv.
//
// Dynamisk-importert for å unngå å laste ~300 KB på startsiden.
// `analyzeStrength` kan brukes direkte; loader håndterer internt om
// zxcvbn allerede er initialisert.

import type { ZxcvbnResult } from "@zxcvbn-ts/core";
import { tHook } from "./i18n";

export interface StrengthResult {
  /** 0 = veldig svak, 4 = meget sterk */
  score: 0 | 1 | 2 | 3 | 4;
  /** Tid for off-line angrep ved 10 milliarder gjettinger/sek */
  crackTime: string;
  /** Kort tilbakemelding (i aktiv UI-locale) */
  warning: string;
  /** Konkrete forslag til forbedring (i aktiv UI-locale) */
  suggestions: string[];
  /** Estimert entropi i bits */
  guessesLog10: number;
}

// ---------- Lazy init ----------

type ZxcvbnFn = (password: string, userInputs?: string[]) => ZxcvbnResult;
let zxcvbnFn: ZxcvbnFn | null = null;

async function getZxcvbn(): Promise<ZxcvbnFn> {
  if (zxcvbnFn) return zxcvbnFn;
  const [core, common, en] = await Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]);
  core.zxcvbnOptions.setOptions({
    dictionary: {
      ...common.dictionary,
      ...en.dictionary,
    },
    graphs: common.adjacencyGraphs,
    translations: en.translations,
  });
  zxcvbnFn = core.zxcvbn;
  return zxcvbnFn;
}

// ---------- Locale-aware oversettelse av zxcvbn-feedback ----------
// zxcvbn returnerer engelske strings; vi mapper de vanligste til
// translation-keys og bruker `tHook` for å hente aktiv UI-locale.

const WARNING_KEY: Record<string, string> = {
  "Straight rows of keys are easy to guess": "pwd_warning.straight_rows",
  "Short keyboard patterns are easy to guess": "pwd_warning.short_keyboard",
  "Repeats like \"aaa\" are easy to guess": "pwd_warning.repeats_short",
  'Repeats like "abcabcabc" are only slightly harder to guess than "abc"':
    "pwd_warning.repeats_long",
  "Sequences like abc or 6543 are easy to guess": "pwd_warning.sequences",
  "Recent years are easy to guess": "pwd_warning.recent_years",
  "Dates are often easy to guess": "pwd_warning.dates",
  "This is a top-10 common password": "pwd_warning.top10",
  "This is a top-100 common password": "pwd_warning.top100",
  "This is a very common password": "pwd_warning.very_common",
  "This is similar to a commonly used password": "pwd_warning.similar_common",
  "A word by itself is easy to guess": "pwd_warning.single_word",
  "Names and surnames by themselves are easy to guess": "pwd_warning.names",
  "Common names and surnames are easy to guess": "pwd_warning.common_names",
};

const SUGGESTION_KEY: Record<string, string> = {
  "Use a few words, avoid common phrases": "pwd_suggestion.use_words",
  "No need for symbols, digits, or uppercase letters":
    "pwd_suggestion.no_need_symbols",
  "Add another word or two. Uncommon words are better.":
    "pwd_suggestion.add_word",
  "Use a longer keyboard pattern with more turns":
    "pwd_suggestion.longer_keyboard",
  "Avoid repeated words and characters": "pwd_suggestion.avoid_repeats",
  "Avoid sequences": "pwd_suggestion.avoid_sequences",
  "Avoid recent years": "pwd_suggestion.avoid_recent_years",
  "Avoid years that are associated with you":
    "pwd_suggestion.avoid_personal_years",
  "Avoid dates and years that are associated with you":
    "pwd_suggestion.avoid_personal_dates",
  "Capitalization doesn't help very much": "pwd_suggestion.caps_helps_little",
  "All-uppercase is almost as easy to guess as all-lowercase":
    "pwd_suggestion.all_upper",
  "Reversed words aren't much harder to guess": "pwd_suggestion.reversed_words",
  "Predictable substitutions like '@' instead of 'a' don't help very much":
    "pwd_suggestion.predictable_subs",
};

function translateWarning(w: string): string {
  if (!w) return "";
  const key = WARNING_KEY[w];
  return key ? tHook(key) : w;
}

function translateSuggestion(s: string): string {
  const key = SUGGESTION_KEY[s];
  return key ? tHook(key) : s;
}

// ---------- Locale-aware crack-time-strings ----------

function formatCrackTime(seconds: number): string {
  if (seconds < 1) return tHook("crack_time.instant");
  if (seconds < 60) return `${Math.round(seconds)} ${tHook("crack_time.sec_suffix")}`;
  const m = seconds / 60;
  if (m < 60) return `${Math.round(m)} ${tHook("crack_time.min_suffix")}`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} ${tHook("crack_time.hours_suffix")}`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} ${tHook("crack_time.days_suffix")}`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)} ${tHook("crack_time.months_suffix")}`;
  const y = d / 365;
  if (y < 100) return `${Math.round(y)} ${tHook("crack_time.years_suffix")}`;
  if (y < 1_000_000) return `${Math.round(y / 1000)}${tHook("crack_time.k_years_suffix")}`;
  if (y < 1_000_000_000) return `${Math.round(y / 1_000_000)}${tHook("crack_time.m_years_suffix")}`;
  return tHook("crack_time.eternity");
}

// ---------- Public API ----------

export async function analyzeStrength(
  password: string,
  userInputs: string[] = [],
): Promise<StrengthResult> {
  const zxcvbn = await getZxcvbn();
  const result = zxcvbn(password, userInputs);
  const offlineCrack =
    result.crackTimesSeconds.offlineSlowHashing1e4PerSecond;
  const crackSeconds =
    typeof offlineCrack === "number" ? offlineCrack : Number(offlineCrack);
  return {
    score: result.score,
    crackTime: formatCrackTime(crackSeconds),
    warning: translateWarning(result.feedback.warning || ""),
    suggestions: (result.feedback.suggestions || []).map(translateSuggestion),
    guessesLog10: result.guessesLog10,
  };
}

export function scoreLabel(score: 0 | 1 | 2 | 3 | 4): string {
  return tHook(`pwd_score.${score}`);
}

export function scoreColor(score: 0 | 1 | 2 | 3 | 4): string {
  return [
    "bg-rose-500",
    "bg-orange-500",
    "bg-amber-500",
    "bg-lime-500",
    "bg-emerald-500",
  ][score];
}
