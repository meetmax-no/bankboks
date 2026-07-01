# Admin-app splitt — Kartleggingsrapport

**Dato:** 2026-02-01
**Status:** ⏳ Kun kartlagt. Ingen kode endret. Ingen beslutning tatt.
**Bestilt av:** Mike
**Kartlagt av:** E1 (fork-agent, session 2026-02-01)

---

## Kontekst / hvorfor denne rapporten finnes

Mike vurderer å splitte admin-modulen ut som en separat Vercel-app
(`admin.kodovault.no`) mens selve vault-produktet flyttes til
`[prefix].kodovault.no`. Dette er en arkitektur-endring med konsekvenser
for angrepsflate, deploy-livssyklus, agenter og fremtidige integrasjoner.

Formålet med denne rapporten er å gi et **realistisk grunnlag for
beslutningen** — ikke å anbefale eller starte implementering.

---

## 1. Nåværende arkitektur

Applikasjonen er ÉN Next.js 15-app deployet som separat Vercel-prosjekt
**per tenant** (via `provisionTenantOnVercel`). Hver tenant-Vercel-instans
har HELE kodebasen — også admin-ruter — men middleware host-låser dem
så de aldri kan kalles fra tenant-hosten.

**Tre modi i samme kodebase (routes via `middleware.ts`):**

| Modus         | Host                              | Session-cookie              | Upstash                          |
| ------------- | --------------------------------- | --------------------------- | -------------------------------- |
| **Vault**     | `<prefix>.kodovault.no`           | Ingen (zero-knowledge)      | Per-tenant (`KV_REST_API_*`)     |
| **am-admin**  | `<prefix>-admin.kodovault.no`     | `kodo_org_admin_session`    | Sentral (`CENTRAL_KV_REST_API_*`) |
| **SuperAdmin** | `admin.kodovault.no`             | `kodo_admin_session`        | Sentral (`CENTRAL_KV_REST_API_*`) |

---

## 2. Filkategorisering

### 🟢 Utelukkende admin (flyttes til admin-app)

**API-ruter: 49 stk**
- `app/api/admin/**/*.ts` — 26 ruter (Mike SuperAdmin)
- `app/api/am-admin/**/*.ts` — 23 ruter (firma-admin)

**Sider: 3 stk**
- `app/platform/admin/page.tsx`
- `app/platform/am-admin/page.tsx`
- `app/platform/am-admin/login/page.tsx`

**Komponenter: ~32 stk**
- `components/platform/*.tsx` (20 filer — TenantViewer, InvoiceHistoryCard,
  OrphanInvitesCard, ClientConfigEditor, ProvisioningTracker, etc.)
- `components/platform/am-admin/**/*.tsx` (18 filer — EmployeeListSection,
  TeamManagementSection, KonsoletSettingsPanel, MpwSection, alle
  settings-taber, etc.)

**Rene admin-libs: ~17 stk**
- `lib/platform/admin-auth.ts`, `org-admin-auth.ts`, `org-admin-store.ts`,
  `org-admin-login-events.ts`, `am-admin-*.ts` (×4), `delete-tenant.ts`,
  `lifecycle-cron.ts`, `lifecycle-guard.ts`, `vercel-provision.ts`,
  `upstash-provision.ts`, `provisioning-log*.ts`, `poll-deployment.ts`,
  `provision-retry.ts`, `tenant-config-builder.ts`

**Estimat: ~101 filer flyttes til admin-appen**

### 🔴 Ren vault (forblir i vault-app)

**API-ruter: 12 stk**
- `app/api/vault/route.ts` + `vault/events/route.ts`
- `app/api/cards/route.ts`, `ids/route.ts`
- `app/api/tenant/info/route.ts`, `tenant/status/route.ts`
- `app/api/status/route.ts`, `client-config/route.ts`
- `app/api/account/delete/route.ts`
- `app/api/billing/checkout-info/route.ts`, `create-checkout/route.ts`,
  `portal/route.ts`, `subscription/route.ts`

**Sider: 4 stk**
- `app/page.tsx` (1397 linjer, men inneholder også admin-bootstrap-hook 🟡)
- `app/billing/{success,error,upgrade}/page.tsx`

**Komponenter: ~38 stk**
- Alle root `components/*.tsx` (AppHeader 🟡, VaultDashboard, EntryModal,
  PackModule, etc.)

**Vault-libs: ~30 stk**
- `lib/crypto.ts`, `webauthn.ts`, `backup.ts`, `vault-sync.ts`, `cards-sync.ts`,
  `ids-sync.ts`, `i18n.ts`, `i18n-context.tsx`, alle hooks, feature-theme,
  image-*, package.ts, wordlist-nb.ts, etc.

