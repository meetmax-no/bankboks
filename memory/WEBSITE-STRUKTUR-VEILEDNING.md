# Webside-struktur — one-page vs hierarkisk

**Status:** Referanse-dokument (2026-02, diskusjon med Mike)  
**Formål:** Beslutningsstøtte når du skal bygge en ny webside — one-page, hierarkisk, eller hybrid.

---

## Når skal du bruke ren one-page?

**Bruk one-page når:**
- Målet er én konvertering (kjøp, påmelding, kontakt, last ned)
- Innholdet passer i 4-6 seksjoner (Hero → Problem → Løsning → Sosialt bevis → Priser → CTA)
- Brukeren scroller lineært — ingen behov for å hoppe rundt
- Lite gjentakende innhold (én produktlinje, én tjeneste, én app)
- **Eksempler:** landing pages, MVP-launches, portefølje, personlig CV, single-produkt SaaS

**Fordeler:**
- Rask å bygge
- Høy konvertering (alt på ett skjermbilde)
- Enkel SEO for én keyword
- Én stor emosjonell reise fra topp til bunn

**Ulemper:**
- Blir stygg over ~6-7 seksjoner
- Dårlig for kategorier/underprodukter
- Vanskelig å ranke på flere keywords
- Tung første-load

---

## Når skal du bruke hierarkisk struktur?

**Bruk hierarkisk struktur når:**
- Flere målgrupper som trenger forskjellig innhold (kunder, partnere, jobbsøkere, journalister)
- Flere produkter/tjenester som fortjener egne sider
- Content-tunge sider (blogg, docs, case studies, ressursbibliotek)
- SEO-strategi krever flere landing pages (én per hovednøkkelord)
- Brukeren kommer tilbake flere ganger (dashbord, e-handel, docs)
- **Eksempler:** e-handel, dokumentasjon, mediesider, konsulentselskaper, agencies

**Fordeler:**
- Skalerer med innhold
- Sterk SEO
- Målrettet CTA per side
- Bedre analytics per intensjon

**Ulemper:**
- Mer navigasjonsdesign
- Høyere terskel til konvertering (flere klikk)

---

## Hybrid — beste av begge (anbefales for de fleste)

En one-page hovedside + få dypere sider for spesialformål:

```
/           → one-page landing (all main content)
/pricing    → detaljert prising-oversikt
/docs       → dokumentasjon
/blog       → SEO-innhold
/about      → team, historie
```

Fungerer super for: SaaS, konsulentselskaper, startups, personlige brands.  
Du får one-page-magien for førstegangs-besøkende **og** dybde for tilbakevendende brukere.

---

## Beslutnings-spørsmål — svar disse 4

1. **Hva er hovedkonverteringen?** (én ting: kjøpe / registrere / kontakte / abonnere)
2. **Hvor mange målgrupper må adresseres?** (én / to / flere)
3. **Hvor mye innhold har du totalt?** (~5 seksjoner / ~15 sider / >50 sider)
4. **Trenger du å ranke på flere Google-nøkkelord?** (nei — én keyword / ja — flere)

---

## Mikes case (2026-02) — anbefalt oppsett

**Svar Mike ga:**
1. Kjøp
2. To — B2C og B2B
3. 6-7 seksjoner
4. Kanskje 2 keywords hvis mulig, ellers 1

### Anbefalt: hybrid — én smart one-page med to targeting-lag + én dyp side

```
/                       → one-page (hovedsalgssiden, både B2C og B2B)
/business  eller /b2b   → dedikert B2B-landing (større kontrakter, demo-CTA)
```

**Hvorfor hybrid og ikke ren one-page?**
- B2C-kjøperen trenger emosjon + rask "kjøp nå"-flyt (~4 min på siden)
- B2B-kjøperen trenger case studies, sikkerhet, integrasjoner, kontrakt-info (~15 min på siden)
- Å tvinge alt inn i én one-page gir kognitiv overbelastning for B2C OG for grunt innhold for B2B
- To sider = to Google-keywords rankable + to separate ad-kampanjer + to separate analytics-trakter

### Struktur — hovedsiden (`/`, one-page, 6-7 seksjoner)

```
1. Hero              → én stor headline, én primær CTA ("Kom i gang" — B2C-fokus)
                       + sekundær link ("For bedrifter →" som tar dem til /business)
2. Problem           → hvorfor dagens løsninger ikke duger (relaterbar smerte)
3. Løsning           → 3 kolonner: hva du får (visuelt, kort)
4. Sosialt bevis     → logoer + kundesitater (1-2 B2C, 1-2 B2B for mixed signal)
5. Priser            → B2C-planer synlig, "Bedriftsplan" som CTA til /business
6. FAQ               → topp 6-8 vanlige spørsmål (SEO-gullgruve)
7. Final CTA         → "Prøv gratis / kontakt salg"
```

### Struktur — B2B-siden (`/business`)

```
1. Hero              → annen headline ("For team og bedrifter"), demo-CTA
2. Bedriftsfordeler  → SSO, sentralisert billing, admin-kontroll
3. Case studies      → 2-3 kort med målbare resultater
4. Sikkerhet         → GDPR, compliance, DPA-nedlasting
5. Integrasjoner     → SSO-provider-logoer, API-info
6. Prising for team  → per-seat-modell, volumrabatt, "book demo"-CTA
7. FAQ (B2B-spesifikk)
8. Kontakt-skjema    → book demo direkte
```

### Design-anbefaling

- Konsistent header/footer på begge sider (samme brand-identitet)
- Én tydelig "switcher" i hero: `Privat | Bedrift` som toggler mellom `/` og `/business`
- Header-nav minimal: logo · Priser · For bedrifter · Logg inn · [primær-CTA]

### Ekstra tips

- **B2C-siden må aldri be om email før verdi er levert** — la dem se pris og komme rett til kjøp
- **B2B-siden må ha "book demo" istedenfor "kjøp"** — B2B kjøper aldri på impuls
- **Én-side-tricket:** gjør navigasjons-links inne på one-page-en til anchor-scroll (`#priser`, `#faq`), så folk kan hoppe rundt uten sidebytte

---

## Neste steg når du er klar

1. Bestem **hva du selger** og **hvem kunden er** (skisse i én setning hver)
2. Kall `design_agent_full_stack` for å produsere design-guideline (fargepalette, typografi, komponent-språk) basert på produktet
3. Bygg one-page først, deretter `/business` som utvidelse

---

## Konsistente tekniske valg (samme som resten av Ko|Do-stacken)

- Next.js App Router + TypeScript + Tailwind
- `shadcn/ui`-komponenter fra `/frontend/src/components/ui/`
- `lucide-react` for ikoner (aldri emoji)
- All config via `.env` (`REACT_APP_BACKEND_URL`, ingen hardkodet)
- `data-testid` på alle interaktive elementer
- i18n fra dag 1 hvis flerspråklig er en mulighet senere
