# Ko|Do · Vault — Architecture Decision Records (ADR)

**Hva er dette?** Hver gang vi tar en strukturell beslutning som påvirker hvordan appen bygges, dokumenteres den her. Dette er den **røde tråden** — så fremtidige agenter (eller deg selv om 6 måneder) ser hvorfor ting er som de er, og hvilke spor som er forkastet.

**Format per beslutning:**
- DATO
- KONTEKST (hva vi diskuterte)
- VURDERTE (hvilke alternativer)
- VALGTE (hva vi gikk for)
- HVORFOR (rasjonale)
- KONSEKVENS (hva dette tvinger oss til / utelukker)

Beslutninger her er **ikke åpne for re-diskusjon** uten ny eksplisitt vurdering. Hvis en agent foreslår noe som motsier en ADR, skal de henvise til ADR-en og spørre brukeren om den skal revideres.

---

## D-001: 100% eller 95% — North Star
**DATO:** 2026-02 (lørdag-søndag-samtale)
**KONTEKST:** Diskuterte expiry-mekanismer og generell sikkerhetsfilosofi for Ko|Do Vault.
**VURDERTE:**
- Honor-system (UI sjekker dato i kryptert blob)
- Server-side escrow (key delt mellom klient og server)
- 100%-prinsipp som styrende filosofi

**VALGTE:** **100%-prinsipp som North Star.** Ingen funksjon bygges hvis sikkerheten kun er 95%.

**SITAT:**
> "Spørsmålet er om det skal være 100% eller 95% — og svaret er 100%, ellers synker vi en eller annen dag, du vet bare ikke når."
> — Michael Aagreen, 2026-02

**HVORFOR:** Honor-system gir falsk trygghetsfølelse. Brukere stoler på at "utløpt" betyr "kan ikke åpnes", men devtools bypasser sjekken på 30 sekunder. En advokat som sender klient-data basert på falsk trygghet kan skade en sak Lars aldri vet om.

**KONSEKVENS (permanent utelukket):**
- ❌ Klient-side expiry-sjekk i blob
- ❌ Soft-delete (papirkurv)
- ❌ "Husk meg i 30 dager" uten ekte token-rotasjon
- ❌ Passord-hint, recovery-spørsmål
- ❌ Subdomene-baserte "autentiseringer" (kun master-passord teller)
- ❌ Backup uten passord
- ✅ Hver fremtidig avgjørelse må passere 100%-testen før implementering

---

## D-002: Egen blob for ID-er (v3.0)
**DATO:** 2026-02 (søndag)
**KONTEKST:** Pass, kjørekort, kort-PIN, virtuelle kort, forsikringskort skal lagres med struktur (ikke generiske passord-oppføringer). Spørsmål: én eller to blobs?

**VURDERTE:**
- (a) Samme blob (`vault:default`) — én lås, alt sammen
- (b) Separat blob (`vault:default:ids`) — samme master-passord, lazy-loaded

**VALGTE:** **(b) — separat blob med samme master-passord.**

**HVORFOR:** Performance. ID-er er tunge (foto av pass kan være 2-3 MB hver). Hvis alt ligger i én blob, lastes det ned + krypteres på nytt ved hver endring av et passord. Med to blobs:
- `vault:default` (passord) ~50 KB → laster på 0,1 sek (daglig bruk)
- `vault:default:ids` (ID-er) ~5-10 MB → laster KUN ved klikk på ID-fanen (ukentlig/månedlig)

**KONSEKVENS:**
- Begge blobs deriverer nøkkel fra samme master-passord (ulik salt)
- Ingen ekstra lås for ID-laget (brukeren ville ikke ha det)
- Lazy-loading-mønster må implementeres
- Setter mønsteret for fremtidige lag (Dokumenter v4.5 vil også være egen blob)

---

## D-003: FLYT B uten expiry, kun 1 nøkkel
**DATO:** 2026-02 (søndag)
**KONTEKST:** "Sikker overlevering" (.kodoenc-pakker). Skal pakker kunne utløpe?

**VURDERTE:**
- Mulighet 1: Aldri utløper, ett engangs-passord
- Mulighet 2: Selvødeleggende (klient-side dato-sjekk) — **avvist av D-001**
- Mulighet 3: Server-side escrow med Key1+Key2 (ekte kryptografisk expiry)

**VALGTE:** **Mulighet 1 — ingen expiry, kun 1 engangs-passord.**

**HVORFOR:**
- Honor-system bryter D-001 (100% North Star).
- Server-side escrow legger til avhengighet (mottaker trenger internett ved opning), kompleksitet (Ko|Do-server holder Key2), og potensiell utfall ved nedetid.
- Mulighet 1 er kryptografisk renest: PGP-modellen, brukervennlig.

**KONSEKVENS:**
- Pakker lever for evig på mottakers disk (til mottaker sletter)
- Lars må fortelle mottaker: "Jeg kan ikke trekke det tilbake. Slett når du er ferdig."
- Ingen Ko|Do-server involvert i FLYT B (mer holdbart, færre feilkilder)
- Funker offline for mottaker
- Renere historie å fortelle: "Akkurat som PGP, men brukervennlig"

---

## D-004: v4.0 før v4.5 (rekkefølge på grenene)
**DATO:** 2026-02 (søndag)
**KONTEKST:** Rekkefølge for utvikling: Sikker overlevering eller Dokument-laget først?

**VURDERTE:**
- v4.5 (Dokumenter) først — utvider eksisterende app naturlig
- v4.0 (Sikker overlevering) først — bygger pakke-format som v4.5 gjenbruker

**VALGTE:** **v4.0 først, v4.5 etterpå.**

**HVORFOR:**
- v4.0 bygger ZIP STORE-container + krypteringsformat + fil-håndtering UI som v4.5 gjenbruker (~90% kode-deling)
- v4.0 er enklere arkitektur (ingen Drive OAuth, ingen lazy-loading av tung blob)
- v4.0 gir tidlig win + valideringspunkt med Lars før vi bygger v4.5
- v4.5 vil være "samme greie, men mot Drive i stedet for fil-nedlasting"

**KONSEKVENS:**
- Stamme: v3.0 → Gren 1: v4.0 → Gren 2: v4.5 → Kvist: vX
- v4.5 (Dokument-laget med BYO Drive) **utsatt detaljdiskusjon** til v3.0 er ferdig og vi har lært av faktisk bruk

---

## D-005: UC-3a (Advokat) som primær persona
**DATO:** 2026-02 (søndag)
**KONTEKST:** Tre kandidat-personas vurdert: Advokat, Lege, Journalist.

**VURDERTE:**
- UC-2 Lege: Lavt budsjett for sikkerhetsverktøy, regulert av Helsetilsynet
- UC-3a Advokat: Schrems II + advokatforskriften, høy betalingsvilje
- UC-3c Journalist: Krever destruktive features (decoy, self-destruct, Tor)

**VALGTE:** **Advokat (UC-3a) som primær persona for v3.0–v4.5. Journalist degradert til vX-kvist (kanskje aldri).**

**HVORFOR:**
- Lege: Liten betalingsvilje + regulatoriske krav vi ikke vil håndtere
- Advokat: Eksisterende arkitektur (zero-knowledge, audit-log, hybrid Drive) treffer 80% av behovet
- Journalist: Krever helt andre features (decoy mode, plausible deniability, Tor-kompat) som er en separat produkt-type

**VALIDERING:** Lars er en **fiktiv HR-advokat-persona** brukt i samtaler og fortellinger — ikke en reell kontakt som skal valideres. Personaen styrer feature-prioritering og UX-design, men det er Mike sin egen daglige bruk som er den primære valideringsdriveren.

**KONSEKVENS:**
- Posisjonering: "Compendia for firma. Ko|Do for meg selv." Skygge-arkiv som **utfyller**, ikke konkurrerer med, advokatfirmaers compliance-systemer
- Bruker ikke til: saks-arkivering, klient-CRM, klient-deling, 10-års oppbevaringsplikten (det er Compendia)
- Bruker til: personlig passord-arkiv, strategi-notater før sak, dokument-buffer for reise, familiens ID, backup-of-last-resort
- Journalist-features holdes på avstand (ikke "smitter" arkitekturen)

---

## D-006: Mental modell — "Virtuell sikker disk"
**DATO:** 2026-02 (søndag)
**KONTEKST:** Hvordan skal Lars konseptuelt forstå Dokument-laget (v4.5)?

**VALGTE:** **"Virtuell disk i nettleserens minne, montert med master-passord, demontert ved auto-lås."**

**HVORFOR:** Dette er den enkleste mentale modellen som matcher den faktiske tekniske implementasjonen. Lars kjenner konseptet fra VeraCrypt/Cryptomator. Brukeren forstår intuitivt at:
- Filer "finnes" når disken er montert (i RAM)
- Filer "forsvinner" når disken demonteres (auto-lås)
- Kun den krypterte blob-en er persistent

**KONSEKVENS:**
- Filer redigeres INNE i Ko|Do Vault (innebygd editor for tekst, PDF.js for visning)
- Ingen lokal disk-skriving av ukrypterte filer (med unntak av eksplisitt "Last ned"-flow med advarsel)
- Word/Excel: separat sikker download-flow med 60-sek auto-slett av nedlastet fil
- Auto-lås tømmer RAM → alle "filer" forsvinner → kun .enc-blob på Drive igjen

---

## D-007: ZIP STORE-modus (ikke DEFLATE)
**DATO:** 2026-02 (lørdag)
**KONTEKST:** ZIP-container for Dokument-laget — skal vi komprimere?

**VURDERTE:**
- DEFLATE (standard ZIP-kompresjon)
- STORE (ingen kompresjon, kun pakking)

**VALGTE:** **STORE-modus.**

**HVORFOR:** Brukerens filer (PDF, Word, JPEG, HEIC) er allerede komprimerte formater. DEFLATE gir 0-7% størrelses-besparelse i praksis, men koster 10-20x CPU. STORE gir samme størrelse, mye raskere pakking/dekoding, mindre batteribruk på mobil.

**KONSEKVENS:** ZIP-formatet brukes for STRUKTUR (mappehierarki, filnavn, atomicity), ikke for KOMPRESJON.

---

## D-008: Dokumentasjon-arkitektur (PRD/ROADMAP/DECISIONS)
**DATO:** 2026-02 (søndag)
**KONTEKST:** Mike bekymret for kontekst-tap når samtalen komprimeres eller ny fane åpnes.

**VALGTE:** **Tredelt dokumentasjon:**
- `PRD.md` — "What is": North Star, arkitektur, hva som er bygget
- `ROADMAP.md` — "What's coming": v3.0/v4.0/v4.5/vX med fortellinger
- `DECISIONS.md` — "Why we chose what we chose": ADR-format

**HVORFOR:** PRD blir for stor og blander historie + plan + rasjonale. Splittingen lar fremtidige agenter raskt finne hva som er bygget (PRD), hva som kommer (ROADMAP), og hvorfor (DECISIONS). Nyanser fra samtaler bevares i DECISIONS.

**KONSEKVENS:** Når en fremtidig agent åpner prosjektet, MÅ de lese alle tre dokumenter før de foreslår endringer. Forslag som motsier en ADR uten ny diskusjon med brukeren skal avvises.

## D-009: Bruker-kontrollert container-gruppering (v4.0/v4.5)
**DATO:** 2026-02 (søndag kveld)
**KONTEKST:** Hvor mange krypterte containere skal v4.0/v4.5 lage av en gitt mengde filer?

**VURDERTE:**
- (A) Én stor container — alt i ett, enkel, men treg per operasjon
- (B) Gruppert default — appen bestemmer optimal split
- (C) Per-fil container — maks fleksibilitet, lekker filnavn-mønstre
- (D) **Bruker velger selv** med tidsestimat-info

**VALGTE:** **(D) — brukeren velger selv 1 eller flere krypterte filer basert på tid/ytelse-trade-off.**

**HVORFOR:**
- Lars vet bedre enn oss hva han prioriterer (rask åpning vs. enkel backup)
- "One size fits all" bryter Mike sin filosofi om at brukeren skal eie sine valg
- Vi har data (tidsestimater per filstørrelse) som gjør valget informert, ikke gjettet

**IMPLEMENTASJON (UX-spec):**
Pre-opplastings-dialog viser:
- Filstørrelse per gruppering (totalt + per container)
- Tidsestimat for kryptering
- Tidsestimat for fremtidig dekryptering (ved åpning)
- "Intelligent forslag" basert på filnavn-mønstre (lokal analyse, ingen AI)
- Advarsler ved ekstreme valg (f.eks. 500 MB container på mobil)

Tidsestimater (referanse, iPhone 13 / M1):
- 10 MB: ~200ms krypt + ~5s total flow
- 100 MB: ~2s krypt + ~30s total flow
- 500 MB: ~10s krypt + ~3min total flow
- 1 GB: ~20s krypt + ~6min total flow

**KONSEKVENS:**
- UI for pre-opplasting blir et eget produkt-element (ikke trivielt)
- Vi må kalibrere estimater på første kryptering (mål faktisk hastighet på enheten)
- Grensesnittet må fungere på mobil (knapper for 1, 2, 3+ containere)
- ZIP STORE-modus (D-007) er forutsetning for at tidsestimatene holder

---

## D-010: 2FA TOTP integrert i passord-oppføringer (v3.1)
**DATO:** 2026-02 (søndag kveld)
**KONTEKST:** Mike er frustrert over Google Authenticator: må alltid bytte til app, taste manuelt, og verst av alt — mister man telefonen mister man tilgangen, og telefon-bytte krever manuell eksport/import.

**VURDERTE:**
- (a) Behold separat 2FA-app — tradisjonell tofaktor-tankegang
- (b) Integrer TOTP i Ko|Do Vault — bekvemmelighet + bedre sikkerhet enn GA

**VALGTE:** **(b) — TOTP integrert som felt på passord-oppføringer i v3.1.**

**HVORFOR:**
- Google Authenticator har null sikkerhet utover at telefonen er låst. Tyv med ulåst telefon = full 2FA-tilgang umiddelbart.
- Ko|Do Vault krever master-passord (PBKDF2 600k) eller Touch ID/Face ID — **bedre sikkerhet enn GA**.
- Telefon-bytte: GA krever manuell eksport/import. Ko|Do = automatisk via kryptert blob i Upstash.
- Bygger på eksisterende passord-blob (ingen ny arkitektur).

**NORTH STAR-VURDERING (D-001):**
Trade-off: Hvis master-passord kompromitteres, mister bruker både passord og 2FA for samme tjeneste. Dette er kjent og adresseres med:
- Touch ID/Face ID som default (gjør master-passord-kompromittering vanskeligere)
- **Valgfritt per oppføring** — bruker kan velge å IKKE lagre 2FA for kritiske kontoer (nettbank, e-post)
- Tydelig advarsel ved aktivering med eksempler ("Anbefales IKKE for: nettbank, e-post, kryptobørser")
- Seeden vises ALDRI i UI etter setup — kun den 6-sifrede koden

**KONSEKVENS:**
- Nytt felt på `VaultEntry`: `totpSeed?: string` (base32)
- Nytt npm-bibliotek: `otpauth` (TOTP-generering)
- Nytt npm-bibliotek: `html5-qrcode` (QR-scanning fra mobilkamera)
- Manuell seed-input som fallback hvis QR ikke funker
- Live 6-sifret kode med nedtellings-stolpe i `EntryModal`
- Klikk-å-kopier med samme auto-clear (30 sek) som passord
- v3.1 kommer ETTER v3.0, FØR v4.0

**MIGRERINGS-STØTTE:**
- Bulk-import fra Authy/1Password (de kan eksportere seeder)
- Fra Google Authenticator: må re-aktivere 2FA per tjeneste (GA har ingen eksport)
- Anbefal parallell drift en periode (Ko|Do primær, GA backup) under migrering

---

## D-011: Clipboard auto-clear tid — config-styrt med clamp (v2.9)
**DATO:** 2026-02 (søndag kveld)
**KONTEKST:** Når Lars kopierer et passord fra Ko|Do Vault, tømmes utklippstavlen automatisk etter 30 sek (i dag fast verdi via `default.json` → `security.clipboardClearSeconds`). 30s er for kort — Lars mister ofte passordet før han rekker å lime inn. Mike vil ha det justerbart, men ikke som en feature brukeren fikler med.

**VURDERTE:**
- (a) Slider/UI i Settings — avvist (overengineered)
- (b) Bare config-verdi i `default.json` + clamp ved innlesning
- (c) Hardkodet 2 min for alle

**VALGTE:** **(b) — config-verdi i `default.json` med clamp ved innlesning.**

**HVORFOR:**
- Dette er ikke noe brukeren endrer ofte. Sett en gang, ferdig.
- Multi-tenant-klart (`clients/<name>.json` kan ha ulik verdi per klient)
- North Star-vakt via clamp: ingen kan ved uhell sette en svekkende verdi

**IMPLEMENTASJON:**
- `default.json` → `security.clipboardClearSeconds: 120` (2 min)
- Ved innlesning i `useAppConfig.ts`:
  - Verdi > 120 → clamp til 120
  - Verdi < 10 → clamp til 30 (default fallback)
  - Manglende verdi → bruk 30 (eksisterende fallback)
- Ingen UI-endringer
- Ingen slider, ingen settings-knapp

**NORTH STAR-VURDERING (D-001):**
- Hard maks 2 min sikrer at ingen klient-config kan ved uhell svekke sikkerheten
- "Aldri tøm" eksisterer ikke som mulighet (clamp tvinger en max)

**KONSEKVENS:**
- v2.9 er en mini-release: én linje endring i `default.json` + clamp-funksjon i config-laster
- Eksisterende `clipboardClearSeconds`-bruk i `EntryModal.tsx` etc. krever ingen endring
- Dokumentert at fremtidige `clients/<name>.json`-filer er begrenset til 10-120 sek

---

## D-012: Tre-blob-arkitektur (v3.0)
**DATO:** 2026-02 (mandag morgen)
**KONTEKST:** Hvordan splitte data over Upstash-blobs? Første forslag var foto-i-Blob-3, data-i-Blob-2 med cross-linking — Mike utfordret denne splittingen som overengineered.

**VURDERTE:**
- (a) Én stor blob (dagens v2.3) — alt sammen
- (b) To blobs (passord + ID+kort) — bedre, men AMEX-bruk blir langsom
- (c) Tre blobs med foto-splitt (min første forslag) — overengineered, cross-linking-kompleksitet
- (d) Tre blobs, hver selvstendig (foto + data sammen) — VALGT

**VALGTE:** **(d) — Tre-blob-arkitektur der hver blob er komplett i seg selv.**

```
Blob 1: vault:default          (~50 KB)   HOT — passord, 2FA-seeder (v3.1)
Blob 2: vault:default:cards    (~3 MB)    WARM — kort (data + foto sammen)
Blob 3: vault:default:ids      (~5 MB)    COLD — pass, førerkort, forsikring (data + foto sammen)
```

**HVORFOR:**
- Performance-analysen viste at 2-3 MB lazy-loaded blob laster på ~0,5-1 sek — ikke et reelt problem
- Cross-linking mellom blobs introduserer kompleksitet uten proporsjonal gevinst
- Regel: "Data som hører logisk sammen, bor fysisk sammen"
- Blobs splittes KUN når tilgangsmønsteret er **fundamentalt** forskjellig (ikke marginalt)

**IMPLEMENTASJON:**
- Hver blob: eget Upstash-key, samme master-passord, ulik salt
- Alle blobs lazy-loaded (hentes først når brukeren trenger det)
- Auto-lås tømmer ALLE blobs fra RAM samtidig
- `linkedPasswordId` kan lenke kort → passord (reell logisk kobling mellom to ulike datatyper — innlogging vs kort)
- INGEN `linkedPhotoId` eller andre cross-blob-koblinger — foto bor alltid sammen med sitt data-objekt

**NB (2026-02 mandag):** `linkedPasswordId` ble senere **eksplisitt forkastet** i D-015. Kort og passord forblir separate oppføringer uten kryss-kobling. Denne linjen beholdes her som historisk referanse til diskusjonen.

**FOTO-KOMPRIMERING (konfigurerbar fra default.json):**
- `image.maxWidth: 1200` (default)
- `image.maxHeight: 750` (default)
- `image.quality: 0.75` (JPEG 75%)
- `image.format: "image/jpeg"` (WebP kan vurderes senere)
- Resultat ved default: ~150-250 KB per foto
- Clamp ved innlesning (ingen verdier som bryter North Star — f.eks. kvalitet < 0.5 svekker lesbarhet)

**KONSEKVENS:**
- v3.0 introduserer BÅDE Blob 2 (cards) og Blob 3 (ids)
- Strukturerte typer per blob (kortlister, ID-lister)
- Backup-eksport må håndtere alle tre blobs (utvidelse av v2.2 backup-format)
- Fremtidige lag (v4.5 docs, vX journalist) følger samme mønster: egen blob, komplett i seg selv

---

## D-013: Splitt v3.0 i to versjoner (v3.0 + v3.2)
**DATO:** 2026-02 (mandag morgen)
**KONTEKST:** v3.0 inneholdt BÅDE Blob 2 (cards) og Blob 3 (ids). For stor oppgave i én release — risiko for bugs, forsinket testing, scope-creep.

**VALGTE:** **Splitt v3.0 i to separate releases:**
- **v3.0** → Blob 2 (cards) — AMEX-use-case, Mike sitt daglige behov
- **v3.2** → Blob 3 (ids) — pass, førerkort, forsikring (sjeldnere bruk)

**HVORFOR:**
- Mindre releases = mindre risiko, raskere verdi-levering
- Mike trenger AMEX-funksjonen mest (daglig bruk), ID-delen er mindre tidskritisk
- Foto-håndtering og strukturerte typer testes først på kort, deretter gjenbrukes pattern for ID
- Lærdom fra v3.0 informerer v3.2-implementasjon

**REVIDERT RELEASE-PLAN:**
```
v2.9  → Clipboard 2 min default
v3.0  → Blob 2 (cards) — AMEX + kortstruktur
v3.1  → 2FA TOTP i Blob 1
v3.2  → Blob 3 (ids) — pass, førerkort, forsikring
v4.0  → Sikker overlevering (.kodoenc)
v4.5  → Dokument-laget (BYO Drive)
```

**KONSEKVENS:**
- v3.0 scope redusert → raskere til prod
- D-012 (tre-blob-arkitektur) gjelder fortsatt, men Blob 3 kommer i v3.2
- Backup-format må håndtere variabelt antall blobs (v2.3: 1, v3.0: 2, v3.2: 3, v4.5: 4)

---

## D-014: Custom kamera-fangst for foto (v3.0 + v3.2)
**DATO:** 2026-02 (mandag morgen)
**KONTEKST:** Når brukere skal ta foto av kredittkort (v3.0) eller pass/førerkort (v3.2), MÅ fotoet aldri havne i Camera Roll/iCloud Photos.

**VURDERTE:**
- (A) File upload fra galleri — bildet lekker til iCloud/Camera Roll først
- (B) HTML `capture="environment"` — lagrer ofte i Camera Roll som bieffekt (skjult)
- (C) Custom kamera med `getUserMedia` + file upload som fallback med advarsel

**VALGTE:** **(C) — Custom kamera som primær, file upload som valgfri fallback.**

**HVORFOR:**
- Varianter (A) og (B) bryter D-001 (100% North Star) — bildet finnes i iCloud før det krypteres
- AMEX-kort i iCloud Photos = synlig for Apple, i "Nylig slettet" i 30 dager, potensielt i backup
- Pass-foto lever livslangt — enda mer kritisk
- Brukeren må kunne stole på at "ta bilde" i Ko|Do Vault = 100% sikker

**IMPLEMENTASJON:**

**Primær flow — Custom kamera:**
1. Bruker klikker "📷 Ta foto av forside"
2. Nettleser spør om kamera-tillatelse (første gang)
3. Custom kamera-view i appen (ikke native Apples Kamera-app)
4. Live preview + fokus-ramme + tips ("legg kortet flatt, unngå refleks")
5. Fang bilde → vises preview → "Bruk" eller "Ta på nytt"
6. Komprimer: 1200px, 70% JPEG (~300 KB)
7. Krypter og lagre i blob
8. **Bildet har ALDRI vært utenfor nettleserens minne**

**Fallback flow — File upload:**
1. Bruker klikker "📁 Last opp fra galleri"
2. Tydelig advarsel: "⚠️ Dette bildet finnes allerede utenfor Ko|Do Vault. Husk å slette originalen fra galleriet og iCloud etter opplasting."
3. File picker → komprimer → krypter → lagre
4. Brukeren velger informert — ingen skjult lekkasje

**TEKNISK:**
- `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` for bakkamera
- Canvas til å fange still-frame fra video-stream
- Canvas-til-blob med JPEG-komprimering
- Ingen mellomlagring til disk

**NORTH STAR-VURDERING (D-001):**
- ✅ Primær flow: bildet kun i RAM før kryptering = 100%
- ✅ Fallback flow: brukeren informert om trade-off = ikke falsk trygghet
- ❌ Avvist: Skjulte lekkasjer via HTML `capture` uten advarsel

**KONSEKVENS:**
- v3.0 får custom kamera-komponent (~1-2 timer arbeid)
- v3.2 gjenbruker samme komponent for pass/førerkort-foto
- Fremtidige foto-behov (v4.5 dokumenter, vX journalist) arver samme mønster
- Komponent må støtte både bakkamera (environment) for kort/pass og frontkamera (user) for eventuelle fremtidige use-cases
- Browser-kompatibilitet: getUserMedia krever HTTPS (vi har via Vercel)

---

## D-015: Felt-spesifikasjon for kredittkort/debetkort (v3.0)
**DATO:** 2026-02 (mandag)
**KONTEKST:** Definere alle felter for kort-oppføring i Blob 2. Diskutert frem og tilbake til Mike bekreftet hva han trenger.

**VALGTE FELTER:**

**Påkrevd:**
- `title` — Tittel (f.eks. "AMEX Platinum", "DnB Visa")
- `cardType` — "credit" | "debit" | "virtual" | "reward" (bonuskort)
- `cardNumber` — Kortnummer (15 eller 16 sifre)
- `holderName` — Innehaver-navn
- `expiryMonth` — Utløpsmåned (MM)
- `expiryYear` — Utløpsår (YYYY)

**Valgfritt:**
- `cvv` — Sikkerhetskode (3 for Visa/MC, 4 for AMEX)
- `pin` — PIN-kode
- `issuer` — Bank/utsteder (DnB, AMEX, Revolut, etc.)
- `photoFront` — Foto forside (base64, komprimert per D-014)
- `photoBack` — Foto bakside (base64, valgfritt — mange kort har ingenting på baksiden)
- `customerServicePhone` — Kundeservice telefon (click-to-call via `tel:`)
- `customerServiceUrl` — Kundeservice URL (click-to-open)
- `lostCardPhone` — "Mist-kort" nødtelefon (egen rød knapp i UI)
- `notes` — Fritekst-notater
- `favorite` — Stjerne-markering
- `rewardProgram` — Bonusprogram-navn (Eurobonus, Membership Rewards, etc.)
- `annualFee` — Årsavgift / månedlig avgift (fritekst — f.eks. "900 NOK/år")

**Automatisk:**
- `id` — UUID
- `createdAt` — ISO timestamp
- `updatedAt` — ISO timestamp

**EKSPLISITT UTE AV SCOPE (Mike sa nei):**
- ❌ Kredittgrense
- ❌ Valuta
- ❌ `linkedPasswordId` — kort og passord er separate oppføringer, **ingen kobling mellom blobs**. Brukerens mentale modell: passord er hot (brukes ofte), kort er warm (brukes når trengs). Kobling tvinger begge til å lastes samtidig og forvirrer UX.

**HVORFOR:**
- Mike følger "lean security" — bare det som er **reelt nyttig** per hans bruk, ikke "kanskje-nyttig"
- Kredittgrense og valuta er mer økonomi-tracking enn sikker oppbevaring

**KONSEKVENS:**
- `VaultCard` type i `lib/types.ts` — definerer strukturen
- `CardModal` komponent med disse feltene
- UI: Click-to-call/open for tel/URL-feltene
- UI: "Mist-kort"-knapp alltid synlig og visuelt distinkt (rød) hvis feltet er satt

---

## D-016: Konfigurerbare bilde-komprimerings-innstillinger (v3.0)
**DATO:** 2026-02 (mandag)
**KONTEKST:** Bilde-komprimering skal være konfigurerbar fra `default.json`, ikke hardkodet.

**VALGTE:** Legg til `image`-seksjon i `default.json`:

```json
{
  "image": {
    "maxWidth": 1200,
    "maxHeight": 750,
    "quality": 0.75,
    "format": "image/jpeg"
  }
}
```

**HVORFOR:**
- Multi-tenant-klart (`clients/<name>.json` kan justere for ulike bruk)
- Mike kan senere eksperimentere med andre verdier uten kode-endring
- 1200 × 750 gir ~150-250 KB per foto ved 75% JPEG — god balanse mellom lesbarhet og størrelse

**CLAMP VED INNLESNING (North Star):**
- `maxWidth`: min 400, max 2400 (under 400 = ulesbart, over 2400 = for stort)
- `maxHeight`: min 300, max 1800
- `quality`: min 0.5, max 0.95 (under 0.5 = blurry, 1.0 = PNG-aktig stor)
- `format`: kun "image/jpeg" eller "image/webp" tillatt

**KONSEKVENS:**
- Ny seksjon i `AppConfig` typen
- Compressor-funksjon i `lib/image-compress.ts` bruker disse verdiene
- Gjelder alle foto-felt i hele appen (kort, ID, fremtidige dokumenter)

---

## D-017: Clipboard-modus med "tett skip"-opsjon (v2.9)
**DATO:** 2026-02 (mandag)
**KONTEKST:** Web-platformen kan ikke garantere 100% clipboard-tømming. Selv med absolutt deadline + visibility/focus-handling henger passordet i clipboard hvis brukeren lukker fanen før timer utløper. I tillegg lekker passordet potensielt til Universal Clipboard, Paste/Maccy, browser-extensions, iOS Spotlight, Windows Cloud Clipboard — uavhengig av hva vi gjør.

**VURDERTE:**
- Honor-system (skjult lekkasje uten advarsel) — bryter D-001
- Kun manuell sletting (ingen auto) — dårligere UX
- pagehide-cleanup (sletting når bruker bytter app) — ødelegger selve formålet
- (a) Auto-tømming + manuell knapp + config-toggle for "tett skip"

**VALGTE:** **(a) — Tre-delt løsning:**

1. **Auto-tømming** (default `clipboardEnabled: true`):
   - 120s deadline (D-011)
   - Absolutt epoch-tid, ikke relative timer (motvirker iOS suspendering)
   - Visibility/focus-handlers retry sletting når fanen får fokus tilbake
   - Toast bekrefter både kopiering og sletting

2. **Manuell "Slett clipboard"-knapp**:
   - I `AppHeader` (desktop) og `MobileBottomBar` (mobil)
   - Brukeren tømmer når de er ferdige (f.eks. etter Amazon-paste)
   - 100% pålitelig fordi det er direkte respons på user gesture

3. **"Tett skip"-modus** (`clipboardEnabled: false`):
   - Kopier-knapper er BORTE — passord rører aldri clipboard
   - Brukeren leser passordet på skjerm (👁️ Vis) og taster manuelt
   - 100% North Star — null lekkasje til Universal Clipboard, Paste, etc.

**HVORFOR:**
- Honest om plattform-begrensningen — ingen falsk trygghet
- Default = god UX (auto + manuell), men brukeren kan velge tett skip
- North Star (D-001) opprettholdes via informert valg

**KJENTE PLATTFORM-LEKKASJER (uavhengig av Ko|Do):**
- macOS Universal Clipboard synker til iPad/iPhone (~2 min)
- Clipboard managers (Paste, Maccy, Raycast, Alfred, CopyClip) lagrer historikk
- Andre browser-extensions med clipboard-tilgang
- iOS Spotlight / Suggested-paste (~30 min)
- Windows Cloud Clipboard
- Disse er UTENFOR vår kontroll og er kun helt unngått ved `clipboardEnabled: false`

**IMPLEMENTASJON (v2.9):**
- `default.json` → `security.clipboardEnabled: true` (default)
- `lib/config.ts` → `SecurityConfig.clipboardEnabled?: boolean`
- `lib/clipboard.ts` → `clearClipboardNow()` for manuell sletting
- `AppHeader.tsx` → ny ClipboardX-knapp (kun når enabled)
- `MobileBottomBar.tsx` → ny ClipboardX-knapp (5→6 ikoner når enabled)
- `EntryModal.tsx` → `clipboardEnabled` prop, skjuler kopier-knapper når false
- `PasswordLab.tsx` → samme prop, skjuler kopier-knapp
- `SettingsPanel.tsx` → viser "Av (tett skip)" eller "120 sek" basert på modus

**KONSEKVENS:**
- Brukeren kan fra `default.json` velge sin trade-off
- Fremtidige clipboard-bruk i v3.0 (kort-data: kortnr, CVV, PIN) vil arve samme `clipboardEnabled`-flagg
- `linkedPasswordId`-tankegang (D-015) er fortsatt UTE av scope — vi rører ikke den

---

## D-018: Multi-tenant strategi — "Manual to 25, deretter modnes"
**DATO:** 2026-02 (mandag — Mike ligger på sofaen med Max, Mac på magen)
**KONTEKST:** Hvordan håndtere flere kunder hvis Ko|Do Vault skal selges til andre? Mike har bygget editor for `default.json`, men det reiser spørsmålet: hva hvis det blir 20+ kunder?

**TRE NIVÅER AV CONFIG (presisert):**

1. **System-config** — kompilert i koden. F.eks. krypto-parametre, Upstash-key-prefiks. Brukeren skal ALDRI røre.
2. **Tenant/klient-config** — `clients/<navn>.json`. Mike (leverandør) setter opp én gang per kunde:
   - Branding, kategorier, bakgrunnsbilder
   - Sikkerhets-defaults (`clipboardEnabled`, `autoLockMinutes`, `clipboardClearSeconds`)
   - Multi-tenant separator (Upstash-key)
3. **Bruker-preferanser** — krypteres i blob eller localStorage. Brukeren endrer fra Settings.

**VALGTE FOR NÅ:** **Manuell tenant-onboarding via JSON + Vercel-prosjekt + Upstash-konto.**

**HVORFOR:**
- Estimert maks 25 kunder før dette blir trått (Mike sin vurdering)
- Per ny kunde: ~10-15 min arbeid (Vercel-prosjekt + env-vars + Upstash + kopi av JSON)
- Bygger man admin-dashboard nå, sløser man tid på en ikke-eksisterende kunde-base
- "Premature optimization is the root of all evil"

**HVA DETTE BETYR FOR DEG SOM LEVERANDØR:**
- Ny kunde → opprett Vercel-prosjekt → sett env-vars → opprett Upstash DB → kopier `default.json` → tilpass branding → push
- Hver kunde får eget Vercel-domene (`<kunde>.kodo-vault.no` eller egen URL)
- Hver kunde får egen Upstash-instans (full data-isolasjon)

**HVA BRUKEREN ALDRI SKAL GJØRE:**
- ❌ Redigere JSON-filer
- ❌ Se eller endre Upstash-keys
- ❌ Velge kategori-strukturer (du gjør det for dem)
- ❌ Eksponeres for "klient-config" i Settings — Settings er kun for bruker-preferanser

**VEIER VIDERE NÅR DETTE BLIR FOR TRÅTT (>25 KUNDER):**

