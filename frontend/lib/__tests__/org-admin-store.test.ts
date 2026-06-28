/**
 * Ko | Do · Vault — Iter 20.1 — Offline-tester for org-admin-store
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/org-admin-store.test.ts`
 *
 * Strategi: vi mocker `getCentralRedis()` med en in-memory implementasjon
 * som speiler Upstash Redis SDK-overflaten vi bruker (get/set/del/sadd/
 * srem/smembers/pipeline.exec). Slik tester vi store-logikken + invariants
 * uten å kreve faktisk Upstash-tilkobling.
 *
 * Krypterings-laget (`tenant-crypto`) er ekte — krever
 * `CENTRAL_ENCRYPTION_KEY` env var. Vi setter en test-key i prosessen.
 */
import { randomBytes } from "node:crypto";

// Sett ekte 32-byte hex-key FØR vi importerer tenant-crypto-konsumenter.
process.env.CENTRAL_ENCRYPTION_KEY = randomBytes(32).toString("hex");

// ─── In-memory mock av Upstash Redis ────────────────────────────────
type StoredValue = unknown;
const kv = new Map<string, StoredValue>();
const sets = new Map<string, Set<string>>();

function makeMockRedis() {
  return {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    },
    async set(key: string, value: StoredValue): Promise<void> {
      kv.set(key, value);
    },
    async del(key: string): Promise<void> {
      kv.delete(key);
      // Upstash DEL fjerner nøkler uansett type — også SET. Speil den
      // semantikken her så cascade-purge-tester ikke får falske negativer.
      sets.delete(key);
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
          return api;
        },
        async exec(): Promise<unknown[]> {
          return calls.map((c) => kv.get(c.key) ?? null);
        },
      };
      return api;
    },
  };
}

// Mock central-upstash før vi importerer store-en.
import { setCentralRedisForTests } from "../platform/central-upstash";
const mockRedis = makeMockRedis();
setCentralRedisForTests(mockRedis);

// Nå kan vi importere store-en uten å trekke inn ekte Upstash-creds.
import {
  countSuperAdmins,
  createOrgAdmin,
  deleteOrgAdmin,
  findOrgAdminByEmail,
  getOrgAdmin,
  listOrgAdmins,
  putOrgAdmin,
  setOrgAdminRole,
  suspendOrgAdmin,
  unsuspendOrgAdmin,
  updateOrgAdminPassword,
} from "../platform/org-admin-store";
import { OrgAdminError, toOrgAdminPublic } from "../platform/org-admin-types";
import { verifyPassword } from "../platform/password-hash";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

function clearAll() {
  kv.clear();
  sets.clear();
}

// ───── Test 1: opprett super-admin, hent, list ─────
async function test1_create_and_list() {
  clearAll();
  const result = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Kari",
    lastName: "Nordmann",
    email: "kari@advokatfirma.no",
    password: "super-secret-12345",
    role: "super-admin",
    createdBy: "mike@admin",
  });
  assert(typeof result !== "string", "createOrgAdmin returnerte OrgAdmin, ikke feilkode");
  if (typeof result === "string") return;
  assert(result.email === "kari@advokatfirma.no", "email normalisert");
  assert(result.role === "super-admin", "rolle satt");
  assert(result.suspended === false, "suspended default false");
  assert(result.passwordHash.startsWith("$2b$12$"), "bcrypt-hash format $2b$12$");

  const fetched = await getOrgAdmin("am", result.id);
  assert(fetched !== null, "getOrgAdmin fant admin");
  assert(fetched?.id === result.id, "samme ID etter roundtrip");

  const list = await listOrgAdmins("am");
  assert(list.length === 1, "listOrgAdmins returnerer 1 admin");

  const verified = await verifyPassword("super-secret-12345", result.passwordHash);
  assert(verified === true, "bcrypt verify OK med riktig passord");

  const wrong = await verifyPassword("wrong-password", result.passwordHash);
  assert(wrong === false, "bcrypt verify FAILER med feil passord");
}

