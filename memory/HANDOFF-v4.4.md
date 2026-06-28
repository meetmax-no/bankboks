# Ko | Do · Vault — HANDOVER-NOTA (2026-06-23, økt-slutt)

> Formålet med dette dokumentet er at en ny agent kan ta over uten å starte
> forfra eller gjenta de samme feilene som ble gjort i forrige økt. Kun
> fakta. Ingen unnskyldninger.

---

## 0. OPPSTART FOR NESTE AGENT — LES DETTE FØRST

### Kildekoden ligger på GitHub (public)
**Repo:** `github.com/meetmax-no/bankboks` (public, ingen auth nødvendig)

### Riktig oppstart-rekkefølge
1. **Klon repoet til `/app`** slik at `.git` følger med, ellers virker
   IKKE Emergent's "Save to Github"-funksjon når Mike trykker den senere.
2. Ikke pakk ut til en sub-mappe — kodebasen MÅ ligge direkte i `/app/`
   med strukturen:
   ```
   /app/frontend/    ← Next.js-appen
   /app/memory/      ← PRD, ADR, HANDOFF, ROADMAP, CHANGELOG
   /app/.git/        ← MÅ være intakt for Save to Github
   /app/.emergent/   ← MÅ være intakt for Emergent-plattformen
   ```
3. Hvis `/app` allerede har en eksisterende repo-state fra forrige økt,
   IKKE klon på nytt — bruk det som er der. `git log` viser om `meetmax-no/
   bankboks`-historikken er intakt.

### Kommandoer for fersk oppstart (hvis nødvendig)
```bash
cd /app
# Hvis /app er tomt:
git clone https://github.com/meetmax-no/bankboks.git .
# (Punktum på slutten — klon INN i /app, ikke til ny mappe)

# Verifiser:
git log --oneline -5     # Skal vise siste commits
ls memory/HANDOFF*.md    # Skal vise v4.1, v4.2, v4.3, v4.4
```

### Når Mike trykker "Save to Github"
- Emergent commits + pusher til `main` på `meetmax-no/bankboks`
- Vercel auto-deployer fra `main` (~60s)
- Mike kan så teste i prod via `admin.kodovault.no` → MailTestCard, eller
  ved å trigge cron, eller ved direkte besøk på `*.kodovault.no`
- DU har IKKE tilgang til denne knappen — den ligger i Emergent-chat-UI

### Førsteoppgaver for neste agent
1. Les **denne filen** (HANDOFF-v4.4.md) komplett
2. Les `memory/DECISIONS.md` — alle ADR-er
3. Les `memory/ROADMAP.md` — hva som kommer
4. Les `memory/KNOWN-ISSUES.md` — kjente issues
5. Sjekk siste øktes pågående status (§ 5)
6. Spør Mike om hva han vil jobbe med — IKKE start endring uten instruks

### Komplett dokumentasjon i `/app/memory/` — les etter behov

Disse er den autoritative kunnskapsbasen for produktet. Filer er
organisert etter formål:

#### 📌 Daglig referanse (les ofte)
| Fil | Linjer | Hva |
|---|---:|---|
| `HANDOFF-v4.4.md` | 612 | **Denne filen** — siste øktes status, ADR-er, regler |
| `DECISIONS.md` | 3 263 | Alle ADR-er (D-001 … D-070). **Den røde tråden** — hvorfor ting er som de er |
| `ROADMAP.md` | 1 032 | Versjonsplan, kommersielle parametre, Iter-status, backlog |
| `KNOWN-ISSUES.md` | 41 | Aktive ikke-blokkerende issues |
| `PRD.md` | 1 203 | Produkt-spec, North Star, hva som er bygget per versjon |
| `CHANGELOG.md` | 1 961 | Kronologisk leveranselogg |

#### 🏗 Spec-er per versjon (les ved behov for kontekst)
| Fil | Linjer | Hva |
|---|---:|---|
| `v4.0-SPEC.md` | 955 | `.kodoenc`-format, sikker overlevering, mottaker-flyt |
| `v4.1-SPEC.md` | 533 | ID-blob (Pass, Førerkort, ID-kort, Helse/forsikring) |
| `v4.2-PROGRESS.md` | 463 | i18n-leveranse (NO/SV/DA/EN) |
| `v4.3 Spec.md` | 431 | Stripe-integrasjon high-level |
| `v4.3 Utviklingsplan.md` | 889 | **24 Iterasjoner detaljert** — sannhetskilde for Iter 0–24 |
| `v4.3-GJENSTÅENDE-ITERASJONER.md` | 219 | Iter 20–24 scope (B2B, edge cases) |
| `v4.5-DESIGN.md` | 539 | Auto-deployment Lean Security som tjeneste |
| `v5.0-DESIGN.md` | 282 | BYO Drive dokument-laget |

#### 📐 Konvensjoner og standarder (les FØR du endrer relevant kode)
| Fil | Linjer | Hva |
|---|---:|---|
| `i18n-CONVENTIONS.md` | 462 | **Definitiv guide** for i18n — nøkkel-format, fallback-kjede, hva som oversettes, ekstrakjonsregler. Les FØR du legger til UI-strenger |
| `DEPLOYMENT.md` | 430 | Vercel + Upstash + DNS multi-tenant onboarding-guide |
| `STRIPE_PORTAL_SETUP.md` | 49 | Stripe Customer Portal-konfig |