### **Vei 2: Admin-dashboard** (semi-skalert, ~50-200 kunder)
- Mike får admin-app på beskyttet rute
- "Ny kunde" → skjema → backend lager Upstash-entry + sender e-post med URL
- Behold kontroll over branding/oppsett, men ingen JSON-pushing
- Estimert 1-2 dager arbeid å bygge

### **Vei 1: Self-service onboarding** (skalert, 200+ kunder)
- Kunde går til kodo-vault.com → "Opprett vault"
- Velger navn + branding-preset + språk
- Vault opprettes automatisk, ingen Mike involvert
- Estimert 3-5 dager arbeid + billing-integrasjon (Stripe)

### **Vei 3: White-label / partnerprogram** (B2B-skalert)
- Konsulent-partnere får admin-tilgang til sine egne tenant-clusters
- Mike treffer Ko|Do Consult-modellen — selger plattform, ikke direkte til sluttkunde
- Estimert flere uker — krever mature billing, support, SLA

**ARKITEKTUR-PRINSIPP (gjelder NÅ for å holde veiene åpne):**

- ✅ Vault-key er allerede multi-tenant-klar (`vault:<id>:cards`, etc.)
- ✅ Config-laster bruker `clients/<name>.json` — kan utvides til `getConfigFromRegistry(vaultId)` senere uten å bryte ts
- ✅ Ingen kode hardcoder "default"-verdier som ikke er i config
- ✅ Settings-panel skiller skarpt mellom "klient-info" (read-only) og "bruker-preferanser" (editable)

**KONSEKVENS:**
- Vi bygger ikke admin-dashboard i 2026
- Vi bygger ikke self-service onboarding i 2026
- MEN: Hver kode-endring må respektere "config kan komme fra registry"-prinsippet
- Hvis en fremtidig agent foreslår "let users edit JSON via UI" → bryter D-018, må avvises

**EKSISTERENDE VERKTØY (Mike sin verktøykasse, ikke en del av Ko|Do Vault):**
- **KoDo-Editor** — Mike sin egen UI-editor for JSON-filer. Brukes av Mike (leverandør) til å redigere `clients/<navn>.json` per kunde. ALDRI eksponert for sluttbruker. Når Vei 2 (admin-dashboard) eventuelt kommer, integreres KoDo-Editor som verktøy — vi bygger ikke JSON-editor på nytt.

**PLANLAGT MEN IKKE PRIORITERT (i backlog):**
- **Tenant-navn via Vercel env-var** (`NEXT_PUBLIC_TENANT`):
  - I dag: koden laster `clients/default.json` hardkodet
  - Etter endring: laster `clients/${process.env.NEXT_PUBLIC_TENANT ?? 'default'}.json`
  - Per kunde = eget Vercel-prosjekt + egen env-var-verdi → riktig JSON lastes automatisk
  - Null kode-endring per ny kunde
  - Estimert 30 min arbeid
  - Bør gjøres FØR vi har 5+ kunder for å unngå manuell forks-håndtering

**MIKE SIN POSISJONERING (lest fra samtalen):**
> "Det vil være ok å håndtere en del kunder med det oppsett vi har i dag — >25 stk. Det er å opprette et prosjekt i Vercel, legge inn noen variabler, sette opp Upstash og kopiere en default.json til lars-aagreen.json — ikke mer arbeid."

Dvs. **ikke et skala-problem før det blir det.** Smart.

---

## D-019: Smart Topp 10 — global, egen blob, beslutning ÅPEN
**DATO:** 2026-05-05 (mandag kveld — etter v2.9.5 pushet)
**STATUS:** **ÅPEN** — tankene fanget, valg utsatt til etter v3.x

**KONTEKST:** Etter at v2.9.5 introduserte Liste/Gruppert-toggle i `VaultDashboard`, foreslo agenten en mulig tredje modus: "Sist åpnet" (Topp 10). Mike så potensialet, men presiserte at hvis det skal bygges må det være globalt cross-device, i egen kryptert blob, og bygd skikkelig.

**VURDERTE LAGRINGS-STRATEGIER:**
- (a) Lokal RAM-only — forkastet (mister data per session, treffer ikke 90% behov)
- (b) Ukryptert localStorage — **forkastet** (bryter D-001, lekker bruksmønster til alle med fysisk tilgang)
- (c) Lokal kryptert med master-key — forkastet (ikke cross-device, kompleksitet uten proporsjonal verdi)
- (d) **Global egen kryptert blob** — VALGT som retning hvis dette bygges

**MIKES SITAT:**
> "For meg er eneste løsning D — ellers er det ikke globalt og det skal det være. Gjennom overvåking så kan man bygge en topp 10 som treffer 90% av hans behov. Dette IKKE kan ligge i eksisterende blobs — egen BLOB."

**VURDERTE SCORING-ALGORITMER:**
1. Glidende vindu (hard cutoff på N dager) — bumpy UX
2. **Eksponentiell decay** — anbefalt retning (halveringstid 14d, klassisk Reddit/HN-modell)
3. Råe events uten forfall — forkastet (uendelig vekst)

**HVORFOR BESLUTNING ER ÅPEN:**
- Vi vet ikke om brukerne faktisk savner dette ennå
- v3.0 (Cards) og v3.1 (TOTP) er mer akutte
- Bygger vi før vi vet det trengs → feil prioritering
- Mikes egne ord: *"Dette er en stor byggeprosess hvis den skal virke riktig og virke. Det er noe som vi kan sette på listen over Nice-to-Do."*

**KONSEKVENS:**
- Detaljerte tanker (alternativer, åpne spørsmål, foreløpig skisse) er fanget i `ROADMAP.md` under "vX.X — Smart Topp 10"
- Ingen kode skrives før konkret behov er bekreftet (Mike eller Lars sier "jeg savner det")
- Når det LØFTES til vX.X-prioritet: følger D-002-mønster (egen blob, samme master-passord, ulik salt, lazy-loaded)
- Halveringstid lagres i `config.smartList.halflifeDays` for multi-tenant-fleksibilitet
- Batch-strategi (debounce klikk-events) er KRITISK for å ikke spamme Upstash

**NÅR DETTE BLIR REVIDERT:**
- Mike eller Lars eksplisitt savner det
- Vault passerer ~50 oppføringer hos aktiv bruker
- Etter v3.x er stabilt og vi har båndbredde til "byggeprosess"
- Da skrives D-019 om fra ÅPEN til VALGT, eller forkastes med rasjonale


---

## D-020: Foto-fangst krever fysisk kamera (ingen file picker fallback) (v3.0)

**STATUS:** Vedtatt 2026-05-08

**KONTEKST:** I Iter 3 av v3.0 skulle vi bygge custom kamera-fangst for kort-foto (D-014). D-014 forbyr eksplisitt `<input type="file" accept="image/*">` fordi den åpner Camera Roll → bildet lagres til "Recents" → iCloud Photo Library syncer → Apple-server eier kortets bilde. Spørsmålet ble: hva gjør vi for desktop-brukere uten kamera?

**VURDERTE FALLBACK-STRATEGIER:**
- (a) **File picker fra disk** — forkastet. Selv om filen ikke kommer fra Camera Roll, åpner det døren for at brukeren kan velge en iCloud-synket fil ved en feil. Brudd på D-014.
- (b) **Drag-and-drop fra OS** — forkastet. Samme risiko som (a) — brukeren vet ikke om filen er iCloud-synket.
- (c) **"Ingen foto fra denne enheten"** — VALGT. Klart, ærlig signal. Foto er valgfritt (D-015) — kort kan registreres uten.
- (d) **QR-handoff til mobil** — utsatt til v3.5+. Brukeren scanner QR fra desktop, åpner mobil i "ta-foto-modus", bildet syncer tilbake. Elegant men ~3-4 dagers ekstra arbeid + ny krypto-channel.

**TEKNISK GJENNOMFØRING (Iter 3):**
- `getUserMedia` brukes **universelt** — fungerer på både mobil (bakkamera, `facingMode: "environment"`) og laptop (front-cam, `facingMode: "user"` + horizontal flip for naturlig speil)
- Ved load: detect kamera-tilgjengelighet via `navigator.mediaDevices.enumerateDevices()`
- Hvis ingen `videoinput` → CardModal viser informativ melding: *"Denne enheten har ikke kamera. Du kan lagre kortet uten foto, og legge til foto senere fra mobil eller laptop."*
- Hvis bruker nekter kamera-tilgang → samme melding
- Foto er aldri obligatorisk (D-015 sier `photoFront?` / `photoBack?` valgfritt)

**KONSEKVENS:**
- Iter 3 dekker ~90% av Mike/Lars sine enheter (mobil + laptop med webcam)
- Desktop tower uten webcam: bevisst ikke-støttet → bruker registrerer uten foto, eller åpner samme vault på mobil senere
- Foto kan alltid legges til senere via samme CardModal i edit-modus fra annen enhet
- D-014 forblir intakt — vi snakker ALDRI med Camera Roll
- Re-revurderes hvis Lars eller Mike rapporterer det som blocker for adopsjon

**ROADMAP-IMPLIKASJON:**
- Iter 3 (kamera-fangst): leverer på alle enheter med kamera
- Iter 4 (komprimering + lagring): integrerer foto i blob, fortsatt ikke-obligatorisk
- v3.5 (QR-handoff): vurderes hvis desktop-uten-kamera er reell smerte

**HVORDAN DENNE REVURDERES:**
- Mike/Lars sier eksplisitt "jeg klarer ikke registrere kort fordi desktop ikke har kamera"
- Eller: data viser at desktop-brukere lagrer kort uten foto i &gt;50% av tilfellene → QR-handoff løftes til v3.5
- Da skrives ny ADR (D-024+) som dokumenterer den nye løsningen

---

## D-021: Selektiv backup + registry-mønster (v3.0.5)

**KONTEKST:**
v3.0 introduserte to krypterte blobs (vault + cards) og et v2 backup-format som alltid eksporterte begge sammen. To problemer dukket opp ved bruk:

1. **Backup leste fra RAM-cache, ikke server.** Hvis vault-blobben var i sync med server var alt ok — men ved race conditions (multi-tab, andre enheter) eller hvis cards-fanen ikke var aktivert, manglet cards-blobben i backup-fila. Bruker rapporterte 3 KB backup-fil i stedet for forventet ~125 KB.
2. **All-eller-ingenting backup.** Bruker kunne ikke eksportere kun kort (f.eks. for å dele med advokat/familie) eller importere kun kort (f.eks. gjenopprette etter feilsletting uten å overskrive nye passord-endringer).

**BESLUTNING:**
- **Backup henter ALLTID fra Upstash** — ikke RAM-cache. Backup-fila er nå et kanonisk speil av server. Kostnaden er én ekstra HTTP-roundtrip per blob (~100ms total), gevinsten er null race conditions og en enkel mental modell ("backup = server").
- **Selektiv eksport** via `BackupExportModal` med checkboxer pr blob. Default: alt valgt. Tomme blobs hoppes over.
- **Selektiv import med smart re-kryptering** via `BackupImportModal`:
  1. Bruker oppgir backup-pwd. Modalen dekrypterer alle valgte blobs i RAM.
  2. Hvis backup-pwd === dagens master-pwd → re-krypter med samme pwd, push. Ingen ekstra prompt.
  3. Hvis backup-pwd ≠ dagens master-pwd OG vault er ulåst → modalen viser ekstra felt: *"Master-passordet på backup-fila er ikke det samme som dagens master-passord. Oppgi dagens master-passord — backup-data lagres med dagens passord."* Bruker oppgir dagens pwd. Vi verifiserer det, re-krypterer payloads med dagens pwd, pusher.
  4. Hvis vault er låst → target = backup-pwd, server-blobs krypteres med backup-pwd, bruker låser opp med backup-pwd.
  5. Edge: vault låst + bruker importerer kun sub-blob (kort) uten vault → avvis med beskjed om å låse opp først (vi vet ikke nåværende master-pwd).
- **Aldri raw push**: vi pusher ALLTID en ny blob med ny salt + ny IV, kryptert med target-pwd. Backup-fil-blobs røres aldri direkte. Dette gir en ren invariant: **alle server-blobs er alltid kryptert med samme master-pwd**.
- **Ingen lock ved import når vault er ulåst**: `applyImportedVaultPayload` re-deriver session med ny salt umiddelbart. Bruker forblir innlogget, biometric beholdes, ingen friksjon.
- **Atomisk validering**: master-pwd må dekryptere ALLE valgte blobs FØR noe pushes. Hvis én feiler → ingen ting pushes. Beskytter mot delvis korrupt state per D-001.
- **Backup-format v3** med `blobs`-map: `{ blobs: { vault: ..., cards: ... }, includedBlobs: [...] }`. Vilkårlig antall blobs støttes.
- **`BackupBlobSource`-registry i `lib/backup-registry.ts`** — sentral, dynamisk liste. Hver hook eksponerer `{ id, label, itemCount, fetchFromServer, validateAndDecrypt, applyImportedPayload }`. Modalene leser registret og rendrer UI dynamisk.

**KONSEKVENSER:**
- Fremtidig blob-tilskudd (v3.2 ID-er, v4.5 dokumenter, v3.1 separate TOTP-blob hvis det blir aktuelt) krever INGEN endring i backup-format eller modal-logikk — kun én ny `BackupBlobSource`-registrering.
- v2-filer migreres internt ved import (full bakoverkompatibilitet, samme prinsipp som vi avviste for v1 — der var blob-strukturen for forskjellig til å være verdt det).
- Filnavn reflekterer scope: `kodo-vault-backup-vault-{ts}.json`, `-cards-{ts}.json`, `-full-{ts}.json`.

**HVORDAN DENNE REVURDERES:**
- Hvis registry-mønsteret blir for tungt for nye blobs (utenkelig akkurat nå), refaktor til en simpler approach.
- Hvis "alltid hent fra server" oppleves som tregt på dårlige nett, vurder en hybrid (RAM-first med server-fallback). Per nå er kostnaden ubetydelig.

**ALTERNATIVER VURDERT OG FORKASTET:**
- *Implisitt selektiv import (ingen UI ved import).* Forkastet fordi det fjernet brukerens kontroll i scenario der bruker har gjort endringer på server siden backup ble tatt og kun vil restaurere én av blobsene.
- *Beholde RAM-basert export.* Forkastet fordi backup skal være «source of truth», ikke en speiling av lokal state med potensielle bugs.
- *Beholde v2-format og bare la felter være null.* Forkastet fordi det skalerer dårlig — hver ny blob ville krevd nytt fast felt i envelope-typen, og semantikken «null = slett på server» kolliderte med «null = ikke valgt».

---

## D-022: Backdrop-filter på glass-kort krever wrapper-div + ingen `isolation: isolate` (v3.0.7-patch)
**DATO:** 2026-05-18 (revidert samme dag etter dypere repro)
**KONTEKST:** Mike rapporterte at glass-morfismen virket korrekt i Chrome men var nesten 100% gjennomsiktig i Safari 17.0 — oppdaget under første kunde-installasjon. Etter første fix-runde var error-state og locked-state korrekt, men setup-state ("Opprett master-passord") fortsatt knekt. DOM-diff av WebKit-ancestor-kjeden avslørte at problemet hadde to lag.

**TO UAVHENGIGE ÅRSAKER:**

### Årsak 1 — `isolation: "isolate"` på bg-wrapper (forrige agent la til)
Forrige agent hadde lagt til `isolation: "isolate"` på `bg-wrapper`-diven i `app/page.tsx` for å løse et helt annet Safari-problem (uforutsigbar overlay-mørklegging). Kommentaren i koden hevdet at isolation "tvinger Safari til å lage en egen kompositeringskontekst slik at filter-effekten låses inn på dette nivået før backdrop-filter leser pixels". Det motsatte var sant: `isolation: isolate` skaper et eksplisitt stacking context som "låser" pikslene inne. `backdrop-filter` på elementer i søsken-stacking-contexts kan per spec ikke sample pikslene fra et isolert søsken-context — Safari/WebKit følger spec-en strengt, Chromium er permissiv.

### Årsak 2 — Direkte flex-barn av `<main>` (DOM-strukturell)
`<main>` har `flex flex-col items-center justify-center`. Når et glass-kort er **direkte flex-barn** av en flex-container som har absolutt-positionerte søsken (vårt `bg-wrapper`), kompositerer Safari/WebKit `backdrop-filter` feil — blur-effekten forsvinner selv om computed style viser `backdrop-filter: blur(24px)`. Locked-state ("Lås opp vault") fungerte tilfeldigvis fordi det allerede hadde en wrapper-div for `— For {client} —`-strip-en. Setup- og error-kortene var rene direkte flex-barn → bug.

DOM-diff Playwright/WebKit:
```
SETUP (broken):  card → <main flex>          ← direkte flex-barn
LOCKED (works):  card → <div> → <main flex>  ← har wrapper, fungerer
```

**VURDERTE FIKS-KANDIDATER:**
- (a) Legge til `-webkit-backdrop-filter` eksplisitt — forkastet (Tailwind 3.4 genererer allerede begge prefiks)
- (b) Bytte fra `bg-white/10` til mer opak fallback for Safari — forkastet (bryter glass-DNAet)
- (c) Legge til `transform: translateZ(0)` på kortene — forkastet (cargo-cult fra Safari 9-tiden)
- (d) Fjerne `flex flex-col` fra `<main>` og bruke annen layout — forkastet (rippler ut til all responsive layout, høy risiko)
- (e) **(1) Fjerne `isolation: isolate` fra bg-wrapper + (2) wrappe alle glass-kort som er direkte flex-barn av <main> i en `<div className="w-full max-w-md">`** — VALGT

**VALGTE:** **(e) — to-trinns fix:**

**Trinn 1:** `bg-wrapper`-diven har bare `filter: brightness(...)` igjen (skaper allerede et eget stacking context per CSS-spec, så isolation var både overflødig og skadelig).

**Trinn 2:** Setup- og error-kortene wrappes i `<div className="w-full max-w-md">` slik at de ikke er direkte flex-barn av `<main>`. Locked-state hadde allerede slik wrapper og forblir uendret. Inline-kommentarer på begge wrapperne advarer mot fjerning.

**VERIFIKASJON (DOM + visuelt):**
| State | WebKit FØR (begge) | WebKit ETTER (begge) | Chromium |
|---|---|---|---|
| Setup ("Opprett master-passord") | Sharp bg synlig | Sterk blur ✅ | Sterk blur (uendret) |
| Locked ("Lås opp vault") | Sterk blur (tilfeldig OK) | Sterk blur ✅ | Sterk blur (uendret) |
| Error ("Server ikke tilgjengelig") | Sharp bg synlig | Sterk blur ✅ | Sterk blur (uendret) |

Computed style etter fix: `bg-wrapper { filter: brightness(0.65); isolation: auto; }` + glass-kort har én plain `<div>` mellom seg og `<main>`.

**KONSEKVENS:**
- **⚠️ Permanente regler for fremtidige agenter:**
  1. **Aldri** legg `isolation: isolate` på `bg-wrapper` igjen, uansett hvilket Safari-symptom det "ser ut til å løse". Inline-kommentar i `page.tsx` advarer.
  2. **Aldri** rendr et glass-kort (med `backdrop-blur-*` Tailwind eller `backdrop-filter` CSS) som direkte flex-barn av `<main>`. Bruk wrapper-div, alltid. Inline-kommentarer på eksisterende wrappere advarer.
  3. Hvis et nytt scenario legges til (f.eks. ny vault-state i `useVault.ts`), gjenta wrapper-mønsteret fra setup/locked/error.
- Den opprinnelige bekymringen (overlay-mørklegging) ble allerede løst med `filter: brightness()` direkte på bakgrunnsbildet (per kommentar på linje 199-205 i page.tsx) — den løsningen står fortsatt.
- Hvis en fremtidig agent finner et reelt Safari-kompositeringsproblem, må de:
  1. Reprodusere i Playwright/WebKit FØR de foreslår fiks
  2. Sjekke DOM-ancestor-kjeden for både fungerende og knekte tilfeller — strukturforskjeller er ofte rotårsak, ikke CSS-egenskaper

**RELATERT OPPRYDDING (samme patch):**
- `.gitignore` rettet fra `/.next/` til `.next/` slik at `frontend/.next/` og `landing/.next/` ignoreres på alle dybder. 117 build-artefakter ble untracket via `git rm -r --cached frontend/.next/`.
- `.gitignore` ryddet fra 843 → 93 linjer (en tidligere agent hadde duplisert env-credential-blokken 100+ ganger via `echo -e ... >> .gitignore`-løkke). Ingen funksjonell endring, kun lesbarhet.
- `frontend/yarn.lock` lagt til (manglet i repoet) for reproducible Vercel-builds.

**HVORDAN DENNE REVURDERES:**
- Aldri for `isolation: isolate`-delen. Det er en cross-browser kompatibilitetsfelle.
- Wrapper-div-delen revurderes kun hvis Safari (≥ 18?) fikser flex-child-backdrop-filter-bugen og Mike eksplisitt ønsker DOM-opprydding. Inntil da: behold wrapper-mønsteret.


---

## D-023: Per-browser JSON-styrt glass-arkitektur (v3.1.0)
**DATO:** 2026-02
**KONTEKST:** Etter D-022 (fjernet `isolation: isolate` + wrapper-div for flex-barn) kompositerte Safari `backdrop-filter` korrekt. MEN: hvit tekst på lys glass (`bg-white/10`) var fortsatt nesten uleselig i Safari, mens nøyaktig samme CSS så perfekt ut i Chrome. Mike testet seg gjennom kombinasjoner i live samtale med agenten:
- `bg-white/10 + blur(24px)` (Chrome): ✅ perfekt
- `bg-white/10 + blur(24px)` (Safari): ❌ tekst forsvinner i bg-bildet
- `bg-white/85` (begge): ❌ hvit tekst usynlig på hvit kort
- `bg-slate-800/85 + blur(24px)` (Safari): ✅ tekst leselig, men *vi har ødelagt Chrome-estetikken*
- `bg-slate-800/85 + blur(24px)` (Chrome): kortet ser uventet mørkt/tungt ut

**ROTÅRSAK:** Safari WebKit kjører `backdrop-filter` som **enkelt-pass box-blur**. Chromium kjører **multi-pass gaussian-blur**. Matematisk gir Chromium ~3-5x sterkere blur ved samme `blur(Npx)`-verdi. Konsekvensen: lys glass (`alpha 0.10`) lar bg-pikslene skinne gjennom nesten urørt i Safari → ingen kontrast for hvit tekst, selv om computed style sier `backdrop-filter: blur(24px)`. Dette er ikke en bug — det er to forskjellige tolkninger av CSS-spec-en.

**VURDERTE STRATEGIER:**
- (a) **Universell mørk glass** for begge browsere — forkastet. Ødelegger den lette glass-DNA-en som er Mike sin signatur og som fungerer i Chrome (Mike sitt primær-miljø).
- (b) **Hardkode browser-sjekk i CSS** via `@supports` eller `-webkit-`-prefiks — forkastet. Ingen pålitelig CSS-only Safari-detect, og det fragmenterer glass-styling på tvers av komponenter.
- (c) **Per-browser JSON + CSS-variabler injisert klient-side** — VALGT. Konfigurasjonen kontrollerer presentasjonen, koden er én enkelt regel.
- (d) Lage Safari-spesifikt komponent-tre — forkastet (overengineered, kode-dupliering).

**VALGTE:** **(c) — `useIsSafari`-hook leser UA, klient-side useEffect setter CSS-variabler på `:root`, JSON-config eier verdiene.**

**ARKITEKTUR:**

```
public/clients/<tenant>.json
├── backdropBlurChrome:  "24px"                       (lett blur, multi-pass = kraftig nok)
├── backdropBlurSafari:  "48px"                       (kompenserer enkelt-pass-blur)
├── cardBgChrome:        "rgba(255,255,255,0.10)"     (lett glass, hvit tekst leselig)
├── cardBgSafari:        "rgba(30,41,59,0.90)"        (tilnærmet solid mørk slate, garantert lesbarhet)
└── bgImageOverlay:      0.10                         (samme i begge — lett mørkning av bg-bildet)
              │
              ▼
hooks/useIsSafari.ts  (UA-regex, ekskluderer Chrome/Android/Edge/Opera/Brave)
              │
              ▼
app/page.tsx (linje 205-214)
   const effectiveBlur   = isSafari ? blurSafari   : blurChrome;
   const effectiveCardBg = isSafari ? cardBgSafari : cardBgChrome;
   document.documentElement.style.setProperty("--kodo-blur-xl",   effectiveBlur);
   document.documentElement.style.setProperty("--kodo-card-bg",   effectiveCardBg);
              │
              ▼
app/globals.css — én regel som overstyrer `.backdrop-blur-xl`:
   .backdrop-blur-xl {
     backdrop-filter: blur(var(--kodo-blur-xl));
     -webkit-backdrop-filter: blur(var(--kodo-blur-xl));
     background-color: var(--kodo-card-bg);
     transform: translate3d(0,0,0.0001px);  // Safari layer-promotion (forblir fra D-022-fix)
   }
```

**HVORFOR DETTE FUNGERER:**
- Chrome ser lett glass med kraftig blur → glassmorfisme-estetikk preservert
- Safari ser tilnærmet solid mørk kort med kraftig blur → hvit tekst alltid leselig, uavhengig av bg-bilde
- INGEN komponent-kode trenger å vite om Safari — alle `.backdrop-blur-xl`-elementer arver styling fra variabel
- Multi-tenant-vennlig — Lisbeth eller fremtidige kunder kan ha helt egen glass-stil pr tenant uten kode-endring
- `.backdrop-blur-sm` (små badges/pills) påvirkes **ikke** — bevisst valg, de er allerede solid nok i begge browsere

**KONSEKVENS:**
- ✅ `useIsSafari`-hook er **permanent** — må aldri fjernes
- ✅ Nye glass-kort (modaler, paneler, fremtidige features) **må** bruke `.backdrop-blur-xl` (eller bygge på `--kodo-card-bg` direkte) — ikke hardkode `bg-white/10` eller egen blur
- ✅ Tenant-config må alltid ha begge browser-verdier definert; `FALLBACK_CONFIG` i `lib/config.ts` har trygge defaults
- ✅ Hvis fremtidig agent finner et "Safari ser annerledes ut"-symptom: sjekk først om verdiene i tenant-JSON trenger justering, IKKE legg til ny CSS-logikk
- ⚠️ Hvis Safari (≥ 19?) en dag implementerer multi-pass gaussian-blur og bytter til Chromium-paritet: vi kan flate ut konfigurasjonen, men inntil da er splittet vår garanti for lesbarhet
- ⚠️ UA-sniffing er normalt "code smell", men her er det den minst kompliserte løsningen på et reelt rendering-divergens-problem som ikke kan løses i CSS alene. Akseptert kompromiss.

**TESTET KONFIGURASJON (i prod fra v3.1.0):**
- Chrome (macOS + iOS Chrome som er WebKit): blur 24px, lett glass `rgba(255,255,255,0.10)`
- Safari (macOS + iOS Safari): blur 48px, mørk solid `rgba(30,41,59,0.90)`
- Begge: bg-image-overlay 0.10 (lett demping av bakgrunnsbilde)

**RELATERT:**
- Bygger på D-022 (DOM-strukturell wrapper-fix). D-022 er fortsatt gyldig — den løser *kompositering*, denne (D-023) løser *visuell ekvivalens*. Begge må stå.

**HVORDAN DENNE REVURDERES:**
- Safari fikser blur-paritet med Chromium → konsolider til én sett config-verdier
- Mike ønsker å bytte glass-estetikk på tvers av tenants → endre kun JSON, ikke kode
- Annen browser-divergens dukker opp (Firefox?) → utvid samme mønster (`backdropBlurFirefox` etc.)

---

---

## D-024: Biometric krever Safari 18+ / Chrome 132+ / iOS 18+ — pre-flight version-detect
**DATO:** 2026-02
**KONTEKST:** Mike testet biometric-aktivering i Safari 17.0 på macOS Sonoma. WebAuthn `navigator.credentials.create()` lyktes — Touch ID-promptet kom opp, brukeren godkjente, credentialet ble opprettet i Secure Enclave. MEN: PRF-extension ble fullstendig ignorert av Safari 17.0 (`getClientExtensionResults()` returnerte tomt object — `extKeys: []`, `prfPresent: false`). Resultat: vi kunne ikke wrappe master-passordet med en biometric-bundet nøkkel, så biometric ble ikke aktivert. Verre: et orphan-passkey ble igjen i Secure Enclave / passkey-listen.

PRF-extension kom først i:
- **Safari 18.0** (sept 2024) — iOS 18 / macOS 15 Sequoia (eller Safari 18 download for Sonoma 14.5+)
- **Chrome 132+** — desktop og Android
- **Firefox**: ingen PRF per feb 2026

**VURDERTE STRATEGIER:**
- (a) **Tilby fallback via `largeBlob`-extension** (støttet fra Safari 17+) — krypter master-pwd med lokal AES-nøkkel, lagre ciphertext i largeBlob. Forkastet: vil kreve at lokal AES-nøkkel lever et sted (localStorage eller hardkodet) — 95%-løsning som bryter D-001. Research bekreftet: *"largeBlob is for storing auxiliary data, not for secret derivation."*
- (b) **Hybrid PRF + largeBlob fallback** med tydelig advarsel — forkastet: D-001 forbyr "to nivåer av sikkerhet" der det svakere nivået presenteres som "også sikkert".
- (c) **Pre-flight version-detect: skjul Touch ID-knappen helt for ikke-støttede browsere** — VALGT. iOS 18+ er adoptert av ~92% av aktive iPhones per feb 2026.
- (d) Reaktiv flow: la brukeren prøve, og rens opp ved feil — forkastet: orphan-passkeys er irriterende og bryter Mike sin tone ("Vi bygger ikke bare noe nytt og håper det virker"). Pre-flight er ærlig.

**VALGTE:** **(c) — version-sniffing i `isPrfLikelySupported()` styrer om `biometric.supported`-flagget settes til true.**

**IMPLEMENTASJON:**

```ts
// lib/webauthn.ts
export function isPrfLikelySupported(): boolean {
  const ua = navigator.userAgent;
  // Chromium (Chrome/Edge): 132+
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  if (chromeMatch && !/OPR|Opera/.test(ua)) {
    return parseInt(chromeMatch[1], 10) >= 132;
  }
  // Safari WebKit (inkl. iOS Chrome/Firefox som er WebKit-omslag): Version/18+
  const isWebKitSafari =
    /^((?!chrome|android|crios|fxios|edg|opr|opera).)*safari/i.test(ua) ||
    /CriOS|FxiOS/i.test(ua);
  if (isWebKitSafari) {
    const versionMatch = ua.match(/Version\/(\d+)/);
    return !!versionMatch && parseInt(versionMatch[1], 10) >= 18;
  }
  return false;
}

// hooks/useVault.ts → refreshBiometric()
const supported =
  isWebAuthnSupported() &&
  isPrfLikelySupported() &&             // ← ny gate
  (await isPlatformAuthenticatorAvailable());
```

Når `supported === false`, vil `BiometricEnableCard` aldri rendres (`app/page.tsx` betingelse `vault.biometric.supported`). Brukeren ser ingen Touch ID-knapp i det hele tatt — ingen forklaring, ingen masse tekst. Når de oppgraderer OS-et, dukker knappen opp automatisk.

**HVORFOR INGEN UI-MELDING:**
Mike sitt sitat:
> *"Jeg er ikke tilhenger av å skrive en masse fordi folk ikke gidder å oppdatere."*

Brukere som er på iOS 17 og ikke har oppgradert i 17 måneder kommer ikke til å gjøre det fordi vi viser en pen melding. Vi skjuler knappen i stedet og lar dem bruke master-passord — som er like sikkert (faktisk: master-passord ER fundamentet, biometric er en UX-snarvei på toppen).

**KONSEKVENS:**
- ✅ Ingen orphan-passkeys lages noensinne — vi prøver ikke create() før vi vet PRF vil leveres
- ✅ Ingen 95%-fallback — D-001 holdt
- ✅ UI er rent for ikke-støttede browsere — ingen forvirring
- ✅ Når brukeren oppgraderer OS, dukker Touch ID-knappen opp automatisk uten kode-endring
- ⚠️ UA-sniffing er code smell — men her er det det eneste alternativ for å unngå å brenne en passkey-prompt. Akseptert.
- ⚠️ Hvis en browser fra fremtiden faktisk støtter PRF MEN UA-strengen ikke matcher våre mønstre → falsk negativ. Mitigering: legg til nye browsere i `isPrfLikelySupported()` etter behov.
- ⚠️ Edge-tilfelle: Firefox desktop får aldri biometric tilbudt fordi vi ikke kjenner deres PRF-roadmap. Kan endres når MDN bekrefter støtte.

**RELATERT:**
- D-001 (North Star) — denne ADR-en er en direkte anvendelse av 100%-prinsippet.
- D-010 (TOTP-trade-off) — samme prinsipp: hvis sikkerhetsmodellen ikke er klar, ikke tilby feature.

**HVORDAN DENNE REVURDERES:**
- Safari ≤ 17 forsvinner fra aktive iPhones (anslagsvis ~98% iOS 18+ innen sommer 2026) → ingen handling nødvendig, vi bare venter
- Firefox introduserer PRF → utvid `isPrfLikelySupported()` med Firefox-versjon
- Chrome reduserer PRF-versjon-baseline → oppdater terskel
- Apple introduserer ny browser-engine på iOS (EU DMA-tilfelle) → utvid UA-mønster

---


## D-025: Klartekst-metadata i `.kodoenc`-header (v4.0, revidert QA)
**DATO:** 2026-02 (v4.0-spec, revidert under QA-runde)
**KONTEKST:** `.kodoenc`-filformatet har en klartekst-JSON-header. Førsteutkast inkluderte `createdAt` + `appVersion` + `container-type` i klartekst. QA fanget at dette er **fingerprint-data** som ikke er nødvendig i klartekst — alle felt utenom kryptografisk hygiene-data ble flyttet inn i kryptert payload.

**HVA SOM LEKKER (klartekst i hver `.kodoenc`-fil — MINIMUM):**
- `kind: "kodo-package"` → verifiserer at det er en Ko\|Do-pakke (magic-bytes har samme funksjon, redundant men eksplisitt)
- `version: 1` → format-versjon (mottaker MÅ vite for å parse riktig)
- `kdf.algorithm: "PBKDF2-SHA256"` + `kdf.iterations: 600000` + `kdf.saltB64` → KDF-params (mottaker MÅ ha for å derive nøkkel)
- `cipher.algorithm: "AES-256-GCM"` + `cipher.ivB64` + `cipher.tagBits: 128` → cipher-params (mottaker MÅ ha for å decrypt)

**HVA SOM IKKE LEKKER (flyttet til kryptert `_metadata.json` inne i ZIP):**
- `createdAt` → tid pakken ble laget (fingerprint av Lars sin aktivitet)
- `appVersion` → klient-versjon (fingerprint av Ko\|Do-instans)
- `app: "Ko|Do · Vault"` → produkt-identifikasjon (redundant — `kind` har samme)
- `fileCount` → antall filer (telleinfo)
- `container` → format-hint (ZIP STORE-default, ikke nødvendig i klartekst)
- Filnavn / fil-størrelser / fil-typer / mottaker-info / avsender-info

**VURDERTE:**
- (a) Behold createdAt + appVersion i klartekst (førsteutkast) — forkastet etter QA. Fingerprint-data Anna kunne dele uten å vite.
- (b) Krypter hele headeren også — forkastet. Mottaker MÅ kunne lese KDF-parametre FØR dekryptering er mulig. En "krypter-headeren-også"-løsning krever en separat fast-nøkkel for header, som er meningsløst sikkerhets-teater.
- (c) **Strip alle ikke-strukturelle felt — kun KDF + cipher i klartekst, alt annet inn i kryptert _metadata.json** — VALGT
- (d) Legg til klartekst pakke-tittel i header — forkastet. Bryter D-001 — alle som ser fila uten å åpne den vet hva den heter. Lars sitt valgte filnavn på disken er nøytralt (han eier det selv); en pakke-tittel inne i header er en annen sak.

