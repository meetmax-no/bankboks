# Ko|Do · Vault — Known Bugs & Tech Debt

**Sist oppdatert:** 2026-02 (D-126 SA-config arv implementert)  
**Format:** [Severity] Bug-title → Beskrivelse → Filer → Status

Severity:
- 🔴 P0 — datatap eller sikkerhets-implikasjon
- 🟠 P1 — funksjonalitet brutt, men workaround finnes
- 🟡 P2 — UX/kosmetisk
- 🔵 Tech-debt — virker, men trenger refactor

---

## 🔴 P0 — Kritiske

*(Ingen åpne P0 per 2026-02)*

---

## 🟠 P1 — Funksjonelle

### B2 — Orphan-detection edge-case ved gjenoppretting av samme prefix
**Beskrivelse:** Hvis Mike sletter en B2B-parent og umiddelbart oppretter en ny med samme prefix, kan gamle org-admin-records / invites peke til "wrong parent" (via snapshot-FK `parentTenantCreatedAt`). Orphan-detection (`link_missing` / `child_missing`) skal fange det, men har edge-case ved race-condition.  
**Workaround:** Bruk Test Tools (`OrphanInvitesCard`) til å rydde manuelt.  
**Filer:** `lib/platform/orphan-detection.ts`, `lib/platform/invite-store.ts:markInvitesAsChildDeleted()`.  
**Status:** 🅱️ **BACKLOG** (Mike 2026-02 — kommer tilbake når T4-beslutning er tatt). Lavt hendelses-volum, akseptabelt for nå.  
**Tracking:** D-094, D-095, D-101

---

## 🟡 P2 — UX/kosmetisk

*(Ingen åpne P2 per 2026-06-29)*

---

## 🔵 Tech-debt

### T1 — TenantViewer.tsx er 4900+ linjer
**Beskrivelse:** Fila inneholder TenantList + CreateTenantForm + TenantDetailCard + CompanyDataSection + DarkSelect + Field + B2BField. Vanskelig å navigere, men fungerer.  
**Forslag:** Splitt til separate filer. Risiko: store diff, mange interne referanser.  
**Status:** Ikke planlagt — for risikabelt uten testing.

### T2 — `provisioningLog` i TenantRecord vokser ubegrenset
**Beskrivelse:** Hver lifecycle-event (invite-mail-sent, stripe-customer-sync, etc.) appendes til `record.provisioningLog`. Over tid blir TenantRecord-en stor (>100kB AES-payload).  
**Forslag:** Roter logg etter N entries, arkivér eldre i egen Upstash-key.  
**Status:** Lavt prioritet, vokser sakte. Vurder hvis Mike rapporterer perf-issue.

### T3 — ✅ ADRESSERT (D-121, 2026-06-29)
**Status:** Lint allerede grønt — 0 ubrukte literal-keys i no.json. Manuelt verifisert: alle 56 KEYS_EXEMPT_FROM_UNUSED-entries har gyldig kilde-referanse (fil finnes + dynamisk mønster fortsatt brukt). Ingen keys å fjerne. **D-121 hardener nå linten** med automatisk verifisering av exempt-oppføringer (kildefil må eksistere + statiske deler av template-mønsteret må forekomme i fila), så framtidige refactors ikke kan etterlate stale exempts uoppdaget.

