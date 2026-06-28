# Ko|Do · Vault — i18n-konvensjoner (v4.2+)

> **For agenter:** Dette er den definitive guiden for å håndtere språk (NO/SV/DA) når du bygger nye features eller endrer eksisterende UI. **Les hele filen før du legger til en eneste hardkodet streng.**

---

## TL;DR — Sjekkliste for nye strenger

For HVER ny brukervendt streng du skriver:

1. ✅ Velg nøkkel-navn: `feature.element_purpose` (snake_case, dot-notation)
2. ✅ Legg verdien til i `/app/frontend/lib/locales/no.json` (norsk er kanonisk)
3. ✅ Bruk `t("feature.element_purpose")` i React-komponent ELLER `tHook("...")` utenfor React-treet
4. ✅ Synkroniser `sv.json` + `da.json` byte-likt med `no.json`
5. ✅ Verifiser: `npx tsc --noEmit && npx tsx lib/__tests__/i18n.test.ts && yarn build`

**Aldri hardkod brukervendt tekst på norsk. Aldri.** Hvis du gjør det, vil SV/DA-brukere se norsk midt i appen deres.

---

## 1. Arkitektur

### Filer

| Fil | Rolle |
|---|---|
| `lib/i18n.ts` | Kjerne: `translate()`, `tHook()`, `resolveInitialLocale()`, BCP-47-mapping |
| `lib/i18n-context.tsx` | React Context: `<LocaleProvider>`, `useLocale()` |
| `lib/locales/no.json` | **Kanonisk ordbok.** Norsk er DEFAULT_LOCALE og fallback. |
| `lib/locales/sv.json` | Svensk. Byte-likt med no.json bortsett fra `_meta` + verdier. |
| `lib/locales/da.json` | Dansk. Byte-likt med no.json bortsett fra `_meta` + verdier. |
| `lib/format-date.ts` | Locale-aware dato + sortering |
| `components/LanguagePicker.tsx` | UI-velger med flagg |
| `components/LocalePromptToast.tsx` | Første-besøks språk-tilbud (når navigator.language ≠ no) |
| `lib/__tests__/i18n.test.ts` | 63 assertions — kjør før commit |

### Fallback-kjede

```
1. localStorage["kodo-locale"]                       (brukers eksplisitte valg)
2. tenant default (clients/*.json: defaultLocale)
3. navigator.language → "no" | "sv" | "da"
4. DEFAULT_LOCALE = "no"
```

Hvis en nøkkel finnes i `no.json` men IKKE i `sv.json`, returnerer `t("min.key")` automatisk den norske verdien. Dette betyr: **alltid legg nøkler i no.json først.**

---

## 2. Nøkkel-navnekonvensjon

### Format: `feature.element_purpose`

| Eksempel | God/Dårlig |
|---|---|
| `pack.label_name` | ✅ |
| `pack.encrypt_button` | ✅ |
| `unpack.error_wrong_password` | ✅ |
| `vault.error_too_many_attempts` | ✅ |
| `card_modal.compress_error_prefix` | ✅ |
| `PackName` | ❌ camelCase forbudt |
| `packLabelName` | ❌ camelCase forbudt |
| `pack-label-name` | ❌ kebab-case forbudt |
| `pack.label.name` | ❌ nested forbudt — bruk flat |
| `Pakke navn` | ❌ mellomrom forbudt |

### Områder vi har i dag (per 2026-05-28)

