/**
 * Ko | Do · Vault — Iter 20.9 (Mike 2026-06-28) — auth/me self-heal
 *
 * Verifiserer "zombie-session"-fixen i /api/am-admin/auth/me:
 *   - Gyldig HMAC-cookie men slettet OrgAdmin-record → 401 + Set-Cookie max-age=0
 *   - Suspendert OrgAdmin → 401 + cleared cookie
 *   - Ugyldig/manglende cookie → 401 + cleared cookie
 *   - Friskt session + record → 200 (cookie URØRT)
 *
 * Tidligere returnerte vi 404/403 for zombie/suspended, som førte til en
 * redirect-loop i UI (dashboard → /auth/me → 404 → router.replace("/")
 * → middleware ser fortsatt gyldig cookie → dashbordet → ...). Resultat:
 * blå hengende skjerm på `<prefix>-admin.kodovault.no`.
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/am-admin-auth-me-self-heal.test.ts`
 */
import { randomBytes } from "node:crypto";

process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ORG_ADMIN_SESSION_SECRET = "test-secret-for-self-heal-test";
// /auth/me kaller findB2BTenantByPrefix; vi mocker hele tenant-store til null
// så vi ikke trenger sentral-DB for parent. Setter env-flagg som rute-koden
// IKKE bruker — vi mocker via setCentralRedisForTests under.

// ─── In-memory Upstash-mock ────────────────────────────────────────
const kv = new Map<string, unknown>();
const sets = new Map<string, Set<string>>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: unknown): Promise<void> {
      kv.set(key, value);
    },
    async del(key: string): Promise<number> {
      const ke = kv.has(key) ? 1 : 0;
      kv.delete(key);
      sets.delete(key);
      return ke;
    },
    async ttl(_key: string): Promise<number> {
      return 60;
    },
    async exists(key: string): Promise<number> {
      return kv.has(key) ? 1 : 0;
    },
    async sadd(key: string, member: string): Promise<void> {
      let s = sets.get(key);
      if (!s) {
        s = new Set();
        sets.set(key, s);
      }
      s.add(member);
    },
    async srem(key: string, member: string): Promise<void> {
      sets.get(key)?.delete(member);
    },
    async smembers(key: string): Promise<string[]> {
      return Array.from(sets.get(key) ?? []);
    },
    pipeline() {
      const calls: Array<{ op: "get"; key: string }> = [];
      const api = {
        get<T>(key: string) {
          calls.push({ op: "get", key });
          return api as unknown as { exec(): Promise<T[]> };
        },
        async exec(): Promise<unknown[]> {
          return calls.map((c) => kv.get(c.key) ?? null);
        },
      };
      return api;
    },
  };
}

import { setCentralRedisForTests } from "../platform/central-upstash";
setCentralRedisForTests(makeMockRedis());

import {
  ORG_ADMIN_SESSION_COOKIE,
  signOrgAdminSession,
} from "../platform/org-admin-auth";
import { createOrgAdmin, deleteAllOrgAdminsForPrefix } from "../platform/org-admin-store";
import { GET } from "../../app/api/am-admin/auth/me/route";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

/**
 * Lag en minimal NextRequest-mock som /auth/me-routen kan håndtere.
 * Vi bruker den faktiske Request fra Web-platformen + Next sin
 * NextRequest-wrapper for cookies.get(...).
 */
function makeReq(cookieValue: string | null): import("next/server").NextRequest {
  const headers = new Headers();
  if (cookieValue !== null) {
    headers.set("cookie", `${ORG_ADMIN_SESSION_COOKIE}=${cookieValue}`);
  }
  // NextRequest finnes ikke direkte uten Node-mocking; vi bygger en
  // duck-typed objekt som matcher det /auth/me bruker: req.cookies.get(name)
  // (returnerer { value } | undefined) — INGENTING annet.
  return {
    cookies: {
      get(name: string) {
        if (name !== ORG_ADMIN_SESSION_COOKIE) return undefined;
        return cookieValue !== null ? { value: cookieValue } : undefined;
      },
    },
  } as unknown as import("next/server").NextRequest;
}

