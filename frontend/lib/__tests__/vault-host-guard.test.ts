/**
 * Ko | Do · Vault — Iter 20.9 (D-099, Mike 2026-06-28)
 *
 * Sikkerhetstest for `checkHostMatchesPod()` — cross-tenant wildcard-fallback-vakten.
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/vault-host-guard.test.ts`
 */
export {};

import { checkHostMatchesPod } from "../server/vault-host-guard";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

function makeReq(host: string): Request {
  return new Request("https://example.test/api/vault", {
    headers: { host },
  });
}

async function main() {
  // ── 1. Tenant-pod treffer riktig host → tillates ────────────────
  process.env.NEXT_PUBLIC_CLIENT_CONFIG = "mm-nils";
  {
    const res = checkHostMatchesPod(makeReq("mm-nils.kodovault.no"));
    assert(res === null, "pod=mm-nils + host=mm-nils.kodovault.no → tillatt");
  }

  // ── 2. Tenant-pod blir truffet av FEIL host (wildcard-fallback) → 404
  {
    const res = checkHostMatchesPod(makeReq("mm-max.kodovault.no"));
    assert(res !== null && res.status === 404, "pod=mm-nils + host=mm-max → 404 BLOKKERT");
  }
  {
    const res = checkHostMatchesPod(makeReq("admin.kodovault.no"));
    assert(
      res !== null && res.status === 404,
      "pod=mm-nils + host=admin.kodovault.no → 404 BLOKKERT (admin-host treffer ikke tenant-pod)",
    );
  }
  {
    const res = checkHostMatchesPod(makeReq("kodovault.no"));
    assert(
      res !== null && res.status === 404,
      "pod=mm-nils + host=kodovault.no (apex) → 404 BLOKKERT",
    );
  }

  // ── 3. Admin-pod (ingen NEXT_PUBLIC_CLIENT_CONFIG) ──────────────
  delete process.env.NEXT_PUBLIC_CLIENT_CONFIG;
  {
    const res = checkHostMatchesPod(makeReq("admin.kodovault.no"));
    assert(res === null, "admin-pod + host=admin.kodovault.no → tillatt");
  }
  {
    const res = checkHostMatchesPod(makeReq("mm-nils.kodovault.no"));
    assert(
      res !== null && res.status === 404,
      "admin-pod + host=mm-nils.kodovault.no → 404 BLOKKERT (forhindrer at admin-poden's vault lekker til mm-nils når wildcard-fallback aktiveres)",
    );
  }
  {
    const res = checkHostMatchesPod(makeReq("mm-admin.kodovault.no"));
    assert(
      res !== null && res.status === 404,
      "admin-pod + host=mm-admin.kodovault.no (Konsoll-host) → 404 BLOKKERT",
    );
  }

  // ── 4. Dev/preview ─────────────────────────────────────────────
  process.env.NEXT_PUBLIC_CLIENT_CONFIG = "mm-nils";
  {
    const res = checkHostMatchesPod(makeReq("localhost"));
    assert(res === null, "dev: localhost → tillatt (uavhengig av pod)");
  }
  {
    const res = checkHostMatchesPod(makeReq("127.0.0.1"));
    assert(res === null, "dev: 127.0.0.1 → tillatt");
  }
  {
    const res = checkHostMatchesPod(makeReq("foo.preview.emergentagent.com"));
    assert(res === null, "preview: *.preview.emergentagent.com → tillatt");
  }
  {
    const res = checkHostMatchesPod(makeReq("test-deploy.vercel.app"));
    assert(res === null, "preview: *.vercel.app → tillatt");
  }

  // ── 5. Case-insensitive host-matching ──────────────────────────
  process.env.NEXT_PUBLIC_CLIENT_CONFIG = "mm-nils";
  {
    const res = checkHostMatchesPod(makeReq("MM-NILS.KODOVAULT.NO"));
    assert(res === null, "case-insensitive: stor bokstav matcher fortsatt");
  }

  // ── 6. x-forwarded-host overstyrer host (Vercel proxy) ─────────
  process.env.NEXT_PUBLIC_CLIENT_CONFIG = "mm-nils";
  {
    const req = new Request("https://example.test/api/vault", {
      headers: {
        host: "internal-vercel.local",
        "x-forwarded-host": "mm-nils.kodovault.no",
      },
    });
    const res = checkHostMatchesPod(req);
    assert(res === null, "x-forwarded-host=mm-nils.kodovault.no → tillatt selv om host-header er intern");
  }
  {
    const req = new Request("https://example.test/api/vault", {
      headers: {
        host: "internal-vercel.local",
        "x-forwarded-host": "wrong-host.kodovault.no",
      },
    });
    const res = checkHostMatchesPod(req);
    assert(
      res !== null && res.status === 404,
      "x-forwarded-host=feil → 404 BLOKKERT (kan ikke spoofes via x-forwarded-host)",
    );
  }

  console.log("\n✓ vault-host-guard: alle assertions OK (13 sikkerhets-tester passert)");
}

void main().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});