#### 💼 Forretningskontekst (les for stor-bildet)
| Fil | Linjer | Hva |
|---|---:|---|
| `BUSINESS-CASE.md` | 298 | Lean Security-filosofien, prismodell, persona-detaljer |
| `v4.4-PRODUCT-FLYER.md` | 105 | Two-pager produkt-flyer (markedsmateriell) |
| `v4.4-PRODUCT-FLYER.html` | — | Utskrifts-klar HTML-versjon |

#### 📚 Historiske handover-noter (referanse for tidligere økter)
| Fil | Linjer | Hva |
|---|---:|---|
| `HANDOFF-v4.1.md` | 350 | v4.1 ID-blob-økt |
| `HANDOFF-v4.2.md` | 367 | v4.2 språkdrakt-økt |
| `HANDOFF-v4.3.md` | 459 | v4.3 Stripe + lifecycle-økt |

### Anbefalt lese-rekkefølge ved fersk oppstart
1. **HANDOFF-v4.4.md** (denne) — full kontekst på siste økt
2. **DECISIONS.md** — minst § D-001 (North Star), D-070 (Stripe-bevaring),
   D-049 (just-in-time customer), D-035 (auth-modell), D-068 (mail-notify),
   D-024 (PRF version-detect). Resten ved behov.
3. **ROADMAP.md** § "Iter-status" + § "Backlog" — hva som er gjort, hva
   som er neste
4. **KNOWN-ISSUES.md** — kort, ta hele
5. **v4.3 Utviklingsplan.md** — hvis du jobber med Iter 20+

### Tabell over kodebase-kommentarer som FORBYR endring
Følgende inline-kommentarer i koden er ikke ren dokumentasjon — de er
ADR-håndhevelse. ALLE fortelles av relevant ADR. Aldri rør koden i
nærheten uten å sjekke ADR-en først:

- `app/page.tsx` — bg-wrapper: "Aldri legge `isolation: isolate` her" (D-022)
- `app/page.tsx` — flex-barn-wrapper: "Aldri fjern denne diven" (D-022)
- `lib/webauthn.ts` — `isPrfLikelySupported()`: "UA-sniffing er bevisst" (D-024)
- `lib/platform/notify-email.ts` — `resolveLocale()`: "Aldri returner ny default" (Iter 19.9)
- `lib/platform/delete-tenant.ts` — Stripe-rydding: "Stripe customer røres ALDRI" (D-070)

### Hva skal IKKE gjøres i fersk oppstart
- ❌ Ikke gjør `rm -rf /app/.git` — ødelegger Save to Github
- ❌ Ikke flytt filer ut av `/app/frontend/` til andre kataloger
- ❌ Ikke installer node_modules på nytt før Mike sier det trengs
  (`yarn install` kjøres automatisk av Vercel ved deploy)
- ❌ Ikke kjør `git push` direkte — det går via Emergent's Save to Github
- ❌ Ikke endre `.env`-filer — bruk env-vars som er der

---

## 1. ARKITEKTUR OG TEKNISK STACK

### Stack
- **Frontend + Backend:** Next.js 15.2.6 (App Router) + React 19 + TypeScript 5
- **Styling:** Tailwind 3.4, Radix UI, shadcn/ui-komponenter, Lucide-ikoner
- **Database (sentral plattform):** Upstash Redis (TLS, REST API via `@upstash/redis ^1.37`)
- **Database (per tenant):** Egen Upstash Redis-instans, allokert ved provisjonering
- **Hosting:** Vercel (plattform-host + ett Vercel-prosjekt per kommersiell tenant)
- **Auth (admin):** Bcrypt-hashet master-pwd + HMAC-signert cookie (`/platform/admin`)
- **Auth (tenant-bruker):** Master-passord + WebAuthn PRF (Touch ID/Face ID), klient-side
- **Krypto:** PBKDF2-SHA256 (600 000 iter) → AES-256-GCM, alt klient-side
- **Bot-beskyttelse:** Cloudflare Turnstile (invisible mode)
- **Mail:** Resend SDK `^6.12.4` — sender lifecycle-mailer (NO/SV/DA/EN)
- **Betaling:** Stripe SDK `^22.2.0` — subscriptions, checkout, customer portal
- **PWA:** Vanilla `public/sw.js`, manifest, `PWAInstallHint`-komponent
- **Test/lint:** `tsx` for Node-tester, `next lint`, egne `tsx`-baserte ADR-lint-skript

### Kritiske avhengigheter (eksterne tjenester)
| Tjeneste | Bruk | Nøkkel i `.env` |
|---|---|---|
| **Upstash Redis (sentral)** | Plattform-DB, tenant-records, invitter, audit | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Upstash Redis (per tenant)** | Vault-blobs, sessions | Allokert dynamisk, lagres i `tenant.kvCreds` |
| **Vercel API** | Provisjonering av tenant-prosjekt, subdomain-attach | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` |
| **Stripe** | Subscriptions, webhooks, customer portal | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| **Resend** | Lifecycle-mail (Iter 10, 16, 17) | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ENABLED` |
| **Cloudflare Turnstile** | Bot-beskyttelse på register | `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| **Telegram (valgfri)** | Mike får varsel ved provisjonering | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENABLED` |

