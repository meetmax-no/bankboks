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

### Fixed 2026-06-29
- ✅ **D-111** B1: Stale `activeLicenses`-felt → fjernet write i invite/accept, alle 6 lesere bruker nå `countLiveActiveLicenses`. Schema-felt beholdt som OPTIONAL response-only (samme mønster som `pendingInvitesCount`)
- ✅ **D-104b** B3: CreateTenantForm step 2 deduplisert → 3 nye block-komponenter (`SelskapFieldsBlock`, `KontaktFieldsBlock`, `FakturaFieldsBlock`) brukt av både edit- og create-mode. `CompanyDataSection` er nå dispatcher (discriminated union på `mode`). CreateTenantModal step 1 beholder kun subdomain+email, step 2 renderer `<CompanyDataSection mode="create">`
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
