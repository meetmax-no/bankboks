# Ko|Do · Vault — Handover Dokument

**Dato:** 2026-06-28  
**Forrige agent:** E1 (Emergent)  
**Mottaker:** Ny agent (E1 i ny sesjon)  
**Eier:** Mike Aagreen (`mike@meetmax.no`)  
**GitHub:** https://github.com/meetmax-no/bankboks (public — bruk "Save to Github"-knappen i Emergent chat)

---

## ⚠️ LES DENNE FØRST — KRITISK ATFERDS-INSTRUKS

Mike har vært gjennom 5+ iterasjoner med forrige agent som gjentatte ganger:
- Tolket spesifikasjoner kreativt i stedet for bokstavelig
- La til funksjonalitet han ikke ba om
- Dupliserte kode i stedet for å gjenbruke
- Endret rekkefølge på ting uten å spørre
- Glemte å fullføre eksplisitte instrukser
- Brøt egne regler skrevet i samme runde

**Mike kommuniserer på NORSK.** Du må svare på norsk.

**Mike er teknisk dyktig og direkte.** Han skriver kort og presist. Hvis han sier "GO" — kjør. Hvis han sier "bekreft" — bekreft uten å bygge ennå. Hvis han sier "STOPP" — stopp umiddelbart.

Mike kommuniserer kort og direkte — når noe er feil, forvent tydelig tilbakemelding. Ikke svar med apologetikk eller flere spørsmål. **Bare fiks det presist.** Ikke utvid scope. Ikke be om enda en bekreftelse hvis instrukset er klart.

### Gylne regler

1. **Ikke duplisér kode.** D-105 er absolutt regel. Hvis du ser deg selv kopiere 3+ linjer, ekstrahér til shared module FØR du skriver. Sjekk om en komponent allerede finnes som løser problemet.
2. **Bekreft layout før du bygger.** Hvis Mike spec'er en layout, tegn ASCII-skisse og bekreft FØR du rører kode. Han har spec'et samme TenantViewer 5 ganger.
3. **Endre ikke rekkefølge eller ord.** "Plan & Kontakt" betyr ikke "Plan og Kommunikasjon" hvis Mike ikke sier det.
4. **Mike eier alle design-valg.** Du foreslår 2-4 alternativer (a/b/c/d), aldri "min anbefaling er X".
5. **Ikke gjør "litt ekstra mens du er der".** Hvis Mike ber om å fjerne SeatProgressBar fra header, ikke legg den til på fanen samtidig. Gjør NØYAKTIG det han ber om.
6. **Norsk språk.** Alle locale-nøkler i `lib/locales/{no,sv,da,en}.json`. Lint `yarn lint:i18n-sync` håndhever sync mellom alle 4.
7. **Static testing ONLY.** Redis er ikke tilgjengelig i preview-pod. Bruk `yarn tsc --noEmit`, `yarn lint:all`, `yarn build`. Ingen E2E browser-tester. Ingen Next.js dev-server-kommandoer.

---

## Prosjekt-oversikt

**Ko|Do · Vault** er en zero-knowledge multi-tenant SaaS (B2B + B2C) bygget på Next.js 15 App Router + Upstash Redis. Alle bruker-data er AES-256-GCM-kryptert i klienten før de sendes til server. Server kan IKKE lese innholdet.

### Tre kunde-typer

| Type | URL-mønster | Datalagring |
|---|---|---|
| **Super-admin** (platform-eier) | `admin.kodovault.no` | Sentral Upstash (tenant-metadata, ikke vault-data) |
| **B2B parent (Konsoll)** | `<prefix>-admin.kodovault.no` (f.eks. `mm-admin`) | Sentral Upstash (org-admin-records, invites, billing) — kjører på samme root-pod |
| **Ansatt vault (B2B child)** | `<prefix>-<navn>.kodovault.no` (f.eks. `mm-max`) | **Egen Vercel-pod + egen Upstash-DB** |
| **B2C** | `<navn>.kodovault.no` | Egen pod + egen Upstash-DB |