| Prefiks | Hva |
|---|---|
| `common.*` | Universelle: cancel, close, save, em_dash, loading_short, etc |
| `auth.*` | Login, vault-unlock, master-password |
| `vault.*` | Vault-modul errors og UI |
| `entry.*` | Passord-oppføringer |
| `cards.*`, `card_modal.*`, `card_type.*` | Kort |
| `ids.*`, `id_modal.*`, `id_kind.*` | ID-er |
| `pack.*`, `unpack.*`, `package.*`, `package_zip.*` | Sikker overlevering |
| `package_hub.*`, `package_preview.*`, `package_entry.*` | Pakker hub |
| `search.*` | Søk-palett |
| `settings.*` | Settings-panel |
| `event_log.*` | Aktivitetslogg |
| `lab.*` | Password Lab |
| `webauthn.*` | Biometric (Touch ID / Face ID) errors |
| `pwd_warning.*`, `pwd_suggestion.*`, `pwd_score.*` | zxcvbn-feedback |
| `crack_time.*` | Tid-enheter for passord-styrke |
| `backup_export.*`, `backup_import.*`, `backup.*` | Backup |
| `ids_attachment.*` | ID-vedlegg |
| `page.*` | app/page.tsx toasts |
| `app.*` | app-nivå (html_title) |
| `language_picker.*` | LanguagePicker-komponenten |

**Når du legger til en ny feature:** velg et prefiks (eks. `subscription.*` for v4.3). Hold deg innenfor området.

---

## 3. Bruk i kode — 3 mønstre

### Mønster A — React-komponenter (90% av tilfellene)

```tsx
import { useLocale } from "@/lib/i18n-context";

export function MyComponent() {
  const { t, locale, setLocale } = useLocale();
  return (
    <div>
      <h2>{t("my_feature.title")}</h2>
      <button>{t("common.save")}</button>
    </div>
  );
}
```

`useLocale()` gir deg:
- `t(key)` — oversett til aktiv locale
- `locale` — aktiv locale ("no" | "sv" | "da")
- `setLocale(next)` — bytt locale (lagrer i localStorage)
- `hydrated` — `false` under SSR/første render, deretter `true`

### Mønster B — Helper-funksjoner og hooks (utenfor React-treet)

Hvis koden din kjører i en `lib/`-modul, custom hook (`useVault`, `useCards`, `useIds`) eller event-handler som ikke trivielt kan kalle `useLocale()`, bruk **`tHook()`**:

```ts
import { tHook } from "@/lib/i18n";

export async function fetchSomething() {
  if (!isOk) {
    throw new Error(tHook("my_feature.error_not_ok"));
  }
}
```

`tHook()` leser aktiv locale fra `localStorage`. Trygt fordi det kalles i client-runtime etter mount.

**Eksempler i kodebasen:**
- `lib/webauthn.ts` — Touch ID/Face ID-errors
- `lib/package.ts` — pack-validering
- `lib/password-strength.ts` — zxcvbn-feedback
- `lib/vault-sync.ts` / `lib/cards-sync.ts` / `lib/ids-sync.ts` — rate-limit-errors
- `hooks/useVault.ts` / `useCards.ts` / `useIds.ts` — throw-meldinger

### Mønster C — Pure funksjoner som mottar locale eksplisitt

Når koden din IKKE skal lese localStorage (f.eks. tester, SSR-utility), bruk `translate(key, locale)` direkte:

```ts
import { translate, type Locale } from "@/lib/i18n";

function eventMeta(kind: string, locale: Locale) {
  return { label: translate(`event_log.event_${kind}`, locale) };
}
```

**Eksempel:** `EventLogPanel.tsx:eventMeta()` — locale propageres som argument fra parent.

### Hvilket mønster?

```
Er du i en React-komponent?
├─ Ja → Mønster A (useLocale)
└─ Nei → Trenger du locale fra localStorage?
   ├─ Ja → Mønster B (tHook)
   └─ Nei → Mønster C (translate med eksplisitt locale)
```

---

## 4. Synkronisering NO ↔ SV ↔ DA

### Regel: SV og DA er byte-likt med NO bortsett fra `_meta` + verdier

`sv.json` og `da.json` MÅ ha:
- ✅ Eksakt samme nøkler som `no.json`
- ✅ Eksakt samme rekkefølge på nøkler
- ✅ Eksakt samme indentering og spacing
- ✅ Forskjellig `_meta`-blokk øverst
- ✅ Verdier oversatt (eller midlertidig kopi av norsk som placeholder)

### Når du legger til nye nøkler

