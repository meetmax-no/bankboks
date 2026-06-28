# Ko|Do · Vault — Distribusjons- og deploy-guide

> **Status:** v3.0.6 (februar 2026)
> **Mål-plattform:** Vercel + Upstash Redis
> **Stack:** Next.js 15 · React 19 · TypeScript · Tailwind · Upstash Redis

Dette dokumentet beskriver hvordan Ko|Do Vault distribueres til produksjon. Selve appen er en **zero-knowledge passord-vault** — alt krypteres klient-side (PBKDF2-SHA256 + AES-256-GCM), serveren ser kun opaque blobs.

---

## 🏗 Arkitektur i produksjon

```
Bruker → Vercel Edge (Next.js 15)
            ↓
       API Routes (/api/vault, /api/cards, /api/vault/events)
            ↓
       @upstash/redis (HTTPS REST API)
            ↓
       Upstash Redis (eu-west-1 eller valgt region)
```

**Hva som lagres på Upstash:**
- `vault:default:data` — kryptert passord-blob (~3 KB pr 20 passord)
- `vault:default:cards` — kryptert kort-blob (~125 KB pr 3 kort med foto)
- `vault:default:events` — server-side event-log (max 100 entries, 30 dagers TTL)

**Hva som ALDRI lagres på server:**
- Master-passord (forlater aldri klienten — D-001)
- Klartekst-data (alt er kryptert før HTTP-request)
- Biometric secrets (WebAuthn PRF-wrapped lokalt)

---

## 🔑 Miljøvariabler (Vercel)

### 🟢 Anbefalt vei — Vercel Marketplace Integration (automatisk)

**Slik er den nåværende prod-instansen satt opp.** Når du kobler Upstash til Vercel via Marketplace, injiseres env-variablene automatisk i alle environments (Production + Preview + Development):

1. Vercel Dashboard → **Storage** → **Browse Marketplace** → **Upstash**
2. Klikk **Add Integration** → velg konto + prosjekt
3. Opprett ny Upstash DB (eller koble eksisterende) → ferdig

Dette gir deg fire env-variabler **automatisk** (ingen manuell registrering):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL` (kompatibilitets-alias)
- `KV_REST_API_TOKEN` (kompatibilitets-alias)

`Redis.fromEnv()` (brukt i `/api/vault`, `/api/cards`, `/api/vault/events`) plukker opp de første to automatisk.

### 🟡 Alternativ — Manuell setup

Hvis du vil bruke en Upstash-DB som ikke er Vercel-integrert (f.eks. annen tenant), legg til disse manuelt i **Vercel Dashboard → Project Settings → Environment Variables**:

| Variabel | Påkrevd | Beskrivelse | Eksempel |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | ✅ Ja | Upstash REST-endepunkt | `https://eu-west-1-xxx.upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ Ja | Upstash REST-token | `AY...long-token` |

**Hvor finner du Upstash-keys?**
1. https://console.upstash.com → velg database
2. Tab **REST API** → kopier `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

### Valgfri variabel (uansett vei)

| Variabel | Påkrevd | Beskrivelse | Eksempel |
|---|---|---|---|
| `NEXT_PUBLIC_CLIENT_CONFIG` | ❌ Nei | Tenant-ID (default: `"default"`) | `"terje"` |
| `NEXT_PUBLIC_ADMIN_CONFIG_HOST` | ❌ Nei | Override admin-host for client-config-fetch | `"https://admin.kodovault.no"` |

> 💡 **NEXT_PUBLIC_CLIENT_CONFIG**:
> - `"default"` → laster `/clients/default.json` lokalt (tenantens egen app-build)
> - `<subdomain>` → fetcher fra `https://admin.kodovault.no/api/client-config?id=<subdomain>` (sentral Upstash, D-060). localStorage-cache 24t for resilience (D-061).
> Default-templaten i bankboks endres manuelt av admin og pushes via Save-to-GitHub. Per-tenant configs i sentral Upstash redigeres via `/platform/admin` → ClientConfigEditor.

---

## 🔑 Admin-modulens env-vars (admin.kodovault.no spesifikt)

Admin-modulen kjører samme bankboks-build, men trenger ekstra env-vars for å provisjonere tenants:

| Variabel | Påkrevd | Beskrivelse |
|---|---|---|
| `CENTRAL_KV_REST_API_URL` | ✅ Ja | Sentral Upstash for tenant-registry, invites, client-configs, rate-limit |
| `CENTRAL_KV_REST_API_TOKEN` | ✅ Ja | Sentral Upstash-token |
| `ADMIN_PASSWORD_HASH` | ✅ Ja | bcrypt-hash av admin-passord. **Bruk single-quotes** rundt verdien — `$`-tegn ekspanderes ellers av shell. |
| `ADMIN_SESSION_SECRET` | ✅ Ja | HMAC-nøkkel for admin-cookie (random 32+ tegn) |
| `TURNSTILE_SITE_KEY` | ✅ Ja | Cloudflare Turnstile public site-key |
| `TURNSTILE_SECRET_KEY` | ✅ Ja | Cloudflare Turnstile secret |
| `VERCEL_API_TOKEN` | ✅ Ja | Programmatic Vercel-tilgang for provisjonering (Project-scope) |
| `VERCEL_TEAM_ID` | ❌ Nei | Hvis prosjektene tilhører et team |
| `UPSTASH_MANAGEMENT_EMAIL` | ✅ Iter 9 | Konto-epost for Upstash Management API (Basic Auth-bruker) |
| `UPSTASH_MANAGEMENT_API_KEY` | ✅ Iter 9 | Upstash Management PAT — auto-provisjonering av per-tenant DB i `eu-west-1` |
| `CRON_SECRET` | ❌ Nei | Bearer-token for `/api/cron/cleanup-pending`. Hvis ikke satt: Vercel sin `x-vercel-cron`-header trengs (auto ved skedulerte kall) |
| `RESEND_API_KEY` | ✅ Iter 10 | Transactional e-post (velkomstmail via Resend) |
| `RESEND_FROM_EMAIL` | ✅ Iter 10 | From-header (`vault@kodovault.no` etter DNS-verifisering) |
| `EMAIL_ENABLED` | ✅ Iter 10 | Eksplisitt enable-flagg (`true` for å aktivere) |
| `TELEGRAM_BOT_TOKEN` | ✅ Iter 10 | Bot Token fra @BotFather |
| `TELEGRAM_CHAT_ID` | ✅ Iter 10 | Chat-ID til Mike (med minus for grupper) |
| `TELEGRAM_ENABLED` | ✅ Iter 10 | Eksplisitt enable-flagg (`true` for å aktivere) |

**⚠️ Tokens som IKKE trengs:**
- ~~`GITHUB_API_TOKEN`~~ — vurdert i D-057, forkastet i D-060. Provisjonering rører ikke bankboks-repo.

---

## 🚀 Førstegangs deploy (Vercel)

### 1. Forberedelse
- ✅ GitHub-repo: `meetmax-no/bankboks`
- ✅ Vercel-konto koblet til GitHub

### 2. Importer repo til Vercel
1. Vercel Dashboard → **Add New Project**
2. Velg `meetmax-no/bankboks`
3. **Framework Preset:** Next.js (overstyres uansett av `vercel.json`)
4. **Root Directory:** `frontend/`
5. **Build Command:** `next build` (auto fra `vercel.json`)
6. **Install Command:** `yarn install` (auto fra `vercel.json`)
7. Klikk **Deploy** — første build vil feile pga manglende Upstash-keys. Det er ok — vi fikser det i neste steg.

### 3. Koble Upstash via Marketplace
1. Vercel Dashboard (samme prosjekt) → **Storage** → **Browse Marketplace**
2. Velg **Upstash** → **Add Integration**
3. Velg eksisterende DB eller opprett ny (Free-tier holder for ~10K commands/dag)
4. Vercel injiserer alle env-variabler automatisk

### 4. (Valgfritt) Multi-tenant variabel
Hvis dette er en tenant-deploy (ikke `default`), legg til `NEXT_PUBLIC_CLIENT_CONFIG=<tenant-id>` manuelt under Project Settings → Environment Variables.

### 5. Redeploy
Vercel Dashboard → Deployments → siste deploy → **... → Redeploy** (eller push en commit).

### 6. (Valgfritt) Custom domene
Se egen seksjon **"🌐 DNS — Custom domener"** lenger ned.

---

## 🌐 DNS — Custom domener

Slik kobler du f.eks. `lisbeth.kodovault.no` til en Vercel-deploy:

### 1. I Vercel Dashboard (riktig prosjekt)
- Settings → **Domains** → **Add Domain**
- Skriv inn: `lisbeth.kodovault.no`
- Vercel viser eksakte DNS-instruksjoner — følg dem (de overstyrer evt. avvik i denne dokumentasjonen)