### Miljøvariabler agenten må kjenne til
- `EMAIL_ENABLED=true` må være satt for at mail faktisk sendes (default false i dev/test)
- `STRIPE_MODE=test|live` styrer hvilke Stripe-keys som brukes
- `NEXT_PUBLIC_VAULT_DOMAIN` = `kodovault.no` (brukes i mail-templates og admin)
- `ADMIN_PWD_HASH`, `ADMIN_COOKIE_SECRET` = admin-auth
- `TURNSTILE_BYPASS=true` slår av Turnstile lokalt for testing

### Kodearkitektur (kataloger)
```
/app/frontend/
├── app/                          # Next.js App Router
│   ├── (host)/                   # Tenant-app (vault, billing)
│   ├── platform/                 # Plattform-UI (admin, register, test)
│   ├── unpack/                   # v4.0 mottaker-flyt (.kodoenc)
│   └── api/                      # API-ruter
│       ├── account/delete/       # GDPR self-serve sletting
│       ├── admin/                # Admin CRUD + provisjonering
│       ├── billing/              # Stripe checkout, portal
│       ├── cron/                 # lifecycle-sweep, cleanup-pending
│       ├── invite/               # B2B-invite validering + accept
│       ├── platform-register/    # Trial-registrering (offentlig)
│       └── webhook/              # Stripe webhook-handler
├── components/                   # React-komponenter
│   ├── AppHeader.tsx             # NB: navigator.onLine via useEffect (#418-fix)
│   ├── platform/                 # Admin + register-UI
│   │   ├── MailTestCard.tsx      # Sender testmail med locale-override
│   │   ├── TenantViewer.tsx      # Admin tenant CRUD
│   │   ├── PWAInstallHint.tsx    # iOS+Android unified install-prompt
│   │   └── LocaleRadioGroup.tsx  # Iter 19.9: obligatorisk locale-valg
│   └── ui/                       # shadcn primitives
├── hooks/                        # useVault, useCards, useIds, useIsSafari, ...
├── lib/                          # Forretningslogikk
│   ├── platform/                 # Plattform-laget
│   │   ├── provisioning.ts       # Vercel + Upstash + sentral DB
│   │   ├── notify-email.ts       # Mail-rendering + sending via Resend
│   │   ├── notify-telegram.ts    # Mike-varsel
│   │   ├── lifecycle.ts          # Cron-handler for trial→lock→delete
│   │   ├── stripe-*.ts           # Checkout, portal, customer-mgmt
│   │   ├── delete-tenant.ts      # GDPR-sletting (Vercel + Upstash + DB)
│   │   ├── email-templates/      # 24 HTML-filer (6 typer × 4 språk)
│   │   ├── client-config.ts      # Sentral tenant-config (D-060)
│   │   ├── reserved-subdomains.json
│   │   └── plans.json            # Pris/plan single source of truth (D-042)
│   ├── i18n.ts                   # t()/tHook()/translate() (NO/SV/DA/EN)
│   ├── locales/                  # no.json (referanse), sv.json, da.json, en.json
│   ├── backup-registry.ts        # BackupBlobSource-registry (D-021)
│   ├── webauthn.ts               # PRF + isPrfLikelySupported (D-024)
│   ├── tenant-status-cache.ts    # 60-sek cache av tenant-lookup
│   └── __tests__/                # tsx-baserte testsuiter
└── public/
    ├── sw.js                     # Vanilla service worker (PWA)
    ├── manifest.json
    └── clients/                  # Per-tenant config-JSON (legacy fallback)
```

---

## 2. HVA SOM ER BYGGET OG FUNGERER

### Kjernevault (v2.9.5 → v4.2, alt i prod)
| Komponent | Status | Filer |
|---|---|---|
| Passord-blob (`vault:<sub>`) + CRUD | ✅ Prod | `hooks/useVault.ts`, `app/api/vault/route.ts` |
| Cards-blob (`vault:<sub>:cards`) | ✅ Prod | `hooks/useCards.ts`, `app/api/cards/route.ts` |
| ID-blob (`vault:<sub>:ids`) — Pass, Førerkort, ID-kort, Helse/forsikring | ✅ Prod | `hooks/useIds.ts`, `app/api/ids/route.ts` |
| Master-passord + WebAuthn PRF + Touch ID | ✅ Prod | `lib/webauthn.ts`, `hooks/useVault.ts` |
| Auto-lås (15 min idle, konfigurerbar) | ✅ Prod | `hooks/useAutoLock.ts` |
| Clipboard 120s + manuell slett + "tett skip"-modus | ✅ Prod | `lib/clipboard.ts`, `components/AppHeader.tsx` |
| Custom kamera-fangst (ALDRI Camera Roll, D-014/D-020) | ✅ Prod | `components/CameraCapture.tsx` |
| Bilde-komprimering + crop | ✅ Prod | `lib/image-compress.ts`, `components/CardCropper.tsx` |
| Selektiv backup eksport/import + smart re-kryptering (D-021) | ✅ Prod | `components/BackupExportModal.tsx`, `BackupImportModal.tsx` |
| Cmd+K søk (alle blobs, streng substring) | ✅ Prod | `components/CommandPalette.tsx` |
| Vannmerke-eksport (klassisk diagonal "KOPI", D-034) | ✅ Prod | `components/IdAttachmentExporter.tsx` |
| Per-browser glass-arkitektur (Safari-fix, D-023) | ✅ Prod | `hooks/useIsSafari.ts`, `app/page.tsx`, `app/globals.css` |
| Språkdrakt NO/SV/DA/EN | ✅ Prod | `lib/i18n.ts`, `lib/locales/*.json` |

