# Ko|Do Vault — Business Case (Lean version)

**Status:** Levende dokument. Skrives før v4.5-utvikling for å sikre at videre arbeid er kommersielt forsvarlig.
**Dato:** 2026-02
**Eier:** Mike (eneste eier av besluttsoms-makt)
**Filosofi:** Like lean som produktet. Maks 10 sider. Tall over påstander. Ingen VC-pitch-deck-språk.

---

## 0 · Personlig commitment (rammene som styrer alt)

**Mike-beslutning 2026-02:**
- **Tid:** Over sommeren 2026 (≈ juni-september = 3-4 måneder med variabel intensitet)
- **Penger:** 30 000-50 000 NOK totalt for alt (inkluderer hosting, domener, evt. legal/accounting, marketing)

**Implikasjon:** Dette er et **disiplinert side-prosjekt**, ikke en startup. Hver beslutning herfra må respektere:
- Solo developer (Mike + AI-assistent)
- Null full-tids-team
- Null VC-finansiering
- Null betalt markedsføring
- Free-tier MÅ koste Ko\|Do tilnærmet 0 kr/bruker

Dette er Lean Security på forretnings-nivå: vi bygger ikke et produkt vi ikke kan vedlikeholde alene.

---

## 1 · One-liner

> **Ko\|Do Vault** er en sikker, web-basert vault for **norske advokater og kunnskapsarbeidere** som vil ha **passord + dokumenter samlet ett sted** uten å låse seg til **utenlandske SaaS-leverandører eller komplekse desktop-installasjoner**.

**Differensiator:** «Lean Security · Not Security as a Service». Du eier dataene, koden er enkel, ingen vendor-låsing.

---

## 2 · Problem og evidens

### 2.1 Smertepunktet (hypotese)

Norske kunnskapsarbeidere har i dag:
- **Passord-vault:** 1Password (USA), Bitwarden (USA), LastPass (USA), Apple iCloud Keychain
- **Dokument-lager:** Google Drive, Dropbox, OneDrive (alle USA-baserte)
- **Sensitive PDF-er:** Drar rundt på e-post-vedlegg, USB-stick, eller Cryptomator (krever desktop-app per maskin)

Problemet:
1. **Data-suverenitet:** Schrems II skaper formell usikkerhet rundt USA-baserte tjenester
2. **Fragmentering:** Passord ett sted, dokumenter et annet, ID-kort fotograferes til iCloud
3. **Tekniske barrierer:** Cryptomator er teknisk-nok at advokat ikke bruker det
4. **Vendor-lock-in:** Bytte fra 1Password krever eksport, kryptert backup, import

### 2.2 Evidens vi har

- ✅ **Schrems II-dommen (2020)** har skapt formell EU-skepsis til USA-tjenester
- ✅ **Mike's egen erfaring** som potensiell advokat-bruker (Compendia-kontekst)
- ✅ **LK** (én reell test-person, ikke betalende — bekreftet behov uten å forplikte seg)
- ✅ **Landingsside-trafikk:** kodovault.no samler interesse-liste (tall: ukjent — må sjekke)

### 2.3 Evidens vi mangler (KRITISK å skaffe FØR videre utvikling)

- ❌ **5-10 ekte kundeintervjuer** — norske advokater, konsulenter, journalister: vil de virkelig betale 49 kr/mnd?
- ❌ **Konkret betalings-vilje** — hva er smerteterskel-prisen? Spør faktiske mennesker
- ❌ **Tids-vilje** — er folk villige til å migrere fra 1Password? Det er friksjon
- ❌ **Schrems II som faktisk salgsargument** — eller bare en abstrakt jurist-greie?

**Action item for Mike:** Snakk med 5 personer før v4.1 starter. 30 minutter hver. Ikke salg — spørsmål.

---

## 3 · Lean Security-løsningen (det du har bygget + planlagt)

