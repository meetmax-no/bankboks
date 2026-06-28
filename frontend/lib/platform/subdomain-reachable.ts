/**
 * Ko | Do · Vault — Iter 20.9 (D-098, Mike 2026-06-28)
 *
 * Sjekk om et tenant-subdomene allerede er DEPLOYED som en Vercel-vault.
 *
 * Bakgrunn:
 *   Sentral Upstash-registeret (`tenantExists()`) inneholder bare tenants
 *   opprettet via plattformens normale create-flow. B2C-vaults som har
 *   blitt manuelt provisjonert utenom (eller migrert) finnes som
 *   selvstendige Vercel-prosjekter med egen Upstash-backend, MEN er
 *   IKKE registrert sentralt.
 *
 *   Bug: en super-admin kunne opprette en B2B-invitasjon for et subdomene
 *   som allerede pekte på en eksisterende vault. Invitasjons-mottakeren ble
 *   redirected dit, ble bedt om master-passord (single-prompt, ikke første-
 *   gangs-oppsett), og fikk tilgang til den fremmede vaulten med sitt eget
 *   passord — kun fordi hens MPW tilfeldigvis matchet (eller fordi det var
 *   hens egen vault, som i Mike's selv-test 2026-06-28).
 *
 *   Mike's selv-test: opprettet `mm-max`-invite. `mm-max.kodovault.no` var
 *   hans eksisterende private B2C-vault. Accept-flowen viste hans egen
 *   private vault under B2B-prefiks. Ingen data ble lekket fordi det var
 *   HANS vault, men risikoen er reell hvis subdomenet tilhører en annen
 *   bruker.
 *
 * Fiks: aktiv HEAD-sjekk mot `https://<subdomain>.kodovault.no/` med
 * timeout. Hvis hosten svarer med noe ANNET enn 404 (Vercel "unmapped"-
 * sidesvar) → behandle subdomenet som tatt.
 *
 * Begrensninger:
 *   - Krever utgående HTTPS fra Vercel-funksjonen (alltid tilgjengelig).
 *   - Hvis HEAD-requesten timer ut, tolker vi det som "ikke nådbar"
 *     (vi vil heller falle åpent enn å blokkere legitim oppretting).
 *   - 4xx ≠ 404 (eks. 403) regnes som "tatt" (deploy svarer, bare ikke
 *     på root).
 *   - 5xx regnes som "tatt" (en buggy deploy er ikke "tilgjengelig").
 */

const HEAD_TIMEOUT_MS = 3500;

/**
 * Sjekk om `<subdomain>.kodovault.no` er en levende deploy (uansett om den
 * er registrert i sentral DB eller ikke). Returnerer `true` hvis hosten
 * svarer med noe ANNET enn et default-404 fra Vercel.
 */
export async function isSubdomainDeployed(subdomain: string): Promise<boolean> {
  const normalized = subdomain.toLowerCase().trim();
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(normalized)) return false;

  const url = `https://${normalized}.kodovault.no/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      // `redirect: manual` så vi ser raw status (Vercel kan 308'e til /platform/…)
      redirect: "manual",
      headers: {
        // Identifiser oss tydelig i tilfelle noen sjekker access-logger.
        "user-agent": "kodo-vault-reachability-probe/1.0",
      },
    });
    clearTimeout(timeout);
    // 404 = Vercel default for ikke-mappet domain → trygt å tildele.
    // ALT annet = deploy eksisterer på dette subdomenet.
    return res.status !== 404;
  } catch {
    clearTimeout(timeout);
    // Timeout, DNS-feil, eller annen nettverksfeil → IKKE nådbar.
    // Vi feiler åpent her — bedre å la admin opprette enn å låse en
    // legitim ny tenant pga. midlertidig nettverkshikke. Det andre
    // laget (sentral DB tenantExists) er fortsatt en sjekk i kjeden.
    return false;
  }
}
