# Handoff til ny agent — Ko|Do Vault v4.3 oppstart

**Dato:** 2026-06-01
**Fra:** Tidligere agent (sesjon avsluttet etter v4.2.1 levert + v4.3 spec/utviklingsplan signert)
**Til:** Ny agent (fresh start, fresh context)
**Mottaker-bruker:** Michael Aagreen (Mike) — bygger av Ko|Do Vault
**Språk:** Norsk — Mike snakker norsk og du må svare på norsk

---

## ✅ STATUS 2026-06-01 — v4.2.1 LEVERT, v4.3 KLAR FOR IMPLEMENTASJON

v4.2.1 (Språkdrakt NO/SV/DA/EN) er bygget, testet (68/68 i18n-assertions grønne, TSC ren, Next prod-build grønn), pushet til Vercel og oversettelser er manuelt fylt inn av Mike. v4.3 spec + utviklingsplan er signert 2026-06-01 (se `/app/memory/v4.3 Spec.md` + `/app/memory/v4.3 Utviklingsplan.md`).

**Din oppgave:** Implementere v4.3 — kommersiell infrastruktur: B2C-registrering med trial og betaling, auto-provisjonering av subdomene + Upstash + Vercel, og livssyklus-håndtering dag 0–58.

---

## 0. ALLER FØRSTE STEG — Pull GitHub-repoet inn i /app

GitHub-repoet er **public**. Mike vil at du puller hele repoet inn i /app-strukturen slik at endringer kan saves tilbake via Emergent sin "Save to GitHub"-funksjon.

**Repo:** `github.com/meetmax-no/bankboks`

**Kommando (typisk):**
```bash
cd /app
git init 2>/dev/null || true
git remote add origin https://github.com/meetmax-no/bankboks.git
git fetch origin
git checkout -f main
```

Etter pull: verifiser at filstruktur matcher det som beskrives i §3 nedenfor. Hvis det er konflikter mellom pod-state og GitHub-state — **stol på GitHub**.

**Aldri kjør:** `git commit`, `git push`, `git reset --hard` på vegne av Mike. Han bruker Emergent sin "Save to GitHub"-knapp for write-operasjoner.

---

## 1. Hvem er Mike og hva bygger han

Mike bygger **Ko|Do Vault** — en sikker, web-basert vault for nordmenn, svensker, dansker og engelsktalende som vil samle passord, kort, ID-er og dokumenter ett sted med zero-knowledge-kryptering.

**Brand-filosofi:** «Lean Security · Not Security as a Service» (per kodovault.no).
**Selskap:** Me & Max AS — Stripe-utsteder for v4.3.

Tre urørlige prinsipper:
1. Du eier dataene dine (eksport alltid mulig, ingen vendor lock-in)
2. Zero-knowledge (master-passord forlater aldri Lars sin enhet)
3. 100% eller null (ingen «husk meg», ingen recovery-spørsmål)

**Versjons-status (per 2026-06-01):**
- v2.9 ✅ Passord-vault i prod
- v3.0 ✅ Bankkort med kamera i prod
- v4.0 ✅ Sikker overlevering (.kodoenc-pakker) i prod
- v4.1 ✅ ID-modul (Pass, Førerkort, ID-kort, Helse) i prod
- v4.2 ✅ Språkdrakt NO/SV/DA i prod (2026-05-28)
- v4.2.1 ✅ Engelsk lagt til (en.json, 🇬🇧, en-GB) (2026-06-01)
- **v4.3 ⏳ Registrering, betaling og auto-provisjonering — DIN OPPGAVE FRA DAG 1**
- v4.4 📅 Autentiseringsarkitektur — master-passord som identifikator (D-035)
- v4.5 📅 Lean Security som tjeneste — auto-deployment
- v5.0 📅 BYO Dokument-laget (Drive/Dropbox/USB)

---

## 2. Din konkrete oppgave — v4.3 Registrering & betaling