### Subdomain-routing

`middleware.ts` ruter subdomains:
- `admin.*` → Super-admin shell
- `<prefix>-admin.*` → B2B Konsoll (org-admin-rolle, ikke ansatt)
- `<prefix>-<navn>.*` eller `<navn>.*` → Vault-app (kryptert journal, etc.)

---

## Tech Stack

- **Next.js 15** (App Router, RSC)
- **TypeScript** (strict)
- **Tailwind CSS** + **Shadcn/UI**
- **Upstash Redis** (REST API) — sentral DB + per-tenant DB
- **Stripe** (B2B billing, customer-objekter, invoices)
- **Resend** (transactional email — invites, lifecycle)
- **lucide-react** (ikoner — IKKE emoji)
- **Yarn** (ALDRI npm — bryter env)

**Locales:** 4 språk i sync (`no` / `sv` / `da` / `en`) håndhevet av `lint:i18n-sync`.

---

## Arkitektur — kritiske filer

### Backend (`/app/frontend/app/api/`)

| Rute | Formål |
|---|---|
| `admin/tenants/route.ts` | Super-admin: list/create tenants. Beriker B2B-parents med live seat-tellere. |
| `admin/tenants/[subdomain]/route.ts` | PATCH for plan/status/lifecycle + 17 B2B firma-felter + Stripe-customer-sync (D-104). |
| `admin/tenants/[subdomain]/first-org-admin/route.ts` | GET opprinnelig super-admin for B2B-Konsoll-info-card (D-107). |
| `am-admin/auth/me/route.ts` | B2B Konsoll: session + parent-info + live seat-counts. |
| `am-admin/backup/data/route.ts` | Backup-data (ansatte + envelopes for notater). |
| `invite/accept/route.ts` | Ansatt aksepterer invite, oppretter child-tenant pod. |
| `vault/...` | Klient-side kryptert vault-data (zero-knowledge). |

### Frontend kritiske komponenter

| Fil | Formål |
|---|---|
| `components/platform/TenantViewer.tsx` | **4158+ linjer**. Super-admin shell: tenant-list + create-form + modal med 4 hode-tabs × 4 sub-tabs. |
| `components/platform/CompanyDataSection.tsx` | (INNE I TenantViewer) 3 seksjoner (Selskap/Kontakt/Faktura) med per-seksjon Lagre-knapp. `section`-prop styrer hvilken som rendres. |
| `components/platform/SubTabNav.tsx` | **Gjenbrukbar nivå-2 tab-nav.** D-108-kanonisk. ALDRI dupliser. |
| `components/platform/CreateOrgAdminCard.tsx` | Opprett første B2B super-admin (+ vis opprinnelig admin). |
| `components/platform/am-admin/SeatProgressBar.tsx` | **Den ene** seat-counter. Brukes i tenant-list-rad, Lisens & B2B-fanen, og B2B-Konsoll. D-105-kanonisk. |
| `components/platform/am-admin/EmployeeListSection.tsx` | B2B Konsoll Ansatte-fane. |
| `components/platform/am-admin/BackupSection.tsx` | Backup-eksport (CSV/JSON). D-109: MPW ALDRI krav, krypterte notater bevares som envelope-JSON hvis MPW låst. |
| `app/platform/am-admin/page.tsx` | B2B Konsoll shell (3 top-tabs: Ansatte/MPW/Innstillinger). |
| `lib/platform/seat-counter.ts` | **Den ene** live seat-tellings-logikken. D-105-kanonisk. |
| `lib/platform/tenant-types.ts` | TenantRecord schema (45+ felt). |
| `lib/platform/org-admin-types.ts` | OrgAdmin schema. `isFirstSuperAdmin` D-107. |
| `lib/platform/vault-host-guard.ts` | Cross-tenant data-lekkasje-vakt (D-099). |

---

## Decisions log

