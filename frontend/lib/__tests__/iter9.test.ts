/**
 * Ko | Do · Vault — v4.3 Iter 9 — Unit-tester for upstash-provision
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/iter9.test.ts`
 *
 * Tester:
 *   - upstashDatabaseName (lowercase + prefiks)
 *   - getBasicAuthHeader (base64 av email:apikey)
 *   - createUpstashDatabase (request-payload + region + endpoint)
 *   - provisionTenantOnUpstash (full flyt — bruker create-respons direkte)
 *   - provisionTenantOnUpstash (fallback til getDatabaseRestCredentials)
 *
 * Vi mocker globalThis.fetch så ingen ekte API-kall gjøres.
 */
import {
  upstashDatabaseName,
  createUpstashDatabase,
  provisionTenantOnUpstash,
} from "../platform/upstash-provision";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

async function runTests() {

// ─── upstashDatabaseName ────────────────────────────────────────────────
console.log("\nupstashDatabaseName — normalisering");
assert(
  upstashDatabaseName("Terje") === "kodo-kv-terje",
  "lowercase'er subdomain",
);
assert(
  upstashDatabaseName("  acme  ") === "kodo-kv-acme",
  "trimmer mellomrom",
);
assert(
  upstashDatabaseName("test-subdomain") === "kodo-kv-test-subdomain",
  "beholder bindestreker",
);

// ─── createUpstashDatabase ──────────────────────────────────────────────
console.log("\ncreateUpstashDatabase — request-payload");

// Set test env-vars before requiring the module
process.env.UPSTASH_MANAGEMENT_EMAIL = "test@example.com";
process.env.UPSTASH_MANAGEMENT_API_KEY = "test-pat-123";

interface CapturedCall {
  url: string;
  init: RequestInit;
}
const capturedCalls: CapturedCall[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(response: unknown, status = 200) {
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedCalls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

await (async () => {
  capturedCalls.length = 0;
  mockFetch({
    database_id: "db-abc-123",
    database_name: "kodo-kv-terje",
    region: "eu-west-1",
    endpoint: "eu1-rich-bug-123.upstash.io",
    rest_token: "TOKEN_XYZ",
  });
  const result = await createUpstashDatabase("Terje");

  assert(
    capturedCalls.length === 1,
    "gjør nøyaktig 1 HTTP-kall (ingen retry på 200)",
  );
  const call = capturedCalls[0];
  assert(
    call.url === "https://api.upstash.com/v2/redis/database",
    "kaller POST /v2/redis/database",
  );
  assert(call.init.method === "POST", "method = POST");
  const headers = call.init.headers as Record<string, string>;
  const expectedAuth =
    "Basic " +
    Buffer.from("test@example.com:test-pat-123").toString("base64");
  assert(
    headers.Authorization === expectedAuth,
    "Authorization-header = Basic base64(email:apikey)",
  );
  assert(
    headers["Content-Type"] === "application/json",
    "Content-Type = application/json",
  );
  const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
  assert(body.name === "kodo-kv-terje", "request-body.name = kodo-kv-<subdomain>");
  assert(body.region === "global", "request-body.region = global (regional deprecated)");
  assert(
    body.primary_region === "eu-west-1",
    "request-body.primary_region = eu-west-1 (GDPR + latens)",
  );
  assert(
    Array.isArray(body.read_regions) && (body.read_regions as unknown[]).length === 0,
    "request-body.read_regions = [] (kun primary)",
  );
  assert(body.tls === true, "request-body.tls = true");
  assert(result.database_id === "db-abc-123", "returnerer database_id");
})();

// ─── provisionTenantOnUpstash — happy path med creds i create-respons ──
console.log("\nprovisionTenantOnUpstash — happy path (creds in create-response)");
await (async () => {
  capturedCalls.length = 0;
  mockFetch({
    database_id: "db-happy",
    database_name: "kodo-kv-acme",
    region: "eu-west-1",
    endpoint: "eu1-happy-fox-42.upstash.io",
    rest_token: "REST_TOKEN_HAPPY",
  });
  const result = await provisionTenantOnUpstash("acme");

  assert(
    capturedCalls.length === 1,
    "kun 1 HTTP-kall når creds er i create-respons",
  );
  assert(result.databaseId === "db-happy", "returnerer databaseId");
  assert(
    result.restUrl === "https://eu1-happy-fox-42.upstash.io",
    "restUrl prefikset med https://",
  );
  assert(
    result.restToken === "REST_TOKEN_HAPPY",
    "restToken hentet fra create-respons",
  );
})();

// ─── provisionTenantOnUpstash — fallback til GET når creds mangler ─────
console.log("\nprovisionTenantOnUpstash — fallback til GET når creds mangler");
await (async () => {
  capturedCalls.length = 0;
  let callIndex = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    capturedCalls.push({ url: String(url), init: init ?? {} });
    if (callIndex === 0) {
      callIndex += 1;
      // Create-respons UTEN endpoint/rest_token
      return new Response(
        JSON.stringify({
          database_id: "db-fallback",
          database_name: "kodo-kv-fallback",
          region: "eu-west-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // GET-respons med creds
    return new Response(
      JSON.stringify({
        database_id: "db-fallback",
        database_name: "kodo-kv-fallback",
        region: "eu-west-1",
        endpoint: "eu1-fallback-cat.upstash.io",
        rest_token: "REST_TOKEN_FALLBACK",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;

  const result = await provisionTenantOnUpstash("fallback");

  assert(capturedCalls.length === 2, "gjør 2 HTTP-kall (POST + GET fallback)");
  assert(
    capturedCalls[1].url ===
      "https://api.upstash.com/v2/redis/database/db-fallback",
    "GET /v2/redis/database/<id>",
  );
  assert(capturedCalls[1].init.method === "GET", "fallback-kall er GET");
  assert(result.databaseId === "db-fallback", "returnerer korrekt databaseId");
  assert(
    result.restUrl === "https://eu1-fallback-cat.upstash.io",
    "restUrl fra GET-respons",
  );
  assert(
    result.restToken === "REST_TOKEN_FALLBACK",
    "restToken fra GET-respons",
  );
})();

// ─── createUpstashDatabase — feilhåndtering ─────────────────────────────
console.log("\ncreateUpstashDatabase — kaster ved 4xx");
await (async () => {
  globalThis.fetch = (async () =>
    new Response("Unauthorized", { status: 401 })) as typeof globalThis.fetch;
  let threw = false;
  try {
    await createUpstashDatabase("badauth");
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && e.message.includes("401"),
      "feilmelding inneholder HTTP-statuskode",
    );
  }
  assert(threw, "kaster Error ved 401-respons");
})();

// ─── createUpstashDatabase — env-validering ─────────────────────────────
console.log("\ncreateUpstashDatabase — env-validering");
await (async () => {
  const origEmail = process.env.UPSTASH_MANAGEMENT_EMAIL;
  delete process.env.UPSTASH_MANAGEMENT_EMAIL;
  let threw = false;
  try {
    await createUpstashDatabase("noenv");
  } catch (e) {
    threw = true;
    assert(
      e instanceof Error && e.message.includes("UPSTASH_MANAGEMENT_EMAIL"),
      "feilmelding nevner UPSTASH_MANAGEMENT_EMAIL",
    );
  }
  assert(threw, "kaster når UPSTASH_MANAGEMENT_EMAIL mangler");
  process.env.UPSTASH_MANAGEMENT_EMAIL = origEmail;
})();

// ─── Restore + summary ──────────────────────────────────────────────────
globalThis.fetch = originalFetch;

console.log("\n─────────────────────────────────────────");
console.log(`${passed} bestått · ${failed} feilet`);
if (failed > 0) {
  console.log("\nFeilede tester:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Alle iter9-tester bestått.");

}

runTests().catch((e) => {
  console.error("Uventet feil:", e);
  process.exit(1);
});