### T4 — Test Tools eksponerer PII uten audit-log  
**Beskrivelse:** `OrgAdminListCard` og `OrphanInvitesCard` lar Mike-admin se ansatt-PII (navn, e-post) på tvers av tenants — som per D-078 ikke skal være mulig. Begrunnet som "nødvendig for orphan-cleanup", men det er ingen audit-log på bruken.  
**Filer:** `app/api/admin/org-admins/all/route.ts`, `app/api/admin/orphan-invites/all/route.ts`, `components/platform/OrgAdminListCard.tsx`, `components/platform/OrphanInvitesCard.tsx`.  
**Status: 🅱️ BACKLOG (Mike 2026-02)** — Mike kommer tilbake når han er klar. To alternativer venter:  
&nbsp;&nbsp;**(a)** Behold funksjonen + legg på audit-log (hver Mike-admin-tilgang loggføres med tidspunkt, prefix, formål). GDPR-konformt med revisjons-spor.  
&nbsp;&nbsp;**(b)** Slett funksjonen helt. Orphan-cleanup må gjøres via annen mekanisme (f.eks. automatisk cron eller server-side rydding uten UI-eksponering).  
Mike skal velge før noe gjøres. **Ikke implementer noen av delene før beslutning.** Ikke purrer videre.

### T5 — ✅ LUKKET (D-122, 2026-06-29)
**Status:** `OrgInvitesSection.tsx` slettet — viste seg å være dead code (kun referert i kommentarer, ikke importert noe sted). `InlineInviteForm` er nå eneste invite-skjema. billingPhase-blokkering håndteres i `EmployeeListSection`. 10 orphan i18n-keys ryddet (1483 → 1473). D-105-lint nå 316 filer (var 317).

---

## Lukket (referanse)