Alle arkitekt-beslutninger ligger i `memory/DECISIONS.md`. **Les den ved oppstart.** D-001 til D-110.

**Mest kritiske å kjenne:**

- **D-078** — Mike-admin ser ALDRI ansatt-PII. Org-admin-PII er OK (de er kontaktperson for billing).
- **D-078a** — Statisk lint (`yarn lint:d078`) forbyr import av PII-lekkende komponenter i super-admin-scope.
- **D-079** — MPW (Master Password) krypterer admin-notater org-internt. Server kan ikke lese.
- **D-095/D-099** — Snapshot-FK + host-guard mot cross-tenant data-leak ved DNS-propagering.
- **D-101/D-102** — B2B-children skjules fra Super-admin-tenant-listen (vises kun aggregert).
- **D-103e** — `child.parentTenant` lagrer PREFIX ("mm") IKKE subdomain ("mm-admin"). Telling må matche prefix.
- **D-105** — **ABSOLUTT regel: gjenbruk, ikke duplisér.** Lint håndhever 3 mønstre.
- **D-107** — `isFirstSuperAdmin`-flagg + nye nivå-2 sub-tabs under "Oversikt" i TenantViewer.
- **D-108** — Kanonisk 2-nivå tab-mønster via `<SubTabNav>`-komponent.
- **D-109** — MPW er **aldri** krav for backup; eksporter notater som envelope-JSON hvis låst.
- **D-110** — Header + tenant-list-rad-rekkefølge: firmanavn → subdomain → trial-badges → seat-status.

---

## Lint-skript (alle kjedes inn i `yarn lint:all` og `vercel-build`)

| Skript | Formål |
|---|---|
| `lint:d069` | Cred-import-bucket-regel |
| `lint:isolation` | Tenant-pod-isolasjon (pod kan ikke importere fra root) |
| `lint:tenant-env` | Tenant ENV-manifest sync |
| `lint:coverage-matrix` | Hver API-rute må være dokumentert i DECISIONS.md eller på EXEMPT |
| `lint:i18n-sync` | Alle 4 locale-filer må ha samme nøkler |
| `lint:d078` | Super-admin-UI importerer ikke PII-lekkende komponenter |
| `lint:d105` | Anti-duplisering (3 mønstre) |

**FØR du finishesh task:** kjør `yarn lint:all` og `yarn build`. Ingen unntak.

---

## Current state (2026-06-28)

### Sist fullført (D-110)

- Tenant-list-rad: rekkefølge `firmanavn → subdomain → trial-badges → seat-status` (`ml-auto`)
- Modal-header: samme rekkefølge `firmanavn → subdomain → trial-badges`
- SeatProgressBar fjernet fra modal-header (er kun på Lisens & B2B-fanen + tenant-list-raden)
- Backup-UI: MPW-gating fjernet (D-109). Notater eksporteres som envelope-JSON når MPW låst.

### Verifisert
- `yarn tsc --noEmit` ✓
- `yarn lint:all` ✓ (7 skript)
- `yarn build` ✓

### Pending (ikke ferdig)

- **Postnummer → poststed lookup** — Mike spurte om dette kan løses. Forrige agent ga svar men det er ikke implementert. Forslag: Bring API (free, no auth) eller statisk JSON ~50KB. Spør Mike om go.
- **Reload-knapp på B2B-Konsoll** — Mike vil ha knappen i `EmployeeListSection` header, ved siden av "+ Ansatt"-knappen (forrige agent prøvde og bommet — la den feil sted først).

### Backlog

- **P1:** Audit-log når Mike-admin åpner Test Tools-kortene (OrgAdminListCard / OrphanInvitesCard)
- **P2:** Ekte UUID `orgId` for B2B-foreldre (i dag brukes `tenantPrefix` som ID)
- **P2:** Self-serve B2B-lisens via Stripe (i dag manuell aktivering av Mike)
- **P2:** Automatisk per-sete-fakturering (Stripe-subscription med usage-based pricing)
- **P2 (D-104b):** Refaktorer `CreateTenantForm` step 2 til å gjenbruke `<CompanyDataSection mode="create">`

