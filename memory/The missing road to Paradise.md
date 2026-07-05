# The Missing Road to Paradise 🌴

**Opprettet:** 2026-02-01
**Formål:** Strategisk oversikt over ALT som gjenstår for at Ko|Do Vault skal være klar for prod-launch og skalering. Sammensatt av (a) eksisterende dokumentasjon (ROADMAP.md, KNOWN_BUGS.md, PRD.md) og (b) gap-analyse ved kartlegging av kodebasen 2026-02-01.

**Målgruppe:** Mike + fremtidige agenter. Bruk denne som kompass når du planlegger neste iterasjon.

**Konvensjon:**
- 🔴 P0 = blokkerer launch
- 🟠 P1 = kritisk for prod-drift
- 🟡 P2 = viktig, ikke launch-blocker
- 🔵 P3 = nice-to-have / differensiering
- ⚫️ Parkert = venter på trigger

---

## 🔴 P0 — Kritiske / aktive blokkere

### 1. B2B fakturering — Stripe subscription-arkitektur
**Status:** Beslutning venter. Diskutert 2026-02-01, parkert.
**Problem:** Nåværende flyt bruker `invoices.create` + `invoiceItems.create` (one-time). Stripe fornyer ikke automatisk. `nextBillingDate`-feltet oppdateres feil (settes til dagen fakturaen ble sendt). `plan`-enum vises raw (`b2b_yearly`) i UI.
**Alternativer:**
- **Vei A** — Stripe Subscriptions (mest native, mister manuell kontroll)
- **Vei B** — self-cron-renewal (mer arbeid, beholder kontroll)
- **Vei C** — hybrid
**Neste steg:** Mike velger vei. Implementasjon 1–3 dager avhengig av vei.

### 2. Backup-strategi (ikke tidligere dokumentert)
**Status:** Ingen formell task. Diskutert 2026-02-01.
**Problem:** Ingen automatisk off-site backup fra sentral Upstash. `CENTRAL_ENCRYPTION_KEY` er single-point-of-failure. Ingen SuperAdmin bulk-backup, ingen restore-UI.
**Foreslått pakke:**
- Nattlig cron som skriver `backup/data`-payload per firma til S3/GDrive
- `CENTRAL_ENCRYPTION_KEY` backup-prosedyre dokumentert i safe/1Password
- SuperAdmin "Backup alle firmaer nå"-knapp
- Restore-UI-flyt (les JSON → oppretter tenant + admin + invites + notes tilbake)
**Estimat:** ~1 dag for cron + eksport-lokasjon. +1 dag for bulk-knapp + restore-UI.

### 3. Statiske juridiske sider mangler
**Status:** Ikke opprettet.
**Mangler:**
- `/terms` — vilkår og betingelser
- `/privacy` — personvernerklæring (GDPR-krav)
- `/dpa` — databehandleravtale-mal (B2B vil be om dette)
- `/security` — sikkerhets-erklæring
- `/about` — selskaps-info (bokføringslov)
**Anbefaling:** Kan ikke lovlig selge til norske firmaer uten disse.
**Estimat:** 1 dag for tekst + 0.5 dag for jurist-review.

---

## 🟠 P1 — PRE-LAUNCH (kritisk for prod-drift)

### 4. P1-PRE-LAUNCH-A — API-lag PII-redaktering for B2B-children
**Kilde:** ROADMAP.md
**Problem:** `GET /api/admin/tenants` returnerer full PII (firstName, lastName, email, billingDetails) for B2B-children til super-admin selv om D-100 skjuler det i UI. Kompromittert session → PII-lekkasje.
**Løsning:** `redactB2BChildPII()` helper + separat `POST /api/admin/tenants/[subdomain]/reveal-pii` med reason-tekst + audit-log.
**Estimat:** ~3.5 dager

### 5. P1-PRE-LAUNCH-B — Tenant lifecycle 3-stegs modell
**Kilde:** ROADMAP.md (lagt til 2026-02-01)
**Problem:** Dagens delete-flyt har hard-blokk hvis B2B-parent har aktive children. Kunder som slutter rydder aldri opp — Mike står fast.
**Løsning:** Inaktiv (90d) → Arkivert (180d) → Slettet (12mnd) med varsel-mails × 4 språk og deferred hard-delete.
**Estimat:** ~2 dager

