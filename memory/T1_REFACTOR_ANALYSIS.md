# T1 — TenantViewer Refactor Analysis

**Status:** Utredning. Ingen kode endret per 2026-06-29.  
**Eier:** Mike (besluttes etter T4 evt. uten).  
**Relatert:** KNOWN_BUGS.md → T1, T4 + B2.

---

## Bakgrunn

`components/platform/TenantViewer.tsx` er **5091 linjer** og inneholder **39 top-level funksjoner**. Det er den klart største filen i kodebasen.

Per 2026-06-29 (etter D-104b deduplisering) består filen av:

```
TenantViewer.tsx (5091 linjer)
├── Liste-view (rot, ~750 linjer)
├── TenantDetailCard (åpnet rad — fra ~1214 til ~1900, ~700 linjer)
│   ├── Subtab: Selskap         (CompanyDataSection-dispatcher)
│   ├── Subtab: Kontakt         (CompanyDataSection-dispatcher)
│   ├── Subtab: Fakturering     (CompanyDataSection-dispatcher)
│   ├── Subtab: Lisens          (inline JSX ~300 linjer)
│   ├── Subtab: Invites         (inline JSX ~250 linjer)
│   ├── Subtab: Ansatte         (inline JSX ~200 linjer)
│   ├── Subtab: Audit/Raw       (inline JSX ~150 linjer)
│   └── Subtab: Test Tools      (inline JSX ~700 linjer)
├── CompanyDataSection-dispatcher + Edit + Create (~640 linjer, D-104b)
├── Field-blokker (Selskap/Kontakt/Faktura, ~280 linjer)
├── Felt-helpers (B2BField, Field, DarkSelect, FilterSelect, Editor-helpers, Badges — ~700 linjer)
├── CreateTenantModal + CreateChoiceModal (~700 linjer)
└── Test-Tools-komponenter (SyncStripeButton, TestCheckoutButton, ResendWelcomeButton, ProvisioningModal, DeleteResultModal, m.fl. — ~800 linjer)
```

## Hvorfor det er åpent

Tech-debt, ikke funksjonell debt. Filen FUNGERER. Risikoen for visuell regresjon er reell uten E2E-tester i pod. Mike har spec-et samme komponent 5 ganger gjennom utviklingen.

---

## To splitt-strategier vurdert

### Strategi A — Komponent-basert splitt

Splitt etter type-rolle (felt-helpers, blocks, dispatcher, etc).

**Foreslåtte filer:**
| Fil | Innhold | ~linjer |
|---|---|---|
| `TenantViewer.tsx` (igjen) | Rot + TenantDetailCard | ~2000 |
| `tenant-fields.tsx` | B2BField, Field, DarkSelect, FilterSelect, Editor-helpers, Badges | ~700 |
| `tenant-blocks.tsx` | SelskapFieldsBlock, KontaktFieldsBlock, FakturaFieldsBlock | ~280 |
| `tenant-company-data.tsx` | CompanyDataSection (dispatcher + Edit + Create) | ~640 |
| `tenant-create-modal.tsx` | CreateChoiceModal, ChoiceCard, CreateTenantModal | ~700 |
| `tenant-tools.tsx` | Test Tools-komponenter | ~800 |

**Estimat:** ~3 t med iterativ tilnærming.

**Risikoer:**
- Sirkulære imports (middels)
- Interne helpers lekker mellom moduler (høy)
- testId-konvensjoner brytes (lav)
- D-105/D-078-lint feiler (middels)
- Visuelle regresjoner — ingen statisk test fanger (middels)

### Strategi B — Domene-basert splitt (anbefalt)

Splitt etter feature/scope. Hver subtab i TenantDetailCard blir egen modul.

**Foreslåtte filer:**
```
TenantViewer.tsx (~1500 linjer)
  - List-view + TenantDetailCard som REN dispatcher

components/platform/tenant-sections/
├── LicenseSection.tsx         (~300 linjer)
├── InvitesSection.tsx         (~250 linjer)
├── EmployeesSection.tsx       (~200 linjer)
├── AuditSection.tsx           (~150 linjer)
└── TestToolsSection.tsx       (~700 linjer)

components/platform/CompanyDataSection.tsx  (~640 linjer — flyttet ut)
components/platform/tenant-blocks.tsx       (~280 linjer)
components/platform/tenant-fields.tsx       (~700 linjer)
components/platform/CreateTenantModal.tsx   (~700 linjer)
```

**Hvorfor det er bedre enn Strategi A:**

| Aspekt | Komponent-splitt | Domene-splitt |
|---|---|---|
| Mental modell | "hvor er Field?" | "jeg jobber med Lisens nå" |
| T4-beslutning | Audit-log må sneses inn på spredt kode | Én fil = TestToolsSection. Slett eller wrap audit lokalt |
| Risiko | Middels | **Lav — hver seksjon er allerede selvstendig render-blokk** |
| Verdi | Marginalt | **Høy — feature-modulering** |