**Bygg v4.3 basert på `/app/memory/v4.3 Spec.md` og `/app/memory/v4.3 Utviklingsplan.md`.**

Spec'en er **signert av Mike 2026-06-01**. Du skal følge den ord for ord. Hvis du finner noe uklart — spør Mike før du implementerer.

### Hovedbeslutninger (urørlig)

- **Sentral platform-database** (egen Upstash-instans for `TenantRecord` — adskilt fra vault-blobs per tenant)
- **B2C-flyt:** Trial (gratis 30 dager) eller betalt fra dag 1 (månedlig 129 NOK / årlig 1 238 NOK)
- **B2B-flyt:** Mike oppretter enterprise-kunder manuelt via admin.kodovault.no med Stripe Invoicing
- **Auto-provisjonering:** Vercel API (opprett prosjekt + koble subdomene) + Upstash API (provisjoner instans)
- **Livssyklus-cron:** dag 25 varsel → dag 30 lock → dag 37 purring → dag 44 hard lukking → dag 51 sletter snart → dag 58 slett
- **Telegram for intern varsling** (primær) + Resend for e-post (transaksjonell + lifecycle)
- **Cloudflare Turnstile** for bot-filter + rate-limiting (maks 2 registreringer per IP per 24t)
- **Reserverte subdomener** + alle `*-admin` blokkert
- **Subdomene-validering:** a-z, 0-9, bindestrek, maks 30 tegn

### Arbeidsdeling (kritisk!)

**Du (agent / Emergent) skal:**
- Bygge all kode-infrastruktur (24+ iterasjoner per Utviklingsplan)
- Sentral Upstash-integrasjon for `TenantRecord`
- Registreringsskjema + sanntids subdomene-sjekk
- Stripe Checkout + webhook
- Vercel API + Upstash API for provisjonering
- Telegram + Resend integrasjoner
- Vercel Cron-jobs for livssyklus + cleanup-pending
- Admin-modul (gjenbruker `TenantViewer` fra Iter 1)

**Mike skal:**
- Opprette Stripe-konto for Me & Max AS + produkter + Stripe Tax (Iter 11)
- Opprette Cloudflare Turnstile-konto (Iter 5)
- Sette alle env-vars i Vercel (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TELEGRAM_*, RESEND_API_KEY, TURNSTILE_*, CENTRAL_UPSTASH_*)
- Opprette sin egen vault på `admin.kodovault.no` (Iter 0)
- Manuell Vercel-testing av hver flyt

### Iter-plan (Utviklingsplan har 24 iter, ~50t total)

Se `/app/memory/v4.3 Utviklingsplan.md` for full plan. Sammendrag:

| Fase | Iter | Mål |
|---|---|---|
| **0 Sikkerhet** | 0 | Admin-auth (`admin.kodovault.no` bak vault-session) |
| **1 Fundament** | 1–3 | Sentral Upstash + `TenantRecord` + admin-viewer + subdomene-validering + `/test` |
| **2 Registrering** | 4–6 | Registreringsskjema + Turnstile + rate-limiting |
| **3 Trial-flyt** | 7–10 | `/api/register` + Vercel-provisjonering + Upstash-provisjonering + komplett trial |
| **4 Betalt flyt** | 11–14 | Stripe-oppsett + `/api/register/paid` + webhook + provisjonerings-mellomside |
| **5 Varsling** | 15–16 | Telegram + Resend |
| **6 Livssyklus** | 17–19 | Cron lifecycle + cleanup-pending + betalingsvegg |
| **7 B2B foundation** | 20–21 | Admin-modul + B2B provisjonering |
| **8 Polish** | 22–24 | Feilsider + ende-til-ende test + `/start` produksjonsside |

### 🟡 Avhengigheter (kritisk rekkefølge)

