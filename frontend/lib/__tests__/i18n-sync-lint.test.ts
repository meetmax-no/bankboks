/**
 * Ko | Do · Vault — Iter 19.9.19 (2026-06-26) — i18n-sync lint
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/i18n-sync-lint.test.ts`
 *      eller `yarn lint:i18n-sync`
 *
 * Automatiserer sjekken som tidligere ble gjort manuelt av fork-agent:
 * "har alle 4 språkfiler de samme nøklene, og finnes hver `t("…")`-bruk
 * i kilden faktisk i no.json?"
 *
 * **Tre sjekker (alle FAIL):**
 *
 *   1. **Parity** — alle 4 språkfiler skal ha identisk key-set.
 *      Avviker no.json fra sv/da/en (eller omvendt) → fail med eksakt
 *      diff.  Norsk er kanonisk per D-036, så missing-from-no er
 *      strengere enn missing-from-sv (vi tillater ikke svensk-/dansk-
 *      /engelsk-only nøkler).
 *
 *   2. **Used-key existence** — hver litterale `t("xxx.yyy")`-,
 *      `tHook("xxx.yyy")`- eller `translate("xxx.yyy", ...)`-bruk i .ts/
 *      .tsx-filer skal eksistere i no.json. Hvis ikke → fail (key er
 *      stavet feil, eller mangler i locale-fila).
 *
 *   3. **Unused keys** — nøkler i no.json som hverken brukes som
 *      litteral `t()`/`tHook()`/`translate()`-arg eller som string-
 *      litteral matchende key-pattern noe sted i kildekoden. Hvis du
 *      bruker en nøkkel dynamisk via Record-mapping eller template-
 *      string (`t(\`prefix.${var}\`)`), legg den på
 *      `KEYS_EXEMPT_FROM_UNUSED` med begrunnelse (filnavn:linje).
 *
 * **Dynamisk t()-bruk** (`t(VAR)` / `t(MAP[k])`) hoppes over for sjekk 2
 * — vi kan ikke statisk vite hvilken key som brukes. For å fange disse
 * indirekte går vi gjennom *alle* string-litteraler i kildefiler og
 * matcher mot key-pattern `\bword.word_with_underscores\b` — disse
 * teller som "brukt" for sjekk 3. Likevel kan template-string-keys
 * (`pwd_score.0`–`4`) ikke fanges sånn → må eksempt'es eksplisitt.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");

const LOCALES = ["no", "sv", "da", "en"] as const;
type Locale = (typeof LOCALES)[number];

/**
 * Nøkler som brukes dynamisk via template-string (`t(\`prefix.${var}\`)`)
 * eller Record-mapping og dermed ikke kan oppdages statisk. Hver oppføring
 * må ha en filnavn:linje-referanse som peker til hvor den dynamiske bruken
 * genererer keyen.
 *
 * Iter 19.9.19: full opprydding — fra 106 unused → 53 dynamic-eksempt
 * (resten ble slettet som verifisert død kode).
 */