// ───── Test 2: email-uniqueness per org ─────
async function test2_email_uniqueness() {
  clearAll();
  await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Kari",
    lastName: "N",
    email: "kari@firma.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  const dup = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Annen",
    lastName: "Person",
    email: "KARI@firma.no", // ulik casing
    password: "passord1234",
    role: "admin",
    createdBy: "mike",
  });
  assert(dup === OrgAdminError.EmailAlreadyExists, "duplicate email avvises (case-insensitive)");
}

// ───── Test 3: validering ─────
async function test3_validation() {
  clearAll();
  const bad1 = await createOrgAdmin({
    tenantPrefix: "AM!", // ugyldig
    firstName: "X",
    lastName: "Y",
    email: "a@b.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  assert(bad1 === OrgAdminError.InvalidTenantPrefix, "ugyldig prefix avvises");

  const bad2 = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "X",
    lastName: "Y",
    email: "ikke-en-epost",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  assert(bad2 === OrgAdminError.InvalidEmail, "ugyldig email avvises");

  const bad3 = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "X",
    lastName: "Y",
    email: "a@b.no",
    password: "passord1234",
    role: "evil-admin" as never,
    createdBy: "mike",
  });
  assert(bad3 === OrgAdminError.InvalidRole, "ugyldig rolle avvises");

  const bad4 = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "X",
    lastName: "Y",
    email: "a@b.no",
    password: "kort",
    role: "admin",
    createdBy: "mike",
  });
  assert(bad4 === OrgAdminError.WeakPassword, "for kort passord avvises");
}

// ───── Test 4: siste super-admin-invariant ─────
async function test4_last_super_admin_invariant() {
  clearAll();
  const first = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Kari",
    lastName: "N",
    email: "kari@firma.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  if (typeof first === "string") {
    assert(false, "first create skulle lykkes");
    return;
  }

  assert((await countSuperAdmins("am")) === 1, "1 super-admin etter første create");

  // Kan ikke slette siste super-admin
  const delResult = await deleteOrgAdmin("am", first.id);
  assert(delResult === OrgAdminError.LastSuperAdmin, "kan ikke slette siste super-admin");

  // Kan ikke degradere siste super-admin
  const degradeResult = await setOrgAdminRole("am", first.id, "admin");
  assert(
    degradeResult === OrgAdminError.LastSuperAdmin,
    "kan ikke degradere siste super-admin til admin",
  );

  // Kan ikke suspendere siste super-admin
  const suspendResult = await suspendOrgAdmin("am", first.id);
  assert(
    suspendResult === OrgAdminError.LastSuperAdmin,
    "kan ikke suspendere siste super-admin",
  );

  // Etter å ha lagt til en til super-admin, kan vi degradere den første
  const second = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Per",
    lastName: "P",
    email: "per@firma.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "kari@firma.no",
  });
  if (typeof second === "string") {
    assert(false, "second create skulle lykkes");
    return;
  }

  assert((await countSuperAdmins("am")) === 2, "2 super-admins");

  const degraded = await setOrgAdminRole("am", first.id, "admin");
  assert(typeof degraded !== "string", "kan degradere med 2 super-admins");
  assert((await countSuperAdmins("am")) === 1, "1 super-admin igjen etter degradering");

  // Nå er Per siste super-admin → kan ikke slettes
  const cantDelete = await deleteOrgAdmin("am", second.id);
  assert(cantDelete === OrgAdminError.LastSuperAdmin, "siste super-admin (etter degradering) beskyttet");

  // Men Kari (nå admin) kan slettes
  const okDelete = await deleteOrgAdmin("am", first.id);
  assert(okDelete === true, "vanlig admin kan slettes");
}