### Fixed 2026-02
- ✅ **D-141** Per-org fakturahistorikk for am-admin (Konsoll → Innstillinger → Fakturering): `InvoiceHistoryCard` (D-139) refaktorert med `endpoint`-prop slik at samme UI-komponent kan brukes av både super-admin (Mike) og firma-admins (am-admin). Nytt endepunkt `GET /api/am-admin/invoices?period=30d|90d|365d|all` speiler shape fra D-139, beskyttet av `requireAmAdmin` (både super-admin og admin har tilgang — org-aggregat, ingen PII per ansatt). `stripeCustomerId` strømmes gjennom `/api/am-admin/auth/me` → `KonsoletSettingsPanel` → `KonsollBillingTab` → `InvoiceHistoryCard`. Statisk QA: TSC ✓, lint:all 7/7 ✓ (ny EXEMPT-oppføring for D-141-ruten i coverage-matrix-lint), build ✓.
- ✅ **D-140** Send faktura feilet "This invoice is already finalized, you can't re-finalize a non-draft invoice" ved gjenklikk på "Bekreft og send" samme dag: D-133 idempotency-key returnerer samme invoice fra cachen, men den er allerede finalisert fra attempt 1 (`status="open"` eller `"paid"`). Vår kode kalte alltid `finalizeInvoice` uten status-sjekk. Fiks: branch-logikk på `invoice.status` etter create — `draft` → finalize+send; `open` → hopp over finalize, send (re-send e-post); `paid/void/uncollectible` → ingen handling (idempotency gjør jobben). MVA-diagnostikk og send-guard bevart. Testing-agent iter_36 100%.
- ✅ **D-139** Per-kunde fakturahistorikk i TenantDetailCard: nytt GET `/api/admin/tenants/[subdomain]/invoices?period=30d|90d|365d|all` kaller `stripe.invoices.list` med datofilter (default 90d). Ny `InvoiceHistoryCard.tsx` viser tabell (nummer, dato, status-badge, beløp, MVA, betalt-tidspunkt, PDF + hosted-link) + sum-rad i tfoot med total fakturert / total MVA / total betalt for valgt periode. Voided/uncollectible ekskluderes fra sum-amount/tax men inkluderes i count. Wired inn i "Stripe & Fakturaer"-tab for alle tenants med stripeCustomerId (B2C + B2B parents). Testing-agent iter_35 100%.
- ✅ **D-138** Real-world payload-matrise for webhook-event-handlers: utvidet `find-subdomain-event.test.ts` med eksplisitte assertions for 6 invoice.*-event-typer (paid, payment_failed, finalization_failed, marked_uncollectible, sent, voided) — alle bruker identisk metadata-shape som Mikes manuelle send-invoice-route. Verifiserer at D-137-fiksen treffer hele invoice-livssyklusen for D-080 manuell-faktura-flyten. customer.subscription.* utelatt fordi de strukturelt ikke kan treffe denne pathen. 15/15 PASS. Testing-agent iter_34 100%. Ingen kode-endring i event-handlers.ts — helperen var allerede payload-shape-drevet (ikke event-type-drevet).
- ✅ **D-137** Webhook `invoice.paid` oppdaterte ikke tenant-status etter manuelt sendt B2B-faktura: `findSubdomainFromEvent` søkte kun etter `metadata.subdomain` (klassisk subscription-flyt), men D-080 manuell send-invoice-route setter `kodo_subdomain` (namespaced for å unngå konflikt med Stripe's egne keys). Resultat: webhook returnerte `{ ok: false, detail: 'subdomain mangler' }` for hver manuelt sendte faktura → status forble uendret etter betaling. Fiks: utvidet helper til å støtte BÅDE `subdomain` (prioritet, backwards-compat) og `kodo_subdomain` (fallback) på alle 4 lookup-paths (direct metadata / subscription_details / lines.metadata / customer.metadata). 9 nye unit-tester PASS. Testing-agent iter_33 100%.
- ✅ **D-136** Send-faktura: (a) `tax_behavior: "exclusive"` la 25 % MVA på toppen (Mike fakturerte 6 525 i stedet for 522). Endret til `"inclusive"` så 522 ER kundens sluttpris og Stripe regner baklengs. (b) Fjernet "testfaktura"-betegnelsen fra UI/locale/logg/kommentarer — det er en ekte produksjons-faktura. Lagt til "(inkl. MVA)" på prisene i alle 4 språk. Testing-agent iter_32 100%.
- ✅ **D-135** Send-testfaktura fortsatte å feile selv etter D-131..D-134 (Stripe "cannot be sent right now"): to runtime-state-rotårsaker som ikke kunne fanges statisk: (a) ORPHAN INVOICE-ITEMS fra tidligere mislykkede forsøk lå i customer'ens pending-bucket og ble trukket inn i ny invoice av Stripe automatisk → brøt automatic_tax-beregning. (b) STALE IDEMPOTENCY-CACHE returnerte faulty pre-D-134-invoicer. Fikser: (1) Restrukturert flyt: `invoices.create` FØRST med `pending_invoice_items_behavior: "exclude"` → `invoiceItems.create` med `invoice: invoice.id` for eksplisitt binding. (2) `:v2`-suffix på idempotency-key. (3) Post-finalize MVA-diagnostikk: leser `finalized.automatic_tax.status`, kaster actionable Error med `disabled_reason` + customer-ID + Dashboard-instruks hvis ≠ "complete". Testing-agent iter_31 100%.
- ✅ **D-134** Send-testfaktura blokkert med MVA-oppsett-spørsmål i Stripe Dashboard: `invoices.create` manglet `automatic_tax: { enabled: true }` og `invoiceItems.create` manglet `tax_behavior: "exclusive"`. Stripe lot fakturaen ligge som draft fordi tax-status var udefinert. Fikset slik at 522 kr behandles pre-MVA + Stripe legger til 25% norsk MVA via Stripe Tax (basert på customer.address). Sameksisterer med D-131/D-132. Testing-agent iter_30 100%.
- ✅ **D-133** Idempotency-key på Stripe send-faktura-flyt: dobbeltklikk på "Bekreft og send" ville tidligere opprette to identiske fakturaer i Stripe. Stabil key per (tenant, billing, seats, dato UTC) påført både `invoiceItems.create` (suffix `:item`) og `invoices.create` (suffix `:invoice`). Testing-agent iter_30 100%.
- ✅ **D-132** Send-testfaktura feilet med Stripe "This invoice cannot be sent right now" på `invoices/.../send`-kall: race condition mellom `auto_advance: true` (som triggrer Stripes interne auto-finalize-and-send-pipeline) og vårt manuelle `finalizeInvoice + sendInvoice`-kall. Fiks: `auto_advance: false` (vi eier livssyklusen), eksplisitt finalize, og status-guard `if (finalized.status !== "open") throw` med deterministisk feilmelding i stedet for Stripes kryptiske respons. Sameksisterer med D-131. Statisk QA: TSC ✓, lint:all ✓ (7/7), build ✓. Testing-agent iter_29 100% (0 issues).
- ✅ **D-131** Send-testfaktura feilet med Stripe "type=recurring not allowed": `invoiceItems.create({ pricing: { price: priceId } })` brukte env-IDene `STRIPE_PRICE_B2B_SEMIANNUAL/_YEARLY` som er recurring subscription-priser i Stripe Dashboard — `invoiceItems` krever derimot `type=one_time`. Fiks: bygger nå invoice-item inline med `amount + currency: "nok"` basert på D-127 `getB2BPricing()` (522/1044 NOK × 100 → øre × maxLicenses). Description bærer per-seat-breakdown ("10 seats × 522 kr (semiannual)") så Stripe-UI fortsatt viser detaljer. Fjernet dead helper `getB2BPriceId()` fra `lib/stripe/client.ts`. Env-vars beholdes — `priceIdToPlan()` i webhook mapper dem til `b2b_*`-plan-verdier når en ekte subscription opprettes manuelt i Stripe Dashboard. Statisk QA: TSC ✓, lint:all ✓, build ✓.
- ✅ **D-130** Plan-konsistens-vakt for B2B-parents: ny lib `plan-consistency-guard.ts` med pure `isB2BWithB2CPlan()` + log-only `warnIfB2BHasB2CPlan(tenant, context)`. Logger via `console.warn` med stabilt prefix `[plan-consistency-guard]` når en B2B-parent har plan ∈ {trial, monthly, yearly}. Wired inn i (a) `/api/admin/tenants/[subdomain]/route.ts` PATCH etter `putTenant()`, og (b) `lib/stripe/event-handlers.ts` `handleSubscriptionCreated` + `handleSubscriptionUpdated` etter `putTenant()`. Søkbar via grep i Vercel-logs. Blokkerer ALDRI requests. 16 unit-tester PASS. Statisk QA: TSC ✓, lint:all ✓, build ✓.
- ✅ **D-129** PLAN-dropdown i TenantDetailCard viste alltid B2C-options (trial/free/monthly/yearly) — også for B2B parent-tenants. Resultat: Mike kunne ikke endre `mm-admin` til `b2b_yearly`/`b2b_semiannual` via UI uten DB-edit. Fikset ved å conditionalt bruke `getB2BPlanOptions(t)` når `record.customerType === "b2b" && record.parentTenant === null`. B2C-tenants og B2B children får fortsatt B2C-listen (riktig, children følger parent). Statisk QA: TSC ✓, lint:all ✓, build ✓.
- ✅ **D-128** Config-verktøy cascade + scope-refactor: a) ny modus `cascade-from-parent` som overskriver alle eksisterende B2B-ansatte med ferskt snapshot av sin SA-mal — løser at D-126-arv kun gjelder NYE ansatte. Valgfri scoping til én SA via `?parent=<prefix>`. Parent-config caches for å unngå N+1. b) Erstattet binær "Kun B2B parent-tenants (SA)"-checkbox med uavhengige togglar "Inkluder B2C" (default ON) + "Inkluder SA" (default OFF) for skip/merge/overwrite-all. B2B-ansatte er nå STRUKTURELT EKSKLUDERT fra disse modusene (kan kun røres via cascade). Min-én-scope-validering. Legacy `?onlyParents=true` mappes bakoverkompatibelt. c) Confirm-dialog for cascade viser scope (én SA vs alle) + advarsel om overskriving. Emerald "Kjør"-knapp for cascade. d) Statisk QA: yarn tsc ✓, yarn lint:all 7/7 ✓, yarn build ✓. 3 referanse-test-suiter regresjonsfrie. Testing-agent iter_28 100%.
- ✅ **D-127** Strukturert `pricing` med B2C + B2B underobjekter: `default.json.pricing` har nå `currency` på toppnivå + nested `b2c: {monthly, yearly, trialDays}` og `b2b: {semiannualPerSeat: 522, yearlyPerSeat: 1044, trialDays}`. Reader (`pickPricing`) er fullt bakoverkompatibel — leser både nytt nested format og legacy flat (`pricing.monthly` osv.). Ny `getB2BPricing()`-helper. Eksisterende callers (`CheckoutChoice`, `checkout-info`, `register/paid`, alle Stripe-flyter) er uendret pga `getPricing()` beholder B2C-shape. Eksisterende tenant-configs i Upstash leses uten migrasjon. Tester: trial-days.test.ts 22/22 PASS (regresjon-fri) + pricing-structured.test.ts 27/27 PASS. Statisk QA: TSC ✓, lint:all 7/7 ✓, yarn build ✓.
- ✅ **D-126** SA-config provisjonering + arv: a) B2B-parent (`<prefix>-admin`) får automatisk `client-config:<prefix>-admin` initialisert fra `default.json` ved provision-vercel-short-circuit (D-088). Idempotent — overskriver ikke eksisterende. b) B2B child-tenants (ansatte) arver SA-mal i stedet for global default — ny helper `buildTenantConfigFromParent()` leser `client-config:<parent>` og overrider `_meta.client` til child. Hvis SA-config mangler logges advarsel og fallback til default.json. c) `provisionTenantOnVercel` har ny `parentSubdomain`-prop som settes fra `/api/invite/accept` (B2B child) og admin retry-flyt. d) Test Tools `ConfigToolsButton` har ny "Kun B2B parent-tenants (SA)"-checkbox som filtrerer migrasjonen til kun SA-tenants. Migrasjons-endepunkt utvidet med `?onlyParents=true`. e) 10 nye unit-tester i `tenant-config-inheritance.test.ts` (alle PASS). 3b ekstra-task hoppet over per Mikes valg (ingen UI-banner i ClientConfigEditor).

