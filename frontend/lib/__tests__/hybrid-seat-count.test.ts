/**
 * Ko | Do · Vault — D-092 (2026-06-28) — Hybrid-seat: countActivePendingInvites
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/hybrid-seat-count.test.ts`
 *
 * Verifiserer at:
 *   - pending + ikke-utløpt invites telles
 *   - status=expired ignoreres
 *   - status=used ignoreres
 *   - utløpte (men fortsatt status=pending) ignoreres
 *   - manuell DELETE → record borte → telles ikke
 */
import { randomBytes } from "node:crypto";

process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");

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
      return 60; // alltid noe positivt
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
  countActivePendingInvites,
  createInvite,
  deleteInvite,
  putInvite,
} from "../platform/invite-store";
import type { InviteRecord } from "../platform/invite-types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

async function main() {
  // 1. Tom — ingen invites → 0
  assert(
    (await countActivePendingInvites("mm")) === 0,
    "tom prefix → 0 pending",
  );

  // 2. Opprett 3 pending — alle ferske
  const a = await createInvite({
    subdomain: "mm-anna",
    parentTenant: "mm",
    email: "anna@meetmax.no",
    createdBy: "am-admin",
  });
  await createInvite({
    subdomain: "mm-bjarne",
    parentTenant: "mm",
    email: "bjarne@meetmax.no",
    createdBy: "am-admin",
  });
  const c = await createInvite({
    subdomain: "mm-charlie",
    parentTenant: "mm",
    email: "charlie@meetmax.no",
    createdBy: "am-admin",
  });
  assert(
    (await countActivePendingInvites("mm")) === 3,
    "3 ferske pending → 3",
  );

  // 3. Slett en manuelt (admin trekker tilbake) → 2
  await deleteInvite(a);
  assert(
    (await countActivePendingInvites("mm")) === 2,
    "etter manuell DELETE → 2",
  );

  // 4. Sett en til status=used (ansatt fullført) → 1
  const usedRec: InviteRecord = { ...c, status: "used", usedAt: new Date().toISOString() };
  await putInvite(usedRec);
  assert(
    (await countActivePendingInvites("mm")) === 1,
    "etter accept (status=used) → 1",
  );

  // 5. Sett en til status=expired (cron flagget) → 0
  const remaining = Array.from(sets.get("invite-index:mm") ?? []);
  // Finn den som fortsatt er "pending"
  for (const tok of remaining) {
    const blob = kv.get(`invite:${tok}`);
    if (!blob) continue;
    // Vi har ikke decrypt her — bruk listInvitesForParent indirekte i steden:
    // Lat oss heller manipulere direkte via putInvite.
    void blob;
  }
  // Hent den ene gjenstående pending via listInvitesForParent
  const { listInvitesForParent } = await import("../platform/invite-store");
  const all = await listInvitesForParent("mm");
  const stillPending = all.find((r) => r.status === "pending");
  if (stillPending) {
    await putInvite({ ...stillPending, status: "expired" });
  }
  assert(
    (await countActivePendingInvites("mm")) === 0,
    "etter expired → 0",
  );

  // 6. Pending med expiresAt i fortiden (kron ikke kjørt enda) → ignoreres
  await createInvite({
    subdomain: "mm-dora",
    parentTenant: "mm",
    email: "dora@meetmax.no",
    createdBy: "am-admin",
  });
  const all2 = await listInvitesForParent("mm");
  const dora = all2.find((r) => r.subdomain === "mm-dora");
  if (dora) {
    // backdated 8 dager — expiresAt i fortiden
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await putInvite({
      ...dora,
      expiresAt: past,
      // status fortsatt "pending" — cron har ikke kjørt enda
    });
  }
  assert(
    (await countActivePendingInvites("mm")) === 0,
    "utløpt på dato men status=pending → ignoreres",
  );

  // 7. Annen prefix isolert
  await createInvite({
    subdomain: "xy-eva",
    parentTenant: "xy",
    email: "eva@firma.no",
    createdBy: "am-admin",
  });
  assert(
    (await countActivePendingInvites("xy")) === 1,
    "annen prefix har egen telling = 1",
  );
  assert(
    (await countActivePendingInvites("mm")) === 0,
    "mm fortsatt 0 — ingen lekkasje mellom prefiks",
  );

  console.log("\n✅ hybrid-seat-count.test.ts — alle assertions passert");
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(1);
});