### 🟡 DELT / GRÅSONE — det som gjør splitten ikke-triviell

| Fil                                                      | Problem                                                                                                                                                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`middleware.ts`** (264 L)                              | Håndterer alle tre modi. Må splittes: admin-appen får am-admin + SuperAdmin-logikken; vault-appen får kun host-guard (D-099).                                                                  |
| **`lib/platform/tenant-store.ts` + `-crypto.ts` + `-types.ts`** | Sentral tenant-database. Både admin-flow OG webhook OG vault-flow (`/api/tenant/status`) leser den. Må dupliseres i begge apper ELLER admin-appen får et internt API for lookup.               |
| **`lib/platform/client-config-store.ts`**                | Både `/api/client-config` (vault) OG `/api/admin/client-config` (admin) skriver til samme central Upstash. Krever DELING av env-vars.                                                          |
| **`lib/platform/central-upstash.ts`**                    | Både apper må ha `CENTRAL_KV_REST_API_*` env-vars.                                                                                                                                             |
| **`lib/stripe/event-handlers.ts`** (685 L) + `webhook.ts` + `checkout.ts` | Webhook må enten (a) bo på hovedappen som proxy → admin, eller (b) splittes: én webhook per app med hver sitt Stripe-endpoint. Trenger to Stripe webhook endpoints med separate secrets.       |
| **`app/api/webhook/route.ts`**                           | Samme problem — dagens webhook oppdaterer tenant.status via central Upstash.                                                                                                                   |
| **`app/api/register/*`** (5 ruter)                       | Public trial-signup. Skriver til central-DB + trigger provisioning. Bør flyttes til admin-appen (den eier `provisionTenantOnVercel`).                                                          |
| **`app/api/invite/{validate,accept}`**                   | Public invite-flyt. Aksepterer invitasjon → oppretter child-tenant. Bør flyttes til admin-appen.                                                                                               |
| **`app/api/cron/*`** (3 crons)                           | Alle 3 crons bruker central Upstash. Flyttes til admin-appen.                                                                                                                                  |
| **`app/page.tsx`** (1397 L)                              | Inneholder både vault-UI OG admin-bootstrap-hook (`POST /api/admin/session/start` når unlocket på admin-host). Vault-koden er core; admin-bootstrap må flyttes eller kalles cross-domain.       |
| **`components/AppHeader.tsx`**                           | "Hopp til admin"-knapp aktiveres kun på `admin.kodovault.no`-host. Kan fjernes fra vault-appen.                                                                                                |
| **`lib/vault-runtime.tsx`**                              | Kaller `/api/admin/logout` på `vault.lock()` for å drepe admin-cookie samtidig. Cross-domain vil ikke fungere med `fetch` alene — må gjøres via redirect eller separat "logout begge"-mekanisme.  |
| Rene helpers                                             | `invite-url.ts`, `subdomain.ts`, `reserved-subdomains.json`, `plan-consistency-guard.ts`, `seat-counter.ts`, `notify-email.ts`, `notify-telegram.ts`, `notify.ts`, `provisioning-log.ts`, `am-admin-session-helper.ts` — enkle å duplisere eller flytte til delt npm-pakke. |

---

## 3. Delt state / middleware / auth

**Delt state:**

- **Central Upstash Redis** (samme instans) — tenant-records, invites,
  org-admin-records, MPW, admin-notes, login-events, rate-limit-tellere.
  Begge apper må ha `CENTRAL_KV_REST_API_URL/TOKEN` + `CENTRAL_ENCRYPTION_KEY`.
- **Stripe customer/subscription-database** — samme customer-ID brukes
  av begge apper.
- **Vercel API** — kun admin-appen kaller Vercel API for provisioning.
- **GitHub API** — kun admin-appen kaller GitHub for
  `public/clients/<subdomain>.json`-oppretting.

**Delt auth:** Ingen. Vault har ingen server-session (zero-knowledge).
Admin har `kodo_admin_session`. am-admin har `kodo_org_admin_session`.
Cookies er allerede host-scoped (SameSite=Strict/Lax) og kan ikke deles
cross-app.

**Delt middleware:** `middleware.ts` splittes 1:1 — vault-appen får kun
host-guard (D-099), admin-appen får hele auth-logikken.

---

## 4. Integrasjons-splitt