### Fixed 2026-06-29
- ✅ **D-124** Per-trim historical markers: hver trunkering legger til en ny `log_trimmed`-event med `detail: "cut=N total=M"` på toppen av loggen (nyeste først). Markere er beskyttet mot fremtidige trunkeringer (gjelder kun ekte events) og kappet til MAX_TRIM_MARKERS=10. TenantViewer text-log viser ✂️-ikon for trim-events. 9 nye unit-tester (17/17 PASS totalt). Mike ser nå alltid historikken til kuttingene
- ✅ **D-123** T2 provisioningLog truncate (asymmetric 1000/100): Ny `lib/platform/provisioning-log-limits.ts` med `getProvisioningLogMax()` + `truncateProvisioningLog()`. Konfig i `public/clients/default.json` → `provisioningLog.adminProvisioningLogMax=1000` (B2B-parent), `tenantProvisioningLogMax=100` (alle andre). Hardcoded fallback=100 hvis config mangler. Trunkering skjer transparent i `putTenant()` på hver write — eksisterende oversize-records migreres gradvis uten cron. 8/8 unit-tester PASS. Testing-agent 100% grønt
- ✅ **D-122** T5 OrgInvitesSection-konsolidering: viste seg å være dead code. Filen slettet. `InlineInviteForm` er nå eneste invite-skjema. 10 orphan i18n-keys ryddet × 4 språk (1483 → 1473). D-105-lint scanner nå 316 filer. Testing-agent 7/7 PASS
- ✅ **D-121** T3 locale-cleanup: 0 ubrukte literal-keys å fjerne (lint kept it clean). Alle 56 dynamiske exempt-entries manuelt verifisert som fortsatt aktive. Lint hardened med automatisk stale-exempt-deteksjon (kildefil må eksistere + alle statiske deler av template-mønsteret må forekomme i fila). To robustness-tester av testing-agent bekrefter at både defekt fil-path og defekt mønster fanges. T3 lukket
- ✅ **D-120** /invite skjema lokalisert: 28 nye keys × 4 språk (`invite_form.*` prefix — totalt 1483 keys per språk). ERROR_MESSAGES erstattet av ERROR_CODE_KEYS-mapping + t()-closure. På validate-success bytter siden automatisk page-locale til invitasjonens preset (admin kan forhåndsvelge språk per invitasjon). Sv/da/en-ansatte ser nå hele skjemaet på sitt språk fra første frame. `{subdomain}`/`{action}`/`{code}`-interpolasjon fungerer på tvers av språk. Verifisert statisk av testing-agent (9/9 sjekkpunkter, 0 issues)
- ✅ **D-119** Invite-flow design-konsistens: a) `/welcome-b2b` får aurora-gradient (samme som `/invite` + am-admin-login) på både happy-path og error-state. b) Tre primær-CTA'er i flyten harmonisert til identisk styling: `w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors` ("Aktiver konto" på /invite, "OK, gå videre" på trackerens liveAction, "Fortsæt" på welcome-b2b). Default "Åpne vault"-knapp i tracker (uten liveAction) beholder emerald-pill-style så `/platform/register` + `/billing/success` + admin TenantViewer ikke påvirkes. Verifisert statisk av testing-agent (letter-by-letter className-match)
- ✅ **D-118** Invite-rydding ved ansatt-sletting + ProvisioningTracker-lokalisering: a) `deleteInvitesForSubdomain()` ny helper i `invite-store.ts` — sletter ALLE invites (pending/expired/used) som peker på et slettet child-tenant. Erstatter `markInvitesAsChildDeleted()` (D-101) som er fjernet — audit-spor sikres allerede via `logEvent('tenant_deleted')` på parent + Stripe-customer-bevaring (D-070). Gjelder både super-admin OG firma-admin DELETE-ruter (firma-admin trengte ingen endring, `deleteTenant()` rydder internt). b) `ProvisioningTracker` lokalisert — 16 nye keys × 4 språk (`provisioning.*` prefix). STEPS-labels og STAGE_MESSAGES_NO erstattet med `t()`-kall. Verifisert statisk av testing-agent
- ✅ **D-117** Invite-flow bug-fix: a) trackeren mountes nå FØR `/api/invite/accept` returnerer slik at steg 1–6 vises live (tidligere "hoppet" UI inn på steg 5 fordi backend kjørte Upstash+Vercel synkront før respons). Rull-tilbake til form ved feil. b) Auto-redirect fjernet — bruker klikker selv "OK, gå videre" på trackeren (ny `liveAction`-prop på `ProvisioningTracker`, default "Åpne vault" beholdes for andre flows). Verifisert statisk av testing-agent
- ✅ **D-116b** Siste native `<select>` i am-admin (`OrgInvitesSection.tsx` locale-velger) erstattet med `DarkSelect`. T5 (OrgInvitesSection vs InlineInviteForm overlapp) flagget i KNOWN_BUGS for senere konsolidering
- ✅ **D-116** Firma-admin slett-flyt + UI: a) `DarkSelect` ekstrahert fra `TenantViewer.tsx` til egen fil → InlineInviteForm (locale-dropdown) bruker nå mørk popup på alle browsere (tidligere stygg native hvit). b) `confirm()` erstattet med `ConfirmDialog` (type-to-confirm = subdomain) for både ansatt- og invite-sletting. c) Ny `AmAdminDeleteResultModal` med brukervennlige steg-labels ("Vault-miljø fjernet", "Kryptert lagring slettet", "Betaling avsluttet" etc — ikke infra-jargon). Skjuler B2B-parent-only-steg (b2bPrefix/orgAdmins/mpw/invites). Backend `/api/am-admin/tenants/[subdomain]` DELETE returnerer nå hele `DeleteResult`. Invite-result-modal viser subdomene + e-post + tidspunkt
- ✅ **D-115** Invite-flow: a) henter firmanavn via `/api/am-admin/branding/[prefix]` (strengt — ingen prefix-fallback), b) default aurora-gradient som bakgrunn, c) `<ProvisioningTracker mode="public">` plassert mellom skjema og redirect til `/welcome-b2b/...` slik at vi venter på `vault_live` før vi sender brukeren videre. Fikser 404/wrong_pod ved klikk på "Fortsett" i welcome-skjermen
- ✅ **D-113** Backup-utvidelse: én CSV-fane med "type"-kolonne (admin/employee/invite). Pending invites inkludert. Bug-fiks: parent-tenanten ble feilaktig listet som "ansatt" pga `subdomain.startsWith(prefix-)`-fallback i filteret — nå strikt `parentTenant === prefix`. JSON-format bumped til v2 med separate `admin` + `invites`-felter
- ✅ **D-111** B1: Stale `activeLicenses`-felt → fjernet write i invite/accept, alle 6 lesere bruker nå `countLiveActiveLicenses`. Schema-felt beholdt som OPTIONAL response-only (samme mønster som `pendingInvitesCount`)
- ✅ **D-104b** B3: CreateTenantForm step 2 deduplisert → 3 nye block-komponenter (`SelskapFieldsBlock`, `KontaktFieldsBlock`, `FakturaFieldsBlock`) brukt av både edit- og create-mode. `CompanyDataSection` er nå dispatcher (discriminated union på `mode`). CreateTenantModal step 1 beholder kun subdomain+email, step 2 renderer `<CompanyDataSection mode="create">`
- ✅ **D-112** B6: vatNumber-felt fjernet fra schema → erstattet av live-utledning via `deriveVatNumber(country, orgNumber)` (NO/DK/SE). Eksisterende verdier i Upstash ignoreres som dead data. Helper i `lib/platform/org-number-validation.ts`
- ✅ **B4** Reload-knapp i B2B-Konsoll → flyttet til høyre side av SeatBar, ved siden av "+ Ansatt" — secondary outline-button med RefreshCw-ikon. Dobbelt-ikon-bug (`↻`-glyph i locale + lucide-ikon) fikset ved å fjerne glyph fra alle 4 locale-filer
- ✅ **B5** Postnummer→poststed live-lookup (NO via Bring + DK via DataForsyningen) — delt hook `usePostnrAutofill` brukt på alle felt-par via blocks

### Fixed 2026-06-28
- ✅ D-099 cross-tenant data leak ved DNS-propagering (vault-host-guard)
- ✅ D-103e: child.parentTenant lagrer prefix ikke subdomain — telling rettet
- ✅ D-104 PATCH-rute aksepterer 17 B2B firma-felter + Stripe-sync
- ✅ D-105 anti-duplisering-lint
- ✅ D-107 nivå-2 sub-tabs i TenantViewer
- ✅ D-108 gjenbrukbar `<SubTabNav>`
- ✅ D-109 MPW ikke krav for backup
- ✅ D-110 layout-rekkefølge (firmanavn først)

---

## Slik bruker du denne filen

**Når du fikser en bug:**
1. Implementer fiks
2. Verifiser med lint+build
3. Flytt entry til "Lukket"-seksjon med dato + D-XXX-ref
4. Oppdater også CHANGELOG.md med detaljer

**Når du finner en ny bug:**
1. Legg til entry i riktig severity-seksjon
2. Inkluder: beskrivelse, workaround, filer, status
3. Hvis P0 — varsle Mike umiddelbart