Per Utviklingsplan §Avhengigheter:
- **Iter 0** må komme FØRST (alt under `/platform/admin/*` krever auth)
- **Iter 1** låser opp 2, 7, 8, 9, 20
- **Iter 2** låser opp 4, 7
- **Iter 11 (Stripe-oppsett)** er **Mike sin oppgave** — blokkerer Iter 12–14
- **Fase 1–7** må alle være ferdig før polish-fasen

### 🟡 Avklaringer som MÅ tas FØR Iter 0 starter

Tre ting som ikke er eksplisitt i spec'en, men som du må bekrefte med Mike i første samtale:

1. **DNS-arkitektur** — Spec'en antar `*.kodovault.no` wildcard DNS er konfigurert. Se DECISIONS.md D-040 (DNS-arkitektur bekreftet) for status. Bekreft med Mike at DNS faktisk er klar før Iter 0.
2. **Vercel-prosjekt-strategi** — Spec'en sier "opprett Vercel-prosjekt per tenant". Bekreft med Mike: ett prosjekt per kunde, eller delt prosjekt med wildcard-routing? D-040 bør gi svaret.
3. **Sentral Upstash-instans** — Mike må opprette dette og dele `CENTRAL_UPSTASH_URL` + `CENTRAL_UPSTASH_TOKEN` før Iter 1.

Spør disse FØR du begynner Iter 0.

---

## 3. Filstruktur og hvor du finner ting

### /app/memory/ — Sannhetskilden (alltid les disse FØRST)

| Fil | Hva |
|---|---|
| `PRD.md` | Original problem statement + Next Time-liste + v4.1/v4.2 leveranse-rapport |
| `ROADMAP.md` | Versjons-rekkefølge, persona-fortellinger |
| `DECISIONS.md` | Alle ADRer (D-001 til D-040). **D-039 = sentral platform-database. D-040 = DNS-arkitektur.** |
| **`v4.3 Spec.md`** | **DIN ARBEIDS-SPEC** — datamodell, flyter, sikkerhet, env-vars |
| **`v4.3 Utviklingsplan.md`** | **DIN ITER-PLAN** — 24 iterasjoner, hver ~2t, med avhengigheter |
| `v4.0-SPEC.md` | Sikker overlevering — historisk referanse |
| `v4.1-SPEC.md` | ID-modul — historisk referanse |
| `v4.2-PROGRESS.md` | Språkdrakt — historisk referanse |
| `i18n-CONVENTIONS.md` | i18n-konvensjoner (les hvis du legger til strenger) |
| `HANDOFF-v4.1.md`, `HANDOFF-v4.2.md` | Arkiverte handoffs |
| `v4.4-PRODUCT-FLYER.md/.html` | Markedsmateriell |
| `v4.5-DESIGN.md` | Pre-design for v4.5 (ikke din oppgave) |
| `v5.0-DESIGN.md` | Pre-design for v5.0 (ikke din oppgave) |
| `BUSINESS-CASE.md` | Mike sin budsjett-ramme |

### /app/frontend/ — Selve koden (Next.js)

Nye kataloger du vil opprette for v4.3:
```
app/
├── (vault)/              ← eksisterende vault — IKKE RØR
├── platform/             ← NY
│   ├── test/             ← Iter 3: /test
│   ├── register/         ← Iter 4-12: /register?plan=...
│   ├── provisioning/     ← Iter 14: /provisioning
│   ├── admin/            ← Iter 20: /platform/admin/* (bak auth fra Iter 0)
│   └── sub/              ← Iter 17+: provisjonerings-logikk
└── api/
    ├── vault/            ← eksisterende — IKKE RØR
    ├── register/         ← Iter 7
    ├── register/paid/    ← Iter 12
    ├── webhook/          ← Iter 13 (Stripe)
    ├── status/           ← Iter 14 (polling)
    ├── admin/
    │   └── create-enterprise/    ← Iter 21
    └── cron/
        ├── lifecycle/    ← Iter 17 (daglig kl. 02:00 UTC)
        └── cleanup-pending/  ← Iter 18 (hvert 30. min)

lib/
└── platform/             ← NY
    ├── tenant.ts         ← Iter 1: read/write/delete TenantRecord
    ├── subdomain.ts      ← Iter 2: reservert-liste + validering
    ├── turnstile.ts      ← Iter 5
    ├── rate-limit.ts     ← Iter 6
    ├── vercel-provision.ts   ← Iter 8
    ├── upstash-provision.ts  ← Iter 9
    ├── notify-telegram.ts    ← Iter 15
    └── notify-email.ts       ← Iter 16

components/platform/
└── TenantViewer.tsx      ← Iter 1 (gjenbrukes i Iter 20)

middleware.ts             ← Iter 0: admin.kodovault.no auth-gate
```