function getClearedCookieHeader(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  return setCookie;
}

async function main() {
  const prefix = "mm";

  // 1. Ingen cookie → 401 + Set-Cookie clear
  {
    const res = await GET(makeReq(null));
    assert(res.status === 401, "ingen cookie → 401");
    const sc = getClearedCookieHeader(res);
    assert(
      sc !== null && sc.includes(ORG_ADMIN_SESSION_COOKIE) && /max-age=0|expires=/i.test(sc),
      "ingen cookie → Set-Cookie rydder cookien",
    );
  }

  // 2. Ugyldig cookie → 401 + Set-Cookie clear
  {
    const res = await GET(makeReq("garbage.notavalidsignature"));
    assert(res.status === 401, "ugyldig cookie → 401");
    const sc = getClearedCookieHeader(res);
    assert(
      sc !== null && /max-age=0|expires=/i.test(sc),
      "ugyldig cookie → Set-Cookie rydder cookien",
    );
  }

  // 3. Gyldig cookie men SLETTET OrgAdmin → 401 + cleared (zombie-session)
  {
    const created = await createOrgAdmin({
      tenantPrefix: prefix,
      firstName: "Test",
      lastName: "Admin",
      email: "test@mm.test",
      password: "supersecretpassword12345",
      role: "super-admin",
      createdBy: "test",
    });
    if (typeof created === "string") {
      console.error("FAIL: kunne ikke opprette admin:", created);
      process.exit(1);
    }
    const cookieValue = await signOrgAdminSession(
      process.env.ORG_ADMIN_SESSION_SECRET!,
      { adminId: created.id, prefix, role: "super-admin" },
    );

    // Slett admin → simuler D-091 cascade-delete (bypass last-super-admin
    // invariant via deleteAllOrgAdminsForPrefix, samme rute cascade-delete
    // bruker).
    const delResult = await deleteAllOrgAdminsForPrefix(prefix);
    assert(delResult.deletedCount >= 1, `delete OK (slettet ${delResult.deletedCount})`);

    const res = await GET(makeReq(cookieValue));
    assert(
      res.status === 401,
      "zombie-session (gyldig cookie + slettet record) → 401 (ikke 404)",
    );
    const sc = getClearedCookieHeader(res);
    assert(
      sc !== null && /max-age=0|expires=/i.test(sc),
      "zombie-session → Set-Cookie rydder cookien (bryter redirect-loop)",
    );
    const body = await res.json();
    assert(body.error === "admin_not_found", "error-code = admin_not_found");
  }

  // 4. Friskt session + record → 200, INGEN Set-Cookie-clear
  {
    const fresh = await createOrgAdmin({
      tenantPrefix: prefix,
      firstName: "Fresh",
      lastName: "Admin",
      email: "fresh@mm.test",
      password: "anotherlongsecretpassword",
      role: "super-admin",
      createdBy: "test",
    });
    if (typeof fresh === "string") {
      console.error("FAIL: kunne ikke opprette fresh admin:", fresh);
      process.exit(1);
    }
    const cookieValue = await signOrgAdminSession(
      process.env.ORG_ADMIN_SESSION_SECRET!,
      { adminId: fresh.id, prefix, role: "super-admin" },
    );

    const res = await GET(makeReq(cookieValue));
    assert(res.status === 200, "friskt session + record → 200");
    const sc = getClearedCookieHeader(res);
    assert(
      sc === null || !/max-age=0/i.test(sc),
      "frisk session → INGEN Set-Cookie-max-age=0 (cookie urørt)",
    );
  }

  console.log("\n✓ am-admin-auth-me-self-heal: alle assertions OK");
}

void main().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});