### v4.0 — Sikker overlevering (`.kodoenc`)
| Komponent | Status | Filer |
|---|---|---|
| Pakke-bygger + engangs-pwd | ✅ Prod | `app/page.tsx` (PackageBuilder) |
| `/unpack`-ruten (mottaker, zero-server, D-026) | ✅ Prod | `app/unpack/page.tsx` |
| `.kodoenc`-format (minimum klartekst-header, D-025) | ✅ Prod | `lib/package.ts` |

### v4.3 — Stripe + tenant-lifecycle (Iter 0–19, prod)
| Iter | Leveranse | Filer |
|---|---|---|
| 0 | Admin-auth (bcrypt + HMAC-cookie) | `lib/admin-auth.ts`, `app/platform/admin/` |
| 1 | Sentral Upstash + TenantViewer CRUD | `lib/platform/tenant-store.ts` |
| 2 | Subdomain-validering + reserverte navn (D-038, D-041) | `lib/platform/reserved-subdomains.json`, `subdomain-check` |
| 3 | `/platform/test` plan-velger (4 plans, D-042) | `app/platform/test/`, `plans.json` |
| 4 | `/platform/register` + public subdomain-check | `app/platform/register/` |
| 5 | Turnstile invisible | `components/platform/TurnstileWidget.tsx` |
| 6 | Rate-limiting (Upstash, delt bucket, fail-open D-048) | `lib/platform/rate-limit.ts` |
| 7 | POST `/api/register` — trial uten Stripe customer (D-049) | `app/api/register/route.ts` |
| 7.5 | Admin-modulen: customerType-form, Stripe-kobling, overstyring | `components/platform/admin/` |
| 7.6 | Invitasjonslenke-flyt for B2B (D-056) | `app/api/invite/*`, `app/invite/` |
| 8 | Vercel auto-provisjonering (createProject + env + subdomain) | `lib/platform/vercel-provision.ts` |
| 8.3 | Client-config flyttet til sentral Upstash (D-060) | `lib/platform/client-config.ts`, `app/api/client-config/` |
| 9 | Komplett provisjonerings-stack (D-063→D-067) + ProvisioningTracker | `lib/platform/provisioning.ts`, `app/api/status/` |
| 10 | Velkomstmail + Telegram-varsel | `lib/platform/notify-email.ts`, `notify-telegram.ts` |
| 11–14 | Stripe checkout, trial→paid-konvertering (D-045+D-049), webhook, `/billing/upgrade`-side, resume-banner | `lib/platform/stripe-*.ts`, `app/billing/upgrade/` |
| 17 | Lifecycle-mailer (A1 trial-reminder-t5, A2 locked-from-trial, A3 lifecycle-warning, A4 deleted-confirmation, B1 locked-from-cancel, Welcome) | `lib/platform/email-templates/` (24 filer) |
| 18.5 | In-vault upgrade banner (D-050) | `components/platform/UpgradeBanner.tsx` |
| 19 | Paywall-overlay | `components/platform/PaywallOverlay.tsx` |
| 19.5 | Stripe Customer Portal | `lib/platform/stripe-portal.ts` |
| 19.9 | **Obligatorisk locale-valg ved registrering** — 4-språk mal-pakke + radio-gruppe på `/register` + `/invite` + backend-validering | `components/platform/LocaleRadioGroup.tsx`, all `notify-email.ts`-helpers utvidet til 4 språk |

### Cron-jobber
- `GET /api/cron/lifecycle-sweep` — kjøres daglig av Vercel Cron, trigger trial-reminder → lock → warning → delete-flyt
- `GET /api/cron/cleanup-pending` — rydder utløpte B2B-invites
- `GET /api/cron/cleanup-pending-tenants` — rydder provisjoneringer som hang

### GDPR / sletting
- `POST /api/account/delete` — self-serve, krever master-pwd-verifikasjon klient-side, kaller `deleteTenant(sub, "gdpr")`
- `deleteTenant()` i `lib/platform/delete-tenant.ts` — atomisk Vercel + Upstash + sentral DB-rydding, sender A4-bekreftelses-mail før sletting

### Bekreftet fungerende (verifisert i prod siste 30d)
- Selvbetjent GDPR-sletting av `max.kodovault.no` (Mike testet 2026-06-23)
- Stripe trial → paid-konvertering med just-in-time customer-opprettelse
- 4-språk mail-rendering med locale-override via admin `MailTestCard`
- Touch ID på iPhone (PRF-extension, Safari 18+)
- Per-browser glass-rendering Chrome + Safari
- Backup eksport/import med pwd-mismatch → smart re-kryptering

---

## 3. ARKITEKTUR-BESLUTNINGER SOM IKKE MÅ RØRES

Alle ADR-er ligger i `/app/memory/DECISIONS.md`. Disse er **låst** — agent
som foreslår noe som motsier dem MÅ avvise eget forslag og henvise til
ADR-en. Krever eksplisitt brukervedtak for revisjon.

### Prinsipielle (kjernen)
- **D-001 — 100% North Star.** Aldri 95%-løsninger. Honor-system, soft-delete,
  passord-hint, recovery-spørsmål, subdomene-basert auth — alt FORBUDT.
- **D-005 — Advokat (Lars) som primær persona.** Journalist-features
  (decoy, self-destruct, Tor) skal IKKE smitte arkitekturen.
