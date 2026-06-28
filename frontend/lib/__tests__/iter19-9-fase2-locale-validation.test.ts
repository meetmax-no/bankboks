/**
 * Ko | Do · Vault — v4.3 Iter 19.9 Fase 2 (2026-06-13)
 *
 * Backend-validering for obligatorisk locale ved registrering + invite-accept.
 *
 * Verifiserer:
 *   1. POST /api/register UTEN locale → 400 missing_locale
 *   2. POST /api/register med ugyldig locale → 400 invalid_locale
 *   3. POST /api/register/paid UTEN locale → 400 missing_locale
 *   4. POST /api/register/paid med ugyldig locale → 400 invalid_locale
 *   5. POST /api/invite/accept UTEN locale → 400 missing_locale
 *   6. POST /api/invite/accept med ugyldig locale → 400 invalid_locale
 *
 * Tester ÅPNER og kaller POST-handlere direkte (ikke gjennom HTTP),
 * så vi unngår å mocke Upstash/Stripe.
 */

// Mock env-flagg som rate-limit + turnstile-modulene leser
process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

import { POST as registerPost } from "../../app/api/register/route";
import { POST as registerPaidPost } from "../../app/api/register/paid/route";
import { POST as invitePost } from "../../app/api/invite/accept/route";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function makeReq(body: object): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<{ ok: boolean; error?: string }> {
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

async function runTests() {
  // ─── /api/register ──────────────────────────────────────────────
  console.log("\nPOST /api/register — obligatorisk locale");
  {
    const res = await registerPost(
      makeReq({ subdomain: "test-loc", email: "a@b.no" }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `manglende locale → 400 (faktisk: ${res.status})`);
    assert(body.error === "missing_locale", `error=missing_locale (faktisk: '${body.error}')`);
  }
  {
    const res = await registerPost(
      makeReq({ subdomain: "test-loc", email: "a@b.no", locale: "fr" }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `ugyldig locale 'fr' → 400 (faktisk: ${res.status})`);
    assert(body.error === "invalid_locale", `error=invalid_locale (faktisk: '${body.error}')`);
  }

  // ─── /api/register/paid ─────────────────────────────────────────
  console.log("\nPOST /api/register/paid — obligatorisk locale");
  {
    const res = await registerPaidPost(
      makeReq({ subdomain: "test-paid", email: "a@b.no", plan: "monthly" }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `manglende locale → 400 (faktisk: ${res.status})`);
    assert(body.error === "missing_locale", `error=missing_locale (faktisk: '${body.error}')`);
  }
  {
    const res = await registerPaidPost(
      makeReq({
        subdomain: "test-paid",
        email: "a@b.no",
        plan: "monthly",
        locale: "xy",
      }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `ugyldig locale 'xy' → 400 (faktisk: ${res.status})`);
    assert(body.error === "invalid_locale", `error=invalid_locale (faktisk: '${body.error}')`);
  }

  // ─── /api/invite/accept ─────────────────────────────────────────
  console.log("\nPOST /api/invite/accept — obligatorisk locale");
  {
    const res = await invitePost(
      makeReq({ token: "fake-token", email: "user@firma.no" }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `manglende locale → 400 (faktisk: ${res.status})`);
    assert(body.error === "missing_locale", `error=missing_locale (faktisk: '${body.error}')`);
  }
  {
    const res = await invitePost(
      makeReq({
        token: "fake-token",
        email: "user@firma.no",
        locale: "de",
      }),
    );
    const body = await readJson(res);
    assert(res.status === 400, `ugyldig locale 'de' → 400 (faktisk: ${res.status})`);
    assert(body.error === "invalid_locale", `error=invalid_locale (faktisk: '${body.error}')`);
  }

  console.log("\n──────────────────────────────────────");
  console.log(`Resultat: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Feilet:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
