# Ko|Do · Vault — PRD

## ⭐ Foundational Security Principle (North Star)

> **"Spørsmålet er om det skal være 100% eller 95% — og svaret er 100%, ellers synker vi en eller annen dag, du vet bare ikke når."**
> — Michael Aagreen, 2026-02

Alle sikkerhets-relaterte beslutninger vurderes mot denne testen:
- Er dette matematisk garantert, eller stoler vi på at noen oppfører seg pent?
- Hvis brukeren tror dette er 100% sikkert, ER det 100% sikkert?

Dersom svaret ikke er klart "ja" på begge — vi bygger det ikke.
Vi gir heller ingen funksjon enn en falsk trygghetsfølelse.

**Konsekvens:** Når sikkerhet vs. enkel UX står mot hverandre, velger vi sikkerhet. Alltid. Uten unntak.

**Implikasjoner som allerede gjelder:**
- ❌ Ingen "honor-system expiry" (klient-side dato-sjekk i kryptert blob) — bypassbar med devtools
- ❌ Ingen soft-delete (kryptografisk uoppdagelig sletting)
- ❌ Ingen "husk meg i 30 dager" uten ekte token-rotasjon
- ❌ Ingen passord-hint, recovery-spørsmål eller andre svekkelser
- ❌ Ingen subdomene-baserte "autentiseringer" (kun ekte master-passord teller)
- ✅ Expiry på FLYT B må implementeres som NIVÅ 2 (server-side to-nøkkel-system med Key2 escrow), ellers ikke i det hele tatt

## Original problem statement
Personlig kryptert passord-vault basert på design-DNA fra meetmax-no/Calender. Stack: Next.js 15 + React 19 + TypeScript + Tailwind + Upstash Redis + Vercel. Zero-knowledge arkitektur. Norsk språk.

## Architecture (zero-knowledge)
- Master-passord → PBKDF2-SHA256 600 000 iter → AES-256-GCM
- Hele entries-arrayet krypteres som ÉN blob → PUT til Upstash (server ser kun {salt, iv, cipher})
- WebAuthn PRF-extension wrap master-pwd for biometric unlock (lokalt)
- Config via `public/clients/<name>.json` (multi-tenant-klar)

## What's been implemented

### ✅ 2026-02 — D-141 Per-org fakturahistorikk for am-admin (P1)
- **Gjenbruk:** `InvoiceHistoryCard` (D-139) refaktorert til å ta `endpoint`-prop, slik at samme komponent dekker både Mike-admin (`/api/admin/tenants/[subdomain]/invoices`) og am-admin (`/api/am-admin/invoices`).
- **Nytt endepunkt:** `GET /api/am-admin/invoices?period=30d|90d|365d|all` speiler shape og semantikk fra D-139-endepunktet. Beskyttet av `requireAmAdmin` — både super-admin og admin har lik tilgang (org-aggregat, ingen PII per ansatt).
- **Wired inn i Konsoll → Innstillinger → Fakturering** (`KonsollBillingTab`): henter `stripeCustomerId` fra `me.parent` via `/api/am-admin/auth/me` og sender den hele veien gjennom `KonsoletSettingsPanel` → `KonsollBillingTab` → `InvoiceHistoryCard`.
- **Filer:**
  - `app/api/am-admin/invoices/route.ts` (ny)
  - `components/platform/InvoiceHistoryCard.tsx` (endpoint-prop)
  - `components/platform/am-admin/settings/KonsollBillingTab.tsx` (kort wired inn)
  - `components/platform/am-admin/settings/KonsoletSettingsPanel.tsx` (props gjennomstrømming)
  - `app/api/am-admin/auth/me/route.ts` (`stripeCustomerId` på `parent`)
  - `app/platform/am-admin/page.tsx` (`ParentInfo` utvidet)
  - `lib/__tests__/coverage-matrix-lint.test.ts` (EXEMPT-oppføring for ny rute)
- **Statisk QA:** TSC ✓ · `yarn lint:all` ✓ (7/7) · `yarn build` ✓.

### ✅ 2026-02 — D-126 SuperAdmin client-config provisjonering + arv (P1)
- **SA-init:** B2B parent-tenants (`<prefix>-admin`) får nå automatisk `client-config:<prefix>-admin` initialisert fra `default.json` ved første `provision-vercel`-kall (D-088-short-circuit-grenen). Idempotent — overskriver ikke eksisterende.
- **Ansatt-arv:** Ny helper `buildTenantConfigFromParent()`. `provisionTenantOnVercel` har ny `parentSubdomain`-prop. Når en ansatt opprettes via invite/accept, arves SA-malen i stedet for global `default.json`. Fallback til default + logg-advarsel hvis SA mangler config.
- **Migrasjon:** `/api/admin/migrate-client-configs` har ny `?onlyParents=true`-filter for å initialisere kun legacy SA-er. `ConfigToolsButton` har ny checkbox "Kun B2B parent-tenants (SA)".
- **Test:** `tenant-config-inheritance.test.ts` (10/10 PASS).
- Mike-valg: 1a+2a+3b (alt på én gang, inkluder migrasjon, ingen UI-banner).
- Statisk QA: TSC ✓ · lint:all ✓ (7/7) · build ✓ · testing-agent iter_27 100%.

### ✅ 2026-06-29 — D-115 Invite-flow fix (P0)
- **Branding på public invite-side**: henter `companyName` via `/api/am-admin/branding/[prefix]` (D-114-endepunktet). STRENGT — ingen prefix-fallback; mangler firmanavn vises `branding_missing`-feil og skjemaet skjules.
- **Default aurora-gradient** på hele invite-siden + Suspense-fallback (samme som am-admin-login fra D-114).
- **ProvisioningTracker mellom skjema og redirect**: etter `POST /api/invite/accept` bytter siden til `phase: "provisioning"` og monterer `<ProvisioningTracker mode="public">` som poller `/api/status`. Først ved `vault_live`-event redirectes brukeren til `/welcome-b2b/[subdomain]`. Fikser P0 hvor "Fortsett →"-knappen ledet til 404/`wrong_pod` mens Vercel-deploy fortsatt bygget.
- **Failure-state**: `onDone(false)` viser `invite-provisioning-failed`-melding med klar instruksjon (kontakt admin, Ko|Do-team varslet).
- Statisk QA: TSC ✓ · lint:all ✓ (D-078, D-105, i18n-sync, coverage-matrix grønne) · build ✓.

### ✅ Iter 20.9 KOMPLETT — Konsoll-shell + rollestyring (2026-06-27)
- **Refaktor av flat am-admin-side til "Konsoll"-shell** med Aurora-gradient bakgrunn + glass-pill header.
- **4-fane pill-tab-navigasjon** (Lucide-ikoner): Ansatte, Invitasjoner, MPW, Innstillinger.
- **Strikt RBAC**: MPW + Innstillinger-fanene rendres IKKE for `role:"admin"` (filtrert ut av tab-array, ikke CSS-skjult). Server-side håndhevelse via `requireSuperAdmin` i alle MPW + nye team-ruter.
- **Team-administrasjon** (`POST/GET /api/am-admin/team`, `DELETE/POST /api/am-admin/team/[id]`): super-admin oppretter nye admins/super-admins. Velkomstmail med tvunget passordbytte sendes automatisk via `sendOrgAdminWelcome`. "Siste aktive super-admin" + selvslett/selvsuspendering-guards håndhevet på endepunkt + store.
- **Innstillinger-fanen** har 4 seksjoner: Team-administrasjon, Konto (frivillig passordbytte + faktura-status), Backup-eksport, Org-info (read-only).
- **78 nye i18n-nøkler × 4 språk** (no/sv/da/en) med ekte oversettelser (ingen placeholders).
- Statisk QA: TSC ✓ · lint:all ✓ (5-pass-kjede, 1343 i18n-nøkler i sync, 34 EXEMPT-ruter) · build ✓.
- **9 nye unit-tester** (`am-admin-team-guards.test.ts`) + regresjon på 220+ eksisterende tester grønt.


### ✅ Iter 20.8 KOMPLETT — B2B-skjema UI-løft (wizard + auto-fyll + ikoner + plan-tagger) (2026-06-26)
- **3-stegs wizard** (Identitet → Adresser → Lisens & plan) for B2B-mode i CreateTenantModal. B2C-flow uendret.
- **Stepper øverst** med ✓-markering for fullførte steg + Forrige/Neste/Opprett-footer.
- **"Samme som selskap"-checkbox** speil-kopierer selskaps-adresse → faktura, disabler faktura-feltene visuelt.
- **Bekreftelses-ikon (✓)** på org.nr når validering passerer (emerald-300 absolute-posisjonert).
- **Anbefalt-/Fleksibel-tagger** på `b2b_yearly`/`b2b_semiannual`-plan-valg + nye B2B PLAN_OPTIONS.
- **11 nye i18n-nøkler × 4 språk = 44 totalt** (1259 nøkler i sync).
- TSC + lint:all + build alle grønne. 220/220 unit-tester (ingen regresjon).


### ✅ Iter 20.7 KOMPLETT — B2B-tab aktivering + i18n B2B-labels + org.nr-validering (2026-06-26)
- **B2B-tab** i super-admin-panelet aktivert (ikke lenger disabled placeholder).
- **Lokaliserte labels**: 20 nye i18n-nøkler × 4 språk (14 felt + 4 country-options + 7 validerings-feil). Locale-files 1249 nøkler i sync.
- **Org.nr-validering**: `lib/platform/org-number-validation.ts` med Mod-11 (NO), CVR Mod-11 (DK), Luhn (SE). Live rød/grønn border + feilmeldinger. 22 unit-tester.
- **B2B trial=45d default** (D-080 B2B-spec) — auto-set når customerType=b2b.
- **CreateTenantModal `lockedCustomerType`-prop**: skjuler TYPE-dropdown når åpnet fra B2B-tab.
- **Country selector**: `companyCountry` er nå dropdown (NO/SE/DK/OTHER) som styrer hvilken validator brukes for org.nr.
- **Test-status: 220/220 grønt** (la til 22 org-validation-tester på toppen av Iter 20.6).


### ✅ Iter 20.6 KOMPLETT — B2B Velkomstskjerm + Matrise 6 (2026-06-26)
- **`/welcome-b2b/[subdomain]?parent=...&locale=...`**: vises etter `/invite/accept`, før redirect til subdomenet. 4 trust-byggende bullets: (1) arbeidsgiver kan IKKE se passordene, (2) hva am-admin KAN se (notater de selv skriver), (3) master-passord er ikke gjenopprettbart, (4) backup tilhører ansatte. 4-språk i18n (no/sv/da/en).
- **Matrise 6 i DECISIONS.md**: 35 entry-points dekket for hele am-admin B2B-flyten (login → employees → invites → billing → MPW → adminNotes → backup → welcome). Aggregert sammendrag oppdatert fra 5/37 til 6/72 entry-points lukket.
- **Iter 20 globalt KOMPLETT** og klar for produksjon. 198/198 unit-tester grønt, yarn tsc/build/lint:all alle grønne, 1224 i18n-nøkler × 4 språk synkronisert.


### ✅ Iter 20.5 KOMPLETT — am-admin Master Password (MPW) + Admin-notater + Backup-eksport (2026-06-26)
- **20.5a** Krypto-foundation: PBKDF2-SHA256 600k + AES-GCM 256, opaque MpwEnvelope-format, sentral Upstash storage per org under `org-meta:<prefix>:mpw`. 42 unit-tester.
- **20.5b** Setup/unlock/reset API + UI: 3 modaler (setup med zxcvbn ≥ 3, unlock, reset med type-to-confirm), MpwContext (in-memory key, ingen localStorage), atomisk SETNX for å lukke TOCTOU på samtidige setup-kall, super-admin-gated reset. **4-språk i18n** (no/sv/da/en).
- **20.5c** Per-employee adminNotes: separat Upstash-key `org-admin-notes:<prefix>:<subdomain>` med indeks-SET for rask reset. Cross-org-isolert API, 5000-tegns plaintext-grense (30K base64-cipher cap for UTF-8/emoji), corrupt-blob signaling, orphan-cleanup ved tenant-delete.
- **20.5d** Backup-eksport CSV + JSON: am-admin-spesifikk struktur (IKKE Bitwarden), filnavn med sekund-presisjon, RFC 4180 + OWASP CSV formula-injection-mitigering (apostrof-prefiks på =/+/-/@/TAB/CR), JSON versjonert v1, UTF-8 BOM for Excel.
- **Endelig test-status**: 132/132 unit-tester grønt, `yarn tsc/build/lint:all` alle grønne, 1209 i18n-nøkler × 4 språk i sync.
- **Sikkerhet**: Zero-knowledge invariant verifisert — server ser KUN opaque envelope. "Glemt MPW" sletter verifier + alle notater atomisk. To statiske code-reviews av testing_agent (iter15, iter16, iter17) — alle issues fikset til 100%.


### ✅ Iter 19.9 KOMPLETT + QA-GODKJENT — Obligatorisk locale-valg + 4 språk-pakke (2026-06-13)
- Fase 1: 12 nye HTML-maler (SV+DA × 6 typer) + backend 4-språk
- Fase 1.1–1.4: Lenke-farger differensiert, footer 12px/#aaaaaa (WCAG AAA), brand "Ko \| Do · Vault" konsistent globalt (248 forekomster)
- Fase 1.5: Fikset 2 pre-eksisterende test-failures (iter13 + iter13-5)
- Fase 2: Ny `<LocaleRadioGroup>`-komponent. Plassert i `/platform/register` + `/invite`. Backend-validering på 3 endepunkter. i18n-key `register.field_locale` lagt til i alle 4 språkfiler.
- **QA-godkjent av Mike 2026-06-13. Blokker for Iter 20 fjernet.**
- Se [`CHANGELOG.md`](./CHANGELOG.md) for full detalj.

