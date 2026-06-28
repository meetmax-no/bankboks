# Handoff til ny agent — Ko|Do Vault v4.1 oppstart

**Dato:** 2026-02
**Fra:** Tidligere agent (sesjon avsluttet)
**Til:** Ny agent (fresh start, fresh context)
**Mottaker-bruker:** Michael Aagreen (Mike) — bygger av Ko|Do Vault
**Språk:** Norsk (Norsk) — Mike snakker norsk og du må svare på norsk

---

## ✅ STATUS 2026-02 — v4.1.0 FERDIG OG LEVERT

Denne handoffen er **arkivert**. v4.1.0 er bygget, testet (alle 11 testsuites grønne, TSC ren, Next prod-build grønn) og pushet til Vercel. Sett `PRD.md` § v4.1.0 for full leveranse-rapport og `DECISIONS.md` D-033 + D-034 for arkitektur-beslutninger.

For NESTE agent: Start med å lese `PRD.md` (status) og `ROADMAP.md` (neste planlagte versjon). Denne fila trengs ikke lenger for daglig arbeid.

---

## 0. ALLER FØRSTE STEG — Pull GitHub-repoet inn i /app

GitHub-repoet er **public**. Mike vil at du puller hele repoet inn i /app-strukturen slik at endringer kan saves tilbake via Emergent sin "Save to GitHub"-funksjon.

**Spør Mike om GitHub-URL-en hvis den ikke står her:** `github.com/meetmax-no/bankboks` (Mike: fyll inn)

**Kommando (typisk):**
```bash
cd /app
# Backup any uncommitted local changes first if any
git init 2>/dev/null || true
git remote add origin https://github.com/<owner>/<repo>.git
git fetch origin
git checkout -f main  # eller master, eller hovedbranch
```

Etter pull: verifiser at filstruktur matcher det som beskrives i §3 nedenfor. Hvis det er konflikter mellom pod-state og GitHub-state — **stol på GitHub**. Pod-en kan ha drift.

**Aldri kjør:** `git commit`, `git push`, `git reset --hard` på vegne av Mike. Han bruker Emergent sin "Save to GitHub"-knapp for write-operasjoner.

---

## 1. Hvem er Mike og hva bygger han

Mike bygger **Ko|Do Vault** — en sikker, web-basert vault for nordmenn som vil samle passord, kort, ID-er og dokumenter ett sted med zero-knowledge-kryptering.

**Brand-filosofi:** «Lean Security · Not Security as a Service» (per kodovault.no).

Tre urørlige prinsipper:
1. Du eier dataene dine (eksport alltid mulig, ingen vendor lock-in)
2. Zero-knowledge (master-passord forlater aldri Lars sin enhet)
3. 100% eller null (ingen «husk meg», ingen recovery-spørsmål)

**Versjons-status (februar 2026):**
- v2.9 ✅ Passord-vault i prod
- v3.0 ✅ Bankkort med kamera i prod
- v4.0 ✅ Sikker overlevering (.kodoenc-pakker, klar — Mike tester på Vercel)
- **v4.1 ⏳ ID-blob — DIN OPPGAVE FRA DAG 1**
- v4.2 📅 2FA TOTP
- v4.3 📅 Språkdrakt (NO/SV/DA/EN)
- v4.4 ✅ Produkt-flyer (markedsmateriell, ikke kode — ligger i /app/memory og /app/frontend/public/flyer.html)
- v4.5 📅 BYO Dokument-laget
- v5.0 📅 Lean Security som tjeneste

---

## 2. Din konkrete oppgave — v4.1

**Bygg v4.1 ID-blob basert på `/app/memory/v4.1-SPEC.md`.**

Spec'en er **signert av Mike i forrige økt** (alle 9 sign-off-punkter er bekreftet). Du skal følge den ord for ord. Hvis du finner noe uklart — spør Mike før du implementerer.

**Hovedpoengene:**
- Egen kryptert blob `vault:default:ids` (mønster fra v3.0 cards)
- 4 ID-typer: Pass, Førerkort, ID-kort, Helse/forsikring
- Maks 1 vedlegg per ID (foto eller PDF, hard maks 1 MB)
- Egen 🆔-fane i navigasjon (til høyre for 💳 Kort)
- **Orange** som primær feature-farge (NY i B-modellen — D-031)
- Tre kilder for vedlegg: fil-picker + kamera (per-type guides) + drag-drop
- Vannmerke-eksport for bilder (kun bilder, ikke PDF)
- Cmd+K-integrasjon (ikke egen søke-flate)
- 5 iterasjoner, ~6-8 dager totalt