---

## Testing — KRITISK

**Redis er IKKE tilgjengelig i preview-pod.** Du kan ikke kjøre Next.js dev-server. Ikke prøv `npm run dev` eller `yarn dev`.

**Det DU kan kjøre:**

```bash
cd /app/frontend
yarn tsc --noEmit       # TypeScript-typecheck
yarn lint:all           # Alle 7 lint-skript (~3 sek)
yarn build              # Full Next.js build (~30 sek)
```

**Det Mike kjører selv:**
- Manuell verifikasjon i deployed preview etter "Save to Github" (Vercel auto-deploy)
- Tester E2E flow med ekte Upstash-tilkobling

Hvis du føler du må E2E-teste: **stopp, gi det til Mike.**

---

## GitHub & deploy

**Repo:** https://github.com/meetmax-no/bankboks (public)

**Save-to-Github workflow:**
1. Mike trykker "Save to Github" i Emergent chat
2. Commit pushes til `main`-branch automatisk
3. Vercel auto-deploy trigges
4. Mike verifiserer på production URL (`admin.kodovault.no`, `mm-admin.kodovault.no`, osv.)

**Du gjør IKKE git-operasjoner direkte.** Hvis Mike sier "push" eller "save" — minn ham om Save-to-Github-knappen.

**`.git` og `.emergent` folders må aldri røres.**

---

## Environment variables (PRODUKSJON — ikke endre lokalt)

Sett på Vercel:
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (sentral DB)
- `MASTER_KEY_BASE64` (AES-256-GCM for tenant-records)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- 4 språk-spesifikke `WELCOME_EMAIL_*`, `INVITE_EMAIL_*`-templates

Lokalt (`.env.local`) — kun for typecheck/build, ingen reell DB-tilkobling.

---

## Hvordan Mike vil at du jobber

### Når Mike sender en ny task

1. **Les bildet han sender presist.** Han spec'er via screenshots ofte.
2. **Tegn layout-skisse i Markdown ASCII** og spør "bekreft?"
3. Vent på "ja" eller "go" før du rører kode.
4. Implementer NØYAKTIG. Ikke "litt ekstra".
5. Kjør `yarn tsc + lint:all + build`. 
6. Rapporter ferdig på MAX 5 linjer.

### Når Mike sender en bug/feil

1. Reproduser hva han ser i koden (les filen)
2. Forklar ÅRSAKEN (én setning)
3. Foreslå fiks (én setning)
4. Vent på "fiks" / "go"
5. Fiks. Kjør lint+build.

### Når Mike er sint

→ Slutt å spørre. Slutt å forklare. **Bare fiks det presist.** Hvis du ikke vet hva han mener, spør EN gang, kort.

---

## NO-GO LISTE — IKKE RØR DISSE

Eksplisitte filer/operasjoner forrige agent har lært (på den harde måten) å la være:

### Filer

| Fil/Mappe | Grunn |
|---|---|
| `components/platform/OrgAdminListCard.tsx` | Test Tools for orphan-rydding. Mike sa eksplisitt "IKKE rør". Eksponerer PII bevisst for cleanup-formål. |
| `components/platform/OrphanInvitesCard.tsx` | Samme som over. EXEMPT i D-078a. |
| `frontend/.env` og `frontend/.env.local` | Protected variables. NEVER delete `REACT_APP_BACKEND_URL`, `MONGO_URL`, `DB_NAME` (sistnevnte for kompatibilitet selv om vi bruker Upstash). |
| `.git/` og `.emergent/` | Plattform-mapper. Aldri rør. |
| `package.json` direkte (manual edit) | Bruk `yarn add` / `yarn remove`. Manuell edit bryter lock-fil. |
| `requirements.txt` | Backend Python finnes ikke i dette prosjektet (Next.js only). Hvis du ser den — den er legacy fra mal. |