### 6. Overvåking & feilfangst (ikke tidligere dokumentert)
**Status:** Har INGENTING i dag.
**Problem:** Hvis Stripe-webhooken kræsjer på natten, Sentry er ikke installert, Better Uptime finnes ikke, Telegram-varsler kun for provisioning-failure. Én-person-drift = høy risiko uten overvåking.
**Foreslått pakke:**
- Sentry (gratis 5k events/mnd) — server + client
- Better Uptime — host-monitoring på `admin.kodovault.no` + 2–3 tenant-hosts
- Alert-thresholds: provisioning failed 3x/hour, webhook error, 5xx spike
**Estimat:** ~3 timer

### 7. GDPR/juridisk-pakke (ikke tidligere dokumentert)
**Kilde:** Gap-analyse 2026-02-01
**Mangler:**
- Personvernerklæring (kobles til punkt 3)
- Databehandleravtale-mal (DPA) for B2B-kunder
- Underleverandør-liste publisert (Upstash, Vercel, Stripe, Resend, Telegram, Cloudflare Turnstile)
- Datatilsynet-registrering bekreftet
- Right-to-erasure-flyt dokumentert (finnes teknisk via `/api/account/delete`, men prosessen er ikke skrevet)
**Estimat:** 1 dag + jurist-review

### 8. Faktura-nummerering sekvensialitet (bokføringslov §5-1-3)
**Status:** Ikke verifisert. Diskutert 2026-02-01.
**Problem:** Norsk bokføringslov krever kontinuerlig sekvensiell faktura-nummerering. Stripe auto-nummererer, men verifiser at det er global (kan bli hull) eller per-customer (feil per lov). Ved D-131 manuell-faktura-flyt fikk vi én per klikk.
**Handling:** Sjekk Stripe-innstillingen `invoice.number`-serie. Hvis global er OK, dokumentér. Hvis ikke — implementér egen sekvensiell nummer-serie.
**Estimat:** 0.5 dag verifisering + evt. 0.5 dag fiks

### 9. Rate-limiting audit (delvis dekket)
**Status:** Blandet dekning.
**Problem:** `notify.ts` har rate-limit. `admin/session/start` og `am-admin/login` — usikker coverage. `register/*` (public trial-signup) — ingen rate-limit funnet ved rask kartlegging.
**Handling:** Full audit av alle public endpoints. Legg til Cloudflare Turnstile + Upstash-based per-IP-teller der det mangler.
**Estimat:** 0.5 dag

### 10. Trial-utløps-varsler verifisering
**Status:** Kode-spor finnes, oppførsel ikke verifisert.
**Problem:** `lifecycle-cron.ts` har "trial_expires_soon"-events. Sendes e-post 7/3/1 dag før? Verifiseres.
**Handling:** Test-utrulling + logg-inspeksjon.
**Estimat:** 1 time

### 11. Stripe faktura-locale (norsk PDF)
**Status:** Ikke verifisert.
**Problem:** Stripe genererer faktura-PDF på engelsk hvis `preferred_locales` ikke er satt på customer. Norske kunder kan få engelsk faktura → forvirring + juridisk gråsone.
**Handling:** Verifiser `stripe.customers.update({ preferred_locales: ["nb"] })` kalles ved B2B-parent-oppretting. Legg inn hvis ikke.
**Estimat:** 1 time

---

## 🟡 P2 — Viktig men ikke launch-blocker

### 12. Admin/Vault-splitt til separate Vercel-apper
**Kilde:** `/app/memory/ADMIN_SPLIT_SCOPING.md`
**Status:** Kartlagt. Ingen beslutning.
**Estimat:** 9–11 dager
**Trigger for oppstart:** Sikkerhetsrevisjon som krever redusert angrepsflate, eller stor B2B-vekst (>50 tenants) hvor deploy-uavhengighet blir kritisk.

### 13. i18n SV/DA-verdier utfylt
**Kilde:** ROADMAP.md (v4.2)
**Status:** "748 nøkler i no.json, byte-likt sv/da" — men gjenstår at Mike fyller inn SV/DA-verdiene manuelt.
**Handling:** Verifiser dagens tilstand. Hvis machine-translated eller tomt → få skikkelig oversettelse.
**Estimat:** 0.5 dag (avhengig av oversetter)

### 14. Passkeys/2FA for am-admin
**Kilde:** Handoff-notat (parkert)
**Status:** Parkert.
**Business case:** Mange norske firmaer krever 2FA per intern policy — kan bli dealbreaker for større B2B-kunder.
**Estimat:** ~2 dager (WebAuthn-integrasjon eksisterer allerede for vault, kan gjenbrukes)

### 15. B2 — Orphan-detection edge-case
**Kilde:** KNOWN_BUGS.md
**Status:** BACKLOG (venter på T4-beslutning)
**Volum:** Lavt, akseptabelt for nå.