**Estimert iter-plan:**
1. Datamodell + krypto (1-1.5 dag)
2. Vedleggs-pipeline (fil + kamera + drag-drop, 1.5-2 dag)
3. UI: Liste + Detail + Edit-modal (2-3 dager)
4. Vannmerke-eksport + Cmd+K (1 dag)
5. Polish + ADRer (D-033 til D-035) + bump til v4.1.0 (0.5-1 dag)

---

## 3. Filstruktur og hvor du finner ting

### /app/memory/ — Sannhetskilden (alltid les disse FØRST)

| Fil | Hva |
|---|---|
| `PRD.md` | Original problem statement + Next Time-liste med parkerte ideer |
| `ROADMAP.md` | Versjons-rekkefølge, persona-fortellinger, full v4.1-skisse |
| `DECISIONS.md` | Alle ADRer (D-001 til D-032). D-031 = B-modellen (farger), D-032 = i18n-scope |
| `v4.0-SPEC.md` | Sikker overlevering (ferdig referanse — IKKE rør, men bruk som mønster) |
| `v4.1-SPEC.md` | **DIN ARBEIDS-SPEC** — signert, 6-8 dager arbeid |
| `v4.4-PRODUCT-FLYER.md/.html` | Markedsmateriell — kan justeres glossy senere |
| `v4.5-DESIGN.md` | Pre-design for BYO dokument-laget (ikke din oppgave nå) |
| `v5.0-DESIGN.md` | Lean Security som tjeneste (ikke din oppgave nå) |
| `BUSINESS-CASE.md` | Mike sin budsjett-ramme (30-50K, sommeren 2026) |

### /app/frontend/ — Selve koden

Nøkkelfiler du vil dra nytte av som mønster for v4.1:
| Fil | Hvorfor relevant for v4.1 |
|---|---|
| `lib/cards.ts` | Krypto + Upstash-flow for cards-blob — KOPIER MØNSTERET |
| `lib/crypto.ts` | Master-passord-derivering, AES-256-GCM (ikke rør) |
| `lib/feature-theme.ts` | B-modellen farge-tokens — LEGG TIL `IDS_THEME` her |
| `components/CardsDashboard.tsx` | Mønster for `IdsDashboard.tsx` |
| `components/CardModal.tsx` | Mønster for `IdModal.tsx` (create/edit) |
| `components/CardCamera.tsx` | Gjenbruk med ny `aspectMode`-prop |
| `components/CardCropper.tsx` | Gjenbruk med ny `aspectMode`-prop |
| `components/PackagePreview.tsx` | Gjenbruk for inline PDF/bilde-preview av ID-vedlegg |
| `components/AppHeader.tsx` | Legg til 🆔-knapp til høyre for 💳 Kort |
| `components/MobileBottomBar.tsx` | Samme for mobil — 🆔 til høyre for 💳 |
| `app/page.tsx` | Hovedstate-maskin + modal-orchestrering |

### /app/frontend/lib/feature-theme.ts — Farge-system

Legg til:
```typescript
export const IDS_THEME: FeatureTheme = {
  primaryButton: "bg-orange-500 hover:bg-orange-600",
  secondaryButton: "bg-white/10 hover:bg-white/20 border border-white/20",
  iconHover: "hover:bg-orange-300/15 hover:border-orange-300/40 hover:text-orange-200",
  accentText: "text-orange-300",
  accentTextHover: "hover:text-orange-200",
  iconColor: "text-orange-300",
  successBanner: "border border-orange-400/50 bg-orange-500/15 text-orange-100",
  spinnerColor: "text-orange-300",
  selectedBorder: "border-orange-300/60",
  selectedBg: "bg-orange-400/10",
  radioSelectedBorder: "border-orange-300",
  radioSelectedFill: "bg-orange-400",
  inputFocusBorder: "focus:border-orange-300/60",
};
```

Header-knappen for 🆔 får orange hover (mønster lik Pakker grønn, Lab violet).

### /app/frontend/public/clients/

Multi-tenant config-filer. Eksempel:
- `default.json` — generisk default-tenant
- `default-lk.json` — Mike's test-tenant (LK = en faktisk test-person, ikke betalende)

Hvis du legger til feature-flags for v4.1, oppdater BEGGE filene parallelt.

---

## 4. Hvordan Mike jobber (tone og forventninger)