**Regel:** Nye nøkler legges på slutten av no.json, sv.json og da.json — i en `_section_new_keys`-blokk som er synlig nederst i filen. Plassering i JSON spiller ingen rolle for koden (object lookup er O(1)), men det gjør det trivielt for Mike å se nye strenger som venter på oversettelse.

**Steg 1 — Legg til i `no.json` (NEDERST, i `_section_new_keys`-blokken):**

Finn `_section_new_keys`-separatoren nederst i fila og legg de nye nøklene under den:

```json
  "_section_new_keys": "═══ NYE NØKLER — venter på oversettelse. Flytt opp til riktig prefiks-område når oversatt. ═══",

  "my_feature.title": "Min nye tittel",
  "my_feature.button": "Klikk her",
  "another.key": "Annen verdi"
}
```

**Steg 2 — Synkroniser sv.json + da.json:** Legg de samme nye nøklene under deres `_section_new_keys`-blokk med norsk verdi som placeholder. Eksisterende oversettelser i resten av filen forblir uberørt.

**Steg 3 — Mike oversetter:**
Mike åpner sv.json/da.json, scroller til bunnen, ser blokken med norsk-som-placeholder, oversetter verdiene. Når han er ferdig kan han evt. flytte dem opp til riktige prefiks-områder.

**Steg 4 — Verifiser:**

```bash
cd /app/frontend
npx tsc --noEmit                          # 0 errors
npx tsx lib/__tests__/i18n.test.ts        # 63/63 OK
yarn build                                 # Done
```

### Aldri gjør disse feilene

❌ **Ikke endre nøkler i sv/da uten å først endre no** — du bryter synkronisering
❌ **Ikke "oversette" nøkler** — nøkler er kode-identifikatorer, IKKE bruker-tekst
❌ **Ikke flytte rundt på nøkler** uten å re-synkronisere alle tre filer
❌ **Ikke lage nested objekter** (`"pack": { "title": "..." }`) — vi har **flat dot-notation**

---

## 5. Dato, tall og sortering

### Bruk ALDRI

```ts
// ❌ FORBUDT — hardkodet norsk:
date.toLocaleString("nb-NO");
date.toLocaleDateString("nb-NO", { year: "numeric" });
items.sort((a, b) => a.title.localeCompare(b.title, "nb-NO"));
```

### Bruk ALLTID

```ts
// ✅ Riktig — locale-aware:
import { formatShortDate, formatShortDateTime, formatLongDate, localeCompare } from "@/lib/format-date";

formatShortDate("2034-05-12", locale);       // NO: "12.5.2034"   SV: "2034-05-12"  DA: "12.5.2034"
formatShortDateTime(iso, locale);            // NO: "12.05.2034, 14:32"   SV: "2034-05-12 14:32"
formatLongDate(iso, locale);                 // NO: "12. mai 2034"   SV: "12 maj 2034"
items.sort((a, b) => localeCompare(a.title, b.title, locale));
```

Bruk `localeToBcp47(locale)` hvis du må sende BCP-47-format til et tredjeparts-API.

### Pluralisering — vi har INGEN plural-engine

Hvis du trenger pluralisering, bruk 2 separate nøkler:

```json
"unpack.count_file_singular": "fil",
"unpack.count_file_plural": "filer"
```

```tsx
{count === 1 ? t("unpack.count_file_singular") : t("unpack.count_file_plural")}
```

Hvorfor: D-036-design — lettvekts, ingen ekstra dependencies. ICU MessageFormat kan vurderes hvis behovet vokser.

---

## 6. HTML/JSX i strenger — splittes til flate nøkler

Per ADR D-036: **ingen HTML/JSX i translation-verdier.**

### ❌ FORBUDT

```json
"pack.warning": "<strong>Passordet vises ikke igjen.</strong> Send det på sikker kanal."
```

### ✅ Riktig — splitt til separate nøkler

```json
"pack.warning_pwd_once_strong": "Passordet vises ikke igjen.",
"pack.warning_pwd_rest": "Send det på sikker kanal — IKKE i samme e-post som fila."
```

