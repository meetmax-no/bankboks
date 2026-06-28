// Ko | Do · Vault — v4.0 Iter 4 offline test for master-pwd-vakt-logikk
//
// Kjøres med `npx tsx lib/__tests__/package-master-pwd-guard.test.ts`
//
// SPEC seksjon 9.11 test #14-15:
//   14. Mottaker taster sitt eget master-pwd ved feil + vault ulåst → vakt utløses
//   15. Mottaker taster pakke-pwd korrekt → ingen vakt, decrypt fortsetter
//
// Vakten i UnpackModule kaller verifyMasterPassword(pwd) FØR den prøver å
// decrypte pakka. Hvis match → vis advarsel + ikke prøv. Hvis ikke match →
// fortsett til pakke-decrypt.

import { webcrypto } from "node:crypto";
import { buildContainer, openContainer } from "../package-zip";
import type { PackageFile } from "../package-zip";

if (typeof globalThis.crypto === "undefined") {
  (globalThis as unknown as { crypto: typeof webcrypto }).crypto = webcrypto;
}
if (typeof globalThis.atob === "undefined") {
  (globalThis as unknown as { atob: (s: string) => string }).atob = (s) =>
    Buffer.from(s, "base64").toString("binary");
}
if (typeof globalThis.btoa === "undefined") {
  (globalThis as unknown as { btoa: (s: string) => string }).btoa = (s) =>
    Buffer.from(s, "binary").toString("base64");
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

const enc = new TextEncoder();

// Mock useVault.verifyMasterPassword — gir true hvis pwd matcher mock-master
function makeVerifyMasterPassword(masterPwd: string) {
  return async (pwd: string): Promise<boolean> => {
    return pwd === masterPwd;
  };
}

// Simulerer UnpackModule sin guard-logikk i isolasjon
async function simulateUnpackWithGuard(
  envelopeBytes: Uint8Array,
  password: string,
  verifyMasterPassword: ((pwd: string) => Promise<boolean>) | undefined,
): Promise<
  | { kind: "warning"; reason: "master-pwd-guard" }
  | { kind: "success"; files: PackageFile[] }
  | { kind: "error"; message: string }
> {
  // SPEC rad 12 — master-pwd-vakt
  if (verifyMasterPassword) {
    try {
      const isMaster = await verifyMasterPassword(password);
      if (isMaster) {
        return { kind: "warning", reason: "master-pwd-guard" };
      }
    } catch {
      // Ignorer verify-feil — fortsett til pakke-decrypt
    }
  }

  try {
    const opened = await openContainer(envelopeBytes, password);
    return { kind: "success", files: opened.files };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const files: PackageFile[] = [
    { path: "hemmelig.pdf", bytes: enc.encode("hemmelig innhold") },
  ];
  const packagePassword = "pakke-pwd-fra-lars";
  const masterPassword = "anna-sitt-vault-master-pwd";
  const pkg = await buildContainer({
    files,
    password: packagePassword,
    appVersion: "v4.0.0",
  });

  // ===== Test 14: Mottaker taster sitt master-pwd + vault unlocked → vakt =====
  {
    const verify = makeVerifyMasterPassword(masterPassword);
    const result = await simulateUnpackWithGuard(pkg, masterPassword, verify);
    assert(
      result.kind === "warning" && result.reason === "master-pwd-guard",
      "14. Mottaker taster master-pwd + vault ulåst → guard utløses, pakka ikke åpnet",
    );
  }

  // ===== Test 15: Mottaker taster pakke-pwd korrekt → vakt passerer =====
  {
    const verify = makeVerifyMasterPassword(masterPassword);
    const result = await simulateUnpackWithGuard(pkg, packagePassword, verify);
    assert(
      result.kind === "success" && result.files.length === 1,
      "15. Mottaker taster pakke-pwd → guard ikke trigget, decrypt OK",
    );
  }

  // ===== Test 16 (bonus): Vault låst (verify undefined) → skipper guard =====
  {
    const result = await simulateUnpackWithGuard(pkg, packagePassword, undefined);
    assert(
      result.kind === "success" && result.files.length === 1,
      "16. Vault låst (ingen verifyMasterPassword) → guard skippes, decrypt OK",
    );
  }

  // ===== Test 17 (bonus): Anna har egen vault + taster pakke-pwd → vakt passerer =====
  // Selv om vault er ulåst, pakke-pwd er ikke master-pwd → ingen warning
  {
    const verify = makeVerifyMasterPassword(masterPassword);
    const result = await simulateUnpackWithGuard(
      pkg,
      packagePassword,
      verify,
    );
    assert(
      result.kind === "success",
      "17. Anna har ulåst vault + taster pakke-pwd → ingen falsk warning",
    );
  }

  // ===== Test 18 (bonus): verifyMasterPassword kaster → guard fortsetter til decrypt =====
  {
    const failingVerify = async (_: string): Promise<boolean> => {
      throw new Error("vault refresh failed mid-check");
    };
    const result = await simulateUnpackWithGuard(
      pkg,
      packagePassword,
      failingVerify,
    );
    assert(
      result.kind === "success",
      "18. Hvis verify-fn kaster → guard fanges, decrypt prøves fortsatt",
    );
  }

  console.log("\n✓ All Iter 4 master-pwd-guard tests passed (5/5)");
}

main().catch((err) => {
  console.error("UNCAUGHT ERROR:", err);
  process.exit(1);
});