- Mike er ikke amatør. Han har bygget Ko|Do solo i mange måneder. Spar ham for elementære forklaringer.
- Han snakker rett — hvis noe er feil, sier han det rett ut. Det er ikke fiendtlig, det er effektivt.
- **Norsk språk** alltid. Mike kan engelsk, men forventer norsk svar.
- Han stiller gode spørsmål — hvis han spør om noe, det er sannsynligvis et reelt design-problem han fanget opp. Ta det seriøst.
- Han bruker Vercel preview for E2E-testing (lokal pod mangler Upstash KV-keys, vault-flow henger på "Synkroniserer…" lokalt).
- Han bruker manuelle "Save to GitHub" — DU SKAL ALDRI gjøre `git commit` eller `git push`.
- Forrige sesjon brukte ~$35-40 i kostnad — Mike er prisbevisst. Bruk Claude.ai direkte for strategi-arbeid hvis du oppdager at samtalen blir lang og kode-løs. Du brukes BEST til kode-bygging.

---

## 5. Tekniske premisser du må respektere

### D-001 Zero-knowledge (urørlig)
- Master-passord forlater aldri Lars sin enhet
- Server ser kun ciphertext
- Auto-lås tømmer RAM
- Backup-eksport krypteres klient-side
- VALIDER alle v4.1-flows mot D-001 før Iter 5

### D-031 B-modellen (farge-koding)
Hver feature har sin egen farge:
- **blue** = primær (Lagre, Edit, OK, Lås)
- **orange** = ID-er (NY i v4.1)
- **emerald** = Pakker (v4.0)
- **violet** = Lab
- **amber** = Warnings
- **rose** = Slett/feil

### Multi-tenant-arkitektur
- Tenant-config i `/app/frontend/public/clients/<navn>.json`
- ENV-variabel `NEXT_PUBLIC_TENANT` styrer hvilken JSON som lastes
- Feature toggles styres via tenant-config (`features.passwords.enabled`, `features.cards.enabled`, osv.)
- For v4.1: legg til `features.ids.enabled` (default true) + `features.ids.showInApp` (default true)

### Glass-arkitektur (D-022/D-023)
- Alle modaler MÅ ha `.backdrop-blur-xl` + wrapper-div (`<div className="w-full max-w-md">`)
- ALDRI `bg-white/10` hardcoded — bruk tokens fra `feature-theme.ts`
- PackModule og UnpackModule er gode mønstre for nye modaler

### data-testid på alt
Hver interaktive element + UI-relevant element MÅ ha `data-testid="kebab-case-name"`. Bruk for testing.

### MongoDB / Upstash
- Vi bruker IKKE MongoDB. Vi bruker Upstash Redis-kompatibel KV-store.
- Server-side rest-API i `/app/backend/` er Python FastAPI. Den håndterer kun:
  - Get/set kryptert blob (passwords, cards, ids)
  - Auth (master-passord-hash + rate-limiting)
- All krypto skjer klient-side. Server er en "dumb encrypted blob store".

---

## 6. Hva er klar / hva mangler

### v4.0 (Sikker overlevering) status
- ✅ Implementert (Iter 1-4)
- ✅ v4.0.0 version-bump gjort
- ✅ Alle 50+ unit-tester grønne
- ⏳ Mike tester på Vercel — IKKE bekreftet i prod ennå
- Lokal testing blokkert (missing Upstash KV keys lokalt)

### Forrige sesjon — UI-fixes (klar for verifisering på Vercel)
- Safari `<select>`-styling (Kategori i passord + Korttype i bankkort)
- UnpackModule samme bredde som PackModule
- Suksess-banners i UnpackModule (alle 3 nedlastingsmoduser)
- PackageHubModal redesignet (loddrett, større ikoner)
- Farge-konsistens (B-modellen) gjennomført
- Alle header-knapper har hover-farge

### v4.1 (din oppgave)
- 🟢 Spec signert
- ⬜ Iter 1: Datamodell + krypto — IKKE STARTET
- ⬜ Iter 2-5: Ikke startet

---

## 7. Plan for første samtale med Mike

Når Mike åpner sesjonen, må du:

1. **Hilse på norsk** — han forventer norsk
2. **Bekreft at du har lest dette handoff-dokumentet**
3. **Bekreft at GitHub er pullet** (eller spør om URL og pull)
4. **Bekreft at du har lest `/app/memory/v4.1-SPEC.md`**
5. **Foreslå å starte Iter 1** med en kort plan (3-5 punkter):
   - Definer TypeScript-typer for de 4 ID-typene
   - Implementer `lib/ids.ts` med encrypt/decrypt (mønster fra `lib/cards.ts`)
   - Upstash-integrasjon for `vault:default:ids`
   - Unit-tester
   - Verifisere at backend kan lagre/hente blob