- **D-006 — Mental modell "virtuell sikker disk".** Filer eksisterer kun når
  vault er ulåst; auto-lås = demonter = filene "forsvinner".

### Zero-knowledge / krypto
- **D-002 / D-012 / D-033** — Separate Upstash-blobs per data-type (vault,
  cards, ids), samme master-pwd, ulik salt, lazy-loaded.
- **D-007 — ZIP STORE-modus** (ingen kompresjon) i v4.0 og fremtidige
  containere.
- **D-013 — Tre-blob-arkitektur** (vault + cards + ids).
- **D-014 / D-020 — Custom kamera-fangst KUN.** Aldri `<input type="file">`
  som åpner Camera Roll. iCloud-lekkasje er bannlyst.
- **D-025 — Minimum klartekst-header i `.kodoenc`.** Kun KDF + cipher i
  klartekst; alt annet (createdAt, appVersion, filcount) krypteres.
- **D-026 — Zero-server for `/unpack`-ruten.** Ingen API-kall, ingen
  analytics, ingen third-party scripts.
- **D-027 — `.kodoenc`-filformat (binær envelope).** Fremtidssikker.

### Auth / WebAuthn
- **D-010 — TOTP integrert i passord-oppføringer** (degradert til nice-to-have).
- **D-024 — PRF krever Safari 18+ / Chrome 132+.** Pre-flight version-detect
  i `isPrfLikelySupported()`. Skjul Touch ID-knapp for ikke-støttede
  browsere. Ingen forklarings-tekst (Mike-direktiv).
- **D-035 — Master-passord SOM identifikator.** Aldri e-post i auth-flow.
  Tenant-ID = HMAC av master-pwd. Passord-resett eksisterer ikke.

### Tenant-lifecycle / Stripe
- **D-049 — Just-in-time Stripe customer.** Trial-registrering oppretter
  IKKE Stripe customer. Customer opprettes først ved upgrade-til-paid
  (Iter 12.5). Holder gratis trial-brukere ute av Stripe Dashboard.
- **D-050 — In-vault upgrade banner** vises i vault-host, ikke i admin.
- **D-060 — Client-config i sentral Upstash** (ikke per-tenant Vercel-env).
  `client-config:<sub>`. Cache 24t i localStorage (D-061).
- **D-063 — Failsoft provisjonering.** Ingen Vercel-rollback ved Upstash-feil;
  admin retry via D-055-knappene.
- **D-064 — Upstash FØRST, deretter Vercel.** Ingen `PENDING_ITER_9`-hack
  noensinne.
- **D-065 — Strukturert `provisioningLog: ProvisioningEvent[]`** på
  TenantRecord. Append-only.
- **D-066 — `vaultLive: boolean`** + `/api/status`-polling.
- **D-067 — Frontend orkestrerer admin-create** via D-055-ruter + delt
  `ProvisioningTracker`.
- **D-068 — Velkomstmail + Telegram-varsel** fra `markVaultLive()`,
  fire-and-forget.
- **D-070 — Stripe customer-bevaring** ved `deleteTenant("gdpr")`. Stripe
  customer rotes ALDRI ved tenant-sletting (regnskapsspor må overleve
  per norsk lov + Stripe vs. GDPR-vurdering). Audit-spor av sletting
  finnes i Stripe.

### i18n
- **D-032 — Kun NO/SV/DA i fase 1.** Engelsk lagt til etter behov i Iter 19.9.
- **D-036 — Egen lett i18n** (`t()`/`tHook()`), ingen `next-intl`,
  ingen URL-routing, flagg i header, localStorage-persistering.

### Iter 19.9 (NYESTE LÅSING — 2026-06-13)
- **Locale ER LÅST ved registrering.** Endres IKKE av at bruker bytter
  app-språk i Settings senere. Ingen kobling app-språk ↔ mail-locale.
- **Initialverdi i `<LocaleRadioGroup>` er TOMT.** Ingen pre-utfylling
  fra browser-navigator. Skjema kan ikke sendes uten eksplisitt valg.
- **Samme krav på `/invite`-siden** som på `/register`. Backend-validering
  avviser tomme/manglende `locale` på `/api/register`, `/api/register/paid`,
  `/api/invite/accept`.

### CSS / Safari
- **D-022 — Ingen `isolation: isolate` på `bg-wrapper`.** Aldri. Inline-
  kommentar i `app/page.tsx` advarer.
- **D-022 — Glass-kort må aldri være direkte flex-barn av `<main>`.**
  Bruk wrapper-div.
- **D-023 — Per-browser CSS-variabler for glass.** Aldri hardkode
  `bg-white/10` i nye komponenter.

### Multi-tenant
- **D-018 — Manuell onboarding inntil >25 kunder.** Self-service onboarding
  bygges først som v4.5.
- **D-038 / D-041 — Reserverte subdomener** i `reserved-subdomains.json`
  (`*-admin` suffiks bannlyst).

---

## 4. KJENTE BUGS OG WORKAROUNDS

### Aktive issues
| ID | Issue | Status | Workaround |
|---|---|---|---|
| #001 | Slettet tenant viser Vercel "DEPLOYMENT_NOT_FOUND" | Dokumentert i `KNOWN-ISSUES.md`, planlagt fix i Iter 22 | Ingen — sjelden hendelse (< 1/mnd) |

