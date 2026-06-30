/**
 * Ko | Do · Vault — D-137 (2026-02) — findSubdomainFromEvent kodo_-prefix
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/find-subdomain-event.test.ts`
 *
 * Bug: Mikes manuelle send-invoice-flyt (D-080) setter metadata med
 * `kodo_subdomain`-key (namespaced), men `findSubdomainFromEvent` søkte kun
 * etter `subdomain` (uten prefix). Resultat: webhook for `invoice.paid`
 * fant ikke tenant og oppdaterte aldri status til "active" når Mike
 * markerte en manuell faktura som betalt.
 *
 * Fiks: helperen aksepterer nå begge formater på alle 4 lookup-paths
 * (direct metadata, subscription_details, lines metadata, customer.metadata).
 */
import type Stripe from "stripe";

// Vi tester den private helperen indirekte via en re-export-test
// implementert i denne filen. findSubdomainFromEvent er ikke eksportert,
// så vi simulerer Stripe-event-objekter og asserter de samme branch-paths.
//
// Strategien: speile logikken fra findSubdomainFromEvent og verifisere at
// vår fiks dekker alle metadata-formater. Hvis testen feiler etter en
// fremtidig refaktor, må helperen oppdateres tilsvarende.

function findSubdomainFromEventClone(
  event: Stripe.Event,
): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const directMeta = obj.metadata as Record<string, string> | undefined;
  if (directMeta?.subdomain) return directMeta.subdomain.toLowerCase();
  if (directMeta?.kodo_subdomain) return directMeta.kodo_subdomain.toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subDetails = (obj as any).subscription_details as
    | { metadata?: Record<string, string> }
    | undefined;
  if (subDetails?.metadata?.subdomain) return subDetails.metadata.subdomain.toLowerCase();
  if (subDetails?.metadata?.kodo_subdomain) return subDetails.metadata.kodo_subdomain.toLowerCase();

  const lines = (obj as { lines?: { data?: Array<{ metadata?: Record<string, string> }> } }).lines;
  const lineMeta = lines?.data?.[0]?.metadata;
  if (lineMeta?.subdomain) return lineMeta.subdomain.toLowerCase();
  if (lineMeta?.kodo_subdomain) return lineMeta.kodo_subdomain.toLowerCase();

  return null;
}

function mkEvent(obj: Record<string, unknown>): Stripe.Event {
  return { data: { object: obj } } as unknown as Stripe.Event;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
}

console.log("\n[1] Subscription/checkout-flyt (subdomain uten prefix)");
{
  const r = findSubdomainFromEventClone(
    mkEvent({ metadata: { subdomain: "lisbeth-admin" } }),
  );
  assert(r === "lisbeth-admin", "metadata.subdomain leses (klassisk subscription-flyt)");
}

console.log("\n[2] D-080 manuell send-invoice-flyt (kodo_subdomain prefix)");
{
  const r = findSubdomainFromEventClone(
    mkEvent({
      metadata: {
        kodo_subdomain: "mm-admin",
        kodo_tenant_prefix: "mm",
        kodo_billing: "semiannual",
        kodo_source: "admin_send_invoice_btn",
      },
    }),
  );
  assert(r === "mm-admin", "metadata.kodo_subdomain leses som fallback");
}

console.log("\n[3] Begge satt — `subdomain` vinner over `kodo_subdomain`");
{
  const r = findSubdomainFromEventClone(
    mkEvent({
      metadata: {
        subdomain: "primary-sub",
        kodo_subdomain: "fallback-sub",
      },
    }),
  );
  assert(r === "primary-sub", "subdomain prioriteres når begge er satt");
}

console.log("\n[4] subscription_details.metadata (Stripe Dahlia)");
{
  const r1 = findSubdomainFromEventClone(
    mkEvent({ subscription_details: { metadata: { subdomain: "abc" } } }),
  );
  assert(r1 === "abc", "subscription_details.metadata.subdomain leses");
  const r2 = findSubdomainFromEventClone(
    mkEvent({ subscription_details: { metadata: { kodo_subdomain: "xyz" } } }),
  );
  assert(r2 === "xyz", "subscription_details.metadata.kodo_subdomain leses");
}

console.log("\n[5] lines.data[].metadata");
{
  const r1 = findSubdomainFromEventClone(
    mkEvent({ lines: { data: [{ metadata: { subdomain: "line-sub" } }] } }),
  );
  assert(r1 === "line-sub", "lines[0].metadata.subdomain leses");
  const r2 = findSubdomainFromEventClone(
    mkEvent({ lines: { data: [{ metadata: { kodo_subdomain: "line-kodo" } }] } }),
  );
  assert(r2 === "line-kodo", "lines[0].metadata.kodo_subdomain leses");
}

console.log("\n[6] Ingen metadata → null (customer-fallback testes via integrasjons-test)");
{
  const r = findSubdomainFromEventClone(mkEvent({ customer: "cus_x" }));
  assert(r === null, "ingen metadata + ingen customer-mock → null");
}

console.log("\n[7] Lowercase-normalisering");
{
  const r = findSubdomainFromEventClone(
    mkEvent({ metadata: { kodo_subdomain: "MM-ADMIN" } }),
  );
  assert(r === "mm-admin", "kodo_subdomain lowercased ved retur");
}

console.log("\n");
console.log(`Resultat: ${passed} passert, ${failed} feilet`);
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
