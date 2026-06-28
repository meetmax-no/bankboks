# Handoff til ny agent — Ko|Do Vault v4.2 oppstart

**Dato:** 2026-05-26
**Fra:** Tidligere agent (sesjon avsluttet etter v4.1.0 levert + v4.2 arkitektur låst)
**Til:** Ny agent (fresh start, fresh context)
**Mottaker-bruker:** Michael Aagreen (Mike) — bygger av Ko|Do Vault
**Språk:** Norsk — Mike snakker norsk og du må svare på norsk

---

## ✅ STATUS 2026-05-26 — v4.1.0 LEVERT, v4.2 KLAR FOR IMPLEMENTASJON

v4.1.0 (ID-modulen) er bygget, testet (11/11 testsuites grønne, TSC ren, Next prod-build grønn) og pushet til Vercel. v4.2 arkitektur er låst i nye ADR-er (D-035 auth, D-036 i18n). Roadmap er revidert med ny versjons-rekkefølge.

**Din oppgave:** Implementere v4.2 Språkdrakt (NO/SV/DA) basert på arkitekturen i [D-036](DECISIONS.md#d-036--i18n-arkitektur-egen-lett-løsning-flagg-i-header-ingen-url-routing) og [ROADMAP § v4.2](ROADMAP.md).

---

## 0. ALLER FØRSTE STEG — Pull GitHub-repoet inn i /app

GitHub-repoet er **public**. Mike vil at du puller hele repoet inn i /app-strukturen slik at endringer kan saves tilbake via Emergent sin "Save to GitHub"-funksjon.

**Spør Mike om GitHub-URL-en hvis den ikke står her:** `github.com/meetmax-no/bankboks` (Mike: fyll inn)

**Kommando (typisk):**
```bash
cd /app
git init 2>/dev/null || true
git remote add origin https://github.com/<owner>/<repo>.git
git fetch origin
git checkout -f main
```

Etter pull: verifiser at filstruktur matcher det som beskrives i §3 nedenfor. Hvis det er konflikter mellom pod-state og GitHub-state — **stol på GitHub**.

**Aldri kjør:** `git commit`, `git push`, `git reset --hard` på vegne av Mike. Han bruker Emergent sin "Save to GitHub"-knapp for write-operasjoner.

---

## 1. Hvem er Mike og hva bygger han

Mike bygger **Ko|Do Vault** — en sikker, web-basert vault for nordmenn (og snart svensker + dansker) som vil samle passord, kort, ID-er og dokumenter ett sted med zero-knowledge-kryptering.

**Brand-filosofi:** «Lean Security · Not Security as a Service» (per kodovault.no).

Tre urørlige prinsipper:
1. Du eier dataene dine (eksport alltid mulig, ingen vendor lock-in)
2. Zero-knowledge (master-passord forlater aldri Lars sin enhet)
3. 100% eller null (ingen «husk meg», ingen recovery-spørsmål)

**Versjons-status (per 2026-05-26):**
- v2.9 ✅ Passord-vault i prod
- v3.0 ✅ Bankkort med kamera i prod
- v4.0 ✅ Sikker overlevering (.kodoenc-pakker) i prod
- v4.1 ✅ ID-modul (Pass, Førerkort, ID-kort, Helse) i prod (2026-05-26)
- **v4.2 ⏳ Språkdrakt NO/SV/DA — DIN OPPGAVE FRA DAG 1**
- v4.3 📅 Betalingsløsning Stripe / Me & Max AS (129 kr/mnd, 30d trial)
- v4.4 📅 Autentiseringsarkitektur — master-passord som identifikator (D-035)
- v4.5 📅 Lean Security som tjeneste — auto-deployment
- v5.0 📅 BYO Dokument-laget (Drive/Dropbox/USB)

Versjons-rekkefølgen ble revidert 2026-05-26 — se [ROADMAP.md](ROADMAP.md) for kontekst.

---

## 2. Din konkrete oppgave — v4.2 Språkdrakt NO/SV/DA

**Bygg v4.2 Språkdrakt basert på arkitekturen i [D-036](DECISIONS.md#d-036--i18n-arkitektur-egen-lett-løsning-flagg-i-header-ingen-url-routing) og [ROADMAP § v4.2](ROADMAP.md).**

Arkitekturen er **signert av Mike 2026-05-26**. Du skal følge den ord for ord. Hvis du finner noe uklart — spør Mike før du implementerer.

### Hovedbeslutninger (urørlig)

- **Egen lett i18n** — ingen `next-intl`, ingen ICU MessageFormat, ingen URL-routing
- **`t(key, locale)`-funksjon** + JSON-ordbøker per språk
- **Fil-struktur:** `no.json`, `sv.json`, `da.json` (ISO 639-1 språkkoder — IKKE `se.json`/`dk.json`)
- **Flat nøkkel-struktur:** `"auth.unlock_title": "Lås opp vault"` (ikke nested)
- **Fallback-kjede:** `dict[locale][key] ?? dict.no[key] ?? key`
- **Locale i `localStorage`** med `navigator.language` som auto-detect fallback
- **Tre flagg i AppHeader** (🇳🇴 🇸🇪 🇩🇰), klikk bytter umiddelbart uten reload
- **Norsk er referansespråk** — agent bygger `no.json` ved streng-ekstraksjon

### Arbeidsdeling (kritisk!)

**Du (agent) skal:**
- Bygge i18n-infrastruktur (`lib/i18n.ts`, context/hook)
- Ekstrahere alle hardkodede norske strenger til `no.json`
- Lage `LanguagePicker`-komponent (tre flagg) i AppHeader
- Lage `sv.json` og `da.json` som **tomme skall** (samme nøkler som `no.json`, tomme verdier eller TODO-markører)
- Unit-tester for `t()` + fallback-kjede
- E2E-test på tvers av locales

**Mike skal:**
- **Oversette `sv.json` og `da.json` selv** (via Claude direkte — billigere enn å la agenten gjøre det)
- Native speaker review
- Manuell Vercel-testing

**Du skal IKKE generere svensk eller dansk innhold.** Lever tomme skall, så tar Mike over.

### Iter-plan (5–8 timer total)

1. **Iter 1** (~1–1,5t) — `lib/i18n.ts` med `t()`-funksjon + `Locale`-type + `LocaleProvider` React context + `useLocale`-hook + localStorage-persistering + `navigator.language` auto-detect
2. **Iter 2** (~30 min) — `LanguagePicker`-komponent (3 flagg) i AppHeader
3. **Iter 3** (~2–4t, tyngst) — Streng-ekstraksjon fra ~20 komponenter → `no.json`
4. **Iter 4** (~30 min) — Tomme `sv.json` + `da.json`-skall (samme nøkler, tomme verdier)
5. **Iter 5** (~1–2t) — Test fallback-kjeden + `Intl.DateTimeFormat` per locale + bug-fix
6. **Iter 6** (~30 min) — Version-bump til v4.2.0 + PRD/ROADMAP/CHANGELOG-oppdatering + unit-tester

### 🟡 Avklaringer som MÅ tas FØR Iter 1 starter

Tre edge-cases ble flagget under estimering 2026-05-26 og må besluttes av Mike i første samtale før streng-ekstraksjon starter (ellers dobbelt-arbeid):

1. **Dato-format på utløpsdatoer** — kortform (`12.05.2034`) vs lang form (`12. mai 2034`)? `Intl.DateTimeFormat(locale)` håndterer alle nyanser, men hvor skal hvert format brukes?
2. **KOPI-vannmerke på ID-eksport** — beholdes som language-neutral juridisk stempel? Forslag: ja, "KOPI" + ISO-dato.
3. **Backup-filnavn** — locale-spesifikt (`kodo-säkerhetskopia-...json`) eller alltid engelsk (`kodo-vault-backup-...json`)? Forslag: behold engelsk i filnavn, oversett kun knappen.

Se [ROADMAP § v4.2 "Avklaringer som må tas FØR Iter 1"](ROADMAP.md) for full diskusjon med forslag.

### Komponenter som må røres (~20 stk)

```
AppHeader, MasterPasswordSetup, MasterPasswordLogin,
BiometricLoginButton, BiometricEnableCard, ChangeMasterDialog,
DashboardShell, VaultDashboard, EntryModal, PasswordLab,
CardsDashboard, CardModal, IdsDashboard, IdModal,
SearchPalette, BackupExportModal, BackupImportModal,
SettingsPanel, MobileBottomBar, CardCamera, toasts
```

---

## 3. Filstruktur og hvor du finner ting

### /app/memory/ — Sannhetskilden (alltid les disse FØRST)

| Fil | Hva |
|---|---|
| `PRD.md` | Original problem statement + Next Time-liste + v4.1 leveranse-rapport |
| `ROADMAP.md` | Versjons-rekkefølge (revidert 2026-05-26), persona-fortellinger, full v4.2-skisse med edge-cases |
| `DECISIONS.md` | Alle ADRer (D-001 til D-036). **D-036 = din i18n-arkitektur.** D-032 = scope (revidert), D-035 = auth |
| `v4.0-SPEC.md` | Sikker overlevering — historisk referanse |
| `v4.1-SPEC.md` | ID-modul — historisk referanse |
| `HANDOFF-v4.1.md` | Arkivert — forrige handoff |
| `v4.5-DESIGN.md` | Pre-design for BYO dokument-laget (ikke din oppgave) |
| `v5.0-DESIGN.md` | Lean Security som tjeneste (ikke din oppgave) |
| `BUSINESS-CASE.md` | Mike sin budsjett-ramme |

### /app/frontend/ — Selve koden

Nye filer du vil lage for v4.2:
| Fil | Hva |
|---|---|
| `lib/i18n.ts` | `t()`-funksjon + `Locale`-type + fallback-kjede |
| `lib/locales/no.json` | Norsk (referanse) — du fyller denne |
| `lib/locales/sv.json` | Svensk — tomt skall, Mike fyller selv |
| `lib/locales/da.json` | Dansk — tomt skall, Mike fyller selv |
| `components/LanguagePicker.tsx` | 3 flagg i AppHeader |
| `hooks/useLocale.ts` (eller context) | React-state for aktiv locale |

Eksisterende filer du må endre (~20 komponenter — se §2):
- Alle hardkodede norske strenger erstattes med `t("auth.unlock_title")` etc.

### data-testid på alle nye elementer

`LanguagePicker` må ha `data-testid="language-picker"` og hvert flagg `data-testid="language-flag-no"`, `-sv`, `-da`.

---

## 4. Hvordan Mike jobber (tone og forventninger)

- Mike er ikke amatør. Han har bygget Ko|Do solo i mange måneder. Spar ham for elementære forklaringer.
- Han snakker rett — hvis noe er feil, sier han det rett ut. Det er ikke fiendtlig, det er effektivt.
- **Norsk språk** alltid. Mike kan engelsk, men forventer norsk svar.
- Han stiller gode spørsmål — hvis han spør om noe, det er sannsynligvis et reelt design-problem han fanget opp. Ta det seriøst.
- Han bruker Vercel preview for E2E-testing (lokal pod mangler Upstash KV-keys).
- Han bruker manuelle "Save to GitHub" — DU SKAL ALDRI gjøre `git commit` eller `git push`.
- **Mike er prisbevisst.** Forrige sesjoner brukte ~$35-40. Bruk Claude.ai direkte for strategi-arbeid hvis samtalen blir lang og kode-løs. Du brukes BEST til kode-bygging og testing. Mike sier selv: *"Du er god på test etc selv om du er litt dyr"*.
- Hvis Mike gjør strukturelle endringer i en feature — han forventer at du STOPPER og SPØR før du implementerer.

---

## 5. Tekniske premisser du må respektere

### D-001 Zero-knowledge (urørlig)
- i18n-arkitekturen er klient-side only — locale-valg lagres i `localStorage`, ikke i kryptert vault
- Brukerdata oversettes ALDRI — kun UI-chrome (knapper, labels, feilmeldinger)
- Locale-preferanse er bevisst NIKT en del av vault (lean prinsipp)

### D-031 B-modellen (farge-koding)
Hver feature har sin egen farge (uendret fra v4.1):
- **blue** = primær (Lagre, Edit, OK, Lås)
- **orange** = ID-er (v4.1)
- **violet** = Kort / Lab
- **emerald** = Pakker (v4.0)
- **amber** = Warnings
- **rose** = Slett/feil

`LanguagePicker` er nøytral UI-chrome — bruk standard `bg-white/10`-styling, ikke en feature-farge.

### D-036 i18n-arkitektur (din ADR)
- Egen lett løsning, ingen dependencies
- ISO 639-1 språkkoder (`no`/`sv`/`da`)
- Flat nøkkel-struktur, fallback til norsk → key
- Ingen URL-routing

### Multi-tenant-arkitektur
- Tenant-config i `/app/frontend/public/clients/<navn>.json`
- For v4.2: vurder om tenant-config skal ha `defaultLocale: "no" | "sv" | "da"` — Mike's instinkt: ja, men brukerens valg i localStorage trumfer

### Glass-arkitektur (D-022/D-023)
- Uendret. `LanguagePicker` legges inn i eksisterende AppHeader-glass-struktur.

### data-testid på alt
Hver interaktive element MÅ ha `data-testid="kebab-case-name"`.

### MongoDB / Upstash
- Vi bruker IKKE MongoDB. Vi bruker Upstash Redis-kompatibel KV-store.
- For v4.2 trenger du ikke røre Upstash i det hele tatt — locale lagres lokalt i `localStorage`.

---

## 6. Hva er klart / hva mangler

### v4.1 (ID-modulen) status
- ✅ I prod på Vercel (2026-05-26)
- ✅ Alle 11 testsuites grønne, TSC ren, Next prod-build grønn
- ✅ APP_VERSION = `v4.1.0`, `package.json` = `4.1.0`
- ✅ D-033 (ID-blob arkitektur) + D-034 (vannmerke-eksport) dokumentert
- ✅ HANDOFF-v4.1 arkivert

### v4.2 (din oppgave) status
- 🟢 Arkitektur signert (D-036)
- 🟢 ROADMAP-skisse komplett med edge-cases
- 🟢 Tom struktur klar — ingen kode skrevet ennå
- ⬜ Iter 1–6: IKKE STARTET

### Roadmap-revisjon 2026-05-26
- Versjons-rekkefølge revidert: v4.2 (språk) → v4.3 (Stripe) → v4.4 (auth) → v4.5 (auto-deploy) → v5.0 (docs)
- Tidligere v4.5 (BYO dokument-laget) flyttet til v5.0
- Tidligere v5.0 (Lean Security som tjeneste) flyttet til v4.5
- v5.0-seksjonen i ROADMAP hadde feil 2FA TOTP-fortelling — fjernet 2026-05-26, men noen 2FA TOTP-referanser kan dukke opp under v5.0-overskriften. Det er kjent og Mike fikser dette senere.

---

## 7. Plan for første samtale med Mike

Når Mike åpner sesjonen, må du:

1. **Hilse på norsk**
2. **Bekreft at du har lest dette handoff-dokumentet**
3. **Bekreft at GitHub er pullet** (eller spør om URL og pull)
4. **Bekreft at du har lest [D-036](DECISIONS.md) og [ROADMAP § v4.2](ROADMAP.md)**
5. **Foreslå å ta de tre edge-case-avklaringene FØRST** (dato-format, KOPI-vannmerke, backup-filnavn)
6. **Deretter Iter 1** med en kort plan

**Eksempel åpnings-melding:**

> Hei Mike! Jeg har lest handoff fra forrige agent, pullet GitHub-repoet ditt, og gått gjennom D-036 + ROADMAP § v4.2.
>
> Før jeg starter Iter 1, må vi avklare de tre edge-casene som ble flagget 2026-05-26:
>
> 1. **Dato-format** — kortform (`12.05.2034`) vs lang form (`12. mai 2034`) per locale?
> 2. **KOPI-vannmerke** — beholde som language-neutral?
> 3. **Backup-filnavn** — locale-spesifikt eller alltid engelsk?
>
> Forslagene ligger i ROADMAP — vil du gå gjennom dem nå, eller har du allerede tenkt på det?

---

## 8. Faner i hodet (kontekst Mike refererer til)

- **«Lars»** = persona-navn for typisk Ko|Do-bruker (norsk advokat). Brand-tegn, ikke språk-element — Lars heter Lars uansett locale.
- **«Lisbeth»** = svensk persona (advokat i Stockholm) — introdusert i v4.2-fortellingen
- **«Anna»** = mottaker av kryptert pakke (v4.0-persona) / ny kunde-persona (v4.3)
- **«D-XX»** = ADR (Architecture Decision Record) i `DECISIONS.md`. **D-036 = din.**
- **«B-modellen»** = D-031 farge-koding-strategi (én farge per feature)
- **«Lean Security»** = Mike sin brand-filosofi (ikke et produkt-navn)
- **«LK»** = Mike sin test-tenant (én reell test-person)
- **«Me & Max AS»** = Mike sitt selskap, brukes for Stripe i v4.3

---

## 9. Vanlige fallgruver (unngå)

1. **Ikke ta screenshot etter hver endring.** Det er kostbart og bremser. Implementer en hel iterasjon, kjør lint+tsc, så ETT screenshot for smoke-test.
2. **Ikke restart supervisor unødvendig.** Frontend har hot reload. Backend autorestarter ved kode-endring.
3. **Ikke skriv om filer med `create_file overwrite=True`** — bruk alltid `search_replace` på eksisterende filer.
4. **Ikke installer `next-intl` eller annet i18n-bibliotek.** D-036 forbyr det eksplisitt.
5. **Ikke generer svensk eller dansk innhold.** Mike gjør det selv via Claude. Du lever kun tomme skall.
6. **Ikke lag ny farge-aksent for LanguagePicker.** Den er nøytral UI-chrome.
7. **Ikke bruk landkoder (`se.json`, `dk.json`).** Det er feil. Bruk ISO 639-1 språkkoder (`sv.json`, `da.json`).
8. **Ikke bruk nested JSON-struktur.** Flat med dot-notation: `"auth.unlock_title"`, ikke `auth: { unlock: { title } }`.
9. **Ikke be Mike om å "rydde cache"** eller "prøve inkognito" som bug-fix.
10. **Ikke fall i screenshot-loop** — implementer batch, ÉTT screenshot, så testing agent.

---

## 10. Hva du KAN bruke testing agent til

For v4.2 vil testing agent være nyttig etter Iter 3 (streng-ekstraksjon ferdig) for å:
- Verifisere at `t()` returnerer riktige strenger per locale
- Verifisere at fallback-kjeden virker (manglende SV-streng → faller tilbake til NO)
- Verifisere at locale-bytte i UI er umiddelbar uten reload
- Verifisere at localStorage persisterer locale på tvers av sesjoner
- Verifisere `Intl.DateTimeFormat` for utløpsdatoer (pass, kort, ID-er)

Mike sier selv: *"Du er god på test etc."* Bruk testing-subagent for full E2E-flyt etter Iter 5.

---

## 11. Hvis du oppdager at noe i arkitekturen er feil

Si fra med en gang. Mike er åpen for å justere, men D-036 er nylig låst — endringer krever ny diskusjon. Eksempel:

> «Jeg ser at D-036 sier flat nøkkel-struktur, men ved streng-ekstraksjon oppdaget jeg at noen feilmeldinger er dynamiske ('Du har {n} passord' der n er en variabel). Skal vi bruke `t()` med variabel-substitusjon — eller hardcode tellingen utenfor `t()` og kun oversette tekst-rammen?»

Det er BEDRE å spørre 1 minutt enn å bruke 1 time på å implementere noe Mike ikke ville ha.

---

## 12. Sluttord

v4.1 leverte ID-modulen. v4.2 åpner skandinavisk marked uten å røre kjernen. Det er en relativt kortfattet feature med klar arkitektur, men streng-ekstraksjon over 20 komponenter krever disiplin.

Vær respektfull av tiden hans, vær konkret, vær på norsk, og **les D-036 + ROADMAP § v4.2 før du gjør noe**.

Lykke til. 🛡️🇳🇴🇸🇪🇩🇰

---

## Quick reference — første-time-kommandoer

```bash
# Verify pull
cd /app && git status

# Check services
sudo supervisorctl status

# Backend logs
tail -n 50 /var/log/supervisor/backend.*.log

# Frontend logs
tail -n 50 /var/log/supervisor/frontend.*.log

# Smoke test
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# TS check
cd /app/frontend && yarn tsc --noEmit 2>&1 | head -20

# Ruff backend lint
cd /app && python -m ruff check backend/

# Søke etter hardkodede norske strenger (start her for Iter 3)
cd /app/frontend && grep -rn "Lås opp\|Master-passord\|Lagre\|Avbryt" --include="*.tsx" --include="*.ts" components/ app/ | head -30

# Test i18n-modulen etter implementasjon
cd /app/frontend && yarn jest lib/__tests__/i18n.test.ts

# Vercel deploy URL (Mike vet — spør hvis du trenger den)
# Sannsynligvis: https://kodo-vault.vercel.app
```

---

**Filen ligger i `/app/memory/HANDOFF-v4.2.md` for referanse.**