### Fikset i denne økten (venter brukers verifisering)
- **iOS Mail / Safari CTA-lenker virket ikke etter klikk** — løst ved å
  legge til `target="_blank" rel="noopener noreferrer"` på ALLE `<a href="https://...">`-
  anker i alle 24 mal-filer. `mailto:` røres ikke. Per Mike's direktiv
  2026-06-23.

### Permanent fikset (tidligere økt — IKKE rør)
- **React #418 hydration-mismatch i `AppHeader`** — `navigator.onLine` i
  `useState`-lazy-initializer flyttet til `useEffect`. Linje ~120 i
  `components/AppHeader.tsx`. Lazy-init med `navigator`/`window`/`Date`
  bryter SSR/CSR-paritet og MÅ aldri brukes i Next.js 15.
- **400 Bad Request på admin-host** — `PaywallOverlay` og `UpgradeBanner`
  forsøkte å fetche tenant-status på admin-domenet. Fikset ved å skippe
  fetchen når host = admin-hostname.
- **WebKit `<table><tr>`-parser-bug** — nestet table-struktur på samme
  linje kunne trigge "phantom-anchor"-tilstand. Uncrampet i 16 mail-filer.
- **D-022 Safari backdrop-filter** — `isolation: isolate` på bg-wrapper
  + direkte flex-barn av `<main>` (se ADR).
- **D-023 Safari blur-paritet** — `useIsSafari` + CSS-variabler.

### Quirks som er ADR-låst (ikke en bug)
- Touch ID-knapp vises ikke i Safari 17/Chrome <132 (D-024 — bevisst, ikke
  bug).
- Stripe customer for trial-brukere finnes ikke (D-049 — bevisst).
- Tally-survey i A4 eksisterer som placeholder (eget skjema i backlog).

---

## 5. HVA SOM ER PÅGÅENDE / IKKE FERDIG

### Akkurat nå — venter på Mike
- **iOS Mail target=_blank-fix** er rullet ut i kode (24/24 maler, 48/48
  https-anker). Mike må trykke "Save to Github" → Vercel auto-deployer →
  Mike sender testmail via admin `MailTestCard` → tester i iOS Mail på
  iPhone. Begge typer lenker må klikke gjennom: CTA-pille OG
  oransje/grå tekstlenker.

### Iter 20 — ikke startet
Inneholder B2B-fasen — sannhetskilde i `v4.3 Utviklingsplan.md`. Blokker
fjernet etter Iter 19.9-levering 2026-06-13.

### Iter 21–24 — ikke startet
- **Iter 22 — Feilsider og branded fallbacks** (scope utvidet 2026-06-23):
  - Wildcard-håndtering for ukjente `*.kodovault.no`-subdomener →
    branded Ko | Do-side med "Denne vaulten finnes ikke lenger" + lenke
    til `kodovault.no`. Erstatter Vercel `DEPLOYMENT_NOT_FOUND`.
  - 500-side, robot/scraper-blokk, expired-trial-side.
  - Sannsynligvis Vercel wildcard-rewrite på admin-host.
- Iter 21, 23, 24 — ikke spesifisert detaljert ennå.

---

## 6. BACKLOG (prioritert rekkefølge)

Hentet fra `ROADMAP.md`. Rekkefølge per Mike's prioritering.

### P0 — Kritisk for kommersiell skalering
1. **v4.4 — Autentiseringsarkitektur** — Master-passord som identifikator
   (D-035). MÅ være på plass før v4.5 (auto-deployment).
2. **v4.5 — Lean Security som tjeneste** — Self-serve onboarding,
   programmatisk Vercel-deployment per kunde, KoDo-Editor-integrasjon.

### P1 — Plattform-modning
3. **Iter 22** — Branded 404 for slettede subdomener (se § 5).
4. **Win-back e-post dag 14 etter lock** — Mal C1 (NO+EN initialt, så
   SV/DA), `winBackSentAt`-felt på TenantRecord, cron-sjekk i
   `lifecycle-sweep`. **Ikke før Iter 20-24 er ferdig** — trenger prod-
   statistikk først.
5. **Anonymisert audit-tabell** — `{ subdomainHash, plan, createdAt,
   lockedAt, deletedAt, totalPaidInvoices }` i sentral Upstash, overlever
   `deleteTenant()`. Bygges som backlog-post **etter Iter 21**.

### P2 — Kvalitet og refaktorering
6. **`strings.ts`-sentralisering av e-poststrenger** — Samle subjects,
   reason-tekster, fallback-navn og day-words fra `notify-email.ts` til
   ett objekt per språk. **IKKE blandes inn i samme QA-runde som ny mal-
   leveranse** (Mike-direktiv).
7. **Pris-historikk-audit** — Logg hver `getPricing()`-endring til
   immutable audit-tabell i sentral Upstash.
8. **Kortere auto-lock i PWA standalone-modus** — `useIsStandalone`-hook,
   config-utvidelse `autoLockMinutesStandalone?: number`.

### P3 — Polish og nice-to-have
9. **Eget exit-survey** — Erstatte Tally med egen `POST /api/exit-survey`
   + `/exit-survey`-side (GDPR-vennlig).
10. **Kampanje-bryter for trial-default** — admin-UI for midlertidig
    global `trialDays`-override.
11. **Tenant-navn via Vercel env-var** (`NEXT_PUBLIC_TENANT`) — null
    kode-endring per ny kunde. Krever D-018-tilpasning.

### Nice-to-Do (ikke planlagt versjon)
12. **vX — 2FA TOTP** — Degradert fra v4.2/v4.4 fordi advokat/konsulent-
    målgruppen ikke kjenner begrepet. Bygges KUN ved etterspørsel.