// ───── Test 5: suspendering er reverserbar + idempotent ─────
async function test5_suspend_unsuspend() {
  clearAll();
  // Trenger to super-admins så suspend ikke trigger invariant
  await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Super",
    lastName: "One",
    email: "s1@am.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  const target = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Adm",
    lastName: "In",
    email: "adm@am.no",
    password: "passord1234",
    role: "admin",
    createdBy: "mike",
  });
  if (typeof target === "string") {
    assert(false, "create skulle lykkes");
    return;
  }

  const suspended = await suspendOrgAdmin("am", target.id);
  assert(typeof suspended !== "string", "suspendering lykkes");
  if (typeof suspended === "string") return;
  assert(suspended.suspended === true, "suspended flag satt");

  // Idempotent
  const sameSuspended = await suspendOrgAdmin("am", target.id);
  assert(typeof sameSuspended !== "string", "re-suspendering idempotent");

  const restored = await unsuspendOrgAdmin("am", target.id);
  assert(typeof restored !== "string", "unsuspend lykkes");
  if (typeof restored === "string") return;
  assert(restored.suspended === false, "suspended flag fjernet");
}

// ───── Test 6: findOrgAdminByEmail (login-lookup) ─────
async function test6_find_by_email() {
  clearAll();
  const created = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Find",
    lastName: "Me",
    email: "findme@am.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  if (typeof created === "string") return;

  const found = await findOrgAdminByEmail("am", "FindMe@AM.no"); // ulik casing
  assert(found?.id === created.id, "findByEmail case-insensitive");

  const notFound = await findOrgAdminByEmail("am", "nobody@am.no");
  assert(notFound === null, "ukjent email returnerer null");

  // Annen org skal ikke finne admin fra "am"
  const wrongOrg = await findOrgAdminByEmail("xy", "findme@am.no");
  assert(wrongOrg === null, "annen org-prefix isolert");
}

// ───── Test 7: passord-oppdatering ─────
async function test7_update_password() {
  clearAll();
  const created = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Pwd",
    lastName: "Test",
    email: "pwd@am.no",
    password: "old-password-1",
    role: "super-admin",
    createdBy: "mike",
  });
  if (typeof created === "string") return;

  const updated = await updateOrgAdminPassword("am", created.id, "new-password-2");
  assert(typeof updated !== "string", "passord-oppdatering lykkes");
  if (typeof updated === "string") return;
  assert(updated.passwordHash !== created.passwordHash, "ny hash !== gammel hash");

  // Verifiser at gammelt passord IKKE lenger fungerer
  const oldWorks = await verifyPassword("old-password-1", updated.passwordHash);
  assert(oldWorks === false, "gammelt passord rejected etter oppdatering");

  // Nytt passord fungerer
  const newWorks = await verifyPassword("new-password-2", updated.passwordHash);
  assert(newWorks === true, "nytt passord accepted");

  // For kort passord avvises
  const tooShort = await updateOrgAdminPassword("am", created.id, "kort");
  assert(tooShort === OrgAdminError.WeakPassword, "for kort passord avvises");
}

// ───── Test 8: toOrgAdminPublic sletter passwordHash ─────
async function test8_public_view() {
  clearAll();
  const created = await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "Pub",
    lastName: "View",
    email: "pub@am.no",
    password: "passord1234",
    role: "admin",
    createdBy: "mike",
  });
  if (typeof created === "string") return;

  const pub = toOrgAdminPublic(created);
  assert(!("passwordHash" in pub), "passwordHash fjernet i public view");
  assert(pub.email === created.email, "andre felter bevart");
}

