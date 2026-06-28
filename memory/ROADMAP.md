# Ko|Do · Vault — Roadmap

**Hva er dette?** Den fremtidige planen — hva som kommer etter v2.9.5 (som er i prod). Hver versjon har en **fortelling** ("Lars sin dag med...") som beskriver brukeropplevelsen, og en teknisk skisse.

**Sentrale beslutninger som styrer denne roadmap'en:**
- 🔒 [D-001 100% North Star](DECISIONS.md#d-001-100-eller-95--north-star) — Sikkerhet er aldri 95%
- 👤 [D-005 Advokat som primær persona](DECISIONS.md#d-005-uc-3a-advokat-som-primær-persona) — Lars (fiktiv HR-advokat-persona)
- 📋 [D-008 Dokumentasjon-arkitektur](DECISIONS.md#d-008-dokumentasjon-arkitektur) — PRD/ROADMAP/DECISIONS

---

## 🚧 PRE-LAUNCH BLOCKERS (må fikses før prod-launch)

### P1-PRE-LAUNCH-A — API-lag PII-redaktering for B2B-children (D-078 håndhevelse)
**Status:** ⏳ Backlog (Mike 2026-06-28: "OK nå i testing, men IKKE når vi går live")

**Problem:** D-100 skjuler PII i UI-laget, men `GET /api/admin/tenants` returnerer fortsatt full data (firstName, lastName, email, billingDetails) for B2B-children til super-admin-rollen. Det betyr at en kompromittert Super-admin-session, eller en bug i UI-rendering, kan eksponere kundenes employee-PII. D-078 krever en arkitektonisk grense — UI-filter alene er ikke nok når vi går live.

**Foreslått tilnærming (Mike's idé):**
1. Default: `GET /api/admin/tenants` redakterer alle B2B-child-PII-felter til null/`[REDACTED]` for `kodo_admin_session`-rollen (Mike super-admin). Org-metadata (subdomain, status, plan, parentTenant, createdAt) returneres som før.
2. Når Mike trenger ekte data for support-formål: et eksplisitt "Vis PII"-verktøy som krever:
   - En tekst-forklaring fra Mike om HVORFOR (eks. "Kunde har bedt om hjelp med ansatt sin glemt-MPW-reset")
   - Logger handlingen til en audit-stream: `audit-log:super-admin-pii-access:<timestamp>` med `{adminId, tenantSubdomain, reason, ip, userAgent}`
   - Returnerer PII med en bekreftelses-banner: "Audit-logget: PII-tilgang for support"
3. Visning av audit-loggen i en egen Konsoll-fane: "Super-admin tilganger" — Mike kan selv se sin egen logg, og evt. dele med tilsynsmyndighet.

**Tekniske komponenter:**
- API-laget: legg til `redactB2BChildPII()`-helper som kalles for alle B2B-child-objekter før response. Identifisert via `tenant.parentTenant !== null`.
- Nytt endpoint: `POST /api/admin/tenants/[subdomain]/reveal-pii` med body `{ reason: string }`. Krever super-admin-rolle, validerer reason ≥ 20 tegn, logger til audit-stream, returnerer full data + en `auditId` til frontend.
- Audit-store: Upstash-list per måned (`audit-log:super-admin-pii-access:2026-07` osv.), TTL 1 år (GDPR-compliance).
- Frontend: erstatt direkte rendering av `tn.email` osv. med en "Vis PII"-knapp som åpner modal med reason-felt + bekreftelse.

**Implementasjons-rekkefølge:**
1. API-redaktering (≈ 1 dag) — `lib/server/pii-redact.ts` + integrasjon i `app/api/admin/tenants/route.ts` + `[subdomain]/route.ts`
2. Audit-store (≈ ½ dag) — `lib/platform/audit-log-store.ts`
3. Reveal-endpoint (≈ ½ dag) — `app/api/admin/tenants/[subdomain]/reveal-pii/route.ts`
4. Frontend "Vis PII"-modal + audit-fane (≈ 1 dag)
5. Sikkerhets-tester (≈ ½ dag) — 10+ assertions

**Total estimat:** ~3.5 dager.

**Blokkere:** Ingen. Kan startes når vi nærmer oss launch.

---



## 🌳 Kart over prosjektet

```
KO|DO · VAULT
│
├─ 🪵 STAMME (kjernen — alt henger her)
│  │
│  ├─ v2.9.5 ✅ I PROD
│  │   • Passord-oppføringer i Upstash, Master-passord, WebAuthn/Touch ID, auto-lås
│  │   • Backup eksport/import, server-side event log, rate-limit, Passord-lab
│  │   • Mobile bottom-bar, network status, refresh
│  │   • v2.9: Clipboard 120s + manuell slett-knapp + "tett skip"-modus
│  │   • v2.9.5: Liste/Gruppert-toggle + inline-søk på desktop
│  │
│  ├─ v3.0 ✅ I PROD — Cards (Blob 2)
│  │   • Iter 1 ✅: Datamodell + krypto + /api/cards + useCards + Passord/Kort-toggle
│  │   • Iter 2 ✅: CardModal med D-015 felt-spec + CRUD + click-to-call/url
│  │   • Iter 3 ✅: Custom kamera-fangst (D-014/D-020) — getUserMedia, ALDRI Camera Roll
│  │   • Iter 3.5 ✅: Manuell crop (CardCropper) — react-image-crop, valgfri "Finjuster"-knapp
│  │   • Iter 4 ✅: Bilde-komprimering (D-016) — JPEG/WEBP, clamp, config-styrt
│  │   • Iter 5 ✅: Backup v2 (vault+cards), Cmd+K-søk dekker begge, Liste/Gruppert for kort,
│  │                ui.passwordsViewMode + ui.cardsViewMode i default.json (D-018)
│  │
│  ├─ v3.0.5 ✅ FERDIG (klar for prod) — Selektiv backup + smart re-kryptering (2026-02-15)
│  │   • Backup henter alltid fra Upstash (ikke RAM) — kanonisk speil av server
│  │   • Selektiv eksport/import via BackupExportModal/BackupImportModal
│  │   • Backup-format v3 (`blobs`-map) + bakoverkomp på v2-filer
│  │   • BackupBlobSource-registry → fremtidssikker for v3.2 ID-er, v4.5 dokumenter
│  │   • Smart re-kryptering ved pwd-mismatch: backup re-krypteres med dagens MPO
│  │   • To-trinns pwd-flow med tydelig melding når backup-pwd ≠ dagens MPO
│  │
│  ├─ v3.0.6 ✅ FERDIG (klar for prod) — Polish (2026-02-16)
│  │   • Bug-fix: Cards-fane oppdateres umiddelbart etter selektiv kort-import
│  │     (re-derive session direkte i applyImportedPayload — ingen "henging" i idle-state)
│  │   • UX: Eye-toggle på begge MPO-felt i BackupImportModal
│  │
│  ├─ v3.0.7 ✅ I PROD — Multi-tenant + login-personalisering (2026-05-18)
│  │   • Multi-tenant: `default-lk.json` (Lisbeth E. Krogh) opprettet som første ekstra tenant
│  │   • Login-strip: "— For {client} —" vises over login-kortet (subtil personlig hilsen)
│  │   • Footer-fix: Bruker `createdBy` (Ko | Do Consult) i stedet for `client`
│  │     — semantisk modell nå klar: `client` = hvem appen er for, `createdBy` = leverandør
│  │   • Kategori-oppdatering: "Jobb" erstattet av "Utvikling" (key beholdt for å unngå data-mismatch)
│  │   • DEPLOYMENT.md opprettet — full guide for Vercel + Upstash + DNS multi-tenant
│  │
│  ├─ v3.1.0 ✅ FERDIG (klar for prod) — Per-browser glass-arkitektur (Safari-fix, 2026-02)
│  │   • Problem: Safari rendret glass-kort nesten transparent (hvit tekst uleselig) vs Chrome
│  │   • Rotårsak: Safari single-pass box-blur er ~3-5x svakere enn Chromiums multi-pass gaussian
│  │   • Løsning: Per-browser JSON-config — `cardBgChrome`/`cardBgSafari`,
│  │     `backdropBlurChrome`/`backdropBlurSafari`, `bgImageOverlay`
│  │   • Ny `useIsSafari`-hook (UA-detection) → setter CSS-variabler på `:root` klient-side
│  │   • Chrome: lett glass (`rgba(255,255,255,0.10)` + 24px blur) — glassmorfisme bevart
│  │   • Safari: tilnærmet solid mørk slate (`rgba(30,41,59,0.90)` + 48px blur) — lesbarhet garantert
│  │   • Begge tenants oppdatert (`default.json` + `default-lk.json`)
│  │   • Opprydding: `.gitignore` 843 → 93 linjer (fjernet 750 duplikat-linjer)
│  │   • Beslutning dokumentert i D-023 (bygger på D-022 DOM-fix)
│  │   ⏭ NESTE: v4.0 ferdig (sikker overlevering, klar 2026-02) → v4.1 (ID-blob) → v4.2 (2FA TOTP)
│  │
│  ├─ www.kodovault.no ✅ FLYTTET UT (2026-05-05) — Landing page
│  │   • Eget GitHub-repo `meetmax-no/bankboks-page` (separat Emergent-job)
│  │   • Eget Vercel-prosjekt
│  │   • Domener: `kodovault.no` + `www.kodovault.no` (DNS pågår)
│  │   • Stack: Next.js 15 + Resend (Audience + welcome-mail w/ BCC)
│  │   • IKKE i denne kodebasen lenger — ingen referanser i /app/frontend/
│  │
├─ 🌳 GREN 1: v4.0 ✅ I PROD (2026-02) — Sikker overlevering
│   • Engangs-pakker (.kodoenc)
│   • 1 mottaker, 1 master-key, ingen expiry (D-003)
│   • Mottaker uten konto, ingen Ko|Do-server
│   • Bygger pakke-format som v5.0 (dokument-laget) gjenbruker
│   • 💡 Stor del av pakke-flyten (validate pwd → decrypt → re-encrypt) allerede bygget i v3.0.5
│
├─ v4.1 ✅ I PROD (2026-05-26) — Blob 3 (ID-er) 🆔
│   • `vault:default:ids` — Pass, Førerkort, ID-kort, Helse/forsikring (4 ID-typer)
│   • 0–3 vedlegg per ID (brukervalgt antall), Pass auto-utløp +10 år
│   • Klassisk Word-stil diagonal "KOPI"-vannmerke ved eksport (D-034)
│   • Cmd+K søker også ID-er + fix av v3.0-bug (cards-søk uten Kort-fane-åpning)
│   • Streng substring-matching i Cmd+K (ikke fuzzy) — Mike-feedback 2026-05-26
│   • Egen Upstash-blob, samme master-pwd, egen salt (D-033)
│
├─ v4.2 ✅ **FERDIG (2026-05-28)** — Språkdrakt NO/SV/DA (tidligere v4.3, fremskyndet 2026-05-26)
│   • ✅ UI-strenger i 3 språk: NO (referanse, 748 nøkler + `_section_new_keys`-separator), SV+DA byte-likt synket
│   • ✅ Egen lett i18n — t()/tHook()/translate() + JSON-ordbøker, ingen dependencies (D-036)
│   • ✅ Flagg i AppHeader (🇳🇴 🇸🇪 🇩🇰), locale i localStorage, ingen URL-routing
│   • ✅ Tenant-default-locale via `clients/*.json`
│   • ✅ Auto-detect via navigator.language → diskret bunn-toast ved første besøk (sv/da)
│   • ✅ Locale-aware datoer: lib/format-date.ts (kortform per locale + æ/ø/å-sortering)
│   • ✅ 63/63 i18n-test assertions grønne · TSC ren · build grønn
│   • 📋 Definitiv konvensjon-guide for fremtidige agenter: `/app/memory/i18n-CONVENTIONS.md`
│   • 🟢 Gjenstår: Mike fyller inn SV/DA-verdier manuelt (ikke kode-arbeid)
│
├─ v4.3 ❌ ETTER v4.2 — Betalingsløsning (Stripe / Me & Max AS) (NY 2026-05-26)
│   • Pris: 129 kr/mnd, 30 dagers gratis prøveperiode
│   • Én plan, full funksjonalitet
│   • Fakturering: Me & Max AS via Stripe
│   • Forutsetning før kommersiell skalering — må på plass før auto-deployment
│   • Tidligere skissert som v5.0-territorium; løftet hit fordi penger må strømme før vi skalerer
│
├─ v4.4 ❌ ETTER v4.3 — Autentiseringsarkitektur (NY 2026-05-26 — kritisk)
│   • Master-passord SOM identifikator (Alternativ A)
│   • Ingen e-post i auth-flow — det bryter WebAuthn PRF + Touch ID
│   • Avklarer multi-tenant-identitet uten å introdusere PII Lean Security ikke trenger
│   • Må være på plass FØR v4.5 (auto-deployment) — uten dette skalerer vi ikke trygt
│   • Detaljer åpne — egen design-runde med Mike før implementasjon
│
├─ 🌳 GREN 2: v4.5 ❌ Lean Security som tjeneste — auto-deployment (tidligere v5.0, løftet 2026-05-26)
│   • Automatisk deployment til nye kunder (self-serve onboarding)
│   • Prismodell for hosted Lean Security (kjernen lagt i v4.3)
│   • Multi-tenant skalert: ett Vercel-prosjekt per kunde, en config-fil i KoDo-Editor
│   • Brand-fortelling: "Lean Security · Not Security as a Service" (per kodovault.no)
│   • Forutsetning: v4.3 (penger) + v4.4 (auth) må være ferdig
│
├─ 🌳 GREN 3: v5.0 ❌ BYO Dokument-laget (tidligere v4.5, flyttet ned 2026-05-26)
│   • BYO Drive / Dropbox / lokal USB (per kodovault.no)
│   • Notater, dokumenter, PDF, Word
│   • "Lukket sikker zone" med inn/utgang (D-006)
│   • Pre-design skisse: `/app/memory/v4.5-DESIGN.md` (klar 2026-02, fortsatt gyldig)
│   • Stort scope — avhenger av at kjernen er moden og kommersielt validert (v4.5 først)
│
├─ vX 🟡 NICE-TO-HAVE — 2FA TOTP integrert i passord (degradert 2026-05-26)
│   • Live 6-sifret kode i passord-oppføringen (RFC 6238)
│   • QR-scanner + manuell seed-input — erstatter Google Authenticator (D-010)
│   • Bygges KUN hvis etterspurt av brukere — målgruppen (advokater/konsulenter)
│     kjenner ikke begrepet og det er ikke et salgsargument i fase 1
│   • Tidligere planlagt som v4.2/v4.4 — degradert fordi business-prioritet trumfer
│
├─ vY ❌ Soft-deliverable — Two-pager produkt-flyer (uendret status)
│   • IKKE en kode-versjon — markedsmateriell
│   • Brukes når Mike snakker med potensielle kunder
│   • Filer: /app/memory/vY-PRODUCT-FLYER.md (kilde) + .html (utskrifts-klar)
│   • Skal speile Lean Security-prinsippene, ikke overlove fremtidige versjoner
│
└─ 🌿 KVIST: vX.X — Smart Topp 10 (Nice-to-Do, beslutning åpen)
│   • Tredje view-modus ved siden av Liste/Gruppert: 🔥 Topp 10
│   • Cross-device via egen kryptert Upstash-blob (`vault:default:usage`)
│   • Eksponentiell decay-scoring (halveringstid 14d default)
│   • Bygges KUN når Mike eller Lars eksplisitt savner det
│   • Detaljer: D-019 + egen seksjon nedenfor
│
└─ 🌿 KVIST: vX — Journalist-modus (kanskje aldri)
    • Decoy mode, self-destruct, Tor-kompat
    • Krever helt andre features enn advokat-persona
    • Holdes utenfor stamme-arkitekturen for ikke å smitte
```

---

## 💰 Kommersielle parametre (besluttet 2026-05-26)

Fanget her som single source of truth for v4.3 (betalingsløsning) og v4.5 (auto-deployment).

| Parameter | Verdi |
|---|---|
| **Pris** | 129 kr/mnd |
| **Prøveperiode** | 30 dager gratis |
| **Plan-struktur** | Én plan, full funksjonalitet (ingen tiers, ingen feature-gating) |
| **Fakturering** | Me & Max AS via Stripe |
| **Marked fase 1** | Skandinavia (NO/SV/DA) |
| **Marked fase 2** | EN/internasjonalt vurderes etter skandinavisk validering |
| **Onboarding** | Self-serve via auto-deployment (v4.5) — én config-fil per kunde |
| **Auth-modell** | Master-passord som identifikator (Alternativ A, v4.4) — ingen e-post |

### Hvorfor "én plan, full funksjonalitet"

Lean Security-prinsippet sier: ikke bygg et økosystem av 47 features for å rettferdiggjøre evigvarende abonnement. Det betyr motsatt på pris-modellen også — ikke segmenter brukerne i Basic/Pro/Enterprise hvor 60% av brukerne får 30% av verdien. Én pris, full vault, full ID-modul, full sikker overlevering. Når dokument-laget (v5.0) kommer, blir det også del av samme plan — ikke et "Plus"-tier.

### Hvorfor 129 kr/mnd

- Posisjonert mellom 1Password Personal (~95 kr/mnd) og NordPass Premium (~50 kr/mnd) men under enterprise-løsninger
- Nok marginal til at Lean Security kan operere uten salgsteam, supportteam, eller marketing-byrå
- Lar Mike fokusere på produkt, ikke prismodell-eksperimenter
- 30-dagers prøve gir Lars (advokaten) full tid til å migrere fra eksisterende løsning før commitment

### Hvorfor Stripe under Me & Max AS

- Norsk MVA-håndtering ut-av-boksen
- Skandinavisk fakturering (EUR/NOK/SEK/DKK) støttet
- Subscription-management med 30-dagers gratis prøve er standard Stripe-funksjonalitet
- Mike eier Me & Max AS allerede — ingen ny juridisk entitet nødvendig

### Hvorfor markedsekvensiering NO → SE/DK → EN

| Fase | Marked | Begrunnelse |
|---|---|---|
| 1 (nå) | NO | Mike snakker norsk, Lars-persona er norsk, første kundenett er norsk |
| 2 (v4.2) | NO + SE + DK | Skandinavisk forretningskultur er likt nok — samme produktforståelse |
| 3 (TBD) | + EN | Internasjonalisering først når skandinavisk validering er konkret (X kunder, Y NPS) |

EN/internasjonalt forblir på roadmap MEN ikke før skandinavisk-fasen har gitt målbart resultat. Vi over-utvider ikke før produktet beviser seg lokalt.

---

## 📋 Next Time — Ideer parkert til etter v4.0

**Disse skal IKKE blokkere v4.0 (sikker overlevering).** De vurderes for senere patch-releases når de er relevante for Lars/Mike i daglig bruk. Ingen er i aktiv backlog.

- 🖼 **Bilde-rotasjon i CardCropper** — slider ±10° (fin-justering) + 90°/180°-knapper. Nyttig hvis kortet fanges på siden eller skjevt i kameraet.
- 📱 **Mobil bottom-bar Cards-tab ikon** — eget ikon for raskere bytte mellom Passord og Kort på mobil.
- 📜 **Event-log oppføringer for kort-operasjoner** — "Kort lagt til", "Kort slettet", "Kort redigert" på lik linje med passord-events.
- 🎛 **Tenant feature toggles i `default.json`** — `featureFlags.passwords` / `featureFlags.cards` for å skjule/deaktivere hele blob-typer pr tenant.
- 📦 **Forhåndsvarsel ved import** — vis "Server har 5 kort, backup har 3 kort — etter import: 3 kort" før push (krever decrypt av server-blob i tillegg til backup).
- 🔍 **Konfig-validering** — JSON-schema for `default.json` med tydelig feilmelding hvis felt mangler eller har feil type.

**Kriterium for å løfte fra Next Time → backlog:** Mike eller Lars sier eksplisitt "denne mangler i daglig bruk". Inntil da: parkert.

---

## 🔭 P2 Backlog — arkitektur-forbedringer (post-Iter 20.9)

**Disse er ikke blokkerende, men forbedrer kodebasen langsiktig.**

### P2 · Ekte stabil `orgId` (UUID) på TenantRecord — kandidat for v5.x

**Status:** parkert per Mike's spec 2026-06-28 (D-095 fork-decision).

**Problemstilling:** Alle koblinger mellom OrgAdmin/InviteRecord/MPW/Notes ↔ B2B-parent baseres på `tenantPrefix` (string) + en `parentTenantCreatedAt`-snapshot (D-095). Det er ingen ekte foreign key. Konsekvensen er at vi må håndtere "orphan"-tilstander imperativt:

- `parent_missing` — parent slettet permanent
- `link_broken` — parent slettet OG re-opprettet (createdAt-mismatch)
- `link_missing` — legacy fra før D-095

**Forslag:** Introdusér `orgId: string` (UUID) på TenantRecord ved opprettelse. Alle child-records refererer til `orgId` i stedet for prefix. Slett + re-opprett av B2B-parent = ny `orgId` → orphan-deteksjon blir trivial boolsk match, ingen `parentTenantCreatedAt`-snapshot trengs.

**Hvorfor utsatt:** D-095 (snapshot-FK) løser 95% av use-casene med <100 linjer kode + en idempotent migrering. Full `orgId`-refaktor er ~300 linjer + breaking-change i API/DTO-er. Best å vente til:
1. Iter 20.9 er stabilt i prod og vi har data fra reelle B2B-kunder
2. Vi får en konkret motivasjon (f.eks. cross-org-features, audit-eksport, GDPR-rapportering der `orgId` trengs som stabil identifier uansett)

**Estimat:** 2–3 dager full refaktor inkl. migrasjon.

---

## ✅ v4.1 — ID-blob 🆔 (FERDIG i prod 2026-05-26)

**Status:** ✅ I PROD. Lansert 2026-05-26 etter 5 iterasjoner + Mike-fanget revisjoner.

**Komplett leveranse-rapport:** Se [`PRD.md` § v4.1.0](PRD.md) for Iter 1–5 historikk.
**Arkitektur-beslutninger:** [D-033](DECISIONS.md#d-033-id-modul-som-egen-upstash-blob-v41) (ID-blob arkitektur) og [D-034](DECISIONS.md#d-034-vannmerke-eksport-av-id-bilder--klient-side-canvas-v41) (vannmerke-eksport).

### Hva ble levert

- 4 ID-typer: 🛂 Pass, 🚗 Førerkort, 🆔 ID-kort, 🏥 Helse/forsikring
- 0–3 vedlegg per ID (brukervalgt antall, Mike-utvidelse 2026-02)
- Pass auto-utløp +10 år (auto-fyll ved utstedt-dato)
- Klassisk Word-stil diagonal "KOPI"-vannmerke ved eksport (Mike-revisjon 2026-05-26 etter "harry"-feedback på opprinnelig rødt bånd)
- Cmd+K søker også ID-er med streng substring-matching (etter Mike-feedback 2026-05-26)
- Cmd+K trigger lazy-fetch av ALLE blobs (cards + ids) — fikset også eksisterende v3.0-bug der cards ikke var søkbar uten Kort-fane-åpning
- Migrering: transparent konvertering fra singular `attachment` til `attachments[]` ved decrypt

### Persona-bekreftet i bruk (Lars sin v4.1-flyt)

> *"08:30. Lars logger inn med Touch ID. Vault låser opp.*
>
> *11:45. På legen — trenger å vise helsetrygdekort. Cmd+K → 'helse' → 🏥 Helsetrygdekort NAV dukker opp øverst. Klikker. Bildet er der. Viser legen telefonen.*
>
> *14:00. Klient ber om kopi av førerkort som bevis på identitet. Lars åpner førerkortet, klikker 'KOPI' på forside-bildet → JPG med diagonal 'K O P I' + dato lastes ned. Sender via SMS.*
>
> *Han har 4 ID-er totalt: pass, førerkort (forside+bakside), ID-kort, og reiseforsikring.*
> *Total ID-blob: 3,8 MB. Lazy-loaded ved første klikk på 🆔-fanen i sesjonen."*

### Hvor problem-spørsmålene fra planlegging ble løst

| Original spørsmål | Løsning |
|---|---|
| Maks foto-størrelse per ID? | 1 MB hard per vedlegg, 3 vedlegg = 3 MB per ID maks |
| Maks total ID-blob-størrelse? | 25 MB soft target, Upstash 100 MB hard |
| Full-skjerm pass-foto? | Ja — AttachmentViewer med pinch-zoom + ESC-lukker |
| Søk i ID-er? | Cmd+K Full-integrasjon med synonymer (passport, kjørekort, sertifikat) |
| Vannmerke ved nød-deling? | Ja — klassisk Word-stil diagonal "KOPI" + dato, klient-side canvas |

---

## 🎯 v4.2 — Språkdrakt NO/SV/DA ✅ **FERDIG (2026-05-28)**

> ✅✅✅ **100% FERDIG FERDIG.** Se **`v4.2-PROGRESS.md`** for sluttsnapshot og **`i18n-CONVENTIONS.md`** for definitiv guide for fremtidige agenter.

**Status:** Levert. 748 nøkler i no.json (byte-likt sv/da) + `_section_new_keys`-blokk nederst for nye strenger. 30/30 komponenter + 5 hooks + 9 lib-filer ekstrahert. TSC ren · 63/63 tester grønne · build grønn. Gjenstår KUN at Mike fyller inn SV/DA-verdiene manuelt.

**Hovedbeslutning:** Kun NO/SV/DA i fase 1. Engelsk vurderes etter skandinavisk validering. Finsk er ikke skandinavisk → ikke i scope.

**ADR-er:**
- [D-032](DECISIONS.md#d-032) — Språkdrakt scope og begrensninger
- [D-036](DECISIONS.md#d-036) — i18n-arkitektur: egen lett løsning, flagg i header, ingen URL-routing

### Fortelling: Lars og Lisbeth på hver sin Mac

> *"08:00. Lars åpner Ko|Do Vault. Norsk UI som vanlig — tre flagg øverst i header: 🇳🇴 🇸🇪 🇩🇰. Det norske er aktivt.*
>
> *Samme dag — Lisbeth (advokat i Stockholm) logger inn på samme Ko|Do-instans. Første gang: appen detekterer `navigator.language = 'sv-SE'` og viser UI på svensk: 'Lås upp valv' i stedet for 'Lås opp vault'. Hun klikker det svenske flagget for å bekrefte. Locale lagres i localStorage.*
>
> *Begge har samme produkt, samme arkitektur, samme krypto. Ulik språk-overflate.*
>
> *Brukerdata (passord-titler, kort-navn, ID-er) forblir akkurat slik brukeren skrev dem — ingen oversettelse av data, kun UI."*

### Arkitektur — låst 2026-05-26

**Løsning:** Egen lett i18n. Ingen eksterne dependencies (ikke `next-intl`). Konsistent med Lean Security-filosofien.

**Fil-struktur (ISO 639-1 språkkoder):**
```
/app/frontend/lib/locales/
├── no.json    ← Norsk (bokmål, referansespråk)
├── sv.json    ← Svensk    (IKKE se.json — se = land)
└── da.json    ← Dansk     (IKKE dk.json — dk = land)
```

```ts
// lib/i18n.ts
import no from './locales/no.json'
import sv from './locales/sv.json'
import da from './locales/da.json'

const dict = { no, sv, da } as const
export type Locale = keyof typeof dict

export const t = (key: string, locale: Locale): string =>
  dict[locale][key] ?? dict.no[key] ?? key  // fallback: norsk → key selv
```

**Nøkkel-konvensjon:** Flat struktur med dot-notation, ikke nested:
```json
{
  "auth.unlock_title": "Lås opp vault",
  "passwords.tab_label": "Passord",
  "ids.tab_label": "ID"
}
```

**Locale-valg:** Tre flagg i `AppHeader` (🇳🇴 🇸🇪 🇩🇰). Klikk bytter umiddelbart uten reload.

**Locale-persistering + auto-detect:**
```ts
localStorage.setItem('kodo-locale', 'sv')
const locale = localStorage.getItem('kodo-locale')
  ?? navigator.language.slice(0,2)
  ?? 'no'
```

**Ingen URL-routing** (`/no/`, `/sv/`) — appen lever bak innlogging og skal ikke indekseres av søkemotorer. Fremtidig URL-routing kan legges på toppen uten å rive ned denne løsningen.

### Oversettelses-prosess

- **Norsk er referansespråk** (`no.json`) — agenten bygger denne ved streng-ekstraksjon
- **Svensk og dansk** — **Mike fyller inn `sv.json` og `da.json` selv**. Agenten lager kun tom struktur (samme nøkler som `no.json`, verdier = tomme strenger eller TODO-markører)
- **Estimat:** ~300 strenger i UI (passord-modul + kort + ID + backup + auth)
- **Brukerdata oversettes aldri** — kun UI-chrome

### Ikke i scope for v4.2

- ❌ URL-basert locale-routing
- ❌ ICU MessageFormat
- ❌ Finsk (ikke skandinavisk, eget språktre)
- ❌ Engelsk (vurderes etter skandinavisk validering)
- ❌ Nynorsk (holder oss til bokmål — nynorsk hvis etterspurt senere)

### Implementasjons-skritt (start her i morgen)

1. **Iter 1:** `lib/i18n.ts` med `t()`-funksjon + locale-state (React context eller hook)
2. **Iter 2:** `lib/locales/no.json` — ekstrahere alle hardkodede norske strenger fra UI
3. **Iter 3:** `LanguagePicker`-komponent (tre flagg) i `AppHeader`
4. **Iter 4:** Lage `sv.json` og `da.json` som **tomme skall** (samme nøkler som `no.json`, tomme verdier). **Mike fyller inn selv etter at agent er ferdig.**
5. **Iter 5:** Test fallback-kjeden + `Intl.DateTimeFormat` per locale + version-bump til v4.2.0

### 🟡 Avklaringer som må tas FØR Iter 1 starter (avgjøres i morgen)

Disse tre edge-casene ble flagget under estimering 2026-05-26 og må besluttes før streng-ekstraksjon for å unngå dobbelt-arbeid:

**1. Dato-format på utløpsdatoer (pass, kort, ID-er)**
- NO: "12. mai 2034"
- SV: "12 maj 2034" (ingen punktum etter dag)
- DA: "12. maj 2034"
- **Forslag:** Bruk `Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })` — håndterer alle nyanser automatisk
- **Spørsmål:** Skal vi ha en kortform også (`12.05.2034` / `2034-05-12`) for kompakte UI-steder, eller alltid lang form?

**2. KOPI-vannmerke på ID-eksport (v4.1)**
- Vannmerket sier i dag: "KOPI · 2026-05-26"
- "KOPI" er identisk på alle tre språk — beholdes som det er?
- Datoen er ISO 8601 (locale-agnostisk) — beholdes som det er, eller formatteres per locale?
- **Forslag:** Behold "KOPI" + ISO-dato. Det er et juridisk stempel, ikke UI-chrome — bevisst language-neutral. Hvis vi senere selger til EU utenfor Skandinavia kan vi bytte til "COPY" som default for `en`.

**3. Backup-filnavn (eksport-flow)**
- I dag: `kodo-vault-backup-full-{ts}.json`
- Alternativer per locale:
  - NO: `kodo-sikkerhetskopi-full-{ts}.json`
  - SV: `kodo-säkerhetskopia-full-{ts}.json`
  - DA: `kodo-sikkerhedskopi-full-{ts}.json`
- **Spørsmål:** Skal filnavnet være locale-spesifikt eller alltid på engelsk (`backup`)?
- **Forslag:** Behold engelsk `backup` i filnavn. Brukeren ser uansett ofte på filer i Finder/Explorer, og engelsk er den minst tvetydige varianten på tvers av tenant-konfigurasjoner. UI-strengen rundt knappen ("Eksporter sikkerhetskopi"/"Exportera säkerhetskopia") oversettes via `t()`.

---

## 🎯 v4.3 — Betalingsløsning Stripe / Me & Max AS (NY 2026-05-26)

**Status:** 🔵 **PÅGÅR** (oppstart 2026-05-29). Sannhetskilde for iter-detaljer: [`v4.3 Utviklingsplan.md`](v4.3%20Utviklingsplan.md) — 24 iter totalt. Onboarding-flyt og prismodell endret per D-037; ingen kortinfo ved registrering, 30d trial → Stripe ved konvertering (Iter 11+).

### Iter-status (per 2026-06-02)

- ✅ **Iter 0** — Admin-autentisering (`/platform/admin` + bcrypt HMAC-cookie)
- ✅ **Iter 1** — Sentral Upstash + TenantViewer CRUD
- ✅ **Iter 2** — Subdomene-validering (reserverte navn + `*-admin` suffiks per D-038). Sannhetskilde i `reserved-subdomains.json` (D-041).
- ✅ **Iter 3** — `/platform/test` plan-velger med 4 kort (Trial, Monthly 129kr, Yearly 1238kr, Enterprise). Plan-data i `plans.json` (D-042).
- ✅ **Iter 4** — `/platform/register` skjema + public `/api/register/subdomain-check`. Min 3 tegn (D-043). Påkrevde felt merket (D-044).
- ✅ **Iter 5** — Turnstile invisible mode integrert
- ✅ **Iter 6** — Rate-limiting (Upstash, delt bucket /register+/paid, fail-open per D-048)
- ✅ **Iter 7** — POST /api/register (trial-registrering, INGEN provisjonering, INGEN Stripe customer per D-049)
- ✅ **Iter 7.5** — Admin-modulen komplett (D-051 alle felter null, D-052 customerType-betinget skjema, D-053 Stripe-kobling, D-054 overstyring med audit-log, D-055 manuell provisjonering)
- ✅ **Iter 7.6** — Invitasjonslenke-flyt for B2B (D-056): InviteRecord-store, /api/admin/invites, /api/invite/{validate,accept}, /api/cron/cleanup-pending. Admin-UI med "Kopier lenke / Send på nytt / Slett". Batch CSV-import.
- ✅ **Iter 8** — Vercel auto-provisjonering (D-057 erstattet av D-060). `lib/platform/vercel-provision.ts`: createProject + setEnvVars + attachSubdomain. Wired inn i /api/register, /api/invite/accept. Manuell retry via `/api/admin/tenants/[subdomain]/provision-vercel`. Reorder Vercel→GitHub (D-058).
- ✅ **Iter 8.3** — Client-config flyttet til sentral Upstash (D-060). `client-config:<subdomain>` lagring, public `/api/client-config` med CORS, admin `/api/admin/client-config` GET/PUT/DELETE, ClientConfigEditor i TenantViewer, bulk-verktøy `/api/admin/migrate-client-configs` med merge/skip-existing/overwrite-all-modi. localStorage-cache 24t (D-061).
- ✅ **Iter 9** — Komplett provisjonerings-stack (D-063 → D-067):
  - **D-063:** Failsoft — ingen Vercel-rollback ved Upstash-feil, admin retry via D-055-knappene
  - **D-064:** Upstash provisjoneres FØRST → Vercel opprettes med ekte KV-creds direkte (ingen PENDING_ITER_9-hack)
  - **D-065:** Strukturert `provisioningLog: ProvisioningEvent[]` på TenantRecord — append-only logg av alle provisjonerings-hendelser
  - **D-066:** `vaultLive: boolean` + `/api/status`-polling-endpoint + on-demand Vercel deployment-statussjekk + `vault_live`-stage
  - **D-067:** Frontend orkestrerer admin-create via D-055-ruter + delt `ProvisioningTracker`-komponent (checklist UI) brukt av både Skjerm 5 og admin-modal
  - Konto-logg side-panel i TenantViewer med tekst-/JSON-toggle
- ✅ **Iter 10 — Velkomstmail (Resend) + Telegram-varsling (D-068):**
  - `lib/platform/notify-email.ts` + `notify-telegram.ts` med `*_ENABLED=true`-gating
  - HTML-maler (`welcome.no.html` / `welcome.en.html`) — locale-styrt
  - Wired inn i `markVaultLive()` (fire-and-forget) + admin "Send velkomstmail på nytt"-knapp
  - 2 nye stages: `welcome_email_sent`, `telegram_sent`
  - 10/10 tester på mal-rendering
- ✅ Iter 11-14 — **Stripe**: price-IDer, Checkout, **Iter 12.5 trial→betalt-konvertering (D-045 + D-049 just-in-time customer)**, webhook, **Iter 13.5 betalingsvegg checkout-info (D-046)**, **Iter 13.7 /billing/upgrade-side**, **Iter 14.7 resume-banner**
- ⬜ Iter 15-24 — Resend e-poster, lifecycle, admin-dashboard, B2B-modul, ✅ **Iter 18.5 in-vault upgrade banner (D-050) — LEVERT 2026-06-08**, **Iter 19 paywall**, **Iter 19.5 Stripe Customer Portal** (selvbetjent abonnement)
- ⬜ **Iter 22 — Feilsider og branded fallbacks** *(scope utvidet 2026-06-23)*:
  - **Slettet/ukjent tenant 404** — wildcard-håndtering for ukjente
    `*.kodovault.no`-subdomener via Vercel wildcard-rewrite eller Cloudflare
    worker. Branded Ko | Do-side med tekst "Denne vaulten finnes ikke
    lenger." + lenke til `kodovault.no`. Erstatter dagens generiske Vercel
    `DEPLOYMENT_NOT_FOUND`-side (se `memory/KNOWN-ISSUES.md` #001).
  - Andre feilsider: 500-side, robot/scraper-blokk, expired-trial-side.

**Kommersielle parametre:** Se [💰 Kommersielle parametre](#-kommersielle-parametre-besluttet-2026-05-26) ovenfor.

---

## 🚧 Iter 20 — B2B Hybrid (oppdatert · 2026-06-26)

**Status:** Iter 20.1, 20.2 og 20.3 levert + statisk verifisert. Iter 20.4 pågår.

**Forretningsmodell:** **Hybrid (C)** — Mike onboarder B2B-parent manuelt; `am-admin`-rolle vedlikeholder ansatte selv etterpå. Iter 20.4 introduserer fakturerings-cascade og cron-håndhevet grace-periode.

### Kommersielle parametre (Iter 20.4 · 2026-06-26)

| Parameter | Verdi |
|---|---|
| Trial-periode (B2B) | **45 dager** gratis (B2C beholder 30d) |
| Pris halvår | **522 kr/seat** per 6 mnd (87 kr/seat × 6) |
| Pris helår | **1 044 kr/seat** per år (87 kr/seat × 12) |
| Grace-periode etter forfall | **7 dager** før kaskade-lock av child-tenants |
| Pre-utløp-varsel (am-admin) | **7 dager** før neste fakturering |
| Faktureringsmodell | Mike oppretter Subscription manuelt i Stripe Dashboard, quantity = `maxLicenses` |
| Cascade ved lock | Alle child-tenants under `tenantPrefix` settes til `status="locked"` + `parentLockedAt` |
| Cascade ved `invoice.paid` | Children med `parentLockedAt` satt unlocker automatisk |

### Iter 20-faser

1. **20.1** ✅ — RBAC + datamodell (`OrgAdmin`, `TenantStatus` utvidet)
2. **20.2** ✅ — am-admin login (`POST /api/am-admin/auth/login`), wildcard middleware, UI shell
3. **20.3** ✅ — Ansatt-forvaltning, suspend/unsuspend, auto-invite-mail via Resend (+ patch: unified ansatt-tabell, live URL-preview, parent-leak-guards)
4. **20.4** ✅ KOMPLETT — B2B fakturering + i18n + testfaktura:
   - **20.4a** ✅ — Datamodell + Plan-utvidelse + b2b-billing.ts + 16 unit-tester
   - **20.4b** ✅ — Webhook lagrer `nextBillingDate`, lifecycle-cron + cascade-lock + cascade-unlock + 7 nye unit-tester
   - **20.4c** ✅ — API + UI: parent billing-state, am-admin banner, invite-blokk i grace + 3 nye tester (33/33)
   - **20.4d** ✅ — Statisk QA-pass via testing-agent + 3 polish-fixes
   - **20.4e** ✅ — am-admin UI i18n-ifisert × 4 språk
   - **20.4f** ✅ — Send testfaktura-knapp + alle NO-placeholders i sv/da/en oversatt fullt
5. **20.5** ✅ KOMPLETT — am-admin Master Password (MPW) + admin-notater + backup-eksport:
   - **20.5a** ✅ — Krypto-foundation (PBKDF2 600k + AES-GCM), sentral storage, 42 unit-tester
   - **20.5b** ✅ — Setup/unlock/reset API + UI, MpwContext, atomisk SETNX (TOCTOU-fix), 4-språk i18n
   - **20.5c** ✅ — adminNotes per ansatt (separat key, indeksert), orphan-cleanup ved tenant-delete, corrupt-blob signaling
   - **20.5d** ✅ — Backup CSV (RFC 4180 + OWASP formula-injection-mitigering) + JSON (versjonert v1), filnavn med sekund-presisjon
   - **Endelig test-status**: 132/132 unit-tester grønt, yarn tsc/build/lint:all alle grønne, 4 språk synkronisert (1209 nøkler)
6. **20.6** ✅ KOMPLETT — B2B Velkomstskjerm + Matrise 6 + endelig statisk QA:
   - `/welcome-b2b/[subdomain]` (4 trust-byggende bullets, 4-språk i18n)
   - Matrise 6 i DECISIONS.md (35 entry-points dekket, 6/6 matriser lukket)
   - 198/198 unit-tester grønt, 1224 i18n-nøkler × 4 språk i sync
   - **Iter 20 globalt klar for produksjon**
7. **20.7** ✅ KOMPLETT — B2B-tab aktivert + lokaliserte labels + org.nr-validering:
   - Super-admin B2B-tab er nå aktiv (ikke disabled placeholder)
   - Lokaliserte feltetiketter på norsk/svensk/dansk/engelsk (20 nye i18n-nøkler × 4 = 80)
   - Org.nr Mod-11/CVR/Luhn-validering basert på valgt land
   - 45d trial default for B2B (D-080)
   - 220/220 unit-tester grønt, 1249 i18n-nøkler × 4 språk i sync

### IKKE i scope for Iter 20

- Self-serve kjøp av flere lisenser (Stripe-flyt for per-seat-pricing) — se "🟢 NEXT TIME / FUTURE BACKLOG — B2B-monetisering" nedenfor
- Automatisk fakturering per seat (Mike administrerer manuelt i Stripe Dashboard) — samme next-time-bucket
- Detaljert aktivitetslogg per ansatt i am-admin-UI (audit-stream visning) — utsatt til Iter 21+
- Per-org white-label invite-mail (egen logo, brand-farger) — parkert i egen next-time-bucket

### Env-vars som må settes i Vercel før Iter 20.4b deploy

- `STRIPE_PRICE_B2B_SEMIANNUAL` — Stripe Price ID for 522 kr/seat per 6 mnd (recurring=true, interval=month, interval_count=6, currency=NOK)
- `STRIPE_PRICE_B2B_YEARLY` — Stripe Price ID for 1 044 kr/seat per år (recurring=true, interval=year, currency=NOK)

---

## 🔧 Iter 20-prep — Forberedelser & utsatt teknisk gjeld (NY 2026-06-25, oppdatert 2026-06-26)

Liste over tekniske oppgaver som er identifisert som nyttige men bevisst utsatt til Iter 20-prep-fasen. Hold listen kort — hvis den vokser over 6-8 punkter, vurder å løfte noen tidligere.

### Tekniske quick-wins (~20-60 min hver) — STATUS

- ✅ **`lint:i18n-sync`-test** — levert Iter 19.9.17 + skjerpet til FAIL-on-unused i Iter 19.9.19. Kjører nå i `yarn lint:all` (5-lint-kjede).
- 🟡 **B2B invite-flyt-matrise** — del av Iter 20 (Matrise 6, se scope over).
- ✅ **`yarn.lock` committe** — levert Iter 19.9.18 (untracked → klar for "Save to Github").
- ✅ **vercel.json buildCommand cleanup** — levert Iter 19.9.20 (`buildCommand` fjernet, `package.json:vercel-build` er nå single source of truth).

### Arkitektur-spørsmål (krever Mike-diskusjon)

- **Tenant-isolering for crons** — `lib/__tests__/isolation-lint.test.ts` har EXEMPT-listen for cron-ruter, men når Iter 20 introduserer per-tenant lifecycle (auto-lock per tenant-status osv.), bør cron-ene da kalle tenant-API-er i stedet for å nå sentral DB direkte? Trade-off mellom isolering og effektivitet.
- **Coverage-matrix-lint pre-build vs pre-deploy** — i dag kjører lint:all i `package.json vercel-build` = på hver deploy. Hvis vi vil ha CI-only (PR-validering), må vi flytte lint-kjeden til GitHub Actions og fjerne fra vercel-build-scriptet. Mike's preferanse?

---



## ✅ Iter 19.9 — Obligatorisk locale-valg ved registrering (KOMPLETT 2026-06-13)

**Status: LEVERT OG QA-GODKJENT** *(av Mike 2026-06-13)*

**Resultat:** Mal-pakke (12 nye SV+DA HTML-filer) + backend 4-språk (`resolveLocale`/`formatDayWord`/`formatDateOnly`/`lifecycleReasonText` + 5 subjects på alle 4 språk) + `<LocaleRadioGroup>`-komponent (4 radio-knapper, HELT TOMT initialt) plassert i `/platform/register` + `/invite` + obligatorisk backend-validering på 3 endepunkter (`/api/register`, `/api/register/paid`, `/api/invite/accept`). i18n-key `register.field_locale` lagt til i NO/SV/DA/EN med Mike's foretrukne formulering "Velg språk på mail og kommunikasjon fra oss".

**Side-leveranser i samme runde:**
- Lenke-fargestrategi i lifecycle-mailer (gray for footer-info, orange+underline for A4-invitasjon, forhindrer Gmail/Outlook auto-link)
- Footer-leselighet (12px / #aaaaaa / line-height 1.7 — WCAG AAA-kompatibel)
- Brand-konvensjon "Ko \| Do · Vault" konsistent globalt (248 forekomster i 154 filer)
- Fikset 2 pre-eksisterende test-failures (`iter13` + `iter13-5-checkout-info`)
- Backlog-tillegg: `strings.ts`-sentralisering (foreslått av Mike, ikke planlagt versjon)

**Blokker for Iter 20 fjernet.**

---

## ✅ Iter 19.9.2 — SettingsPanel redesign (LEVERT 2026-06-23)

**Status: LEVERT — venter brukers verifisering i prod**

Migrert visuell signatur fra `meetmax-no/kodo-editor` til vault sin
`SettingsPanel`. Eksisterende panel (693 linjer, scrolling med kollapsbare
`<Section>`-er) omformet til 4-fane-modal med Ko|Do amber `#f5a623` som
accent (via CSS-variabel `--kodo-accent` styrt av `.theme-<id>` på `<html>`).

**Faner:**
1. **Generelle** — Språk (4 flagg NO/SV/DA/EN, app-språk kun), Konfigurasjon
   (accordion, `<dl>` flat-liste i monospace), Klient (accordion, `<dl>`-meta
   + notater).
2. **Look & Feel** — Tema-velger (Mørk/Lys/Blå/Oransje, sirkulær swatch +
   label), Bakgrunns-modus (Fast/Daglig/Tilfeldig pills), Overlay opacity
   slider 0..0.8 (gull thumb m/ glow), 9 bakgrunns-tiles (3 hardkodede
   gradienter `slate-night`/`aurora`/`ember` + 6 første Unsplash-bilder fra
   `config.backgrounds`).
3. **Sikkerhet** — Passord-lab, Bytt master-passord, Fjern Touch ID,
   Hendelses-logg (alle ActionRow-er gjenbruker eksisterende callbacks).
4. **Backup & Admin** — SubscriptionInfoCard (Stripe live), "Administrer
   abonnement" → Stripe Portal, Backup eksport/import, Farlig sone (rose-
   border, "Slett vault og konto" via eksisterende DeleteAccountDialog).

**Tekniske endringer:**
- **Nye filer:**
  - `lib/settings/themes.ts` — 4 ThemeDef-er m/ accent/soft/glow per tema.
    Amber `#f5a623` (ikke `#FBBF24`) for "Mørk"-temaet.
  - `lib/settings/background-gradients.ts` — 3 hardkodede gradienter med
    `gradient:<id>`-URL-prefix lagret i bg-preference.
  - `hooks/useTheme.ts` — localStorage-persistensa theme-picker, setter
    `.theme-<id>` + `.tone-light|dark` på `<html>`. SSR-safe.
  - `components/settings/{GeneralTab,LookFeelTab,SecurityTab,BackupAdminTab,MetaList}.tsx`
- **Modifiserte filer:**
  - `components/SettingsPanel.tsx` — rewrite til tab-navigasjon (4 stk).
  - `lib/bg-preference.ts` — utvidet med `overlay?: number` (clamp 0..0.8).
  - `app/page.tsx` — `useTheme()` mount, gradient-rendering (skip `<Image>`
    for `gradient:*`-URLer), `handleBgOverlayChange`, `effectiveOverlay`.
  - `app/globals.css` — CSS-variabler `--kodo-accent`, `--kodo-accent-soft`,
    `--kodo-accent-glow`, `--kodo-accent-ink` per `.theme-<id>`.
  - `lib/locales/{no,sv,da,en}.json` — +20 nye nøkler per språk (tabs,
    theme-labels, bg-section, overlay, gradient/photo-kategorier).
- **TSC grønt · ADR-lint grønt (D-069/D-071/D-077) · Build grønt (39 ruter, 55s).**

**Hva som IKKE er endret (per Mike-direktiv "ikke endre noe som fungerer"):**
- `clients/default.json` — backgrounds-array uberørt (9 stk fortsatt). UI
  viser kun de første 6 + 3 hardkodede gradienter.
- LanguagePicker, PasswordLab, EventLogPanel, BackupExportModal,
  BackupImportModal, DeleteAccountDialog, SubscriptionInfoCard, Stripe
  Portal-flyt — alle gjenbrukt som-er via samme callback-API.
- `vault.changeMasterPassword()`, `vault.removeBiometric()` — uendret.
- Iter 19.9 locale-låsing — uendret (Fane 1 har egen help-tekst som
  presiserer "kun app-språk, ikke koblet til tenant.locale").

**Pris-korreksjon:** Brief sa 129 kr/mnd, Mike korrigerte til 115 kr/mnd.
Selve pris-strengen vises i `SubscriptionInfoCard` (Iter 19.7) som henter
verdien live fra Stripe, så ingen hardkodet endring nødvendig i denne
iterasjonen.

**Venter på:** Mike trykker "Save to Github" → Vercel auto-deploy → tester
i prod (logger inn på en vault → ⚙️ → klikker gjennom alle 4 faner →
verifiserer at tema-bytte fungerer, at overlay-slider justerer bg, at de
3 gradientene rendrer riktig, at Stripe Portal-knappen redirecter).

**Korreksjoner mottatt 2026-06-24 (samme leveranse, før prod-deploy):**

1. **Plan-basert abonnement-CTA i Fane 4** — Mike oppdaget `no_stripe_customer`-
   feilmelding ved klikk på "Administrer abonnement" som trial-bruker. Root
   cause: D-049 (just-in-time Stripe customer). Ny logikk i
   `BackupAdminTab.tsx`:
   - `status === "trial"` → "Aktiver abonnement" (amber CTA → /billing/upgrade),
     ALLTID uavhengig av `hasStripeCustomer` (per Mike-direktiv)
   - `status ∈ {"active", "cancelled"}` → "Administrer abonnement" → Stripe Portal
   - Alle andre stater (`pending`/`locked`/`unknown`/`"free"`) → skjul både
     CTA og SubscriptionInfoCard
   - Ny komponent `ActivateSubscriptionRow` med amber-fyll og Sparkles-ikon —
     visuelt prioritert som konverterings-trakt-toppen
   - testid: `settings-activate-subscription` + `settings-manage-subscription`
   - Nye i18n-nøkler `action_activate_subscription_{title,desc}` på 4 språk

2. **Klient før Konfigurasjon + default-state korrigert** — i `GeneralTab.tsx`:
   - Klient nå FØRST, `defaultOpen={true}` (mer "menneskelig" innhold)
   - Konfigurasjon nå ANDRE, `defaultOpen={false}`
   - Begge accordions allerede uavhengige via egen `useState`

3. **Tema-velger slettet i sin helhet** — Mike observerte at temaet kun endret
   amber-accenten INNE i SettingsPanel, ikke resten av appen. Ekte
   tema-implementasjon ville kreve å endre 30+ komponenter til å bruke
   `var(--kodo-accent)` i stedet for hardkodet Tailwind-palett, og det
   bryter D-022/D-023 (per-browser glass-arkitektur). Ikke verdt scope.
   - **Slettet filer:** `lib/settings/themes.ts`, `hooks/useTheme.ts`
   - **Slettet kode:** TEMA-seksjon i `LookFeelTab.tsx`, `useTheme()`-mount
     i `app/page.tsx`, `.theme-X` CSS-regler i `globals.css`
   - **Slettet i18n:** `theme_*` nøkler i alle 4 lokaler (6 stk per språk)
   - **Beholdt:** `--kodo-accent: #f5a623` på `:root` — SettingsPanel-
     komponentene fortsatt får sin amber-signatur (tab-underline, slider-
     thumb, ✓-pille, "Aktiver abonnement"-CTA, fokus-ringer) uten velger

**Final sjekk etter korreksjoner:** TSC grønt · ADR-lint D-069/D-071/D-077
grønt · build grønt · 104 settings.* i18n-keys per språk (synket).

---

## 🟢 NEXT TIME / FUTURE BACKLOG — Per-org white-label invite-mail

**Status:** Mikes idé, parkert 2026-06-26. Eksplisitt **ut-av-scope for Iter 20.3** — tas opp i senere iterasjon hvis B2B-volumet tilsier det.

**Bakgrunn:** Iter 20.3 leverer auto-invite-mail via Resend som bruker en felles Ko|Do-mal (samme look uavhengig av hvilken B2B-bedrift som inviterer). Mike foreslo at hver org bør kunne tilpasse mailen med egen logo + org-navn + brand-farger.

**Skisse av eventuell implementering:**
- Nytt felt på `TenantRecord` (B2B-parent): `inviteEmailTemplate?: { logoUrl, brandColor, fromName }` — alle valgfrie
- am-admin SettingsPanel-fane: "Invite-mail-tilpasning" hvor super-admin kan laste opp logo (via emergent object storage) og sette org-navn
- `sendInviteEmail()` utvides: hvis parent har `inviteEmailTemplate`, bruk per-org-varianter av template-strengene (header, footer, fra-navn)
- 4 nye HTML-template-varianter (`invite-branded.<locale>.html`) med `{{logoUrl}}` + `{{brandColor}}`-placeholders
- Resend `from`-header: "{{orgName}} via Ko|Do <vault@kodovault.no>" (legitim — vi forblir avsender, vi viser kun bedriftens navn)

**Avhengigheter:**
- Object storage for logo-upload (eksisterer allerede via integration_playbook_expert_v2)
- Stable Resend-konfig (i prod, ikke testing)

**Når tas dette opp igjen?**
**Next time / future backlog.** Tas opp kun når Mike eksplisitt løfter det. Avhenger av at:
- Iter 20-stacken er i prod
- Minst én B2B-kunde har eksplisitt etterspurt brand-tilpasning
- B2B-volumet rettferdiggjør ekstra mail-template-vedlikehold

Hvis ingen kunder bryr seg om white-label, kan denne forbli parkert ubegrenset.

---

## 🟢 NEXT TIME / FUTURE BACKLOG — B2B-monetisering (self-serve)

**Status:** Eksplisitt ut-av-scope for Iter 20 per Mike-direktiv 2026-06-26. **Tas opp kun når Mike eksplisitt løfter det** — ikke automatisk etter Iter 20-leveranse.

**Hvorfor parkert:** Iter 20 leverer "B2B-konto-forvaltning" (Hybrid-modell: Mike onboarder, am-admin forvalter ansatte). Self-serve monetisering er en separat akse som påvirker Stripe-flyten dypt og krever egne beslutninger om pricing-strategi, dunning, refunds, prorating osv.

### Saker i bucket-en

#### 1. Self-serve kjøp av flere lisenser
B2B-admin (`am-admin`) skal kunne kjøpe ekstra lisenser via Stripe Checkout uten å kontakte Mike. Krever:
- Ny Stripe Price ID for per-seat-lisens (separat fra B2C-månedlig/årlig)
- Ny rute `/api/admin/license/purchase` (am-admin-only) som starter Stripe Checkout Session
- Webhook-håndtering som inkrementerer `parent.maxLicenses` etter `checkout.session.completed`
- UI i am-admin-dashbord: "Kjøp X flere lisenser" med pris-kalkulator
- E-postkvittering + audit-event `licenses_purchased`

#### 2. Automatisk fakturering per seat
I dag har B2B-parent ingen aktiv Stripe-subscription — `maxLicenses` er et statisk tall Mike setter. Self-serve krever:
- Stripe Subscription med metered billing eller licensed quantity
- Sync mellom `parent.maxLicenses` og Stripe-subscription-quantity
- Håndtering av nedjusteringer (kunde reduserer fra 10 → 5 lisenser midt i fakturerings-perioden — prorating?)
- Faktura-PDF + Stripe Customer Portal-integrasjon for B2B-parents
- Dunning når kort utløper / betaling feiler — krever nye lifecycle-stages

### Avhengigheter
- Iter 20 må være i prod og stabilt
- Beslutning om pricing-modell (fast pris per seat? Volum-rabatt? Annual discount?)
- Beslutning om hvilket Stripe-produkt (separat product per kunde, eller én delt med metered usage?)

### Når tas dette opp igjen?

**Next time / future backlog.** Tas opp **kun når Mike eksplisitt løfter det**. Forutsetter at Hybrid-modellen (Iter 20) viser seg å være riktig, og at B2B-volum rettferdiggjør automatisering av prosessen Mike i dag gjør manuelt. Hvis B2B-volum forblir lavt (få bedrifter, manuell onboarding går fint), kan denne bucket-en forbli parkert ubegrenset.

---

## 🟢 NEXT TIME / FUTURE BACKLOG — Del passord trygt / éngangs-lenker

**Status:** Flyttet til "next time"-bucket per Mike-direktiv 2026-06-25. **Ikke pre-Iter-20 / pre-Iter-21 lenger.** Tas opp når Mike eksplisitt løfter det. Punkt #12 fra Mike's 13-punkts UX-liste (resten av listen lukket i Iter 19.9.3 / 19.9.4 / 19.9.5 / 19.9.6 / 19.9.7 / 19.9.11).

### Bakgrunn (verbatim fra Mike)
> "Ingen 'del passord trygt' / 'send éngangs-lenke'-funksjon. Brukerstøtte må ofte få en sjelden brukt kollega-tilgang. Bedford-modellen (éngangs-token + krypter med mottakers pwd) er en typisk feature i konkurrenter."

### Brukerscenario
Lars (eller hvilken som helst Ko|Do-tenant) skal gi en kollega tilgang til et VPS-passord, et Stripe-bruker eller et delt API-token — uten å sende det i Slack/SMS/e-post i klartekst. I dag har Vault ingen slik mekanisme; han må kopiere passordet manuelt og sende det utenfor verktøyet.

### Hva konkurrenter gjør (Bitwarden Send, 1Password Send, Dashlane Sharing)
1. Marker oppføring → "Del trygt"
2. Vault genererer **éngangs-URL** + valgfri PIN/passphrase
3. Mottaker klikker lenken → skriver PIN → ser passordet **én gang** → lenken sletter seg selv
4. Konfigurérbart: max antall visninger (1-5), TTL (1t / 24t / 7d), passordbeskyttelse på selve lenken

### Teknisk skisse (foreløpig — kan endres etter krypto-beslutning)
- Ny Upstash-nøkkel `share:<token>` med TTL = utløp + kryptert payload
- Krypterings-modell: **éngangs-nøkkel lever i URL-fragmentet `#k=...`** (etter `#`, så serveren ser aldri klartekst — alt klient-side dekryptering, samme prinsipp som Send-løsningene)
- Ny rute `/share/[token]/page.tsx` (anonym, ingen auth-krav)
- Nytt felt på Vault-entries: "Delt"-merke + nedtelling/TTL-status
- Audit-logg på admin-host: hvem delte, når, hvor mange ganger åpnet
- Ny modal `ShareEntryModal` med felter: TTL-velger, max-views-velger, valgfri PIN

### Avhengigheter & risiko
- **Krypto-arkitektur** — hvor lever éngangs-nøkkelen? URL-fragment? Server-derived? Hvilken algoritme (AES-GCM antagelig, samme som vault-blob)?
- **GDPR-vurdering** — delte hemmeligheter ligger på Ko|Do-infrastrukturen i en periode (TTL-vinduet). Skal de telles som "data-processor"-aktivitet?
- **Pricing-spørsmål** — gratis-feature for alle tenants, eller Pro-only? Påvirker konverterings-trakten direkte.
- **UI-arbeid** — ny modal + ny anonym rute + nedtelling-komponent

### Estimat (etter alle avklaringer)
**2-3 dager arbeid** når krypto-modell + pricing er låst. Foreslått sekvens:
1. Krypto + Upstash-skjema + API-rute (`/api/share/[token]`) — dag 1
2. ShareEntryModal + auto-generering av URL + clipboard-copy — dag 1-2
3. `/share/[token]/page.tsx` anonym viewer-rute + audit-logging — dag 2-3
4. i18n (4 språk) + tests + ADR D-XXX som dokumenterer krypto-valget — dag 3

### Beslutninger som må tas FØR bygging
1. **Krypto-modell:** URL-fragment-nøkkel vs server-derived vs hybrid?
2. **Free vs Pro:** Skal éngangs-deling være i base-pakken (115 kr/mnd) eller Pro-tier?
3. **TTL-grenser:** Hva er maks-TTL? 7 dager? 30? Påvirker Upstash-kost.
4. **PIN-håndtering:** Kreves PIN alltid, eller valgfritt? PIN derivation via Argon2 client-side eller server-side?
5. **Audit-retensjon:** Hvor lenge logges share-events? Per GDPR-policy?

### Hva som IKKE er i scope (avgjort av Mike 2026-06-25)
- ❌ **Passord-historie / versjonering** (Mike's punkt #13) — forkastet, "ikke i tråd med produktfilosofien". Ikke vurder dette punktet på nytt med mindre Mike eksplisitt løfter det.

### Når tas dette opp igjen?

**Next time / future backlog.** Tas opp **kun når Mike eksplisitt løfter det** — ikke automatisk pre-Iter-20 eller pre-Iter-21. Iter 20 (B2B-multi-tenant) skal være stabilt før denne vurderes, slik at vi ikke endrer entry-schema midt i en migrering, men det er ikke en hard avhengighet — featuren kan utsettes vilkårlig.

---



## 📜 Iter 19.9 — Original spec (ARKIVERT etter levering 2026-06-13)

**LEVERT — denne seksjonen er bevart for historisk sporbarhet.** Se seksjonen over for ferdigstatus.

**Tidligere status: PLANLAGT** *(spec mottatt fra Mike 2026-06-13)*

**Hvorfor BLOKKER:** B2B-fasen (Iter 20-24) utvider adresserbart marked til SE/DK. I dag gjettes locale via `useLocale()` (browser-navigator + localStorage). SV/DA-brukere får i dag norske lifecycle-mailer pga stille fallback i `resolveLocale()`. Et obligatorisk valg ER riktig — men FORUTSETTER at mal-pakken finnes på alle 4 språk, ellers introduserer vi en stille feil for SV/DA-tenants (registrerer "sv", får ingen mail).

### 🎯 Hva denne iterasjonen fundamentalt løser

**Vi gjetter aldri mer på språk.**

Dagens problem er ikke at `resolveLocale()` er feil — det er at `tenant.locale` settes basert på en GJETNING (browser-navigator). Tenant kan ha browser på engelsk men foretrekke svensk for offisiell kommunikasjon. Eller motsatt. Vi har ingen måte å vite det på.

Iter 19.9 endrer dette én gang for alle:
- **Input** (`tenant.locale`) blir et eksplisitt brukervalg, ikke en heuristikk
- **Output** (`resolveLocale()` i `notify-email.ts`) leser fortsatt bare `tenant.locale` — men nå med garanti om at verdien er bevisst valgt av brukeren
- **Konsekvens:** Den åpne "produksjons-locale-strategi"-beslutningen som var planlagt utsatt til "i morgen" forsvinner — Iter 19.9 svarer på den implisitt. Ingen separate beslutninger gjenstår. Punktet er **LØST** ved levering av Iter 19.9.

### Mike's spec (mottatt verbatim 2026-06-13)

> **PLASSERING:** Samme registreringsbilde som subdomain + e-post-valg. Ny rad: "Velg språk for kommunikasjon"
>
> **UI:** 4 avkrysningsbokser på rad (IKKE dropdown): `[ Norsk ]  [ Svensk ]  [ Dansk ]  [ English ]`. Kun ett valg mulig (radio-button-oppførsel, visuelt som checkbox-stil). Obligatorisk — kan ikke fullføre registrering uten valg.
>
> **LAGRING:** Lagres til `tenant.locale` ved kontoopprettelse, SAMME tidspunkt som subdomain/e-post lagres.
>
> **LÅSING:** Locale er LÅST etter registrering. Endres IKKE av at bruker bytter app-språk i Settings senere. Ingen kobling mellom app-språk og e-post-locale — bevisst avgrensning for å unngå synk-kompleksitet.
>
> **TIDSPUNKT:** Vurderes implementert FØR Iter 20 starter.

### Kartlegging av avhengighet (gjort 2026-06-13 — ikke startet bygging)

**Hva som finnes i dag (12 HTML-filer):**

| Mal | NO | EN | SV | DA |
|---|:-:|:-:|:-:|:-:|
| welcome | ✅ | ✅ | ❌ | ❌ |
| trial-reminder-t5 (A1) | ✅ | ✅ | ❌ | ❌ |
| locked-from-trial (A2) | ✅ | ✅ | ❌ | ❌ |
| locked-from-cancel (B1) | ✅ | ✅ | ❌ | ❌ |
| lifecycle-warning (A3) | ✅ | ✅ | ❌ | ❌ |
| deleted-confirmation (A4) | ✅ | ✅ | ❌ | ❌ |

**Omfang som MÅ leveres før UI-valget kan slås på:**
1. **12 nye HTML-mal-filer** (6 typer × 2 manglende språk SV+DA). Hver er ~60 linjer, ren oversettelse av eksisterende NO/EN-par + visuell QA via Resend.
2. **Utvide `resolveLocale()` i `lib/platform/notify-email.ts`** fra `"no" | "en"` → `"no" | "sv" | "da" | "en"`. Endrer signaturen til `formatDayWord()` og `formatDateOnly()` (i dag har de begge 2-veis branch på locale).
3. **Utvide `MailTestCard` språk-toggle** fra Auto/NO/EN → Auto/NO/SV/DA/EN (5 valg). Backend `localeOverride`-validator må også utvides.
4. **TypeScript-typer er allerede klare** — `lib/platform/types.ts` og `/api/register{,/paid}` aksepterer allerede `"no" | "sv" | "da" | "en"`. Ingen DB-migrasjon trengs.
5. **UI-implementering i `/platform/register`** — 4 visuelle radio-knapper med checkbox-stil (bruk `RadioGroup` fra shadcn — sjekk om eksisterer eller bygg custom). Bind til ny `selectedLocale`-state. Send `locale: selectedLocale` til `/api/register{,/paid}`.

**Estimert arbeidsomfang:**
- Oversettelse: 12 HTML-filer × ~30 min/fil = ~6 timer (eller raskere med LLM-assistert oversettelse + Mike's QA-pass)
- Backend-utvidelse av `resolveLocale()` + format-helpers: ~1 time
- UI-implementasjon + validering: ~2 timer
- Tester (utvide eksisterende suiter til 4-språk): ~1 time
- Visuell QA via `MailTestCard` med 4 språk × 5 maltyper = 20 testmailer: ~1 time
- **Totalt: ~10-11 timer fokusert arbeid**

### Implementerings-rekkefølge (foreslått)
1. **Steg 1** — Mike bekrefter omfanget over og prioritet vs Iter 20.
2. **Steg 2** — Lever 12 SV+DA-mal-filer + oppdatert `resolveLocale()` + utvidet `MailTestCard`. **Stopp her** og la Mike QA-teste alle 20 testmailer via admin-panelet.
3. **Steg 3** — KUN etter Steg 2-godkjenning: bygg UI-radio-gruppen i `/platform/register`, fjern `useLocale()`-fallback for `body.locale`-feltet, sett obligatorisk validering.
4. **Steg 4** — Regresjonstest hele registreringsflyten (trial + paid) for alle 4 språk.

### Avklaringer (besluttet av Mike 2026-06-13)

1. **Initialverdi:** Feltet starter **HELT TOMT** ved mount. Ingen pre-utfylling fra `useLocale()`, browser-navigator eller annen fallback. Skjemaet kan ikke sendes inn før eksplisitt valg blant de fire alternativene.
2. **B2B-invite:** **Samme krav gjelder `/invite`-siden.** Gjenbruk samme radio-komponent + valideringsregel der TenantRecord skrives, slik at locale-håndteringen er identisk uavhengig av om kontoen opprettes via vanlig registrering eller B2B-invite. Backend-validering må også avvise tomme/manglende `locale` i `/api/invite/accept`.

### Tidspunkt
Mike er på sykehuset 2026-06-13. **Ingen utvikling før Mike er tilbake og gir eksplisitt go.** Specen + kartlegging + avklaringer er låst — agenten venter på grønt lys.

### Sikkerhetsnett
- Skulle Mike ønske å droppe SV/DA fra registrering på et senere tidspunkt: locale forblir i tenant.locale uansett, og `resolveLocale()`-fallback gir norsk. Ingen tap av data.
- D-070 (Stripe customer-bevaring) gjelder uavhengig av locale-valg.

---

## 🎯 v4.3 (TIDLIGERE PLAN — Pre-Utviklingsplan, beholdt for historikk)

### Fortelling: Anna registrerer som ny kunde

> *"Anna er advokat i Oslo, hørte om Ko|Do Vault fra Lars. Hun går til kodovault.no, klikker 'Start gratis prøve'.*
>
> *Hun fyller ut: Master-passord (én gang) + bekreft. Det er det. Ingen e-post-felt, ingen 'velg plan', ingen bekreftelses-e-post.*
>
> *Stripe-side åpnes for kortinfo (kun for å starte 30-dagers prøve — ikke trekkes før dag 31). Hun skriver kortet sitt.*
>
> *App genererer hennes tenant-ID basert på master-passordet (v4.4 auth-modell). Hun blir omdirigert til sin egen Ko|Do-instans.*
>
> *Dag 30: Stripe sender én e-post: 'Din prøve avsluttes i morgen. Vi vil belaste 129 kr/mnd. Avbryt her hvis du ikke vil fortsette.'*
>
> *Hun fortsetter. Stripe trekker 129 kr/mnd automatisk. Mike får utbetaling til Me & Max AS-konto månedlig."*

### Teknisk skisse

- **Stripe Subscriptions** med 30-dagers gratis prøve (`trial_period_days: 30`)
- **Plan:** Én enkelt SKU — "Ko|Do Vault Premium" — 129 kr/mnd
- **Currency:** NOK primær, EUR/SEK/DKK auto-konvertert av Stripe basert på kunde-locale
- **MVA:** Stripe Tax håndterer Norsk MVA automatisk
- **Customer-portal:** Stripe sin innebygde portal for kunder å se faktura, oppdatere kort, kansellere
- **Webhook-håndtering:** `customer.subscription.deleted` → suspender tenant-tilgang etter grace-periode
- **Forhold til v4.4 (auth):** Tenant-ID = hash av master-passord (v4.4-modell). Stripe customerId kobles til tenant-ID i en separat liten lookup-tabell

### Åpne arkitektur-spørsmål

1. **Hva skjer med data ved kansellering?** 30-dagers grace + sletting? Eller forever-archive?
2. **Refund-policy?** Pro-rata ved kansellering, ingen refund, eller 14-dagers full angrerett?
3. **Hva med bytte mellom Mac og iPhone?** Auth-modell må håndtere "samme tenant, flere enheter" trivielt
4. **Plan-oppgradering ved v5.0 (dokument-laget)?** Inkludert i 129 kr eller separat add-on? — Mike's instinkt: inkludert
5. **Volume pricing?** Hvis Lars vil ha 5 lisenser til kontoret hans — separate kunder eller én faktura?

---

## 🎯 v4.4 — Autentiseringsarkitektur (NY 2026-05-26 — kritisk)

**Status:** Planlegging. **Master-passord som identifikator (Alternativ A).** Må være på plass FØR v4.5 (auto-deployment).

**ADR:** Formalisert i [D-035](./DECISIONS.md#d-035) — master-passord som identifikator, ingen e-post.

### Hvorfor dette ikke kan utsettes

WebAuthn PRF + Touch ID-flyten i dagens v3.x bruker `clientDataHash` derivert fra credential-ID som ankerpunkt. Hvis vi introduserer e-post som identifikator, må vi enten:

a) **Lagre e-post i klartekst på server** → bryter D-001 (zero-knowledge)
b) **Hash e-posten og lagre hashen** → fortsatt PII-eksponering, og hash kan brute-forces (alle e-poster i verden er en liten search-space)
c) **Bruke e-posten kun til kommunikasjon, ikke auth** → fungerer, men da må vi finne ANDRE identifikator for auth

**Beslutning:** Master-passord SOM identifikator. Brukeren får ALDRI spørsmål om e-post under auth. Tenant-ID derives fra en stable hash av master-passordet (med tenant-specific salt).

### Fortelling: Anna logger inn fra Mac OG iPhone

> *"Anna har Ko|Do Vault på Macen sin (registrert v4.3). Master-passord: `frosk-tunnel-stjerne-92`.*
>
> *Hun vil bruke appen på iPhonen også. Åpner kodovault.no på iPhone-Safari → 'Logg inn'.*
>
> *App spør: master-passord. Hun skriver `frosk-tunnel-stjerne-92`. Tenant-ID deriverte til samme verdi som på Macen. Hun ser sin egen vault.*
>
> *Ingen e-post-felt. Ingen 'check your inbox'. Ingen passord-resett-flow (det ville bryte zero-knowledge).*
>
> *Touch ID kan så aktiveres på iPhone som andre device — separat WebAuthn-credential, men samme master-passord wrappet via PRF."*

### Teknisk skisse (åpen — egen design-runde med Mike før implementasjon)

- **Tenant-ID derivation:** `tenantId = HMAC-SHA256(masterPassword, tenantSpecificSalt)`
- **Tenant-specific salt:** Lagret i app-config, samme for alle brukere på samme tenant
- **Risiko:** To brukere med samme master-passord på samme tenant → samme tenantId → de ser hverandres data
  - **Mitigering:** Selv om master-passord er 16+ tegn random, sjansen for kollisjon er ~0 (2^96 entropi etter PBKDF2)
  - **Tilbakefall:** Hvis kollisjon skulle skje, ingen av brukerne kan dekryptere den andres data uansett (egne IV-er) — datalekkasje er IKKE mulig, kun "merkelig oppførsel" som flagges av app
- **Passord-resett:** Eksisterer ikke. D-001 sier zero-knowledge, og vi kan ikke resette noe vi ikke vet.
- **Multi-device:** Samme master-passord → samme tenantId → samme Upstash-key. Touch ID per device.

### Åpne arkitektur-spørsmål

1. **Hvordan håndterer vi "brukeren glemte master-passord"?**
   - Forslag: Backup-import. Hvis backup-fila har annet master-pwd enn det glemte, smart re-kryptering finner ut av det (D-021)
   - Hvis ingen backup: data er tapt. Som med ekte zero-knowledge.
2. **Kan to forskjellige tenant-konfigurasjoner ha overlappende master-passord?**
   - Ja — tenantSpecificSalt skiller dem
3. **Hva med kollisjons-deteksjon?**
   - Trolig overkill — sjansen er ~0
4. **Hva med "remember me" på iPhone/Mac uten Touch ID?**
   - Diskuteres senere — kan kreve cookie-basert session-token som ALDRI inneholder master-pwd
5. **Stripe customerId mapping?**
   - Egen liten lookup-tabell: `{tenantId} → {stripeCustomerId}`, ingen PII
6. **Multi-tenant overskrift med dette?**
   - Hver tenant er sin egen Vercel-deployment med egen `tenantSpecificSalt`. Default-tenant (single-user mode) får default-salt.

---

## 🌳 v4.5 — Lean Security som tjeneste (auto-deployment, GREN 2, løftet 2026-05-26)

**Status:** Planlegging. Forutsetning: v4.3 (penger) + v4.4 (auth) må være ferdig. Tidligere v5.0 — løftet hit fordi den er kjernen i kommersiell skalering.

### Fortelling: Mike onboarder en ny kunde uten å løfte en finger

> *"En tirsdag formiddag får Mike en e-post: 'Hei, jeg er Bjørn fra Bergen, advokat. Hørte om Ko|Do Vault — kan jeg prøve?'*
>
> *Mike sender en link: kodovault.no/start. Bjørn klikker.*
>
> *Self-serve flow:*
> *1. 'Velkommen — sett ditt master-passord' (v4.4 auth)*
> *2. 'Vi tar 0 kr nå, 129 kr/mnd fra dag 31. Avbryt når du vil.' (v4.3 Stripe)*
> *3. App genererer hans tenant: `bjorn-XXX.kodovault.no` (eller `bjorn-XXX.kodovault.com`)*
> *4. Vercel-API kalles automatisk: ny deployment med Bjørn sin config-fil i 30 sek*
> *5. Bjørn får velkomst-skjerm med 'Vault klar — start med å legge til ditt første passord'*
>
> *Mike får en notifikasjon: 'Ny kunde Bjørn, trial-start 2026-09-15.' Han trenger ikke gjøre noe.*
>
> *Slik skalerer Lean Security uten Mike som flaskehals."*

### Teknisk skisse

- **Self-serve onboarding-skjerm** på kodovault.no (eller hovedapp)
- **Vercel API-integrasjon:** Programatisk ny deployment per kunde
- **Tenant config:** Auto-generert JSON-fil basert på master-passord + Stripe customer
- **DNS:** Wildcard `*.kodovault.no` med tenant-routing i Vercel-konfig
- **KoDo-Editor:** Mike's interne tool for å se/redigere tenant-configs (oversikt over alle aktive tenants)
- **Brand-fortelling:** "Lean Security · Not Security as a Service" (per kodovault.no)

### Hvorfor v4.5 ikke v5.0 lenger

Mike's egne ord (parafrasert 2026-05-26): *"Auto-deployment må komme før dokument-laget. Penger må strømme inn før vi bruker måneder på BYO Drive. Stort scope kan vente — kommersiell validering kan ikke."*

---

## 🌳 v5.0 — BYO Dokument-laget (GREN 3, flyttet ned 2026-05-26)

**Status:** Planlegging utsatt. Tidligere v4.5 — flyttet til v5.0 fordi det er stort scope og avhenger av at kjernen (v4.2 språk + v4.3 betaling + v4.4 auth + v4.5 auto-deploy) er moden og kommersielt validert.

**Pre-design skisse fortsatt gyldig:** `/app/memory/v4.5-DESIGN.md` (klar 2026-02). Filnavnet beholdes for tracking av tidligere design-arbeid.

> 📖 **For komplett fortelling og teknisk skisse:** Se [`🌳 v4.5 — Dokument-laget (GREN 2)`](#-v45--dokument-laget-gren-2) lenger nede. Den seksjonen beskriver Lars som monterer en virtuell sikker disk via Google Drive — selve essensen av v5.0. Filnavnet `v4.5-DESIGN.md` og den nedre seksjonens overskrift er historiske artefakter fra før versjons-rekkefølgen ble revidert 2026-05-26.

### Åpne arkitektur-spørsmål (utsatt til v5.0-planlegging)

1. **OAuth-scope:** `drive.file` (kun Ko|Do-egne filer) vs `drive.appdata` (skjult app-mappe) — påvirker brukerens kontroll og Google sin trust-screen
2. **Container-strategi:** Én stor `.kodoenc`-blob i Drive, eller flere mindre per dokument-gruppe? Bygger på [D-009](#d-009-bruker-kontrollert-container-gruppering-v40v45)
3. **Konflikt-håndtering:** Hva hvis to enheter endrer Drive-blobben samtidig?
4. **Dropbox/iCloud Drive/USB:** Same arkitektur eller per-provider-adapter?
5. **Egen lås for dokument-laget?** PIN/passord/biometric — Mike instinktivt "tja/nei"

---

## 🌳 v4.0 ⏭ NESTE — Sikker overlevering (GREN 1)

**Status:** Planlegging — dette er neste store milepæl. Mye av pakke-flyten er allerede bygd i v3.0.5 (validate pwd → decrypt → re-encrypt) og kan gjenbrukes for `.kodoenc`-eksport.

**Status:** Planlegging. Skal gjøres etter v3.1 + v3.2.

### Fortelling: Lars sender en pakke til Anna

> *"15:00. Lars trenger å sende 12 sider klient-grunnlag til motpartens advokat Anna før mekling.*
>
> *Han åpner Ko|Do Vault → klikker '✉️ Send pakke' i sidebar.*
>
> *Drar 12 PDF-er inn. App spør: 'Hvem er mottaker?' (kun for Lars sin egen logg, IKKE i pakken).*
>
> *App genererer ETT sterkt engangs-passord, vist på skjermen ÉN gang:*
> *'K7-3F-MX-92-RH-8N'*
>
> *Med en advarsel:*
> *'⚠️ Dette passordet vises ikke igjen. Send det på SIKKER kanal — IKKE i samme e-post som filen. Pakken lever evig — har du sendt den fra deg, kan du IKKE trekke den tilbake. Slik er kryptografi.'*
>
> *App krypterer alt LOKALT med dette ene passordet (PBKDF2 + AES-256-GCM, akkurat som hovedvault'en). Lager filen `pakke-2026-02-15.kodoenc` (12 MB).*
>
> *Lars laster ned filen til Mac → sender via e-post til Anna → ringer henne og leser passordet høyt over telefon.*
>
> *Anna mottar e-posten. .kodoenc-filen er bare bytes for hennes Mac. Hun går til kodo-vault.com → klikker 'Pakk ut pakke' (ingen konto, ingen registrering).*
>
> *Drar .enc-filen inn → skriver passordet → 12 PDF-er pakkes ut i nettleserens minne. Hun kan se dem direkte eller laste ned ukrypterte kopier til sin Mac.*
>
> *Pakken er nå hennes. For evig. Hun kan slette den, lagre den, sende den videre — det er hennes ansvar.*
>
> *Lars vet dette og fortalte henne det da han ringte: 'Slett den når du er ferdig. Jeg kan ikke trekke det tilbake.'"*

### Teknisk arkitektur (minimal kompleksitet)

- **Frontend:** Pakke-bygger UI + receiver-flyt på samme app
- **Backend:** **NULL** — ingen server, ingen API-endpoints (bygger på D-003)
- **Filformat:** `.kodoenc` med versjonshode + salt + iv + cipher
- **Mottaker trenger:** Bare nettleseren + filen + passordet
- **Container:** ZIP STORE (D-007) for mappe-struktur
- **Funker offline** for mottaker (kan pakke ut i fly-modus etter første lasting)

### Hvorfor dette er sterkere enn "expiry"-versjoner

- Mottaker stoler ikke på vår server (vi har ingen)
- Lars stoler ikke på vår server
- Ingen kan miste data hvis Ko|Do legges ned
- Ingen GDPR-bekymring (vi ser aldri pakke-metadata)
- Ren historie å fortelle Lars: *"Akkurat som PGP, men brukervennlig"*

### Åpne arkitektur-spørsmål

1. **Filendelse `.kodoenc`** — eller noe mer generisk?
2. **Receiver-URL** — `kodo-vault.com/unpack` eller egen subdomene?
3. **Maks pakke-størrelse?** 100 MB? 500 MB? 1 GB? (avhenger av nettleser-minne)
4. **Skal pakker kunne ha "tittel"** synlig før opning, eller skal alt være ukjent?
5. **Lars sin egen logg av sendte pakker** — hvor lagres den (i hovedvault'en?)
6. **Skal vi tilby "standalone HTML-decryptor"** for paranoide brukere som vil pakke ut offline?

---

## 🌳 v4.5 — Dokument-laget (GREN 2)

**Status:** Planlegging utsatt — venter på erfaring fra v3.0 og v4.0.

### Mental modell (D-006)

> *"Dokument-laget er en virtuell sikker disk. Du monterer den med master-passordet, jobber med filene mens den er montert, og demonterer den (auto-lås). Når den er demontert, finnes filene IKKE — kun den ene krypterte blob-en på Drive."*

### Foreløpig fortelling (skisse, ikke endelig)

> *"Tre måneder senere har Lars brukt v3.0 (passord + ID-er) og v4.0 (sikker overlevering) i daglig drift. Han er klar for neste lag.*
>
> *Innstillinger → 'Aktiver Dokument-laget' → 'Koble til Google Drive'. OAuth-vindu (scope `drive.file` — vi får KUN se filer Ko|Do selv har laget).*
>
> *Ny fane: 📁 Dokumenter. Tomt arkiv. Lars klikker '+ Ny mappe' → 'Hansen-saken'. Drar 'Skannet-NDA.pdf' inn → krypteres lokalt → del av virtuell mappe-struktur.*
>
> *Skriver et notat 'Strategi-utkast.md' i innebygd Markdown-editor — ren tekst, kun i RAM. Cmd+S → hele containeren krypteres → opp til Drive som `kodo-vault-docs.enc`.*
>
> *Drive-server vet INGENTING — bare 12 MB binær.*
>
> *Neste dag på iPad: Touch ID → 📁 Dokumenter → containeren lastes ned fra HANS Drive → dekrypteres lokalt → han ser mappene som om de er ekte filsystem.*
>
> *Auto-lås kicker inn → RAM tømmes → filene 'forsvinner' fra iPad. Bare .enc-filen på Drive er igjen."*

### Teknisk skisse (gjenbruker v4.0 + v3.0)

- Google Drive OAuth (`drive.file` scope, minimum-rettigheter)
- Container-format: ZIP STORE (D-007) → AES-256-GCM
- Lazy-loaded — kun ved klikk på 📁 Dokumenter
- Innebygd editor: Markdown for tekst, PDF.js for PDF, bilde-viewer
- Eksterne formater (Word/Excel): Sikker download-flow med auto-slett
- Cross-device: Drive sync betyr endringer synes på alle enheter
- BYO: Lars kan migrere til Dropbox/iCloud/USB ved å flytte .enc-filen

### Åpne spørsmål (utsatt diskusjon)

Disse skal vi diskutere ETTER v3.0 + v4.0 er ferdig og vi har lært:

1. **Container-strategi** — én stor container, gruppert per kategori, eller per-fil?
2. **Bruker-kontrollert gruppering** — UX-dialog med tidsestimater?
3. **Streaming vs in-memory** — maks filstørrelse vi støtter?
4. **Mobil-minnegrenser** — iPhone/Android-begrensninger
5. **Concurrent editing** — to enheter endrer samme container?
6. **Per-fil thumbnails** — egne små krypterte blobs eller dekrypt hele?
7. **Egen lås for Dokument-laget?** PIN/passord/biometric — Mike instinktivt "tja/nei"
8. **Word/Excel sikker editing-flow** — hvor lang auto-slett-timer?

### Sammenheng v4.0 ↔ v4.5

```
v4.0 (Sikker overlevering)        v4.5 (Dokument-laget)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Engangs-overføring                 Permanent oppbevaring
.kodoenc-fil                       .enc-blob på MIN Drive
1 mottaker                         Bare meg
Passord deles på SMS               Master-passord + Touch ID
Lever for evig hos mottaker        Lever til JEG sletter
Ingen Ko|Do-server                 Ingen Ko|Do-server (Drive er brukerens)

DELT KODE-MOTOR (~90% gjenbruk):
• Samme PBKDF2 + AES-256-GCM
• Samme ZIP STORE container-format
• Samme innebygd editor + PDF viewer
```

---

## 🌿 vX.X — Smart Topp 10 (NICE-TO-DO, beslutning utsatt — se D-019)

**Status:** Tankene fanget, beslutning åpen, ingen build planlagt før etter v3.x. Lever som "Nice-to-Do" til Mike eller Lars konkret savner det.

### Fortelling: Lars og hans 10 favoritt-oppføringer

> *"Lars har 87 oppføringer i vault-en. Men det er 10 av dem han bruker hver eneste uke: Compendia, BankID, Microsoft 365, AMEX, klient-portalen, e-post, Schibsted, Outlook, NRK-konto, Vipps.*
>
> *I dag må han enten scrolle gjennom alle 87 i Liste-modus, eller huske hvilken kategori "Compendia" ligger i og åpne den i Gruppert-modus.*
>
> *Med Smart Topp 10 får han en tredje knapp ved siden av Liste/Gruppert: 🔥 Topp 10. Den viser de 10 oppføringene appen har lært at han bruker mest, sortert etter en kombinasjon av frekvens og hvor nylig.*
>
> *Han åpner Compendia 4 ganger om dagen → den ligger på toppen.*
> *Han åpner SAS Eurobonus en gang i kvartalet → den dukker ALDRI opp på Topp 10, selv om han har klikket den 12 ganger totalt.*
>
> *Han bytter telefon. Logger inn på den nye iPhonen med Touch ID. Topp 10-listen er allerede oppdatert — fordi den lever globalt i Upstash, ikke lokalt på enheten."*

### Hvorfor dette er en stor byggeprosess

Mikes egne ord: *"Dette er en stor byggeprosess hvis den skal virke riktig og virke."* Helt riktig — her er hvorfor:

1. **Måle riktig** — vi må fange klikk-events uten at det føles tregt
2. **Score riktig** — naive teller (count) gir feil resultater (en oppføring brukt 50 ganger for 6 mnd siden vs. én brukt 5 ganger denne uka)
3. **Vekte riktig** — eksponentiell decay krever halveringstid som passer Lars (14d? 30d? konfigurerbart?)
4. **Kryptere riktig** — egen blob, ikke i passord-blob (D-001 + D-002-mønster)
5. **Trimme riktig** — gamle events må forfalle, ellers vokser blob-en uendelig
6. **Batche riktig** — hver klikk = Upstash-skriv vil drepe ytelsen og kvoten
7. **Cross-device-sync** — Mac og iPhone må se samme topp 10
8. **UX riktig** — hva hvis brukeren ikke har 10 oppføringer ennå? Hva hvis hen IKKE har klikket noe siden setup?

### Diskusjon: Lokal vs. Global (2026-05-05)

**Mike's konklusjon:** *"For meg er eneste løsning D — ellers er det ikke globalt og det skal det være. For gjennom overvåking så kan man bygge en topp 10 som treffer 90% av hans behov. Og så er vi enig i at dette IKKE kan ligge i eksisterende blobs — jeg mener skal man ha dette så egen BLOB."*

Vurderte alternativer:

| | (a) RAM-only | (c) Lokal kryptert | (d) Global egen blob |
|---|---|---|---|
| **D-001 100% sikkerhet** | ✅ | ✅ | ✅ |
| **Cross-device** | ❌ | ❌ | ✅ |
| **Server-skriv per klikk** | 0 | 0 | 1 (m/ batching: ~0.2) |
| **Overlever auto-lås** | ❌ | ✅ | ✅ |
| **Treffer Lars 90% av tiden** | Nei (mister data per session) | Delvis (per device) | ✅ |

**(b) ukryptert localStorage** ble forkastet umiddelbart — lekker bruksmønster til alle med fysisk tilgang til enheten, bryter D-001.

**Valgt:** (d) — global, egen kryptert blob.

### Hvor lenge skal vi spare data — tre filosofier

Mike's spørsmål: *"Hvor lenge skal man spare på data for å bygge topp 10?"*

**1. Glidende vindu (siste N dager)**
   - Hard cutoff: f.eks. "kun siste 30 dager"
   - **Ulempe:** "magisk dato" der gamle data plutselig forsvinner kan gi rare bumper i listen

**2. Eksponentiell decay (ingen hard cutoff)**
   - Hver klikk-event veies ned med tiden: `score = sum(e^(-Δt/halflife))`
   - Halveringstid f.eks. 14 dager (konfigurerbar fra `default.json`)
   - Eksempel:
     ```
     I dag (10:00):       vekt = 1.000
     I går:                vekt = 0.952  (e^(-1/14))
     For 14 dager siden:   vekt = 0.368  (e^(-1))
     For 30 dager siden:   vekt = 0.117
     For 60 dager siden:   vekt = 0.014  (forkastes)
     ```
   - **Klassisk score-algoritme** brukt av Reddit, Hacker News
   - Bounded: trimm events eldre enn `5 × halflife` (≈ 70d med 14d halflife) — alt som er igjen har neglisjerbar vekt
   - **Min innstilling**

**3. Råe events for alltid**
   - Lagrer `{entryId, timestamp}` for hver klikk uten forfall
   - **Avvises:** vokser uendelig (5 klikk/dag × 5 år = 9000 events), ikke lean

### Foreløpig teknisk skisse (utgangspunkt for samtale når det blir aktuelt)

```
Egen Upstash-key:    vault:default:usage
Format:              { events: [{ id, ts }], updatedAt }
Kryptering:          AES-256-GCM, samme master-passord, EGET salt (D-002-mønster)
Skriv-trigger:       Hver gang oppføring åpnes via EntryModal
Batch-strategi:      Buffer 5 klikk i RAM → push samlet (eller 30s debounce)
                     → reduserer Upstash-skrivinger med ~80%
Lazy-loading:        Lastes kun ved unlock + når Topp10-fanen er aktiv
Trim-jobb:           Ved hver lasting: dropp events eldre enn 70d
Halveringstid:       config.smartList.halflifeDays (default 14)
UI:                  Tredje toggle ved siden av Liste/Gruppert: "🔥 Topp 10"
                     Ren liste, sortert etter score, ingen score vist for brukeren
Tom-state:           "Bruk vault-en i en ukes tid, så finner jeg dine 10 mest brukte for deg."
Estetikk:            Kategori-fargeprikker beholdes (gjenkjennelse)
```

### Åpne spørsmål når dette skal bygges

1. **Halveringstid 14 dager — riktig for Lars?** Eller burde det være kortere (7d) for å være mer responsivt?
2. **Topp 10 eller variabelt antall (5-15)?** Kan brukeren velge?
3. **Hva hvis vault har under 10 oppføringer?** Bare vis dem alle, eller skjul fanen?
4. **Skal Topp 10 være default-modus etter 30 dagers bruk?** Eller alltid Liste som default?
5. **Skal en oppføring opprettet for 10 minutter siden være "synlig" allerede?** Eller må den klikkes minst én gang for å telle?
6. **Search vs. Topp 10 i samme rad?** Tre-knapps-toggle blir trangt på mobil — skal vi ha overflow-meny eller scrolle?
7. **Skal "Topp 10" fungere SOM Cmd+K-mode** (åpnes via shortcut og viser topp 10 med ett klikk)?

### Hva som blokkerer en beslutning nå

- Vi vet ikke ennå om brukeren faktisk savner dette (87 oppføringer er teoretisk — Lars må først ta det i bruk)
- v3.0 (Cards) og v3.1 (TOTP) er mer akutte for Mikes daglige bruk
- Bygger vi dette FØR vi vet om det trengs → feil prioritering
- Kan parkeres trygt nå — ADR D-019 fanger tankene for fremtidige agenter

### Når dette eventuelt løftes til vX.X-prioritet

Triggere som flytter dette fra Nice-to-Do til Planning:
- 🔔 Mike eller Lars sier eksplisitt "jeg savner topp 10" eller "jeg scroller for mye"
- 🔔 Vault passerer ~50 oppføringer hos en aktiv bruker
- 🔔 Vi har data fra v2.0 event-loggen som viser "scroll-time" eller "search-uten-treff" øker

Inntil da: lev videre i ROADMAP under Nice-to-Do.

---

## 🌿 vX — Journalist-modus (KVIST, kanskje aldri)

**Status:** Holdt på avstand. Krever helt andre features og vil "smitte" arkitekturen hvis vi ikke er forsiktige.

**Mulige features:**
- Decoy-mode (falsk vault ved tvang)
- Self-destruct (slett alt etter X feilede passord)
- Tor-kompatibilitet
- Plausible deniability (kryptografisk ikke-bevisbart at vault'en eksisterer)
- Air-gap-modus (100% offline operasjon)

**Hvorfor ikke nå:**
- Krever andre kompromiss enn advokat-persona
- Audit-log (D-005 advokat-behov) er **i konflikt** med "ingen audit-trail mot brukeren" (journalist-behov)
- Sletting med audit (advokat) vs. permanent uoppdagelig sletting (journalist)
- Ville krevd separat produkt-track

**Hvis dette noen gang skjer:** Det blir antakelig et separat produkt med samme krypto-motor, ikke en feature i Ko|Do Vault.

---

## 📊 LinkedIn / markedsføring

**Status:** v6 publisert 2026-05-05 (Mike sin LinkedIn-profil). Linken til kodovault.no lagt som første kommentar (siden Pin Comment ikke var tilgjengelig).

### Tekst-utkast v6 — PUBLISERT (2026-05-05)

Ferdig formatert med Unicode-bold (LinkedIn-kompatibel). Ydmyk-tone-konflikt diskutert: Mike beholdt 1Password/LastPass-sammenligning bevisst fordi *"trash talk er nødvendig for å vise forskjellen mellom det som finnes og det som jeg har bygget. Det forklare grunnen til at ting ble til."*

```
𝗟𝗲𝗮𝗻 𝘀𝗲𝗰𝘂𝗿𝗶𝘁𝘆 — 𝗶𝗸𝗸𝗲 𝘀𝗲𝗰𝘂𝗿𝗶𝘁𝘆-𝗮𝘀-𝗮-𝘀𝗲𝗿𝘃𝗶𝗰𝗲

Hvorfor jeg bygger min egen passord-vault - Jeg ville ha ett sted for sensitiv info. Punktum.

Ikke et økosystem med team-management, watchtower og 47 andre ubrukte features, pent pakket for å rettferdiggjøre et evigvarende abonnement. 1Password og LastPass er "one size fits all" som faktisk passer ingen. Så jeg bygger et alternativ.

Møt 𝗞𝗼|𝗗𝗼 · 𝗩𝗮𝘂𝗹𝘁: Lean security, ikke security-as-a-service.

𝗦𝘁𝗮𝗰𝗸: Next.js 15, React 19, TS, Tailwind, Upstash, Vercel.
𝗞𝗿𝘆𝗽𝘁𝗼: PBKDF2-SHA256 (600k iter.) → AES-256-GCM. Hele vaulten krypteres som én blob før den forlater nettleseren. Zero-knowledge.
𝗔𝘂𝘁𝗵: Master-passord + WebAuthn PRF (Touch/Face ID), 14-dagers tving, 15-min auto-lås, clipboard-tømming.
𝗔𝗿𝗸𝗶𝘁𝗲𝗸𝘁𝘂𝗿: Ingen klient-app eller versjons-konflikter. Blob-en lever i skyen og hentes i sanntid via nettleser på alle enheter.

𝗗𝗲𝘁 𝗷𝗲𝗴 𝗶𝗸𝗸𝗲 𝗳𝗮𝗻𝘁 𝗻𝗼𝗲 𝘀𝘁𝗲𝗱:
▸ Hurtige passord i sky: 1Password/Bitwarden ✅ → Ko|Do ✅
▸ BYO Drive for dokumenter: Cryptomator ✅ → Ko|Do ✅
▸ Begge i 𝗦𝗔𝗠𝗠𝗘 app: Ingen ❌ → Ko|Do ✅
▸ Web-basert (multi-device, null install): Ingen ❌ → Ko|Do ✅
▸ Norsk språk: Knapt noen ❌ → Ko|Do ✅
▸ Zero-knowledge på 𝗯𝗲𝗴𝗴𝗲 lag: Ingen ❌ → Ko|Do ✅
▸ Ingen vendor-abonnement: ⚠️ $3-5/mnd → Ko|Do ✅ ~$0,45/mnd

𝗩𝗶𝘀𝗷𝗼𝗻𝗲𝗻 𝗲𝗿 𝗲𝗻𝗸𝗲𝗹:
🔑 Passord/ID (lite, brukes ofte) → Kryptert blob i Upstash, via nettleser.
📁 Dokumenter (stort, sjelden brukt) → Krypteres lokalt, lagres som én .enc-fil på din egen Google Drive.

Drive ser kun binær. Du eier dataene 100%. Bytter du sky, flytter du bare filen. Samme master-passord låser opp begge lag. Ingen app, ingen sync-konflikter, ingen "venter på opplasting".

🛠️ 𝗦𝘁𝗮𝘁𝘂𝘀:
v2.9.5 i prod.
v3.0 (Kort/ID) utvikles.
v4.0 (Sikker overlevering P2P) på roadmap.
v4.5 (BYO Drive-integrasjon) på roadmap.

𝗦𝗽ø𝗿𝘀𝗺å𝗹 𝘁𝗶𝗹 𝗻𝗲𝘁𝘁𝘃𝗲𝗿𝗸𝗲𝘁:
Ser dere det samme gapet i markedet, eller overtenker jeg en søndag morgen? Bygger noen på lignende ideer? Og særlig: hvor ville dere trukket grensen mellom "i sky" og "min egen Drive"?

#LeanSecurity #ZeroKnowledge #IndieHacker #NextJS #DataSuverenitet
```

**Første kommentar (call-to-action med link):**
```
🔗 Bli med på lista her: kodovault.no
```

### Bilder publisert (i `/app/frontend/public/linkedin/`)
1. Innloggingen (Mike's egen Hero-1.png)
2. zero-knowledge-light.png (mørk-til-lys bro)
3. architecture-light.png (full hybrid-arkitektur)

### Beslutninger underveis (2026-05-05)
- **Tone:** Ydmyk på landingsiden, men trash-talk OK i LinkedIn-post (Mike: forklarer hvorfor ting ble til)
- **Linkstrategi:** Pin Comment ikke tilgjengelig → link via første kommentar
- **Versjons-fakta:** v2.3 → v2.9.5, v3.0 = Cards (ikke Drive), v4.0 lagt til, v4.5 = Drive
- **Hashtags:** Kuttet fra 8 til 5 fokuserte
- **Tegn-status:** ~2 400 / 3 000 (LinkedIn-grense)

### Forventet konvertering (estimater fra agenten)
- ~70% av lesere ser førstekommentar med linken
- ~25% klikker
- ~50% av disse melder seg på waitlist via `kodovault.no`
- 100 lesere ≈ 10 påmeldinger · 500 lesere ≈ 50

---

## 🌱 Post-lansering / nice to have

- **Exit-survey i egen stack** *(foreslått 2026-06-14)* — I dag peker exit-survey-lenken i A4 (deleted-confirmation) til Mike sin Tally-form (`https://tally.so/r/0QG5ZA`, hardkodet i `lib/platform/notify-email.ts` → `EXIT_SURVEY_URL`). Kan flyttes inn i egen stack senere: `POST /api/exit-survey` mot Upstash + minimal feedback-side på `/exit-survey`. Fordel: GDPR-vennlig (alt under norsk/EU-kontroll), svar-statistikk direkte i admin-dashboard, ingen tredjeparts-skjema-tjeneste. Ikke kritisk — Tally fungerer fint i lansering. *(~30 min jobb når aktuelt)*
- **Kortere auto-lock-terskel for standalone-modus** *(foreslått 2026-06-14)* — I dag har vault'en én felles auto-lock-terskel (15 min idle, fra `config.security.autoLockMinutes`). På delte familieenheter der vaulten er installert som PWA på hjemskjermen er angrepsoverflaten større — barn eller andre familiemedlemmer kan klikke på Vault-ikonet etter at forelder forlot appen åpen. Vurder å detektere `display-mode: standalone` og bruke en kortere terskel (f.eks. 5 min) der, samtidig som browser-tab beholder 15 min. Krever en config-utvidelse (`autoLockMinutesStandalone?: number`) + en `useIsStandalone`-hook + injisering i auto-lock-tellingen. *(~20 min jobb)*
- **Pris-historikk-audit-mekanisme** *(foreslått 2026-06-13)* — Logg hver `getPricing()`-endring (manuelle Stripe Dashboard-justeringer + framtidige kampanje-overrides) til en immutable audit-tabell i sentral-Upstash. Nyttig for Q&A og kunde-tvister i format "hva kostet abonnementet da kunden tegnet det". Bygges som en `lib/platform/audit.ts`-modul som `getPricing()` kaller asynkront ved endringer (sammenligning mot forrige verdi). Ikke kritisk — utsatt til etter lansering. *(~30 min jobb)*

---

## 🔮 Backlog (lavere prioritet, ikke planlagt versjon)

- **E-poststrenger sentralisering til `strings.ts`** *(foreslått 2026-06-13, ikke som del av Iter 19.9)* — I dag er e-postsubjekter, reason-tekster, fallback-navn og day-words hardkodet i `lib/platform/notify-email.ts` mens HTML-malene ligger som filer per språk. Hybriden er funksjonell og gir compile-tid-feil for manglende språk, men sprer oversettbar tekst på to steder. Mulig refaktorering: samle ALLE strenger i en ny `lib/platform/email-templates/strings.ts` med ett objekt per språk + bevart compile-tid-typesjekk. Vurderes etter Iter 19.9 + Iter 20-24 er stabile — IKKE blandes inn i samme QA-runde som ny mal-leveranse. Mike-direktiv: "unngå å blande refaktorering med ny mal-leveranse".
- **Win-back e-post dag 14 etter lock** *(foreslått 2026-06-13)* — Etter at lifecycle-løypen i Iter 17 låser en konto (trial-utløp eller cancel), har vi i dag 28 dagers vindu før hard delete. Iter 20-24 fokuserer på B2B/E2E — men når lifecycle-stacken er stabil, kan en *enkelt* "vi savner deg, du har 14 dager igjen før permanent sletting"-mail sendes på `lockedAt + 14d`. Mål: konvertere låste kunder tilbake til betalende abonnement før data forsvinner. Bygges som mal C1 i `email-templates/` (NO+EN) + ny `winBackSentAt`-felt på TenantRecord + cron-sjekk i `lifecycle-sweep`. **Ikke før Iter 20-24 er ferdig** — vi vil ha lifecycle-statistikk fra prod først for å vite om dag 14 er riktig tidspunkt.
- **Kampanje-bryter for trial-default** — admin-UI hvor Mike kan sette en midlertidig global `trialDays`-override (f.eks. "Black Friday: 0 dager — start abonnementet i dag") med valgfri start/slutt-dato. Skriver til en `campaign:trial-days`-nøkkel i Upstash som `getTrialDays()` sjekker FØR default.json. Auto-utløp basert på `expiresAt`. Logg endringer i audit-trail. *(Foreslått 2026-06-06)*
- **Sunnhets-rapport** — list svake/gjenbrukte passord (zxcvbn allerede installert)
- **Installerbar PWA** — service worker + manifest
- **Passord-historikk per entry** — se gammelt passord ved endring
- **Tenant-navn via Vercel env-var** — `NEXT_PUBLIC_TENANT` peker til `clients/<navn>.json`. Per kunde = eget Vercel-prosjekt = egen env-var. Null kode-endring per ny kunde. Krever D-018-tilpasning. KoDo-Editor håndterer JSON-redigeringen.
- **E2E-test på Vercel-prod** — full roundtrip-test med ekte device
- **Anonymisert audit-tabell (overlever deleteTenant)** — enkel sentral-Upstash-tabell som lever forbi tenant-sletting:
  ```
  { subdomainHash, plan, createdAt, lockedAt, deletedAt, totalPaidInvoices }
  ```
  - INGEN navn, e-post eller annen PII utover hash (hash sub via SHA-256 + sentral salt)
  - Formål: support-spor og tvistehåndtering uten å bryte zero-knowledge eller duplisere Stripe sin regnskapsfunksjon (som beholdes per D-070-revisjon 2026-06-13)
  - **Ikke implementer før B2B / Iter 21** — bare en backlog-post som påminnelse om at Mike og agent diskuterte dette i Iter 17-planleggingen 2026-06-13
  - Referanse: DECISIONS.md → D-070 REVISJON 2026-06-13 (Stripe customer-bevaring)