### Iter 17.x — Mail-test locale-override + 3 P0 bug-fix ✅ (2026-06-13)
- **Stripe IdempotencyError fix**: Idempotency-keyen for create-checkout var statisk på `(scenario, subdomain, plan)`, så endring av `success_url` (Iter 19.7 la til `?existing=1`) trigget `Keys for idempotent requests can only be used with the same parameters`-feil i 24t etter første kall. Fix: append SHA-1-fingerprint av faktiske `sessionParams` (12 hex). Identiske kall → samme key (dobbeltklikk-beskyttelse); endrede params → ny key. 10-test regresjonsvern.
- **E-postknapp `target="_blank"`-quirk fix**: Apple Mail/Outlook blokkerer popup når `target="_blank"` settes på `display:inline-block <a>` i table-button → browser fikk fokus uten navigering. Fjernet target+rel.
- **E-postknapp padding-fix**: `<td>` hadde padding + background, `<a>` kun teksten → klikk i padding-sonen traff ikke href. Flyttet til `<a>` med `display:inline-block`. 60-test regresjonsvern på #1+#2.
- `MailTestCard` har nå språk-toggle (Auto/NO/EN). Win-back e-post dag 14 etter lock lagt til ROADMAP backlog. Se [`CHANGELOG.md`](./CHANGELOG.md) for full detalj.

### Iter 17 — Cron lifecycle + e-post-pakke ✅ (2026-06-13)
- Daglig cron 03:00 UTC + 5 mail-maler (NO+EN) + webhook-fix for spor A/B-konvergering + D-070-revisjon (Stripe customer-bevaring per bokføringsloven). Se [`CHANGELOG.md`](./CHANGELOG.md) for full detalj.

### Fase 1 — Setup ✅
Next.js 15.2.6 + React 19 + TS + Tailwind 3.4. Multi-tenant config. Glass-design (`bg-white/10 backdrop-blur-xl border-white/20`). Inter-font.

### Fase 2 — Krypto-kjerne ✅
`lib/crypto.ts`: PBKDF2 600k iter + AES-256-GCM via Web Crypto API. encryptVault/decryptVault/encryptVaultWithKey.

### Fase 3 — Master-passord ✅
Setup (12+ tegn), login, "Slett og start på nytt" fluktvei (SLETT-bekreftelse), auto-lås 15 min.

### Fase 4 — WebAuthn / Touch ID ✅
PRF-extension + AES-GCM-wrap av master-pwd. `residentKey: "discouraged"` for å unngå iCloud-synkede Passkeys. 14-dagers tving-master.

### Fase 5 — Vault CRUD + Upstash ✅
- `/api/vault` route handler: GET/PUT/DELETE med @upstash/redis, key `vault:default`
- Server-first vault-storage (ikke localStorage lengre)
- `EntryModal` single-modal (view/edit/new)
- `VaultDashboard` med sortering (favoritt → tittel), kategori-farge-badges, "+ Ny"
- Clipboard auto-clear etter 30 sek (med tab-visibility-håndtering)

### Fase 6 — Cmd+K søk ✅
- `SearchPalette` via `cmdk`-library
- Fuzzy match på tittel + URL + brukernavn + kategori-label
- Kbd-shortcut: Cmd+K / Ctrl+K
- Enter → åpner EntryModal i view-modus
- Søk-knapp i header også

### Fase 7 — Bytte master-passord ✅
- `SettingsPanel` via header-cog-ikon
- `ChangeMasterDialog`: verifiser current → nytt (12+) + confirm + understood
- `useVault.changeMasterPassword`: dekrypterer, re-krypterer med nytt salt+IV, push
- Biometric invalideres automatisk (gammel wrap hadde gammelt pwd)
- Session-nøkkel oppdateres in-place

### Fase 8 — Eksport / import kryptert backup ✅ (2026-02-29)
- `lib/backup.ts`: `BackupEnvelope`-format `{kind, envelopeVersion, exportedAt, app, appVersion, entryCount, blob}`
- Export: `vault.exportBackup()` bygger envelope + trigger nedlasting via `<a download>`
- Import: fil-picker → `parseEnvelope` (validering) → ConfirmDialog (type "ERSTATT") → `vault.importBackup` → push til Upstash + lås vault
- Master-passordet aldri i fila — bruker må låse opp med passord som tilhørte backup
- Biometric invalideres ved import (gammel wrap var bundet til gammelt passord)
- Offline roundtrip-test: `lib/__tests__/backup.test.ts` — 10/10 passert

### Login-timeline ✅ (2026-02-29)
- `lib/login-history.ts`: localStorage-backed ring-buffer, max 5 events
- Logger setup/unlock/unlockWithBiometric → `{at, method: "setup" | "master" | "biometric"}`
- Vises i SettingsPanel under "Siste pålogginger"-seksjon med ikon + farge per metode
- Tømmes ved destroyVault

### v1.0.0 — Kvalitets-polish ✅ (2026-04-30)
- Favicon v2 + site.webmanifest (installerbar PWA-ready)
- Anti-autofill på alle passord-felt (master + entry) — `autoComplete="off"` + `data-lpignore` + `data-1p-ignore`
- WebAuthn PRF fungerer nå på Android Pixel (residentKey → "preferred" + PRF eval i create())
- Backup-fil: fjernet `entryCount` (metadata-lekkasje)
- Bakgrunnsbilde: Fast/Daglig/Tilfeldig nå interaktive + klikk på bildekort låser som "Fast"
- Konfigurasjon + Klient lukket som default i Settings
- Versjon i footer bumpet til v1.0.0

### v2.0.0 — Server-side event log + rate limiting ✅ (2026-04-30)
- `/api/vault/events` (GET/POST/DELETE) backed av Upstash Redis
- Auto-logger `access`/`modify`/`reset` server-side
- Klient rapporterer `unlock-success`/`unlock-fail`/`unlock-biometric`/`master-changed`
- Per-IP rate limiter: 10 fails / 15 min → GET /api/vault returnerer 429
- IP + UA + Vercel geo-headers (x-vercel-ip-city/country) — ingen 3rd party
- `security.loginHistoryCount` i clients/default.json
- Fjernet `lib/login-history.ts` (server er single source of truth)

### v2.1.0 — Password Lab + polish ✅ (2026-04-30)
- **Passord-lab** (ny modal): zxcvbn-basert strength meter (kode-splittet), CSPRNG-generator, læringseksjon
  - Inngang: Header-ikon 🧪, Settings actionrow, MasterPasswordSetup, ChangeMasterDialog, EntryModal (edit-mode)
  - "Bruk dette"-flow fyller passord + bekreft automatisk
  - `initialTestPassword`-prop pre-fyller test-feltet med passordet brukeren nettopp skrev inn
  - Offline roundtrip-test `__tests__/password-generator.test.ts` (10/10 passed)
- **EventLogPanel** (ny modal): 4 stats-kort, filter-pills (alle/unlocks/fails/modifications), ekspanderbare rader
  - Utskilt fra Settings for å spare plass
- **Auto-lock wall-clock-basert**: wake-triggered via visibilitychange + focus — overlever Mac-sleep/backgrounded tab
- **Nettverks-status-badge** i header: Wifi (online) / CloudOff (offline) / ServerCrash (server-feil)

### v2.2 — UI-polish + cross-device refresh ✅ (2026-05-01)
- **AppHeader redesign**:
  - Tittel `text-3xl` (var `text-xl`) — 50% større visuelt
  - Status-badges flyttet under tittelen (mindre, mer "subtitle-aktige" — `text-[9px]`)
  - Mobil-knapper 56×56 px (var 44 px) — +27% touch-areal, +62% klikkbart areal
  - Ikon-størrelse oppskalert til 24 px på mobil
  - 3-kolonners grid på mobil (5 knapper i 2 rader)
- **Footer**:
  - Desktop `text-base` (var `text-[10px]`) — leselig
  - Mobil `text-xs` med ren tekst (ingen versjons-badge — støy fjernet)
- **SettingsPanel**: Backup-seksjon lukket som default
- **Touch ID-dialog**: `rp.name` fra `config.brand.name`, `userDisplayName` fra `config._meta.createdBy`
  - Krever Touch ID re-registrering for å slå inn på eksisterende credentials
- **Passord-lab utvidet** (Mode-tabs):
  - Tegn-modus: 2 quick-actions ("Fjern alle" + "Standard")
  - Passfrase-modus: 607-ord norsk wordlist (uten Æ/Ø/Å), separator-pills (`+ - _ .`), antall ord-slider (3-6, default 4), stor forbokstav-toggle
  - `lib/wordlist-nb.ts` + `lib/passphrase-generator.ts` (Uint16-uniform pluk for >256 ords-lister)
  - Ingen trailing separator
  - Auto-regenerer ved mode-bytte
  - Offline test: `__tests__/passphrase.test.ts` 8/8 passed
- **Refresh-knapp i header** (RefreshCw):
  - `vault.refresh()`: fetch ny blob fra Upstash + dekrypter med eksisterende session-key
  - `lib/crypto.ts`: ny `decryptVaultWithKey()` som tar pre-derived key (ingen master-pwd-input)
  - Animert spinner mens `refreshing === true`
  - Auto-fallback til `locked` hvis decrypt feiler (master-pwd byttet andre steder)
  - Auto-fallback til `needs-setup` hvis blob er borte (vault slettet andre steder)
  - Toast: "Oppdatert fra server" på success
- Versjon bumpet til **v2.2**

### v2.9 — Clipboard-polish ✅ (2026-02-XX)
- **Default clipboard auto-clear**: 30s → 120s med absolutt epoch-deadline (overlever iOS suspendering)
- **Manuell "Slett clipboard"-knapp** (`ClipboardX`) i `AppHeader` (desktop) + `MobileBottomBar` (mobil)
- **`clipboardEnabled` toggle** i `default.json` (`true` default, `false` = "tett skip"-modus, kopier-knapper skjules)
- Visibility/focus-handlers retry sletting når fanen får fokus
- Toast bekrefter både kopiering og sletting
- Clamp ved innlesning: `clipboardClearSeconds` 10–120s

### v2.9.5 — Liste/Gruppert-toggle + inline-søk ✅ (2026-05-05)
- **Visnings-modus i `VaultDashboard`**: pill-segmented toggle (`Liste` / `Gruppert`)
  - Liste-modus: uendret (favoritter først, alfabetisk)
  - Gruppert-modus: kategorier som kollapsbare grupper i rekkefølge fra `default.json`
- **Gruppert-detaljer**:
  - ⭐ Favoritter pseudogruppe ALLTID på toppen (hvis det finnes favoritter) — duplikater i kategori
  - Tomme kategorier skjules automatisk
  - Alt lukket ved hver pålogging — ingen localStorage-persistens
  - Animert chevron-rotasjon ved utvidelse, antall-pille i kategori-fargen
- **Inline-søk**: nytt søke-felt over passord-listen (samme rad som mode-toggle)
  - Kun desktop (`hidden sm:flex`) — mobil beholder Cmd+K-palette via MobileBottomBar
  - Auto-utvider grupper med treff i Gruppert-modus (uten å mutere brukerens permanente valg)
  - "x treff"-badge i header når søk filtrerer
  - X-knapp for å tømme søk
- **AppHeader**: desktop-søkeknappen fjernet (Cmd+K shortcut og mobile bottom-bar uendret)
- Versjon bumpet til **v2.9.5**

### v3.0 — Cards (Blob 2) ✅ (2026-05-08)
- **Egen kryptert blob `vault:default:cards`** med samme master-pwd, ulik salt (D-002, D-012)
  - Lazy-loaded — Upstash treffes først når brukeren klikker Kort-fanen
  - Auto-låses opp ved master-pwd ELLER Touch ID via `onMasterUnlock`-callback — ingen ekstra prompt
- **DashboardShell**: Pill-toggle `🔑 Passord ⇄ 💳 Kort` øverst i dashbordet
- **CardModal med D-015 felt-spec**: påkrevd (title, cardType, cardNumber, holderName, MM, YYYY) + valgfrie (cvv, pin, issuer, photo, telefoner, URL, notater, favorite, bonusprogram, årsavgift)
  - Skjul/vis for sensitive felt, kopier-knapper med 120s clipboard-clear, click-to-call/url, mist-kort-knapp i rødt
- **Custom kamera-fangst (D-014, D-020)**: getUserMedia universelt (mobil + laptop), CR80-fokus-ramme, ALDRI Camera Roll, ingen file-picker fallback. Desktop uten kamera: tydelig melding.
- **Manuell crop (Iter 3.5)**: `react-image-crop@11`, default fri crop med 🔒/🔓-toggle til CR80. Pixel-arbeid i vår canvas — D-014 intakt.
- **Bilde-komprimering (D-016)**: `lib/image-compress.ts`, JPEG/WEBP, konfigurerbart i `default.json/image` med clamp. Resultat ~62 KB pr bilde (95% reduksjon vs PNG). INGEN graceful fallback ved feil — D-001 anvendt på error-handling.
- **Backup-format v2**: vault + cards i én envelope. v1-backup avvises tydelig (ingen backwards compat).
- **Cmd+K-søk dekker begge**: passord + kort. Trykk Enter på kort-treff → CardModal åpnes direkte.
- **Liste/Gruppert-toggle for kort**: parity med v2.9.5. Favoritter på topp + grupper pr cardType.
- **Persisterte default-views via `default.json`**: `ui.passwordsViewMode` + `ui.cardsViewMode` (tenant-styrt initial state per D-018).
- **Versjon bumpet til v3.0**

### v3.0.5 — Selektiv backup med smart re-kryptering ✅ (2026-02-15)
- **Backup henter ALLTID fra Upstash** — ikke RAM-cache. Backup-fila er kanonisk speil av server, ikke speiling av nåværende UI-state. Eliminerer race conditions ved multi-tab og stale RAM (D-001).
- **Selektiv eksport**: `BackupExportModal` med checkboxer pr blob. Default: alt valgt. Tomme blobs hoppes over.
- **Selektiv import med smart re-kryptering**: `BackupImportModal` viser hva fila inneholder + checkboxer. To-trinns pwd-flow:
  1. Bruker oppgir backup-pwd → vi validerer og dekrypterer valgte blobs i RAM
  2. Hvis backup-pwd ≠ dagens master-pwd, dukker ekstra felt opp: *"Backup ble laget med et annet master-passord. Oppgi dagens master-passord — backup-data lagres med dagens passord."*
  3. Backup-payload re-krypteres med target-pwd (dagens master-pwd hvis vault ulåst, ellers backup-pwd) og pushes