### Eksisterende filer du vil dra nytte av som mønster

| Fil | Hvorfor relevant |
|---|---|
| `lib/vault-sync.ts` | Mønster for Upstash-integrasjon |
| `lib/cards-sync.ts` | Mønster for kryptert blob read/write |
| `lib/crypto.ts` | AES-256-GCM helpers — bruk samme for sentral Upstash (kryptert TenantRecord) |
| `lib/i18n.ts` + `lib/locales/*.json` | i18n-systemet — alle nye strenger MÅ legges i alle 4 språk |
| `components/SettingsPanel.tsx` | Mønster for komplekse admin-paneler |
| `app/api/vault/route.ts` | Mønster for FastAPI/Next.js API-route med auth |

### data-testid på alle nye elementer

`TenantViewer` må ha `data-testid="tenant-viewer"`, hver rad `data-testid="tenant-row-<subdomain>"`. Registreringsskjemaet trenger testids på alle felter + CTA-knappen.

---

## 4. Hvordan Mike jobber (tone og forventninger)

- Mike er ikke amatør. Han har bygget Ko|Do solo i mange måneder. Spar ham for elementære forklaringer.
- Han snakker rett — hvis noe er feil, sier han det rett ut. Det er ikke fiendtlig, det er effektivt.
- **Norsk språk** alltid. Mike kan engelsk, men forventer norsk svar.
- Han stiller gode spørsmål — hvis han spør om noe, det er sannsynligvis et reelt design-problem han fanget opp. Ta det seriøst.
- Han bruker Vercel preview for E2E-testing (lokal pod mangler Upstash KV-keys + Stripe-keys).
- Han bruker manuelle "Save to GitHub" — DU SKAL ALDRI gjøre `git commit` eller `git push`.
- **Mike er prisbevisst.** Forrige sesjoner brukte ~$35-40 hver. Bruk Claude.ai direkte for strategi-arbeid hvis samtalen blir lang og kode-løs. Du brukes BEST til kode-bygging og testing.
- Mike sier "ferdig ferdig" — det betyr 100% ferdig. Ikke 95%. **Aldri si "ferdig" før du har bevis** (TSC + tester + build + manuell verifisering der mulig).
- Hvis Mike gjør strukturelle endringer i en feature — han forventer at du STOPPER og SPØR før du implementerer.

---

## 5. Tekniske premisser du må respektere

### D-001 Zero-knowledge (urørlig)
- **Vault-data** (passord, kort, ID-er) er fortsatt zero-knowledge — master-passord forlater aldri klienten
- **Platform-data** (`TenantRecord`) er IKKE zero-knowledge — Mike må kunne se kontaktinfo, fakturadata osv. for å støtte kundene
- Sentral Upstash krypteres AES-256-GCM på server-side (Mike eier nøkkelen)
- TenantRecord lagres aldri klient-side — kun server (sentral Upstash)
- Ved sletting (dag 58): vault-blob slettes umiddelbart, men `TenantRecord` beholdes i 2 år for regnskap

### D-031 B-modellen (farge-koding — uendret)
- **blue** = primær (Lagre, OK, CTA-knapper)
- **orange** = ID-er (v4.1)
- **violet** = Kort / Lab
- **emerald** = Pakker (v4.0)
- **amber** = Warnings (registreringsskjema-CTA — per v4.3 Utviklingsplan Iter 4)
- **rose** = Slett/feil