const KEYS_EXEMPT_FROM_UNUSED: Record<string, string> = {
  // ── admin_tenants.wizard_step{1..3} — t(`admin_tenants.wizard_step${n}`) ──
  "admin_tenants.wizard_step1":
    "components/platform/TenantViewer.tsx — t(`admin_tenants.wizard_step${n}`) i wizard-stepper (Iter 20.8)",
  "admin_tenants.wizard_step2":
    "components/platform/TenantViewer.tsx — t(`admin_tenants.wizard_step${n}`) i wizard-stepper (Iter 20.8)",
  "admin_tenants.wizard_step3":
    "components/platform/TenantViewer.tsx — t(`admin_tenants.wizard_step${n}`) i wizard-stepper (Iter 20.8)",

  // ── pwd_score.{0..4} — t(`pwd_score.${score}`) ─────────────────
  "pwd_score.0": "lib/password-strength.ts:147 — t(`pwd_score.${score}`)",
  "pwd_score.1": "lib/password-strength.ts:147 — t(`pwd_score.${score}`)",
  "pwd_score.2": "lib/password-strength.ts:147 — t(`pwd_score.${score}`)",
  "pwd_score.3": "lib/password-strength.ts:147 — t(`pwd_score.${score}`)",
  "pwd_score.4": "lib/password-strength.ts:147 — t(`pwd_score.${score}`)",

  // ── register.api_error_* — t(`register.api_error_${errKey}`) ───
  "register.api_error_invalid_email":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_invalid_json":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_invalid_subdomain":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_missing_email":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_missing_subdomain":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_missing_turnstile":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_rate_limited":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_reserved_subdomain":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_subdomain_taken":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",
  "register.api_error_turnstile_failed":
    "app/platform/register/page.tsx:482,536 — t(`register.api_error_${errKey}`)",

  // ── register.plan_badge_* — t(`register.plan_badge_${planId}`) ─
  "register.plan_badge_monthly":
    "app/platform/register/page.tsx:596 — t(`register.plan_badge_${planId}`)",
  "register.plan_badge_trial":
    "app/platform/register/page.tsx:596 — t(`register.plan_badge_${planId}`)",
  "register.plan_badge_yearly":
    "app/platform/register/page.tsx:596 — t(`register.plan_badge_${planId}`)",

  // ── register.submit_button_* — t(`register.submit_button_${planId}`)
  "register.submit_button_monthly":
    "app/platform/register/page.tsx:893 — t(`register.submit_button_${planId}`)",
  "register.submit_button_trial":
    "app/platform/register/page.tsx:893 — t(`register.submit_button_${planId}`)",
  "register.submit_button_yearly":
    "app/platform/register/page.tsx:893 — t(`register.submit_button_${planId}`)",

  // ── event_log.filter_* — t(`event_log.filter_${key}`) ──────────
  "event_log.filter_all":
    "components/EventLogPanel.tsx:174 — t(`event_log.filter_${key}`)",
  "event_log.filter_unlocks":
    "components/EventLogPanel.tsx:174 — t(`event_log.filter_${key}`)",
  "event_log.filter_fails":
    "components/EventLogPanel.tsx:174 — t(`event_log.filter_${key}`)",
  "event_log.filter_modifications":
    "components/EventLogPanel.tsx:174 — t(`event_log.filter_${key}`)",

  // ── settings.lang_*_label — t(`settings.lang_${tenant.locale}_label`)
  "settings.lang_no_label":
    "components/settings/GeneralTab.tsx:105 — t(`settings.lang_${tenant.locale}_label`)",
  "settings.lang_sv_label":
    "components/settings/GeneralTab.tsx:105 — t(`settings.lang_${tenant.locale}_label`)",
  "settings.lang_da_label":
    "components/settings/GeneralTab.tsx:105 — t(`settings.lang_${tenant.locale}_label`)",
  "settings.lang_en_label":
    "components/settings/GeneralTab.tsx:105 — t(`settings.lang_${tenant.locale}_label`)",

  // ── platform_test.plan_{trial,monthly,yearly,enterprise}_* ─────
  //    t(`platform_test.plan_${planId}_${field}`) i app/platform/test/page.tsx:144–175
  //    field ∈ {name, desc, price, bullet1, bullet2, cta}
  "platform_test.plan_trial_name":
    "app/platform/test/page.tsx:144 — t(`platform_test.plan_${planId}_name`)",
  "platform_test.plan_trial_desc":
    "app/platform/test/page.tsx:151 — t(`platform_test.plan_${planId}_desc`)",
  "platform_test.plan_trial_price":
    "app/platform/test/page.tsx:154 — t(`platform_test.plan_${planId}_price`)",
  "platform_test.plan_trial_bullet1":
    "app/platform/test/page.tsx:159 — t(`platform_test.plan_${planId}_bullet1`)",
  "platform_test.plan_trial_bullet2":
    "app/platform/test/page.tsx:163 — t(`platform_test.plan_${planId}_bullet2`)",
  "platform_test.plan_trial_cta":
    "app/platform/test/page.tsx:175 — t(`platform_test.plan_${planId}_cta`)",
  "platform_test.plan_monthly_name":
    "app/platform/test/page.tsx:144 — t(`platform_test.plan_${planId}_name`)",
  "platform_test.plan_monthly_desc":
    "app/platform/test/page.tsx:151 — t(`platform_test.plan_${planId}_desc`)",
  "platform_test.plan_monthly_price":
    "app/platform/test/page.tsx:154 — t(`platform_test.plan_${planId}_price`)",
  "platform_test.plan_monthly_bullet1":
    "app/platform/test/page.tsx:159 — t(`platform_test.plan_${planId}_bullet1`)",
  "platform_test.plan_monthly_bullet2":
    "app/platform/test/page.tsx:163 — t(`platform_test.plan_${planId}_bullet2`)",
  "platform_test.plan_monthly_cta":
    "app/platform/test/page.tsx:175 — t(`platform_test.plan_${planId}_cta`)",
  "platform_test.plan_yearly_name":
    "app/platform/test/page.tsx:144 — t(`platform_test.plan_${planId}_name`)",
  "platform_test.plan_yearly_desc":
    "app/platform/test/page.tsx:151 — t(`platform_test.plan_${planId}_desc`)",
  "platform_test.plan_yearly_price":
    "app/platform/test/page.tsx:154 — t(`platform_test.plan_${planId}_price`)",
  "platform_test.plan_yearly_bullet1":
    "app/platform/test/page.tsx:159 — t(`platform_test.plan_${planId}_bullet1`)",
  "platform_test.plan_yearly_bullet2":
    "app/platform/test/page.tsx:163 — t(`platform_test.plan_${planId}_bullet2`)",
  "platform_test.plan_yearly_cta":
    "app/platform/test/page.tsx:175 — t(`platform_test.plan_${planId}_cta`)",
  "platform_test.plan_enterprise_name":
    "app/platform/test/page.tsx:144 — t(`platform_test.plan_${planId}_name`)",
  "platform_test.plan_enterprise_desc":
    "app/platform/test/page.tsx:151 — t(`platform_test.plan_${planId}_desc`)",
  "platform_test.plan_enterprise_price":
    "app/platform/test/page.tsx:154 — t(`platform_test.plan_${planId}_price`)",
  "platform_test.plan_enterprise_bullet1":
    "app/platform/test/page.tsx:159 — t(`platform_test.plan_${planId}_bullet1`)",
  "platform_test.plan_enterprise_bullet2":
    "app/platform/test/page.tsx:163 — t(`platform_test.plan_${planId}_bullet2`)",
  "platform_test.plan_enterprise_cta":
    "app/platform/test/page.tsx:175 — t(`platform_test.plan_${planId}_cta`)",
};