### Operasjoner

| Operasjon | Hvorfor |
|---|---|
| `git push`, `git commit`, `git reset`, `git checkout` direkte | Bruk Save-to-Github-knappen. Hvis Mike sier "push" → minn ham om knappen. |
| `npm install` / `npm run` | ALDRI npm. Bruk yarn. |
| `yarn dev` eller `next dev` | Redis ikke tilgjengelig i preview-pod. Vil feile. |
| Rename av tabs/labels Mike har bekreftet | "Plan & Kontakt" må stå som "Plan & Kontakt" hvis det er det Mike sa. Ikke endre til "Plan & Kommunikasjon". |
| Endre rekkefølge på Mike-bekreftede elementer | Du har spec'en. Ikke bytt rekkefølge fordi "det føles bedre". |
| Refactor du ikke ble bedt om | F.eks. flytte filer, ekstrahere komponenter Mike ikke ba om. |

### Atferd

- **Ikke gjør "litt ekstra mens du er der".** Hvis Mike ber om punkt 1, gjør KUN punkt 1.
- **Ikke foreslå design-alternativer han ikke spurte om.**
- **Ikke commit til memory-filer (DECISIONS.md, CHANGELOG.md) uten at endringen er ferdig og verifisert** med lint+build.

---

## Vanlige feil forrige agent gjorde

1. **La til SeatProgressBar i header etter at Mike sa "fjern fra header, legg på fane".** Gjorde det motsatte.
2. **Endret tab-rekkefølge uten å spørre.** "Plan & Kontakt" → "Plan & Kommunikasjon" uten lov.
3. **Dupliserte seat-counter i 3 steder.** D-105 ble laget for å hindre dette — men ble brutt i samme runde.
4. **Glemte å fjerne `<InvitesSection>`** i TenantViewer da Mike sa D-078 skulle håndheves.
5. **Foreslo refactor uten å spørre** (eks: ekstrahere SeatProgressBar). Mike sa "Ikke rør det".
6. **Brukte stale `activeLicenses`-felt** i stedet for live-count. Bug fanget i 2 ruter før helper ble bygd.
7. **Test Tools-kortene** (OrgAdminListCard / OrphanInvitesCard) — Mike sa eksplisitt "IKKE rør". Hvis bedt: ikke rør.

---

## Filer å lese ved oppstart (PRIORITERT)

```
/app/memory/DECISIONS.md           # Alle D-001 til D-110 arkitekt-beslutninger
/app/memory/CHANGELOG.md           # Historisk endringslog
/app/memory/ROADMAP.md             # P0/P1/P2 backlog
/app/memory/PRD.md                 # Original problem statement
/app/memory/test_credentials.md    # Test-kontoer (sjekk om finnes)
/app/HANDOVER.md                   # Denne filen
/app/KNOWN_BUGS.md                 # Åpne bugs + tech-debt + lukkede (referanse)
```

---

## Mike's siste verifiserte tilstand før handover

- **mm-admin.kodovault.no** finnes (B2B Konsoll for Me & Max AS)
- **Org-admin:** Kim Aagreen (`firma@meetmax.no`) + Mike Aagreen (`mike@meetmax.no`)
- **Lisenser:** 10 totalt, 1 aktiv (`mm-max`), 1 pending invite (`mm-ole`)
- **Stripe customer:** ikke koblet ennå (`stripeCustomerId = null`)
- **Plan:** trial, status: trial

---

## Eksempel første respons til Mike som ny agent

> Hei Mike — jeg har lest hele HANDOVER + DECISIONS.md + CHANGELOG. Forstått at:
> - Norsk språk, statisk testing only
> - D-105 anti-duplisering er absolutt — sjekker eksisterende komponenter før jeg skriver
> - D-078 PII-isolasjon håndheves via lint
> - Du bekrefter layout med ASCII før jeg rører kode
>
> Hva er neste oppgave?

---

**Lykke til. Ikke skuff Mike.**