### 16. T4 — Test Tools eksponerer PII uten audit-log
**Kilde:** KNOWN_BUGS.md
**Status:** BACKLOG. Samme spor som P1-PRE-LAUNCH-A.

### 17. Ekte stabil `orgId` (UUID) på TenantRecord
**Kilde:** ROADMAP.md P2
**Status:** Parkert til v5.x.
**Estimat:** 2–3 dager

### 18. Onboarding for nye B2B-kunder
**Status:** Ikke i dokumentasjon.
**Problem:** Ingen guided tour, ingen "start her"-video, ingen kontakt-Mike-knapp første gang firma-admin logger inn.
**Estimat:** 0.5 dag

### 19. Fakturahistorikk-eksport (ZIP/CSV)
**Kilde:** Next Time-liste i PRD.md
**Estimat:** CSV 2–3 timer, ZIP 1 dag

### 20. Retry-knapp for admin-domain-attach (D-144 failsoft)
**Kilde:** D-144 finish-forslag
**Estimat:** 0.5 dag

### 21. "Test alle B2B-parents"-samleknapp
**Kilde:** D-145 finish-forslag
**Estimat:** 0.5 dag

### 22. Cookie-policy verifisering
**Status:** Ikke sjekket.
**Problem:** Session-cookies er nødvendige og OK uten samtykke, men trenger cookie-erklæring et sted. Verifiser at ingen analytics-cookies settes ubevisst.
**Estimat:** 1 time

---

## 🔵 P3 — Differensiering / nice-to-have

### 23. HIBP breach-monitoring (haveibeenpwned)
**Idé:** Klient-side k-anonymity-lookup mot HIBP-API. Zero-knowledge-vennlig.
**Value:** Differensieringspunkt vs konkurrenter.

### 24. Passord-styrke-varsel
**Value:** Bedre UX. Klient-side, ingen server-side eksponering.

### 25. Delt vault-funksjonalitet
**Value:** Familier / team-passord.
**Scope:** Utenfor v4.x, potensielt v5.x.

### 26. Mobil-app / browser-extension
**Scope:** Utenfor nåværende produkt-vindu.

### 27. SPW (dedikert Secrets Password Word)
**Kilde:** D-147 senere iterasjon
**Status:** Enkelt bcrypt-hash brukes i mellomtiden.

### 28. Bulk-børste + restore-UI (P0 punkt 2 delkomponenter)

### 29. Firma-admin "Slett alle ansatte og deretter firma" (Vei 1)
**Kilde:** Delete-diskusjon 2026-02-01
**Status:** Parkert (Mike sa "sparer 5 min, ikke verdt engineering-tiden")

### 30. Tech-debt T1 — TenantViewer.tsx 5000+ linjer
**Status:** Ikke planlagt — for risikabelt uten E2E-tester

### 31. Tech-debt T2 — provisioningLog vokser ubegrenset
**Status:** Lav prio

---

## 🎯 Anbefalt rekkefølge før launch

Hvis Mike spør "hva gjør vi først":

1. **Stripe subscription-beslutning** (P0-1) → 30 min beslutning + 1–2 dager
2. **Backup-strategi** (P0-2) → 1 dag
3. **Overvåking (Sentry + Uptime)** (P1-6) → 3 timer
4. **GDPR/juridisk-pakke** (P1-7) + **Statiske sider** (P0-3) → 1–2 dager samlet
5. **PII-redaktering** (P1-4) → 3.5 dager
6. **Faktura-nummerering + Stripe-locale** (P1-8 + P1-11) → 1.5 timer
7. **Rate-limit-audit** (P1-9) → 0.5 dag
8. **Trial-varsler verifisering** (P1-10) → 1 time
9. **i18n SV/DA utfylt** (P2-13) → 0.5 dag

**Total for launch-klart:** ~10–12 dager fokusert arbeid.

**Lifecycle-modellen** (P1-5) kan komme etter launch — du rydder manuelt i mellomtiden.

---

## 🧭 Kompass-spørsmål før du velger neste sak

1. **Blokkerer det inntekt?** (Stripe subscription = ja)
2. **Åpner det angrepsflate?** (PII-redaktering = ja)
3. **Skjuler det katastroferisiko?** (Backup, Overvåking = ja)
4. **Kreves det for norsk lov?** (GDPR, bokføringslov, statiske sider = ja)
5. **Blokkerer det B2B-salg?** (DPA, 2FA/Passkeys = ofte ja)

Hvis 2+ er ja → jobb med det først.

---

**Sist oppdatert:** 2026-02-01
**Neste review:** Etter Stripe-beslutning + Backup-implementasjon