13. **vX.X — Smart Topp 10** — D-019. Krever Mike eller Lars eksplisitt
    "savner det".
14. **vX — Journalist-modus** — Egen produkt-type, holdes utenfor
    stamme-arkitekturen.

---

## 7. FEIL AGENTEN SELV HAR GJORT I DENNE ØKTEN

> Dette er den viktigste seksjonen for neste agent. Ærlig, konkret.

### Feil 1 — Tolket "CTA-knapper" for snevert
Mike skrev "ALLE `<a href="https://...">`-tags som er CTA-knapper". Jeg
antok at "CTA-knapp" KUN var den oransje pille-knappen med
`display:inline-block;padding:...`. Mike's faktiske intensjon var ALLE
https-lenker som tar brukeren et sted — inkludert oransje
underline-tekstlenker (f.eks. "max.kodovault.no" i A4) OG grå
footer-lenker. Måtte gjøre en tredje iterasjon for å fange dette.

**Konsekvens:** Mike måtte teste samme mal tre ganger og bli rasende
før jeg forsto omfanget.

**Læring for neste agent:** Når brukeren sier "ALLE", spør konkret om
omfang ELLER kjør et grep først som lister kandidater og vis dem.

### Feil 2 — Hallusinerte ny hypotese uten verifisering
Da første rundes fix ikke virket, foreslo jeg automatisk at Resend
click-tracking eller OS-nivå Apple Mail Privacy var problemet. Mike
hadde IKKE verifisert noe av dette og kjente koden bedre enn meg.
Den rå email-HTML viste plain URLs, ingen tracking.

**Læring for neste agent:** Be om rå evidens (eksempelvis email-HTML
fra mottakers innboks) FØR du foreslår hypoteser. Ikke gjett.

### Feil 3 — Pushet "finish" før brukers verifikasjon
I første og andre runde kalte jeg `finish`-toolet før Mike hadde fått
testet noe. Mike måtte selv si "det virker ikke" før jeg innsåg at
testing måtte ha skjedd FØR finish.

**Læring for neste agent:** For ting som kun kan testes manuelt på
brukers enhet (iOS Mail, fysisk iPhone, native mail-klient), skal
finish tydelig markere at verifikasjon venter på bruker — IKKE
påstå "✅ fungerer".

### Feil 4 — Scope-creep med uncramping
I første runde la jeg til uncramping av `<table><tr>` selv om det ikke
var direkte bedt om. Det var fra forrige økts hypotese (WebKit-parser-
bug). Mike rev meg ikke for det, men det utvidet diff-en unødvendig
og var en av grunnene til at Mike trodde fixen var større enn den var.

**Læring for neste agent:** Hold scope strengt til det brukeren ber om.
Hvis du oppdager noe relatert som burde fikses, NEVN det og spør —
ikke smyg det inn.

### Feil 5 — Var ikke tydelig på commit/deploy-timing
Den email Mike fikk testet i andre runde var sendt 13 minutter FØR jeg
hadde commitet endringene. Mike så at fixen "ikke virket" — men det
var feil mail. Jeg skulle åpenbart sagt "vent med å teste til etter
deploy" i finish-meldingen, ikke etter at Mike klaget.

**Læring for neste agent:** Når du ber bruker teste noe som krever
deploy, vær EKSPLISITT på:
1. Endringen er på disk men ikke deployet
2. Bruker MÅ trekke "Save to Github"
3. Vent X sekunder til Vercel-deploy er ferdig
4. NY mail må sendes — gamle mailer har gammel kode

### Feil 6 — "Hallusinerte" at testen var trivielt grønn
Da jeg første gang oppdaterte `email-button-clickable.test.ts`, måtte
jeg snu kontrakten (target=_blank SKAL vs IKKE være satt). Jeg gjorde
det riktig, men ved senere rollback (pilot på 1 fil) rullet jeg
testfilen tilbake også, noe som ga 1 forventet test-feil. Jeg burde
ha vært tydeligere på at den forventede feilen var bevisst.

### Hva jeg IKKE har brutt (men neste agent kan)
- Jeg har IKKE endret krypto-parametre
- Jeg har IKKE endret D-070 (Stripe customer-bevaring)
- Jeg har IKKE endret `deleteTenant()`-flyt
- Jeg har IKKE endret locale-låsing fra Iter 19.9
- Jeg har IKKE endret andre testfiler enn `email-button-clickable.test.ts`
- Jeg har IKKE endret `notify-email.ts` (sendelogikk)
- Jeg har IKKE endret render-pipeline eller Resend-konfig

---

## 8. REGLER FOR NESTE AGENT

> Disse skal følges uten unntak. Hvis du opplever konflikt mellom en
> regel og en oppfattet "god idé", velg regelen.

### Regel 1 — Aldri endre noe som fungerer uten eksplisitt instruks
Hvis Mike ber deg fikse X, fiks X. Ikke gjør "samtidig opprydning",
ikke "forbedre" tilstøtende kode, ikke endre formattering. Hver
endring må kunne forklares ved å peke på en direkte instruks.

### Regel 2 — Alltid rapporter omfang FØR du starter
Før du skriver kode:
1. Vis hvilke filer du planlegger å endre
2. Vis hvilke linjer (grep + linjenummer)
3. Vis hvilken konkret endring du planlegger
4. Vent på "ok" eller justert scope