Platform-UI bør bruke samme tema-tokens som vault for visuell konsistens.

### D-036 i18n (urørlig)
- Alle brukervendte strenger i v4.3 MÅ gå gjennom `t()`
- Legg nye nøkler i `lib/locales/no.json` først, deretter `sv.json` / `da.json` / `en.json`
- Bruk `_section_new_keys`-blokken nederst i hver fil for nye strenger
- Se `/app/memory/i18n-CONVENTIONS.md` for full konvensjon

### D-039 Sentral platform-database
- Egen Upstash-instans, IKKE blandet med tenant-vault-blobs
- Krypteres AES-256-GCM
- `TenantRecord` lagres her — én record per kunde

### D-040 DNS-arkitektur
- `*.kodovault.no` wildcard CNAME → Vercel
- Per-tenant subdomene kobles via Vercel API
- Bekreft med Mike at DNS er konfigurert FØR Iter 0

### Multi-tenant-arkitektur
- Tenant-config i `/app/frontend/public/clients/<subdomain>.json` (generert automatisk ved registrering)
- For v4.3: konfig genereres ved Iter 7 (trial) / Iter 13 (webhook)
- Hver konfig spesifiserer features tenant har tilgang til (alle aktivert som default i v4.3)

### Glass-arkitektur (D-022/D-023)
- Alle modaler MÅ ha `.backdrop-blur-xl`
- Registreringsskjema bruker mørk bakgrunn med amber CTA (per spec §10 Skjerm 2/3)

### data-testid på alt
Hver interaktive element MÅ ha `data-testid="kebab-case-name"`.

### Upstash + Stripe + Vercel API
- Vi bruker IKKE MongoDB. Vi bruker Upstash Redis-kompatibel KV-store.
- Stripe-integrasjon krever `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` i Vercel env-vars
- Vercel API krever PAT (Personal Access Token) — Mike må generere og dele
- Upstash API krever account API-key — Mike må generere og dele

### Sikkerhet (per spec §11)
- Cloudflare Turnstile på `/register`
- Rate-limit: 2 reg. per IP per 24t (sentral Upstash, TTL 24h)
- Stripe webhook-signatur verifiseres FØR all behandling
- Admin-rute kun fra `admin.kodovault.no` + gyldig vault-session
- Sentral Upstash kryptert AES-256-GCM

---

## 6. Hva er klart / hva mangler

### v4.2.1 (Språkdrakt) status
- ✅ I prod på Vercel
- ✅ 4 språk: NO/SV/DA/EN (749 entries hver, byte-likt synket)
- ✅ 68/68 i18n-assertions grønne, TSC ren, Next prod-build grønn
- ✅ APP_VERSION = `v4.2.1`, `package.json` = `4.2.1`
- ✅ `_section_new_keys`-blokk-system for nye strenger
- ✅ Auto-detect via `navigator.language` + `LocalePromptToast`

### v4.3 (din oppgave) status
- 🟢 Spec signert (`/app/memory/v4.3 Spec.md`)
- 🟢 Utviklingsplan signert (`/app/memory/v4.3 Utviklingsplan.md`)
- 🟢 D-039 + D-040 dokumentert i `DECISIONS.md`
- 🟢 Tom struktur klar — ingen kode skrevet ennå
- ⬜ Iter 0–24: IKKE STARTET

### Manglende eksterne avhengigheter (Mike må sette opp)
- ⬜ Sentral Upstash-instans (Iter 1)
- ⬜ Cloudflare Turnstile-konto (Iter 5)
- ⬜ Stripe-konto for Me & Max AS + produkter + Tax (Iter 11)
- ⬜ Telegram Bot + chat ID (Iter 15)
- ⬜ Resend-konto + API-key (Iter 16)
- ⬜ Vercel API PAT
- ⬜ Upstash API account-key
- ⬜ DNS `*.kodovault.no` wildcard konfigurert (D-040)
- ⬜ `admin.kodovault.no` lagt til i `kodo-vault.vercel.app` (Iter 0)