// ───── Test 9: org-isolasjon ─────
async function test9_org_isolation() {
  clearAll();
  await createOrgAdmin({
    tenantPrefix: "am",
    firstName: "A",
    lastName: "M",
    email: "shared@bedrift.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  // Samme email i annen org skal være OK
  const otherOrg = await createOrgAdmin({
    tenantPrefix: "xy",
    firstName: "X",
    lastName: "Y",
    email: "shared@bedrift.no",
    password: "passord1234",
    role: "super-admin",
    createdBy: "mike",
  });
  assert(typeof otherOrg !== "string", "samme email i annen org tillatt");

  const listAm = await listOrgAdmins("am");
  const listXy = await listOrgAdmins("xy");
  assert(listAm.length === 1, "am har 1 admin");
  assert(listXy.length === 1, "xy har 1 admin");
}

// ───── Test 10 (D-091): deleteAllOrgAdminsForPrefix cascade-purge ─────
async function test10_delete_all_for_prefix() {
  clearAll();

  // Opprett 3 admins i "mm" (en super + to admin) og 1 i "xy"
  const a1 = await createOrgAdmin({
    tenantPrefix: "mm",
    firstName: "Mike", lastName: "A", email: "mike@meetmax.no",
    password: "passord1234", role: "super-admin", createdBy: "mike",
  });
  const a2 = await createOrgAdmin({
    tenantPrefix: "mm",
    firstName: "Firma", lastName: "B", email: "firma@meetmax.no",
    password: "passord1234", role: "admin", createdBy: "mike",
  });
  const a3 = await createOrgAdmin({
    tenantPrefix: "mm",
    firstName: "Tre", lastName: "C", email: "tre@meetmax.no",
    password: "passord1234", role: "admin", createdBy: "mike",
  });
  const ax = await createOrgAdmin({
    tenantPrefix: "xy",
    firstName: "X", lastName: "Y", email: "xy@firma.no",
    password: "passord1234", role: "super-admin", createdBy: "mike",
  });
  assert(typeof a1 !== "string" && typeof a2 !== "string" &&
         typeof a3 !== "string" && typeof ax !== "string",
         "3 admins opprettet i mm + 1 i xy");

  // Simuler login-events for mm-admins (skal også slettes)
  if (typeof a1 !== "string") kv.set(`org-admin-login-events:${a1.id}`, "fake-event-1");
  if (typeof a2 !== "string") kv.set(`org-admin-login-events:${a2.id}`, "fake-event-2");

  // Purge mm
  const { deleteAllOrgAdminsForPrefix } =
    await import("../platform/org-admin-store");
  const purge = await deleteAllOrgAdminsForPrefix("mm");
  assert(purge.deletedCount === 3, "purge.deletedCount === 3");
  assert(purge.adminIds.length === 3, "purge.adminIds har 3 elementer");

  // mm skal være tom
  const afterMm = await listOrgAdmins("mm");
  assert(afterMm.length === 0, "ingen admins igjen i mm");

  // xy skal være urørt
  const afterXy = await listOrgAdmins("xy");
  assert(afterXy.length === 1, "xy har fortsatt 1 admin");

  // Login-events skal være slettet for mm
  if (typeof a1 !== "string") {
    assert(
      !kv.has(`org-admin-login-events:${a1.id}`),
      "login-events slettet for a1",
    );
  }
  if (typeof a2 !== "string") {
    assert(
      !kv.has(`org-admin-login-events:${a2.id}`),
      "login-events slettet for a2",
    );
  }

  // Indeks-SET skal være borte
  assert(
    !sets.has("org-admin:mm:admins") || sets.get("org-admin:mm:admins")!.size === 0,
    "indeks-SET for mm tømt/slettet",
  );

  // Idempotent — andre kall returnerer 0
  const purge2 = await deleteAllOrgAdminsForPrefix("mm");
  assert(purge2.deletedCount === 0, "idempotent: purge2.deletedCount === 0");

  // E-post som var blokkert kan nå opprettes på nytt
  const recreated = await createOrgAdmin({
    tenantPrefix: "mm",
    firstName: "Mike", lastName: "Aagreen", email: "mike@meetmax.no",
    password: "passord1234", role: "super-admin", createdBy: "mike",
  });
  assert(
    typeof recreated !== "string",
    "samme e-post kan opprettes på nytt etter cascade-purge",
  );
}

// ───── Kjør alle tester ─────
async function main() {
  await test1_create_and_list();
  await test2_email_uniqueness();
  await test3_validation();
  await test4_last_super_admin_invariant();
  await test5_suspend_unsuspend();
  await test6_find_by_email();
  await test7_update_password();
  await test8_public_view();
  await test9_org_isolation();
  await test10_delete_all_for_prefix();
  console.log("\n✅ org-admin-store.test.ts — alle 10 testgrupper passert");
}

main().catch((e) => {
  console.error("UNCAUGHT:", e);
  process.exit(1);
});