```tsx
<p>
  <strong>{t("pack.warning_pwd_once_strong")}</strong>{" "}
  {t("pack.warning_pwd_rest")}
</p>
```

For inline `<code>`/`<em>`-fragmenter i lengre setninger:

```json
"lab.learn_zxcvbn_body_1": "Motor brukt av 1Password og Bitwarden. Sjekker mot ",
"lab.learn_zxcvbn_body_2": "dictionaries",
"lab.learn_zxcvbn_body_3": ", kjente lekkede passord, tastatur-walks (",
"lab.learn_zxcvbn_body_4": "), gjentagelser, datoer og ",
```

```tsx
<>
  {t("lab.learn_zxcvbn_body_1")}
  <em>{t("lab.learn_zxcvbn_body_2")}</em>
  {t("lab.learn_zxcvbn_body_3")}
  <code>qwerty</code>
  {t("lab.learn_zxcvbn_body_4")}
</>
```

Hvorfor: SV/DA-oversettelser kan ha ulik setningsstruktur. Splittede nøkler lar oversetter beholde semantikken.

---

## 7. Hva som IKKE oversettes (D-001 zero-knowledge)

### Brukerdata = ALDRI oversettes

- Passord-titler, brukernavn, notater (de er kryptert blob — ALDRI tilgjengelig for oss)
- Kort-titler, kortholders navn, utstedere
- ID-titler, pass-nummer, sertifikat-klasser

### Produktnavn / varemerker

- `"Ko|Do · Vault"` — produktnavnet
- `"Ko|Do"` — selskapet
- `".kodoenc"` — filendelse
- `"kodo-vault.vercel.app/unpack"` — URL
- `"BankID"`, `"Touch ID"`, `"Face ID"`, `"Windows Hello"` — eksterne varemerker

Disse skal være hardkodet i JSX/TSX som-er.

### Tenant-config (per-tenant override)

`clients/*.json` har `brand.name` og `brand.tagline` per tenant. Hvis du vil ha tagline per språk per tenant, legg til `taglineSv` / `taglineDa` i tenant-JSON og les i `AppHeader`. Ikke gjør dette uten å spørre Mike først.

---

## 8. Når du legger til en HEL ny feature/modul

### Eksempel: v4.3 Subscription/Stripe

1. **Lag nytt nøkkel-prefiks:** `subscription.*` eller `billing.*`
2. **Skriv komponent med `useLocale()` fra dag 1:**

```tsx
"use client";
import { useLocale } from "@/lib/i18n-context";

export function SubscriptionModal() {
  const { t, locale } = useLocale();
  return (
    <div>
      <h2>{t("subscription.title")}</h2>
      <p>{t("subscription.intro")}</p>
      <button>{t("subscription.upgrade_button")}</button>
    </div>
  );
}
```

3. **Legg ALLE strenger samtidig i `no.json`** (ikke drip-feed — det bryter sync)
4. **Synkroniser sv.json + da.json** med kopi-scriptet over
5. **Kjør sjekklisten:**
   ```bash
   cd /app/frontend
   npx tsc --noEmit                          # 0 errors
   npx tsx lib/__tests__/i18n.test.ts        # 63/63 OK
   yarn build                                 # Done
   ```

6. **Sluttsjekk — grep for norske strenger:**

```bash
cd /app/frontend
grep -rEn '"[A-ZÆØÅa-zæøå][^"]*[æøåÆØÅ][^"]*"' \
  components/SubscriptionModal.tsx hooks/useSubscription.ts lib/subscription*.ts 2>/dev/null \
  | grep -vE "//|/\*|className|data-testid|aria-hidden" \
  | grep -E '"[A-ZÆØÅ]|" [a-zæøå]'
```

Forventet: **0 treff**.

---

## 9. Auto-detect-prompt (LocalePromptToast)

Når en bruker åpner appen for første gang, og:
- ingen locale er lagret i `localStorage["kodo-locale"]`
- ingen "prompted"-flagg i `localStorage["kodo-locale-prompted"]`
- `navigator.language.slice(0,2)` ≠ `"nb" | "nn" | "no"`

