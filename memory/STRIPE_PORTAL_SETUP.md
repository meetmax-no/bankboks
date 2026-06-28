# Stripe Customer Portal — engangs-oppsett

For at Iter 19.5 ("Administrer abonnement") skal fungere må Customer Portal
aktiveres én gang i Stripe Dashboard.

## Steg

1. Logg inn på [Stripe Dashboard](https://dashboard.stripe.com)
2. Gå til **Settings** → **Billing** → **Customer Portal**
3. Klikk **Activate**
4. Konfigurer hva bruker kan gjøre:
   - ✅ **Update payment methods** (kortbytte — KREVES)
   - ✅ **View invoice history** (faktura-historikk — KREVES)
   - ✅ **Cancel subscription** (oppsigelse — anbefalt)
   - ✅ **Switch plans** mellom månedlig og årlig (anbefalt)
   - ❌ Update billing address — ikke nødvendig (norsk-only foreløpig)
   - ❌ Update business info — ikke nødvendig
5. **Branding** — last opp Ko|Do-logo + sett primærfarge til amber-300 (`#fcd34d`) for konsistens
6. **Return URL** — håndteres dynamisk per session (settes til `https://<sub>.kodovault.no/`)
7. **Lagre**

## Verifiser

Etter aktivering: i admin, finn en active-tenant og kjør:

```bash
curl -i https://<sub>.kodovault.no/api/billing/portal
```

Forventet: `303` redirect til `billing.stripe.com/p/session/...`-URL. Hvis du
får 502 `stripe_error` → portalen er ikke aktivert (eller live-mode/test-mode
mismatch).

## Test-modus

Sjekk at både test- OG prod-modus er aktivert om du bruker `sk_test_*`-keys
under utvikling. Stripe har separate portal-konfigurasjoner per modus.

## Sikkerhet

`/api/billing/portal` krever ingen ekstra auth fordi:
- Subdomain er identitet (D-046)
- Tenants vises kun sin egen `stripeCustomerId`
- Stripe Portal er beskyttet av sin egen session-token (kortvarig, ~1t)

Hvis en angriper kjenner et `<sub>.kodovault.no`-subdomain kan de teknisk
trigge en portal-redirect, men de vil havne på Stripe sin login eller en
portal-session for FEIL customer. De får aldri se eller endre noe uten
egen Stripe-login.