| Integrasjon                                    | Vault-app                                              | Admin-app                                          |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| **Per-tenant Upstash** (`KV_REST_API_*`)       | ✅ Ja (vault-blob, cards, ids, events)                  | ❌ Nei                                              |
| **Central Upstash** (`CENTRAL_KV_REST_API_*`)  | 🟡 Kun for `client-config`-lookup + `tenant-status`-lookup | ✅ Ja (all lifecycle-state)                         |
| **Stripe**                                     | ✅ B2C checkout + customer portal                       | ✅ B2B manuell faktura + webhook                    |
| **Stripe webhook**                             | ⚠️ Må splittes — én endpoint per app                    | ⚠️ Må splittes                                      |
| **Resend (e-post)**                            | ❌ Nei                                                  | ✅ Ja (velkomst, invitasjoner, lifecycle-varsler)    |
| **Telegram (notify)**                          | ❌ Nei                                                  | ✅ Ja (provisioning-failure)                        |
| **Vercel API**                                 | ❌ Nei                                                  | ✅ Ja (auto-provisioning)                           |
| **GitHub API**                                 | ❌ Nei                                                  | ✅ Ja (client-config-commit)                        |
| **Turnstile**                                  | ❌ Nei                                                  | ✅ Ja (register-form + login)                       |
| **Cloudflare geo/UA**                          | ✅ Ja (rate-limit + login-events)                       | ✅ Ja (login-events + audit)                        |

---

## 5. Filantall

| Kategori                                             | Filer  | Handling                                                       |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------- |
| Ren admin (API + UI + libs)                          | ~101   | Flytt til admin-app                                            |
| Ren vault (API + UI + libs)                          | ~80    | Beholdes i vault-app                                           |
| Delt (må dupliseres/refaktoreres)                    | ~15    | Duplikér ELLER lag delt npm-pakke                              |
| Middleware                                           | 1      | Splitt 1:1                                                     |
| i18n locales (no/sv/da/en)                           | 4      | Splitt — admin ~700 nøkler, vault ~770 nøkler                  |
| Tester (`lib/__tests__/*.test.ts`)                   | ~35    | Splittes etter modul                                           |
| Konfig (`package.json`, `vercel.json`, m.fl.)        | ~6     | Dupliseres med kun relevante deps                              |
| **Totalt filer å røre**                              | **~240** | ~101 flyttes ren, ~15 er reelle gråsone-refaktorer            |

---

## 6. Konkrete risikoer

### 🔴 HØY

1. **Stripe-webhook race:** Hvis begge apper mottar samme webhook (to
   endpoints i Stripe Dashboard), risikerer vi dobbelt-oppdatering av
   samme tenant-record. Alternativt: én webhook (på admin-appen) som
   proxy-ruter videre til vault-appen for B2C-events → nettverksavhengighet.
2. **Central Upstash race conditions:** Med to apper som skriver til
   samme sentral-DB må vi vurdere om alle write-flows er idempotente
   (D-063/D-064 failsoft skjer fortsatt bare i admin-app-siden). Hvis
   vault-appen mister sin sti til central for `client-config`-lookup,
   får den ikke oppdaterte priser.
3. **Vault-lock cross-domain:** `vault-runtime.tsx:218` kaller
   `/api/admin/logout` med `fetch()`. Cross-origin til admin.kodovault.no
   fra `<prefix>.kodovault.no` krever CORS + credentials-cookie → må endres
   til popup/redirect ELLER `postMessage` mellom fanene.
4. **Deployment-koreografi:** `provisionTenantOnVercel` oppretter nye
   vault-Vercel-prosjekter. Etter splitt må admin-appen provisjonere
   prosjekter som ikke inneholder admin-kode — mindre bundle, raskere
   kaldstart, mindre angrepsflate — men ny risiko for feilprovisjonering.

### 🟠 MEDIUM

5. **Delt tenant-store fører til drift over tid:** Hvis begge apper har
   kopier av `tenant-types.ts`, kan schema-endringer i admin-app være
   inkompatible med vault-app. Løsning: felles npm-pakke ELLER internt
   HTTP API.
6. **i18n-splitt:** 1477 nøkler i dag. Å splitte i to (~700 admin +
   ~770 vault) krever nøye kartlegging så ingen nøkler er "orphan" i én
   app og "duplikat" i begge (bryter D-121 lint-regel).
7. **Test-splitt:** 35 test-filer må omfordeles. Coverage-matrix-lint
   (D-105) og PII-lint (D-078) er admin-specific og må følge admin-appen.
8. **Emergent-plattform-koreografi:** Emergent tracker git-diffs via
   `/app/.emergent`. To repos betyr to jobber, to preview-URL-er, to
   Vercel-deploys. Fork-agent-handoff blir mer komplekst.