- **Aldri raw push**: ny salt + ny IV per re-encrypt. Server-state har alltid samme master-pwd på alle blobs. Ingen invariant-brudd.
- **Vault forblir ulåst** etter import når dagens master-pwd brukes som target. Session re-derives transparent. Biometric beholdes.
- **Atomisk validering**: master-pwd må dekryptere ALLE valgte blobs før noe pushes.
- **Backup-format v3**: `blobs`-map med vilkårlig antall krypterte blobs. Fremtidssikker. v2-filer migreres internt ved import (full bakoverkompatibilitet).
- **Filnavn reflekterer scope**: `kodo-vault-backup-vault-{ts}.json`, `-cards-{ts}.json`, `-full-{ts}.json`.

### v3.0.6 — Polish: cards-fane refresh + eye-toggle på pwd-felt ✅ (2026-02-16)
- **Bug-fix:** Cards-fanen oppdateres nå umiddelbart etter selektiv kort-import. Tidligere ble fanen hengende i `idle`-state hvis bruker allerede var på Kort-fanen før import (`switchToCards()` ble aldri kalt på nytt → `activate()` ble aldri trigget). Nå re-derives session direkte i `applyImportedPayload` siden vi har target-pwd + payload tilgjengelig.
- **UX:** Eye-toggle (`<Eye>/<EyeOff>`) på begge pwd-felt i `BackupImportModal` — klikk for å vise/skjule master-passord under skriving. Hjelper bruker å verifisere at riktig pwd er tastet, særlig viktig ved to-trinns mismatch-flow.
- **Versjon bumpet til v3.0.6**

### v3.0.7 — Multi-tenant + login-personalisering ✅ (2026-05-18)
- **Multi-tenant:** Første ekstra tenant `default-lk.json` opprettet for Lisbeth E. Krogh. Velges via `NEXT_PUBLIC_CLIENT_CONFIG` env-variabel i Vercel. Hver tenant har egen Upstash-DB + eget domene (f.eks. `lisbeth.kodovault.no`).
- **Login-strip:** Subtil personlig hilsen `— For {client} —` over login-kortet. Vises kun hvis `_meta.client` finnes i config. Gir bruker visuell bekreftelse på riktig vault (særlig viktig hvis flere kontoer brukes på samme enhet).
- **Footer-fix:** Bytter fra `_meta.client` til `_meta.createdBy` i footer + mobil bottom-bar. Semantisk modell nå klar: `client` = hvem appen er for (vises på login), `createdBy` = leverandør/utvikler (vises i footer).
- **Kategori-oppdatering:** "Jobb" erstattet av "Utvikling" i `default.json`. Key beholdt (`work` → `utvikling` med nye data, gamle "Jobb"-poster videreført manuelt).
- **DEPLOYMENT.md opprettet:** Full produksjons-guide med Vercel-oppsett, Upstash via Marketplace, DNS for custom-domener (CNAME til `cname.vercel-dns.com`), og multi-tenant deploy-strategi.

### v3.1.0 — Per-browser glass-arkitektur (Safari-fix) ✅ (2026-02)
- **Problem:** Safari (macOS + iOS) rendret glass-kortene nesten 100% transparente sammenlignet med Chrome. Tidligere fix (D-022 — fjerne `isolation: isolate` + wrapper-div for flex-barn) løste *kompositerings*-laget, men hvit-tekst-på-lys-glass forble uleselig i Safari fordi WebKit sin enkelt-pass-blur er matematisk svakere enn Chromiums multi-pass gaussian-blur.
- **Løsning — per-browser JSON-arkitektur:** Hver visuell glass-parameter har nå to verdier i `clients/<name>.json` — én for Chrome/Firefox/Edge, én for Safari. Klient-koden velger via `useIsSafari`-hook og injiserer som CSS-variabler på `:root`.
  - `backdropBlurChrome: "24px"` · `backdropBlurSafari: "48px"`
  - `cardBgChrome: "rgba(255,255,255,0.10)"` (lett glass) · `cardBgSafari: "rgba(30,41,59,0.90)"` (tilnærmet solid mørk slate)
  - `bgImageOverlay: 0.10` (samme i begge — kun lett mørkleggings-overlay over bg-bildet)
- **Ny fil `/app/frontend/hooks/useIsSafari.ts`** — UA-detection som ekskluderer Chrome/Android/Edge/Opera/Brave. Trigges kun klient-side (useEffect) → ingen SSR-mismatch.
- **`app/page.tsx` linje 200-214:** Leser config + isSafari, computer `effectiveBlur` og `effectiveCardBg`, setter `--kodo-blur-xl` og `--kodo-card-bg` på `:root`. `globals.css` har én CSS-regel som plukker variablene opp og overstyrer `.backdrop-blur-xl` (påvirker IKKE `.backdrop-blur-sm` for små badges).
- **Hardware-acceleration-trigger:** `tailwind.config.js` + `globals.css` har `translate3d(0,0,0.0001px)` på `.backdrop-blur-xl` for å tvinge Safari til layer-promotion (forblir fra forrige patch).
- **`lib/config.ts`:** `AppConfig` utvidet med `bgImageOverlay`, `backdropBlurChrome/Safari`, `cardBgChrome/Safari`. Fallback-verdier i `FALLBACK_CONFIG`.
- **Begge tenants oppdatert:** `clients/default.json` + `clients/default-lk.json`.
- **Opprydding:** `.gitignore` redusert fra 843 → 93 linjer (fjernet 750 duplikat-linjer fra tidligere echo-loop).
- **Versjon bumpet til `v3.1.0`** (`lib/version.ts`).
- **⚠️ Kritisk regel for fremtidige agenter:** Aldri fjern `useIsSafari`-hook eller splitt-arkitekturen. Hvis nye glass-elementer legges til, *må* de respektere `--kodo-card-bg` og `--kodo-blur-xl`. Se D-023.

### v3.1.1 — Biometric pre-flight version-detect ✅ (2026-02)
- **Problem:** Touch ID/Face ID-aktivering feilet stille på Safari 17.0 / iOS 17. WebAuthn `create()` lyktes, men PRF-extension ble fullstendig ignorert av Safari < 18, så master-pwd kunne ikke wrappes. Resultat: orphan-passkey lå igjen i Secure Enclave, biometric ble ikke aktivert.
- **Løsning:** Ny `isPrfLikelySupported()` i `lib/webauthn.ts` — UA-version-detect for Safari/Chrome. Brukt i `refreshBiometric()` for å sette `biometric.supported = false` på ikke-støttede browsere.
- **Krav:** Safari 18+ (iOS 18+ / macOS Sequoia 15+) ELLER Chrome 132+ for biometric. Andre browsere får ikke knappen vist.
- **Robusthet (Safari user activation):** `registerBiometric` i `useVault.ts` kaller WebAuthn umiddelbart etter klikket (før tung PBKDF2-CPU) for å bevare Safari sin "transient user activation". Master-pwd verifiseres ETTERPÅ. `window.focus()` defensivt rett før `navigator.credentials.create()` for å unngå "document is not focused" hvis DevTools har fokus.
- **Filosofi:** Ingen UI-melding for ikke-støttede browsere — knappen vises bare ikke (D-024). Brukere som ikke har oppgradert i 17+ måneder gjør det ikke fordi vi viser en pen melding.
- **Se D-024** for full rasjonale, vurderte alternativer (largeBlob, hybrid) og hvorfor de ble forkastet.

### v4.1.0 — ID-modulen 🆔 (Pass, Førerkort, ID-kort, Helse) ✅ (2026-02)

**Hovedleveranse:** Ny ID-modul som tredje fane i DashboardShell, etter Passord og Kort. Egen Upstash-blob (`vault:default:ids`), same master-pwd som vault, egen salt. Orange feature-farge (D-031 utvidet).