### 2. Hos hosting-/DNS-leverandør for `kodovault.no`

**For subdomene (`lisbeth.kodovault.no`) — bruk CNAME:**

| Type | Navn | Verdi | TTL |
|------|------|-------|-----|
| `CNAME` | `lisbeth` | `cname.vercel-dns.com` | 3600 |

> ⚠️ **Ikke** pek CNAME til `kodo-vault-lk.vercel.app` direkte. Bruk `cname.vercel-dns.com` — det er Vercels stabile DNS-target som ruter trafikk basert på Host-header.

**For apex-domene (`kodovault.no` uten subdomene) — bruk A-record eller ALIAS:**

| Type | Navn | Verdi | TTL |
|------|------|-------|-----|
| `A` | `@` | `76.76.21.21` | 3600 |

Eller (hvis leverandøren støtter det — anbefalt):

| Type | Navn | Verdi | TTL |
|------|------|-------|-----|
| `ALIAS` / `ANAME` | `@` | `cname.vercel-dns.com` | 3600 |

> 💡 Sjekk Vercel Dashboard for **eksakt IP** ved deploy — den kan endres over tid. `76.76.21.21` er gjeldende per februar 2026.

### 3. Verifisere propagering

```bash
# Sjekk CNAME (kan ta 5 min – 24 t å propagere)
dig lisbeth.kodovault.no CNAME +short
# Forventet: cname.vercel-dns.com.

# Sjekk A-record (apex)
dig kodovault.no +short
# Forventet: 76.76.21.21
```

### 4. TLS-sertifikat

- Vercel utsteder **Let's Encrypt-cert automatisk** når DNS peker rett vei
- Vanligvis: 2–5 minutter etter DNS er propagert
- Status i Vercel: Domains-fanen viser ✅ **Valid Configuration** når alt er klart

### Subdomene-strategi for multi-tenant

Anbefalt mønster:

| Tenant | Subdomene | Vercel-prosjekt | Upstash-DB |
|---|---|---|---|
| Mike (deg) | `vault.kodovault.no` eller `kodovault.no` | `kodo-vault` | DB-1 |
| Lisbeth | `lisbeth.kodovault.no` | `kodo-vault-lk` | DB-2 |
| Firma X | `vault.firmax.no` (eller `firmax.kodovault.no`) | `kodo-vault-firmax` | DB-3 |

Hver tenant får:
- 🌐 Eget subdomene (eller helt eget domene)
- 🚀 Eget Vercel-prosjekt (= egen build, egen logg, egen rollback)
- 🗄 Egen Upstash-DB (= 100% data-isolasjon)
- 🎨 Egen `<tenant>.json` config (brand, farger, security-policy)
- 🔐 Egen WebAuthn-relying-party (Touch ID er bundet til domenet)

> ⚠️ **WebAuthn-merknad:** Hvis du flytter en tenant mellom domener, må alle brukere registrere Touch ID på nytt. Credentials er kryptografisk bundet til opprinnelig domene.

---

---

## 🔄 Vanlig deploy-flyt (etter første gang)

Vercel auto-deployer på hver push til `main`:

```bash
# Lokalt
git add .
git commit -m "v3.0.6 — selective backup polish"
git push origin main
# → Vercel build trigges automatisk → live på ~90s
```

**Eller via Emergent:** Bruk "Save to GitHub"-knappen i chat-input.

### Preview-deploys
- Hver PR / branch får automatisk en preview-URL
- Bruk samme env-variabler (Vercel deler dem som standard)

---

## 🌐 Multi-tenant deploy (fremtidssikker)

Per i dag kjører vi **single-tenant** (`default`). For å hoste en variant pr klient:

1. **Lag tenant-config:** Kopier `frontend/public/clients/default.json` → `frontend/public/clients/firma-x.json`
2. **Tilpass innhold:** brand-navn, farger, security-policy, bilder
3. **Nytt Vercel-prosjekt** med samme repo:
   - Koble en **egen Upstash-DB** via Marketplace (gir 100% data-isolasjon — egne nøkler, egen kvote, egne backups)
   - Legg til `NEXT_PUBLIC_CLIENT_CONFIG=firma-x` manuelt under env-variables
4. **Eget domene:** `vault.firma-x.no`

