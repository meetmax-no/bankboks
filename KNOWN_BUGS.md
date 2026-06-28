# Ko|Do · Vault — Known Bugs & Tech Debt

**Sist oppdatert:** 2026-06-28  
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

### B1 — Stale `activeLicenses`-felt i TenantRecord
**Beskrivelse:** `activeLicenses`-feltet på TenantRecord inkrementeres ved `invite/accept` men dekrementeres ALDRI ved `delete-tenant`. Verdien drifter fra realiteten over tid.  
**Workaround:** Live-telling via `lib/platform/seat-counter.ts` brukes overalt nå (D-103e/D-105). Stale-feltet leses ikke direkte fra UI-stier, kun fra interne ruter (`am-admin/seat-status` o.l. — sjekk).  
**Filer:** `lib/platform/tenant-types.ts:activeLicenses`, `app/api/invite/accept/route.ts` (inkrementerer).  
**Status:** Tech-debt — bør slettes som felt, eller backfill-skript som rydder ved hver `listTenants()`.  
**Tracking:** D-103e (CHANGELOG)

### B2 — Orphan-detection edge-case ved gjenoppretting av samme prefix
**Beskrivelse:** Hvis Mike sletter en B2B-parent og umiddelbart oppretter en ny med samme prefix, kan gamle org-admin-records / invites peke til "wrong parent" (via snapshot-FK `parentTenantCreatedAt`). Orphan-detection (`link_missing` / `child_missing`) skal fange det, men har edge-case ved race-condition.  
**Workaround:** Bruk Test Tools (`OrphanInvitesCard`) til å rydde manuelt.  
**Filer:** `lib/platform/orphan-detection.ts`, `lib/platform/invite-store.ts:markInvitesAsChildDeleted()`.  
**Status:** Lavt hendelses-volum, akseptabelt for nå.  
**Tracking:** D-094, D-095, D-101

### B3 — D-104b: CreateTenantForm step 2 dupliserer felt-definisjoner
**Beskrivelse:** `CompanyDataSection` (i TenantViewer) og `CreateTenantForm` step 2 har overlappende felt-rendering for B2B-firma-data. D-105 ABSOLUTT regel sier "ingen duplisering". Bør refaktoreres så `<CompanyDataSection mode="create">` brukes begge steder.  
**Workaround:** Manuell synkronisering — hvis du legger til et felt, oppdater BEGGE steder.  
**Filer:** `components/platform/TenantViewer.tsx:CreateTenantForm`, `components/platform/TenantViewer.tsx:CompanyDataSection`.  
**Status:** Planlagt P2 refactor (D-104b).

---

## 🟡 P2 — UX/kosmetisk

### B4 — Reload-knapp i B2B-Konsoll mangler
**Beskrivelse:** Mike ba om reload-knapp på samme linje som SeatProgressBar + "+ Ansatt"-knappen i Ansatte-fanen. Forrige agent prøvde, men la den feil sted først og rakk ikke å fullføre.  
**Workaround:** Bruker den eksisterende "↻ Oppdater"-tekst-lenken.  
**Filer:** `components/platform/am-admin/EmployeeListSection.tsx` (linje ~448).  
**Status:** TODO — pending Mike's go.

### B5 — Postnummer → poststed auto-lookup mangler
**Beskrivelse:** Mike spurte om postnr-til-poststed-lookup. Ikke implementert.  
**Forslag:** Bring API (free, no auth, men rate-limited til 50/s) eller statisk JSON (~50KB, alle norske postnumre).  
**Filer:** N/A — ny `lib/platform/postal-lookup.ts` ville være start.  
**Status:** Pending Mike's go.

### B6 — vatNumber-felt finnes i schema men ikke i UI
**Beskrivelse:** `TenantRecord.vatNumber` lagres backend, men ingen UI viser eller editerer det (skjult i create-form per direktiv 2026-06-04). Vises kun read-only i "Rå felter (35)" på System-fanen.  
**Workaround:** Norsk konvensjon utleder MVA-nr fra org.nr ("NO" + orgnr + "MVA").  
**Filer:** `lib/platform/tenant-types.ts:vatNumber`.  
**Status:** Med design. Hvis internasjonal-bruk → trenger UI.

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

### T4 — Ingen audit-log for Test Tools-bruk
**Beskrivelse:** Når Mike-admin bruker `OrgAdminListCard` / `OrphanInvitesCard` til å se PII for orphan-cleanup, logges det ingenting. D-078a noterer dette som P1 i ROADMAP.  
**Filer:** `app/api/admin/org-admins/all/route.ts`, `app/api/admin/orphan-invites/route.ts`.  
**Status:** P1 i backlog.

---

## Lukket (referanse)

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
