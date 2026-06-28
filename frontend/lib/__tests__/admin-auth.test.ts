/**
 * Ko | Do · Vault — v4.3 Iter 0 — Unit tests for admin-auth
 *
 * Kjør med: cd /app/frontend && npx tsx lib/__tests__/admin-auth.test.ts
 *
 * Vi tester KUN HMAC-cookie-veien (Web Crypto-basert). Argon2id-hashing er
 * native binding og forutsettes fungere — det er en plain wrapper rundt
 * `@node-rs/argon2` som har egne tester.
 */
import {
  signAdminSession,
  verifyAdminSession,
  ADMIN_SESSION_TTL_SECONDS,
} from "../platform/admin-auth";

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

async function run() {
  console.log("admin-auth.test.ts");
  console.log("─".repeat(60));

  const SECRET = "test-secret-32-bytes-aaaaaaaaaaaaaaaaaaaaaaaaaa";

  // ─── signAdminSession ───────────────────────────────────────────────
  const cookie = await signAdminSession(SECRET);
  assert(typeof cookie === "string", "signAdminSession returnerer string");
  assert(cookie.includes("."), "cookie har punktum-separator");
  assert(cookie.split(".").length === 2, "cookie har eksakt to deler");

  // ─── verifyAdminSession — gyldig cookie ─────────────────────────────
  const payload = await verifyAdminSession(cookie, SECRET);
  assert(payload !== null, "verifyAdminSession aksepterer gyldig cookie");
  assert(typeof payload?.iat === "number", "payload har iat");
  assert(typeof payload?.exp === "number", "payload har exp");
  assert(
    (payload?.exp ?? 0) - (payload?.iat ?? 0) === ADMIN_SESSION_TTL_SECONDS,
    "exp - iat = TTL (8 timer)",
  );

  // ─── verifyAdminSession — feil secret ───────────────────────────────
  const wrongSecret = await verifyAdminSession(cookie, "wrong-secret");
  assert(wrongSecret === null, "feil secret avvises");

  // ─── verifyAdminSession — tom cookie ────────────────────────────────
  const noCookie = await verifyAdminSession("", SECRET);
  assert(noCookie === null, "tom cookie avvises");

  const undef = await verifyAdminSession(undefined, SECRET);
  assert(undef === null, "undefined cookie avvises");

  // ─── verifyAdminSession — malformed cookie ──────────────────────────
  const noDot = await verifyAdminSession("nodotatall", SECRET);
  assert(noDot === null, "cookie uten punktum avvises");

  const threeParts = await verifyAdminSession("a.b.c", SECRET);
  assert(threeParts === null, "cookie med tre deler avvises");

  // ─── verifyAdminSession — tampered signatur ─────────────────────────
  const [head, sig] = cookie.split(".");
  const tampered = `${head}.${sig.slice(0, -2)}xx`;
  const tamperedRes = await verifyAdminSession(tampered, SECRET);
  assert(tamperedRes === null, "tampered signatur avvises");

  // ─── verifyAdminSession — tampered payload ──────────────────────────
  const fakePayload = btoa(JSON.stringify({ iat: 0, exp: 9999999999 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tamperedPayload = `${fakePayload}.${sig}`;
  const tpRes = await verifyAdminSession(tamperedPayload, SECRET);
  assert(tpRes === null, "tampered payload (samme sig) avvises");

  // ─── verifyAdminSession — utløpt session ────────────────────────────
  // Vi kan ikke direkte signere en utløpt session via signAdminSession,
  // men vi kan lage en med base64url-encoding manuelt.
  function b64uEncode(s: string): string {
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function hmacB64u(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const buf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(msg),
    );
    return b64uEncode(String.fromCharCode(...new Uint8Array(buf)));
  }

  const now = Math.floor(Date.now() / 1000);
  const expiredPayload = b64uEncode(
    JSON.stringify({ iat: now - 100000, exp: now - 1 }),
  );
  const expiredSig = await hmacB64u(SECRET, expiredPayload);
  const expiredCookie = `${expiredPayload}.${expiredSig}`;
  const expiredRes = await verifyAdminSession(expiredCookie, SECRET);
  assert(expiredRes === null, "utløpt session avvises");

  // ─── verifyAdminSession — gyldig session som ikke er utløpt ────────
  const futurePayload = b64uEncode(
    JSON.stringify({ iat: now, exp: now + 3600 }),
  );
  const futureSig = await hmacB64u(SECRET, futurePayload);
  const futureCookie = `${futurePayload}.${futureSig}`;
  const futureRes = await verifyAdminSession(futureCookie, SECRET);
  assert(futureRes !== null, "ikke-utløpt session aksepteres");

  // ─── signAdminSession — krever secret ──────────────────────────────
  let threw = false;
  try {
    await signAdminSession("");
  } catch {
    threw = true;
  }
  assert(threw, "signAdminSession kaster ved tom secret");

  console.log("─".repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