| Ferdig | Versjon | Hva |
|---|---|---|
| ✅ | v2.9 | Passord-vault, mobile, multi-tenant arkitektur |
| ✅ | v3.0 | Bankkort med kamera-flow |
| ✅ | v4.0 | Sikker overlevering (.kodoenc-pakker) |
| 📅 | v4.1 | ID-blob (pass, førerkort) |
| 📅 | v4.2 | 2FA TOTP integrert |
| 📅 | v4.3 | Språkdrakt (NO/SV/DA/EN) |
| 📅 | v4.5 | BYO Dokument-laget (Drive/Dropbox/USB) |
| 📅 | v5.0 | Auto-deployment + pricing (Lean Security som tjeneste) |

**Det unike som ingen annen leverer (per landingssida og v4.5-DESIGN):**

> «Hurtige passord i sky: 1Password/Bitwarden ✅ — Ko\|Do ✅
> BYO Drive for dokumenter: Cryptomator ✅ — Ko\|Do ✅
> **Begge i SAMME app: Ingen ❌ — Ko\|Do ✅**
> Web-basert (multi-device, null install): Ingen ❌ — Ko\|Do ✅
> Norsk språk: Knapt noen ❌ — Ko\|Do ✅»

Det er ekte differensiering, ikke marketing-tale.

---

## 4 · Konkurranse-kart

| Konkurrent | Hva de gjør bra | Hvor Ko\|Do vinner |
|---|---|---|
| **1Password** | Polert UX, multi-device, bedrifts-features | Norsk, ingen vendor-lock-in, dokument-laget med BYO |
| **Bitwarden** | Open source, billig, har dokumenter (kun små) | Norsk, BYO storage, ikke knyttet til Bitwarden Inc |
| **LastPass** | Markedsleder volum | Trust-skadet av breaches; Ko\|Do = Schrems II rein |
| **Tresorit** | God dokument-sikkerhet, EU-base | Dyr (~$15/mnd); Ko\|Do = norsk-først, billigere, multi-lag |
| **Cryptomator** | Open source, BYO, gratis | Krever install per maskin; Ko\|Do = web-basert |
| **Apple Keychain** | Innebygd, gratis | Apple-only; Ko\|Do = multi-plattform |
| **Norske banker (BankID)** | Tillit | Bare ID/innlogging, ikke passord/dokument-vault |

**Konklusjon:** Ko\|Do har en reell nisje (norsk + multi-lag + BYO + web). Men nisjen er smal — det betyr færre potensielle kunder, og hver må overbevises individuelt.

---

## 5 · Forretnings-modell (arbeidshypotese fra v5.0-DESIGN)

### Modell B+D-hybrid

**Free tier (Cryptomator-modus):**
- Passord, kort, ID-er (hurtig-laget, kun)
- Begrenset til < 100 MB total vault-størrelse
- Open source-kjernen — selvhostbar
- Ingen support utenom community

**Pro tier — 49 kr/mnd eller 490 kr/år:**
- Alt i Free
- Dokument-laget (v4.5) med BYO Drive/Dropbox/USB
- Sikker overlevering (v4.0)
- Klasse A-editor (notater, markdown)
- 2FA TOTP integrert (v4.2)
- Hosted hos Ko\|Do (Vercel + Upstash, ingen self-host nødvendig)
- E-post-support fra Mike

**Team tier — 99 kr/ansatt/mnd** (kommer i v5.1):
- Alt i Pro
- Deling mellom ansatte
- Admin-portal
- Audit-log
- Prioritert support

### Unit economics (B2C Pro, månedlig)

**Inntekt per Pro-bruker:** 49 kr/mnd

**Kostnader per Pro-bruker (estimat):**
- Vercel Pro-plan: deles på alle brukere → ~3-5 kr/bruker hvis 100+ brukere
- Upstash Redis: ~1-2 kr/bruker (lite data per bruker, hurtig-laget kun)
- Stripe-fees: ~1.5 kr per transaksjon → 1.5 kr/bruker/mnd
- Domain + email: deles, ~1 kr/bruker hvis 100+
- **Total marginal kostnad:** ~7-10 kr/bruker/mnd

**Dekningsbidrag:** 49 - 10 = **~39 kr/bruker/mnd**

**Break-even for Mike sin tid (over sommeren = ~300 timer):**
- Hvis Mike verdsetter tid til 500 kr/time → 150 000 kr må tjenes inn
- 150 000 / 39 = **3 850 bruker-måneder**
- Eller: 320 betalende brukere i 12 måneder