**Hvorfor det er TRYGGERE:**
Hver "Subtab" i TenantDetailCard er allerede en isolert JSX-blokk uten cross-state. Å flytte den ut betyr:
1. Kopier JSX-blokken til ny fil
2. Identifisér props den trenger (record, onRefresh, t, etc.)
3. Eksporter komponenten
4. Erstatt blokken i parent med `<LicenseSection record={record} ...>`

Sammenligning: komponent-splitten flytter HELPERS som brukes overalt — hver flytting risikerer å bryte alle bruks-stedene.

---

## Anbefalt sekvens (Strategi B, iterativ)

```
Steg 1: TestToolsSection.tsx    (~45 min) ← STERK kandidat uavhengig av resten
Steg 2: LicenseSection.tsx      (~30 min)
Steg 3: InvitesSection.tsx      (~30 min)
Steg 4: EmployeesSection.tsx    (~30 min)
Steg 5: AuditSection.tsx        (~20 min)
[STOPP — TenantViewer er nå ~3500 linjer, fortsatt monolittisk men håndterbart]

Valgfritt fortsettelse:
Steg 6: CreateTenantModal.tsx              (~30 min)
Steg 7: CompanyDataSection + tenant-blocks (~40 min)
Steg 8: tenant-fields.tsx                  (~30 min)
[Endelig: TenantViewer ~1500 linjer]
```

**Risikodempende prinsipper:**
1. REN flytt, ALDRI logikk-endring under splitt
2. Mellom hvert steg: `yarn tsc --noEmit && yarn lint:all && yarn build`
3. Hvis ETT feiler → rollback steget umiddelbart
4. Re-eksport-mønster: behold backward-kompatible imports fra `TenantViewer.tsx` (`export { LicenseSection } from "./tenant-sections/LicenseSection"`) for å unngå å oppdatere imports i resten av kodebasen
5. Hver iterasjon = egen commit = rollback-checkpoint

**E2E-mitigering Mike må gjøre:**
- Klikk gjennom create-flow B2B (wizard step 1→2→3)
- Klikk gjennom edit-flow Selskap/Kontakt/Faktura-subtabs
- Klikk gjennom Lisens/Invites/Ansatte/Audit/Test Tools-subtabs
- Anbefalt etter steg 1, 5 og 8

**Hva som IKKE kan mitigeres med statisk testing:**
- Visuelle regresjoner (feil farge, padding-endring)
- Modal-z-index-problemer
- Hover-states som forsvinner

---

## Test Tools-spesifikt — sterk kandidat uavhengig

`TestToolsSection`-utskillelse er **lav-risiko og høy-verdi** uansett:

- Seksjonen er allerede halv-isolert (vises kun for super-admin)
- Direkte payoff for T4-beslutningen:
  - Hvis T4(a) "behold + audit": legg audit-wrapper i ÉN fil
  - Hvis T4(b) "slett": delete én fil + fjern én tab fra TenantDetailCard
- ~45 min arbeid, ~700 linjer ut av TenantViewer

**Anbefaling:** Kjør steg 1 (TestToolsSection-utskillelse) uavhengig av om resten av T1 gjennomføres. Den er en forutsetning for ren T4-implementering.

---

## B2C vs B2B-splitt — vurdert og avvist

Mike spurte om splitt etter customerType (B2C vs B2B) som "overbygg". Avvist fordi:
- B2C-koden er kun ~5-10% av filen
- TenantDetailCard ER allerede en dispatcher som rendrer 3 subtabs for B2C og 8 subtabs for B2B
- Å lage en `TenantDetailB2C.tsx` ville duplisert dispatcher-logikken uten verdi

**"Overbygg" finnes allerede i 2 lag:**
- `TenantViewer` = overbygg over liste + detail
- `TenantDetailCard` = overbygg over alle subtabs

Det som mangler er at subtab-innholdet IKKE er ekstrahert til egne moduler. De ligger inline i TenantDetailCard.

---

## Hva som ikke vurderes

- **Splitt i mikro-komponenter (10+ filer):** for fragmentert, øker import-støy
- **Lazy-loading av subtabs:** prematur optimalisering. Subtab-rendering er ikke et perf-problem
- **Felles state-container (Zustand/Redux):** unødvendig — props-drilling fungerer fint på dette nivået

---

## Beslutnings-status

| Steg | Status | Avhengigheter |
|---|---|---|
| Steg 1 (TestToolsSection) | **VENTER PÅ MIKE'S GO** | Ingen — kan kjøres nå |
| Steg 2-5 (Section-utskillelse) | Venter på Steg 1 | T4-beslutning hjelper men ikke blokkerer |
| Steg 6-8 (rest av T1) | Venter på Steg 1-5 | Kun gjennomføres hvis Steg 1-5 går glatt |

**Mike avgjør om/når T1 kjøres. Per 2026-06-29 ingen kode endret.**