**VALGTE:** **(c) — kun strukturell metadata i klartekst, alt annet i kryptert _metadata.json.**

**HVORFOR:**
- Klartekst-header inneholder KUN det mottakers nettleser teknisk MÅ ha for å derive nøkkel + decrypt
- Web Crypto API krever iterations + salt eksplisitt før `deriveKey`; krever iv eksplisitt før `decrypt`
- Operasjonell verdi (debugging, version-tracking via `_metadata.json`) finnes fortsatt — bare inne i kryptert sone
- Ingen lekkasje av sensitive felt
- Konsistent med moderne kryptografi-praksis (age, openssl v3 enc): minimum klartekst-frame

**KONSEKVENS:**
- `.kodoenc`-fila kan inspiseres med vanlig file-viewer for å se header → ser kun magic + version + KDF + cipher
- Fremtidige format-versjoner MÅ ikke legge til pakke-tittel, mottaker, eller andre potensielt-sensitive felt i klartekst
- `_metadata.json` inne i ZIP brukes til debugging og fremtidig format-evolusjon — kan utvides uten klartekst-konsekvens
- Mottaker-UI kan vise "Laget med Ko\|Do v4.0.0, 2026-02-15" ETTER vellykket decrypt (klient-side, ikke server-data)
- Hvis en fremtidig agent foreslår å "legge til klartekst-tittel" → må avvises (refer til denne ADR)

**FILFORMAT-OPPDATERING (v4.0 final spec):**
```
KLARTEKST (header):
{
  "kind": "kodo-package",
  "version": 1,
  "kdf": { "algorithm": "PBKDF2-SHA256", "iterations": 600000, "saltB64": "..." },
  "cipher": { "algorithm": "AES-256-GCM", "ivB64": "...", "tagBits": 128 }
}

KRYPTERT (i ZIP STORE som _metadata.json):
{
  "createdAt": "2026-02-15T15:00:00Z",
  "appVersion": "v4.0.0",
  "app": "Ko|Do · Vault",
  "fileCount": 12,
  "container": "zip-store"
}
```

**HVORDAN DENNE REVURDERES:**
- Aldri for kjerne-prinsippet (minimum klartekst). Hvis brukere eksplisitt etterspør "se hvem som sendte / hva pakka heter før jeg åpner" → vurder som **valgfri** felt med klar opt-in og advarsel om hva som blir synlig.
- Hvis vi finner at `_metadata.json` skaper kompatibilitets-issues → utvid format med en flagg eller separat fil i ZIP.

---

## D-026: Browser-uavhengighet og null-server-avhengighet i v4.0 (mottaker)
**DATO:** 2026-02 (v4.0-spec)
**KONTEKST:** Anna (mottaker) skal kunne pakke ut en `.kodoenc`-fil. Hva er Anna sin avhengighet av Ko\|Do og spesifikke browsere?

**VURDERTE OPERASJONELLE SCENARIER:**
- Anna bruker Brave med strict tracking-protection
- Anna bruker Firefox 90+
- Anna bruker Safari 14+ på Mac
- Anna bruker Chrome 90+ på Mac/Windows
- Anna bruker iOS Safari på iPhone
- Anna har midlertidig ingen internett-tilgang (etter første side-lasting)
- Ko\|Do-server (Vercel-deploy) ligger nede
- Ko\|Do legges ned permanent som selskap
- Vercel-prosjektet slettes ved feil

**VALGTE:** **Anna sin pakke-utpakking skal fungere i ALLE scenarier — også når Ko\|Do-server er borte.**

**IMPLIKASJONER (sikrer dette i kode):**
1. **Null backend-kall fra `/unpack`-ruten** — kun statisk JavaScript som kjører i Annas nettleser
2. **Null analytics, tracking, telemetri** — Brave/strict modes må ikke blokkere noe
3. **Null third-party scripts** — vi laster ikke noe fra CDN-er utenfor Vercel
4. **PDF.js leveres som NPM-package** — bundles med vår JS, ikke fra cdnjs
5. **Service worker (når relevant)** — `/unpack` cacher seg selv på første lasting → fungerer offline
6. **Hvis vi noensinne legger til API-kall fra `/unpack`-ruten** → bryter D-026, MÅ avvises

**HVORDAN ANNA RECOVERER OM KO|DO ER BORTE:**
- Hun bruker en allerede-cached versjon av `/unpack` (PWA-cache)
- Eller en kollega som har Ko\|Do Vault kan eksportere koden og host /unpack et annet sted (åpen kildekode-modus)
- I worst case kan en utvikler dekryptere `.kodoenc` med åpne krypto-bibliotek (`crypto.subtle.deriveKey` + `crypto.subtle.decrypt` — standard Web Crypto API)
- Filformatet er dokumentert i SPEC og kan implementeres på nytt

**HVORFOR DETTE ER VIKTIG:**
- Pakken Anna har på disken er hennes — hun skal ikke være avhengig av at Ko\|Do som selskap eksisterer
- "Lars sender ansvaret videre" (D-003) — det ansvaret følger ikke med en plikt for Anna å fortsette å bruke Ko\|Do
- En 100% klient-side arkitektur er en grunn-eiendom v4.0 må garantere for evig

**KONSEKVENS:**
- `/unpack`-ruten implementeres som ren statisk Next.js-side
- Ingen `fetch()`-kall til `/api/*` fra `/unpack`-komponenter
- Ingen WebAuthn/Touch ID/Upstash på `/unpack`-ruten
- Fremtidige features på `/unpack` (preview, multi-file-handling) må respektere denne grensen
- Service worker for `/unpack` er en **Iter 5+ enhancement** (ikke kritisk for v4.0 launch)

**HVORDAN DENNE REVURDERES:**
- Aldri for D-026 sin kjerne (zero-server for mottaker). Hvis vi noensinne trenger server-funksjonalitet på mottakers side → det er en ny produkt-modell, ikke v4.0.
- Kan utvides med eksplisitt PWA/service-worker-strategi når brukere eksplisitt savner offline-modus


---

## D-027: `.kodoenc`-filformat (binær envelope)
**DATO:** 2026-02 (v4.0)
**KONTEKST:** v4.0 lar Lars pakke filer i en kryptert envelope som sendes til Anna over usikker kanal. Vi måtte velge et filformat som er fremtidssikkert, identifiserbart og som ikke utilsiktet lekker innhold via filnavnet eller magic-bytes-detektering.

**VURDERTE ALTERNATIVER:**
1. **Ren JSON-fil (base64-encoded ciphertext)** — Enkelt, debugbart, men ~33% større, ingen magic-bytes for trygg fil-type-deteksjon.
2. **PKCS#7 / CMS-envelope** — Industri-standard for PGP-lignende flows, men massivt overkill for single-passord-AEAD, krever ekstra bibliotek, åpner for misforståelse om hva v4.0 er.
3. **Binær envelope med klartekst-JSON-header + AES-GCM-ciphertext** ← **VALGT**

**FORMAT (.kodoenc):**
```
[4 bytes  ] Magic header: "KODO" (0x4B 0x4F 0x44 0x4F)
[1 byte   ] Format-versjon: 0x01
[3 bytes  ] Reservert (0x00 0x00 0x00) — for fremtidig flags
[4 bytes  ] Header-lengde (uint32 BE)
[N bytes  ] Klartekst-JSON-header: { kdf, salt, iv, iter, alg, packedAt, ... }
[M bytes  ] AES-256-GCM ciphertext (inkluderer 16-byte tag på slutten)
```

**HVORFOR KLARTEKST-JSON-HEADER:**
- KDF-parametre (salt, iter, alg) MÅ være tilgjengelig før dekryptering — de er per definisjon ikke hemmelige.
- AEAD-binding (D-001-prinsipp): JSON-headeren brukes som **Additional Authenticated Data** i AES-GCM. Tukling med headeren = autentiseringsfeil ved dekryptering.
- Anna kan inspisere headeren med `xxd | head` for å verifisere at fila er en gyldig Ko|Do-pakke før hun skriver passord.

**HVORFOR VERSIONS-BYTE 0x01:**
- Lar oss endre format senere (f.eks. legge til Argon2id i v5) uten å bryte v4-pakker.
- Mottaker-koden sjekker `format !== 0x01` → klar feilmelding, ingen silent corruption.

**HVORFOR IKKE INKLUDERT I HEADEREN:**
- **Pakke-navn** (f.eks. "skatte-bilag-2025") → vi vil ikke at klartekst-fil-navn skal lekke til e-post-skannere eller backup-systemer. Pakke-navnet er fil-navnet, ikke en del av envelopen.
- **Sender-identitet** → null Anna-spor, null Lars-spor i fila. Hvem sendte hva er ikke vår sak.

**KONSEKVENS:**
- `lib/package.ts` har `encodeEnvelope`/`decodeEnvelope` med eksplisitt magic-check.
- Filen er identifiserbar via `file(1)` / OS-thumbnail uten å lekke innhold.
- Fremtidige v5+ formater starter med samme `KODO`-magic men ny versjons-byte.

**HVORDAN DENNE REVURDERES:**
- Hvis vi får krav om å støtte streaming-decryption av >100 MB-filer → chunked AEAD-mode (GCM kjeder) blir aktuelt → ny versjons-byte 0x02.
- Hvis Argon2id blir tilgjengelig i Web Crypto API → ny `kdf`-verdi i headeren, samme versjons-byte holder.

---

## D-028: Uavhengige containere ved D-009-splitting
**DATO:** 2026-02 (v4.0)
**KONTEKST:** Når Lars har mange/store filer kan han velge å splitte pakka i N containere (D-009). Det åpner et grunnleggende design-spørsmål: er hver container et puslespill-bit (krever alle for å åpne noe), eller er hver container selvstendig?

**VURDERTE MODELLER:**
1. **Byte-nivå-splitting (RAID/par2-style)** — én logisk pakke deles i N like store binær-biter, alle må kombineres før dekryptering. Maksimerer "alt-eller-ingenting"-sikkerhet.
2. **Logisk fil-nivå-splitting med uavhengige containere** ← **VALGT** — hver container er en gyldig `.kodoenc` alene, samme passord, bin-packing av filer.

**HVORFOR FIL-NIVÅ-SPLITTING VANT:**
- **Use-case: "send store vedlegg over e-post"** — e-post-tjenester har 25 MB-grenser. Lars splitter en 60 MB-pakke i tre 20 MB-deler og sender dem separat. Anna åpner dem etter hvert som hun mottar dem, ser hva som er der allerede.
- **Use-case: "send forskjellige filer til samme person ad hoc"** — Anna kan åpne container 1 om mandag, container 2 om torsdag uten å vente på alle.
- **Use-case: "tap-toleranse"** — hvis container 2 av 3 forsvinner i e-post-køen, har Anna fortsatt 2/3 av filene. Byte-splitting ville gjort alle 3/3 ubrukelige.
- **Use-case: "Anna mister én fil-tilgang"** — datatap er begrenset til den ene containerens innhold.

**HVORFOR SAMME PASSORD FOR ALLE:**
- En pakke = én "leveranse" fra Lars til Anna. Ulike passord per container vil gjøre passord-deling per telefon umulig.
- Hver container har likevel egen salt + egen IV → ingen kryptografisk kobling mellom dem. Brute-force-angrep på én container hjelper ikke for de andre.

**HVORDAN BIN-PACKING:**
- `planContainers(files, N)` bruker greedy first-fit-decreasing — sorterer filer fallende, plasserer hver i den minst fulle binsen.
- Vi splitter ALDRI én fil på tvers av containere. Største enkeltfil = nedre grense for container-størrelse.
- Hvis en fil overstiger N × max-størrelse, må Lars enten øke N eller fjerne fila — vi krasjer aldri stille.

**KONSEKVENS:**
- `lib/package-zip.ts::planContainers` implementerer FFD-bin-packing.
- Hver container navngis `<pakke>-1.kodoenc`, `<pakke>-2.kodoenc`, ... (eller bare `<pakke>.kodoenc` ved N=1).
- Mottaker-flyten i `UnpackModule` håndterer én container av gangen — ingen "vent på alle"-state.

**HVORDAN DENNE REVURDERES:**
- Hvis bruker eksplisitt savner "alt-eller-ingenting"-sikkerhet for spesielt sensitive pakker, kan vi legge til et eksplisitt "binde sammen N containere"-flagg som ny versjons-byte (0x02). Default forblir uavhengige containere.

---

## D-029: File System Access API som progressive enhancement
**DATO:** 2026-02 (v4.0)
**KONTEKST:** Når Anna har dekryptert en pakke med flere filer, må hun lagre dem på disk. Browsere har inkonsistent støtte for batch-download. Vi måtte velge mellom universell men suboptimal løsning, eller dele opp i tier basert på browser-evner.

**VURDERTE ALTERNATIVER:**
1. **"Last ned hver fil enkeltvis" (gammel modell)** — Triggerer `<a download>` i en løkke. Chrome viser "Tillat flere nedlastinger?"-prompt som ikke alltid kommer, Safari blokkerer stille etter første fil. UX-katastrofe og var roten til Mike's frustrasjon i Iter 4.
2. **Kun ZIP-fallback for alle** — Universell, men tvinger Anna til et ekstra ekstraksjonssteg lokalt.
3. **Progressive enhancement: FSAccess der den finnes, ZIP overalt** ← **VALGT**

**TIER 1 — File System Access API (Chrome 86+, Edge 86+, Opera, Chromium-baserte):**
- `showDirectoryPicker({ mode: "readwrite", startIn: "downloads" })` lar Anna velge én mappe.
- Vi skriver filene direkte dit via `FileSystemFileHandle`, bevarer mappe-struktur via `getDirectoryHandle(..., { create: true })`.
- **Null prompts per fil. Null Chrome-batch-blokkering.** Bare én mappe-velger og deretter ren skriving.

**TIER 2 — Universell ZIP-fallback (Safari, Firefox, alle):**
- JSZip bygger en ZIP STORE (uten kompresjon — D-022) med alle filer og mappe-struktur.
- Én download-event → ett enkelt klikk for Anna.
- Fungerer offline, i strict-mode browsere, på iOS Safari.

**HVORFOR FEATURE-DETECTION (ikke UA-snifning):**
- `"showDirectoryPicker" in window` er én linje, **kan aldri lyve om APIet faktisk er der**.
- UA-strings kan spooses, endres uten varsel av nye Chromium-forks, og er pengeløse for å vite om Brave/Vivaldi/Arc har skrudd av APIet.
- Hvis Firefox legger til FSAccess i fremtiden → ingen kode-endring nødvendig, det bare virker.

**HVA VI EKSPLISITT FJERNET:**
- "Alle flatt til Downloads"-knappen som triggerte multi-download-loop med 500 ms-delay. Den var en blindvei: Chrome blokkerer batchen stille, prompten dukker ikke pålitelig opp, og brukeren får inntrykk av at appen er ødelagt. Det er bedre å ha to klare valg (FSAccess eller ZIP) enn tre der ett er en felle.

**KONSEKVENS:**
- `UnpackModule.tsx::handleDownloadAllToFolder` for tier 1.
- `UnpackModule.tsx::handleDownloadAllZip` for tier 2 (alltid synlig som backup).
- UIet viser FSAccess-knappen som primær når den finnes (grønn), ZIP som sekundær. På Safari/Firefox blir ZIP primær.

**HVORDAN DENNE REVURDERES:**
- Hvis Origin Private File System (OPFS) blir egnet for "stream-dekrypter store filer uten å holde alt i RAM" → vurder tier 0 før FSAccess.
- Hvis Safari noensinne får FSAccess → ingen kode-endring, automatisk tier 1 også der.

---

## D-030: Engangs-passord — Lars-valgt med Generer-knapp
**DATO:** 2026-02 (v4.0)
**KONTEKST:** Lars trenger et passord for hver pakke han sender. Pakke-passordet er IKKE hans vault-passord (D-022 master-pwd-vakt) — det er en engangs-streng han skal lese opp for Anna over telefon eller annen sikker kanal. Det er en grunnleggende UX/sikkerhets-avveining: maks-entropi vs muntlig-overførbar.

**VURDERTE ALTERNATIVER:**
1. **Auto-generert random 32-byte base64-passord** — Maksimal entropi (~190 bits), men umulig å lese opp på telefon ("liten ess, stor be, fire, slash, plus...") → Lars vil ende opp med å send det i samme e-post som fila → bryter hele tråden.
2. **Diceware-passfraser (engelsk EFF-liste)** — God entropi, leselig, men engelske ord-lister fungerer dårlig norsk muntlig over knirkete telefon.
3. **Lars taster selv, valgfri Generer-knapp som lager en lesbar konstruert streng** ← **VALGT**

**HVORFOR LARS KAN TASTE SELV:**
- Mange Lars-pakker er "Hei Anna, husk-juli-2024" — passordet er en intern-referanse de begge skjønner uten å si det høyt.
- Brukerens kontekst-kunnskap kan gi like sterk de-facto-sikkerhet som tilfeldig entropi for spesifikke threat-modeller (jamfør XKCD-936).
- Hvis Lars taster noe svakt, ser han zxcvbn-styrke-meteren rødt → naturlig nudge til Generer-knappen.

**HVORFOR GENERER-KNAPPEN BRUKER REDUSERT ALFABET:**
- Alfabet: `A-Z` (uten I, O, L for å unngå 0/1/I/L-forveksling) + `2-9` (uten 0 og 1) = 31 tegn.
- 16 tegn med dette alfabetet ≈ 79 bits entropi → mer enn nok mot offline-brute-force på AES-GCM med 600k PBKDF2-iter.
- Bindestrek hvert 2. tegn (`AK3M-7HP2-...`) gjør det leselig over telefon: "ess-kå-tre-em, bindestrek, syv-hå-pe-to..."
- Ingen lowercase = ingen "stor B vs liten b"-feil.

**HVORFOR IKKE MIXED-CASE + SYMBOLER:**
- "PgF^j!2K" gir kanskje 5 bits mer entropi, men introduserer massive UX-feller på telefon. 79 bits er ikke flaskehalsen — den er PBKDF2-iter og brute-force-kost.

**HVORFOR PASSORDET ALDRI VISES IGJEN:**
- Lars ser passordet i klartekst når han trykker Generer, men det forsvinner når han lukker modalen.
- Det er bevisst: hvis Lars vil sende det til Anna senere, må han ha skrevet det ned først (post-it, signal-melding til seg selv, Annas notatfelt).
- Vi vil ikke ha "vis passord for pakke X" som permanent UI-element. Vault-er for cards og notater er en helt annen modell enn engangs-deling.

**KONSEKVENS:**
- `PackModule.tsx::handleGeneratePassword` bruker `crypto.getRandomValues` + redusert alfabet.
- `analyzeStrength` (zxcvbn) viser score-bar live mens Lars taster.
- Bekreft-checkbox ("Jeg har lagret/notert/sendt passordet") blokkerer Krypter-knappen til Lars eksplisitt har bekreftet han har en plan.
- Ingen "se passordet igjen senere"-UI noe sted.

**HVORDAN DENNE REVURDERES:**
- Hvis brukere konsistent rapporterer at de mister passord før de får sendt dem til Anna → vurder en lokal "ikke-sendt passord-buffer" i vault (men det åpner en angreps-flate som vi har valgt å unngå).
- Hvis et integrert "send passord via Signal/SMS automatisk"-flyt blir aktuelt → det er en helt ny D-nummer, ikke en revisjon av D-030.


---

## D-031: B-modellen — feature-color-koding på tvers av hele appen
**DATO:** 2026-02 (post-v4.0 fargerefaktor)
**KONTEKST:** Da Pakker-featuren ble bygget i v4.0 ble det innført en grønn aksent (emerald) for å skille den visuelt fra resten av appen. Det viste seg å eksponere en eldre inkonsistens: bankkort brukte 5 forskjellige farger (blue, emerald, violet, amber, rose) mens passord brukte 2 (blue, rose). Mike og agenten gikk gjennom et farge-kart og besluttet en strategi: én farge per feature-rolle, gjennomført på tvers av hele appen.

**VURDERTE ALTERNATIVER:**
1. **Én universell aksent (A-modellen)** — alt bruker samme aksent (f.eks. blue). Renest, men mister mulighet til å markere modus visuelt.
2. **Per-feature-koding (B-modellen)** ← **VALGT** — hver feature har sin egen aksent, men reglene er strenge.
3. **Per-modul-koding (C-modellen)** — bankkort, passord, notater, pakker har hver sin farge. Avvist fordi det blir for mange "farge-domener" — to ulike entry-typer i passord og kort skal ikke ha to ulike "lagre"-farger.

**B-MODELLEN — KART:**

| Rolle | Farge | Brukes til |
|---|---|---|
| **Primær** | `blue` (Tailwind 500/600) | Lagre, Edit, OK, Lås, Neste — overalt i appen |
| **Pakker** | `emerald` (Tailwind 500/600) | Hele Pakker-featuren: PackModule, UnpackModule, PackageHubModal, PackageEntryButton, PackagePreview, header-knapp |
| **Lab** | `violet` (Tailwind 500/600) | Hele PasswordLab-modulen + header-knappens hover-state |
| **Warning** | `amber` (Tailwind 400/500) | Clipboard-clear-knapp, "spesielle egenskaper"-toggles, "ikke trekkes tilbake"-bannere |
| **Slett / Feil** | `rose` (Tailwind 500/600) | Slett-knapper, feilmeldinger, brudd-varsler, mismatch-feedback |

**SPESIELLE UNNTAK SOM ER LOV:**
- **Suksess-tilbakemelding (✓-ikoner)** kan være `emerald-300` selv i ikke-Pakker-flows (f.eks. "kopiert til clipboard" i PasswordLab). Dette er universell semantikk og overstyrer feature-aksenten.
- **Kort-type-farger i bankkort** (hex-kodede `credit: #a78bfa`, `reward: #fbbf24` osv.) er datavisualisering og IKKE underlagt B-modellen. Mike velger fritt.
- **Kategori-farger i passord-vault** (hex-kodede `personal: #4ade80`, `bank: #f59e0b` osv.) er også datavisualisering — fri.

**SENTRAL TEMA-FIL:**
- `/app/frontend/lib/feature-theme.ts` definerer `PACKAGES_THEME`, `LAB_THEME`, `PRIMARY_THEME` som strukturerte token-objekter.
- For å bytte Pakker-fargen senere: endre `PACKAGES_THEME` + søk-erstatt `emerald-` → `<ny-farge>-` i de 5 pakke-komponentene (instruks i topp-kommentar i PackModule.tsx + dokumentert i PRD.md).

**HEADER-KNAPPENE:**
Alle 6 header-knapper har nå hover-farge per B-modellen:
- 🟪 Lab → violet hover (matcher modal)
- 🟦 Oppdater → blue hover
- 🟧 Clipboard-clear → amber hover (warning-rolle)
- 🟩 Pakker → emerald hover (matcher feature)
- 🟦 Innstillinger → blue hover
- 🟦 Lås → blue hover

Tidligere var bare clipboard og pakker markert med farge; resten ble usynlige på hover.

**VERIFIKASJON:**
- `/colors`-ruta i appen viser interaktiv palett-utforsker + konsistens-rapport per modul
- All emerald i bankkort, alle violet i bankkort byttet til blue (B-modellen)
- Lab er konsistent violet (1 unntak = universell suksess-ikon, lov per B-spec)

**HVORDAN REVURDERES:**
- Hvis vi legger til en ny feature med eget UI-domene (f.eks. "Delte vault-rom"): velg en ny Tailwind-farge som ikke er i bruk (teal, cyan, indigo, fuchsia) og opprett `<FEATURE>_THEME` i feature-theme.ts.
- Hvis kategori-fargene i passord/kort senere skal harmoniseres med B-modellen → må diskuteres separat, det er datavisualisering, ikke UI-aksent.
- Hvis en bruker rapporterer at violet og blue er for like (begge er kalde) → kandidat for å bytte Lab til indigo eller fuchsia.


---

## D-032: Språkdrakt — scope og begrensninger for v4.3
**DATO:** 2026-02 (besluttet)
**STATUS:** Planlagt for v4.3 (etter v4.1 ID-blob + v4.2 2FA TOTP)