...vises en diskret bunn-høyre toast med valg mellom 🇳🇴/🇸🇪/🇩🇰 (750ms inn-delay, 15s auto-dismiss).

**Endre IKKE denne logikken** uten å konsultere Mike — det er en eksplisitt UX-beslutning.

Hvis du legger til et nytt språk i fremtiden (f.eks. engelsk):
1. Legg til `"en"` i `LOCALES` i `lib/i18n.ts`
2. Legg til `en` i `LOCALE_META` (flagg-emoji + nativeLabel)
3. Lag `lib/locales/en.json` (kopi av no.json med engelske verdier)
4. Oppdater `localeToBcp47()` i `format-date.ts`
5. Oppdater LocalePromptToast — sannsynligvis må toasten ha 4 knapper i stedet for 3

---

## 10. Testing

`lib/__tests__/i18n.test.ts` har 63 assertions som dekker:
- `translate()` med direkte treff, fallback, og siste-utvei
- `isValidLocale()` type-guard
- `matchNavigatorLocale()` for alle 3 språk + edge cases
- `resolveInitialLocale()` med full deteksjons-kjede
- `formatShortDate`, `formatLongDate`, `formatShortDateTime`
- `localeToBcp47` mapping
- `localeCompare` collation
- Tom/ugyldig input

**Kjør før hver commit:**

```bash
cd /app/frontend
npx tsx lib/__tests__/i18n.test.ts
```

Hvis du legger til nye dato-/sorterings-funksjoner i `format-date.ts`, **utvid testen** med tilsvarende assertions.

---

## 11. Vanlige feil agenter har gjort før

| Feil | Hva skjer | Fix |
|---|---|---|
| Hardkoder norsk streng i JSX | SV/DA-brukere ser norsk midt i appen | Legg i no.json, bruk `t()` |
| Glemmer å synkronisere sv/da | `t("ny.key")` returnerer key selv på sv/da | Sync byte-likt med scriptet |
| Bruker `translate(key, "no")` i komponent | Locale-låst til norsk | Bruk `t()` fra `useLocale()` |
| Bruker `toLocaleString("nb-NO")` | Datoer locale-låst | Bruk `formatShortDateTime(iso, locale)` |
| Glemmer å passe `locale` ned til helper | Helper bruker default | Send locale som argument |
| Lager nested objekter i JSON | i18n-systemet støtter ikke nested | Flat dot-notation |
| HTML i string-verdi | Bryter SV/DA-setningsstruktur | Splitt til flate nøkler |
| Bruker `useLocale()` utenfor React-treet | Crash | Bruk `tHook()` i stedet |

---

## 12. Status per 2026-05-28 (v4.2.1)

| Tall | Verdi |
|---|---|
| Translation-nøkler i no.json | **748** (+ 1 `_section_new_keys`-separator = 749 totalt entries) |
| sv.json/da.json/en.json synket | byte-likt med no.json |
| Språk støttet | **4** (no/sv/da/en) |
| Hardkodede norske brukervendte strenger | **0** |
| Hardkodede `nb-NO` utenfor `format-date.ts` | **0** |
| Komponenter ekstrahert | 30/30 |
| i18n.test.ts assertions | 63/63 grønne |

**Kjente unntak (akseptert av Mike):**
- `app/layout.tsx:14` — SSR HTML title (klient-side overrides via `LocaleProvider`)
- `lib/config.ts:212` — tenant `brand.name` / `brand.tagline` (per-tenant config, Mike håndterer manuelt)

---

## 13. Når i tvil — spør Mike

Mike bruker norsk bokmål. Spør på norsk. Han har lav toleranse for løs ekstraksjon og høy toleranse for å bygge ting skikkelig én gang.

Hvis du oppdager en hardkodet streng som ikke står i listen over kjente unntak — **fiks den**. Ikke nevn det som "polish for senere" eller "low-priority backlog". Hvis du legger til en streng, og du er usikker på hvilket prefiks den hører hjemme i — bruk eksisterende konvensjon eller spør.

**Ferdig betyr ferdig.**