For større endringer (>5 filer): spør om dette er piloten eller
hele rollout-en.

### Regel 3 — 100% løsninger, ikke 85%
Hvis du ikke kan løse 100% — si det. Aldri "dette burde virke", aldri
"sannsynligvis fikset", aldri "kan ikke teste på iOS men antar OK".
Hvis testing krever Mike's enhet, si det eksplisitt og vent.

D-001 er kjernen i hele produktet. Hvis et forslag bryter 100%-
prinsippet (honor-system, soft-delete, etc.) MÅ du avvise det og
peke på D-001.

### Regel 4 — Bekreft alltid med Mike før deploy
Mike trykker "Save to Github" selv. Du har ALDRI tilgang til:
- Vercel API
- Stripe Dashboard
- Resend Dashboard
- Upstash Dashboard
- DNS-innstillinger

Du kan IKKE deploye, IKKE sende mail, IKKE trigge cron-jobber i prod.
Si dette eksplisitt i finish-meldingen når brukeren skal teste noe.

### Regel 5 — Test ALT som er testbart før finish
- `tsc --noEmit` — alltid grønt
- `yarn build` — alltid grønt
- `yarn lint:all` (D-069, D-071, D-077) — alltid grønt
- Relevante `tsx`-tester i `lib/__tests__/` — kjør dem
- For ting som krever browser: ta én screenshot via screenshot_tool
- For ting som krever native mail-klient eller iOS-device: si at
  Mike må teste, IKKE prøv å si "fungerer"

### Regel 6 — Norsk, presist, ingen unnskyldninger
Mike er frustrert over "85%-ferdig" og generisk språk. Skriv presist,
på norsk, og uten ord som "skulle", "burde", "kanskje". Hvis du har
gjort en feil, si det direkte: "Jeg tok feil. Her er det riktige."

### Regel 7 — Multi-lingual-regel (Iter 19.9)
Hver nye UI-streng MÅ legges til i `no.json`, `sv.json`, `da.json`,
`en.json` i samme commit. Ikke lag "fallback til norsk". Mike vil
ALDRI bli irettesatt for dette igjen.

### Regel 8 — Aldri endre uten å ha lest filen i denne økten
Hvis du ikke har sett filen i denne økten, les den FØRST. Aldri foreslå
edits basert på antagelser om innhold.

### Regel 9 — `mailto:`-lenker røres ALDRI
Per Mike's direktiv 2026-06-23: `target="_blank"` skal IKKE legges på
`mailto:`-anker. Beholder native mail-app-åpning.

### Regel 10 — Auto-commit er på, men deploy er IKKE
Emergent auto-committer hver endring til `main`-branchen. Det betyr
KODEN er i git, men det betyr IKKE at den er på Vercel. Mike må trykke
"Save to Github" i Emergent-chatten for at GitHub-pushen + Vercel-
deployen skal trigges.

---

## Sluttsnapshot — øktens siste tilstand (2026-06-23)

- Siste commit: HEAD (auto-commit av iOS-fix til alle 24 mal-filer)
- TSC: grønt
- Build: grønt (40s, 39 ruter)
- `email-button-clickable.test.ts`: 144/144 passed
- 48/48 https-anker i 24 mal-filer har `target="_blank" rel="noopener noreferrer"`
- `mailto:`-anker urørt
- Venter på: Mike trykker "Save to Github" → tester i iOS Mail på iPhone

## Filer endret i denne økten (komplett liste)

```
frontend/lib/platform/email-templates/deleted-confirmation.da.html
frontend/lib/platform/email-templates/deleted-confirmation.en.html
frontend/lib/platform/email-templates/deleted-confirmation.no.html
frontend/lib/platform/email-templates/deleted-confirmation.sv.html
frontend/lib/platform/email-templates/lifecycle-warning.da.html
frontend/lib/platform/email-templates/lifecycle-warning.en.html
frontend/lib/platform/email-templates/lifecycle-warning.no.html
frontend/lib/platform/email-templates/lifecycle-warning.sv.html
frontend/lib/platform/email-templates/locked-from-cancel.da.html
frontend/lib/platform/email-templates/locked-from-cancel.en.html
frontend/lib/platform/email-templates/locked-from-cancel.no.html
frontend/lib/platform/email-templates/locked-from-cancel.sv.html
frontend/lib/platform/email-templates/locked-from-trial.da.html
frontend/lib/platform/email-templates/locked-from-trial.en.html
frontend/lib/platform/email-templates/locked-from-trial.no.html
frontend/lib/platform/email-templates/locked-from-trial.sv.html
frontend/lib/platform/email-templates/trial-reminder-t5.da.html
frontend/lib/platform/email-templates/trial-reminder-t5.en.html
frontend/lib/platform/email-templates/trial-reminder-t5.no.html
frontend/lib/platform/email-templates/trial-reminder-t5.sv.html
frontend/lib/platform/email-templates/welcome.da.html
frontend/lib/platform/email-templates/welcome.en.html
frontend/lib/platform/email-templates/welcome.no.html
frontend/lib/platform/email-templates/welcome.sv.html
frontend/lib/__tests__/email-button-clickable.test.ts
memory/HANDOFF-v4.4.md  ← denne filen
```

CHANGELOG og PRD er IKKE oppdatert i denne økten — det ble bevisst
rullet tilbake på Mike's instruks om å holde scope strengt til
target=_blank-fixen.