/** Filer å skanne for `t()`-bruk og i18n-key-litteraler. */
const SOURCE_DIRS = ["app", "components", "lib", "hooks"] as const;

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function loadLocale(locale: Locale): Record<string, string> {
  const path = join(REPO_ROOT, "lib", "locales", `${locale}.json`);
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  // Speil lib/i18n.ts:flatten — skipp alle _*-prefiks-nøkler og ikke-string-verdier.
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

function findSourceFiles(): string[] {
  const found: string[] = [];
  for (const dir of SOURCE_DIRS) {
    const fullDir = join(REPO_ROOT, dir);
    if (!existsSync(fullDir)) continue;
    try {
      // Ekskluderer __tests__ (lint-skript bruker key-strenger til egen
      // bookkeeping og ville rapporteres som "brukt" feilaktig).
      const output = execSync(
        `find ${fullDir} \\( -name '*.ts' -o -name '*.tsx' \\) -type f -not -path '*/__tests__/*' -not -path '*/node_modules/*'`,
        { encoding: "utf-8" },
      );
      output
        .split("\n")
        .filter((l) => l.trim())
        .forEach((p) => found.push(p));
    } catch {
      // tom mappe → skip
    }
  }
  return found.sort();
}

/**
 * Pattern som matcher en sannsynlig i18n-nøkkel:
 *   - starter med en lowercase bokstav
 *   - har minst én `.` etterfulgt av et ord
 *
 * Eks treff:    "vault.unlock_title"   "common.cancel"   "ids.kind_pass"
 */
const I18N_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,2}$/;

/**
 * Skann en kildefil for:
 *   - `t("literal")` / `tHook("literal")` / `translate("literal", ...)` →
 *     "literal" registreres som "called"
 *   - `t(VARIABLE)` / `tHook(VAR)` / `translate(VAR, ...)` → "dynamic"
 *   - alle andre string-litteraler matchende I18N_KEY_RE → "referenced"
 *     (fanger Record-mappings som ID_KIND_LABEL_KEY)
 */