---

## 7. Plan for første samtale med Mike

Når Mike åpner sesjonen, må du:

1. **Hilse på norsk**
2. **Bekreft at du har lest dette handoff-dokumentet**
3. **Bekreft at GitHub er pullet** (eller spør om bekreftelse)
4. **Bekreft at du har lest `v4.3 Spec.md` + `v4.3 Utviklingsplan.md`**
5. **Be Mike bekrefte de tre forutsetningene** (DNS-arkitektur, Vercel-prosjekt-strategi, sentral Upstash klar)
6. **Foreslå å starte med Iter 0** (admin-auth) med en kort plan

**Eksempel åpnings-melding:**

> Hei Mike! Jeg har lest handoff-v4.3, pullet GitHub-repoet, og gått gjennom v4.3 Spec.md + Utviklingsplan.md.
>
> Før jeg starter Iter 0, må jeg bekrefte tre ting med deg:
>
> 1. **DNS:** Er `*.kodovault.no` wildcard CNAME konfigurert? (D-040)
> 2. **Sentral Upstash:** Har du opprettet platform-database-instansen? Trenger `CENTRAL_UPSTASH_URL` + `CENTRAL_UPSTASH_TOKEN`.
> 3. **admin.kodovault.no:** Har du lagt subdomenet til `kodo-vault.vercel.app` allerede?
>
> Når disse er på plass kan jeg starte Iter 0 (`middleware.ts` for admin-auth).
> Estimat for Iter 0: ~2 timer. Skal jeg gå i gang?

---

## 8. Faner i hodet (kontekst Mike refererer til)

- **«Lars»** = persona-navn for typisk Ko|Do-bruker (norsk advokat). Brand-tegn, ikke språk-element.
- **«Lisbeth»** = svensk persona (advokat i Stockholm)
- **«Anna»** = mottaker av kryptert pakke (v4.0) eller B2C-kunde-persona (v4.3)
- **«Terje»** = B2C trial-kunde — eksempel-subdomene `terje.kodovault.no`
- **«D-XX»** = ADR (Architecture Decision Record) i `DECISIONS.md`. **D-039 = sentral platform-DB. D-040 = DNS.**
- **«B-modellen»** = D-031 farge-koding-strategi
- **«Lean Security»** = Mike sin brand-filosofi
- **«Me & Max AS»** = Mike sitt selskap (Stripe-utsteder for v4.3)
- **«am-admin»** = eksempel-prefiks for B2B enterprise-admin-subdomene
- **«kodo-vault.vercel.app»** = Mike sitt master Vercel-prosjekt (admin.kodovault.no peker hit)

---

## 9. Vanlige fallgruver (unngå)

1. **Ikke ta screenshot etter hver endring.** Implementer en hel iterasjon, kjør lint+tsc, så ETT screenshot for smoke-test.
2. **Ikke restart supervisor unødvendig.** Frontend har hot reload. Backend autorestarter ved kode-endring.
3. **Ikke skriv om filer med `create_file overwrite=True`** — bruk alltid `search_replace` på eksisterende filer.
4. **Ikke hardcode strenger** — alle brukervendte strenger gjennom `t()` (D-036). Se `i18n-CONVENTIONS.md`.
5. **Ikke bland `TenantRecord` med vault-blobs.** Sentral Upstash er adskilt (D-039).
6. **Ikke skip Iter 0** — admin-auth må komme først, ellers er hele `/platform/admin/*` åpent for alle.
7. **Ikke implementer Stripe-flyt før Mike har bekreftet Stripe-konto + produkter er klar** (Iter 11 = Mike sin oppgave).
8. **Ikke ta snarveier på Turnstile.** Bot-filter er kritisk for å unngå spam-registreringer.
9. **Ikke kall Vercel/Upstash API uten retry-logikk** — spec §8 krever 3 forsøk med 60s mellomrom.
10. **Ikke send mail uten å respektere `emailPreferences.lifecycle`** — lifecycle-mails er opt-out.
11. **Ikke be Mike om å "rydde cache"** eller "prøve inkognito" som auth-bug-fix.
12. **Ikke fall i screenshot-loop** — implementer batch, ÉTT screenshot, så testing agent.
13. **Aldri si "ferdig" før TSC + tester + manuell verifisering har vist det.** Mike har lav toleranse for premature "ferdig"-meldinger.

