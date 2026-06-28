/**
 * Ko | Do · Vault — D-062 — Master-pwd-bytte atomisk re-kryptering
 *
 * Disse testene verifiserer kjerne-logikken: encrypt → decrypt round-trips
 * med oldPwd og newPwd produserer korrekte verdier. Faktisk Upstash-push og
 * rollback testes via integrasjon (curl mot deploy).
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/mp-change.test.ts`
 */
import { encryptPayload, decryptPayload } from "../crypto";

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

async function main() {
  const OLD_PWD = "OldPassword12345!";
  const NEW_PWD = "NewPassword67890#";
  const payload = { ids: [{ id: "i1", label: "test", value: "secret" }] };

  console.log("\nRe-encrypt round-trip");
  const blob1 = await encryptPayload(payload, OLD_PWD);
  // Decrypt med OLD_PWD
  const d1 = await decryptPayload<typeof payload>(blob1, OLD_PWD);
  assert(
    JSON.stringify(d1.payload) === JSON.stringify(payload),
    "decrypt med oldPwd returnerer original payload",
  );

  // Re-encrypt med NEW_PWD (simulerer reEncryptInPlace)
  const blob2 = await encryptPayload(d1.payload, NEW_PWD);
  assert(
    blob2.salt !== blob1.salt,
    "ny encrypt produserer ny salt",
  );
  assert(
    blob2.iv !== blob1.iv,
    "ny encrypt produserer ny IV",
  );
  assert(
    blob2.cipher !== blob1.cipher,
    "ny encrypt produserer annen cipher",
  );

  // Decrypt blob2 med NEW_PWD
  const d2 = await decryptPayload<typeof payload>(blob2, NEW_PWD);
  assert(
    JSON.stringify(d2.payload) === JSON.stringify(payload),
    "decrypt blob2 med newPwd gir original payload",
  );

  // Decrypt blob2 med OLD_PWD må feile
  console.log("\nFeil pwd kaster");
  let threwOld = false;
  try {
    await decryptPayload(blob2, OLD_PWD);
  } catch {
    threwOld = true;
  }
  assert(threwOld, "decrypt blob2 med oldPwd kaster (cipher kryptert med new)");

  // Decrypt blob1 (originalt) med NEW_PWD må også feile
  let threwNew = false;
  try {
    await decryptPayload(blob1, NEW_PWD);
  } catch {
    threwNew = true;
  }
  assert(threwNew, "decrypt blob1 med newPwd kaster (cipher kryptert med old)");

  console.log("\nRollback-scenario: oldBlob må kunne decryptes med oldPwd");
  const d1Again = await decryptPayload<typeof payload>(blob1, OLD_PWD);
  assert(
    JSON.stringify(d1Again.payload) === JSON.stringify(payload),
    "originalBlob fortsatt decrypterbar med oldPwd (for rollback)",
  );

  console.log("\n" + "─".repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