Dette gir total isolasjon — hver tenant har sin egen krypterte blob i sin egen Upstash-DB.

---

## 🗄 Upstash — Detaljert oppsett

### Anbefalt konfigurasjon

| Innstilling | Anbefaling | Hvorfor |
|---|---|---|
| **Type** | Redis | Eneste vi støtter (ikke Kafka/Vector/QStash) |
| **Region** | `eu-west-1` (Frankfurt/Dublin) | Lavest latens for norske brukere — viktig for snappy UX |
| **Primary Region Only** | ✅ Ja | Global replication trenger vi ikke for én bruker pr tenant |
| **TLS** | ✅ Påkrevd | Standard på alle nye Upstash-DBer |
| **Eviction Policy** | `noeviction` | Vault-data skal aldri droppes pga minnemangel |

> 💡 **Én Upstash-DB pr tenant** — gir 100% data-isolasjon, separate metrics, separate kvoter. Aldri del en DB mellom tenants.

### Pay-as-you-go vs Free-tier

Ko|Do Vault prod kjører på **Pay-as-you-go** (ikke Free-tier). Grunner:

- Bruker har allerede flere DBer i kontoen sin (Free-tier er begrenset til 1 DB pr konto)
- Pay-as-you-go har ingen daglige command-grenser → sikker drift uavhengig av brukerantall
- Pris-skala følger faktisk bruk — billig for tomme/lite-brukte DBer

**Kostnad per tenant i praksis:**
- Lett bruk (1–5 daglig aktive): ~$0.01–0.05/mnd
- Tung bruk (50 daglig aktive): ~$1–2/mnd
- Ko|Do Vault data-mengde er minimal (~150 KB pr bruker), så kostnaden drives av antall commands, ikke storage

> 📊 **Tips:** Upstash Console → tab **Usage** viser månedlig kost pr DB. Sett opp **Budget Alert** (Settings → Billing) for å få varsel ved uventet bruk-spike.

### Free-tier — kun for testing
| | Free | Pay-as-you-go |
|---|---|---|
| Daily commands | 10 000 | Unlimited |
| Max DB size | 256 MB | 100 GB |
| Antall DBer pr konto | 1 | Unlimited |

Free-tier er ok for et helt nytt prosjekt der du tester — men i det øyeblikk du har flere enn én tenant eller bruker er over 5K commands/dag, må du på Pay-as-you-go.

### Hvilke keys oppretter Ko|Do Vault?

Per tenant lages disse keys i Upstash (alle BINARY/STRING-typer, ingen TTL bortsett fra events):

```
vault:<tenant>:data       — Passord-blob (kryptert envelope)
vault:<tenant>:cards      — Kort-blob (kryptert envelope, lazy)
vault:<tenant>:events     — Hendelses-log (LIST, max 100, 30d TTL pr entry)
vault:<tenant>:ratelimit  — Rate-limit counter (transient, kort TTL)
```

`<tenant>` = `default` (eller verdien av `NEXT_PUBLIC_CLIENT_CONFIG`).

### Sjekk DB-helsetilstand

**Via Upstash Console:**
1. https://console.upstash.com → velg DB
2. Tab **Data Browser** → søk `vault:default:*` → ser alle keys
3. Tab **Metrics** → sjekk daily commands, throughput, errors

**Via curl (rask sanity-check):**
```bash
# Erstatt med dine faktiske keys
curl -s "$UPSTASH_REDIS_REST_URL/get/vault:default:data" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" | head -c 200
# Forventet: { "result": "...long base64 envelope..." } eller { "result": null }
```

### Backup av Upstash-data

**Viktig:** Upstash gjør **automatiske daglige backups** på alle plans, men disse er ikke synlige for deg. For full kontroll:

1. **Brukerens egen backup-fil** (anbefalt) — `kodo-vault-backup-*.json` er den kanoniske kopien (se v3.0.5 selektiv backup). Bruker er ansvarlig for å eksportere regelmessig.
2. **Server-side dump** (nødfall) — fra Upstash Console: Settings → Backups → Restore til ny DB.

> ⚠️ Selv om Upstash-data går tapt, kan bruker restore alt fra sin lokale `.json`-backup. Server er "kun en mellomstasjon" — ekte source of truth er master-pwd + backup-fil.

### Migrering mellom Upstash-DBer

Hvis du må flytte en tenant til ny region eller plan:

1. **Få bruker til å eksportere full backup** (Innstillinger → Eksporter)
2. **Koble nytt Vercel-prosjekt til ny Upstash-DB** (via Marketplace)
3. **Deploy** med samme `NEXT_PUBLIC_CLIENT_CONFIG`
4. **Bruker importerer backup-fila** på nytt domene → alt restaureres
5. (Valgfritt) Slett gammel DB etter verifisering

Dette fungerer fordi all data ligger i den krypterte filen — Upstash er bare transport.

### Hva som ALDRI skal ligge i Upstash

- ❌ Klartekst-passord eller -PIN
- ❌ Master-passord (forlater aldri klienten)
- ❌ Service-tokens / API-keys fra andre systemer
- ❌ Personalia i klartekst

Hvis du noensinne ser ikke-kryptert data i en `vault:*`-key, **stopp deploy umiddelbart** og kontakt utvikler. Det er et brudd på D-001 North Star.

---

## 🧪 Testing før deploy

```bash
cd /app/frontend

# 1. Type-check
npx tsc --noEmit

# 2. Lokal build (samme som Vercel kjører)
yarn build

# 3. Offline crypto-tester
for f in lib/__tests__/*.test.ts; do
  echo ">>> $(basename $f)"
  npx tsx "$f"
done

# 4. Dev-server (manuell E2E)
yarn start  # = next dev -H 0.0.0.0 -p 3000
```

Forventet output: alle 6 testfiler grønne, build ferdig på ~20 sek.

---

## 🩹 Vanlige feilsituasjoner

### ❌ Build feiler på Vercel: `Cannot find module '@upstash/redis'`
**Årsak:** Yarn cache er korrupt.
**Fiks:** Vercel Dashboard → Project Settings → Clear Build Cache → Redeploy.

### ❌ 401 / 403 fra `/api/vault`
**Årsak:** Upstash-token er feil eller utløpt.
**Fiks:** Sjekk `UPSTASH_REDIS_REST_TOKEN` i Vercel env. Generer ny token i Upstash konsoll.

### ❌ Touch ID virker ikke i prod
**Årsak:** WebAuthn krever HTTPS + samme domene som ble brukt under registrering.
**Fiks:** Verifiser at custom-domene er korrekt satt opp. WebAuthn-credentials er bundet til domenet.

### ❌ "Synkroniserer..." står evig
**Årsak:** Upstash REST-endepunkt ikke nådd (region-issue eller token mangler).
**Fiks:** Browser DevTools → Network → se status på `/api/vault`. Sjekk Vercel env.

### ❌ CORS-feil
**Skal aldri skje** — API-routes ligger på samme domene som frontend. Hvis du ser CORS-feil, sjekk at API-kall bruker relative URL-er (`/api/...`) og ikke `http://localhost:...`.

---

## 🔒 Sikkerhets-sjekk før hver deploy

- [ ] `default.json` inneholder ikke noe sensitivt (passord, tokens, keys)
- [ ] `.env*`-filer er i `.gitignore` (de SKAL ALDRI committes)
- [ ] PBKDF2-iterasjoner uendret (600 000 — D-001)
- [ ] Ingen `console.log` av master-pwd eller decrypted payloads
- [ ] CSP-headers (hvis aktivert i `next.config.js`) tillater WebAuthn

---

## 📦 Restore fra disaster

Hvis Vercel-prosjektet forsvinner / går ned:

1. **Koden er trygg:** GitHub-repo `meetmax-no/bankboks` har alt
2. **Dataen er trygg:** Upstash beholder krypterte blobs uansett
3. **Bruker har backup:** Hver bruker har egen `kodo-vault-backup-*.json` (lokalt, kryptert)
4. **Rebuild:** Følg "Førstegangs deploy" over → 5–10 minutter til live

Bruker kan deretter importere sin backup-fil → full restore. **Master-passordet kan ikke gjenopprettes — det ligger kun i brukers hode.**

---

## 📚 Relaterte dokumenter

- [`PRD.md`](./PRD.md) — Produkt-kravspesifikasjon
- [`ROADMAP.md`](./ROADMAP.md) — Versjonshistorikk og plan
- [`DECISIONS.md`](./DECISIONS.md) — Architecture Decision Records (ADR)
  - **D-001** — 100% North Star (sikkerhet)
  - **D-002** — Lazy-load av kort-blob
  - **D-021** — Selektiv backup med smart re-kryptering

---

**Sist oppdatert:** 2026-02-16 (v3.0.6)