**Eksempel åpnings-melding:**

> Hei Mike! Jeg har lest handoff fra forrige agent, pullet GitHub-repoet ditt, og gått gjennom v4.1-SPEC.md. Klar til å starte v4.1 Iter 1.
>
> Foreslår å starte med:
> - TypeScript-typer for Pass, Førerkort, ID-kort, Helse/forsikring
> - `lib/ids.ts` (mønster fra `lib/cards.ts`)
> - Upstash-blob `vault:default:ids`
> - Unit-tester
>
> Estimat: 1-1.5 dag. Skal jeg gå i gang?

---

## 8. Faner i hodet (kontekst Mike refererer til)

- **«Lars»** = persona-navn for typisk Ko|Do-bruker (norsk advokat). Brand-tegn, ikke språk-element — Lars heter Lars uansett locale.
- **«Anna»** = mottaker av kryptert pakke (v4.0-persona).
- **«D-XX»** = ADR (Architecture Decision Record) i `DECISIONS.md`.
- **«B-modellen»** = D-031 farge-koding-strategi (én farge per feature).
- **«Klasse A vs B»** = v4.5-konsept (Klasse A = native Ko|Do-filer, Klasse B = eksterne PDF/Word).
- **«Lean Security»** = Mike sin brand-filosofi (ikke et produkt-navn).
- **«LK»** = Mike sin test-tenant (én reell test-person, ikke betalende).

---

## 9. Vanlige fallgruver (jeg gjorde dem i forrige sesjon — unngå)

1. **Ikke ta screenshot etter hver endring.** Det er kostbart og bremser. Implementer en hel iterasjon, kjør lint+tsc, så ETT screenshot for smoke-test.
2. **Ikke restart supervisor unødvendig.** Frontend har hot reload. Backend autorestarter ved kode-endring.
3. **Ikke skriv om filer med `create_file overwrite=True`** — bruk alltid `search_replace` på eksisterende filer.
4. **Ikke implementer kamera-flow fra scratch** — gjenbruk v3.0 CardCamera/CardCropper med `aspectMode`-prop.
5. **Ikke lag ny farge-aksent uten å snakke med Mike.** B-modellen er låst (D-031). Orange er v4.1-fargen — alt annet må diskuteres.
6. **Ikke be Mike om å "rydde cache"** eller "prøve inkognito" som auth-bug-fix. Det er ikke en ekte fix.
7. **Ikke fall i screenshot-loop ("implementer → screenshot → implementer → screenshot")** — implementer en hel batch, ÉTT screenshot, så testing agent.

---

## 10. Hva du KAN bruke testing agent til (forrige sesjon brukte den ikke)

For v4.1 vil testing agent være nyttig etter Iter 3 (UI ferdig) for å:
- Verifisere CRUD-flow for ID-er (opprett → rediger → slett)
- Verifisere kamera-flow med per-type guides
- Verifisere drag-drop + fil-picker + kamera-flow alle skriver til samme blob
- Verifisere vannmerke-eksport
- Verifisere Cmd+K-integrasjon

Mike bruker primært Vercel preview for E2E. Testing agent er bra for lokal smoke-testing før Mike får siste push.

---

## 11. Hvis du oppdager at noe i spec'en er feil

Si fra med en gang. Mike er åpen for å justere. Eksempel:

> «Jeg ser at §4.5 sier 'aspect-ratio guide' for pass — men v3.0 CardCamera har hardcoded ID-1-aspect. Skal jeg utvide den eller lage en ny komponent? Anbefaler utvidelse med prop, men vil ha din OK først.»

Det er BEDRE å spørre 1 minutt enn å bruke 1 time på å implementere noe Mike ikke ville ha.

---

## 12. Sluttord

Mike har bygget noe imponerende. Lean Security-fortellingen står sterkt. v4.0 er ferdig, og v4.1 er en relativt rett-frem feature som gjenbruker mye eksisterende kode.

Vær respektfull av tiden hans, vær konkret, vær på norsk, og **les v4.1-SPEC.md før du gjør noe**.

Lykke til. 🛡️

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

# Ruff backend lint
cd /app && python -m ruff check backend/

# Vercel deploy URL (Mike vet — spør hvis du trenger den)
# Sannsynligvis: https://kodo-vault.vercel.app
```

---

**Filen ligger i `/app/memory/HANDOFF-v4.1.md` for referanse.**