**Konklusjon:** Hvis Ko\|Do får 50 betalende brukere etter ett år, er det **ikke kommersielt suksess**, men det dekker drift og frigir tid. 300+ betalende brukere = reell biz.

### Tallene under 30-50K-rammen

| Post | Estimert kostnad sommeren 2026 |
|---|---|
| Vercel Pro (4 mnd) | 800 kr/mnd × 4 = 3 200 kr |
| Upstash (lav-bruk-tier) | 200 kr/mnd × 4 = 800 kr |
| Domain + email | 500 kr |
| Stripe oppsett + fees (anta lav volum) | 1 000 kr |
| Legal-konsult (1 time for vilkår + GDPR-check) | 2 500 kr |
| Eventuell norsk regnskaps-software | 500 kr/mnd × 4 = 2 000 kr |
| Buffer for uforutsette | 5 000 kr |
| **Sum** | **~15 000 kr** |
| **Igjen av Mike sitt budsjett** | **15 000-35 000 kr — disponibelt til markedsføring / forlengelse** |

**Du er innenfor rammen** — men knappet hvis du legger til betalt markedsføring.

---

## 6 · 6-12 mnd plan (Mike-spesifikk)

### Måned 1-2 (mars-april 2026)
- ✅ Ferdigstille v4.0 (sikker overlevering)
- 📞 **Snakk med 5 potensielle Lars-er** — strukturerte intervjuer
- 📝 Oppdater BC basert på funn

### Måned 3-4 (mai-juni 2026)
- Bygg v4.1 (ID-blob) + v4.2 (2FA TOTP)
- Soft launch til kodovault.no-listen (50-100 personer?)
- Mål: 5-10 aktive test-brukere, samle reell feedback

### Måned 5-6 (juli-august 2026)
- Bygg v4.3 (språkdrakt — kun NO/SV/DA/EN)
- Bygg v4.5 (dokument-laget, Modell 1 + Klasse A-editor først)
- Lukk åpne spørsmål i v5.0-DESIGN

### Måned 7-8 (september-oktober 2026)
- Bygg v5.0 self-serve onboarding (kun B2C)
- Stripe-integrasjon
- LinkedIn-launch
- **GO/NO-GO milepæl:** har vi 50+ interesserte fra listen som faktisk kjøper innen 60 dager?

### Etter måned 8

**Hvis GO:** Fortsetter med B2B (v5.1), tysk språk, mer feature-utvikling.

**Hvis NO-GO:** Se kapittel 7.

---

## 7 · Worst-case-scenario og kill-criteria

### Kill-kriterier (Mike må sette og respektere)

Ko\|Do droppes som kommersielt prosjekt hvis:

1. **Under 5 betalende brukere etter 60 dager fra public launch (oktober 2026)**
2. **30-50K-budsjett overskrides med >50%** uten utsikt til inntekt
3. **Customer-acquisition cost (CAC) > 6 mnd lifetime value** — viser at vekst aldri kan finansiere seg selv
4. **Mike føler at side-prosjekt påvirker dagsjobb-prestasjon eller helse negativt**
5. **Konkurrent (Bitwarden, 1Password) lanserer eksakt samme nisje med større ressurser**

### Hva betyr "droppes" konkret?

Ikke at appen forsvinner. Tre humane utganger:

1. **Frys i nåværende tilstand** — eksisterende brukere får videre tilgang, Mike vedlikeholder kun
2. **Open source-frigjøring** — koden gis vekk, community kan ta over
3. **Salg av kode/brand** — eks. til større aktør som vil ha norsk fotfeste

Hver bruker som har data i Ko\|Do MÅ kunne eksportere alt (per Lean Security-prinsipp 1). Det er en pakt vi ikke kan bryte selv om vi avslutter.

### Hvorfor det er OK å drepe et prosjekt

Du sa det selv: «intellektuelt morsomt» er ikke nok. Hvis Ko\|Do bygges videre uten kommersiell forankring, ender du opp som mange teknisk grunnleggere — med en god app uten brukere, og avtagende motivasjon. Bedre å ha klare kriterier og respektere dem.

---

## 8 · Personlig commitment-spørsmål (Mike-alene-svar)