**Iter 1 — Datamodell + krypto (D-033):**
- `VaultId` discriminated union på `kind`: `Pass` (passnr, nasjon, utløp), `Driver` (førerkort-nr, klasser, utløp), `IdCard` (type, utsteder, nummer), `Health` (polise, selskap, gyldig-til)
- `lib/ids-sync.ts` + `app/api/ids/route.ts` — GET/PUT/DELETE mot `vault:default:ids`, samme rate-limit + event-log som hovedvault
- `hooks/useIds.ts` — full state-machine (idle/loading/needs-init/locked/ready/error), lazy-fetch, transparent legacy-migrering
- `IDS_THEME` (orange) lagt til i `feature-theme.ts` — alle 16 semantiske tokens
- Tenant-flagg `features.ids.{enabled, showInApp}` i begge clients/*.json

**Iter 1.5 — Arkitektur-rens:**
- Crypto.ts TS-feil ryddet (`cipher as BufferSource` på 4 decrypt-funksjoner, ingen runtime-endring)
- `import-reencrypt.test.ts` rename `expMonth`/`expYear` → `expiryMonth`/`expiryYear` (dødt felt-navn)

**Iter 2 — Vedleggs-pipeline:**
- `lib/ids-attachment.ts` — canvas-basert bilde-komprimering (1600 px, JPEG 80%, trinnvis kvalitets-nedskalering 0.80→0.60), PDF-validering, custom error-typer
- `CardCamera`/`CardCropper` utvidet med `aspectMode: "id-1" | "passport"` + `theme?: FeatureTheme` (bakoverkompatibel — default = PRIMARY_THEME)
- `IdAttachmentDropZone` — 3 kilder i én komponent (fil-picker + drag-drop + kamera), orange-tema

**Iter 2.5 — Arkitektur-rydding (Mike-fanget):**
- 3 nye semantiske tokens i `FeatureTheme`: `cornerMarker`, `toggleActive`, `accentOutlineButton` — dekker fokus-rammer, aktive toggles, outline-knapper
- Theme-prop på CardCamera/Cropper endret fra fragment til full `FeatureTheme`-objekt — matcher etablert "FeatureTheme er sannhetskilden"-mønster

**Iter 3 — UI:**
- `DashboardShell` → 3-vei pill (Passord blue ⇄ Kort violet ⇄ ID orange)
- `IdsDashboard` — Liste/Gruppert-toggle med 4-type-gruppering, IdRow med thumbnail
- `IdModal` — type-velger som første steg ved "Ny", per-type form-felter, integrert dropzone, view/edit/new-modes, full-screen `AttachmentViewer` (bilde + PDF i iframe), ESC-lukker

**Iter 3.5 (Mike-feedback runde 1):**
- Pass auto-utløp: utløpsdato = utstedt + 10 år (auto-fyll når utstedt skrives og utløp er tom)
- Førerkort 2 bilder generalisert til `attachments?: IdAttachment[]` (0–3) på IdBase, med MAX_ATTACHMENTS_PER_ID = 3
- Transparent legacy-migrering i useIds.activate (`attachment` → `attachments[0]`)

**Iter 4 — Vannmerke-eksport + Cmd+K (D-034):**
- `lib/ids-export.ts` — klient-side canvas → JPEG med "KOPI · YYYY-MM-DD" stempel-bånd nederst (C2-stil), filnavn-sanitisering for norske tegn
- Download-knapp per vedlegg i IdModal view-mode, PDF disabled med tooltip (D3-valg)
- SearchPalette utvidet med ID-er (Full-integrasjon): emoji-ikoner, type-spesifikke nøkkelfelt-søk, synonymer (kjørekort/sertifikat/passport)
- Cmd+K trigger nå ALLE idle-blobs (cards + ids) i background — fikser også eksisterende v3.0-bug der cards ikke var søkbar uten Kort-fanen-åpning først

**Iter 5 — Polish + ADRer + bump:**
- APP_VERSION bumpet til `v4.1.0`
- D-033 (ID-blob arkitektur) og D-034 (vannmerke-eksport) lagt til DECISIONS.md

**Sikkerhet (D-001 intakt):**
- Alle vedlegg krypteres med samme AES-256-GCM som hovedvault, egen salt per blob
- Server ser KUN kryptert blob (salt + iv + cipher), aldri klartekst
- Vannmerke-eksport rendrer 100% klient-side via canvas — ingen server-runde

**Migrering for eksisterende brukere:**
- Test-ID-er med singular `attachment`-felt (fra utviklings-iterasjoner) konverteres transparent ved første decrypt. Neste save fjerner legacy-felt permanent.

**Test-resultater v4.1.0:**
- TSC: 0 feil
- Next.js prod-build: ✅ grønn
- 11 testsuites grønne (totalt ~75 assertions)
- E2E på Vercel-prod gjenstår

### v4.2.0 — Språkdrakt NO/SV/DA 🌐 ✅ (2026-05-28)

**Mål:** Hele UI tilgjengelig på norsk, svensk og dansk via lettvekts custom i18n (D-036) — uten eksterne dependencies (`next-i18next`/`react-i18next`).

**Hva som ble bygget:**
- `lib/i18n.ts` — kjerne: `translate()`, `tHook()` (for kode utenfor React-tree), `resolveInitialLocale()` med fallback-kjede (stored → tenant → navigator → "no"), `matchNavigatorLocale()`
- `lib/i18n-context.tsx` — `<LocaleProvider>` + `useLocale()`-hook, oppdaterer `document.documentElement.lang` + `document.title` ved bytte
- `lib/locales/no.json` — kanonisk ordbok, **748 nøkler** i flat dot-notation (+ `_section_new_keys`-separator)
- `lib/locales/sv.json` + `da.json` — byte-likt synket med no.json (placeholders inntil Mike erstatter verdier manuelt)
- `lib/format-date.ts` — locale-aware dato-formattering (`formatShortDate`, `formatShortDateTime`, `formatLongDate`, `localeCompare`, `localeToBcp47`)
- `components/LanguagePicker.tsx` — UI-velger med 🇳🇴/🇸🇪/🇩🇰-flagg, integrert i AppHeader (locked) + SettingsPanel (unlocked)
- `components/LocalePromptToast.tsx` — diskret bunn-høyre toast som vises ved første besøk når `navigator.language` ≠ `nb/nn/no`. 750ms inn-delay, 15s auto-dismiss, lagrer `kodo-locale-prompted`.

**Komponenter ekstrahert (30/30):**
Auth (AuthScreen, RestoreSheet, MasterPasswordPanel, Biometric), Vault (DashboardShell, MobileBottomBar, VaultDashboard, EntryModal, AppHeader), Settings (SettingsPanel + RotateModes), Cards (CardsDashboard, CardModal), IDs (IdsDashboard, IdModal + KIND_META + attachments), Pakker (PackageHubModal, PackagePreview, PackEntryPanel, PackModule, UnpackModule), Sikkerhet (EventLogPanel, BackupExportModal, BackupImportModal), Søk & Lab (SearchPalette + CARD_TYPE_LABELS, PasswordLab + Learn-blokker), i18n-UI (LanguagePicker, LocalePromptToast), App (page.tsx, providers.tsx, layout.tsx).

**Lib-filer locale-aware:**
- `password-strength.ts` — zxcvbn warnings/suggestions + crack-time-enheter
- `webauthn.ts` — Touch ID/Face ID-errors
- `package.ts` + `package-zip.ts` — pack-validering
- `ids-attachment.ts` — HEIC-hint
- `backup.ts` — backup-validering
- `vault-sync.ts` + `cards-sync.ts` + `ids-sync.ts` — rate-limit-errors
- `hooks/useVault.ts` + `useCards.ts` + `useIds.ts` — alle `throw new Error("norsk")` → `tHook()`

**Konvensjoner (definitiv guide i `/app/memory/i18n-CONVENTIONS.md`):**
- Flat dot-notation, snake_case (`pack.encrypt_button`, ikke `packEncryptButton`)
- HTML/JSX splittes til separate nøkler per ADR D-036
- Brukerdata, varemerker (`Ko|Do · Vault`, `.kodoenc`, `BankID`, `Touch ID`) oversettes ALDRI
- 3 bruksmønstre: `useLocale().t()` (React), `tHook()` (utenfor React), `translate(key, locale)` (pure)
- SV/DA byte-likt med NO bortsett fra `_meta`-blokk

**Kjente unntak (akseptert av Mike):**
- `app/layout.tsx:14` — Next.js SSR HTML title. Klient-side override via `LocaleProvider`. Ingen `/sv/`-routing.
- `lib/config.ts:212` — tenant `brand.name` + `tagline`. Per-tenant config, Mike håndterer manuelt.

**Test-resultater v4.2.0:**
- TSC: 0 feil ✅
- `i18n.test.ts`: **63/63 assertions grønne** (translate, fallback, resolveInitialLocale, formatShortDate, formatLongDate, formatShortDateTime, localeCompare, localeToBcp47, tom/ugyldig input)
- `yarn build`: ✅ grønn
- Hardkodede norske brukervendte strenger: **0**
- Hardkodede `nb-NO`/`sv-SE`/`da-DK` utenfor `format-date.ts`: **0**

**Gjenstår:** Ingenting. Mike har oversatt SV og DA manuelt og pushet til GH. Per-tenant `taglineSv`/`taglineDa` i `clients/*.json` håndterer Mike manuelt hvis ønskelig (utenfor v4.2-scope).

**Nye nøkler legges i `_section_new_keys`-blokken nederst i alle 3 filer** med norsk verdi som placeholder. Mike scroller til bunnen, ser dem umiddelbart, oversetter, og kan eventuelt flytte til riktig prefiks-område (men plassering i JSON spiller ingen rolle for koden).

### v4.3 Iter 0 — Admin-autentisering (revidert) ✅ (2026-06-01)

**Mål:** Beskytte `/platform/admin/*` på `admin.kodovault.no` bak vault-unlock-port. Forutsetning for Iter 1+ (TenantViewer + sentral Upstash) og Iter 20+ (B2B admin-modul).

**Designvalg (besluttet med Mike 2026-06-01, revidert):**
- **D-035-fortolkning:** subdomenet er identifikatoren, master-passordet er nøkkelen. `admin.kodovault.no` + vault unlocked = admin-tilgang
- **Ingen separat admin-pwd, ingen Argon2id-hash, ingen credentials-generator** (Mike forkastet Alternativ A 2026-06-01)
- Klient-kall: etter vault-unlock på admin-host, klienten kaller `POST /api/admin/session/start` automatisk
- HMAC-SHA256-signert HttpOnly cookie `kodo_admin_session` (secret = `ADMIN_SESSION_SECRET`), TTL 8 timer, SameSite=Strict, Secure i prod
- Middleware i Edge runtime verifiserer kun cookie via Web Crypto
- Endepunktet `/api/admin/session/start` er host-låst + Origin-låst (cross-origin POST blokkeres med 403)

**Trusselsmodell (soft trust):**
Server kan IKKE kryptografisk verifisere at klienten faktisk har unlocked vault'en (det ville krevd en credential på server-siden, som Mike eksplisitt forkastet). Beskyttelse hviler på:
1. Host-lock — kun `admin.kodovault.no` (+ dev/preview-hosts) kan kalle session/start
2. SameSite=Strict + Origin-sjekk — cross-origin POST blokkeres
3. Cookie er HMAC-signert med `ADMIN_SESSION_SECRET` — kan ikke forfalskes uten secret
Restrisiko: noen som faktisk besøker `admin.kodovault.no` og kjenner endepunkt-URL'en kan kalle session/start direkte uten å unlocke vault. Mitigert ved at hosten ikke er offentliggjort. **v4.4 ("Autentiseringsarkitektur") legger på kryptografisk unlock-bevis.**

**Hva som ble bygget:**
- `middleware.ts` — host-gate + cookie-verifisering. Ved manglende session: redirect til `/?adminRedirect=<path>` (vanlig vault-login) for sider; 401 JSON for API. Edge runtime.
- `lib/platform/admin-auth.ts` — Web Crypto HMAC-SHA256 sign/verify, constant-time signatur-compare, expiry-sjekk, 8t TTL
- `app/api/admin/session/start/route.ts` — host-lock + Origin-lock + cookie-set. Node runtime.
- `app/api/admin/logout/route.ts` — idempotent cookie-sletting
- `app/platform/admin/page.tsx` — minimal landingsside som bevis på middleware fungerer
- `app/page.tsx` — admin-session-bootstrap-hook: etter `vault.status === "unlocked"` på admin-host, automatisk `POST /api/admin/session/start`. Hvis URL har `?adminRedirect=...`, redirect videre etter cookie-set.
- i18n: 7 nye nøkler under `admin_landing.*` lagt til i alle 4 språkfiler (NO/SV/DA/EN) per D-036. **Ingen** `admin_login.*` (revidert: ingen login-side).
- `lib/__tests__/admin-auth.test.ts` — **17/17 unit-tester grønne**

**Test-resultater v4.3 Iter 0 (revidert):**
- TSC: 0 feil ✅
- `admin-auth.test.ts`: 17/17 grønne ✅
- `i18n.test.ts`: alle assertions grønne ✅
- End-to-end curl (lokal pod, 7 tester): redirect-flyt + session/start + cross-origin-blokk + logout + post-logout-redirect ✅

**Mike sin oppgave før Vercel-deploy:**
1. Generer `ADMIN_SESSION_SECRET` (64-hex tilfeldig): `openssl rand -hex 32`
2. Sett `ADMIN_SESSION_SECRET` i Vercel env-vars for `kodo-vault.vercel.app` (Production scope)
3. Bekreft at `admin.kodovault.no` er custom domain på `kodo-vault.vercel.app`
4. Save to GitHub → Vercel deployer
5. Test: `https://admin.kodovault.no/platform/admin` → redirecter til vault-login → unlock med master-pwd → automatisk tilbake til `/platform/admin`

**Slettet i revidert versjon:**
- `lib/platform/admin-auth-pwd.ts` (Argon2id-helpers)
- `app/api/admin/login/route.ts` (pwd-basert login)
- `app/platform/admin/login/page.tsx` (separat login-side)
- `scripts/generate-admin-credentials.mjs` (credential-generator)
- `scripts/admin-credentials.html` (credential-generator)
- `@node-rs/argon2` npm-pakke
- Alle `admin_login.*` i18n-nøkler

**Gjenstår for v4.3:** Iter 1-24. Se `/app/memory/v4.3 Utviklingsplan.md`.

### v4.3 Iter 1 — Sentral Upstash + TenantRecord + admin-viewer ✅ (2026-06-01)

**Mål:** Sentral platform-database + gjenbrukbar TenantViewer som grunnstein for trial-flyt (Iter 7-10) og B2B-modul (Iter 20).

**Hva som ble bygget:**
- `lib/platform/tenant-types.ts` — komplett `TenantRecord`-type per Spec §3 (B2C + B2B-felter, Plan, TenantStatus, EmailPreferences, datoer, Stripe-felter, infrastruktur-felter, metadata) + `buildTenantRecord()` med standardverdier (30-dagers trial, transactional=true, lifecycle=true).
- `lib/platform/tenant-crypto.ts` — AES-256-GCM (12-byte IV + 16-byte auth-tag) via Node `crypto`. Schema-versjon `v=1`. Nøkkel fra `CENTRAL_ENCRYPTION_KEY` (64 hex). Tydelige feilmeldinger ved manglende/ugyldig nøkkel.
- `lib/platform/tenant-store.ts` — CRUD via `@upstash/redis` mot sentral instans (`CENTRAL_KV_REST_API_URL/TOKEN`). Bruker `tenant:<subdomain>`-key + `tenant-index`-SET for rask listing. Lagrer kryptert blob. Pipeline-batch for liste-fetch.
- `app/api/admin/tenants/route.ts` — GET (liste) + POST (opprett) med validering (subdomain-regex, e-post-regex, customerType-enum). 409 ved duplikat.
- `app/api/admin/tenants/[subdomain]/route.ts` — GET (én) + DELETE (idempotent).
- `components/platform/TenantViewer.tsx` — full UI: liste, statusbadge, plan-badge, detalj-view, opprett-modal (B2C/B2B-toggle med kontekstuelle felter), confirm-delete. Alle strenger via `t()`, full `data-testid`-dekning, glass-arkitektur (`backdrop-blur-xl`), amber CTA.
- `app/platform/admin/tenants/page.tsx` — beskyttet rute som wrapper TenantViewer.
- Oppdatert `app/platform/admin/page.tsx` — modulvelger med "Tenants" + "B2B" (placeholder for Iter 20) + "Hopp til min vault"-snarvei.
- `components/AppHeader.tsx` — ny "Hopp til admin"-knapp som rendres kun når `hostname === "admin.kodovault.no"` (+ dev/preview-hosts) OG vault er unlocked. Per Mike's GO 2026-06-01.
- i18n: 38 nye nøkler under `admin_tenants.*`, `admin_landing.module_*` og `header.jump_to_admin_*` i alle 4 språkfiler (NO/SV/DA/EN) per D-036.
- `lib/__tests__/tenant-crypto.test.ts` — **16/16 unit-tester grønne** (roundtrip, IV-unicity, tampering-detection, feil/manglende nøkkel, schema-versjon).

**Test-resultater v4.3 Iter 1:**
- TSC: 0 feil ✅
- `tenant-crypto.test.ts`: 16/16 grønne ✅
- `admin-auth.test.ts`: 17/17 grønne ✅ (regresjon)
- `i18n.test.ts`: alle assertions grønne ✅
- End-to-end curl (lokal pod): API-auth (401 uten cookie), server-feil ved manglende `CENTRAL_*` env (tydelig melding), UI rendres 200 med cookie ✅

**Mike sin oppgave før prod-test:**
1. Generer encryption-key: `openssl rand -hex 32` → kopier output
2. Legg som `CENTRAL_ENCRYPTION_KEY` i Vercel env-vars (Production + Preview)
3. Save to GitHub → Vercel deployer
4. Test på `https://admin.kodovault.no/platform/admin/tenants`: opprett en B2C-tenant manuelt (subdomain="test", email="test@example.no"), se den i listen, åpne detaljer, slett. Verifiser i Upstash dashboard at `tenant:test` finnes som blob mens den er opprettet, og er borte etter sletting.

**Bug-fix levert samtidig (logout/lock):**
- Vault-lock POSTer `/api/admin/logout` automatisk → admin-cookie dør når vault låses
- Admin "Logg ut" setter `kodo-force-vault-lock` localStorage-flag → vault låses ved redirect til `/`
- Admin "Logg ut" setter `kodo-admin-just-logged-out` sessionStorage-flag → bootstrap-hook hopper over auto-POST denne ene gangen

**Gjenstår for v4.3:** Iter 3-24.

### v4.3 Iter 2 — Subdomene-validering (reserverte navn) ✅ (2026-02)

**Mål:** Hindre at reserverte subdomener (`admin`, `api`, `www`, `*-admin`-mønster osv.) brukes som tenant-subdomener — verken via admin UI (Iter 2) eller fremtidig selvregistrering (Iter 4/7).

**Hva som ble bygget:**
- `lib/platform/subdomain.ts` — tre pure funksjoner: `isValidSubdomainFormat()`, `isReservedSubdomain()` (eksakt-match-set + `-admin`-suffiks per D-038), `isSubdomainAvailable()` (format → reservert → `tenantExists()`-kall).
- `RESERVED_SUBDOMAINS` Set med ~30 navn: system/DNS (admin, api, www, mail, ftp, smtp, cdn), plattform/app (start, test, register, billing, support, docs, blog), miljøer (dev, staging, prod, beta, sandbox), Ko|Do-spesifikke (kodo, kodovault, vault, michael, mike).
- `/api/admin/tenants` POST integrert med `isReservedSubdomain()` — returnerer 400 `{"error": "reserved_subdomain"}` før kall til sentral Upstash.
- `TenantViewer.tsx` mapper `reserved_subdomain` → `t("admin_tenants.error_reserved")`.
- i18n: `admin_tenants.error_reserved` lagt til i alle 4 språkfiler (no/sv/da/en) under `_section_new_keys` per D-036.
- `lib/__tests__/subdomain.test.ts` — 48/48 unit-tester grønne.

**Gjenstår for v4.3:** Iter 5-24.

### v4.3 Iter 3 — Plan-velger /platform/test ✅ (2026-06-01)

**Mål:** Vise plan-valg-flyten brukere møter før registrering — 3 B2C-planer + Enterprise-kontakt-CTA.

**Hva som ble bygget:**
- `lib/platform/plans.json` — 4 planer (trial, monthly, yearly, enterprise). Strukturelle data (trialDays, stripePriceId-slot, ctaTone, contactOnly). Per-locale priser/labels i i18n.
- `/platform/test` — public side med 4 kort. B2C-plan-klikk → resultat-panel + "Gå til registrering →"-knapp som peker til `/platform/register?plan=<id>`. Enterprise-klikk → mailto-CTA.
- Priser per D-037: 129 kr/mnd, 1 238 kr/år. Bekreftet/dokumentert i D-042.

### v4.3 Iter 4 — Registreringsskjema + public subdomain-check ✅ (2026-06-01)

**Mål:** Komplett B2C-trial-skjema (UTEN API-kall ved submit — Iter 7+ wires actual provisioning).

**Hva som ble bygget:**
- **Public endepunkt** `GET /api/register/subdomain-check?subdomain=<s>` — gjenbruker `isSubdomainAvailable()` fra Iter 2, INGEN admin-cookie kreves. Samme sannhetskilde som admin-versjonen.
- **`/platform/register?plan=<id>`** — registreringsskjema:
  - Subdomain-felt øverst (primær-valg), 20ch bredt, høyre-justert input + `.kodovault.no` plain tekst-suffiks. Live-sjekk på 500ms debounce.
  - Min 3 tegn (D-043) — klient-side "for kort"-melding under terskel, ingen API-spam.
  - URL-forhåndsvisning `https://<subdomain>.kodovault.no` i grønn boks når ledig.
  - Plan-badge øverst som matcher URL-parameter (Trial / Monthly 129kr / Yearly 1238kr).
  - Enterprise-attempt → egen redirect-side med mailto-CTA + D-038-forklaring.
  - Påkrevde felt merket med rød `*` (subdomain + e-post), navn valgfri per spec linje 151-152 (D-044).
  - Lokaliserte placeholders: Terje/Erik/Lars/Alex per NO/SV/DA/EN.
  - Submit kjører INGEN API-kall — viser forhåndsvisning av Iter 7-payload.

**Sideforbedringer i samme periode:**
- TenantViewer i admin: blur-validering på subdomain + e-post i create-modal, X-knapp i detail-card, CMD+R-logout fra `/platform/admin`.
- Reserverte subdomener flyttet fra hardkodet Set til `reserved-subdomains.json` (D-041).

**Gjenstår for v4.3:** Iter 5-24. **Neste blokker:** Iter 5 krever Mike's Cloudflare Turnstile-nøkler (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`). Iter 11 (Stripe) blokkerer 12-14.
- TSC: 0 feil ✅
- `subdomain.test.ts`: 48/48 grønne ✅
- Lokal curl-test mot `/api/admin/tenants` POST:
  - `admin` → 400 `reserved_subdomain` ✅
  - `foo-admin` (suffiks) → 400 `reserved_subdomain` ✅
  - `api` → 400 `reserved_subdomain` ✅
  - `FOO!` (ugyldig format) → 400 `invalid_subdomain` ✅
  - `terje` (gyldig) → passerer alle valideringer, går til sentral DB ✅

**Mike sin oppgave før Vercel-test:**
- Save to GitHub → Vercel deployer
- Test manuelt på `https://admin.kodovault.no/platform/admin/tenants`: prøv å opprette `admin`, `api`, `lisbeth-admin` — alle skal vise "Dette subdomenet er reservert og kan ikke brukes."

### Iter 7.6 — Invitasjonslenke-flyt (D-056 · 2026-06-02)
- **Konsept:** Mike kopierer URL fra admin → ansatt klikker → ansatt oppretter sin egen vault uten å måtte kontakte Mike. Fase 2 (v4.4.1) lar `am-admin` selv opprette invitasjoner.
- **Backend:**
  - `lib/platform/invite-types.ts` — `InviteRecord` + `buildInviteRecord` + `isInviteExpired`
  - `lib/platform/invite-store.ts` — kryptert CRUD mot sentral Upstash (TTL 7d ved pending, PERSIST ved used)
  - `POST/GET /api/admin/invites` (beskyttet) — opprett/list med subdomain-prefiks-validering og lisens-tak
  - `DELETE/POST(action:resend) /api/admin/invites/[token]` (beskyttet)
  - `GET /api/invite/validate` (public, rate-limit 60/min, anti-brute-force på UUID)
  - `POST /api/invite/accept` (public, rate-limit 5/time) — verifiser token, opprett B2B child-tenant, inkrement parent.activeLicenses, marker invitasjon "used"
  - `GET /api/cron/cleanup-pending` (Vercel Cron, Bearer CRON_SECRET, 0 3 * * *) — markerer utløpte pending + appender notis til parent.notes
- **Frontend:**
  - `components/platform/InvitesSection.tsx` — rendres i TenantDetailCard for B2B med tenantPrefix. Liste, "Kopier lenke", "Send på nytt", "Slett", "+ Ny invitasjon"
  - `app/invite/page.tsx` — public landingsside. Subdomain låst, e-post pre-fylt hvis admin satte det. Redirect til `<subdomain>.kodovault.no` etter aksept
- **Typeutvidelse:** `CreatedBy` utvidet med `"invite"` slik at child-tenant kan spores tilbake til invitasjons-flyten i audit
- **Tester:** `lib/__tests__/invite-types.test.ts` — 23/23 passed (token-unikhet, TTL, case-normalisering, expiry-boundary)
- **Build:** `yarn build` grønn, alle nye ruter registrert som ƒ (dynamic)

**Gjenstår for v4.3:** Iter 10 (Resend + Telegram), Iter 11+ (Stripe-stack), Iter 20+ (B2B selvbetjent).

### Iter 8 — Vercel auto-provisjonering (D-057 · 2026-06-02)
- **Helpers:**
  - `lib/platform/provision-retry.ts` — `fetchWithRetry` (3x, 60s delay, retry kun 408/429/5xx)
  - `lib/platform/github-config.ts` — GET/PUT `public/clients/<subdomain>.json` via GitHub API (`meetmax-no/bankboks` main), kopierer fra `default.json` og setter `_meta.client` + `_meta.createdAt`
  - `lib/platform/vercel-provision.ts` — `createVercelProject` (POST /v10/projects), `setProjectEnvVars` (POST /v10/projects/{id}/env, alle `encrypted`), `attachSubdomain` (POST /v10/projects/{id}/domains), orchestrator `provisionTenantOnVercel`
  - `lib/platform/notify.ts` — `notifyProvisioningFailure` stub (strukturert `[PROVISION_FAILED]` console-log; Iter 10 wirer Resend + Telegram)
- **Env-vars satt per nytt prosjekt:**
  - `NEXT_PUBLIC_CLIENT_CONFIG=<subdomain>` (peker til `public/clients/<subdomain>.json`)
  - `KV_REST_API_URL=PENDING_ITER_9` + `KV_REST_API_TOKEN=PENDING_ITER_9` (plassholdere — Iter 9 overskriver)
- **Manuell retry (D-055):** `POST /api/admin/tenants/[subdomain]/provision-vercel` (beskyttet av middleware) + "Provisjoner Vercel-prosjekt"-knapp i `TenantDetailCard` (`ProvisionRow`) som vises når `vercelProjectId === null`. Idempotensesjekk: returnerer 409 hvis prosjekt-ID allerede er satt.
- **Wired inn i:** `POST /api/register` (B2C trial) og `POST /api/invite/accept` (B2B child fra invitasjon). Ved feil settes `status: "provisioning_failed"` men API-en returnerer OK — bruker ser fortsatt success, og admin retry-er via knappen.
- **Tokens (Vercel env-vars):** `VERCEL_API_TOKEN`, valgfri `VERCEL_TEAM_ID`, `GITHUB_API_TOKEN` (PAT classic, `repo`-scope).
- **Tester:** 29/29 i `lib/__tests__/iter8.test.ts` (buildTenantConfig-mutasjon, isRetryableStatus-mapping, vercelProjectName-normalisering). Build grønn, alle ruter registrert.

**Gjenstår for v4.3:** Iter 11+ (Stripe-stack), Iter 20+ (B2B selvbetjent).

### Iter 9 — Komplett provisjonerings-stack (D-063 → D-067 · 2026-06-04)
- **D-063 Failsoft:** Ved Upstash-feil rull IKKE tilbake Vercel. Marker `provisioning_failed`, varsle, admin retter via D-055.
- **D-064 Upstash først:** `provisionTenantOnUpstash()` → `createVercelProject()` med ekte KV-creds → `setProjectEnvVars()` → `triggerVercelRedeploy()` (returnerer `deploymentId`) → `attachSubdomain()`. PENDING_ITER_9-hack fjernet helt.
- **D-065 Strukturert logg:** `provisioningLog: ProvisioningEvent[]` (9 stages, ok/failed/retried, ISO timestamp + detail). Real-time `onEvent`-callback i alle provisjonerings-API-kall. Soft migration for eksisterende records.
- **D-066 vault_live:** `vaultLive: boolean` + `vaultLiveAt`. `GET /api/status?subdomain=X` returnerer current state + opptil 50 events. On-demand Vercel deployment-statussjekk (frontend poller, lambda sjekker per request). 3-min timeout. Stage `vault_live` (ok/failed).
- **D-067 Live tracker UI:** Frontend orkestrerer admin-create via D-055-ruter (POST → tenant-record kun, deretter Upstash-rute → Vercel-rute → polling). Delt `ProvisioningTracker`-komponent med 6-stegs checklist:
  - ✅ Sikker lagring opprettet
  - ✅ Vault-miljø konfigurert
  - ✅ Kryptering satt opp
  - ✅ Vault startet
  - ✅ Kobler til kodovault.no
  - ✅ Vault er live
- Bruks-steder: Skjerm 5 (public mode) + admin-modal ved "+ Ny tenant" (admin mode)
- **TenantViewer Konto-logg:** Side-panel `absolute top-7 left-full` ved siden av tenant-detail-card (toppjustert). Tekst-modus default + JSON-toggle + Kopier-knapp.
- **Tester:** 28 i `iter9.test.ts` + 7 i `provisioning-log.test.ts`. Manuell ende-til-ende verifisert mot annelise på produksjon 2026-06-04.

### Iter 8.3 / D-061 / D-062 — (tidligere — beholdt for historisk kontekst, se DECISIONS.md for full beslutningsbakgrunn)
- `lib/platform/client-config-store.ts` — sentral Upstash for client-config (D-060)
- `lib/platform/__tests__/client-config.test.ts` — JSON-validering + migrering
- D-061: localStorage-cache for tenant-config (24h)
- D-062: ID-integrasjon i backup + atomisk master-pwd-bytte

**Gjenstår for v4.3:** Iter 11+ (Stripe-stack), Iter 20+ (B2B selvbetjent).

## Test status

- Iteration 1: 10/10 (Phase 1-3)
- Iteration 2: 9/9 (Phase 4 fallback)
- Upstash prod verifisert via curl (GET/PUT/DELETE alle 200)
- Offline tests (v4.1.0):
  - `backup.test.ts` 24/24 passed (v3 + v2-migrering + selektiv eksport/import)
  - `import-reencrypt.test.ts` 11/11 passed (smart re-kryptering med pwd-mismatch)
  - `cards-crypto.test.ts` 5/5 passed
  - `ids-crypto.test.ts` 10/10 passed (inkl. driver-2-sides roundtrip — D-033 array-utvidelse)
  - `ids-attachment.test.ts` 13/13 passed (PDF-pipeline, MIME-helpers, 1 MB-grense)
  - `ids-export.test.ts` 11/11 passed (vannmerke-eksport pure-funksjoner — D-034)
  - `image-config.test.ts` 7/7 passed
  - `password-generator.test.ts` 10/10 passed
  - `passphrase.test.ts` 8/8 passed
  - `package-master-pwd-guard.test.ts` 5/5 passed
  - `package-zip.test.ts` passed
- TypeScript: **0 feil** (`tsc --noEmit` ren). Pre-eksisterende `Uint8Array<ArrayBufferLike>`-advarsler ryddet i v4.1 Iter 1.5.
- Next.js prod-build: ✅ grønn
- E2E-test på Vercel-prod gjenstår

## Deployed
- Prod: https://kodo-vault.vercel.app
- GitHub: meetmax-no/bankboks
- Vercel framework preset forced via `vercel.json`

## 🌐 Landing Page (separat prosjekt)

Landingsiden for `kodovault.no` er **flyttet ut** av denne kodebasen.
- GitHub-repo: `meetmax-no/bankboks-page`
- Egen Emergent-job + egen Vercel-deploy
- Lever helt isolert fra vault-koden (D-001 North Star)
- Ingen referanser til den i `/app/frontend/`

## 📚 Forward-looking — se egne dokumenter
- **`ROADMAP.md`** — Kart over prosjektet, v3.0 / v4.0 / v4.5 / vX, fortellinger, åpne spørsmål, **LinkedIn-post v6 PUBLISERT 2026-05-05** (full tekst lagret i ROADMAP under "📊 LinkedIn / markedsføring")
- **`DECISIONS.md`** — Architecture Decision Records (ADR-format) — alle viktige valg og hvorfor
- **`v4.2-PROGRESS.md`** — ✅✅✅ **100% FERDIG FERDIG** per 2026-05-28. 30/30 komponenter + alle lib-filer + 5 hooks ekstrahert. **748 nøkler** byte-likt i no/sv/da (+ `_section_new_keys`-separator). Auto-detect-prompt + locale-aware datoer. Gjenstår KUN at Mike fyller inn SV/DA-verdiene.
- **`i18n-CONVENTIONS.md`** — 🆕 Definitiv guide for fremtidige agenter. Beskriver bruksmønstre (`useLocale`/`tHook`/`translate`), nøkkel-navnekonvensjon, NO/SV/DA-synkronisering, dato-håndtering, HTML/JSX-splitting (D-036), hva som IKKE skal oversettes. **MÅ LESES før noen som helst hardkodet streng legges til.**
- **`test_credentials.md`** — Test-credentials for testing-agent

**Ikke endre forward-looking innhold i denne PRD.md** — flytt det til ROADMAP.md eller DECISIONS.md i stedet.

## Key files
```
/app/frontend/
├── app/
│   ├── page.tsx                      # state machine + modal-orchestrering
│   ├── layout.tsx                    # static metadata + favicon + manifest
│   ├── globals.css
│   └── api/
│       ├── vault/route.ts            # Upstash GET/PUT/DELETE + auto-events + rate-limit
│       └── vault/events/route.ts     # GET/POST/DELETE event log
├── components/
│   ├── AppHeader.tsx                 # brand + 5 actions + status/net-badges
│   ├── MasterPasswordSetup.tsx       # m/ Passord-lab-knapp
│   ├── MasterPasswordLogin.tsx       # inkl. BiometricLoginButton
│   ├── VaultDashboard.tsx            # liste + sortering + "+ Ny"
│   ├── EntryModal.tsx                # view/edit/new + Passord-lab-knapp
│   ├── SearchPalette.tsx             # cmdk Cmd+K
│   ├── SettingsPanel.tsx             # collapsible seksjoner (config/klient/bg/sec/backup)
│   ├── EventLogPanel.tsx             # eget vindu med stats + filter
│   ├── PasswordLab.tsx               # zxcvbn + chars/passphrase modes
│   ├── ChangeMasterDialog.tsx        # bytte master-pwd m/ Passord-lab-knapp
│   ├── Biometric.tsx                 # enable-prompt + login-button
│   └── ConfirmDialog.tsx             # destruktive bekreftelser
├── hooks/
│   ├── useVault.ts                   # state machine + alle vault-actions + refresh
│   ├── useAppConfig.ts
│   ├── useNetworkStatus.ts           # online/offline/server-error
│   ├── useIsMobile.ts
│   └── useIsSafari.ts                # UA-detection for per-browser glass-arkitektur (D-023)
├── lib/
│   ├── crypto.ts                     # PBKDF2 + AES-GCM + decryptVaultWithKey
│   ├── webauthn.ts                   # PRF + wrap/unwrap (residentKey: "preferred")
│   ├── vault-sync.ts                 # /api/vault klient-helpers + RateLimitedError
│   ├── events-sync.ts                # /api/vault/events klient
│   ├── vault-storage.ts              # session-tracking
│   ├── biometric-store.ts            # localStorage for biometric
│   ├── bg-preference.ts              # bakgrunnsbilde override (lokalt)
│   ├── backup.ts                     # eksport/import envelope
│   ├── clipboard.ts                  # auto-clear
│   ├── password-strength.ts          # zxcvbn-wrapper m/ norsk i18n
│   ├── password-generator.ts         # CSPRNG tegn-generator
│   ├── passphrase-generator.ts       # diceware-stil
│   ├── wordlist-nb.ts                # 607 norske ord uten Æ/Ø/Å
│   ├── server/
│   │   ├── request-meta.ts           # Vercel geo headers + UA-parser
│   │   └── events-store.ts           # Upstash event log + rate-limiter
│   ├── config.ts                     # typer (inkl. loginHistoryCount)
│   ├── version.ts                    # APP_VERSION (= "v4.0.0")
│   └── types.ts                      # VaultEntry, VaultPayload, EncryptedVaultBlob
├── public/
│   ├── clients/default.json          # branding, kategorier, bakgrunner, security
│   ├── favicon.ico, .svg, .png       # 6 ikon-varianter
│   ├── apple-touch-icon.png
│   ├── web-app-manifest-{192,512}.png
│   └── site.webmanifest              # branded "Ko|Do · Vault"
└── vercel.json                       # framework: nextjs (kritisk!)
```

## Vercel env-vars
- `KV_REST_API_URL` — auto-injisert av Upstash Marketplace (også brukt av events-store)
- `KV_REST_API_TOKEN` — auto-injisert
- `NEXT_PUBLIC_CLIENT_CONFIG=default` (valgfritt, default hvis ikke satt)

## Server-side rate-limit
- Per-IP teller i Upstash Redis (nøkkel: `vault:default:ratelimit:<ip>`)
- 10 unlock-fails innen 15 min → GET /api/vault returnerer 429 med Retry-After
- Telleren resettes ved unlock-success/biometric
- TTL settes kun på første failure (ikke skyver vinduet)

## Upstash-keys i bruk
- `vault:default` → kryptert blob `{salt, iv, cipher, iterations, updatedAt}`
- `vault:default:events` → liste av events (LPUSH + LTRIM 200)
- `vault:default:ratelimit:<ip>` → integer counter med 15 min TTL

---

## v4.0 — Sikker overlevering (.kodoenc-pakker, PGP-modell) ✅

**Status: Ferdig 2026-02. Bumpet til `v4.0.0`.**

### Hva v4.0 leverer
Lar Lars (avsender) pakke filer i en kryptert envelope (`.kodoenc`) som sendes over usikker kanal (e-post, Signal, USB-stikke) til Anna (mottaker). Anna pakker ut helt klient-side på `/unpack`-ruten — uten konto, uten Ko|Do-server, uten plikt til Ko|Do som selskap.

### Hva ble bygget per iterasjon
- **Iter 1:** `.kodoenc`-envelope-format med AEAD-bundet klartekst-JSON-header → `lib/package.ts`
- **Iter 2:** Multi-container-splitting (D-009) med JSZip STORE + bin-packing + zip-slip-sanitering → `lib/package-zip.ts`
- **Iter 3:** `PackModule.tsx` (Lars-flyt: 4 stages — select, containers, password, encrypting/done) + `PackageHubModal.tsx`
- **Iter 4:** `UnpackModule.tsx` (Anna-flyt: drop, password, decrypting, viewing) + `PackagePreview.tsx` (PDF/img/text inline) + `PackageEntryButton.tsx` (login-knapp for Anna) + master-pwd-vakt via `verifyMasterPassword`
- **Iter 5:** ADR D-027 til D-030 dokumentert; mappe-drag-and-drop + "Velg mappe"-knapp i PackModule; "Alle flatt"-knappen fjernet fra UnpackModule (Chrome-felle); FSAccess primær + ZIP universell fallback

### Nøkkelfiler v4.0
- `lib/package.ts` — envelope encode/decode med magic-header + AEAD-binding
- `lib/package-zip.ts` — multi-fil-container med STORE + bin-packing
- `components/PackModule.tsx` — Lars-flyten (avsender)
- `components/UnpackModule.tsx` — Anna-flyten (mottaker)
- `components/PackagePreview.tsx` — inline PDF/img/text-preview
- `components/PackageHubModal.tsx` — entry point i appen for Lars
- `components/PackageEntryButton.tsx` — entry point på login-siden for Anna
- `public/clients/default.json` + `default-lk.json` — `features.packages` toggles (`showOnLogin`, `showInApp`)
- `lib/version.ts` — `APP_VERSION = "v4.0.0"`

### v4.0-relaterte ADR-er
- **D-025** Pakke-metadata-eksponering — hva som er klartekst i envelopen (ingenting sensitivt)
- **D-026** Browser-uavhengighet og null-server-avhengighet for mottaker
- **D-027** `.kodoenc`-filformat (binær envelope med magic-header)
- **D-028** Uavhengige containere ved D-009-splitting
- **D-029** File System Access API som progressive enhancement
- **D-030** Engangs-passord — Lars-valgt med Generer-knapp

### v4.0 D-001 100%-sjekkliste
Alle 8 punktene i seksjon 9.6 av `/app/memory/v4.0-SPEC.md` er bekreftet ✅. Ingen master-passord, ingen pakke-passord, ingen klartekst-filer noensinne forlater Lars sin nettleser. Anna stoler ikke på Ko|Do-server.

### v4.1+ Backlog
Ingen aktive. Tidligere kandidater (streaming-dekryptering, "binde sammen N containere") er flyttet til **🗒️ Next Time** seksjonen under.

---

## 🗒️ Next Time — ideer som er vurdert og parkert

Liste over ideer som har vært diskutert, har konkret kontekst, og som vi vil huske til senere. Ikke nødvendigvis prioritert — dette er en idé-bank, ikke en roadmap.

### Fakturahistorikk-eksport (ZIP/CSV) i `InvoiceHistoryCard`
**Dato lagt til:** 2026-02 (post-D-141)
**Kontekst:** Etter D-141 har firma-admins fakturahistorikk i Konsoll → Innstillinger → Fakturering, men må klikke seg gjennom Stripes hosted-portal for å laste ned hver PDF enkeltvis. For regnskaps-arkivering ønsker mange å hente alt i ett kall.

**To kandidater:**
- **a) "Last ned alle som ZIP"** — backend henter PDF-blobs fra Stripe og pakker dem i en ZIP (krever streaming, ev. midlertidig fil). Tyngst implementasjon.
- **b) "Eksport til CSV"** — klient-side bygger CSV med nummer, dato, status, beløp, MVA, hosted-link. Letteste vei. Passer fint med D-113 backup-tankegangen (én "type"-kolonne, RFC 4180 + OWASP formula-injection-mitigering apostrof-prefiks).

**Estimert arbeid:** b) 2-3 timer. a) 1 dag (streaming-ZIP + minne-management).

**Avhengigheter:** Ingen — `/api/am-admin/invoices` har allerede all metadata. PDF-ZIP-varianten krever Stripe `invoice_pdf`-URL-er og en server-side ZIP-streamer.

### Streaming-dekryptering for store filer (>100 MB)
**Dato lagt til:** 2026-02 (post-v4.0)
**Kontekst:** Per i dag laster `UnpackModule` hele pakka inn i RAM før dekryptering. iOS Safari kollapser typisk ved 100-200 MB. Lars og Anna lever bra med dagens grense, men hvis bruker rapporterer "kunne ikke pakke ut" på store filer, er dette løsningen.

**Teknisk skisse:** Chunket AEAD-mode med GCM-kjeder, nytt format-versjons-byte 0x02 i `.kodoenc`-envelopen. Web Streams API for parsing av store ciphertext-blokker uten å laste alt i RAM.

**Avhengigheter:** Krever at vi beholder bakoverkompatibilitet med 0x01-formatet (gamle pakker må fortsatt åpnes). Mottaker-koden må sniffe versjon før den velger flyt.

**Estimert arbeid:** 1-2 dager (krypto-redesign + tester + UX-flagging i PackModule).

### "Binde sammen N containere" — alt-eller-ingenting-modus
**Dato lagt til:** 2026-02 (post-v4.0)
**Kontekst:** Per D-028 er hver container uavhengig — Anna kan åpne én alene. For spesielt sensitive pakker kan Lars senere ønske at ALLE N containere må kombineres før dekryptering (RAID-style).

**Trade-off:** Bedre "alt-eller-ingenting"-sikkerhet, dårligere tap-toleranse. Bare aktuelt hvis en bruker eksplisitt ber om det.

**Teknisk skisse:** Nytt versjons-byte 0x03 i envelopen + en "puslespill-id"-felt som binder containerne kryptografisk.

**Estimert arbeid:** Krever ADR-revisjon av D-028, ~1 dag implementasjon.

### OCR auto-fyll fra foto (v4.1-utvidelse)
**Dato lagt til:** 2026-02 (parkert fra v4.1-SPEC)
**Kontekst:** Når Lars tar foto av passet sitt, kunne appen lese passnummer + utløp + navn automatisk og fylle inn feltene. Sparer ham å taste manuelt.

**Tre kandidat-modeller (analyse fra v4.1-diskusjon):**

| Modell | Hvordan | Bundle | Nøyaktighet | Lean Security? |
|---|---|---|---|---|
| **a) Tesseract.js** | Klient-side OCR generelt | 5-15 MB | 60-85% variabel | ✅ |
| **b) Cloud OCR** (Google Vision) | Send bilde til API | 0 | 95%+ | ❌ Bryter D-001 |
| **c) MRZ-parser** | Spesialisert pass-MRZ-lesing klient-side | ~50 KB | 95%+ for pass | ✅ |

**Anbefaling når aktuelt:** Start med **(c) MRZ-parser kun for pass**. Det er en focused win med liten bundle-kostnad. Tesseract.js kan vurderes senere hvis brukere ber om generell OCR.

**Avhengigheter:** Krever ferdig v4.1 kamera-flow før implementasjon.

### Utløps-varsler for ID-er (v4.1-utvidelse)
**Dato lagt til:** 2026-02 (parkert fra v4.1-SPEC)
**Kontekst:** Pass utløper neste år. Lars vil vite det før han skal til Spania.

**Tilnærming (Mike-beslutning 2026-02):** **In-app banner** når Lars åpner appen, basert på utløpsdato lest fra dekryptert ID-blob. Konfigurerbar via `default.json` (toggle on/off + varslings-vindu).

**Hvorfor parkert:** Krever tenkearbeid om:
1. **Trigger-vindu:** 60 dager / 30 dager / 7 dager? Per type? (Pass = lengre frist, helsekort = kortere)
2. **Multi-varsel-håndtering:** Lars har 15 ID-er, 8 utløper innen 90 dager. Vises 8 bannere? Aggregeres? Top-3?
3. **Snooze-logikk:** «Ikke vis igjen i 30 dager» — hvor lagres dette? (Blob? localStorage?)
4. **«Utløp»-semantikk for forsikring:** Reiseforsikring fornyes årlig — er det «utløp» eller bare «fornyelse»?
5. **Brukernes preferanser:** Skal varsler være per-bruker eller per-tenant?

**Avhengigheter:** Krever ferdig v4.1 datamodell + dekrypterings-flow.

**Estimert arbeid (når aktuelt):** 1-2 dager etter design er låst.

### ICS-eksport av utløpsdatoer
**Dato lagt til:** 2026-02 (parkert sammen med utløps-varsler)
**Kontekst:** Som alternativ/komplement til in-app banner. Lars eksporterer en .ics-fil med alle utløpsdatoer → hans egen kalender minner ham.

**Verdi:** Lean Security-kompatibel (klient-side genereres .ics, server ser aldri datoer). Lavt arbeid, høy nytte.

**Anbefaling:** Bygges sammen med utløps-varsler i samme runde.

### Selv-utpakkende `.kodoenc.html`
**Dato lagt til:** 2026-02 (post-v4.0)
**Kontekst:** Anna trenger å pakke ut en pakke uten internett. Hun har bare fila på maskinen sin. Hun kan ikke åpne `kodo-vault.vercel.app/unpack` fordi hun ikke har nett.

**Problem alle andre løsninger feiler på (tilstedeværelse-paradokset):**
- Hun trenger offline-verktøyet **når hun er offline**
- Hun kan bare hente det **når hun er online**
- ⇒ Verktøyet må allerede være på maskinen før hun trenger det

**Avviste alternativer:**
- Service worker på `/unpack` → krever at Anna besøker sida mens online, samme browser-profil senere — lottokupong, ikke plan
- Standalone `kodo-unpack.html`-fil distribuert separat → hun roter den bort, mismatch mot ny pakke-versjon
- Native app → massivt scope-skift, må vedlikeholdes per plattform
- Knapp inne i Ko|Do-appen som genererer offline-kopi → forutsetter at hun er online akkurat da

**Valgt løsning (når vi bygger det):**
Lars velger ved pakking: "vanlig .kodoenc" ELLER "selv-utpakkende .html". Sistnevnte genererer en `pakke.kodoenc.html`-fil som inneholder:
1. Hele pakka (ciphertext) som base64 inline
2. All utpakkings-logikk (JSZip + AES-GCM + UI) inline i samme HTML
3. Null avhengigheter, null nettverks-kall

Anna åpner HTML-fila i hvilken som helst nettleser → får passord-prompt → får filene. Fungerer offline by definition.

**Trade-offs vi godtar:**
- Filtype `.html` kan trigge e-post-skannere → Lars zip-er den eller deler via Drive/Dropbox
- Større fil enn ren `.kodoenc` (~150 KB ekstra for utpakker-koden) — neglisjerbart for typiske vedlegg-størrelser
- Lars må velge eksplisitt — ingen automatikk

**Estimert arbeid:** ~2-3 timer for proof-of-concept (build-step som inliner alt, en checkbox i PackModule)

**Når skal vi bygge dette:** Når vi har en konkret bruker-case som krever det, eller når v4.0-flyten er fullt validert i produksjon.


### Bankkort-modulen — fargerydding til B-modellen ✅
**Dato implementert:** 2026-02 (samtidig med Pakker-fargerefaktor)
**Endringer:**
- CardModal, CardsDashboard, CardCamera, CardCropper: alle `violet-` og `emerald-` Tailwind-klasser byttet til `blue-` (primær per B-modellen)
- `bg-emerald-500 hover:bg-emerald-600` (Lagre-knapper) → `bg-blue-500 hover:bg-blue-600`
- `violet-300`/`violet-500` (kamera-overlays, hjørner, drop-zoner) → `blue-300`/`blue-500`
- Beholdt: amber-warnings (spesielle egenskaper, empty-state), rose (slett/feil)
- Beholdt: kort-type-farger i hex (`credit: #a78bfa`, `reward: #fbbf24`) — datavisualisering, ikke UI-aksent

**Resultat:** Bankkort har nå samme farge-palett som passord (blue + amber + rose). Hele appen
er konsistent per B-modellen.

### Header-knappene — hover-farger (per B-modellen)
**Dato implementert:** 2026-02 (samtidig som Pakker-fargerefaktor)
**Endringer:**
- Lab (FlaskConical) → violet hover (matcher Lab-modalets interne lilla)
- Oppdater → blue hover (standard)
- Clipboard-clear → amber hover (warning, beholdt)
- Pakker → emerald hover (matcher Pakker-feature)
- Innstillinger → blue hover (standard)
- Lås → blue hover (standard)

Alle header-knapper har nå hover-tilbakemelding. Tidligere var bare clipboard og pakker
markert; resten var hvite/usynlige på hover.

### Pakker-fargen — hvordan bytte til noe annet
Hvis vi senere vil bytte Pakker fra emerald til f.eks. teal:
1. Endre `PACKAGES_THEME` i `/app/frontend/lib/feature-theme.ts` (én konstant)
2. Søk-erstatt `emerald-` → `teal-` i:
   - components/PackModule.tsx
   - components/UnpackModule.tsx
   - components/PackageHubModal.tsx
   - components/PackageEntryButton.tsx
   - components/PackagePreview.tsx
   - components/AppHeader.tsx (kun emerald-blokken til Pakker-knappen)
   - components/MobileBottomBar.tsx (hvis emerald brukes der)
3. Verifiser på `/colors`-ruta

---

## v4.0 etter-arbeid (2026-02 sesjon)

### UI-fixes etter Mike's testing
- ✅ Safari `<select>` styling (Kategori i passord, Korttype i bankkort) — appearance-none + lucide ChevronDown
- ✅ UnpackModule samme bredde som PackModule (max-w-xl)
- ✅ Suksess-banners i UnpackModule (Velg mappe / ZIP / Kun denne)
- ✅ PackageHubModal redesignet: loddrett stack, større ikoner, mer luft
- ✅ Farge-konsistens (B-modellen) gjennomført på tvers av Pakker, Bankkort, Header
- ✅ Lab → violet hover på header-knapp
- ✅ Bankkort: emerald/violet → blue (samme som passord)
- ✅ /colors palett-utforsker for fremtidige fargevalg

### Strategi-dokumenter (Mike-input, formelle valg)
- ✅ `v4.4-PRODUCT-FLYER.md` + `.html` — to-pager for kundesamtaler, print-klar
- ✅ `v4.5-DESIGN.md` — container-modell, Modell 1+2+Klasse A, iPad-segmentering
- ✅ `v5.0-DESIGN.md` — Lean Security som tjeneste, 3 segmenter, deployment-modell
- ✅ `BUSINESS-CASE.md` — 30-50K budsjett, sommeren 2026, kill-kriterier
- ✅ `D-031` (B-modellen) + `D-032` (i18n-scope) i DECISIONS.md

### Versjons-rekkefølge endret 2026-02
- v4.1 (tidligere 2FA) → **v4.1 = ID-blob**
- v4.2 (tidligere ids) → **v4.2 = 2FA TOTP**
- **v4.3 ny** = Språkdrakt (NO/SV/DA/EN)
- **v4.4 ny** = Produkt-flyer (soft-deliverable, ikke kode)
- v4.5 = BYO dokument-laget (Drive + Dropbox + USB)
- **v5.0 ny** = Lean Security som tjeneste (auto-deployment + pricing)

### v4.1+ Backlog → flyttet til Next Time
- Streaming-dekryptering for >100 MB-filer (Web Streams API)
- "Binde sammen N containere" (alt-eller-ingenting)


---

## v4.3 — Iter 7.6 / 8 / 8.3 (2026-06-02)

**Status:** ✅ Ferdig — Iter 9 (Upstash) fullført 2026-06-03

### Iter 7.6 — Invitasjonslenke-flyt for B2B-ansatt (D-056)
- **Konsept:** Mike (eller fremtidig `am-admin` i v4.4.1) genererer URL → ansatt aktiverer egen vault uten å kontakte Mike.
- **Datamodell:** `InviteRecord` (token UUID v4, subdomain, parentTenant, email/firstName/lastName/locale, createdAt/expiresAt/usedAt, status, createdBy).
- **Lagring:** AES-256-GCM kryptert i sentral Upstash (`invite:<token>`, TTL 7d). Index per parent (`invite-index:<parentTenant>`).
- **Endepunkter:**
  - Admin (beskyttet): `POST/GET /api/admin/invites`, `DELETE/POST(resend) /api/admin/invites/[token]`
  - Public: `GET /api/invite/validate` (60/min), `POST /api/invite/accept` (5/time)
  - Cron: `GET /api/cron/cleanup-pending` (0 3 * * *, Bearer CRON_SECRET)
- **UI:** `InvitesSection` i TenantDetailCard (kun B2B med tenantPrefix). Liste, "Kopier lenke / Send på nytt / Slett", "+ Ny invitasjon" + Batch CSV-import.
- **Ansatt-flyt:** `kodovault.no/invite?token=<uuid>` → validate → skjema (subdomain låst, email pre-fylt) → accept → opprett B2B child + inkrement parent.activeLicenses + marker "used" + redirect.

### Iter 8 — Vercel auto-provisjonering (D-057 → erstattet av D-060)
- **Helpers:** `provision-retry.ts` (3x×60s, retry kun 408/429/5xx), `vercel-provision.ts` (createProject + setEnvVars + attachSubdomain).
- **Vercel-prosjektnavn:** `kodo-kv-<subdomain>` (per Mike 2026-06-02 — sikrer global unikhet).
- **Root Directory:** `frontend` (bankboks-repoet har Next.js i underkatalog).
- **Reorder (D-058):** Vercel-prosjekt OPPRETTES FØRST → så lagres config i Upstash → så env-vars → så domain. Webhook har et eksisterende prosjekt å treffe når commits kommer.
- **`adminSubdomain` auto-utledning:** Server overskriver alltid `adminSubdomain = subdomain` for B2B. Fjernet input-felt i admin-create-form.
- **Manuell retry (D-055):** `POST /api/admin/tenants/[subdomain]/provision-vercel` + "Provisjoner Vercel-prosjekt"-knapp i `ProvisionRow`.
- **Notify-stub (D-057):** `notifyProvisioningFailure` skriver strukturert `[PROVISION_FAILED]`-log. Iter 10 wirer Resend + Telegram.
- **Rate-limit-reset:** Admin-knapp + `/api/admin/rate-limit` for å nullstille tellere under testing.

### Iter 8.3 — Tenant-config via sentral Upstash (D-060, erstattet D-059)
**Hvorfor:** D-059 forsøkte å lagre tenant-configs som filer i bankboks-repoet med `.gitignore`-beskyttelse. Bekreftet i test (2026-06-02): Emergent "Save to GitHub" gjør force-mirror og sletter remote-only filer. `.gitignore`-strategien er teknisk umulig.

**Løsning:**
- Per-tenant configs i sentral Upstash som plain JSON under `client-config:<subdomain>`
- `default.json` i bankboks som template — eid manuelt av Mike. Endringer pushes via Save-to-GitHub som vanlig.
- Bankboks-repoet rores ALDRI av provisjonering.
- `useAppConfig.ts` fetcher fra `admin.kodovault.no/api/client-config` for subdomain ≠ "default". CORS tillater `*.kodovault.no`.
- localStorage-cache 24t (D-061) for resilience ved admin-nedetid.
- `NEXT_PUBLIC_CLIENT_CONFIG=<subdomain>` (ikke embedded JSON) — slik at config kan endres uten redeploy.

**Endring per tenant (uten redeploy):**
- Admin åpner TenantDetailCard → `ClientConfigEditor` (textarea med JSON-validering) → Lagre
- Tenant ser endring innen 30 sek (browser-cache) eller 5 min (s-maxage)
- "Reset til default"-knapp DELETE-r Upstash-key → tenant faller tilbake til default.json

**Bulk-verktøy (`/api/admin/migrate-client-configs`):**
- `mode=skip-existing` — recovery / initial migrering
- `mode=merge` (default) — deep merge default → tenant, **tenant-wins**. Primitiver: tenant beholder. Plain objekter: rekursiv merge. Arrays av `{key,...}`: union-på-key. Andre arrays: tenant-wins.
- `mode=overwrite-all` — full reset (krever bekreftelse, audit-logges)
- GET = dry-run, POST = utfør. Hver mutasjon appender notis til `tenant.notes`.
- Admin-UI: lilla "Config-verktøy"-knapp i TenantViewer-toolbar.

### D-061 — localStorage-cache (24t TTL)
- Ved vellykket fetch: cache + timestamp i `localStorage["kodo-config:<subdomain>"]`
- Ved fetch-feil: les cache hvis <24t gammel
- Fallback-kjede: live → cache → /clients/default.json → FALLBACK_CONFIG

### Tester (2026-06-02 grønn baseline)
- `lib/__tests__/subdomain.test.ts` — 59 tests
- `lib/__tests__/invite-types.test.ts` — 23 tests
- `lib/__tests__/iter8.test.ts` — 29 tests (buildTenantConfig, isRetryableStatus, vercelProjectName)
- `lib/__tests__/merge.test.ts` — 21 tests (deep merge, union-på-key, type-mismatch)
- **Totalt:** 132/132 passerer
- `yarn build` + `npx tsc --noEmit` grønn

### Tokens nå (alle satt av Mike)
- `VERCEL_API_TOKEN` ✅
- `CENTRAL_KV_REST_API_URL` + `_TOKEN` ✅
- `TURNSTILE_SITE_KEY` + `_SECRET_KEY` ✅
- `CRON_SECRET` (valgfri — Vercel cron-header fungerer også) ✅
- ~~`GITHUB_API_TOKEN`~~ ❌ ikke nødvendig (D-059 forkastet)
- `UPSTASH_MANAGEMENT_EMAIL` + `UPSTASH_MANAGEMENT_API_KEY` ✅ (Iter 9)

### Migrering for eksisterende tenants (4 stk per 2026-06-02)
1. Deploy
2. Åpne `/platform/admin` → "Config-verktøy" → "Merge" (default) → "Dry-run" → "Kjør"
3. Alle 4 får client-config initialisert fra default.json i Upstash
4. Tenant ser branding innen 30 sek

**Gjenstår for v4.3:** Iter 10 (Resend + Telegram), Iter 11+ (Stripe-stack), Iter 20+ (B2B selvbetjent).

---

## 2026-06-03 — D-062 Fullfør ID-integrasjon

**Status:** ✅ Ferdig

**Hva ble fikset:** Manglende implementasjon fra v3.2 (ID-modulen).

### Bug 1: ID mangler i backup
`app/page.tsx` `blobSources` inneholdt kun vault + cards. ID-er kunne ikke eksporteres eller importeres. Nå inkludert på lik linje (Bruker velger selektivt hvilke blobs som backup-es/restoreres).

### Bug 2: changeMasterPassword låste brukeren ut
Tidligere re-krypterte kun vault. Cards/ids på server forblev kryptert med gammelt pwd → "Kontakt support"-lockout neste gang fanen ble åpnet.

Ny atomisk flyt:
1. Verifiser current pwd
2. Re-krypter cards (push, behold original)
3. Re-krypter ids (push; ved feil → rollback cards)
4. Re-krypter vault og push (barriere — sist)
5. Re-derive aktive sessions for vault + cards + ids
6. clearBiometric

Ved vault-push-feil etter side-blobs er re-kryptert: full rollback. Brukeren havner aldri i inkonsistent tilstand.

### Tester
- Ny `mp-change.test.ts` (8 tester crypto round-trip + rollback-forutsetninger)
- **Totalt: 140/140 grønne**

**Mike's design-intensjon bevart:** Backup-fil-flyten (BackupImportModal med backupPwd-felt) fungerer uendret. Brukeren kan fortsatt restore en backup laget med gammelt pwd.



---

## Kaskade-sletting av tenant (2026-06-05) ✅

### Nytt: `deleteTenant(subdomain, context)` — slett tenant i ALLE systemer

Én funksjon, ett ansvar — sletter tenant fra Vercel + Upstash + sentral DB + client-config + B2B-prefiks. Brukes av admin-modul, Iter 17 dag-58-cron, og GDPR-forespørsler.

**Fil:** `lib/platform/delete-tenant.ts`

**Rekkefølge:**
1. Hent record (early return hvis ikke funnet)
2. Append `tenant_deleted`-event til provisioningLog FØR sletting
3. DELETE Vercel-prosjekt (hvis `vercelProjectId !== null`, ellers skipped)
4. DELETE Upstash-database (hvis `upstashDatabaseId !== null`, ellers skipped)
5. DELETE client-config fra sentral Upstash
6. DELETE TenantRecord + indeks (SIST — retry-objekt bevares ved feil i tidligere steg)
7. Frigjør B2B-prefiks via `removeReservedPrefix` (kun hvis B2B + steg 6 lyktes)

**Soft-failure-modell:** Enkeltfeil stopper aldri kaskaden. Hver feil fanges, samles i `errors[]`, og returneres i `DeleteResult`. `success: true` = sentral DB faktisk slettet. Caller (admin/cron/GDPR) bestemmer hva som skjer videre.

**D-069-compliance:**
- **Admin-flyt bypasser D-069** — admin har manuell rett til å slette en free-plan-tenant.
- **Cron-flyt (Iter 17, dag 58) MÅ kalle `canAutoDelete()`** fra `lifecycle-guard.ts` FØR den kaller kaskaden. Håndheves automatisk av `yarn lint:d069`.

**D-038-compliance:**
- B2B-parent med `activeLicenses > 0` blokkeres med 409 FØR kaskaden starter — admin må først slette barn-tenantene (forhindrer orphans).

### Helpers lagt til
- `deleteVercelProject(projectId)` i `vercel-provision.ts` — idempotent (404 = OK).
- `deleteUpstashDatabase(databaseId)` i `upstash-provision.ts` — idempotent (404 = OK).
- `"tenant_deleted"` ny stage i `ProvisioningStage`-type.

### Helpers renamet
- `deleteTenant` → `deleteTenantRecord` i `tenant-store.ts` (lavnivå-helper som kun rører sentral DB, brukes nå internt av kaskaden).

### UI
- **`DeleteResultModal`** i `TenantViewer.tsx` — popper opp etter sletting med 5 stegrader (Vercel / Upstash / Client-config / Sentral DB / B2B-prefiks) + farget tittel:
  - 🟢 "Sletting fullført" (alt OK)
  - 🟡 "Sletting fullført med feil" (sentral DB OK, men sub-steg feilet)
  - 🔴 "Sletting feilet" (sentral DB ikke slettet)
- Begge inngangspunktene hooket opp til samme kaskade:
  - 🗑 søppelbøtte-ikon på hver tenant-rad i list-view
  - "Slett tenant"-knapp inne i detail-view
- ConfirmDialog krever subdomain-skriving før kaskaden trigges.
- i18n NO/SV/DA/EN — 14 nye nøkler under `admin_tenants.delete_*`.

### API
- `DELETE /api/admin/tenants/[subdomain]` returnerer nå `DeleteResult` (steps + errors) i stedet for `{ok, removed}`.
- 409 `active_licenses_exist` returneres FØR kaskaden ved D-038-blokk.

### Verifisert
- `yarn build` ✅
- `yarn lint:d069` ✅ (25 filer, 0 brudd)
- `delete-tenant.test.ts` ✅ 14/14
- `iter8.test.ts` ✅ 29/29 (regresjon)
- `iter9.test.ts` ✅ 28/28 (regresjon)
- **E2E verifisert av Mike (2026-06-05)** — søppelbøtte i list-view + "Slett tenant" i detail-view trigger samme kaskade, modal viser stegvis status, listen refresher etter vellykket sletting.

---

## v4.3 Iter 12 — `/api/register/paid` (Stripe Checkout, Scenario C) ✅ (2026-06-05)

Public endpoint som starter betalt registrering. Iter 11 (Stripe-konto + 4 env-vars + webhook URL) ferdig av Mike.

### Levert
- **`stripe@22.2.0`** (API-versjon `2026-05-27.dahlia`, SDK-innebygd)
- **`lib/stripe/client.ts`** — singleton Stripe-klient + `getPriceIdForPlan` (env-var-lookup)
- **`lib/stripe/checkout.ts`** — to helpers:
  - `createCustomerJIT(input)` — D-049: just-in-time customer med idempotencyKey `customer-<subdomain>`
  - `createCheckoutSessionScenarioC(input)` — D-045: 30-dagers trial via `trial_period_days: 30`, `automatic_tax: true`, metadata på BÅDE session og subscription, idempotencyKey `checkout-<sub>-<plan>`
- **`app/api/register/paid/route.ts`** — full POST-flyt (rate-limit → validering → Turnstile → subdomain-check → reserver `pending` 30min → JIT customer → checkout-session → returner URL)
- **`pendingExpiresAt: string | null`** lagt til på TenantRecord. Soft migration for eksisterende records.
- **`iter12.test.ts`** — 27 unit-tester (alle grønne)

### Endpoint
`POST /api/register/paid` → returnerer `{ ok: true, subdomain, url, sessionId }` (201) eller error med spesifikk kode.

### Hva som IKKE er gjort (med vilje — for Iter 13)
- Vercel/Upstash-provisjonering — venter på Stripe-webhook `checkout.session.completed`
- `/billing/success`-side — Iter 14
- Cleanup-cron for abandonerte `pending`-registreringer (`pendingExpiresAt < now`) — senere iter

### Verifisert
- `yarn build` ✅
- `yarn lint:d069` ✅ (26 filer, 0 brudd)
- `iter12.test.ts` ✅ 27/27
- Regresjon: iter8 ✅ · iter9 ✅ · delete-tenant ✅
- **IKKE e2e-testet mot ekte Stripe ennå** — venter på Mike



---

## v4.3 Iter 13 — Stripe webhook ✅ (2026-06-05)

`POST /api/webhook` (URL: `https://admin.kodovault.no/api/webhook`, satt av Mike i Iter 11).

### Levert
- **`lib/stripe/webhook.ts`** — signaturverifisering (HMAC via Stripe SDK), fail-fast `getWebhookSecret()`
- **`lib/stripe/event-handlers.ts`** — 5 event-handlere med D-069-guarder:
  - `customer.subscription.created` → provisjoner (Upstash → Vercel per D-064, soft-failure per D-063)
  - `customer.subscription.updated` → plan-bytte (monthly ↔ yearly)
  - `customer.subscription.deleted` → cancelled (canAutoCancel-guard)
  - `invoice.paid` → bekreft active (locked/trial → active)
  - `invoice.payment_failed` → locked + Telegram (canAutoLock-guard)
- **`app/api/webhook/route.ts`** — POST-endepunkt. Verifiserer signatur FØR alt annet.
- **`lifecycle-guard-lint.test.ts`** — utvidet til å matche `/api/webhook/` (singular)
- **`iter13.test.ts`** — 23 unit-tester (D-069-guards + status-transitions)

### Hva som IKKE er gjort (med vilje — venter på andre iter)
- **vaultLive: true + velkomst + telegram** — håndteres av eksisterende `checkDeploymentOnce()` (Iter 9, D-066). Webhook triggers KUN provisjonering — frontend polling (Iter 14 sin `/api/status`) tar over for vaultLive-flippen og velkomst. Mike's krav er oppfylt: vaultLive settes når deployment READY, velkomst sendes når vaultLive flippes til true.
- **`/billing/success`-side med polling** — Iter 14
- **3 scenarier-checkout** (`/api/billing/create-checkout`) — Iter 12.5
- **E2E-test mot ekte Stripe** — venter på Mike eller Stripe CLI

### Verifisert
- `yarn build` ✅
- `yarn lint:d069` ✅ (27 filer, 2 auto-ruter compliant)
- `iter13.test.ts` ✅ 23/23
- Regresjon: iter8 ✅ · iter9 ✅ · iter12 ✅ · delete-tenant ✅

### Mike's instruks-sjekkliste
- ✅ Signatur verifisert FØR alt annet
- ✅ `customer.subscription.created` → provisjoner
- ✅ Metadata leses fra både session og subscription
- ✅ `provisioningLog` logger hvert steg
- ✅ `vaultLive: true` ved READY (via eksisterende `checkDeploymentOnce`)
- ✅ Velkomstmail + Telegram ved `vaultLive: true` (samme funksjon)
- ✅ Ingen rollback av Vercel ved Upstash-feil (D-063)



---

## v4.3 Iter 14 — Provisjonering-mellomside ✅ (2026-06-05)

Skjerm 5 + Skjerm 8. URL-er bruker lander på etter Stripe Checkout.

### Levert
- **`app/billing/success/page.tsx`** — Skjerm 5. Tynn wrapper rundt `ProvisioningTracker` (Iter 9, mode="public"). Poller `/api/status?subdomain=...` hvert 2. sek.
  - vaultLive: true → auto-redirect til `<subdomain>.kodovault.no` (2s delay)
  - status: "provisioning_failed" → redirect til /billing/error
  - 3-min timeout → redirect til /billing/error?reason=timeout
- **`app/billing/error/page.tsx`** — Skjerm 8. Forskjellig copy per reason (provisioning_failed vs timeout). Trygghetsbanner (24h refusjon). To CTA: "Prøv polling igjen" + "Kontakt support" (mailto: pre-utfylt).
- **`lib/stripe/checkout.ts`** — `success_url` utvidet med `&subdomain=<sub>` (URL-encoded).

### Ko|Do-tema
- `bg-[#0a0a0a]` mørk bakgrunn
- `border-amber-400/30` + `text-amber-300` accent
- `border-rose-400/30` på feilside-ikon
- Monospace for subdomain
- Diskret SVG grain-overlay (samme som /platform/register)
- Pill-knapper med hover-transitions

### Verifisert
- `yarn build` ✅ (`/billing/success` 4.38 kB, `/billing/error` 2.8 kB)
- `yarn lint:d069` ✅
- `iter12.test.ts` ✅ 27/27 (success_url-endringen verifisert)
- `iter13.test.ts` ✅ 23/23 (regresjon)
- **Visuelt verifisert** via screenshot (mørkt tema + amber spinner + checklist)
- **IKKE e2e mot Stripe ennå** — venter på Mike

### Mike's instruks-sjekkliste
- ✅ /billing/success vises etter Stripe redirect
- ✅ Poller /api/status hvert 2. sek
- ✅ Leser vaultLive
- ✅ vaultLive: false → spinner + siste provisioningLog-event
- ✅ vaultLive: true → redirect til `<subdomain>.kodovault.no`
- ✅ status: "provisioning_failed" → /billing/error
- ✅ Maks polling 3 min → timeout → /billing/error
- ✅ Ko|Do-tema (mørk + amber)



---

## Deferred — Neste gang

### "Fortsett der du slapp"-banner (Iter 14.7 — ✅ LEVERT 2026-06-08)
**Status:** Implementert + stabilisert (3 runder bug-fix etter deploy: bfcache, idempotency baseURL, frozen busy-state). Se [`CHANGELOG.md`](./CHANGELOG.md) 2026-06-08-innførselen.

**Problem:** Hvis bruker lukker Stripe-fanen eller klikker browser-tilbake-pilen, fanger vi ikke signalet (i motsetning til cancel_url-redirect som vi rydder umiddelbart). Subdomenet er pending i opptil 60 min. Hvis bruker kommer tilbake til /platform/register i mellomtiden og prøver samme subdomain, får de `subdomain_taken`-feil.

**Implementert løsning:**
1. Når `/api/register/paid` lykkes, lagre `{ subdomain, plan, sessionId, expiresAt }` i `localStorage` på frontend
2. Når `/platform/register` laster, sjekk:
   - Finnes verdier i localStorage?
   - Er tenanten fortsatt pending? (POST `/api/register/status?sub=...` — nytt lavnivå-endpoint)
   - Er sessionen fortsatt valid? (Stripe sessions varer i 24t)
3. Hvis ja → vis banner over registreringsskjemaet:
   - **"Du har en uavsluttet betaling for `<sub>` (utløper om X min)"**
   - Knapp 1: `[Fortsett til Stripe]` → ny endpoint `/api/register/resume` henter pending-tenant + Stripe customer + lager ny Checkout-session (uten nytt customer.create)
   - Knapp 2: `[Avbryt og start på nytt]` → eksisterende `/api/register/cancel`
4. Hvis ingen verdier i localStorage / utløpt → tøm storage, vis vanlig form

**Dekker:**
- Fane-lukking (sessionStorage ville mistet det — vi bruker localStorage)
- Browser-tilbake-pil
- Nettverks-feil under Stripe-redirect
- Bruker som returnerer fra mobil til desktop (samme browser-profile)

**Status:** Backlog. Logisk plassering etter Iter 12.5 (alle 3 scenarier i create-checkout) siden den nye `/api/register/resume`-endpointet sannsynligvis bør dele kode med 12.5.