function scanFile(filePath: string): {
  called: Set<string>;
  referenced: Set<string>;
  hasDynamic: boolean;
} {
  const content = readFileSync(filePath, "utf-8");
  const called = new Set<string>();
  const referenced = new Set<string>();
  let hasDynamic = false;

  // 1. t("literal") / tHook("literal") / translate("literal", ...)
  const tCallRe =
    /\b(?:t|tHook|translate)\s*\(\s*(["'`])([a-z][a-z0-9_.]*)\1\s*[),]/gi;
  let m: RegExpExecArray | null;
  while ((m = tCallRe.exec(content)) !== null) {
    if (I18N_KEY_RE.test(m[2])) called.add(m[2]);
  }

  // 2. t(IDENTIFIER) / tHook(VAR) / translate(VAR, ...) — markér dynamic
  const tDynamicRe =
    /\b(?:t|tHook|translate)\s*\(\s*[A-Za-z_][\w]*\s*(?:\[|\)|,)/g;
  if (tDynamicRe.test(content)) hasDynamic = true;

  // 3. Alle string-litteraler matchende i18n-nøkkel-pattern (fanger
  //    Record<X, string>-mappings og lignende).
  const stringRe = /(["'`])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,2})\1/g;
  while ((m = stringRe.exec(content)) !== null) {
    referenced.add(m[2]);
  }

  return { called, referenced, hasDynamic };
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────

function main() {
  // ── Last alle 4 locale-filer ────────────────────────────────────
  const dicts: Record<Locale, Record<string, string>> = {
    no: loadLocale("no"),
    sv: loadLocale("sv"),
    da: loadLocale("da"),
    en: loadLocale("en"),
  };

  const noKeys = new Set(Object.keys(dicts.no));

  console.log(`\n[i18n-sync-lint] Lastet 4 locale-filer:`);
  for (const locale of LOCALES) {
    console.log(`  ${locale}.json: ${Object.keys(dicts[locale]).length} nøkler`);
  }

  // ── Sjekk 1: Parity mellom de 4 språkene ────────────────────────
  const parityErrors: string[] = [];
  for (const locale of LOCALES) {
    const localeKeys = new Set(Object.keys(dicts[locale]));

    const missingFromLocale = [...noKeys].filter((k) => !localeKeys.has(k));
    if (missingFromLocale.length > 0) {
      parityErrors.push(
        `${locale}.json mangler ${missingFromLocale.length} nøkler som finnes i no.json:\n` +
          missingFromLocale.map((k) => `      - ${k}`).join("\n"),
      );
    }

    if (locale !== "no") {
      const extra = [...localeKeys].filter((k) => !noKeys.has(k));
      if (extra.length > 0) {
        parityErrors.push(
          `${locale}.json har ${extra.length} nøkler som IKKE finnes i no.json (no er kanonisk per D-036):\n` +
            extra.map((k) => `      - ${k}`).join("\n"),
        );
      }
    }
  }

  // ── Skann all kildekode ─────────────────────────────────────────
  const files = findSourceFiles();
  const calledKeys = new Set<string>();
  const referencedKeys = new Set<string>();
  const filesWithDynamic: string[] = [];
  for (const file of files) {
    const { called, referenced, hasDynamic } = scanFile(file);
    called.forEach((k) => calledKeys.add(k));
    referenced.forEach((k) => referencedKeys.add(k));
    if (hasDynamic) filesWithDynamic.push(relative(REPO_ROOT, file));
  }

  console.log(
    `\n[i18n-sync-lint] Skannet ${files.length} kildefiler — fant ${calledKeys.size} unike t/tHook/translate("…")-litteraler, ${referencedKeys.size} unike key-formede strenger totalt`,
  );
  if (filesWithDynamic.length > 0) {
    console.log(
      `[i18n-sync-lint] ${filesWithDynamic.length} filer bruker dynamisk t(VAR) — verifiseres via Record-mapping-strenger og EXEMPT-liste`,
    );
  }

  // ── Sjekk 2: Hver `t("…")`-bruk må eksistere i no.json ──────────
  const undefinedKeys: string[] = [];
  for (const key of calledKeys) {
    if (!noKeys.has(key)) undefinedKeys.push(key);
  }

  // ── Sjekk 3: Unused-nøkler i no.json (FAIL) ─────────────────────
  // En nøkkel anses som brukt hvis den finnes som t("...")-litteral
  // ELLER som hvilken som helst string-litteral matchende key-pattern
  // ELLER er eksplisitt på KEYS_EXEMPT_FROM_UNUSED (dynamisk bruk).
  const usedKeys = new Set<string>([...calledKeys, ...referencedKeys]);
  const unusedKeys: string[] = [];
  for (const key of noKeys) {
    if (usedKeys.has(key)) continue;
    if (key in KEYS_EXEMPT_FROM_UNUSED) continue;
    unusedKeys.push(key);
  }

  // ── Sanity: død exempt-oppføring ────────────────────────────────
  const deadExempts: string[] = [];
  for (const k of Object.keys(KEYS_EXEMPT_FROM_UNUSED)) {
    if (!noKeys.has(k)) deadExempts.push(k);
  }

  // ── D-121: stale exempt-oppføring (kildefilen finnes ikke lenger
  //    ELLER det dynamiske mønsteret er fjernet fra fila). Vi parser
  //    "path/to/file.tsx" og evt. `${var}`-mønster fra kommentaren
  //    (verdien i KEYS_EXEMPT_FROM_UNUSED), og sjekker at alle statiske
  //    deler av mønsteret faktisk forekommer i fila. Beskytter framtidige
  //    cleanup-passes mot å miste "fanget" exempt-rader.
  const staleExempts: string[] = [];
  const FILE_PATH_RX = /\b([a-zA-Z0-9_/\-]+\.tsx?)\b/;
  const BACKTICK_PATTERN_RX = /`([^`]+)`/;
  for (const [key, comment] of Object.entries(KEYS_EXEMPT_FROM_UNUSED)) {
    const fm = FILE_PATH_RX.exec(comment);
    if (!fm) continue; // ingen filreferanse → skip (lov for "interne" exempts)
    const fpath = join(REPO_ROOT, fm[1]);
    if (!existsSync(fpath)) {
      staleExempts.push(`${key} — kildefil ${fm[1]} finnes ikke`);
      continue;
    }
    const pm = BACKTICK_PATTERN_RX.exec(comment);
    if (!pm) continue; // ingen template-pattern → kun fil-eksistenssjekk
    const pattern = pm[1];
    const staticParts = pattern.split(/\$\{[^}]+\}/).filter((p) => p.length > 0);
    const content = readFileSync(fpath, "utf-8");
    const missing = staticParts.filter((p) => !content.includes(p));
    if (missing.length > 0) {
      staleExempts.push(
        `${key} — mønster ${pattern} mangler ${missing.length} bit i ${fm[1]}: ${missing.map((m) => JSON.stringify(m)).join(", ")}`,
      );
    }
  }

  // ── Rapport ─────────────────────────────────────────────────────
  let failed = false;

  if (parityErrors.length > 0) {
    failed = true;
    console.error(
      `\n[i18n-sync-lint] FEIL — locale-paritet brutt (${parityErrors.length} avvik):\n`,
    );
    for (const e of parityErrors) console.error(`  ❌ ${e}\n`);
    console.error(
      "  Fiks: legg manglende nøkler til i no.json først (kanonisk), deretter speil ",
    );
    console.error("  oversettelser i sv/da/en. Eller fjern ekstra nøkler fra ikke-no.\n");
  }

  if (undefinedKeys.length > 0) {
    failed = true;
    console.error(
      `\n[i18n-sync-lint] FEIL — ${undefinedKeys.length} t/tHook/translate("…")-bruk refererer nøkler som IKKE finnes i no.json:\n`,
    );
    for (const k of undefinedKeys.sort()) console.error(`  ❌ ${k}`);
    console.error(
      "\n  Fiks: legg nøkkelen til i alle 4 locale-filer, eller rett opp staveskrivefeilen i kilde.\n",
    );
  }

  if (deadExempts.length > 0) {
    failed = true;
    console.error(
      `\n[i18n-sync-lint] FEIL — ${deadExempts.length} oppføringer i KEYS_EXEMPT_FROM_UNUSED finnes ikke i no.json:\n`,
    );
    for (const k of deadExempts) console.error(`  ❌ ${k}`);
    console.error(
      "\n  Fiks: fjern oppføringen fra KEYS_EXEMPT_FROM_UNUSED i denne fila (nøkkelen er slettet).\n",
    );
  }

  if (staleExempts.length > 0) {
    failed = true;
    console.error(
      `\n[i18n-sync-lint] FEIL — ${staleExempts.length} oppføringer i KEYS_EXEMPT_FROM_UNUSED har stale kilde-referanse (D-121):\n`,
    );
    for (const s of staleExempts) console.error(`  ❌ ${s}`);
    console.error(
      "\n  Fiks: enten (a) fjern exempt-oppføringen + alle 4 locale-keys hvis koden er borte, eller (b) oppdater kommentaren med korrekt filsti og pattern hvis den er flyttet.\n",
    );
  }

  if (unusedKeys.length > 0) {
    failed = true;
    console.error(
      `\n[i18n-sync-lint] FEIL — ${unusedKeys.length} nøkler i no.json er ubrukt (verken litteral, string-ref, eller EXEMPT):\n`,
    );
    for (const k of unusedKeys.sort()) console.error(`  ❌ ${k}`);
    console.error(
      "\n  Fiks: hver av disse er enten (a) dynamisk via Record/template — legg på KEYS_EXEMPT_FROM_UNUSED med filnavn:linje-referanse, eller (b) død kode — slett fra alle 4 locale-filer (no/sv/da/en).\n",
    );
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    `\n✓ i18n-sync-lint grønt — ${LOCALES.length} språk i sync (${noKeys.size} nøkler), ${calledKeys.size} t/tHook/translate-bruk verifisert, ${Object.keys(KEYS_EXEMPT_FROM_UNUSED).length} dynamiske nøkler eksempt'et (alle med valid kilde-referanse, D-121)\n`,
  );
}

main();
