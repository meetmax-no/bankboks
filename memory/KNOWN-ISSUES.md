# Ko | Do · Vault — Known Issues

Liste over kjente, ikke-blokkerende issues vi har bevisst akseptert å leve med
til en planlagt iter. Format:

```
## #NN — Tittel
- **Oppstod:** dato + kontekst
- **Påvirkning:** hvem ser det / hvor ofte / hvor alvorlig
- **Workaround:** hva brukeren kan/skal gjøre i mellomtiden
- **Planlagt fix:** hvilken iter / scope
```

---

## #001 — Slettet tenant viser Vercel sin generiske 404 (DEPLOYMENT_NOT_FOUND)

- **Oppstod:** 2026-06-23 — verifisert i prod etter at GDPR-selvbetjent
  vault-sletting ble lansert. Etter `deleteTenant("max", "gdpr")` returnerer
  `max.kodovault.no` Vercel sin svarte/hvite "DEPLOYMENT_NOT_FOUND"-side.
- **Påvirkning:**
  - Brukere som besøker en slettet tenant ser en uflagget Vercel-feilside
    uten Ko | Do · Vault-branding.
  - **Sjelden** — vault-sletting skjer kun ved selvbetjent GDPR-sletting
    (forventet < 1 per måned i tidlig fase) eller cron-auto-delete av
    utløpte tenants. Vi har 30-dagers warning-syklus så brukere vet at
    sletting kommer.
  - Ingen funksjonell impact, kun branding-tap.
- **Workaround:** Ingen. Bruker som lander på 404-siden må selv navigere
  til `kodovault.no` manuelt.
- **Planlagt fix:** **Iter 22 (feilsider)** — wildcard-håndtering for
  ukjente `*.kodovault.no`-subdomener via en branded fallback-side.
  Implementering-skisse:
  1. Vercel wildcard-domain-rewrite til en sentral "missing-tenant"-route
     på admin-host'en, ELLER
  2. Cloudflare worker som intercepter ukjente subdomener og
     server-rendrer Ko | Do-side med tekst "Denne vaulten finnes ikke
     lenger" + lenke til `kodovault.no`.
  - Sannsynligvis (1) siden vi allerede har wildcard-DNS + Vercel-deploys.

---

## #002 — `frontend/yarn.lock` ikke committed → versjon-drift mellom lokal og Vercel

- **Oppstod:** 2026-06-24 — Vercel-build feilet på Stripe SDK API-versjon
  `2026-06-24.dahlia` mens lokal kode hadde `2026-05-27.dahlia`. Root cause:
  `frontend/yarn.lock` finnes ikke i repo, så Vercel kjører frisk
  `yarn install` ved hver build og kan plukke nyere minor/patch via
  caret-ranges (`^22.2.0`).
- **Påvirkning:**
  - Sporadiske build-feil eller runtime-feil når en transitive dep bumper
    typer eller API.
  - Vanskelig å reprodusere lokalt fordi din `node_modules` har en annen
    versjon enn Vercel har.
  - Sikkerhetshull i transitive deps oppdages senere — Dependabot kan
    ikke følge med på effective versions uten lockfile.
- **Workaround:** Pin'e eksakte versjoner i `package.json` per pakke
  som har vist drift-problemer (eks Stripe pinned til `22.2.0` etter
  denne hendelsen). Skalerer ikke for hele dep-treet.
- **Planlagt fix:** **Egen ryddejobb (ikke knyttet til iter)** — committe
  `frontend/yarn.lock` til repo + verifisere at:
  1. `.gitignore` IKKE ignorerer yarn.lock
  2. Vercel respekterer committed lockfile (default for yarn-prosjekter)
  3. Lokal `yarn install` etter clone produserer samme `node_modules` som
     Vercel — kjør test-build for å verifisere
  4. Dependabot eller Renovate konfigureres til å foreslå dep-bumps via
     PR mot lockfile (ikke utenom)
  - Estimat: 1-2 timer inkludert verifisering. Bør tas FØR Iter 20 (B2B)
    så vi har stabil baseline før vi multipliserer bruker-flatene.

---

## #003 — D-071 isolation-lint feiler på `/api/tenant/info/route.ts` ✅ FIKSET 2026-06-25

- **Oppstod:** 2026-06-25 (oppdaget) — ruten ble laget i Iter 19.9.2 for å
  fôre SettingsPanel Fane 1 (Klient) med live tenant-data fra DB. Den
  importerer `@/lib/platform/tenant-store` som er sentral-creds-avhengig.
- **Fiks:** Lagt til `/api/tenant/` i `APPROVED_BUCKETS` i
  `lib/__tests__/isolation-lint.test.ts` med inline-kommentar som
  refererer til rewrite-regelen i `next.config.mjs`. Mønsteret matcher
  `/api/billing/*` og `/api/account/*` som allerede står på listen.
- **Verifisert:** `yarn lint:all` grønt (D-069, D-071, D-077). 42 ruter
  skannet, 37 i godkjente buckets.
- **Resterende risiko:** Hvis noen senere fjerner rewrite-regelen for
  `/api/tenant/*` uten å oppdatere tenant-poden, vil ruten krasje. Lint-
  skripten kan ikke fange dette — eneste sikkerhetsnett er at brukere
  klager når Fane 1 går tom i SettingsPanel.

---
