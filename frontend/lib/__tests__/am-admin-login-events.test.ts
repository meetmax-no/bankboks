/**
 * Ko | Do · Vault — Iter 20.9 (D-086) — Tester for login-events + session-invalidation
 *
 * Tester:
 *   1. recordLoginEvent skriver event til sorted-set
 *   2. listLoginEvents returnerer events innenfor 90-dagers vinduet
 *   3. Events utenfor cutoff filtreres bort
 *   4. MAX_EVENTS_PER_ADMIN-prune-grense holdes
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/am-admin-login-events.test.ts`
 */
import { randomBytes } from "node:crypto";

process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// Mock sentral Upstash med sorted-set støtte (zadd/zremrangebyrank/zrange).
type ZEntry = { score: number; member: string };
const sortedSets = new Map<string, ZEntry[]>();
const kv = new Map<string, unknown>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: unknown): Promise<void> {
      kv.set(key, value);
    },
    async del(key: string): Promise<void> {
      kv.delete(key);
      sortedSets.delete(key);
    },
    async zadd(
      key: string,
      args: { score: number; member: string },
    ): Promise<void> {
      const arr = sortedSets.get(key) ?? [];
      arr.push({ score: args.score, member: args.member });
      arr.sort((a, b) => a.score - b.score);
      sortedSets.set(key, arr);
    },
    async zremrangebyrank(
      key: string,
      start: number,
      stop: number,
    ): Promise<void> {
      const arr = sortedSets.get(key);
      if (!arr) return;
      // Negative indices: count from end (Redis semantics).
      const len = arr.length;
      const s = start < 0 ? len + start : start;
      const e = stop < 0 ? len + stop : stop;
      if (s > e) return;
      const filtered = arr.filter((_, i) => i < s || i > e);
      sortedSets.set(key, filtered);
    },
    async zrange(
      key: string,
      min: number,
      _max: number | "+inf",
      _opts?: { byScore?: boolean; rev?: boolean },
    ): Promise<string[]> {
      const arr = sortedSets.get(key) ?? [];
      return arr.filter((e) => e.score >= min).map((e) => e.member);
    },
  };
}

import { setCentralRedisForTests } from "../platform/central-upstash";
setCentralRedisForTests(makeMockRedis());

import {
  recordLoginEvent,
  listLoginEvents,
  _LOGIN_EVENTS_INTERNAL,
} from "../platform/org-admin-login-events";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log("OK:", msg);
    passed++;
  } else {
    console.error("FAIL:", msg);
    failed++;
  }
}

async function main(): Promise<void> {
  const adminA = "admin-a";
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // ── 1. recordLoginEvent skriver event ─────────────────────────
  await recordLoginEvent(adminA, {
    ts: now,
    ip: "1.2.3.4",
    ua: "Chrome/110",
    host: "mm-admin.kodovault.no",
  });
  const events1 = await listLoginEvents(adminA);
  assert(events1.length === 1, "1 event etter første recordLoginEvent");
  assert(events1[0]?.ip === "1.2.3.4", "IP matches");

  // ── 2. Event utenfor 90-dagers cutoff filtreres bort ─────────
  await recordLoginEvent(adminA, {
    ts: now - 100 * day, // 100 dager siden
    ip: "9.9.9.9",
    ua: "OldBrowser",
    host: "mm-admin.kodovault.no",
  });
  const events2 = await listLoginEvents(adminA, 90);
  const oldEventVisible = events2.some((e) => e.ip === "9.9.9.9");
  assert(
    !oldEventVisible,
    "Event >90 dager siden ekskluderes ved 90-dagers vindu",
  );

  // ── 3. 365-dagers vindu inkluderer både ───────────────────────
  const events3 = await listLoginEvents(adminA, 365);
  assert(
    events3.some((e) => e.ip === "9.9.9.9"),
    "365-dagers vindu inkluderer gammel event",
  );

  // ── 4. MAX_EVENTS_PER_ADMIN-prune holder grensen ──────────────
  const max = _LOGIN_EVENTS_INTERNAL.MAX_EVENTS_PER_ADMIN;
  // Legg til mer enn MAX events
  for (let i = 0; i < max + 10; i++) {
    await recordLoginEvent("admin-b", {
      ts: now - i * 1000,
      ip: `10.0.0.${i}`,
      ua: "test",
      host: "h",
    });
  }
  const eventsB = await listLoginEvents("admin-b", 90);
  assert(
    eventsB.length <= max,
    `events for admin-b er prunet til ≤ ${max} (faktisk: ${eventsB.length})`,
  );

  // ── 5. Sortering nyest først ──────────────────────────────────
  await recordLoginEvent("admin-c", {
    ts: now - 1000,
    ip: "1.1.1.1",
    ua: "old",
    host: "h",
  });
  await recordLoginEvent("admin-c", {
    ts: now,
    ip: "2.2.2.2",
    ua: "new",
    host: "h",
  });
  const eventsC = await listLoginEvents("admin-c");
  assert(
    eventsC[0]?.ip === "2.2.2.2",
    "Nyeste event vises først i listen",
  );

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Test crashed:", e);
  process.exit(1);
});