Disse er ikke noe BC kan svare på. Du må svare for deg selv:

1. **Hva er målet?** Tjene penger? Lære nytt? Bygge teknisk portfolio? Hjelpe Compendia eller andre? Forskjellige mål → forskjellig strategi.

2. **Hva skjer hvis det IKKE kommersielle blir suksess, men teknisk er det ferdig?** Holder du gleden ved bygging i seg selv?

3. **Hvor lenge tåler du å bygge før du må se inntekt?** Du sa "over sommeren". Etter september — er du villig til å fortsette uten betalingsgrunnlag?

4. **Vil du ha en med-grunnlegger?** En designer, en marketing-person, en jurist? 30-50K-budsjettet rommer ikke det, men kanskje "betal i aksjer"?

5. **Hva er din risiko-toleranse for personlig økonomi?** 30-50K er ramme. Hva hvis Ko\|Do trenger 100K for å lykkes? Er du villig?

---

## 9 · Hva BC-en IKKE svarer på (ærlighet)

Dette dokumentet er en strukturert hypotese. Det erstatter ikke:

- **Reell markedsundersøkelse** — bare 5+ intervjuer kan validere problem-hypotesen
- **Reell pricing-test** — A/B-test på landing-sida med ulike pris-punkter
- **Reell customer development** — første 10 betalende brukere er sannhetsserum
- **Reell konkurranse-intel** — vi kjenner ikke 1Passwords pricing-strategi inn-og-ut
- **Reell juridisk vurdering** — GDPR, Schrems II, norsk forbrukerlovgivning krever advokat-time

BC-en gir deg en **disiplinert ramme** for å tenke gjennom dette. Den gir ikke svar — den gir spørsmål med struktur.

---

## 10 · Anbefaling — neste 30 dager

For at BC-en skal være verdt mer enn et Word-dokument, må du innen 30 dager:

1. ✅ **Lukk v4.0 (sikker overlevering) ferdig på Vercel** — pågår
2. 📞 **Snakk med minst 3 potensielle Lars-er** (advokater, konsulenter, norske kunnskapsarbeidere). Spørsmål: «Hvor lagrer du sensitive dokumenter i dag? Ville du betalt 49 kr/mnd for en sikkerhets-app som samler det?»
3. 🌐 **Sjekk hvor mange som har skrevet seg på interesselista på kodovault.no.** Hvis < 50 etter 6+ måneder → marketing-utfordring er reell.
4. 📊 **Sett opp grunnleggende analytics** (Plausible eller eget) på kodovault.no for å se hvor folk kommer fra og om de leser «Why»-seksjonen.
5. 💼 **Oppdater BC-en med funn** — gjenåpne dette dokumentet, fyll inn tall.

Hvis disse 5 punktene viser at det IKKE er etterspørsel → revurder v4.1/v4.2/v4.3/v4.5-utvikling. Det er bedre å vite nå enn etter 100 timer ekstra koding.

---

## Status

- ✅ Strukturert BC-utkast laget (2026-02)
- ✅ Lean Security-filosofi tråkket inn på alle nivåer
- ✅ Konkrete kill-kriterier definert
- ✅ 30-50K-budsjett-realitets-check ferdig (du er innenfor)
- 🟡 Markedsundersøkelse mangler (Mike må gjøre)
- 🟡 Pricing-validering mangler (krever live-test)
- 🟡 Juridisk gjennomgang mangler (legal-konsult timer i budsjettet)

**Neste oppdatering:** Etter Mike har gjennomført kundeintervjuene + sjekket interesselista. Da kan vi konkretisere tallene i §5 og milepælene i §6.

---

## 11 · Sluttbemerkning

Mike's spørsmål: *«hva er vitsen bortsett fra at det er intellektuelt morsomt»*.

Svaret BC-en gir er ikke «du må kommersialisere alt». Svaret er: **vit hva du gjør, hvorfor, og når du må stoppe.**

Du har bygget noe teknisk imponerende. Du har en klar brand-historie. Du har 30-50K og en sommer. Du har én test-bruker. Det er nok til å validere på 90 dager om dette har et kommersielt grunnlag eller er en flott teknisk øvelse.

Begge utfall er gyldige. Velg bevisst.
