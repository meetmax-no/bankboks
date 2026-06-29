# Ko|Do · Vault — Known Bugs & Tech Debt

**Sist oppdatert:** 2026-06-29  
**Format:** [Severity] Bug-title → Beskrivelse → Filer → Status

Severity:
- 🔴 P0 — datatap eller sikkerhets-implikasjon
- 🟠 P1 — funksjonalitet brutt, men workaround finnes
- 🟡 P2 — UX/kosmetisk
- 🔵 Tech-debt — virker, men trenger refactor

---

## 🔴 P0 — Kritiske

*(Ingen åpne P0 per 2026-06-28)*

---

## 🟠 P1 — Funksjonelle

### B2 — Orphan-detection edge-case ved gjenoppretting av samme prefix
**Beskrivelse:** Hvis Mike sletter en B2B-parent og umiddelbart oppretter en ny med samme prefix, kan gamle org-admin-records / invites peke til "wrong parent" (via snapshot-FK `parentTenantCreatedAt`). Orphan-detection (`link_missing` / `child_missing`) skal fange det, men har edge-case ved race-condition.  
**Workaround:** Bruk Test Tools (`OrphanInvitesCard`) til å rydde manuelt.  
**Filer:** `lib/platform/orphan-detection.ts`, `lib/platform/invite-store.ts:markInvitesAsChildDeleted()`.  
**Status:** Lavt hendelses-volum, akseptabelt for nå.  
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

### T3 — Locale-filer har 1416 nøkler — vanskelig å vedlikeholde
**Beskrivelse:** `lib/locales/no.json` er ~1700 linjer. Lint sikrer sync mellom språk, men ingen sjekker at nøkler faktisk brukes (delvis — lint:i18n-sync varsler ubrukte).  
**Forslag:** Periodisk cleanup av ubrukte nøkler (gjort etter D-106).  
**Status:** Pågående hygiene.

### T4 — Test Tools eksponerer PII uten audit-log
**Beskrivelse:** `OrgAdminListCard` og `OrphanInvitesCard` lar Mike-admin se ansatt-PII (navn, e-post) på tvers av tenants — som per D-078 ikke skal være mulig. Begrunnet som "nødvendig for orphan-cleanup", men det er ingen audit-log på bruken.  
**Filer:** `app/api/admin/org-admins/all/route.ts`, `app/api/admin/orphan-invites/all/route.ts`, `components/platform/OrgAdminListCard.tsx`, `components/platform/OrphanInvitesCard.tsx`.  
**Status: VENTER PÅ BESLUTNING (Mike 2026-06-29)** — to alternativer:  
&nbsp;&nbsp;**(a)** Behold funksjonen + legg på audit-log (hver Mike-admin-tilgang loggføres med tidspunkt, prefix, formål). GDPR-konformt med revisjons-spor.  
&nbsp;&nbsp;**(b)** Slett funksjonen helt. Orphan-cleanup må gjøres via annen mekanisme (f.eks. automatisk cron eller server-side rydding uten UI-eksponering).  
Mike skal velge før noe gjøres. **Ikke implementer noen av delene før beslutning.**

---

## Lukket (referanse)

### Fixed 2026-06-29
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