> **⚠️ REVIDERT 2026-05-26:** Teknisk stack og tidspunkt er endret.
> Se [D-036](#d-036--i18n-arkitektur-egen-lett-løsning-flagg-i-header-ingen-url-routing) for gjeldende i18n-arkitektur-beslutning.
>
> Resten av D-032 (scope, språkvalg, begrensninger) er fortsatt gyldig.
>
> Spesifikt er følgende punkter i D-032 **overstyrt av D-036** og skal IKKE følges:
> - `next-intl` som teknisk stack → erstattet av egen lett løsning
> - ICU MessageFormat → ikke i bruk
> - URL-routing (`/no/`, `/sv/`) → eksplisitt forkastet i D-036
> - "Mellom v4.2 og v4.5" som timing → v4.2 er nå selve språkdrakt-versjonen
>
> Alt annet i D-032 (hvilke språk, scope-sperrer, oversettelsesprosess, Lars-persona forblir norsk, `Intl.DateTimeFormat`) gjelder fortsatt.

**KONTEKST:** Ko|Do er per i dag norsk-eksklusiv. For å åpne EU- og globalt marked må appen støtte flere språk. Mike og agenten diskuterte timing (før vs etter v4.5) og scope (4 språk vs 7 språk).

**VURDERTE ALTERNATIVER:**
1. **i18n før v4.1** — for tidlig, hurtig-laget endrer seg fortsatt → omarbeid
2. **i18n etter v4.5** — dyrt fordi dokument-laget også må oversettes (dobbelt så mange strenger)
3. **i18n mellom v4.2 og v4.5** ← **VALGT** — hurtig-laget er stabilt og komplett, dokument-laget skrives med i18n fra første dag

**TIMING — HVORFOR MELLOM v4.2 OG v4.5:**
- v4.0 (sikker overlevering) ✅ — i18n var ikke kritisk
- v4.1 (ID-blob) introduserer få nye strenger (gjenbruker mye fra cards-modulen)
- v4.2 (2FA TOTP) introduserer få nye strenger (live-kode, QR-scan, seed-input)
- Mellom v4.2 og v4.5 er **all UI-strenger i hurtig-laget stabile** → optimal tidspunkt for first-pass-oversettelse
- v4.5 (dokument-laget) bygges med next-intl-mønster fra første commit → ingen retrofit

**SPRÅK-VALG — FØRSTE LANSERING:**
| Språk | Kode | Hvorfor |
|---|---|---|
| 🇳🇴 Norsk | `no` | Referanse-implementasjon, alle nye strenger skrives først her |
| 🇸🇪 Svensk | `sv` | ~80% delt vokabular med norsk → lavt vedlikehold |
| 🇩🇰 Dansk | `da` | Samme — Norden-strategi |
| 🇬🇧 Engelsk | `en` | Global reserve + åpner EU-markedet utenfor Norden |

**UTSATT TIL v4.3.1+** (egen versjons-bump per språk-utvidelse):
- 🇩🇪 Tysk (`de`) — EU-markedets største, Schrems II-fortelling selger spesielt her
- 🇫🇷 Fransk (`fr`)
- 🇪🇸 Spansk (`es`)

**SCOPE-SPERRER (ikke-forhandelbare i v4.3):**

1. **Kun UI-strenger oversettes.** Bruker-data (passord-navn, kort-titler, notater) forblir på det språket Lars selv har skrevet dem. Vi oversetter aldri kundens innhold.

2. **Maks 4 språk i v4.3.0.** NO + SV + DA + EN. Flere språk = egen patch-release med egen ADR-revisjon (D-032.1, D-032.2...).

3. **Norsk er referanse-implementasjon.** Alle nye strenger som introduseres etter v4.3 skrives først på norsk, deretter oversettes til de andre 3. Norsk-strengen er "sannheten".

4. **Maskin-oversettelse + spot-check fra native, ikke profesjonell.** Vi betaler IKKE for profesjonell oversettelse i v4.3. DeepL/GPT for første pass, så native-speaker sjekk av Mike's nettverk eller LinkedIn-følgere som tilbyr seg. Kvalitet før betaling — hvis brukere klager på spesifikke fraser, fikser vi punktvis.

5. **Lars som persona forblir norsk.** Persona-navnet "Lars" oversettes IKKE til Larry/Lukas/Luís per locale. Det er Ko|Do sitt brand-tegn, ikke et språk-element. (Reference-implementasjonen kjenner uansett brukeren som bare "du" i UI.)

6. **Dato/tall/valuta-formatering følger locale.** 14. mars 2026 (no) vs March 14, 2026 (en) vs 14 mars 2026 (sv). Bruker `Intl.DateTimeFormat` + `Intl.NumberFormat` — null tredjeparts-bibliotek for dette.

7. **Locale-deteksjon i denne rekkefølgen:**
   a. Brukerens lagrede valg (localStorage `kodo-locale`)
   b. Tenant-default fra `default.json` → `defaultLocale`
   c. Browser `Accept-Language`
   d. Fallback: norsk

8. **URL-routing:** `kodovault.no/no/...`, `kodovault.no/en/...` osv. (Norsk uten prefix er en åpen avgjørelse — vurderes ved implementasjon.)

**TEKNISK STACK:**
- `next-intl` — App Router-vennlig, ICU MessageFormat, type-safe nøkler via TypeScript
- Strenger i `/app/frontend/messages/<locale>.json`
- Hver komponent bruker `useTranslations("namespace")` for å hente sine strenger
- Locale-velger i `ProfileSettingsModal` med 4 valg + flagg-emoji
- Tenant `default.json` får `"defaultLocale": "no" | "sv" | "da" | "en"`

**ESTIMERT ARBEID:**
- Setup next-intl + routing: 0.5 dag
- Ekstrahere ~600 norske strenger til `no.json`: 1-2 dager
- Maskin-oversette + polere `en.json`: 1 dag
- Maskin-oversette + polere `sv.json` + `da.json`: 0.5 dag (lavere kostnad pga språk-nærhet)
- Dato/tall/valuta-formatering per locale: 0.5 dag
- Locale-velger i UI: 0.5 dag
- Layout-test i alle modaler for tekstoverflow (særlig tysk når det kommer): 1 dag
- **Totalt: 5-6 dager fokusert jobb**

**HVORDAN DENNE REVURDERES:**
- Hvis Mike får tysktalende kunde-forespørsler før v4.3 → tysk legges til som 5. språk i førsteversjon
- Hvis maskin-oversettelse gir for dårlig kvalitet på nyanserte sikkerhets-fraser ("master-passord", "engangs-passord") → profesjonell oversetter for nøkkel-fraser, maskin for resten
- Hvis URL-routing skaper SEO-problemer for kodovault.no landing → re-vurder før prod

**HVA SOM IKKE ER I D-032:**
- Høyre-til-venstre-språk (arabisk, hebraisk) — egen ADR ved aktuelt behov
- Live oversettelse av bruker-data (Lars sine notater) — eksplisitt utelatt
- Multi-region datasenter — uavhengig av i18n, separat diskusjon


---

## D-033: ID-modul som egen Upstash-blob (v4.1)

**Datert:** 2026-02 (v4.1.0 release)

**Kontekst:** Spec v4.1 introduserer en fjerde dataklasse — ID-er (Pass, Førerkort, ID-kort, Helse/forsikring). Spørsmålet var hvordan vi lagrer disse i forhold til de eksisterende blobs (`vault:default` for passord, `vault:default:cards` for kort).

**Tre alternativer vurdert:**

| Modell | Beskrivelse | Vurdering |
|---|---|---|
| A. Slå sammen med kort | Utvid `vault:default:cards` til "things you carry in your wallet" | ❌ Forvirrende. Bankkort og pass har lite til felles datamessig |
| B. Separat blob med eget passord | `vault:default:ids` med uavhengig master-pwd | ❌ For mye friksjon for Lars — to passord å huske |
| **C. Separat blob med SAMME master-pwd** | `vault:default:ids`, kryptert med samme master-pwd som hovedvault MEN egen salt | ✅ **VALGT** |

**Beslutning:** Egen Upstash-key `vault:default:ids`, kryptert med samme master-pwd som hovedvault, men med **egen salt** (D-002-prinsipp ført videre). Lazy-loaded — fetches først når brukeren åpner 🆔-fanen ELLER Cmd+K-paletten.

**Rasjonalet:**

1. **Brukervennlig:** Lars trenger fortsatt bare å huske ett master-passord. Auto-lås gjelder alle blobs samtidig.

2. **Sikker isolasjon:** Egen salt + IV per blob betyr at hvis én blob lekkes (f.eks. backup av kun cards), kan den ikke brukes til rainbow-table-angrep på de andre.

3. **Skalerbart blob-design:** Lazy-load betyr at brukere som aldri åpner ID-fanen ikke betaler Upstash-kostnaden. Konsistent med hvordan cards-blob ble lagt til i v3.0.

4. **Cross-feature søk via Cmd+K:** Når brukeren trykker Cmd+K, trigges ALLE idle-blobs til å laste i bakgrunn (parallelt). Søk-resultater oppdateres reaktivt. Dette fikser også en pre-eksisterende v3.0-bug der cards ikke var søkbar før Kort-fanen var åpnet.

**Datamodell:**

```typescript
type VaultId = PassId | DriverId | IdCardId | HealthId;  // discriminated union på `kind`

interface IdBase {
  id: string;
  title: string;
  attachments?: IdAttachment[];  // 0-3 entries — Mike-utvidelse 2026-02
  notes?: string;
  favorite?: boolean;
  createdAt: string;
  updatedAt: string;
}
```

**Hvorfor `attachments[]` og ikke type-spesifikt:**
Første implementasjon hadde singular `attachment?` — Mike fanget at førerkort trenger forside + bakside og at ulike ID-typer kan ha variable behov. I stedet for å hardkode `attachmentBack?` per type, generaliserte vi til 0-3 entries med brukervalgt antall. Mer fleksibelt, færre type-spesifikke special cases.

Hard maks: 3 vedlegg × 1 MB = 3 MB per ID. Total blob-target: ~25 MB (godt innenfor Upstash 100 MB record-grense).

**Migrering:**
Eksisterende ID-er med singular `attachment` (fra tidlige v4.1-iterasjoner under utvikling) konverteres transparent ved decrypt i `useIds.activate()`:

```typescript
function migrateLegacyAttachments(ids: VaultId[]): VaultId[] {
  return ids.map((id) => {
    const legacy = id.attachment;
    if (legacy && !id.attachments) {
      return { ...rest, attachments: [legacy] };
    }
    return id;
  });
}
```

Etter første save er legacy-feltet fjernet permanent.

**Trade-offs som ble akseptert:**

- Lazy-fetch ved Cmd+K betyr at første søk etter unlock kan ha 200–500 ms forsinkelse på ID-resultater. Akseptabelt UX-trade-off mot eager-fetch (som ville betalt Upstash-kostnaden også for brukere som aldri søker).

- Hvis ID-blob har avvikende master-pwd (edge case ved import av delvis backup), settes status til `"locked"` med tydelig melding. Bruker må håndtere manuelt via support — sjelden scenario.

**Konsekvens for D-002 (lazy-load):**
D-002 sa "lazy-load på fane-åpning". Vi utvidet til "lazy-load på fane ELLER Cmd+K". Cards-modulen får samme utvidelse retroaktivt i v4.1.

---

## D-034: Vannmerke-eksport av ID-bilder — klient-side canvas (v4.1)

**Datert:** 2026-02 (v4.1.0 release)

**Kontekst:** Brukere skal kunne laste ned kopi av ID-bilder med synlig "KOPI"-stempel, slik at fotokopier ikke kan misforstås som original. Spec §6.4.

**Spørsmål:** Hvordan rendrer vi vannmerke, og hva med PDF-vedlegg?

**Beslutning:**

1. **Klient-side canvas-rendering.** Bildet lastes inn i en `HTMLImageElement` → kopieres til `<canvas>` i native dimensjoner → vannmerke-bånd tegnes nederst → `toBlob()` → ObjectURL → programmatisk `<a>.click()` for nedlasting. **Ingen server-runde, ingen klartekst på nett.**

2. **Klassisk Word-stil diagonal (Mike-revisjon 2026-02-26).** Første implementasjon brukte et rødt stempel-bånd over hele bredden nederst (C2-stil). Etter Vercel-test fant Mike at det var "harry" — for vulgært/skrikende. Revidert til **A-stil**: stor "KOPI" diagonalt midt på bildet, -30° rotert (Word-default), dato (`YYYY-MM-DD`) under, semi-transparent hvit fyll @ 42% opasitet med tynn mørk stroke for kontrast over både lyse og mørke bildepartier. Letter-spacing-simulering via tracking i tekst-strengen siden canvas mangler tracking-property. Profesjonelt, gjenkjennelig som "ekte" vannmerke, ikke i veien for selve ID-en.

3. **PDF-vedlegg eksporteres IKKE i v4.1.** Brukeren får disabled-knapp med tooltip "PDF kan ikke eksporteres med vannmerke i v4.1". Implementering ville krevd `pdf.js`-bundle (~2 MB) for én feature. Bevisst D3-trade-off — utsettes til v4.2+ hvis behov oppstår. Brukeren kan fortsatt laste ned original-PDF via browser-iframe i AttachmentViewer.

4. **JPEG output med 92% kvalitet.** Ikke PNG — JPEG er mindre filstørrelse for fotografisk innhold og er det standarden brukere forventer for "last ned bilde".

5. **Filnavn sanitiseres:** `<id-tittel>-kopi-YYYY-MM-DD.jpg`. Norske tegn (å/æ/ø) konverteres til ASCII for maks-kompatibilitet på alle filsystemer. Tom tittel → fallback til ID-type.

**Vannmerke parametre (A-stil):**
- Font-størrelse hoved: 15% av kortere side (clampet 60–180 px)
- Font-størrelse dato: 28% av hovedstørrelse
- Rotasjon: -30° (-Math.PI / 6) — Word-default, mer subtilt enn -45°
- Fyll-opasitet: 0.42 (hvit)
- Stroke: rgba(0, 0, 0, 0.32), bredde ~2.5% av font-størrelsen
- Letter-spacing: simulert via `KOPI`.split('').join(' ') → "K O P I"

**Hvorfor ikke biblioteker:**
- `html2canvas` / `dom-to-image`: Disse rendrer DOM, ikke det vi trenger. Vi har et rent bilde + tekst-overlay.
- `pdf-lib` / `pdf.js` for PDF: For tung for én feature. Utsatt.

**Sikkerhetsimplikasjoner:**
- Alt skjer i bruker-sin browser. Server ser aldri klartekst-bildet eller vannmerke-versjonen.
- ObjectURL revokes etter 200 ms timeout for å frigjøre minne (uten å avbryte browseren's download-trigger).
- Hvis brukeren legger ut kopien offentlig, er det MED det røde "KOPI"-stempelet — ingen forveksling med original.


---

## D-035 — REVIDERT: Subdomene som identifikator (erstatter tidligere versjon)
Subdomenet ER identifikatoren. terje.kodovault.no er Terjes vault. Ingen e-post i auth-flyten. Master-passord + Touch ID fungerer på alle enheter. Enheter uten biometrics bruker master-passord direkte. Wildcard DNS *.kodovault.no peker til Vercel (216.150.1.1 = VERCEL-09) og er bevist i prod 2026-05-28 — CNAME-records for Lisbeth og Terje slettet, wildcard håndterer alt automatisk. Ingen DNS-jobb per ny kunde. Nameservere forblir hos webhuset.no. Vercel API provisjonerer nye subdomener automatisk ved registrering.

---

## D-036 — i18n-arkitektur: egen lett løsning, flagg i header, ingen URL-routing
**DATO:** 2026-05-26
**STATUS:** Besluttet

**KONTEKST:**
v4.2 krever støtte for NO/SV/DA. To alternativer ble vurdert: `next-intl` (mest brukt i Next.js App Router) og egen lett løsning med `t()`-funksjon + JSON-ordbøker. Ko\|Do har 4 språk, ett UI-lag og ingen kompleks pluralisering eller datoformatering som krever ICU MessageFormat.

**BESLUTNING:**
Egen lett i18n-løsning. Ingen eksterne dependencies. `t(key, locale)` slår opp i JSON-ordbøker per språk. Locale lagres i `localStorage` med `navigator.language` som auto-detect fallback. Språkvalg via tre flagg i `AppHeader` (🇳🇴 🇸🇪 🇩🇰) — klikk bytter umiddelbart uten reload. Ingen URL-routing (`/no/`, `/sv/`) da appen lever bak innlogging og ikke skal indekseres av søkemotorer.

**FIL-STRUKTUR (ISO 639-1 språkkoder, IKKE landkoder):**

```
/app/frontend/lib/locales/
├── no.json    ← Norsk (bokmål)        — IKKE nb.json
├── sv.json    ← Svensk                 — IKKE se.json (se = land Sverige)
└── da.json    ← Dansk                  — IKKE dk.json (dk = land Danmark)
```

- Tre separate JSON-filer (ikke ett stort objekt med språk som top-nivå-nøkkel) — gir ren oversetter-flyt, lav git-merge-konflikt, og mulighet for lazy-loading senere
- Flat nøkkel-struktur (`"auth.unlock_title": "Lås opp vault"`) — ikke nested objekter. Enklere å diff'e og ekstrahere
- Fallback-kjede i `t()`: `dict[locale][key] ?? dict.no[key] ?? key` — norsk er kanonisk fallback, deretter nøkkelen selv som siste utvei

**KONSEKVENSER:**

**KONSEKVENSER:**
- Null bundle-økning, null ny dependency
- Locale-endring er klient-side og umiddelbar
- Norsk er referansespråk — `sv.json` og `da.json` oversettes via Claude med native speaker review
- Fremtidig URL-routing kan legges på toppen uten å rive ned denne løsningen

**FORKASTEDE ALTERNATIVER:**
- `next-intl` — overkill for 3 språk uten kompleks formatering
- URL-routing (`/no/`, `/sv/`) — ikke relevant for app bak innlogging
- Finsk — ikke skandinavisk, eget språktre, ikke i scope
- `se.json` / `dk.json` — landkoder, ikke språkkoder. ISO 639-1 (`sv`/`da`) er web-standarden og matcher `navigator.language`
- Ett stort `messages.json` med språk som top-nivå-nøkkel — vanskeligere oversetter-flyt
- Nested nøkkel-struktur (`auth: { unlock: { title } }`) — mer kode for traversering, vanskeligere å diff'e

---

## D-037 — Onboarding-flyt og prismodell (NY)
**Registrering:**
1. E-post (ikke verifisert — verifisering er friksjon uten verdi)
2. Velg subdomene
3. Sett master-passord
4. 30 dager gratis starter — ingen kort kreves

**Trial-flyt:**
Dag 25: e-post "5 dager igjen" + betalingslink (månedlig eller årlig)
Dag 30: vault låses — betalingsvegg

**Manglende betaling etter dag 30:**
Dag 37: purring med betalingslink
Dag 44: vault lukkes
Dag 44: e-post "vault stengt — betal eller vi sletter"
Dag 51: e-post "sletter om 7 dager"
Dag 58: subdomene + Upstash vault-data + Vercel-prosjekt slettes
Prismodell:

Månedlig: 129 kr/mnd
Årlig: 1 238 kr/år (20% rabatt — spar 310 kr)
Betalingslink tilbyr begge alternativer ved konvertering

---

## D-038 — B2B lisensmodell og faktura (revidert 2026-06-02)
**To admin-nivåer:**

Mike: admin.kodovault.no — full platform-kontroll, ubegrenset
Bedriftsadmin: am-admin.kodovault.no — styrer egne lisenser innenfor kjøpt antall

**REVIDERT 2026-06-02 — `*-admin`-suffiks tillates for B2B:**

Opprinnelig blokkerte `isReservedSubdomain()` ALLE subdomener som ender på `-admin` (B2C selvbetjent registrering kan ikke ta dem). Det er fortsatt riktig for B2C, men admin må kunne opprette B2B-bedrifts-admin-tenants som `<prefix>-admin` (f.eks. `am-admin` for "Advokatfirma AM" med tenantPrefix `am` → ansatte får `am-nils`, `am-kim`, `am-lars`).

**Implementering (Iter 7.5):**
- `isReservedSubdomain(sub, { allowAdminSuffix?: boolean })` — andre parameter
- `isSubdomainAvailable(sub, { allowAdminSuffix?: boolean })` propagerer flagget
- `POST /api/admin/tenants` setter `allowAdminSuffix = (customerType === "b2b")` — automatisk basert på kundetype
- `GET /api/admin/subdomain-check?customerType=b2b` — frontend create-modal sender query når B2B-modus aktivt
- `POST /api/register` (B2C selvbetjent) sender IKKE flagget → `*-admin` fortsatt blokkert
- `GET /api/register/subdomain-check` (public) sender IKKE flagget → `*-admin` fortsatt blokkert

**Hva som FORTSATT blokkeres uavhengig:**
- Eksakt `admin` (i `RESERVED_SUBDOMAINS`-listen)
- Eksakt `api`, `www`, `kodo`, osv. (eksakt-match alltid reservert)

**B2B PREFIKS-BESKYTTELSE (2026-06-02):**

Når B2B-tenant opprettes med `tenantPrefix: "am"` legges "am" til en sentral Upstash SET `platform:reserved-prefixes`. Da blokkeres `am-*` for selvbetjent B2C-registrering, mens bedrifts-admin kan opprette ansatt-vaults `am-nils`, `am-kim`, osv.

**Eksempel:**
```
Bedriften: Advokatfirma AM
  adminSubdomain: am-admin.kodovault.no  ← bedrifts-admin-vault
  tenantPrefix:   "am"                    ← legges i platform:reserved-prefixes

Ansatte (opprettes av bedrifts-admin eller Mike — Iter 20):
  am-nils.kodovault.no    ✓
  am-kim.kodovault.no     ✓
  am-lars.kodovault.no    ✓

B2C-bruker prøver å registrere:
  am-foo     ✗ blokkert (starter med "am-")
  amanda     ✓ tillatt (starter IKKE med "am-")
  am         ✓/✗ avhenger av RESERVED_SUBDOMAINS-eksakt-match
```

**API-overflate i `lib/platform/subdomain.ts`:**
- `getReservedPrefixes(): Promise<string[]>` — leser SET fra Upstash, fail-open ved feil
- `addReservedPrefix(prefix)` — SADD ved B2B-opprettelse (idempotent)
- `removeReservedPrefix(prefix)` — SREM ved B2B-sletting (idempotent)
- `startsWithReservedPrefix(sub, prefixes[])` — pure helper (testet i isolasjon)
- `isSubdomainAvailable(sub, { allowAdminSuffix?, allowReservedPrefix? })` — `allowReservedPrefix: true` lar bedrifts-admin opprette `<prefix>-<ansatt>` (Iter 20)

**Wire-points:**
- `POST /api/admin/tenants` kaller `addReservedPrefix(record.tenantPrefix)` etter vellykket B2B-opprettelse
- `DELETE /api/admin/tenants/[subdomain]`:
  1. Verifiserer `activeLicenses === 0` før sletting → 409 hvis ikke
  2. Sletter tenant
  3. Kaller `removeReservedPrefix(tenantPrefix)` for å frigjøre `am-*`
- Iter 20 (B2B-modul): når bedrifts-admin oppretter ansatt-vault, sender `allowReservedPrefix: true` slik at `am-nils` aksepteres

**Fail-open prinsipp:** Hvis Upstash er nede når `getReservedPrefixes()` kalles, returneres tom liste — registrering tillates heller enn å DOS-e oss selv (samme prinsipp som rate-limit, D-048).

**Lisensvalidering:**
Ved opprettelse av bruker:
→ Sjekk active < maxLicenses → OK
→ Sjekk Stripe subscription status = active → OK
→ Hvis ikke betalt → blokkert

**Ved innlogging:**
→ Sjekk Stripe subscription status
→ Hvis kansellert/utløpt → betalingsvegg

**Lisensendring opp:**
→ Trer i kraft umiddelbart
→ Stripe fakturerer pro-rata

**Lisensendring ned:**
→ Registreres umiddelbart i DB
→ Trer i kraft ved neste fakturaperiode
→ Eksisterende brukere berøres ikke før da

**Faktura B2B:**

Stripe Invoicing — PDF-faktura med betalingslink sendes til bedriftens e-post
Alle lisenser som linjeposter
Betalingsfrist 14 dager standard
Purring dag 7, stengning dag 14
Betalingslink i purring tilbyr kortbetaling som alternativ
Stripe webhook invoice.paid bekrefter betaling automatisk
Månedlig og årlig faktura — begge alternativer tilgjengelig
20% årsrabatt gjelder også bedriftskunder
Kostnad: ~3,3% + 2 kr per transaksjon (Stripe fees + Invoicing 0,4%)

**Manglende betaling B2B — samme flyt som B2C:**
Faktura forfaller dag 0
→ Purring dag 7 med kortbetalingsalternativ
→ Vault lukkes dag 14
→ E-post dag 14: "vault stengt — betal eller vi sletter"
→ E-post dag 21: "sletter om 7 dager"
→ Dag 28: subdomene + Upstash vault-data + Vercel-prosjekt slettes

## D-039 — Sentral platform-database (NY)
Egen Upstash-instans for platform-metadata. Kryptert med AES-256-GCM på samme måte som øvrige Upstash-blobs. Mike sitt master-passord er nøkkelen. Zero-knowledge prinsippet gjelder — Upstash ser kun kryptert data.

**Innhold:**
Registrerte subdomener
Subdomene → e-post → Stripe customer ID
Lisensteller per bedriftskunde: { tenant: "am", maxLicenses: 15, active: 3 }
Status (trial / aktiv / kansellert)
Opprettelsesdato (for trial og slettingslogikk)

**Oppbevaringsmodell:**
DataOppbevaringSubdomene + Upstash vault-data + Vercel-prosjektSlettes dag 28/52 etter stengningAdmin-DB metadata (sentral Upstash)2 årStripe transaksjonshistorikk7 år (lovpålagt)

---

## D-040 — DNS-arkitektur bekreftet (NY)
*.kodovault.no A-record peker til Vercel (216.150.1.1 = VERCEL-09, bekreftet via IP Whois). Bevist i prod 2026-05-28 — Lisbeth og Terje CNAME slettet, wildcard håndterer alt automatisk. Ingen DNS-jobb per ny kunde. Nameservere forblir hos webhuset.no. Ved v4.4+v4.5 auto-deployment: Vercel API knytter nytt subdomene til prosjekt — DNS er allerede klar.

---

## D-041 — Reserverte subdomener: sannhetskilde i JSON-fil (NY · 2026-06-01)

**KONTEKST:** v4.3 Iter 2 legger til validering av reserverte subdomener (`admin`, `api`, `www`, `*-admin`, osv.) på både POST `/api/admin/tenants` og det public `/api/register/subdomain-check`-endepunktet. Listen må kunne oppdateres uten kode-deploy-syklus, og må deles av admin- og public-flow uten duplisering.

**VALG:**
- (A) Hardkodet `Set<string>` i `lib/platform/subdomain.ts` — enkelt, men endringer krever kode-PR
- (B) Sentralt Upstash-objekt — runtime-konfigurerbart, men ekstra round-trip per sjekk
- (C) **VALGT: `lib/platform/reserved-subdomains.json`** — statisk import, type-safe, endringer slår inn ved neste Vercel-deploy, Mike kan editere fritt

**STRUKTUR:**
```json
{
  "_meta": { ... },
  "system_dns": ["admin", "api", "www", ...],
  "platform_app_roles": ["start", "register", ...],
  "environments": ["dev", "staging", ...],
  "kodo_specific": ["kodo", "vault", ...]
}
```

**PATTERN:** "Regel i kode, data i JSON". `*-admin`-suffiksregelen (B2B-provisjonering per D-038) lever i `isReservedSubdomain()` fordi det er en *regel*, ikke et navn. Selve listen er data → JSON.

**KONSEKVENS:** Samme mønster brukes for `plans.json` (D-042). Når Stripe wires i Iter 11 vil price-IDer også bo i JSON, ikke kode.

---

## D-042 — Plan-katalog i JSON + 4 planer (B2C + B2B) (NY · 2026-06-01)

**KONTEKST:** v4.3 Iter 3 (/platform/test) trenger plan-velger som matcher D-037 (B2C-prismodell) og D-038 (B2B-lisensmodell). Spec hadde 3 B2C-planer; vi manglet Enterprise.

**VALG:**
- 4 planer i `lib/platform/plans.json`: trial, monthly, yearly, **enterprise**
- B2C (trial/monthly/yearly): selvbetjent registrering → trial 30d → Stripe ved konvertering (Iter 11+)
- B2B (enterprise): salgsdrevet flow per D-038 — `contactOnly: true` + `contactEmail: "kontakt@kodovault.no"`, ingen Stripe Checkout
- Priser per D-037: 129 kr/mnd, 1 238 kr/år (20% rabatt vs månedlig). Pris-strenger i i18n (per locale), strukturelle data (trialDays, stripePriceId, ctaTone) i JSON.

**KONSEKVENS:** Hvis `?plan=enterprise` treffer `/platform/register`, redirecter UI til mailto-CTA i stedet for skjema. Enterprise-knappen på `/platform/test` viser ingen "Gå til registrering"-knapp etter klikk.

---

## D-043 — Subdomene minimum 3 tegn + Vercel/GitHub-standard format (NY · 2026-06-01)

**KONTEKST:** Iter 4 testing avdekte at den opprinnelige regex tillot 1-tegns subdomener (`a`, `b`). Dette skaper uoversiktlig UX (forhåndsvisning av `https://a.kodovault.no` mens bruker midt i å skrive `alex`) og bryter industri-norm.

**VALG:** Minimum 3 tegn, maks 30. Regex: `/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/`. Eksportert som `SUBDOMAIN_MIN_LENGTH = 3` og `SUBDOMAIN_MAX_LENGTH = 30` fra `lib/platform/subdomain.ts`.

**RASJONALE:**
- Vercel-prosjekter: min 3
- GitHub-organisasjoner: min 1 men anbefalt 3+
- Stripe Connect: min 4
- Vi velger 3 = nedre grense av industristandard, lar korte initialer (`abc`) fungere uten å tillate enkelt-bokstav-spam

**KLIENT-SIDE UX:** Egen `too_short`-state i registreringsskjemaet — viser "Subdomenet må være minst 3 tegn" UTEN å gjøre API-kall. Sparer ett round-trip per tastetrykk under terskelen og gir presis feilmelding (i stedet for generisk "Ugyldig format").

---

## D-044 — Registreringsskjema: påkrevde felt + lokale placeholders (NY · 2026-06-01)

**PÅKREVDE FELT** (per v4.3 Spec linje 151-153):
- ✅ Subdomain (påkrevd)
- ✅ E-post (påkrevd)
- ⬜ Fornavn (valgfritt)
- ⬜ Etternavn (valgfritt)

UI-mønster: Påkrevde felt merket med rød asterisk `*` i label. Forklaring `* Påkrevd felt` under submit-knappen. HTML `required`-attributt KUN på subdomain + e-post — navn-feltene har ingen `required` (bruker kan submitte uten).

**LAYOUT (subdomain-feltet):**
- Input + `.kodovault.no` er SEPARATE elementer (flex-søsken), IKKE inni samme rounded-boks
- Input høyre-justert (`text-right`), bredde `w-[20ch]` (~192px = ~15 tegn synlig + plass til status-ikon på venstre)
- Lengre subdomener scroller horisontalt innen feltet (standard `<input>`-oppførsel)
- `.kodovault.no` er plain monospace-tekst utenfor input, ingen border

**PLACEHOLDERS PER LOCALE:**
- 🇳🇴 NO: Terje / Hansen / `terje@example.no` / `terje`
- 🇸🇪 SV: Erik / Andersson / `erik@example.se` / `erik`
- 🇩🇰 DA: Lars / Nielsen / `lars@example.dk` / `lars`
- 🇬🇧 EN: Alex / Smith / `alex@example.com` / `alex`

**HVORFOR:** Norske navn (Terje, Hansen) virker fremmedartet for dansker/svensker/internasjonale brukere. Hver locale eier sitt eget kulturelt resonant eksempel.

**KONSEKVENS:** Samme prinsipp må følges i fremtidige skjemaer (Iter 7+ register API, Iter 16 e-post-templates, Iter 20 B2B onboarding).

---

## D-045 — Stripe-subscription respekterer eksisterende trial-periode (NY · 2026-06-02)

**KONTEKST:** Når en trial-bruker konverterer til betalt plan (dag 1-29), må Stripe-subscription IKKE starte 30 dager fra konverterings-tidspunktet — da ville bruker betalt for resterende trial-dager dobbelt. Vi trenger tre distinkte scenarier basert på `TenantRecord.status` + `trialEndsAt`.

**VALG (3 scenarier):**

| Scenario | Trigger | Stripe-parameter |
|----------|---------|------------------|
| **A — Aktiv trial konverterer** | `status: "trial"` + `now < trialEndsAt` | `trial_end: Math.floor(trialEndsAt / 1000)` (Unix timestamp) |
| **B — Trial utløpt (betalingsvegg)** | `status: "locked"` | UTEN trial — faktura umiddelbart |
| **C — Betalt plan fra start** | `status: "pending"` + `plan !== "trial"` | `trial_period_days: 30` |

**KONSEKVENS:**
- Scenario A: Stripe første faktura = `trialEndsAt`-datoen, fornying = `trialEndsAt + 30d/365d`.
- Scenario B: Stripe første faktura = umiddelbart, fornying = `now + 30d/365d`.
- Scenario C: Stripe viser "Gratis i 30 dager, deretter 129 kr/mnd". Første faktura dag 30.
- Logikken bor i `POST /api/billing/create-checkout` (Iter 12.5 — splittet ut fra Iter 12).

**HVORFOR IKKE BARE `trial_period_days`:** Stripes `trial_period_days` regnes fra subscription-opprettelsestidspunktet. For Scenario A trenger vi absolutt Unix-timestamp (`trial_end`) for å låse fakturadato til `trialEndsAt` uavhengig av når bruker faktisk klikker "betal".

---

## D-046 — Betalingsvegg selvforsynt via host-header (NY · 2026-06-02)

**KONTEKST:** Betalingsveggen (Iter 19, Skjerm 7) skal vises når trial utløper eller går mot slutten. UI-en må vite `status`, `trialEndsAt`, `daysRemaining`, og om Stripe-customer allerede finnes — men det skal IKKE kreve client-side config-fetch eller URL-parametere som kan tukles med.

**VALG:** Nytt public endepunkt `GET /api/billing/checkout-info` som leser subdomain fra `Host`-headeren (`terje.kodovault.no` → `terje`) og slår opp tenant i sentral Upstash.

**Response-shape:**
```json
{
  "status": "trial" | "locked" | "active" | ...,
  "trialEndsAt": "2026-07-01T00:00:00Z",
  "daysRemaining": 5,
  "hasStripeCustomer": false
}
```

**HVORFOR HOST-HEADER, IKKE QUERY-PARAM:**
- Subdomenet ER identitet i Ko|Do-modellen — DNS bekrefter at requesten kommer fra `terje.kodovault.no`
- Ingen mulighet for å spoofe "annen tenant" via URL-manipulering
- Vercel videresender `Host`-header korrekt; wildcard DNS (per D-040) garanterer at riktig prosjekt mottar requesten

**KONSEKVENS:**
- Betalingsveggen renderer SELVFORSYNT — kun ett GET-kall ved mount
- Klikk på plan-knapp kaller `POST /api/billing/create-checkout` (D-045) → Stripe håndterer trial_end korrekt
- Samme mønster kan gjenbrukes for fremtidige tenant-spesifikke endepunkter (Iter 20 B2B-dashboard)

---

## D-047 — Lifecycle-checkbox med transaksjonell info (NY · 2026-06-02)

**KONTEKST:** Registreringsskjema må klart kommunisere skillet mellom:
- **Lifecycle-eposter** (valgfri opt-in): prøveperiode-påminnelser, plan-tips, lifecycle-engasjement
- **Transaksjonelle eposter** (alltid sendt): betalingsbekreftelser, kvitteringer, sikkerhetsvarsler

GDPR + ePrivacy: transaksjonelle meldinger er "legitimate interest" og krever IKKE samtykke — men brukere må informeres om at de mottar dem.

**VALG:**
- Én checkbox styrer `emailPreferences.lifecycle: boolean` (default `true` per D-037)
- Under checkboxen: dimmet hjelpetekst som forklarer transaksjonell-pålegget — `#666666`, font-size `12px`, font-weight `300`
- Ingen border eller boks rundt — bare ren tekst-hierarki

**TEKSTER (NO):**
- Checkbox-label: "Send meg påminnelser om prøveperioden og betalingsstatus (anbefalt — du kan endre dette i innstillinger senere)."
- Dimmet note: "Vi sender alltid transaksjonsmeldinger — betalingsbekreftelser, kvitteringer og viktige varsler om din vault. Dette kan ikke skrus av."

**DATAMODELL (uendret fra spec):**
```
emailPreferences: {
  transactional: true,    // alltid, ikke påvirket av checkbox
  lifecycle: boolean      // styres av checkbox
}
```

**KONSEKVENS:** Innstillinger-siden (fremtidig — referert i checkbox-teksten "i innstillinger senere") må tilby samme valg for å la bruker endre `lifecycle`-preferanse post-registrering. Iter 22+ må implementere `/platform/settings` med dette feltet. Per nå er det kun et løfte — UI eksisterer ikke ennå.

---

## D-048 — Rate-limiting med delt bucket og fail-open (NY · 2026-06-02)

**KONTEKST:** Public registreringsendepunkter er bot-magneter. Vi trenger per-IP rate-limit som (a) fungerer på tvers av Vercel serverless-instanser, (b) ikke kan omgås ved å bytte plan (trial vs paid), og (c) ikke tar ned hele appen hvis Upstash er nede.

**VALG:**

1. **Sentral Upstash** som sannhetskilde (D-039) — pipeline med `INCR + EXPIRE NX + TTL`. Atomisk, fungerer cross-instance.
2. **Delt bucket for `/register` og `/register/paid`** — nøkkel `platform:ratelimit:register:<ip>` brukes av BEGGE endepunkter. Forhindrer at en bot registrerer 2 trial + 2 paid = 4 kontoer.
3. **Fail-open ved Upstash-feil** — hvis Redis er utilgjengelig logger vi feilen og slipper requesten gjennom. Vi vil heller ta noen bot-requests enn å DOS-e oss selv. Logget som `[rate-limit] Upstash error — failing open`.
4. **Fire grenser per Mike 2026-06-02:**

| Endepunkt | Grense | Bucket |
|-----------|--------|--------|
| `POST /api/register` | 2 / IP / 24t | `register` (delt) |
| `POST /api/register/paid` | 2 / IP / 24t | `register` (delt) |
| `GET /api/register/subdomain-check` | 60 / IP / 60s | `subdomain-check` |
| `POST /api/register/verify-turnstile` | 30 / IP / 60s | `verify-turnstile` |

**RESPONS VED OVERSKREDET GRENSE:** HTTP 429 med headers:
- `Retry-After: <seconds>`
- `X-RateLimit-Limit: <limit>`
- `X-RateLimit-Remaining: <remaining>`
- Body: `{"available":false,"reason":"rate_limited"}` (subdomain-check) eller `{"ok":false,"codes":["rate_limited"]}` (verify-turnstile)

**HVORFOR EXPIRE NX, IKKE EXPIRE:** Vanlig `EXPIRE` ville reset TTL ved hver INCR — da kunne en bot holde nøkkelen i live evig ved å spamme den. `NX` (set TTL kun hvis ikke satt) garanterer at vinduet er ekte 24t fra første request.

**HVORFOR x-forwarded-for[0]:** Vercel kjeder proxies: `client, vercel-edge, vercel-region`. Første element er faktisk klient-IP. Cloudflare før Vercel (D-040 wildcard) videresender også klient-IP korrekt via samme header.

**KONSEKVENS:** Vi har nå en delt `central-upstash.ts`-helper (refaktor av tenant-store.ts) som både tenant-CRUD og rate-limit gjenbruker. Når Iter 7 og 12 implementeres, må de importere `RATE_LIMIT_REGISTER` direkte fra `lib/platform/rate-limit.ts` — IKKE definere egen config inline.

---

## D-049 — Stripe customer just-in-time (NY · 2026-06-02)

**KONTEKST:** Når skal Stripe-customer opprettes? To alternativer:
- (A) Ved trial-registrering (alle får customer-ID med en gang)
- (B) Just-in-time — kun når bruker faktisk velger å betale

**VALG: B (just-in-time).**

**HVORFOR:**
1. **Færre Stripe-kunder = lavere kostnad/risiko.** Trial-brukere som aldri konverterer (50-80% per industri-snitt) trenger aldri en Stripe-record. Vi unngår å lekke trial-emails til Stripes datakontekst.
2. **GDPR/data-minimering.** Vi sender ALDRI brukerdata til Stripe før brukeren aktivt har valgt å betale. Trial er en intern relasjon mellom bruker og Ko|Do.
3. **Enklere rollback ved provisjonering-feil.** Hvis Vercel/Upstash-provisjonering (Iter 8-9) feiler, kan vi slette TenantRecord uten å måtte rydde opp i Stripe.

**IMPLEMENTERING (i `POST /api/billing/create-checkout` — Iter 12.5):**
```js
if (!tenant.stripeCustomerId) {
  const customer = await stripe.customers.create({
    email: tenant.email,
    name: `${tenant.firstName} ${tenant.lastName}`,
    metadata: { subdomain: tenant.subdomain }
  });
  await updateTenant(subdomain, { stripeCustomerId: customer.id });
}
```

**KONSEKVENS:**
- Iter 7 (`POST /api/register` trial) oppretter IKKE Stripe customer
- Iter 12 (`POST /api/register/paid` betalt fra start) oppretter customer + checkout med Scenario C (trial_period_days: 30)
- Iter 12.5 (`POST /api/billing/create-checkout` konvertering) sjekker om customer eksisterer, oppretter hvis ikke
- TenantRecord.stripeCustomerId er `null`/`undefined` for alle trial-brukere som ikke har konvertert
- `metadata.subdomain` er nøkkel for webhook-håndtering (Iter 13) til å koble Stripe-events til TenantRecord

---

## D-050 — In-vault upgrade banner dag 25-29 (NY · 2026-06-02)

**KONTEKST:** Trial-brukere må påminnes om at perioden utløper FØR vault låses. Spec hadde en stor "betalingsvegg" som først dukker opp dag 30 — men det er for sent. Vi vil gi brukeren tid til å handle proaktivt.

**VALG:** Diskret amber-banner ÅPEN i vault-UI dag 25-29 (`daysRemaining <= 5`).

**STYLING (per Mike):**
- Background: `#f5a623` med 10% opacity + amber border (subtilt)
- Hover: full amber for tydelighet
- Border-radius: 8px
- Padding: 12px 16px
- Tar minimal plass øverst i vault — ikke modal, ikke i veien for vault-bruken
- Tekst: "Prøveperioden utløper om X dager — oppgrader nå →"
- Klikk → `/billing/upgrade` (D-049 + Iter 13.7)

**TO TRINN, ÉN DESTINASJON:**
1. Dag 25-29: in-vault banner (Iter 18.5) → klikk → `/billing/upgrade`
2. Dag 30+: vault låst → redirect til `/billing/upgrade`

Begge bruker SAMME upgrade-side (Iter 13.7) med kontekstuell tekst basert på `status` + `daysRemaining` fra `/api/billing/checkout-info`. Vi unngår duplisering av plan-velger-UI mellom betalingsvegg og banner.

**KONSEKVENS:**
- Iter 18.5 implementerer banner-komponenten
- Iter 19 (betalingsvegg) blir mye enklere — bare en gate som redirecter til `/billing/upgrade`
- Iter 13.7 eier all upgrade-UI (én sannhetskilde for plan-valg post-registrering)

---

## D-051 — Alle TenantRecord-felter eksplisitt initialisert (NY · 2026-06-02)

**KONTEKST:** Iter 7 avslørte at `buildTenantRecord` lar mange felter være `undefined` ved opprettelse. Det skapte UI-inkonsistens (felter måtte filtreres på `undefined`) og potensielle bugs hvis kode senere antar at feltene er `null` (false-y check).

**VALG:** Alle felter i `TenantRecord` skal initialiseres EKSPLISITT — som `null` for opsjonelle strenger/IDer/datoer, ikke `undefined`.

**Felter som skal settes til `null` ved opprettelse (både `self` og `admin`):**
- `stripeCustomerId: null`
- `stripeSubscriptionId: null`
- `stripeInvoiceId: null`
- `vercelProjectId: null`
- `upstashDatabaseId: null`
- `lockedAt: null`
- `cancelledAt: null`
- `deletedAt: null`
- `notes: null`

**KONSEKVENS:**
- `tenant-types.ts` TenantRecord-typen må endres til `string | null` for disse feltene (i stedet for `string | undefined`)
- `buildTenantRecord` setter alltid `null` for tomme felter
- Admin detail-card filtreringslogikk forenkles til `v === null` (en sjekk)
- Iter 8-9 må sette `null → string` når provisjonering lykkes
- Iter 12.5 må sette `null → string` for `stripeCustomerId`

---

## D-052 — Admin manuell tenant-opprettelse: customerType-betinget skjema (NY · 2026-06-02)

**KONTEKST:** Iter 1 har et minimalt opprettelsesskjema i TenantViewer (kun B2C, basisfelter). For å støtte både ekte trial-admin-opprettelse og B2B onboarding (Iter 20) trenger vi et komplett skjema som tilpasser seg `customerType`.

**B2C-felter (synlige):**
- subdomain (påkrevd)
- firstName, lastName (valgfrie per D-044)
- email (påkrevd)
- plan (påkrevd) — `trial | monthly | yearly`
- **trialDays** (default 30, admin kan sette 1-365 — overstyrer standard 30d)
- locale — `no | sv | da | en`
- `emailPreferences.lifecycle` (checkbox, default on)
- notes (fritekst)

**B2B-felter (i tillegg):**
- companyName, orgNumber, vatNumber
- companyStreet/PostalCode/City/Country
- contactName, contactEmail, contactPhone
- billingStreet/PostalCode/City/Country, billingEmail, billingReference
- adminSubdomain, tenantPrefix, maxLicenses

**Automatisk:**
- `trialEndsAt = createdAt + trialDays`
- Resten settes til `null` (per D-051)

**KONSEKVENS:**
- Eksisterende minimum-skjema i TenantViewer må utvides
- `CreateTenantInput`-typen får felt `trialDays?: number`
- `buildTenantRecord` aksepterer `trialDays` og overrider 30-dagers default

---

## D-053 — Stripe-kobling i admin detail-card (NY · 2026-06-02)

**KONTEKST:** Mike trenger å kunne koble en TenantRecord til en EKSISTERENDE Stripe customer/subscription (f.eks. ved migrering, manuell support-case, eller B2B-fakturering opprettet utenfor selvbetjent flow). Ikke alle Stripe-relasjoner går gjennom auto-konverteringsflyt (D-049).

**TRE HANDLINGER i detail-card (kun admin):**

1. **"Koble Stripe customer"** — input for `stripeCustomerId` (eksisterende ID som `cus_...`) → PATCH til TenantRecord
2. **"Koble Stripe subscription"** — input for `stripeSubscriptionId` (`sub_...`) → PATCH
3. **"Opprett Stripe customer"** — kaller `stripe.customers.create({email, name, metadata: {subdomain}})` → lagrer ID automatisk

**KONSEKVENS:**
- Nytt endepunkt: `POST /api/admin/tenants/:subdomain/stripe-customer` (admin-only)
- Behold D-049 just-in-time som DEFAULT flyt — denne admin-overstyringen er kun for spesialtilfeller
- Detail-card får ny seksjon "Stripe" med tre handlinger over read-only-feltene

---

## D-054 — Admin-overstyring av tenant-felter med audit-log (NY · 2026-06-02)

**KONTEKST:** Mike må kunne overstyre alle lifecycle-relaterte felter manuelt — for å håndtere edge-cases, support-tickets, feilrettinger. Men endringer må kunne spores tilbake til hvem som gjorde dem og når.

**REDIGERBARE FELTER i detail-card (kun admin):**
- `status` (alle verdier)
- `trialEndsAt` (datepicker)
- `plan`
- `trialDays` (justering i etterkant — oppdaterer trialEndsAt)
- `emailPreferences.lifecycle`
- `lockedAt`, `cancelledAt`, `deletedAt` (set til ISO-dato eller null)
- `notes` (fritekst, alltid redigerbar)

**AUDIT-LOG:** Hver admin-overstyring (utenom selve `notes`-redigering) skal logges i `TenantRecord.notes` som append:
```
[2026-06-02T14:30:00Z] Admin: status endret fra "trial" → "active"
[2026-06-02T14:35:00Z] Admin: trialEndsAt endret fra "2026-07-02..." → "2026-08-02..."
```

**KONSEKVENS:**
- PATCH `/api/admin/tenants/:subdomain` må:
  - Sammenligne gammel og ny verdi for hvert felt
  - Bygge audit-linjer for endringer
  - Append til `notes` (eksisterende notes + "\n" + nye linjer)
- Endring av `notes` selv logges ikke (forhindrer rekursjon)
- TenantViewer detail-card får edit-modus per felt med save/cancel

---

## D-055 — Manuell provisjonering-knapper i admin detail-card (NY · 2026-06-02)

**KONTEKST:** Iter 8-9 (auto-provisjonering) vil av og til feile (Vercel API down, kvote nådd, race condition). Mike trenger en manuell "retry"-knapp.

**TO HANDLINGER (synlige når feltet er `null`):**
- **"Provisjoner Vercel-prosjekt"** — kun synlig når `vercelProjectId === null`. Kaller `lib/platform/vercel-provision.ts` (samme kode som auto-flyt).
- **"Provisjoner Upstash-instans"** — kun synlig når `upstashDatabaseId === null`. Kaller `lib/platform/upstash-provision.ts`.

**KONSEKVENS:**
- Iter 8: legg til knapp i detail-card etter at `vercel-provision.ts` er bygget
- Iter 9: legg til knapp etter `upstash-provision.ts`
- Skjult automatisk så snart ID-er er satt — ingen "re-provisjoner over eksisterende"-risk


---

## D-056 — Invitasjonslenke-flyt for B2B-ansatt-opprettelse (NY · 2026-06-02)

**KONTEKST:** Bedriften har kjøpt N lisenser (`maxLicenses`). I stedet for at Mike (eller fremtidig `am-admin`) må opprette hver ansatt manuelt og dele credentials, sender admin en invitasjonslenke til ansatt. Ansatt klikker, fyller ut minimal info, og en B2B child-TenantRecord opprettes automatisk under parent-prefikset. Master-passord settes ved første innlogging (zero-knowledge, D-001).

**FASER:**
- Fase 1 (Iter 7.6, NÅ): kun Mike kan opprette invitasjoner via `/platform/admin`
- Fase 2 (v4.4.1): `am-admin` kan opprette invitasjoner selvbetjent på `am-admin.kodovault.no`

**DATAMODELL — InviteRecord:**
```typescript
type InviteRecord = {
  token: string           // UUID v4
  subdomain: string       // "am-nils" — forhåndsdefinert
  parentTenant: string    // "am" — tenantPrefix på parent B2B
  email: string | null
  firstName: string | null
  lastName: string | null
  locale: "no" | "sv" | "da" | "en" | null
  createdAt: string       // ISO 8601
  expiresAt: string       // createdAt + 7d
  usedAt: string | null
  status: "pending" | "used" | "expired"
  createdBy: "admin"
}
```

**LAGRING (sentral Upstash, AES-256-GCM som TenantRecord):**
- `invite:<token>` — kryptert blob, TTL 7d ved pending (PERSIST ved used)
- `invite-index:<parentTenant>` — SET av tokens (for admin-listing)

**API-ENDEPUNKTER:**
- `POST /api/admin/invites` (beskyttet) — opprett invitasjon. Validerer parent finnes, subdomain starter med `<prefix>-`, subdomain ledig, `activeLicenses < maxLicenses`.
- `GET /api/admin/invites?parentTenant=am` (beskyttet) — list invitasjoner per parent.
- `DELETE /api/admin/invites/[token]` (beskyttet) — slett invitasjon (idempotent).
- `POST /api/admin/invites/[token]` med `{action:"resend"}` (beskyttet) — invaliderer gammel + oppretter ny.
- `GET /api/invite/validate?token=<uuid>` (public, rate-limited 60/min) — verifiser token + returner skjema-data.
- `POST /api/invite/accept` (public, rate-limited 5/time) — verifiser token på nytt, opprett B2B child-tenant, inkrement parent.activeLicenses, marker invitasjon som "used".
- `GET /api/cron/cleanup-pending` (Vercel Cron, Bearer CRON_SECRET) — marker pending invitasjoner med `expiresAt < now` som `expired` + append notis til parent-notes.

**ANSATT-FLYT:**
`kodovault.no/invite?token=<uuid>` → validate → skjema (subdomain låst, e-post pre-fylt hvis admin satte den) → POST accept → redirect til `<subdomain>.kodovault.no` → første-gangs master-passord-setup (eksisterende vault-flyt).

**FEILMELDINGER (mappet i UI):**
- `not_found` → "Invitasjonslenken er ugyldig."
- `expired` → "Invitasjonslenken er utløpt. Kontakt din administrator."
- `already_used` → "Denne invitasjonslenken er allerede brukt."
- `subdomain_taken` (race) → "Subdomenet er ikke lenger tilgjengelig."
- `max_licenses_reached` → "Alle lisenser er i bruk."

**ADMIN-UI:**
- `InvitesSection` rendres i `TenantDetailCard` når `customerType === "b2b"` og `tenantPrefix` er satt
- Lister alle invitasjoner med status-badge (pending/used/expired)
- Knapper per rad: "Kopier lenke" (kun pending), "Send på nytt" (ikke used), "Slett" (ikke used)
- "+ Ny invitasjon"-knapp + inline skjema

**KONSEKVENS / KOBLING TIL ANDRE ITERS:**
- Iter 8: når Vercel-provisjonering er bygget, kobles `vercel-provision.ts` inn i `/api/invite/accept` etter `createTenant`
- Iter 9: tilsvarende for Upstash
- Iter 10: velkomstmail via Resend etter accept

**HVORFOR IKKE TURNSTILE PÅ ACCEPT:**
Token er allerede en kryptografisk hemmelighet (UUID v4) — den lekker ikke offentlig som en `/register`-side gjør. Rate-limit (5/time) + token-engangskarakter holder anti-spam-egenskapen.


---

## D-057 — Iter 8 Vercel-provisjonering: env-vars og config-flyt (NY · 2026-06-02)

**KONTEKST:** Iter 8 (`lib/platform/vercel-provision.ts`) skal automatisk opprette et nytt Vercel-prosjekt per tenant. Hvordan binder vi tenant-spesifikk config (Upstash-keys, klient-config-fil) til prosjektet?

**ENV-VARS SOM SETTES PER PROSJEKT VED PROVISJONERING:**
- `NEXT_PUBLIC_CLIENT_CONFIG=<subdomain>` — peker til `public/clients/<subdomain>.json` (IKKE `default`)
- `KV_REST_API_URL` — tenantens egen Upstash-instans (fra Iter 9)
- `KV_REST_API_TOKEN` — tenantens egen Upstash-token (fra Iter 9)

**CONFIG-FIL GENERERES DYNAMISK:**
`vercel-provision.ts` skal:
1. Lese `public/clients/default.json` fra repo
2. Lage `public/clients/<subdomain>.json` med oppdaterte felter:
   - `_meta.client = "<subdomain>"`
   - `_meta.createdAt = "<ISO 8601 UTC>"`
3. Committe filen til `meetmax-no/bankboks` via GitHub API → Vercel-deploy plukker den opp automatisk via webhook-trigger.

**MIDLERTIDIG (FØR `kodo-vault-template` ER KLAR):**
Bruk eksisterende Vercel-prosjekt som base + sett korrekte env-vars per tenant. Når template er ferdig, byttes til template-baserte prosjekter.

**KONSEKVENS — KREVER PR-API-NØKLER:**
- `VERCEL_API_TOKEN` (allerede planlagt — venter på Mike)
- `GITHUB_API_TOKEN` (NY — trengs for å committe `clients/<subdomain>.json`)
  - Scope: `repo` (write til `meetmax-no/bankboks`)
  - Generér på https://github.com/settings/tokens (classic eller fine-grained med repo-scope)

**REKKEFØLGE I `/api/invite/accept` ETTER ITER 8-9:**
1. createTenant (Iter 7.6 — gjort)
2. createVercelProject + setEnvVars + commitClientConfig (Iter 8)
3. createUpstashDatabase + update env-vars med faktiske keys (Iter 9)
4. sendVelkomstmail via Resend (Iter 10)

Ved feil i steg 2: status = `"provisioning_failed"`, Telegram + e-post varsling, manuell retry-knapp i admin (D-055).


---

## D-058 — Provisjonerings-rekkefølge + skalerings-issue ved delt repo (NY · 2026-06-02)

**KONTEKST:** Første test (`testkonto17`) viste at GitHub-commit FØR Vercel-prosjektopprettelse gjør at webhook går til ingenting — Vercel-prosjektet eksisterer ikke ennå for å motta den. Resultat: prosjekt opprettet, men ingen produksjons-deploy.

**FIX:**
- Vercel-prosjekt + env-vars + domain provisjoneres FØRST
- GitHub-commit kommer ETTER (commit trigger webhook → eksisterende Vercel-prosjekt bygger med env + domain på plass)

**SKALERINGS-ISSUE (kjent, IKKE løst i Iter 8):**
Alle `kodo-kv-*`-prosjekter er linket til samme `meetmax-no/bankboks`-repo. ETT signup → én ny `clients/<subdomain>.json`-commit → webhook trigger ALLE linkede prosjekter til å rebuilde. Med N tenants = N builds per signup.

**FIX FOR DETTE (P2, senere iter — sannsynlig Iter 8.5 eller Iter 21):**
Sett "Ignored Build Step" per Vercel-prosjekt ved provisjonering:
```bash
git diff HEAD^ HEAD --quiet -- frontend/public/clients/<my-subdomain>.json frontend/lib/ frontend/app/ && exit 0 || exit 1
```
Da bygger hvert prosjekt KUN når deres egen config-fil eller kjernekoden endrer seg. Settes via `POST /v9/projects/{id}` med `commandForIgnoringBuildStep`.

**TIL MIKE NÅ:** testkonto17 — manuell deploy fra Vercel-dashbordet (Deployments → "Redeploy main"). Neste test-tenant vil deploye automatisk takket være reorderingen.


---

## D-059 — Tenant-config-flyt: GitHub API + .gitignore-beskyttelse (NY · 2026-06-02)

**KONTEKST:** Første test (`testkonto17`) avdekket en arkitekturkonflikt:
- Provisjonering committet `frontend/public/clients/testkonto17.json` til bankboks via GitHub API
- Mike trykket "Save to GitHub" fra Emergent → Emergent pushet `/app/frontend/` til bankboks
- Lokal mappe hadde KUN `default.json`, så `testkonto17.json` ble slettet fra bankboks
- Resultat: Vercel-build for tenant fant ikke config-fila

**VURDERTE ALTERNATIVER:**
1. ❌ Flytte tenant-configs til Upstash + bygge `/api/client-config`-route — overkill, ny abstraksjon, krever endringer i useAppConfig
2. ❌ Egen `kodo-vault-configs`-repo — for tung, build-step submodules
3. ✅ `.gitignore` ekskluderer tenant-configs fra Emergent-workspaceet — git push respekterer dette automatisk

**LØSNING:**
Linjer i `/app/.gitignore` (repo-rot, sync-er til bankboks ved Save-to-GitHub):
```
frontend/public/clients/*.json
!frontend/public/clients/default.json
!frontend/public/clients/default-lk.json
!frontend/public/clients/default-th.json
```

**KONSEKVENS:**
- Emergent workspace har KUN `default*.json` lokalt
- `Save to GitHub` pusher kun tracked filer → eksisterende `<subdomain>.json`-filer i bankboks blir IKKE rørt
- Provisjonering via GitHub API PUT-er `frontend/public/clients/<subdomain>.json` direkte til bankboks main → forblir der for alltid
- `default.json` eies MANUELT av Mike. Endringer der gjøres i Emergent og pushes via Save-to-GitHub som vanlig
- Tenant-Vercel-prosjekt finner fila ved build → serves som `/clients/<subdomain>.json` i runtime
- Ingen kode-endring i `useAppConfig.ts` — fortsetter å fetche fra static `/clients/<name>.json`

**SKALERINGS-NOTAT:**
Alle `kodo-kv-*`-prosjekter linket til samme bankboks-repo → ETT signup → én commit → webhook trigger N builds for N tenants. Fix-en for dette (Vercel "Ignored Build Step") er parkert til senere iter. Med få tenants per dag er det ikke et reelt problem.

**FOR testkonto17 (manuell engangs-fix):**
- I Vercel-dashboardet → Settings → Root Directory = `frontend`
- Trigger ny deploy (vil nå feile siden testkonto17.json mangler) ELLER
- Klikk "Provisjoner Vercel-prosjekt"-knappen på nytt — `provisionTenantConfigInGitHub` skriver fila til bankboks igjen (idempotent via SHA)


---

## D-060 — Tenant-config via sentral Upstash + runtime-fetch (NY · 2026-06-02 · ERSTATTER D-059)

**KONTEKST:** Mike testet D-059 (.gitignore-beskyttelse av tenant-configs i bankboks-repo). Save-to-GitHub gjør force-mirror — sletter remote-filer som ikke finnes i workspace. `.gitignore`-strategien er teknisk umulig. Support bekreftet ikke offisielt mekanisme for å beskytte remote-only filer.

**LØSNING (Alt B fra Mike's vurdering):**

**Lagring:**
- Per-tenant configs i sentral Upstash som plain JSON under `client-config:<subdomain>`
- `default.json` i bankboks som template — eid manuelt av Mike
- Bankboks-repo rores ALDRI av provisjonering

**Fetching i tenantens app (`useAppConfig.ts`):**
- `NEXT_PUBLIC_CLIENT_CONFIG=default` → static `/clients/default.json` (uendret)
- `NEXT_PUBLIC_CLIENT_CONFIG=<subdomain>` → fetch `https://admin.kodovault.no/api/client-config?id=<subdomain>` (CORS)
- Fallback: ved 404 eller Upstash-feil → static `/clients/default.json` (sikkerhetsnett)

**CORS:** `/api/client-config` tillater alle `*.kodovault.no`-subdomener + `localhost`.

**Endring per tenant (uten redeploy):**
- Admin åpner `TenantDetailCard` → `ClientConfigEditor` viser current JSON
- Editor validerer JSON-syntax før save, `<textarea>` (strukturert form senere)
- PUT `/api/admin/client-config?id=<subdomain>` → overskriver Upstash-key
- Tenant ser endring innen 30 sek (browser-cache) eller 5 min (s-maxage)
- "Reset til default"-knapp: DELETE → tenant faller tilbake til `default.json`

**Provisjonerings-flyt:**
1. `createVercelProject(subdomain)`
2. `buildTenantConfigForUpstash(subdomain)` — les default.json fra admin-app's filsystem, mutér _meta
3. `putClientConfig(subdomain, configJson)` — lagre i Upstash
4. `setProjectEnvVars` — sett `NEXT_PUBLIC_CLIENT_CONFIG=<subdomain>` (ikke embedded JSON)
5. `attachSubdomain` — `<subdomain>.kodovault.no`

**SLETTET:**
- `lib/platform/github-config.ts`
- `/api/admin/diagnostics/github`
- All GitHub PUT-logikk fra provisjonering
- `.gitignore`-regelen fra D-059 (kan stå urørt — uskyldig)

**KONSEKVENS:**
- Bankboks-repoet er igjen "rent" — kun template-filer + kode
- Save-to-GitHub kan ikke skade noe (det finnes ingenting å skade)
- Mike kan endre branding/categories/farger per tenant fra admin.kodovault.no — endringer trer i kraft umiddelbart
- Skalering: ingen N×builds-problemet fra D-058 lenger (config-endring trigger ingen build)

**MIGRERING for testkonto22 (allerede provisjonert):**
- Mangler `client-config:testkonto22` i Upstash → vil falle tilbake til default.json
- Etter deploy: åpne admin → testkonto22 → Client config editor laster default-template (source: "default") → trykk Lagre → nå lever den i Upstash


---

## D-061 — localStorage-cache for tenant-config (NY · 2026-06-02)

**KONTEKST:** Etter D-060 er `admin.kodovault.no` single-point-of-failure for ALLE tenants — de fetcher client-config derfra ved hver page-load. Hvis admin-modulen er nede mister tenants branding/kategorier.

**LØSNING (D-061):**
- Ved vellykket fetch fra `/api/client-config`: skriv config + timestamp til `localStorage["kodo-config:<subdomain>"]` og `kodo-config:<subdomain>:ts`
- Ved fetch-feil: les fra cache hvis <24t gammel
- Hvis cache mangler eller for gammel: fallback til `/clients/default.json`
- Hvis det også feiler: `FALLBACK_CONFIG` (kompilert default)

**INVALIDERING:**
- Vellykket fetch overskriver alltid cache (samme tab)
- 24t TTL via timestamp-sammenligning (ingen aktiv eviction)
- Cross-tab: ingen — admin kan ikke skrive til tenants localStorage (forskjellige domener). Akseptabelt: tenant ser oppdatert config ved neste fetch uansett.

**KONSEKVENS:**
- Eksisterende tenants overlever 24t med admin-nedetid uten å miste config
- Nye tenants uten lokal cache: ser default.json — akseptabelt
- localStorage-bruk per tenant: ~5-10KB (én snapshot)

**RELATERT:** D-001 (zero-knowledge) — config-data er IKKE sensitivt (kategorier, branding, farger), så plain-text cache er OK. Vault-data er fortsatt AES-kryptert i separat localStorage-key.


---

## D-062 — Fullfør ID-integrasjon i backup + master-pwd-bytte (NY · 2026-06-03)

**KONTEKST:** Mike oppdaget at:
1. ID-blobben mangler i `blobSources` i `app/page.tsx` → backup-export/import dekker ikke ID-er
2. `changeMasterPassword` re-krypterer kun vault-blob → cards/ids på server forblir kryptert med gammelt pwd → "Kontakt support"-lockout når bruker åpner fanene etter MP-bytte

Begge er manglende implementasjon fra da ID-modulen ble lagt til i v3.2 — ikke nye bugs.

**LØSNING:**

### 1. ID-er i blobSources
`app/page.tsx` linje 396-407: lagt til `ids`-objekt på lik linje med `vault` + `cards`. `BackupExportModal` og `BackupImportModal` itererer generisk over `BackupBlobSource[]` så ingen modal-endring nødvendig.

### 2. Atomisk re-kryptering av side-blobs ved MP-bytte
Nye metoder i `useCards.ts` + `useIds.ts`:
- `reEncryptInPlace(oldPwd, newPwd)` — fetch + decrypt + encrypt + push. Returnerer `{ hadBlob: bool, originalBlob? }` for rollback.
- `rederiveSessionAfterMpChange(newPwd)` — re-derive aktiv session så fanen fortsetter å fungere uten manuell unlock.
- `rollbackToBlob(blob)` — push gammel blob tilbake (idempotent).

`useVault.ts` `changeMasterPassword`-signatur utvidet med optional `reEncryptSideBlobs`-callback. Rekkefølge:
1. Verifiser current pwd (decrypt vault)
2. **Re-krypter cards** (push ny blob, behold original)
3. **Re-krypter ids** (push ny blob; ved feil → rollback cards)
4. **Re-krypter vault og push** (barriere — sist)
5. Re-derive vault-session med newPwd
6. clearBiometric
7. Re-derive cards/ids sessions hvis aktive

Ved vault-push-feil: useVault kaster `VaultPushFailedNeedsRollback`-exception. `vault-runtime.tsx` fanger denne og ruller tilbake både cards og ids.

### 3. Implementering plassert i `vault-runtime.tsx`
`VaultRuntimeProvider` wrapper `vault.changeMasterPassword` med:
- `reEncryptSideBlobs` som orkestrerer cards + ids atomisk med rollback
- `rederiveAfterMpChange` etter vault-push lyktes
- `pendingRollbackRef` for å holde originale blobs i RAM gjennom hele operasjonen

Eksponert vault gjennom context er ny instans `vaultWithWrappedMP` så side-blob-håndteringen er fullstendig transparent for `app/page.tsx`.

**EDGE CASES HÅNDTERT:**
- Cards/ids blob finnes ikke på server → skip silently (`hadBlob: false`)
- Cards/ids session er ikke aktiv → kun oppdater ephemeral pwd, lazy-load henter ved neste activate
- Cards/ids session er aktiv → re-derive session så fanen fortsetter å fungere
- Hvis re-derive feiler etter vault-push lyktes → graceful, bruker kan låse opp på nytt

**ROLLBACK-MATRISE:**
| Feil-steg | Cards | Ids | Vault | Rollback |
|---|---|---|---|---|
| 2 (cards push) | unchanged | unchanged | unchanged | ingen — kast error |
| 3 (ids push) | newPwd 🔴 | unchanged | unchanged | rollback cards |
| 4 (vault push) | newPwd 🔴 | newPwd 🔴 | unchanged | rollback cards + ids |
| Suksess | newPwd ✅ | newPwd ✅ | newPwd ✅ | — |

**TESTER:**
- `lib/__tests__/mp-change.test.ts` — 8 tester for crypto-round-trip + at originalBlob fortsatt kan dekryptes med oldPwd (rollback-forutsetning)
- Eksisterende 132 tester fortsatt grønne
- Total: 140/140

**MIKE'S DESIGN-INTENSJON BEVART:**
Backup-fil-flyten (BackupImportModal med separat backupPwd-felt) fungerer uendret. Brukeren kan fortsatt restore en backup laget med gammelt pwd ved å oppgi det gamle pwd-et som backup-pwd og nåværende pwd som current-pwd.

### 4. Validering ved selektiv restore (D-062 påbygg · 2026-06-03)
**Problem:** Hvis brukeren tar backup på MP1, bytter til MP2, tar ny backup av kun cards på MP2, og senere prøver å restore BÅDE vault (MP1) + cards (MP2) fra samme backup-pakke → de er kryptert med forskjellige pwd. Med kun ett `backupPwd`-felt i modalen kunne brukeren ikke restore begge i én operasjon.

**Fix i `handleConfirmImport` TRINN 1:**
- I stedet for å throw umiddelbart på første feilende blob, samle `decryptSuccesses[]` og `decryptFailures[]`
- Hvis BÅDE successes og failures finnes → throw med locale-streng `page.toast_mixed_passwords`: "Valgte blobs er kryptert med forskjellige passord. Restore én blob av gangen."
- Hvis alle feilet → opprinnelig "feil passord"-error
- Locale-streng lagt til i no/en/sv/da (med `{labels}`-placeholder for hvilke blobs som ikke matchet)

**Garanti i TRINN 3 (kommentar lagt til):**
"Vi rører ALDRI blobs på server som ikke er valgt for import." Loopen pusher kun via `applyImportedPayload` for selectedIds. Backup-fil holder hver blob i isolert seksjon — vi triggrer ingen side-effekter på server for ikke-valgte blobs.




## D-064: Upstash provisjoneres FØR Vercel (NY · 2026-06-03)

**Kontekst:**
Iter 9 første implementasjon fulgte spec-mønsteret med `PENDING_ITER_9`-plassholder:
1. Vercel-prosjekt opprettes med `KV_REST_API_URL=PENDING_ITER_9` + `KV_REST_API_TOKEN=PENDING_ITER_9`
2. Vercel deployer prosjektet med disse plassholderne
3. Upstash-DB opprettes
4. `updateProjectEnvVar()` patcher env-vars til ekte verdier (DELETE + POST)

**Problemer avdekket i produksjon:**
1. **Vercel env-vars er statiske ved build-tid.** Etter steg 4 har Vercel den oppdaterte env-recorden, men den AKTIVE deployen kjører fortsatt med `PENDING_ITER_9` til neste deploy trigges. Tenanten ser "provisjonert ferdig" men runtime feiler.
2. **Eventual consistency i Vercel env-API.** `listProjectEnvVars()` rett etter `setProjectEnvVars()` returnerer ikke alltid de nyopprettede entriene → DELETE finner ingenting → POST forsøker å lage duplikat → 409.
3. **Halvtilstand-rot.** Hvis Upstash feiler, har vi et Vercel-prosjekt med dead env-vars som krever manuell opprydding.

**Beslutning (Mike, 2026-06-03):**
Snu rekkefølgen helt + eksplisitt redeploy:
1. **Upstash provisjoneres FØRST** → få `restUrl` + `restToken`
2. **createVercelProject** → opprett prosjekt (kan starte auto-deploy umiddelbart, før env-vars er satt)
3. **setProjectEnvVars** → injiser ekte KV-creds + CLIENT_CONFIG
4. **triggerVercelRedeploy** → POST `/v13/deployments` med `gitSource.ref="main"` + `repoId` fra `getVercelProject`. Dette tvinger Vercel til å bygge en NY deploy med de oppdaterte env-vars. Den blir aktiv produksjons-deploy.
5. **attachSubdomain** → koble domenet (uavhengig av deploy-status)

**Konsekvenser:**
- `PENDING_ITER_9`-mønsteret fjernet helt fra kodebasen
- `provisionTenantOnVercel()` krever nå obligatoriske `kvRestApiUrl` + `kvRestApiToken` (ikke valgfrie)
- `updateProjectEnvVar()` beholdes som helper for fremtidig vedlikehold, men brukes ikke i hovedflyten
- D-055-knapper i admin-UI omsnudd:
  - "1. Provisjoner Upstash-instans" (grønn) — kjøres først, idempotent
  - "2. Provisjoner Vercel-prosjekt" (blå) — krever `upstashDatabaseId !== null`. Henter creds fra Upstash Management API via `getDatabaseRestCredentials()` og injecter dem i deploy.
- Hvis Upstash feiler → ingen Vercel-prosjekt opprettes (ren slate, ingen halv-tilstand)
- Hvis Vercel feiler etter Upstash lyktes → Upstash-DB blir orphan, men admin kan retry-e Vercel via D-055-knappen. Retry-en henter eksisterende Upstash-creds via `getDatabaseRestCredentials(upstashDatabaseId)`.

**Migrering eksisterende halvtilstand-tenants:**
`annelise` (provisioning_failed 2026-06-03) ble slettet manuelt fra admin + Vercel + Upstash og re-opprettet via den nye flyten.

**Erstatter:** Iter 9 første implementasjon (PENDING_ITER_9-mønster).
**Bygger på:** D-063 (failsoft policy ved provisjoneringsfeil).


## D-063: Upstash-feil ruller IKKE tilbake Vercel (NY · 2026-06-03)

**Kontekst:**
v4.3 Spec linje 297-299 spesifiserte at hvis Upstash-provisjonering feiler etter at Vercel-prosjektet er opprettet, skal Vercel-prosjektet rulles tilbake (`DELETE /v9/projects/{id}` + nullstill `vercelProjectId`).

**Problem med rollback:**
1. Rollback-pad krever egen `deleteVercelProject()` + delicate ordering (slett env-vars først for å unngå dangling refs)
2. Hvis rollback selv feiler → tenant ender i delvis-inkonsistent tilstand
3. Vercel-prosjektet er billig — å beholde det er ikke en kostnadsbyrde
4. Admin-retry-flyt via D-055 er allerede etablert mønster

**Beslutning (Mike, Iter 9):**
Ved Upstash-feil under registrerings-/invite-flyt:
- IKKE slett Vercel-prosjektet
- Sett `status: "provisioning_failed"` på tenant
- Behold `vercelProjectId` slik at retry-knappen kan oppdatere KV-env-vars i samme prosjekt
- Send Telegram-varsling via `notifyProvisioningFailure({ stage: "upstash", ... })`
- Admin retter via "Provisjoner Upstash-instans"-knappen (D-055)

**Konsekvens:**
- `provision-upstash`-endepunktet idempotent: krever `vercelProjectId !== null` og `upstashDatabaseId === null`
- Når retry lykkes, nullstilles `provisioning_failed` → `active`
- Spec linje 297-299 er overstyrt av denne ADR-en

**Erstatter:** v4.3 Spec linje 297-299 (rollback-pad)

## D-065: Strukturert provisjonerings-logg på TenantRecord (NY · 2026-06-04)

**Kontekst:**
Provisjonerings-flyten (Upstash + Vercel + redeploy + domain) gjør 5-7 eksterne API-kall. Når noe feiler, må Mike kunne se eksakt hva som skjedde — ikke bare "provisioning_failed"-status. `notes`-feltet ble brukt som audit-log av PATCH-flyten (D-054), men er fritekst og dårlig egnet til strukturert maskin-lesbar historikk.

**Beslutning:**
Nytt felt på `TenantRecord`:
```ts
provisioningLog: ProvisioningEvent[]

type ProvisioningEvent = {
  timestamp: string           // ISO 8601 UTC
  stage: ProvisioningStage
  status: "ok" | "failed" | "retried"
  detail?: string             // feilmelding eller bekreftelse
}

type ProvisioningStage =
  | "upstash_create"
  | "vercel_create"
  | "vercel_env"
  | "vercel_redeploy"
  | "subdomain_attach"
  | "admin_override"
  | "status_change"
  | "invite_sent"
  | "invite_accepted"
```

**Append-only:** Events legges til, aldri redigeres eller slettes. Gir komplett historikk per tenant.

**Real-time skriving:** Hvert eksternt API-kall i `provisionTenantOnUpstash` / `provisionTenantOnVercel` tar en valgfri `onEvent`-callback. `provisioningLogger(subdomain)` returnerer en callback som persisterer events via `appendProvisioningEvent` (GET tenant + append + PUT). Mike refresh-er TenantViewer og ser progresjon mens flyten kjører.

**Soft migration:** Eksisterende TenantRecords (skrevet før 2026-06-04) mangler feltet. `migrateTenant()` i `tenant-store.ts` initialiserer `provisioningLog: []` ved load. Neste putTenant persisterer det. `notes`-feltet blir IKKE rørt — fortsatt fritekst + audit-log fra D-054.

**Skiller fra D-054 (`notes`-audit):**
- `notes` = fritekst fra Mike + ende-på-ende audit (PATCH-felt-endringer)
- `provisioningLog` = strukturert maskin-lesbar event-stream (provisjonering, status-endringer, invite-flyt)
- Begge eksisterer parallelt — overlapper kun for status-endringer (logges i begge for fremtidig migrering)

**UI (TenantViewer):**
- `ProvisioningLogPanel`-komponent rett under `ProvisionRow`
- "{ } Vis JSON" / "{ } Skjul JSON"-toggle (collapsed default)
- Live JSON-panel (samme stil som Per-Tannlegen-konseptet) med:
  - Header: "LIVE JSON" + pulse-indikator + linje-/byte-teller
  - Kopier-knapp
  - Pre-blokk med syntax-color (emerald) + max-height 420px scroll
  - Kronologisk rekkefølge, **nyeste øverst** (per Mike)
- `data-testid`-attributter: `tenant-provisioning-log-panel`, `-toggle`, `-content`, `-copy`

**Stages logget hvor:**
- `upstash_create` (ok/failed) → `provisionTenantOnUpstash`
- `vercel_create`, `vercel_env`, `vercel_redeploy`, `subdomain_attach` (ok/failed) → `provisionTenantOnVercel`
- `retried`-status: `provision-upstash` + `provision-vercel` retry-ruter logger "retried"-event før selve forsøket
- `status_change` (ok) → `/api/admin/tenants/[subdomain]` PATCH når `before.status !== record.status`
- `admin_override` (ok) → samme PATCH-rute når andre felter endres (uten status-bytte)
- `invite_sent` (ok) → `/api/admin/invites` POST — logges på parent-tenanten (child eksisterer ikke ennå)
- `invite_accepted` (ok) → `/api/invite/accept` — logges på BÅDE child- og parent-tenanten

**Filer:**
- `lib/platform/tenant-types.ts` — `ProvisioningEvent`, `ProvisioningStage`, `ProvisioningEventStatus`, felt på `TenantRecord`
- `lib/platform/tenant-store.ts` — `appendProvisioningEvent()`, `migrateTenant()`
- `lib/platform/provisioning-log.ts` — `provisioningLogger(subdomain)`, `logEvent(subdomain, stage, status, detail)`
- `lib/platform/vercel-provision.ts` — `onEvent` i `ProvisionVercelInput`, callback-emit i alle 5 stegene
- `lib/platform/upstash-provision.ts` — `onEvent` i `ProvisionUpstashInput`, callback-emit
- `components/platform/TenantViewer.tsx` — `ProvisioningLogPanel` komponent

**Bygger på:** D-054 (`notes` audit), D-055 (D-055 retry-knapper), D-063 (failsoft), D-064 (Upstash først).


## D-066: vault_live flagg + on-demand deployment-polling (NY · 2026-06-04)

**Kontekst:**
Etter D-064/D-065 har vi strukturert logging og rekkefølge Upstash→Vercel→redeploy→subdomain. Men `attach_subdomain` returnerer raskt — Vercel-builden er ikke ferdig før noen minutter senere. Bruker på Skjerm 5 ser "registreringen er sendt" men vet ikke om vaulten faktisk er klar å brukes. Mike trenger:
- Konkret signal "vaulten er live" (annet enn `provisioning_failed`)
- Skjerm 5 viser progresjon i sanntid
- Skjerm 6 vises automatisk når vault er klar

**Beslutning:**
Nytt felt `vaultLive: boolean` + `vaultLiveAt: string | null` på TenantRecord. Nytt stage `vault_live` i `ProvisioningEvent`. Vercel-deployment polles ikke som background-task (umulig i serverless) — i stedet implementeres **on-demand check** som trigges av frontend-polling mot `/api/status`.

**Arkitektur:**
1. `triggerVercelRedeploy()` returnerer `deploymentId` (uid fra Vercel API)
2. `vercel_redeploy`-event lagrer `deploymentId=<uid>` i `detail`-feltet
3. Frontend Skjerm 5 poller `GET /api/status?subdomain=<x>` hvert 2. sek
4. `/api/status` kaller `checkDeploymentOnce(subdomain)` som:
   - GET tenant fra Upstash
   - Hvis `vaultLive=true`: returner immediately
   - Hvis ingen `vercel_redeploy`-event: returner snapshot (provisjonering ikke kommet dit ennå)
   - Ellers: parse `deploymentId` fra `detail` + sjekk timeout (>3 min siden vercel_redeploy)
   - GET `/v13/deployments/{id}` fra Vercel
   - State `READY` → `markVaultLive` (sett `vaultLive=true`, `vaultLiveAt`, emit `vault_live ok`, hvis `provisioning_failed` → restore til `trial`)
   - State `ERROR`/`CANCELED` → `markVaultFailed` (sett `provisioning_failed`, emit `vault_live failed`, notify)
   - Timeout (>3 min, ikke allerede markert) → `markVaultFailed("Timeout...")`
   - Ellers (`QUEUED`/`INITIALIZING`/`BUILDING`) → returner snapshot, frontend poller igjen

**Hvorfor on-demand i stedet for background:**
Vercel serverless lambdaer har max 60-300s execution time. 3 min polling med setTimeout etter response-send VIL ikke kjøre. Frontend-polling-mønsteret er CORS-vennlig, idempotent, og fungerer i hele Vercel-økosystemet.

**Skjerm 5 UI (ProvisioningTracker-komponent):**
- Poller `/api/status` hvert 2. sek (clearTimeout ved unmount)
- Dynamisk statusmelding basert på `latestEvent.stage`:
  - `upstash_create` → "Oppretter sikker lagring…"
  - `vercel_create` / `vercel_env` → "Konfigurerer vault-miljø…"
  - `vercel_redeploy` → "Starter din vault…"
  - `subdomain_attach` → "Kobler til kodovault.no…"
  - `vault_live` → "Din vault er klar!" + "Åpne din vault"-knapp
  - `provisioning_failed` → rød feilmelding + "vi har varslet teamet"
- Collapsible "Vis tekniske detaljer" med siste 5 events (tekst-format)

**Konto-logg i TenantViewer (TenantDetailCard):**
- Tekst-modus default ("[timestamp] stage ✅ detail"-format)
- JSON-modus toggle
- Kopier-knapp kopierer current view (tekst eller JSON)
- "vault live ✓"-indikator i header når `vaultLive=true`

**Filer:**
- `lib/platform/tenant-types.ts` — `vaultLive`, `vaultLiveAt`, `vault_live`-stage
- `lib/platform/tenant-store.ts` — `migrateTenant` initialiserer `vaultLive=false` på gamle records
- `lib/platform/vercel-provision.ts` — `triggerVercelRedeploy` returnerer `{deploymentId}`, `getDeploymentStatus(id)`, `deploymentId` i `vercel_redeploy`-event detail
- `lib/platform/poll-deployment.ts` — `checkDeploymentOnce`, `markVaultLive`, `markVaultFailed`
- `app/api/status/route.ts` — public CORS-åpen GET-endpoint
- `app/platform/register/page.tsx` — `ProvisioningTracker`-komponent
- `components/platform/TenantViewer.tsx` — `formatLogAsText`, view-toggle

**Sikkerhet:**
- `/api/status` er offentlig (ingen auth). Returnerer kun `vaultLive`, `status`, `latestEvent` og siste 5 events. Subdomain er ikke hemmelig (brukeren registrerte den selv). Ingen tenant-creds eksponeres.
- CORS: `*.kodovault.no` + `https://kodovault.no` whitelisted, fallback `*` for utvikling.
- Rate limit: ingen — polling-flyt SKAL fungere uten hindring. 2 sek intervall + 3 min max = ~90 requests per registrering.

**Iter 10 hooks (TODO i koden):**
- `markVaultLive`: send velkomstmail via Resend + Telegram "✅ Ny tenant live"
- `markVaultFailed`: notify-stub eksisterer allerede, Iter 10 wirer Telegram

**Bygger på:** D-055 (retry-knapper), D-063 (failsoft), D-064 (Upstash først), D-065 (provisioningLog).


## D-067: Admin-create bruker samme live tracker som Skjerm 5 (NY · 2026-06-04)

**Kontekst:**
`POST /api/admin/tenants` provisjonerte tidligere både Upstash og Vercel synkront før respons (etter D-064). Den lambda-kjøringen tok 15-30 sek, og admin-UI viste bare en spinner. Mike ba om samme live-tracker som Skjerm 5 har — "Det MÅ skje slikt."

**Problem ved synkron flyt:**
- Vercel Pro lambda har 60-300s timeout, men:
  - Bruker ser ingen progresjon under venting
  - Hvis lambda timer ut underveis blir tenant-record opprettet, men provisjonering uferdig (admin må gjette hvor det stoppet)
  - Ingen mulighet for å se "vi venter på Vercel build"-tilstand

**Beslutning:**
Frontend orkestrerer hele provisjoneringskjeden via separate HTTP-kall (hver en egen lambda). Server-API endres til:
- `POST /api/admin/tenants` — oppretter KUN tenant-record, returnerer 201 raskt
- D-055-retry-rutene gjenbrukes som primær flyt for admin-create:
  - `POST /api/admin/tenants/<sub>/provision-upstash`
  - `POST /api/admin/tenants/<sub>/provision-vercel`
- `/api/status?subdomain=X` polling tar over når vercel_redeploy er fyrt

**Implementering:**

Delt komponent `ProvisioningTracker` (`components/platform/ProvisioningTracker.tsx`):
- Modus `public`: kun polling (brukes på Skjerm 5)
- Modus `admin`: orkestrerer Upstash → Vercel → polling

`AdminProvisioningModal` (i TenantViewer):
- Åpnes automatisk etter `POST /api/admin/tenants` returnerer 201
- Sentrert overlay (max-w-xl) med ProvisioningTracker innenfor
- Lukk-knapp deaktivert under aktiv provisjonering (med tooltip "lukker i bakgrunnen")
- "Se tenant-detaljer" / "Lukk"-knapp dukker opp når `done`

UI-mønster matcher Skjerm 5 (samme melding-mapping per stage, samme emerald/red/amber farger).

**Hvorfor frontend-orkestrering:**
- Hver lambda-kall er kort (1-15 sek), ingen timeout-risiko
- Hver kall er separat audit-loggable
- Admin kan re-trigge enkelt-stages manuelt via D-055-knappene hvis modal lukkes
- Frontend kan vise live progresjon mellom hvert kall
- `/api/status` polling håndterer build-fasen (3 min) uten lambda-timeout

**Hva endret seg ikke:**
- `/api/register` (B2C public) — provisjonerer fortsatt server-side. Frontend poller bare. Dette er enklere fordi `/api/register` har Turnstile-validering + rate-limit som ikke skal eksponere D-055-knapper offentlig.
- `/api/invite/accept` — samme. Provisjonering server-side.

**Filer:**
- `app/api/admin/tenants/route.ts` — fjernet auto-provisjonering
- `components/platform/ProvisioningTracker.tsx` — ny delt komponent
- `components/platform/TenantViewer.tsx` — `ProvisioningModal` + `provisioningSubdomain` state
- `app/platform/register/page.tsx` — bruker delt komponent (slettet inline-versjonen)

**Bygger på:** D-055 (retry-knapper), D-064 (Upstash først), D-065 (provisioningLog), D-066 (vault_live + polling).


## D-068: Velkomstmail + Telegram-varsling (NY · 2026-06-04)

**Kontekst:**
Etter D-066 settes `vaultLive=true` når Vercel-build blir READY. Bruker har ingen ekstern bekreftelse — Mike vet ikke at en ny tenant ble live uten å sjekke admin-UI. Spec for Iter 10 ber om Resend velkomstmail + Telegram-varsel.

**Beslutning (D-068):**
Wire inn både Resend (transactional mail) og Telegram (Bot API) i `markVaultLive()` som fire-and-forget kall. Begge kanaler er gated av eksplisitt `*_ENABLED=true`-env-var (samme mønster som `tannlege-per`-prosjektet). Mangler en av delene → kanal er stille av, ingen feil.

**Implementering:**

**E-post via Resend:**
- `lib/platform/notify-email.ts` — `sendWelcomeEmail(tenant)`. Loader `welcome.{no|en}.html` via `fs.readFile`, bytter ut `{{firstName}}` + `{{subdomain}}`. Sender via Resend SDK v4 med `replyTo: support@kodovault.no`.
- **Locale-valg:** `tenant.locale === "en"` → engelsk mal, alt annet (no/sv/da) → norsk mal.
- **Subject:** NO: "Din Ko|Do Vault er klar 🔐" / EN: "Your Ko|Do Vault is ready 🔐"
- **Fra:** `RESEND_FROM_EMAIL` env-var (typisk `vault@kodovault.no` etter DNS-verifisering, ellers `onboarding@resend.dev`)
- **Idempotensesjekk:** `tenant.welcomeEmailSentAt` settes ved suksess. Sendes maks én gang. Re-send via dedikert endpoint.
- **Maler:** HTML-only (table-layout, inline CSS, Outlook-kompatibel). Følger Ko|Do brand (sort #0a0e1a + amber #f5a623).
- **Variabler:** kun `{{firstName}}` og `{{subdomain}}` — minimalt overflate-areal for sikkerhet.

**Telegram:**
- `lib/platform/notify-telegram.ts` — `sendVaultLiveTelegram(tenant)` + `sendProvisioningFailedTelegram({...})`. Direkte fetch mot `api.telegram.org/bot<TOKEN>/sendMessage` med `parse_mode: "HTML"`.
- `notify.ts` (eksisterende failure-varsling) wirer inn `sendProvisioningFailedTelegram` — tidligere bare console.error.
- HTML-escape på alle felter for å unngå Telegram parse-feil ved spesialtegn.

**Datamodell:**
- Nytt felt `welcomeEmailSentAt: string | null` på TenantRecord
- 2 nye stages: `welcome_email_sent`, `telegram_sent`
- Soft migration: eksisterende tenants får `welcomeEmailSentAt: null` ved load

**Wiring (`markVaultLive()`):**
1. Sett `vaultLive=true` + `vaultLiveAt` + emit `vault_live` event (eksisterende)
2. Fire-and-forget: `sendWelcomeEmail(refreshed)` → emit `welcome_email_sent` (ok/failed/skipped)
3. Fire-and-forget: `sendVaultLiveTelegram(refreshed)` → emit `telegram_sent` (ok/failed/skipped)
4. Begge wrappes i try/catch — logging-feil avbryter aldri flyt

**Admin re-send-knapp:**
- `POST /api/admin/tenants/[subdomain]/resend-welcome` — force-sender mail (bypasser idempotens), logger `welcome_email_sent` med `retried`-status
- `ResendWelcomeButton` i TenantDetailCard (ved siden av "Slett tenant")
- Bekreftelse-confirm før send (unngå ved et uhell)
- 6 sek toast med Resend email-id ved suksess

**Env-vars (Vercel produksjon — eksplisitt enable):**
| Variabel | Påkrevd for | Eksempel |
|---|---|---|
| `RESEND_API_KEY` | E-post | `re_...` |
| `RESEND_FROM_EMAIL` | E-post | `vault@kodovault.no` eller `onboarding@resend.dev` |
| `EMAIL_ENABLED` | E-post | `true` (obligatorisk) |
| `TELEGRAM_BOT_TOKEN` | Telegram | `7...:AAH...` |
| `TELEGRAM_CHAT_ID` | Telegram | `-5218791898` (med minus for grupper) |
| `TELEGRAM_ENABLED` | Telegram | `true` (obligatorisk) |

Mangler `*_ENABLED=true` eller credentials → kanal av. Lokal testing fungerer uten produksjonsnøkler.

**Sikkerhet:**
- `/api/admin/tenants/[subdomain]/resend-welcome` beskyttet av admin-cookie-middleware
- Resend `replyTo: support@kodovault.no` — kunde svarer til ekte e-post-adresse
- Mal-variabler er kun `{{firstName}}` + `{{subdomain}}` (begge maks 30 tegn) — ingen HTML-injection-risiko fra brukerinnhold

**Filer:**
- `lib/platform/notify-email.ts` — Resend-integrasjon
- `lib/platform/notify-telegram.ts` — Bot API
- `lib/platform/notify.ts` — wired Telegram i notifyProvisioningFailure
- `lib/platform/email-templates/welcome.no.html` + `welcome.en.html`
- `lib/platform/poll-deployment.ts` — markVaultLive utvidet
- `app/api/admin/tenants/[subdomain]/resend-welcome/route.ts`
- `components/platform/TenantViewer.tsx` — ResendWelcomeButton
- `lib/__tests__/iter10.test.ts` — mal-rendering-tester (10/10)

**Bygger på:** D-063 (failsoft), D-066 (vault_live), D-067 (delt UI-mønster).

**Iter 10.1 (gjenstår):** B2C invitasjonsmail (`/api/admin/invites` for B2C-tenants) — venter på mal.


## D-069: Free-plan er evigvarende — beskyttet mot livssyklus-cron (NY · 2026-06-04)

**Kontekst:**
Mike trenger evigvarende testkontoer + venner/familie-kontoer som ALDRI låses, kanselleres eller slettes automatisk. `plan="free"` finnes allerede i `Plan`-typen, men det er kun en label uten beskyttelse. Når lifecycle-mekanismer kommer (Iter 13+: trial-auto-lock, Stripe payment_failed → cancel, GDPR delete-cron), risikerer free-tenants å bli berørt ved et uhell.

**Beslutning:**

**Hovedregel:** Når `tenant.plan === "free"`:
- Aldri auto-lock (uavhengig av `trialEndsAt`)
- Aldri auto-cancel (selv om Stripe-webhook trigger)
- Aldri auto-delete (selv ved GDPR-cron)
- Kun **manuell** status-endring fra admin-UI er tillatt

**Sekundærregel:** `createdBy === "admin"` → beskyttet mot auto-delete (men kan auto-lockes/cancelleres hvis ikke free-plan). Admin-opprettede tenants skal aldri forsvinne automatisk uten manuell handling.

**Sentral autoritativ helper:**
`lib/platform/lifecycle-guard.ts` eksponerer:
- `canAutoLock(tenant): GuardDecision`
- `canAutoCancel(tenant): GuardDecision`
- `canAutoDelete(tenant): GuardDecision`
- Predicates `isAutoLockable`, `isAutoCancellable`, `isAutoDeletable` for filter-bruk

Alle returnerer `{ allowed, reason }` slik at avvisninger kan logges til `provisioningLog` med human-readable forklaring.

**Bruks-mønster (når lifecycle-cron implementeres):**
```typescript
for (const tenant of allTenants) {
  const decision = canAutoLock(tenant);
  if (!decision.allowed) {
    console.log(`[trial-cron] skip ${tenant.subdomain}: ${decision.reason}`);
    continue;
  }
  // ... auto-lock logikk
}
```

**Status i dag (2026-06-04):**
- Eneste vei til `locked`/`cancelled`/`deleted` er manuell PATCH fra admin via `/api/admin/tenants/[subdomain]`
- Ingen automatiske lifecycle-mekanismer eksisterer ennå (cleanup-pending cron rører kun invitasjoner)
- Free-tenants er i praksis allerede trygge, men D-069 garanterer at de FORTSATT er trygge når lifecycle bygges

**Hva D-069 IKKE blokkerer:**
- Manuell endring av status/plan fra admin-UI — Mike er alltid eier
- `provisioning_failed`-status fra provisjoneringsflyten (det er ikke "lifecycle", det er feilhåndtering)
- Sletting via admin-knapp "Slett tenant"
- Endring fra free til en annen plan (Mike kan deaktivere beskyttelse selv)

**UI-hinter:**
- `CreateTenantModal`: når Mike velger plan=`free` vises emerald info-boks "🛡️ Free-plan (D-069): Evigvarende. Beskyttet mot auto-lock, auto-cancel og auto-delete fra livssyklus-cron."
- `TenantDetailCard`: ved siden av plan-dropdown vises "🛡️ Evigvarende — beskyttet mot livssyklus-cron" når plan=`free`

**Filer:**
- `lib/platform/lifecycle-guard.ts` — sentrale guard-funksjoner
- `lib/__tests__/lifecycle-guard.test.ts` — 12/12 tester (free + admin-opprettet, alle planer, predicates)
- `lib/__tests__/lifecycle-guard-lint.test.ts` — automatisk static analyzer som skanner alle cron/webhook-ruter og krasjer med exit 1 ved brudd. Kjøres som del av pre-commit/CI (D-069 håndhevet automatisk)
- `components/platform/TenantViewer.tsx` — UI-hinter (CreateTenantModal + TenantDetailCard)

**Krav til fremtidige iterasjoner (MÅ-liste):**
Når følgende implementeres, MÅ de bruke `canAutoLock` / `canAutoCancel` / `canAutoDelete`:
- Iter 13: Trial → locked-auto-lock cron
- Iter 13.5: Stripe webhook payment_failed → auto-lock/cancel
- Iter 19: Cancelled → deleted GDPR-cron (90 dager etter cancel)
- Iter 24+: Eventuelle subscription-lifecycle-events

CI/code-review-sjekk: enhver tenant-status-mutation i en cron-rute eller webhook-handler SKAL kalle en `canAuto*`-funksjon før mutation. **Automatisk håndhevet** via `lib/__tests__/lifecycle-guard-lint.test.ts` — skriptet skanner alle filer under `app/api/cron/` og `app/api/webhooks/`, sjekker om de mutater `status: "locked"/"cancelled"/"deleted"` eller `lockedAt`/`cancelledAt`/`deletedAt`, og krever import + bruk av guard-funksjonene. Exit-kode 1 ved brudd → CI/pre-commit feiler.

**Bygger på:** D-038 (Tenant lifecycle states), D-054 (audit-log notes).



## D-070 — Kaskade-sletting av tenant (soft-failure-modell + caller-ansvar) (NY · 2026-06-05)

**Dato:** 2026-06-05
**Status:** Vedtatt

### Kontekst

Når en tenant skal slettes, må seks separate systemer rydde opp etter seg:
1. Vercel-prosjekt
2. Upstash-database (per-tenant)
3. Client-config-blob i sentral Upstash
4. **Stripe customer + alle assosierte subscriptions** (utvidet 2026-06-05, Iter 14.5)
5. TenantRecord-blob + indeks i sentral Upstash
6. B2B-prefiks i `reserved-prefixes` SET (kun for B2B)

Tre forskjellige inngangspunkter trigger sletting:
- **Admin manuelt** — søppelbøtte i list-view eller "Slett tenant"-knapp i detail-view
- **Iter 17 dag-58-cron** — automatisk sletting av tenants som har stått i `cancelled` i 58 dager
- **GDPR-forespørsel** — bruker krever "right to be forgotten"

Spørsmålet: hvordan håndteres partial failure (Vercel-API nede, Upstash-API timeout, nettverk-feil mid-kaskade), og hvem er ansvarlig for D-069 free-plan-beskyttelse?

### Beslutning

**Én funksjon, ett ansvar.** `lib/platform/delete-tenant.ts` eksporterer `deleteTenant(subdomain, context)` som orkestrerer alle 5 systemer. Tre prinsipper:

#### Prinsipp 1: Soft-failure — aldri stopp ved enkeltfeil

Hvert steg er wrappet i sin egen try/catch. En feil i Vercel-DELETE stopper IKKE kaskaden — vi fortsetter til Upstash, client-config, sentral DB osv. Alle feil samles i `errors[]` og returneres i `DeleteResult`. Hvert steg har status `"ok" | "failed" | "skipped"`.

Begrunnelse: alternativt ville én flaky API-feil etterlate tenanten i halv-tilstand (Vercel slettet, Upstash + DB intakt). Det ville krevd manuell opprydding. Med soft-failure rydder vi så mye som mulig på første forsøk, og hvis sentral DB-record overlever kan admin retry-e fra D-055-knappene.

#### Prinsipp 2: Sentral DB slettes SIST — retry-objekt bevares

Rekkefølgen er fastlagt:
1. Append `tenant_deleted`-event til provisioningLog (audit-trail bevares)
2. Vercel
3. Upstash-database
4. Client-config
5. **Stripe customer + subscriptions** (`stripe.customers.del` — Stripe kansellerer subs automatisk; utvidet 2026-06-05 Iter 14.5)
6. **TenantRecord + indeks** (SIST)
7. B2B-prefiks (kun hvis steg 6 lyktes)

Hvis steg 2-4 feiler, har vi fortsatt TenantRecord-en i sentral DB. Admin kan se tenanten i admin-modulen, se `errors[]` i `DeleteResultModal`, og retry-e slettingen. Hvis vi slettet record-en først ville vi mistet referansen til `vercelProjectId` / `upstashDatabaseId` og hatt orphans uten retry-vei.

B2B-prefiks frigjøres KUN hvis sentral DB-slettingen lyktes — ellers risikerer vi at prefikset er ledig mens record-en fortsatt peker på det.

#### Prinsipp 3: Caller-ansvar for D-069 — kaskaden gjør IKKE selv guard-sjekk

Kaskaden er ren infrastruktur. Den sjekker ikke `canAutoDelete()`. Det er **caller** som er ansvarlig for å sjekke D-069 før den kaller kaskaden:

- **Admin-flyt bypasser D-069** — admin har manuell rett til å slette en free-plan-tenant. Det er forventet og ønsket atferd (D-069 beskytter mot AUTO-sletting fra cron, ikke mot eksplisitt admin-handling).
- **Cron-flyt (Iter 17) MÅ kalle `canAutoDelete()`** fra `lib/platform/lifecycle-guard.ts` FØR den kaller `deleteTenant()`. Hvis cron'en hopper over guarden og kaller kaskaden direkte på en free-plan-tenant, vil `yarn lint:d069`-skriptet krasje CI (per D-069).
- **GDPR-flyt bypasser D-069** — bruker har juridisk rett (lex specialis foran free-plan-beskyttelse).

Dette er et bevisst valg: hvis kaskaden selv hadde gjort guard-sjekken, ville den blokkert admin-manuell sletting av free-plan-tenants (uønsket). Hvis den hadde tatt en `bypassGuard: boolean`-parameter, ville den vært lett å misbruke. Caller-ansvar gjør designet eksplisitt og lint-håndhevet.

### Konsekvenser

**Positive:**
- Én funksjon å vedlikeholde for alle 3 inngangspunkter
- Soft-failure betyr at admin alltid har retry-vei
- `DeleteResultModal` viser stegvis status — admin ser nøyaktig hva som feilet
- D-069-håndhevelse fortsatt automatisk via `yarn lint:d069` (cron må importere `canAutoDelete`)
- Idempotent: 404 fra Vercel/Upstash behandles som suksess (allerede borte = målet)

**Negative:**
- Hvis Vercel-API er nede over lang tid, kan en sletting "lykkes" (sentral DB borte) mens Vercel-prosjektet henger igjen som zombie. Mitigering: `errors[]` synliggjør problemet i modalen; admin må følge opp manuelt mot Vercel-konsollen.
- B2B-prefiks frigjøres ikke hvis sentral DB-sletting feiler — det er bevisst valgt, men kan i ekstremtilfelle blokkere registrering av nytt firma med samme prefiks. Akseptert risiko.

**Krav til fremtidige iterasjoner (MÅ-liste):**

Følgende callers SKAL bruke `deleteTenant()` fra `lib/platform/delete-tenant.ts` (ikke `deleteTenantRecord` direkte):
- Iter 17: Dag-58-cron (cancelled → deleted) — MÅ kalle `canAutoDelete()` først
- Eventuell GDPR-endpoint (når den implementeres) — bypasser D-069
- Eventuelle andre admin-flows som sletter tenant

`deleteTenantRecord` (lavnivå, sentral DB only) er reservert for kaskadens interne bruk. Direkte kall fra route-handlere eller cron er en code-smell.

### Filer

**Kaskaden:**
- `lib/platform/delete-tenant.ts` — `deleteTenant(subdomain, context)` + `DeleteResult`-type
- `lib/platform/vercel-provision.ts` — `deleteVercelProject(projectId)`
- `lib/platform/upstash-provision.ts` — `deleteUpstashDatabase(databaseId)`
- `lib/platform/tenant-store.ts` — `deleteTenantRecord(subdomain)` (renamet fra `deleteTenant`)
- `lib/platform/tenant-types.ts` — `"tenant_deleted"` lagt til i `ProvisioningStage`

**Callere (per 2026-06-05):**
- `app/api/admin/tenants/[subdomain]/route.ts` — DELETE-handler (admin-flyt, bypasser D-069)

**UI:**
- `components/platform/TenantViewer.tsx` — `DeleteResultModal` + `onDelete` med `DeleteResult`-parsing

**Tester:**
- `lib/__tests__/delete-tenant.test.ts` — 14 tester (idempotens, type-shape, context-parameter)

**i18n:**
- `lib/locales/{no,sv,da,en}.json` — 14 nye nøkler under `admin_tenants.delete_*`

**Bygger på:** D-038 (B2B-prefiks-håndtering), D-055 (manuell provisjonering — slett er motsats), D-062 (atomisk operasjon med sentral barriere sist), D-069 (lifecycle-guard for auto-flows).

---

### REVISJON 2026-06-13 — Stripe customer-bevaring for revisjonsspor

**Bakgrunn:** Iter 17-planlegging avdekket at `deleteStripeCustomer()` (`lib/stripe/cleanup.ts`) kalte `stripe.customers.del(customerId)` UNNTAKSLØST for alle tenants med ikke-null `stripeCustomerId`. Det er en P0-feil mot norsk bokføringsloven (§ 13: 5 års bevaring av regnskapsmateriale, inkludert kobling mellom faktura og kunde).

Tidligere kommentar i `cleanup.ts` (linje 18-20 før revisjon) hevdet at "Stripe beholder uansett invoice-records selv etter customer.del — bare PII fjernes". Dette stemmer ikke for revisjonsformål: uten customer-objektet mister revisor kobling mellom faktura og kjøper, og Stripe Dashboard viser slettede customers som anonymiserte placeholders.

#### Ny regel (vedtatt)

`stripe.customers.del()` kalles **KUN** for tenants som ALDRI har hatt en betalt transaksjon. Betalte tenants får sitt customer-objekt **bevart** hos Stripe — TenantRecord slettes hos oss som vanlig, men Stripe-objektet lever videre frikoblet med `metadata.subdomain` som "ghost reference" (fortsatt søkbart i Stripe Dashboard for revisjon).

#### Markører for "har betalt"

OR-relasjon:
1. **PRIMÆR** — `tenant.stripeSubscriptionId !== null`
   - Autoritativt felt satt av webhook `customer.subscription.created` (Iter 13)
   - Brukes også av D-076 write-block
   - Nulles aldri i nåværende kode (verifisert 2026-06-13)
2. **DEFENSIV** — `provisioningLog` inneholder `status_change`-event med `detail` som starter med `"invoice.paid"`
   - Fanger edge cases der `stripeSubscriptionId` av en grunn er borte (manuell admin-override, fremtidig migrasjon)
   - Skrevet av `handleInvoicePaid` i `lib/stripe/event-handlers.ts`

#### Ny status-verdi: `"preserved"`

`DeleteStepStatus` utvidet med `"preserved"`:
- `"ok"`         — customer faktisk slettet hos Stripe
- `"preserved"`  — customer bevart per denne regelen (D-070-revisjon)
- `"skipped"`    — ingen stripeCustomerId å forholde seg til (ren trial som aldri opprettet customer hos Stripe)
- `"failed"`     — Stripe API-feil

`"preserved"` skiller seg fra `"skipped"`: førstnevnte er en AKTIV, bevisst beslutning loggført i admin-UI som amber badge; sistnevnte betyr "ingenting å gjøre fra start av".

#### Audit-spor

Når `"preserved"` returneres appender kaskaden et eksplisitt event til `provisioningLog` rett før sletting (`stage: "tenant_deleted"`, detail prefikser med "Stripe customer X BEVART (D-070): ..."). Audit-loggen slettes med tenant-recorden, men er synlig i en fremtidig anonymisert audit-tabell (ROADMAP-post).

#### API-endring

`deleteStripeCustomer(customerId, options)` — opsjonen `{ hasPaidHistory: boolean }` er **påkrevd** (ikke valgfri). Eksportert helper `tenantHasPaidHistory(tenant)` brukt av kallsiden.

#### Filer endret

- `lib/stripe/cleanup.ts` — ny signatur + `tenantHasPaidHistory`-helper + "preserved"-gren
- `lib/platform/delete-tenant.ts` — kallside beregner `hasPaidHistory` og logger `"preserved"`-event
- `components/platform/TenantViewer.tsx` — `DeleteStepBadge` har ny `preserved`-farge (amber) + label
- `lib/locales/{no,en,da,sv}.json` — `admin_tenants.delete_step_preserved`-nøkkel

---

### TILLEGG 2026-06-13 — Iter 17 full mail-pakke + spor B-konvergering

**Bakgrunn:** Etter Iter 17 cron-implementasjon avdekket vi at `handleSubscriptionDeleted` satte `status="cancelled"` mens cron-en kun behandlet `status="locked"`. Konsekvens: kansellerte betalende kunder ble fanget i en `"cancelled"`-limbo — fikk aldri WARN_T7/T3/T1-varsler eller hard delete på dag 28. Dataene ville lagt i Upstash for alltid.

**Endring i `handleSubscriptionDeleted`:**

Webhook setter nå `status="locked"` + `lockedAt=now` + behold `cancelledAt=now` som "hvorfor"-spor. Spor A (trial-utløp) og spor B (kansellering) konvergerer dermed til samme lifecycle-tilstand etter lock, og samme cron-mekanisme håndterer begge på 28-dagers vindu.

**Bevart `cancelled`-status:** TenantStatus-enum'en beholder `"cancelled"` som type for admin manuell overstyring og fremtidig backlog (anonymisert audit-tabell, se ROADMAP). Men i normal kanselleringsflyt brukes den ikke lenger automatisk.

**Konsekvens for D-076 (write-block):** Ingen — cache'en sjekker fortsatt `status === "locked"`. Spor B-tenants får automatisk samme write-block-oppførsel.

**Konsekvens for SettingsPanel/PaywallOverlay:** Begge sjekker `status === "locked"` for å vise paywall + write-block-UI. Spor B-tenants får samme UX som spor A-tenants etter lock.

**Skille mellom sporene i UI/mail:** `tenant.cancelledAt !== null` brukes som diskriminator. Brukt av `sendLifecycleWarning` til å velge `reasonText`-variabel ("Prøveperioden utløp..." vs "Abonnementet ditt ble kansellert...").

**Nye mail-maler (Iter 17 full pakke, 2026-06-13):**
- `trial-reminder-t5.{no,en}.html` (A1) — sendes 5 dager før trial-utløp (cron WARN_TRIAL_T5)
- `locked-from-trial.{no,en}.html` (A2) — etter LOCK fra cron (spor A)
- `locked-from-cancel.{no,en}.html` (B1) — etter LOCK fra webhook (spor B)
- `deleted-confirmation.{no,en}.html` (A4/B3) — felles for begge spor, sendes RETT FØR `deleteTenant()` for å bevare mottakeradresse
- `lifecycle-warning.{no,en}.html` (A3) — ÉN generisk varsel på dag 21 etter lock (= 7 dager før hard delete). Bruker `{{reasonText}}`-variabel som settes ulikt basert på `cancelledAt`-flagget (trial-utløp vs kansellering)

**Endelig vedtak om varselskadens (2026-06-13):** A3 sendes ÉN gang per tenant per lock-event (dag 21). Tidligere foreslåtte T-7/T-3/T-1-kadens er forkastet — det skapte spam-følelse uten klar verdiøkning. `LifecycleAction.WARN_A3` er eneste lifecycle-warning-action i `decideAction()`.

**Nye idempotens-felter på TenantRecord:**
- `trialReminderT5SentAt: string | null`
- `lockedNotificationSentAt: string | null` (felles A2/B1)
- `deletedNotificationSentAt: string | null` (skrives FØR sletting for å unngå dobbel-send ved cron-replay)
- `lifecycleWarningsSentAt: { t7: string \| null; t3: string \| null; t1: string \| null }` — kun `.t7` brukes etter endelig vedtak; `.t3`/`.t1` beholdes på schema for backwards-compat men er alltid null

---

## D-071 — Tenant-prosjekter rewriter `/api/billing/*` til admin (sentral-creds-isolasjon)

**Status:** Vedtatt 2026-06-08
**Forfatter:** Mike
**Erstatter:** ingen

### Kontekst
Iter 13.7 leverte `/billing/upgrade`-siden + `<CheckoutChoice>`-komponenten + `/api/billing/checkout-info` (Iter 13.5). Disse må kjøre på tenant-subdomenet (D-046: host-basert identitet).

Da Mike testet på testkonto.kodovault.no fikk han **HTTP 500 med tom body**. Roten: tenant Vercel-prosjekter mangler sentrale credentials (CENTRAL_KV_REST_API_URL/TOKEN, CENTRAL_ENCRYPTION_KEY, STRIPE_SECRET_KEY/PRICE_*). Endepunktene krasjer ved init av Upstash- og Stripe-klienter.

### Alternativer vurdert
- **A — Kopier sentral-creds til alle tenant-prosjekter:** Bryter isolasjons-prinsippet — N tenant-deploys får tilgang til sentral data.
- **B — Tenant rewriter `/api/billing/*` til admin:** Sentral-creds isoleres på admin. Næste-host bevares via `x-forwarded-host`.
- **C — Flytt `/billing/upgrade` til admin med `?sub=`-query:** Bryter D-046 (host = identitet).

### Beslutning
**B**. Sentral-credentials (Stripe, sentral Upstash, encryption-key) skal kun finnes på admin-prosjektet. Tenant-prosjekter rewriter `/api/billing/*` til admin via Next.js `rewrites()` i `next.config.mjs`.

### Mekanikk (revidert 2026-06-08 etter live-test)
- Aktiveres når `process.env.NEXT_PUBLIC_CLIENT_CONFIG` er satt (= tenant-deploy).
- Rewriter `source: /api/billing/:path*` → `destination: ${NEXT_PUBLIC_ADMIN_ORIGIN}/api/billing/:path*?_tenant=${TENANT_SUBDOMAIN}`.
- Default destination: `https://admin.kodovault.no`. Kan overstyres via env-var.
- **VIKTIG:** Vercel overskriver `x-forwarded-host` til rewrite-destination ved external rewrite — vi kan IKKE stole på den for subdomain. I stedet appenderes `?_tenant=<subdomain>` til destination-URL. Tenant-prosjektet kjenner sin egen subdomain via `NEXT_PUBLIC_CLIENT_CONFIG` ved build-time. Query-params bevares pålitelig gjennom Vercel-proxyen.
- Alle billing-endepunkter leser `?_tenant=<sub>` FØRST, faller tilbake til `host`-header for direkte admin-kall (UI på admin.kodovault.no, testing via curl).

### Påvirkede filer
- `next.config.mjs` — conditional rewrite med `?_tenant=`-suffix
- `app/api/billing/checkout-info/route.ts` — leser `_tenant`-query FØRST, så host
- `app/api/billing/create-checkout/route.ts` — samme + baseUrl beregnes fra tenant.subdomain (ikke fra request)
- `lib/__tests__/iter13-5-checkout-info.test.ts` — Test 13/14 bekrefter prioritet
- `lib/__tests__/isolation-lint.test.ts` — statisk håndhevelse (yarn lint:isolation)

### Statisk håndhevelse
`yarn lint:isolation` skanner alle `/api/`-ruter for sentral-creds-imports og krever at de er i godkjent bucket. Brudd = exit 1, blokkerer build hvis kjørt i CI.

**Godkjente buckets:**
`/api/admin/*` · `/api/billing/*` · `/api/cron/*` · `/api/webhook/` · `/api/webhooks/*` · `/api/register/*` · `/api/invite/*` · `/api/client-config/`

Hvis en ny rute legitimt trenger sentral-creds utenfor disse → utvid `APPROVED_BUCKETS` i `lib/__tests__/isolation-lint.test.ts` OG oppdater denne D-071 med begrunnelse.

### Lærdom (kritisk fallgruve — oppdaget 2026-06-08)
**Bug:** Initielt brukte vi array-form av `rewrites()` i `next.config.mjs`:
```js
async rewrites() { return [{ source, destination }]; }
```
Det er Next.js sin `afterFiles`-modus — rewriten firer **KUN** hvis ingen route-fil matcher først.

**Hvorfor brøt det:** Per D-018 har tenant-prosjekter og admin samme kodebase. Det betyr at filen `app/api/billing/checkout-info/route.ts` finnes fysisk på **alle** deploys, også tenant. Når en request kom inn på `testkonto.kodovault.no/api/billing/checkout-info`, vant route-fila → rewriten ble aldri vurdert → lokal function kjørte uten sentral-creds → HTTP 500.

**Fix:** Bruk `beforeFiles`-modus:
```js
async rewrites() {
  return { beforeFiles: [{ source, destination }] };
}
```
`beforeFiles` firer ALLTID før route-matching, så proxyen vinner over lokale route-filer.

**Regel for fremtidige rewrites i kodebasen:** Når en rute skal proxyes til ekstern destinasjon OG samme rute eksisterer fysisk i kodebasen → bruk **alltid** `beforeFiles`. Aldri array-form.

### Begrensning
Kun `/api/billing/*` rewrites. Hvis Iter 19 (paywall) eller andre senere flows trenger andre endepunkter på sentral-creds, må de eksplisitt legges til. Stripe webhook (`/api/webhook`) treffer kun admin.kodovault.no per Stripe Dashboard-konfig — ingen rewrite trengs.

### Bygger på
- D-046 (host som identitet)
- D-018 (per-tenant Vercel-prosjekt)
- D-049 (JIT-Stripe-customer i sentral DB)

---

## D-072 — Stripe idempotency-keys må inkludere `tenantCreatedAt` (NY · 2026-06-08)

### Problem
Original `createCustomerJIT`-implementasjon brukte `idempotencyKey: customer-<subdomain>`. Det fungerte for retries innen samme registrering, men brøt sammen i to scenarier:

1. **Slett-og-re-opprett samme subdomain.** Stripe cacher idempotency-replays i 24t — selv etter at customer-en er slettet manuelt i Stripe-dashboardet. Når bruker re-registrerte `hansen` med endret e-post/navn, kastet Stripe `IdempotencyError: "Keys for idempotent requests can only be used with the same parameters they were first used with."`
2. **Tverr-rute baseUrl-divergens.** `/api/register/paid` og `/api/billing/create-checkout` brukte ulike `baseUrl`-konstruksjoner ved opprettelse av Stripe-sessions for samme subdomain, så idempotency-keyen feilet på param-mismatch når brukeren resumte fra registrering.

### Beslutning
**Alle Stripe idempotency-keys MÅ inkludere `tenantCreatedAt`** (ISO-string fra `TenantRecord.createdAt`). Hver tenant-instans får dermed unik nøkkel selv om subdomain er gjenbrukt.

Konkret format:
- Customer: `customer-<subdomain>-<tenantCreatedAt>`
- Checkout-session: `checkout-<subdomain>-<plan>-<tenantCreatedAt>` *(framtidig — ikke implementert per 2026-06-08)*

### Konsekvens
- Re-opprettet subdomain får ny customer i Stripe (gamle abandoned customers lever videre — per Mike's beslutning 2026-06-07 om at cascade-delete håndterer rydding senere)
- Retries innen samme tenant-instans (samme `createdAt`) bevarer idempotency-fordelen — Stripe replay-er sessionen som forventet
- Cross-route-konsistens: så lenge `baseUrl` matcher (D-072 forutsetter at samme tenant-instans bruker samme baseUrl), er idempotency garantert riktig

### Sammenhørende fix (samtidig)
`/api/billing/create-checkout` `baseUrl` ble dynamisk basert på scenario:
- Scenario A/B (status: trial/locked): `https://<sub>.kodovault.no` (tenant-domain — bruker er allerede inne i vaulten)
- Scenario C (status: pending): request-origin (admin-domain — bruker er på `/platform/register`)

Dette sikrer at `success_url`/`cancel_url` peker til riktig domene OG at idempotency-params matcher tidligere kall.

### Bygger på
- D-049 (JIT-Stripe-customer)
- D-071 (sentral-creds-isolasjon — billing-rutene proxyes til admin)

### Ikke-implementert (framlagt for senere)
- Idempotency-key for `checkout-session.create` inkluderer ennå ikke `tenantCreatedAt` — kun for `customer.create`. Hvis vi senere ser samme `IdempotencyError` på sessions, må vi utvide til `checkout-<sub>-<plan>-<tenantCreatedAt>`.

---

## D-075 — Lifecycle-tidslinje for locked-kontoer (NY · 2026-06-13)

### Beslutning
**Forenklet lifecycle uten egen `cancelled`-status:**

```
day 0           : tenant opprettes, status=trial, trialEndsAt = createdAt + trialDays
day 25 (default): trial-warning-mail "5 dager til prøveperioden utløper"
day 30 (default): status → "locked", lockedAt settes, "Vaulten er låst"-mail
day 51 (default): "Sletter om 7 dager"-mail (siste varsel)
day 58 (default): deleteTenant() (D-070 kaskade) + "Vaulten er slettet"-mail
```

`status: "cancelled"` brukes IKKE i den cron-drevne lifecycle-flyten. Den forblir på enum-en for admin manuell overstyring og fremtidig anonymisert audit-tabell (ROADMAP). Stripe-webhook (`subscription.deleted`) konvergerer nå til `status="locked"` + `cancelledAt=now` per TILLEGG 2026-06-13 — se nedenfor.

### Konfigurerbare verdier (lifecycle-block i `default.json`)
```json
"lifecycle": {
  "trialDays": 30,
  "trialWarningDaysBefore": 5,
  "lockToDeleteDays": 28,
  "deleteWarningDaysBefore": 7
}
```

### Cron-veier (Iter 17 — implementert 2026-06-13)
- `trialEndsAt - trialWarningDaysBefore` (dag 25) → **A1** trial-T5-reminder-mail (mens trial)
- `trialEndsAt` (dag 30) → status="locked" + **A2** locked-from-trial-mail
- `lockedAt + 21` (dag 51) → **A3** "Sletter om 7 dager"-mail (ÉN gang, eneste varsel)
- `lockedAt + lockToDeleteDays` (dag 58) → **A4** "Slettet"-mail + `deleteTenant()` (D-070)

Webhook-vei (Iter 17 spor B):
- `customer.subscription.deleted` → status="locked" + cancelledAt + **B1** locked-from-cancel-mail
- Deretter konvergerer med spor A: cron sender A3 på `lockedAt + 21`, A4 + delete på `lockedAt + 28`

**Endelig vedtak 2026-06-13:** kun ÉN A3-varsel per tenant per lock-event. Tidligere T-7/T-3/T-1-kadens er forkastet — én forsvarlig varslingstid (7 dager) uten å spamme.

### Eksplisitt fjernet fra spec
- **Dag 37 (ren purring 7 dager etter lock)** — ingen statusendring, droppet
- **Dag 44 (ren purring 14 dager etter lock)** — ingen statusendring, droppet
- Vi sender kun e-poster ved faktiske statusendringer eller "siste varsel før destruktiv handling"-trigger.

### Konsekvens for Iter 19 (paywall)
Paywall viser retention-dato beregnet som `lockedAt + lockToDeleteDays` lest fra config. Hvis config-verdiene endres senere, oppdateres datoen automatisk for alle locked-tenants.

### Bygger på
- D-068 (lifecycle-grunnmønster: locked/cancelled/deleted)
- D-069 (canAuto*-guards på destruktive cron-handlinger)
- D-070 (kaskade-sletting)

---

## D-076 — Paywall write-block via cache-sync (NY · 2026-06-13)

### Problem
Iter 19 paywall er ikke nok som UI-only gate. Teknisk bruker kan omgå paywall ved direkte API-kall mot `PUT /api/vault`, `PUT /api/cards` osv. Vault-data-writes må håndheves server-side når `status === "locked"`.

### Begrensning
`tenant.status` lever på **CENTRAL Upstash** (admin). Tenant-podens Upstash-credentials (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) er kun injisert i tenant-Vercel-prosjektet av Upstash Marketplace. Admin kan ikke direkte skrive til tenant-Upstash uten å sentralisere tenant-creds — i strid med D-018/D-071-isolasjon.

### Beslutning
**Pull-baseret cache-sync med TTL.** Tenant-poden:
1. Cacher `{ status, lockedAt }` i lokal Upstash under nøkkel `tenant:status:cache` med TTL 5 min
2. Ved write-rute: les cache. Hvis miss → fetch fra admin via signert RPC, populer cache, fortsett.
3. Hvis `status` ∈ `{ "locked", "cancelled", "deleted" }` → respond 403 før noe Upstash-write skjer.

### Akseptert risiko
Sync-vindu på maks 5 min mellom Stripe-webhook og write-block. Etter `trialEndsAt` kan en teknisk bruker fortsatt skrive i opptil 5 min etter lock-trigger. Mike's eksplisitte vurdering: akseptabel for SaaS-skala, paywall'en gir tydelig UX-signal umiddelbart.

### Komponenter

**Admin-side: `GET /api/internal/tenant-status?sub=X`** (ny)
- Returnerer kun `{ status, lockedAt }` — ingen sensitive felter
- Beskyttet med `Authorization: Bearer ${INTERNAL_RPC_SECRET}` (delt env-var)
- Lever på admin-domain, leser central Upstash via eksisterende `getTenant()`

**Tenant-pod-side: `lib/server/tenant-status-cache.ts`** (ny)
- `getTenantStatus(subdomain): Promise<{status, lockedAt}>` — cache + RPC-fallback
- `assertTenantNotLocked(subdomain)` — throws `TenantLockedError` hvis locked/cancelled/deleted

**Write-ruter som må kalle `assertTenantNotLocked` før hver write:**
- `PUT /api/vault`, `DELETE /api/vault`
- `PUT /api/cards`, `DELETE /api/cards`
- `PUT /api/ids`, `DELETE /api/ids`
- `POST /api/invite/accept`

### Env-var-propagering ved provisjonering
`provisionTenantOnVercel` propagerer automatisk `INTERNAL_RPC_SECRET` fra admin sin egen `process.env` til nye tenant-Vercel-prosjekter (i tillegg til de eksisterende `NEXT_PUBLIC_CLIENT_CONFIG` + `KV_REST_API_URL/TOKEN`). Provisjonering FAILER med tydelig feil hvis admin mangler hemmeligheten — vi vil ikke ende med tenants som stille fail-open'er.

**Eksisterende tenants** (provisjonert før D-076-deploy) må ENTEN:
1. Re-provisjoneres via `/api/admin/tenants/[sub]/provision-vercel` (re-kjører setProjectEnvVars med oppdatert liste), ELLER
2. Manuelt legge `INTERNAL_RPC_SECRET` i sitt Vercel-prosjekts env-vars

Inntil dette er gjort vil tenant-podens write-block stille fail-open'e (warning logget i Vercel function-logs).

### Status-confidentiality
Mike's spec: "ingen status-respons til uautentiserte". `GET /api/billing/checkout-info` røper status uten unlock. Per D-046 er subdomain = identitet, så enhver request fra `<sub>.kodovault.no` regnes som "fra den brukeren". Vi legger ikke på master-password-auth foran status-endepunkter nå (uoverkommelig scope-økning), men markerer det som **D-076.1 (framlagt for senere)**:

- Status-respons skal kun gis etter at klient har bevist kjennskap til master-password (f.eks. ved å sende en signed challenge fra unlock-flyten)
- Dette krever en server-side autorisasjonsmekanisme som per dato ikke eksisterer

### Bygger på
- D-046 (host = identitet)
- D-018 (tenant-isolasjon i egne Vercel-prosjekt)
- D-071 (sentral-creds-isolasjon)

### Ikke-implementert (framlagt for senere — D-076.1)
- Master-password-bevist autorisasjon foran status-endepunkter (status-confidentiality før unlock)

---

## D-077 — Tenant env-var manifest med lint-håndhevelse (NY · 2026-06-13)

### Problem
D-076 la til en ny env-var (`INTERNAL_RPC_SECRET`) som tenant-pods trenger. `provisionTenantOnVercel` ble manuelt utvidet til å propagere den. Men det er ingen automatisk sjekk som fanger fremtidige tilfeller hvor en utvikler:
- Legger til `process.env.NEW_VAR` i tenant-pod-kode
- Glemmer å oppdatere `setProjectEnvVars`-kallet
- Nye tenants provisjoneres uten varen → stille krasj eller fail-open ved første invocation

D-071 har lint:isolation som håndhever det motsatte (sentral-creds-imports kun i godkjente buckets). D-077 er det manglende paritetet for env-vars.

### Beslutning
**Single source of truth:** `lib/platform/tenant-env-manifest.ts` — to lister:
- `perTenant`: unike verdier per tenant (settes med tenant-spesifikke data ved provisjonering)
- `sharedFromAdmin`: felles verdier propagert fra admin sin `process.env`

`provisionTenantOnVercel` itererer over manifestet i `setProjectEnvVars`-kallet. Provisjonering FAILER hardt hvis admin mangler en `sharedFromAdmin`-verdi.

### Lint-håndhevelse: `yarn lint:tenant-env`
For hver `process.env.X` brukt i server-side tenant-pod-kode (alt utenfor sentral-buckets per D-071, dvs. `/app/api/*` minus admin/billing/cron/webhook/register/invite/client-config/internal, samt `/lib/server/*`):

1. ER `X` i manifestet → ✓
2. ELLER har bruken default-fallback (`??`, `||`, `?`-operator) → ✓
3. ELLER er `X` i platform-whitelist (`NODE_ENV`, `VERCEL_*`, osv.) → ✓

Hvis ingen av disse → BRUDD, exit-kode 1.

I tillegg sjekker lint at `vercel-provision.ts` faktisk leser fra manifestet (regresjons-vakt mot at noen splitter koden fra manifestet).

### Skopebegrensning
Lint skanner kun server-side kjøretid-kode (`app/api/*`, `lib/server/*`). Frontend pages (`app/*.tsx`) ekskluderes fordi `NEXT_PUBLIC_*`-vars er build-time embedded — de håndteres separat hvis behov oppstår (D-077.1 framlagt).

### Konsekvens for arbeidsflyt
- Nytt yarn-skript: `yarn lint:tenant-env`
- Aggregert: `yarn lint:all` = d069 + isolation + tenant-env
- Skal kjøres før hver feature-finish, samme som de to andre

### Bygger på
- D-018 (per-tenant Vercel-prosjekt)
- D-071 (sentral-creds-isolasjon — lint:isolation)
- D-076 (write-block — første bruker av sharedFromAdmin)

### Ikke-implementert (framlagt for senere — D-077.1)
- Lint av `NEXT_PUBLIC_*`-vars i frontend pages. Build-time-vars har annen feilmodus enn runtime, krever annen lint-strategi.



---

## Sjekk-mal for feature-dekning på tvers av flyter (NY · 2026-06-25)

**Status:** Konvensjon (ikke en arkitektur-beslutning per se). Skrevet etter Iter 19.9.8 hvor `LocaleRadioGroup` ble lansert i Iter 19.9 for selvbetjent registrering + invite, men IKKE i de to admin-flytene `Opprett ny tenant` + `Send betalingslink`. Resultat: nye tenants opprettet av admin fikk `locale = null` for evig → lifecycle-mailer falt tilbake til norsk. Bug ble oppdaget av Mike 12 dager etter Iter 19.9-leveransen.

### Hva vi gjør fra og med nå

Når en obligatorisk feature lanseres som påvirker dataflyt på tvers av flere "entry-points" (registrering, invite, admin-create, payment-link, etc.), legg ved en kort dekningsmatrise i changelogen for den iterasjonen. Maks 5-10 linjer. Eksempel-mal under.

Matrisen er ikke en byråkratisk øvelse — den finnes så fork-agenter og fremtidige mennesker har én sentral oversikt over "hvor er denne feature'n implementert?" når regressjon oppdages.

### Mal — kopier og fyll ut per ny obligatorisk feature

```
### Feature-dekning: <Feature-navn> (<Iter X.Y>)

| Entry-point                  | Komponent / fil                                      | Status |
|------------------------------|------------------------------------------------------|--------|
| Selvbetjent registrering     | `app/platform/register/page.tsx` + `useXyzForm`      | ✅     |
| Invite-akseptering           | `app/invite/page.tsx`                                | ✅     |
| Admin-create (TenantViewer)  | `components/platform/TenantViewer.tsx` create-modal  | ✅/❌  |
| Send betalingslink           | `components/platform/PaymentLinkModal.tsx`           | ✅/❌  |
| Backend-API (kanonisk)       | `app/api/<route>/route.ts`                           | ✅     |
| Lifecycle-trigger (Telegram/ | `lib/lifecycle/...` (hvis applicable)                | ✅     |
| epost)                       |                                                       |        |

**Regression-risiko:** Hvis matrisen viser ❌ i én rad — dokumenter HVORFOR det er bevisst valgt eller LAG en TODO for å fikse det. Tom rad = ikke vurdert = bug-risiko.
```

### Første eksempel — `LocaleRadioGroup` (Iter 19.9 + 19.9.8)

| Entry-point                                  | Komponent / fil                                                         | Status |
|----------------------------------------------|-------------------------------------------------------------------------|--------|
| Selvbetjent registrering (B2C trial + paid)  | `app/platform/register/page.tsx`                                        | ✅ Iter 19.9 |
| Invite-akseptering (B2B)                     | `app/invite/page.tsx`                                                   | ✅ Iter 19.9 |
| Admin-create (TenantViewer)                  | `components/platform/TenantViewer.tsx` → `CreateTenantModal`            | ✅ Iter 19.9.8 (regression-fix) |
| Send betalingslink (admin)                   | `components/platform/PaymentLinkModal.tsx`                              | ✅ Iter 19.9.8 (regression-fix) |
| Backend-API kanonisk                         | `app/api/register/route.ts`, `app/api/register/paid/route.ts`, `app/api/invite/accept/route.ts` | ✅ Iter 19.9 |
| Backend-API admin                            | `app/api/admin/tenants/route.ts`, `app/api/admin/create-payment-link/route.ts` | ✅ Iter 19.9.8 |
| Server-side whitelist (defense-in-depth)     | Alle 6 ruter over                                                        | ✅ Iter 19.9.8 |

**Regression-risiko nå:** ✅ Lukket. Alle flyter som oppretter en tenant går nå gjennom obligatorisk locale-valg.

### Når bruke malen?

- Når feature endrer skjema/payload (nye obligatoriske felter, ny validering)
- Når feature påvirker mer enn én UI-flow
- Når feature har sikkerhets-/personvern-implikasjoner (audit, opt-in, samtykke)

### Når IKKE bruke malen?

- Rene UI-polish-endringer (knapp-farge, spacing, ikoner)
- Rent intern refaktoring uten endret atferd
- Single-flow features (én rute, én komponent, ingen alternative entry-points)



---

## Retro-pass — Coverage-matriser for eksisterende kryssflyt-features (NY · 2026-06-25)

**Bakgrunn:** Etter at sjekk-malen ble etablert (seksjonen over), kjørte vi et retro-pass på de viktigste cross-flow-feature'ene som allerede er i prod. Målet: ha én sentral oversikt over "hvor er feature X implementert?" når regression oppdages — slik vi gjorde med Iter 19.9.8 for `LocaleRadioGroup`. Matrisene under skal vedlikeholdes når flyter endres.

### Matrise 2 — GDPR konto-/tenant-sletting (D-070 kaskade)

| Entry-point                                      | Komponent / fil                                                  | Status |
|--------------------------------------------------|------------------------------------------------------------------|--------|
| Selvbetjent (SettingsPanel → Farlig sone)        | `components/DeleteAccountDialog.tsx` → `app/api/account/delete/route.ts` | ✅ |
| Admin (TenantViewer → "Slett tenant"-knapp)      | `components/platform/TenantViewer.tsx` → `app/api/admin/tenants/[subdomain]/route.ts` DELETE | ✅ |
| Cron — pending tenants (TTL utløpt)              | `app/api/cron/cleanup-pending-tenants/route.ts`                  | ✅ |
| Cron — lifecycle deleted-purge (locked-tenants)  | `app/api/cron/lifecycle-sweep/route.ts`                          | ✅ |
| Avbryt registrering (pre-paid trial cancellation)| `app/api/register/cancel/route.ts`                               | ✅ |
| Kaskade-handler (Vercel + Upstash + sentral DB)  | `lib/platform/delete-tenant.ts` (`deleteTenant()`)               | ✅ |
| GDPR-bekreftelses-mail (deleted_confirmation)    | `lib/platform/notify-email.ts` → `sendDeletedConfirmation*`      | ✅ |
| B2B parent-tenant guard (D-038)                  | `app/api/admin/tenants/[subdomain]/route.ts` DELETE              | ✅ |

**Regression-risiko:** ✅ Lukket. Alle 4 trigger-veier (selvbetjent, admin, cron-pending, cron-lifecycle) går gjennom samme `deleteTenant()` soft-failure-modell.

### Matrise 3 — Lifecycle-mailer (D-068 + Iter 19.9 NO/SV/DA/EN)

| Trigger                                          | Sender                                                   | Locale-håndtering | Status |
|--------------------------------------------------|----------------------------------------------------------|---|---|
| Welcome (vault_live=true)                        | `lib/platform/poll-deployment.ts` → `sendWelcomeEmail`   | `tenant.locale` → `resolveLocale` fallback | ✅ |
| Admin-manuell resend-welcome                     | `app/api/admin/tenants/[subdomain]/resend-welcome/route.ts` | samme | ✅ |
| Trial-påminnelse T-5 (5 dager før utløp)         | cron + `sendTrialReminderT5`                             | samme | ✅ |
| Lifecycle T-7 / T-3 / T-1 (advarsel før lock)    | `app/api/cron/lifecycle-sweep/route.ts` + `sendLifecycleWarning` | samme | ✅ |
| Locked-notification (når lock skjer)             | cron + `sendLockedNotification` (i notify-email.ts)      | samme | ✅ |
| Cancelled-confirmation (Stripe webhook)          | `app/api/webhooks/stripe/route.ts` (cancel-flyt)         | samme | ✅ |
| Deleted-confirmation (GDPR / auto-purge)         | `sendDeletedConfirmation` + `sendDeletedConfirmationFromSnapshot` | samme + snapshot for slettede records | ✅ |
| Admin test-trigger (testkjøring av enhver mail)  | `app/api/admin/test-lifecycle-mail/route.ts`             | locale-override via query-param | ✅ |

**Regression-risiko:** ✅ Lukket etter Iter 19.9.8. Alle 7 lifecycle-mail-typer respekterer `tenant.locale` med NO som fallback hvis null. Iter 19.9.8 fikset siste hull (locale-null fra admin-create).

**Test-coverage:** `lib/__tests__/mail-test-locale-override.test.ts` verifiserer locale-override-mekanismen.

### Matrise 4 — zxcvbn passord-styrke-validering (Iter 19.9.4 + 19.9.5)

| Entry-point (passord opprettes/endres)           | Komponent / fil                                | Strength gating |
|--------------------------------------------------|------------------------------------------------|------------------|
| Initial vault-setup (master-passord)             | `components/MasterPasswordSetup.tsx`           | ✅ score<2 blokkerer submit |
| Bytte master-passord (SettingsPanel → Sikkerhet) | `components/ChangeMasterDialog.tsx`            | ✅ score<2 blokkerer submit |
| PasswordLab (interaktiv test-generator)          | `components/PasswordLab.tsx`                   | ⚪ Vis-bar, ingen gating (frivillig test-tool) |
| EntryModal (passord per oppføring i vault)       | `components/EntryModal.tsx` (via `<PasswordLab>` overlay) | ⚪ Indirekte via lab — entry-pwds er bruker-valgte hemmeligheter, ikke master |
| Server-side check ved register/invite-flyt       | `app/api/register/*`                            | 🚫 **N/A — zero-knowledge by design** (se ADR-notis under) |

**ADR-notis (2026-06-25):** Server-side zxcvbn-validering ved registrering er **arkitektonisk umulig** og skal IKKE forsøkes implementert. Master-passordet forlater aldri nettleseren — det brukes klient-side til å derivere AES-GCM-nøkler, og kun krypterte blober lagres senere på tenant-Upstash. Eneste meningsfulle validerings-plass er klient-side gating i `app/platform/register/page.tsx`. Hvis en framtidig agent foreslår "server-side zxcvbn", er det basert på en misforståelse av zero-knowledge-arkitekturen — bekreft med Mike før noe endres her. Zero-knowledge er ikke til forhandling (Mike 2026-06-25).

**Regression-risiko:** ✅ Lukket. Klient-side gating + zero-knowledge-design er den korrekte og fullstendige løsningen for denne feature'n. Curl-bypass av klient-side er en konsekvens av zero-knowledge (server kan ikke håndheve det den ikke kan se), ikke en bug. Brukere som curler svake master-pwd skader kun seg selv.

### Matrise 5 — Stripe checkout-state / billing-UI (Iter 13.5 + 19.5 + 19.7)

| Entry-point (leser billing-state)                | Komponent / fil                                  | Status |
|--------------------------------------------------|--------------------------------------------------|--------|
| SettingsPanel Fane 4 (Backup & Admin)            | `components/settings/BackupAdminTab.tsx`         | ✅ Iter 19.9.2 (`computeCta` på plan+hasStripeCustomer) |
| Subscription-info-card (live Stripe-detaljer)    | `components/SubscriptionInfoCard.tsx`            | ✅ Iter 19.7 |
| Paywall-overlay (når status=locked/trial-expired)| `components/PaywallOverlay.tsx`                  | ✅ Iter 19.5 |
| Upgrade-banner (i header på trial)               | `components/UpgradeBanner.tsx`                   | ✅ |
| Register-side (B2C trial → paid flyt)            | `app/platform/register/page.tsx`                 | ✅ |
| Upgrade-page (trial → activate)                  | `app/billing/upgrade/page.tsx`                   | ✅ |
| Stripe Portal redirect                           | `app/api/billing/portal/route.ts`                | ✅ |
| Webhook (state-mutering ved betaling/cancel)     | `app/api/webhooks/stripe/route.ts`               | ✅ |
| Test-coverage                                    | `lib/__tests__/iter13-5-checkout-info.test.ts`   | ✅ |

**Regression-risiko:** ✅ Lukket. Alle billing-UI-leserne går gjennom samme `/api/billing/checkout-info`-endepunkt (kanonisk leser). Endrer Stripe-state via webhook → alle leserne ser samme oppdaterte verdi.

**Note:** Iter 19.9.2 fanget en bug der trial-tenants uten Stripe-customer fikk "no_stripe_customer"-feilmelding på "Administrer abonnement"-knappen. Fix: `computeCta()` returnerer "activate" for alle trial uavhengig av `hasStripeCustomer`. Dette mønsteret (plan-driven CTA) bør konsulteres når nye billing-UI legges til.

### Matrise 6 — am-admin B2B-flyt (Iter 20.1 → 20.6)

| Område                              | Entry-point / endepunkt                                          | Komponent / fil                                                          | Status |
|-------------------------------------|-------------------------------------------------------------------|--------------------------------------------------------------------------|--------|
| **Login + RBAC** (20.1, 20.2)       | `POST /api/am-admin/auth/login`                                   | `app/api/am-admin/auth/login/route.ts`                                   | ✅ |
| Session-check / me                  | `GET /api/am-admin/auth/me`                                       | `app/api/am-admin/auth/me/route.ts`                                      | ✅ |
| Wildcard routing                    | `<prefix>-admin.kodovault.no`                                     | `middleware.ts` (PREFIX_ADMIN_RX)                                        | ✅ |
| UI-shell                            | am-admin dashboard                                                 | `app/platform/am-admin/page.tsx`                                         | ✅ Iter 20.5 (med MpwProvider) |
| **Employees** (20.3)                | `GET /api/am-admin/tenants` (list)                                | `app/api/am-admin/tenants/route.ts`                                      | ✅ |
| Suspend ansatt                      | `POST /api/am-admin/tenants/[subdomain]/suspend`                  | `app/api/am-admin/tenants/[subdomain]/suspend/route.ts`                  | ✅ |
| Unsuspend ansatt                    | `POST /api/am-admin/tenants/[subdomain]/unsuspend`                | `app/api/am-admin/tenants/[subdomain]/unsuspend/route.ts`                | ✅ |
| Slett ansatt                        | `DELETE /api/am-admin/tenants/[subdomain]`                        | `app/api/am-admin/tenants/[subdomain]/route.ts`                          | ✅ |
| Unified ansatt-tabell (UI)          | EmployeeListSection                                                | `components/platform/am-admin/EmployeeListSection.tsx`                   | ✅ |
| **Invitasjoner** (20.3, 20.4c)      | `POST /api/am-admin/invites` (opprett + send mail via Resend)     | `app/api/am-admin/invites/route.ts`                                      | ✅ |
| List invites                        | `GET /api/am-admin/invites`                                       | `app/api/am-admin/invites/route.ts`                                      | ✅ |
| Resend / delete invite              | `POST/DELETE /api/am-admin/invites/[token]`                       | `app/api/am-admin/invites/[token]/route.ts`                              | ✅ |
| Org-invites UI                      | OrgInvitesSection                                                  | `components/platform/am-admin/OrgInvitesSection.tsx`                     | ✅ |
| **Billing cascade** (20.4)          | Stripe webhooks → parent + child lifecycle                        | `lib/stripe/event-handlers.ts` + `lib/platform/b2b-billing.ts`           | ✅ |
| Lifecycle cron (grace + cascade)    | `app/api/cron/lifecycle-sweep/route.ts`                           | `lib/platform/lifecycle-cron.ts`                                         | ✅ |
| Billing status (am-admin GET)       | `GET /api/am-admin/auth/me` returns `billing`                     | `app/api/am-admin/auth/me/route.ts`                                      | ✅ |
| Billing banner UI                   | BillingStatusBanner                                                | `components/platform/am-admin/BillingStatusBanner.tsx`                   | ✅ |
| Blokker invite i grace/expired      | `POST /api/am-admin/invites`                                       | `app/api/am-admin/invites/route.ts` (`assertBillingAllowsInvite`)        | ✅ |
| Send testfaktura (Mike)             | `POST /api/admin/tenants/[subdomain]/send-invoice`                | `app/api/admin/tenants/[subdomain]/send-invoice/route.ts`                | ✅ |
| **MPW** (20.5a, 20.5b)              | `GET /api/am-admin/mpw/status`                                    | `app/api/am-admin/mpw/status/route.ts`                                   | ✅ |
| MPW setup (SETNX, TOCTOU-safe)      | `POST /api/am-admin/mpw/setup`                                    | `app/api/am-admin/mpw/setup/route.ts`                                    | ✅ |
| MPW reset (Glemt MPW)               | `DELETE /api/am-admin/mpw` (super-admin only)                     | `app/api/am-admin/mpw/route.ts`                                          | ✅ |
| Krypto-foundation                   | PBKDF2 600k + AES-GCM                                              | `lib/platform/am-admin-mpw.ts`                                           | ✅ |
| Storage layer                       | Upstash CRUD                                                       | `lib/platform/am-admin-mpw-store.ts`                                     | ✅ |
| React context (in-memory key)       | MpwProvider                                                        | `components/platform/am-admin/MpwContext.tsx`                            | ✅ |
| Setup/unlock/reset UI               | MpwSection (3 modaler)                                             | `components/platform/am-admin/MpwSection.tsx`                            | ✅ |
| **Admin-notater** (20.5c)           | `GET/PUT/DELETE /api/am-admin/employees/[subdomain]/notes`        | `app/api/am-admin/employees/[subdomain]/notes/route.ts`                  | ✅ |
| Notes-storage (indeksert SET)       | `org-admin-notes:<prefix>:<sub>` + `:index`                       | `lib/platform/am-admin-notes-store.ts`                                   | ✅ |
| Notes UI per ansatt                 | AdminNotesModal                                                    | `components/platform/am-admin/AdminNotesModal.tsx`                       | ✅ |
| Orphan-cleanup ved tenant-delete    | `deleteTenant()` kjeder `deleteNote()`                            | `lib/platform/delete-tenant.ts` (steg 3.25)                              | ✅ |
| Glemt-MPW kaskade (slett notes)     | `DELETE /api/am-admin/mpw` kjeder `deleteAllNotes()`              | `app/api/am-admin/mpw/route.ts`                                          | ✅ |
| **Backup-eksport** (20.5d)          | `GET /api/am-admin/backup/data`                                   | `app/api/am-admin/backup/data/route.ts`                                  | ✅ |
| CSV/JSON-bygger (OWASP-mitigert)    | csvEscape + buildEmployeesCsv + buildBackupJson                   | `lib/platform/am-admin-backup.ts`                                        | ✅ |
| Backup UI                           | BackupSection                                                      | `components/platform/am-admin/BackupSection.tsx`                         | ✅ |
| **B2B Welcome (20.6)**              | `/welcome-b2b/[subdomain]?parent=...&locale=...`                   | `app/welcome-b2b/[subdomain]/page.tsx`                                   | ✅ |
| Invite-accept redirect-hook         | Redirecter til `/welcome-b2b/...` etter accept                    | `app/invite/page.tsx`                                                    | ✅ |
| **i18n 4 språk**                    | `am_admin.*`, `am_admin_mpw.*`, `am_admin_notes.*`, `am_admin_backup.*`, `welcome_b2b.*` | `lib/locales/{no,sv,da,en}.json` (1224 nøkler totalt) | ✅ |
| **Test-coverage**                   | 198/198 unit-tester (am-admin-mpw 23 + am-admin-mpw-store 26 + am-admin-notes-store 21 + am-admin-backup 48 + delete-tenant 14 + b2b-billing 16 + lifecycle-cron 33 + admin-auth 17) | `lib/__tests__/*.test.ts` | ✅ |

**Regression-risiko:** ✅ Lukket. am-admin-flowen er end-to-end zero-knowledge: server ser KUN opaque MpwEnvelopes for verifier + notater. "Glemt MPW" sletter verifier + notater atomisk (irreversibelt). Cascade-billing styres av webhook + lifecycle-cron — alle billing-leserne går gjennom samme `b2b-billing.ts`-modul (kanonisk).

**Note (sikkerhetsmodell):** Iter 20.5d implementerer OWASP CSV formula-injection-mitigering (apostrof-prefiks på `=/+/-/@/TAB/CR`) per "100% ikke 85%"-prinsippet. Iter 20.5b lukker TOCTOU-race på MPW-setup via atomisk Redis SETNX (ikke `get→set`). Begge er dokumentert i tests og CHANGELOG.

### Aggregert sammendrag etter retro-pass

| # | Feature                           | Entry-points | ✅ | ❌ / 🟡 |
|---|-----------------------------------|--------------|-----|---|
| 1 | LocaleRadioGroup                  | 7            | 7  | 0 |
| 2 | GDPR konto-sletting (D-070)       | 8            | 8  | 0 |
| 3 | Lifecycle-mailer (7 mail-typer)   | 8            | 8  | 0 |
| 4 | zxcvbn passord-styrke             | 5            | 2 + 2 frivillig + 1 N/A | 0 |
| 5 | Stripe checkout-state             | 9            | 9  | 0 |
| 6 | am-admin B2B-flyt (Iter 20.1–20.6) | 35          | 35 | 0 |

**Totalt: 72 entry-points dekket, 0 åpne.** (Iter 19.9.11 lukket zxcvbn-raden via ADR-notis — server-side er arkitektonisk umulig per zero-knowledge. Iter 20.6 lukket Matrise 6 etter at hele am-admin B2B-flyten ble static-verified.)

### Vedlikehold

Når en ny iteration endrer en av disse feature'ene (legger til ny mail-type, ny billing-UI, ny delete-trigger osv.), oppdater den relevante matrisen i samme leveranse. Hvis ny cross-flow-feature lanseres, legg til ny matrise her — bruk malen fra forrige seksjon.




---

## D-078 — Mike-admin har kun lesetilgang til B2B-org-metadata (NY · 2026-06-26 · Iter 20.1)

**KONTEKST:** Iter 20 introduserer `am-admin`-rollen som vedlikeholder ansatte selv. Spørsmålet: skal Mike's super-admin-konsoll (`admin.kodovault.no`) fortsatt kunne liste/redigere alle child-tenants under en B2B-parent? Eller skal Mike kun se aggregert org-meta (lisens-teller, navn, faktura)?

**BESLUTNING:** Mike-admin har **kun lesetilgang til org-metadata** for B2B-parents — *ikke* child-tenant-records eller ansatt-lister.

**Hva Mike fortsatt kan i super-admin-konsollen:**
- Se org-objekt (TenantRecord der `customerType="b2b"`): navn, kontaktinfo, fakturastatus, `maxLicenses`, `activeLicenses`, am-admin-kontaktinfo (epost til siste super-admin per org).
- Opprette første super-admin via "+ Opprett am-admin-konto"-knapp på parent-tenanten.
- Redigere parent-tenant felter (fakturering, kontaktinfo, lisens-tak) som i dag.

**Hva Mike IKKE kan:**
- List child-tenants under en B2B-parent (`/api/admin/tenants` filtrerer dem ut når parent har `tenantPrefix`).
- Se invite-lister for en B2B-parent (eksisterende `InvitesSection` skjules når parent har ≥1 super-admin opprettet).
- Suspendere/slette individuelle ansatt-tenants direkte.
- Endre admin-notater på ansatte.

**Karakter:** **Arkitektonisk grense, ikke kryptografisk umulighet.** Koden eksponerer ikke disse dataene gjennom Mike-admin-endepunkter. En angriper med tilgang til Mike's database-creds kunne fortsatt lese dem direkte fra Upstash. Hensikten er governance + GDPR-prinsippet "data minimization": Mike skal ikke se bedrifts-interne ansatt-data med mindre kunden eksplisitt ber om support-tilgang.

**Konsekvens — implementering (i senere faser av Iter 20):**
- `/api/admin/tenants GET` filtrerer ut child-tenants (`parentTenant !== null`).
- `/api/admin/tenants/[subdomain] GET/PATCH/DELETE` returnerer 404 hvis subdomain er en child av en B2B-parent som har ≥1 super-admin.
- `InvitesSection`-komponenten skjules i Mike's TenantViewer for parents med aktive admins.
- Audit-event `tenant_viewed_by_mike` legges til (sjelden brukt, men gjør tilgang sporbar hvis Mike noensinne åpner et child-objekt via et legitimt support-scenario).

**Re-evaluering:** Hvis Mike ofte må gjenåpne child-tenants for support, kan vi senere innføre et eksplisitt "support-mode" som krever am-admin-godkjenning + audit-stempel. Ikke nødvendig nå.

---

## D-078a — D-078 sjekkliste og statisk lint-håndhevelse (NY · 2026-06-28)

**KONTEKST:** D-078 er en arkitektonisk grense — ikke kryptografisk. Den håndheves i kode ved at super-admin-UI ikke importerer/eksponerer ansatt-PII. I praksis er regelen lett å bryte ved en uskyldig endring: i forrige iterasjon ble `<InvitesSection>` glemt igjen i `TenantViewer.tsx` etter at all annen B2B-employee-håndtering var flyttet til Konsoll. Mike (super-admin) så fortsatt ansatt-eposter i modalen — D-078-brudd.

**BESLUTNING:** Innfør en kort PII-sjekkliste + statisk lint-test som kjører i `yarn lint:all` og blokkerer build på Vercel.

### PII-sjekkliste — super-admin-UI (`admin.kodovault.no`)

Mike-admin **kan** se (org-metadata):
- TenantRecord-felter på B2B-parent: `subdomain`, `tenantPrefix`, `companyName`, `contactEmail`/`email` (kontakt for fakturering), `plan`, `status`, `maxLicenses`, `activeLicenses`, `pendingInvitesCount` (aggregert), `stripeCustomerId`, `currentPeriodEnd`, `provisioningLog`, `createdAt`/`deletedAt`, `locale`.
- Org-admin-rolle-metadata i Test Tools-kortene (D-091/D-094): `prefix`, `parentSubdomain`, `firstName`, `lastName`, `email`, `role`, `suspended`, orphan-flagg. Eksplisitt godkjent for orphan-rydding (se EXEMPT under).

Mike-admin **kan IKKE** se (ansatt-PII):
- `InviteRecord.email`, `firstName`, `lastName`, `token` for B2B-invites — kun aggregert teller (`activeLicenses + pendingInvitesCount / maxLicenses`).
- Child-tenant-PII: `email`, `contactEmail`, `firstName`, `lastName`, `pin`, `adminNotes*`, `pwdResetToken*`.
- `OrgAdmin`-PII for andre admins enn første super-admin (vises kun i Konsoll).

### Statisk håndhevelse

`lib/__tests__/d078-pii-lint.test.ts` (kalles via `yarn lint:d078`, kjedes inn i `yarn lint:all` og dermed `vercel-build`) skanner:

**Scope (super-admin-UI):**
- `app/platform/admin/**`
- `components/platform/TenantViewer.tsx`
- `components/platform/CreateOrgAdminCard.tsx`
- `components/platform/PaymentLinkModal.tsx`
- `components/platform/SendTestInvoice{Card,Tab}.tsx`
- `components/platform/{ProvisioningTracker,ClientConfigEditor,ConfigToolsButton,MailTestCard,StripeTestCard}.tsx`

**Forbudt:**
- `import … from "./InvitesSection"` eller `@/components/platform/InvitesSection`
- `import … from "@/components/platform/am-admin/*"` (alle B2B-Konsoll-komponenter)
- `import … from "../am-admin/*"` (relativ variant)

**Exempt (eksplisitt godkjent av Mike 2026-06-28):**
- `components/platform/OrgAdminListCard.tsx` (D-091 — orphan-rydding av org-admins)
- `components/platform/OrphanInvitesCard.tsx` (D-094 — orphan-rydding av invites)

Disse to kortene lever bevisst i super-admin-Test Tools-fanen fordi de er eneste vei å rydde zombie-rader når parent-tenant slettes (D-101) eller blir re-opprettet (D-094). De viser aggregert PII (epost/navn) for å la Mike identifisere hva som skal slettes. Hvis bruken blir hyppig → P1 audit-event i ROADMAP.

### Konsekvens

- Nye komponenter som lekker child-PII inn i super-admin-UI feiler `yarn build` på Vercel (via `vercel-build` → `lint:all` → `lint:d078`).
- Lokal CI/PR-flow: kjør `yarn lint:d078` for raskt feedback (≈100ms).
- Hvis et nytt komponent legitimt må vise child-data (f.eks. support-mode), legg til i EXEMPT-listen OG oppdater denne D-078a-seksjonen med begrunnelse.

### Re-evaluering

Hvis vi senere innfører eksplisitt "Mike-support-mode" med audit-trail + am-admin-godkjenning, kan EXEMPT-listen utvides til å dekke en `<SupportSection>`-komponent med synlig "Audit-logget"-banner.

---

## D-079 — Valgfri MPW (Master-Passord) for am-admin org-interne data (NY · 2026-06-26 · Iter 20.1)

**KONTEKST:** am-admin har to typer data: (1) data som server MÅ kunne lese (admin-brukerliste med bcrypt-hash, lisens-teller), og (2) data som er rent forvaltnings-internt (org-metadata-backup-eksport, admin-notater på ansatte). For (2) ønsker vi defense-in-depth: selv om en angriper får sentral Upstash-tilgang, skal disse dataene være utilgjengelige uten klient-side dekryptering.

**BESLUTNING:** am-admin kan valgfritt sette et **per-org MPW** (Master Password) som krypterer org-interne data klient-side — uavhengig av login-passord. Uten MPW lagres data ukryptert (samme defense-in-depth som tenant-record AES-GCM-blob, men ingen ekstra brukerhindring).

**Krypto-modell (samme mønster som D-002 vault-blob):**
- MPW → PBKDF2-SHA256, 600 000 iter, 16-byte salt → AES-256-GCM-nøkkel
- Salt lagres på sentral Upstash under `org-meta:<tenantPrefix>:mpw-salt`
- Per-org MPW (svar på blokker-spørsmål 2 = b, 2026-06-26): én MPW for hele admin-poolen. Settes av super-admin første gang. Andre admins får MPW utlevert utenfor systemet (samme problem som Bitwarden organization key — akseptert kompromiss for å unngå per-admin-isolasjon-kompleksitet).

**Hva som krypteres med MPW (svar på blokker-spørsmål 3 = a+b, 2026-06-26):**
- **Org-metadata-backup-eksport** — kryptert JSON-blob på `org-meta:<tenantPrefix>:backup` med subdomain-liste, status-datoer, ikke vault-innhold. Eksport-funksjon i am-admin-UI.
- **Admin-notater på ansatt-poster** — nytt felt `adminNotesEncrypted` på TenantRecord (child). Krypteres klient-side før PUT, dekrypteres klient-side ved visning. Hvis MPW ikke er satt → felt lagres som plaintext (fortsatt på server-AES-GCM-laget, men uten ekstra brukerhindring).

**Hva som IKKE krypteres med MPW:**
- `OrgAdmin.passwordHash` — bcrypt, server MÅ kunne verifisere ved login (en envei-funksjon i seg selv).
- `OrgAdmin.email`, `firstName`, `lastName`, `role`, `createdAt`, `suspended` — server-leselig for login-flyt + listing.
- `TenantRecord.activeLicenses`, `maxLicenses` — server-leselig for invite-lisens-sjekk.
- `InviteRecord` — uendret fra Iter 7.6.

**Flyt:**
1. Super-admin oppretter MPW første gang (dialog ved første innlogging): plaintext MPW + bekreftelse → zxcvbn ≥ 2 → PBKDF2-derive nøkkel → store salt på server, hold nøkkel i memory (sessionStorage)
2. Ved hver påfølgende innlogging: dialog ber om MPW → derive nøkkel → kan dekryptere backup + admin-notater
3. Hvis MPW ikke er satt: dialog skippes, alle "krypterte" UI-felter vises som plaintext.

**Tapt MPW = mistet data.** Ingen recovery. Dokumenteres tydelig ved opprettelse (samme advarsel som master-passord-setup for vault).

**Konsekvens — implementering (Iter 20.5, oppdatert fra 20.4 etter prismodell-endring 2026-06-26):**
- Ny `lib/org-admin-mpw.ts` — derive-funksjon (klient-side, Web Crypto API)
- Nytt felt på sentral Upstash: `org-meta:<prefix>:mpw-salt` (16-byte base64). Tilstedeværelse signaliserer "MPW er satt for denne org".
- Nytt felt på TenantRecord: `adminNotesEncrypted: { iv: string; ct: string; tag: string } | null` (null = ingen notater, ukryptert tekst inline = MPW ikke satt). Settes via ny `PATCH /api/am-admin/tenant/:subdomain/notes`.
- "Endre MPW" og "Fjern MPW" i am-admin SettingsPanel — krever bekreftelse + re-kryptering av all org-data.

**Re-evaluering:** Hvis ingen bruker MPW etter 6 mnd i prod (telemetri via tilstedeværelsen av `mpw-salt`-nøkkelen), vurder å fjerne featuren for å forenkle UX. Hvis 30 %+ bruker den, vurder å gjøre det obligatorisk i Iter 21.

---

## D-080 — B2B fakturerings-modell med cascade-lock og 7-dagers grace (NY · 2026-06-26 · Iter 20.4)

**KONTEKST:** Iter 20.1–20.3 leverte `am-admin`-RBAC + onboarding uten å løse hva som skjer når en B2B-org ikke betaler. Forretningssiden krever klart definert betalings-forventning før vi går live: hvilken pris, hvor lang trial, hva skjer ved manglende betaling, og hvordan informeres ansatte uten å skremme dem unødig.

**BESLUTNING:** B2B parent-tenant får egen Stripe-subscription med per-seat-pris. Lifecycle håndheves av eksisterende `lifecycle-sweep` cron, utvidet med B2B-spesifikk grace-logikk. Child-tenants har ingen egen Stripe-subscription — deres tilgang følger parent.

### Pris- og trial-matrise

| Parameter | Verdi |
|---|---|
| Trial B2B | **45 dager** gratis (B2C beholder 30d) |
| Halvår | **522 kr/seat** per 6 mnd (87 kr/seat × 6) |
| Helår | **1 044 kr/seat** per år (87 kr/seat × 12) |
| Grace etter forfall | **7 dager** |
| Pre-utløp-varsel (am-admin) | **7 dager** før neste fakturering |

### Plan-enum

`Plan` utvidet med `b2b_semiannual` og `b2b_yearly`. (Mike-direktiv 2026-06-26: ingen ren månedlig B2B-plan — halvår er minimum forpliktelse.)

### Stripe-flyt (manuell — svar på blokker-spørsmål 2 = A, 2026-06-26)

- Mike oppretter Stripe Customer + Subscription manuelt i Stripe Dashboard etter at B2B-parent er opprettet via Mikes super-admin (`POST /api/admin/tenants` med customerType="b2b").
- Subscription bruker `STRIPE_PRICE_B2B_SEMIANNUAL` eller `STRIPE_PRICE_B2B_YEARLY` med `quantity = parent.maxLicenses`.
- Vi reagerer kun på webhooks — ingen "Generer faktura"-knapp i Iter 20 (eksplisitt ut-av-scope per Mike).

### Datamodell (lagt til i Iter 20.4a)

```ts
TenantRecord {
  ...,
  /** Cached fra Stripe `subscription.current_period_end`. ISO. Stripe er
   *  sannhet — vi cacher for at lifecycle-cron skal slippe API-rundtur. */
  nextBillingDate: string | null;

  /** Markør på B2B child som er cascade-låst pga parent-grace-utløp.
   *  Kun satt på children. Brukes for å vite hvilke children som skal
   *  cascade-unlocke når parent betaler igjen. */
  parentLockedAt: string | null;
}
```

### Lifecycle-fase-modell (`lib/platform/b2b-billing.ts`)

`computeB2BBillingState(tenant, now)` returnerer ren fase-info — pure funksjon, kalles likt fra cron, webhook og API-ruter:

| Fase | Betingelse | UI-effekt |
|---|---|---|
| `n/a` | Ikke B2B-parent (B2C eller child) | Ingen B2B-UI |
| `trial` | status="trial" | Trial-info i am-admin (eksisterende UI) |
| `active` | status="active" + nextBilling > 7d unna | Ingen banner |
| `pre_expiry` | status="active" + nextBilling ≤ 7d | Amber banner i am-admin |
| `grace` | status="active" + nextBilling passert, ≤ 7d | Rød banner i am-admin + diskret toast til ansatte |
| `expired` | status="active" + nextBilling + 7d passert | Skal låses av cron neste sweep |
| `locked` | status="locked" | PaywallOverlay på alle children |

### Cascade-policy

**Når parent låses (cron oppdager `expired`-fase):**
1. Parent: `status = "locked"`, `lockedAt = now`
2. For hver child med `parentTenant === parent.subdomain`:
   - `status = "locked"`, `parentLockedAt = now`
   - Eksisterende vault-data bevares (kun login blokkeres)
3. Provisioning-log på parent: `b2b_cascade_lock` med antall children

**Når parent betaler (webhook `invoice.paid`):**
1. Parent: `status = "active"`, `nextBillingDate = invoice.period_end`
2. For hver child med `parentLockedAt !== null` under samme prefix:
   - `status = "active"`, `parentLockedAt = null`
3. Provisioning-log på parent: `b2b_cascade_unlock` med antall children

### Hva blokkeres i grace-fasen (svar på blokker-spørsmål 4 = B, 2026-06-26)

- ❌ POST `/api/am-admin/invites` (ny invitasjon) returnerer 403 `grace_period_active`
- ✅ Eksisterende ansatte fungerer normalt
- ✅ am-admin kan logge inn, se ansattliste, suspendere/unsuspendere
- ❌ Mer drastiske handlinger (slette ansatt) — i scope for diskusjon (foreløpig tillatt)

### Varsler

| Mottaker | Trigger | Kanal |
|---|---|---|
| am-admin | `pre_expiry` (7d før) | Amber banner i am-admin dashboard |
| am-admin | `grace` (forfalt) | Rød banner med dager-igjen-til-lock |
| Ansatt | `grace` | Diskret toast ved innlogging: "Abonnementet til din organisasjon er under fornyelse. Ingen handling nødvendig fra deg." |
| Ansatt | `pre_expiry` | INGENTING (skremme ikke unødig) |

### Cron-utvidelse (Iter 20.4b)

`lifecycle-cron.ts decideAction()` får ny case: hvis tenant er B2B-parent + status="active" + nextBilling+7d passert → returner `{ type: "B2B_GRACE_LOCK", reason }`. Cron-route håndterer kaskade som beskrevet over.

### Env-vars (settes i Vercel før Iter 20.4b deployes)

- `STRIPE_PRICE_B2B_SEMIANNUAL` — Stripe Price ID for 522 kr/seat × 6 mnd (NOK)
- `STRIPE_PRICE_B2B_YEARLY` — Stripe Price ID for 1 044 kr/seat × 12 mnd (NOK)

Hvis env mangler: webhook ignorerer B2B-events lydløst (returnerer null fra `priceIdToPlan`), B2B-parent flippes ikke til aktiv plan. Synlig i logger.

### Hva D-080 erstatter / forholder seg til

- **D-049** (Stripe just-in-time): fortsatt gyldig for B2C. B2B parent får `stripeCustomerId` ved Mikes manuelle opprettelse (etter D-080-tidspunktet for første B2B-kunde i prod).
- **D-069** (free-plan beskyttet for auto-cron): B2B-parent har plan="b2b_semiannual" eller "b2b_yearly" (ikke "free"), så cron kan låse dem. `free` forblir spesialcase for testkontoer.
- **D-075** (lifecycle-konfig): trial-dagene 45 for B2B legges som hardkodet konstant i `tenant-types.ts` (`B2B_DEFAULT_TRIAL_DAYS = 45`) — ikke i client-config. Begrunnelse: kommersiell parameter, ikke per-tenant-konfig.

### Konsekvens — implementering (Iter 20.4-fasing)

- **20.4a** ✅ — Datamodell + Plan-utvidelse + b2b-billing.ts + 16 unit-tester (LEVERT 2026-06-26)
- **20.4b** ✅ — Webhook lagrer `nextBillingDate`, lifecycle-cron + cascade-lock + cascade-unlock + 7 nye unit-tester (LEVERT 2026-06-26)
- **20.4c** ✅ — API + UI: parent billing-state via /me + /tenant/status, am-admin banner, invite-blokk i grace + 3 nye tester (LEVERT 2026-06-26)
- **20.4d** ✅ — Statisk QA-pass via testing-agent + 3 polish-fixes: Stripe API-fallback (MEDIUM), grammatikk (LOW), cascade-design-kommentar (INFO). 33/33 + 16/16 grønne, TSC + lint + build ✓. (LEVERT 2026-06-26)

**Iter 20.4 KOMPLETT.** Neste: Iter 20.5 (MPW + backup-eksport + admin-notater).

### Re-evaluering

Hvis grace-perioden viser seg å være for kort eller lang i prod (≥ 3 B2B-kunder med betalings-edge-cases), justeres `B2B_GRACE_DAYS`-konstant i `b2b-billing.ts` og dokumenteres som D-080-revisjon.



---

## D-105 — ABSOLUTT REGEL: Gjenbruk, ikke dupliser (NY · 2026-06-28 · Mike-direktiv)

**KONTEKST:** Forrige iterasjon avdekket at den samme "live seat-tellings"-løkken eksisterte i to ruter (`/api/admin/tenants` og `/api/am-admin/auth/me`) — duplisert kode som ville drifte fra hverandre over tid. Samtidig viste UI tre forskjellige varianter av samme teller: tekstuell "3/10", "1+0/10 ansatte", og den pene `<SeatProgressBar>` med progress-bar. Same logikk, tre implementasjoner.

**BESLUTNING:** Dette er en absolutt regel, ikke en anbefaling.

> **Alle komponenter og all logikk skal gjenbrukes fra ett sted. Ingen duplisering — uansett hvor liten den ser ut.**

### Hva som gjelder

1. **UI-komponenter** — hvis du trenger å rendere noe som ligner på et eksisterende komponent, **bruk det eksisterende**. Hvis det mangler en variant/prop, utvid komponenten. Ikke duplisér markup.
2. **Forretningslogikk** — telling, validering, datakonvertering, status-utledning: skal bo i én helper-fil under `lib/platform/` eller `lib/`. Aldri kopiert inn i en route eller komponent.
3. **Konstanter / felt-lister** — landlist, plan-enum, status-enum: importeres fra typedef-filen, ikke listet på nytt.
4. **Validatorer** — `validateOrgNumber`, `validateNorwegianPostalCode`, e-post-regex: én kilde, importert.

### Hva som IKKE er duplisering

- Tre forskjellige modaler med ulik UX/innhold er ikke duplisering selv om alle bruker `<Modal>`-skall.
- Forskjellige API-ruter som hver gjør CRUD på sin egen Upstash-nøkkel er ikke duplisering.
- Lignende `useState`-mønstre i to skjemaer som tracker ulike datasett er ikke duplisering.

Duplisering = **identisk logikk, ulik kopi**. Hvis du finner deg selv i ferd med å copy-paste 3+ linjer kode du nettopp så et annet sted → STOPP. Ekstraher.

### Konsekvens — håndhevelse

- **D-105-lint** (`yarn lint:d105` → del av `yarn lint:all`) skanner kode-basen for kjente duplisering-mønstre:
  - Inline child-counting-løkke utenfor `lib/platform/seat-counter.ts`
  - Inline `${activeLicenses}/{maxLicenses}`-tekst-counter utenfor `<SeatProgressBar>`-komponenten
  - Mer mønstre legges til når vi oppdager nye dupliseringer
- Hvis lint feiler → ekstraher til shared module og oppdater alle call-sites.
- Tekniske unntak (f.eks. tenant-pod kan ikke importere fra admin-pod) må dokumenteres som eksplisitt D-XXX-unntak før duplisering aksepteres.

### Re-evaluering

Aldri. Dette er en absolutt regel.

---

## D-108 — Kanonisk 2-nivå tab-struktur for modaler (NY · 2026-06-28 · Mike-direktiv)

**KONTEKST:** TenantViewer-modalen utviklet seg over flere iterasjoner (D-096/D-104/D-106/D-107) til å bli for tett — én Oversikt-fane med plan/status + identitet + selskap + kontakt + fakturering + notes ble uleselig. Løsningen ble 2 nivåer: hode-tabs øverst, under-tabs som vises kun under en spesifikk hode-tab.

**BESLUTNING:** Dette er kanonisk mønster for alle modaler med mange under-kategorier. Implementeres via gjenbrukbar `<SubTabNav>` (D-105 anti-duplisering).

### Struktur

```
┌─ Modal Header (subdomain + badges + companyName + SeatProgressBar) ───┐
│                                                                        │
├─ Nivå-1 hode-tabs (`<Tab1>` styling: bold, underline-active) ─────── ┤
│  [Oversikt*]  [Lisens & B2B]  [Stripe & Fakturaer]  [System]          │
│                                                                        │
├─ Nivå-2 under-tabs (kun synlig under aktiv hode-tab) ──────────────  ┤
│  [Selskap*]  [Kontakt]  [Plan & Kommunikasjon]  [Faktura-adresse]    │
│                                                                        │
├─ Content area ─────────────────────────────────────────────────────  ┤
│  ...rendres basert på activeTab + activeSubTab...                     │
│                                                                        │
└─ Footer (teknisk tagline: "Lagret AES-256-GCM-kryptert i Upstash") ─ ┘
```

### Gjenbrukbar komponent

**`components/platform/SubTabNav.tsx`** — den ENESTE implementasjonen av nivå-2-navigasjon. Alle modaler som trenger 2-nivå-struktur SKAL bruke denne (D-105):

```tsx
import { SubTabNav, type SubTabItem } from "@/components/platform/SubTabNav";

type SubId = "a" | "b" | "c";
const [sub, setSub] = useState<SubId>("a");
const items: SubTabItem<SubId>[] = [
  { id: "a", label: "Første", show: true },
  { id: "b", label: "Andre", show: isB2B },
  { id: "c", label: "Tredje", show: true },
];

<SubTabNav
  items={items}
  active={sub}
  onChange={setSub}
  testIdPrefix="my-modal-subtab"
/>
```

### Stil-regler (kanoniske)

- **Aktiv**: `bg-blue-500/15 text-blue-200 border border-blue-400/40`
- **Inaktiv**: `text-white/55 hover:text-white/85 hover:bg-white/5 border border-transparent`
- **Form**: `rounded-lg` (skiller seg fra nivå-1 som typisk er underline/bold)
- **Størrelse**: `px-3 py-1.5 text-[11px] font-medium`
- **Gap**: `gap-1` mellom tabs
- **Spacing**: `mb-5` under nav-en

Hvis en spesifikk modal trenger annen stil, dokumenter avviket som D-XXX-unntak før du endrer `<SubTabNav>` — IKKE lag en parallell implementasjon.

### Når bruke dette mønsteret?

**Bruk 2 nivåer hvis:**
- Modal har 3+ kategorier på samme tema som hver har 3+ underkategorier
- Innholdet i én hode-fane blir mer enn ~600 piksler høyt
- Brukeren scrolle mye for å finne én verdi

**Ikke bruk hvis:**
- Modal har ≤ 4 hode-tabs og hver kan rendre på én skjerm uten scrolling
- Hode-tab har ≤ 5 felter (legg dem inline med seksjon-headers i stedet)

### Eksempler

- ✅ TenantViewer (D-107) — 4 hode-tabs × 4 sub-tabs under Oversikt
- 🔜 Hvis am-admin-Konsoll-innstillinger vokser → kan også få SubTabNav
- 🔜 Hvis B2B-checkout-flowen blir flerstegs → kan reuse SubTabNav

### Lint-håndhevelse

D-105-lint fanger ikke direkte at noen lager parallell `<SubTabNav>`-implementasjon, men hvis noen kopierer markup-en (button + active/inactive className-mønster) trigger det mistanke. Hvis vi ser to slike i koden, legges et nytt regex-mønster til `d105-duplication-lint.test.ts`.

---


## D-111 — `activeLicenses` er live-tellet, ikke lagret (NY · 2026-06-29 · Mike-direktiv)

**Kontekst:** B1 i KNOWN_BUGS dokumenterte at `TenantRecord.activeLicenses` inkrementeres i `invite/accept` men aldri dekrementeres ved `delete-tenant`. Verdien drifter fra realiteten og blir over tid feil, noe som er en risiko fordi 6 ulike API-ruter brukte feltet direkte til seat-cap-validering (blokkerer faktiske operasjoner).

**Beslutning:** Fjern alle skriv- og direkte-lesere av `activeLicenses` fra sentral storage. Live-telling via `lib/platform/seat-counter.ts → countLiveActiveLicenses(prefix, allTenants)` er ENESTE sannhetskilde.

### Konsekvenser

1. **Schema:** `TenantRecord.activeLicenses` er nå `number | undefined` (optional) og dokumentert som "response-only — populeres av API, skrives ALDRI til Upstash". Samme mønster som `pendingInvitesCount`.
2. **Skriv-side:** `invite/accept` har fjernet `parent.activeLicenses++`-blokken. Ingen ruter skriver lenger feltet.
3. **Lese-side:** 6 ruter patchet til å bruke `countLiveActiveLicenses`:
   - `/api/am-admin/seat-status` (Konsoll-UI)
   - `/api/am-admin/invites` POST (seat-cap-validering før invite)
   - `/api/admin/invites` POST (super-admin invite-flow)
   - `/api/invite/accept` (seat-cap-validering før aksept)
   - `/api/admin/tenants/[subdomain]` DELETE (blokk-sjekk før parent-sletting)
   - `/api/am-admin/backup/data` (backup-payload)

   `/api/admin/tenants` og `/api/am-admin/auth/me` var allerede live-tellet (D-103e).
4. **Default-state:** `createTenantRecordDefaults` setter ikke lenger `activeLicenses: 0` for B2B. Eksisterende records med stale-verdier overskrives ikke automatisk, men ingen kode leser dem lenger.

### Hvorfor optional og ikke fullstendig slettet fra typen?

API-svar (admin/tenants, am-admin/auth/me, seat-status, backup/data) sender fortsatt `activeLicenses` som beregnet response-felt. UI-komponenter (`TenantViewer`, `KonsoletSettingsPanel`, `InvitesSection`, etc.) konsumerer det fra wire-format. Å fjerne feltet helt fra TypeScript-typen ville krevet en separat `TenantListItem`-type med duplisert felt-liste — en større refactor enn nødvendig.

Mønsteret er identisk med eksisterende `pendingInvitesCount?: number` (D-103) — feltet finnes i typen, dokumentert som "kun computed", aldri skrevet.

### Lint og test-implikasjoner

- `lifecycle-guard.test.ts` og `am-admin-backup.test.ts` har fortsatt test-fikstur med `activeLicenses: <n>` — det er fortsatt gyldig fordi feltet er optional.
- D-105-lint fortsatt grønn — ingen nye duplisering-mønstre.
- Ingen migrering av eksisterende Upstash-records nødvendig: feltet ignoreres ved deserialisering (TypeScript optional), og overskrives aldri av storage-write fordi `putTenant(record)` lagrer hele record uten å fjerne uvedkomne keys (Upstash JSON-payload). Drift-verdier blir bare ignorert som dead data.

### Rollback-plan

Hvis live-telling viser seg å være for tregt (ekstra `listTenants()`-kall per validering):
1. Gjenintroduser `activeLicenses` som required `number | null` i schema.
2. Skriv backfill-cron som re-synker feltet hver time fra live-data.
3. La direkte-lesere bruke stale-feltet igjen, men aksepter ≤ 60 min drift.

Per Mike's spec 2026-06-29: "Ren fjerning. Én sannhetskilde, ingen drift, ingen halvferdige løsninger." Dette er den linja vi går på.

---


## D-112 — `vatNumber` fjernet fra schema, utledes live (NY · 2026-06-29 · Mike-direktiv)

**Kontekst:** B6 i KNOWN_BUGS dokumenterte at `TenantRecord.vatNumber` lagres backend men aldri eksponeres i UI (skjult i create-form per Iter 20.9 fordi MVA = "NO" + orgnr + "MVA" for norske selskaper). Etter sjekk viste det seg at samme deterministiske utledning gjelder for ALLE nordiske land:

- **NO:** `NO` + orgnr (9 sifre) + `MVA`
- **DK:** `DK` + CVR (8 sifre) — CVR ER MVA-nummer
- **SE:** `SE` + orgnr (10 sifre uten bindestrek) + `01`

**Beslutning:** Fjern `vatNumber`-feltet fra schema. Innfør `deriveVatNumber(country, orgNumber)`-helper for live-utledning der UI eller fakturaer trenger å vise MVA.

### Konsekvenser

1. **Schema:** `TenantRecord.vatNumber` fjernet helt (ikke optional, full sletting). Eksisterende verdier i Upstash ignoreres som dead data.
2. **CreateTenantInput:** `vatNumber?` fjernet fra payload-typen.
3. **API PATCH:** `/api/admin/tenants/[subdomain]` aksepterer ikke lenger `vatNumber` i body, og audit-felt-listen er ryddet.
4. **Audit-tracking:** `tenant-audit.ts` BASE_FIELDS-array har ikke lenger `vatNumber` → ingen logging av "endring" på et felt som ikke kan endres.
5. **UI:** `CreateFormState`, `EMPTY_FORM`, `BASE_FIELDS_B2B` (audit-liste i System-fanen) og `CompanyDataSectionEdit` sin `companyForm` har alle fjernet `vatNumber`-spor.
6. **Helper:** `deriveVatNumber()` plassert i `lib/platform/org-number-validation.ts`. Tar `country: string` (case-insensitiv, godtar `NO`/`NOR`/`NORGE`/`NORWAY` + tilsvarende for DK/SE) og `orgNumber: string` (med eller uten sifferstripping). Returnerer null hvis land ikke støttes eller sifferantall er feil for landet.
7. **Tester:** `lifecycle-guard.test.ts`-fixture oppdatert.

### Hvorfor full fjerning (ikke optional)?

For å unngå at noen ved et uhell skriver til feltet ("denne kan ikke skrives") og for å tydeliggjøre at sannhetskilden er deriveringen. Optional-mønsteret (som `activeLicenses` i D-111) ble vurdert men ikke valgt fordi `vatNumber` ikke har et naturlig response-only use-case — det er ren funksjon av to andre felter.

### Migrering / rollback

- **Migrering:** Ingen. Upstash-records med `vatNumber`-keys deserialiseres uten feil (extra keys ignoreres av TypeScript ved JSON-parse), og verdiene leses ingen steder.
- **Rollback:** Gjenintroduser feltet som `vatNumber: string | null` i schema, legg tilbake i audit-liste og PATCH-body-type, eksponer i UI. Eksisterende stale-data vil da bli synlig igjen.

### Bonus-feature wired (samme commit, 2026-06-29 ettermiddag)

`deriveVatNumber()` koblet inn 3 av 4 naturlige plasseringer:

1. **UI read-only display:** `SelskapFieldsBlock` viser "MVA-nummer (utledet)"-pille under orgNumber-feltet når orgnr er gyldig OG land er NO/DK/SE. Begge moduser (edit + create). Locale-nøkler: `admin_tenants.field_derived_vat`, `admin_tenants.derived_vat_hint` × 4 språk.

2. **Stripe JIT customer (create-time):** `createCustomerJIT()` i `lib/stripe/checkout.ts` tar nå `companyCountry?` + `orgNumber?` og setter `tax_id_data: [{type, value}]` automatisk. Stripe-typer:
   - NO → `no_vat`
   - DK/SE → `eu_vat`
   
   Alle 5 caller-routes oppdatert: register/paid, billing/create-checkout, admin/create-payment-link, admin/tenants/[subdomain]/test-checkout, admin/test-register-paid. Bakoverkompatibelt — kallere uten company-data får null-tax_id (samme som før).

3. **Faktura-templates:** Ingen custom HTML-templates i kodebasen — Stripe rendrer fakturaer selv. Tax_id på Customer ⇒ automatisk synlig på Stripe-genererte faktura-PDFer. Ingen ekstra arbeid.

4. **Stripe PATCH-sync (IKKE wired):** Når Mike endrer orgNumber/companyCountry via admin/tenants PATCH og Customer allerede finnes, blir tax_id IKKE re-sync-et. Grunn: Stripe API tillater ikke `customers.update({tax_id_data})` — krever `customers.deleteTaxId(custId, taxId)` + `customers.createTaxId(custId, {type, value})`. Edge-case-tett (race-conditions, eldre customers med multiple tax_ids). Markert som åpen TODO — kan tas separat hvis det blir aktuelt at Mike endrer orgnr på eksisterende betalende kunder.

---