---

## 10. Hva du KAN bruke testing agent til

For v4.3 vil testing agent være kritisk etter hver fase:

- **Etter Iter 1–3 (Fundament):** Verifiser TenantViewer CRUD + subdomene-validering
- **Etter Iter 4–6 (Registrering UI):** Verifiser registreringsskjema + Turnstile + rate-limiting
- **Etter Iter 7–10 (Trial-flyt):** Ende-til-ende trial-registrering på Vercel preview
- **Etter Iter 11–14 (Betalt flyt):** Stripe CLI for webhook-testing lokalt + Vercel preview for full flyt
- **Etter Iter 17–19 (Livssyklus):** Manipuler `createdAt` og kjør cron manuelt
- **Etter Iter 22–23 (Polish):** Komplett ende-til-ende test for alle flyter

Mike bruker primært Vercel preview for E2E. Testing agent for lokal smoke-testing før Mike får siste push.

---

## 11. Hvis du oppdager at noe i spec'en er feil

Si fra med en gang. Mike er åpen for å justere, men v4.3 Spec er nylig signert — endringer krever ny diskusjon. Eksempel:

> «Jeg ser at spec §5 FLYT 2 sier "Skriv TenantRecord etter webhook", men hvis webhook aldri kommer (Stripe-feil etter Checkout success) — har vi ikke registrert kunden noe sted? Forslår å skrive `TenantRecord { status: "pending" }` ved `/api/register/paid` og oppdatere til `active` i webhook. Vil ha din OK før jeg implementerer.»

Det er BEDRE å spørre 1 minutt enn å bruke 1 time på å implementere noe Mike ikke ville ha.

---

## 12. Sluttord

v4.2.1 ga oss skandinavisk + engelsk språkdrakt. v4.3 åpner kommersiell drift — ekte betalende kunder, auto-provisjonering, livssyklus. Det er den største enkelt-versjonen til nå (24 iter, ~50t), og den krever disiplin på avhengigheter (Iter 0 → Iter 1 → resten).

Hver iterasjon må kunne testes isolert. Hvis du ikke kan teste den isolert, har du gjort den for stor — bryt den ned.

Vær respektfull av tiden hans, vær konkret, vær på norsk, og **les `v4.3 Spec.md` + `v4.3 Utviklingsplan.md` før du gjør noe**.

Lykke til. 🛡️💳🌐

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

# i18n test (skal være 68/68 grønne)
cd /app/frontend && npx tsx lib/__tests__/i18n.test.ts

# Ruff backend lint
cd /app && python -m ruff check backend/

# Pull v4.3 spec og utviklingsplan hvis ikke synlig
curl -sf -o "/app/memory/v4.3 Spec.md" "https://raw.githubusercontent.com/meetmax-no/bankboks/refs/heads/main/memory/v4.3%20Spec.md"
curl -sf -o "/app/memory/v4.3 Utviklingsplan.md" "https://raw.githubusercontent.com/meetmax-no/bankboks/refs/heads/main/memory/v4.3%20Utviklingsplan.md"

# Vercel deploy URL
# https://kodo-vault.vercel.app
# admin.kodovault.no (etter Iter 0)
```

---

**Filen ligger i `/app/memory/HANDOFF-v4.3.md` for referanse.**