### 🟡 LAV

9. **Rebranding-kostnad:** All hardkodet `admin.kodovault.no` og
   `-admin.kodovault.no` finnes i ~12 filer. Splitten betyr disse må
   gjennomgås.
10. **DNS/SSL:** Wildcard-sertifikat på `*.kodovault.no` fungerer
    fortsatt, men to Vercel-prosjekter må dele CNAME-oppsett.

---

## 7. Estimert arbeidsmengde

| Fase                                             | Tid         | Innhold                                                                                                                            |
| ------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 1 — Grunnmur**                            | 2–3 dager   | Nytt repo, kopiér ~101 admin-filer, sett opp separat `middleware.ts`, duplisér delte libs, split i18n-nøkler, splitte tester        |
| **Fase 2 — Webhook + Stripe**                    | 1 dag       | Splitte Stripe webhook-endpoint i to (én per app), sette opp separate secrets, oppdatere `event-handlers.ts`                        |
| **Fase 3 — Vault-appen ryddes**                  | 1 dag       | Fjern all admin-kode fra vault-appen, oppdater `provisionTenantOnVercel` slik at nye vault-prosjekter kun inneholder vault-koden    |
| **Fase 4 — Cross-domain-koreografi**             | 0.5–1 dag   | Håndter `vault.lock()` → admin-logout via redirect eller cross-domain iframe/postMessage. "Hopp til admin"-knapp cross-domain       |
| **Fase 5 — Testing + regression**                | 1.5–2 dager | End-to-end flyter: register → provisioning → welcome-b2b → invite → am-admin login → send faktura → webhook → status-update        |
| **Fase 6 — Deploy-koreografi + migrering**       | 1 dag       | Deploy admin-app til `admin.kodovault.no` OG `<prefix>-admin.kodovault.no`. Deploy vault-app til `<prefix>.kodovault.no`. DNS.       |
| **Buffer for uforutsette webhook-race-fixes**    | ~2 dager    | Uunngåelig ved arkitektur-endring av denne størrelsen                                                                              |
| **Total**                                        | **9–11 dager** | Konsentrert arbeid, én dedikert utvikler som kjenner kodebasen                                                                 |

---

## 8. Fordeler / ulemper

### ✅ Fordeler ved splitt

- Kraftig redusert angrepsflate på tenant-podene (ingen admin-kode i
  vault-Vercel-prosjektet)
- Uavhengige deploy-livssykluser (admin-endring krever ikke re-provisjonering
  av alle tenants)
- Klarere mental modell for framtidige agenter (én app = én ansvar)
- Enklere å skalere admin-appen separat hvis den vokser mer
- TenantViewer.tsx (5091 L) og annen tung admin-UI slipper å bli sendt
  som JS-bundle til slutt-kunder

### ❌ Ulemper / kostnad

- ~10 dagers arbeid som ikke gir kunder én ny feature
- Introduserer cross-app-koreografi som må vedlikeholdes
- Blokkerer andre prioriterte oppgaver (Stripe subscription-arkitektur,
  P1-PRE-LAUNCH-A/B, lifecycle-modell)
- To git-repos å vedlikeholde + to Vercel-prosjekter i tillegg til
  per-tenant-provisjonering

---

## 9. Beslutningsstøtte

**Bør vente hvis:**
- Vi er nær launch og bør fullføre P1-PRE-LAUNCH-A/B og Stripe-arkitektur først
- Vi har < 10 aktive B2B-tenants (angrepsflate-risiko relativt lav)
- Ingen aktuell insident eller regulatorisk krav som utløser behovet

**Bør prioritere hvis:**
- Vi planlegger stor B2B-vekst (> 50 tenants) hvor uavhengige
  deploy-sykluser blir kritisk
- Vi har konkret sikkerhetsrevisjon som krever redusert angrepsflate
- Vi ser at admin-appen vokser vesentlig raskere enn vault-appen
- Vi vil integrere Passkeys/2FA på admin-siden uten å øke vault-bundlen

---

## 10. Neste steg (kun hvis Mike beslutter å gå videre)

1. Opprett nytt repo `kodo-vault-admin` med samme Emergent-oppsett
2. Sett opp CI som fanger drift mellom `tenant-types.ts`-versjoner i de
   to reposene (feiler build hvis schema divergerer)
3. Fase 1 (Grunnmur) settes som første leverandør — ingen produksjon-endring
4. Deploy admin-appen til `staging-admin.kodovault.no` for parallell-testing
   FØR vi rører produksjons-DNS

**Denne rapporten er kun kartlegging. Ingen kode er endret.**
