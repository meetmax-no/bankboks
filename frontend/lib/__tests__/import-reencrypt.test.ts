// Test: Selektiv backup-import med pwd-mismatch (re-kryptering med dagens pwd).
//
// Scenario (Mike sitt eksempel):
//   - Backup laget for 14 dager siden med master-pwd "OLD-X"
//   - Bruker byttet master-pwd i går til "NEW-Y"
//   - Bruker importerer backup-fila → må kunne re-kryptere med "NEW-Y"
//
// Verifiserer at:
//   1. Cards-blob fra backup kan dekrypteres med OLD-X (validateAndDecrypt)
//   2. Klartekst-payload kan re-krypteres med NEW-Y (encryptPayload)
//   3. Den re-krypterte blobben kan dekrypteres med NEW-Y → roundtrip OK
//   4. Eldre blob (kryptert med OLD-X) IKKE kan dekrypteres med NEW-Y
//   5. Ny blob har annen salt og IV (= ny enkrypsjon, ikke kun re-pakking)

import {
  encryptPayload,
  decryptPayload,
} from "../crypto";
import type { CardsPayload, VaultPayload } from "../types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

const OLD_PWD = "old-master-from-14-days-ago";
const NEW_PWD = "new-master-changed-yesterday";

const cardsPayload: CardsPayload = {
  version: 1,
  cards: [
    {
      id: "card-1",
      title: "Amex Platinum",
      cardType: "credit",
      cardNumber: "3782 822463 10005",
      holderName: "Mike Test",
      expiryMonth: "12",
      expiryYear: "2030",
      cvv: "1234",
      pin: "9999",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

async function run() {
  // ---- Trinn 1: Lag backup-blob med OLD_PWD (= simulerer 14-dager-gammel backup) ----
  const backupBlob = await encryptPayload<CardsPayload>(cardsPayload, OLD_PWD);
  assert(backupBlob.cipher.length > 0, "backup-blob har cipher");
  assert(backupBlob.salt.length > 0, "backup-blob har salt");

  // ---- Trinn 2: Bruker importerer. Validate med OLD_PWD ----
  const decrypted = await decryptPayload<CardsPayload>(backupBlob, OLD_PWD);
  assert(
    decrypted.payload.cards.length === 1,
    "OLD_PWD dekrypterer backup-blob (1 kort)",
  );
  assert(
    decrypted.payload.cards[0].title === "Amex Platinum",
    "kort-data bevart i klartekst",
  );

  // ---- Trinn 3: Re-krypter klartekst med NEW_PWD (= dagens master-pwd) ----
  const newBlob = await encryptPayload<CardsPayload>(
    decrypted.payload,
    NEW_PWD,
  );
  assert(
    newBlob.salt !== backupBlob.salt,
    "ny blob har ANNEN salt enn backup-blob",
  );
  assert(
    newBlob.iv !== backupBlob.iv,
    "ny blob har ANNEN IV enn backup-blob",
  );
  assert(
    newBlob.cipher !== backupBlob.cipher,
    "ny blob har ANNEN cipher (ny encryption, ikke re-pakket)",
  );

  // ---- Trinn 4: Verifiser at NEW_PWD dekrypterer ny blob ----
  const re = await decryptPayload<CardsPayload>(newBlob, NEW_PWD);
  assert(
    re.payload.cards[0].cardNumber === "3782 822463 10005",
    "NEW_PWD dekrypterer ny blob — data bevart",
  );

  // ---- Trinn 5: OLD_PWD skal IKKE dekryptere ny blob (forskjellige nøkler) ----
  let oldFailed = false;
  try {
    await decryptPayload<CardsPayload>(newBlob, OLD_PWD);
  } catch {
    oldFailed = true;
  }
  assert(oldFailed, "OLD_PWD kan IKKE dekryptere ny blob (= ekte re-kryptering)");

  // ---- Trinn 6: NEW_PWD skal IKKE dekryptere gammel backup-blob ----
  let newFailed = false;
  try {
    await decryptPayload<CardsPayload>(backupBlob, NEW_PWD);
  } catch {
    newFailed = true;
  }
  assert(
    newFailed,
    "NEW_PWD kan IKKE dekryptere backup-blob (krypterte med OLD_PWD)",
  );

  // ---- Trinn 7: Vault-payload roundtrip (samme prinsipp for vault-blob) ----
  const vaultPayload: VaultPayload = {
    version: 1,
    entries: [
      {
        id: "e1",
        title: "GitHub",
        username: "mike",
        password: "secret-pwd",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  const vaultBackup = await encryptPayload<VaultPayload>(vaultPayload, OLD_PWD);
  const vaultDecr = await decryptPayload<VaultPayload>(vaultBackup, OLD_PWD);
  const vaultReEnc = await encryptPayload<VaultPayload>(
    vaultDecr.payload,
    NEW_PWD,
  );
  const vaultFinal = await decryptPayload<VaultPayload>(vaultReEnc, NEW_PWD);
  assert(
    vaultFinal.payload.entries[0].password === "secret-pwd",
    "vault-payload re-kryptering: passord bevart roundtrip",
  );

  console.log("\n✓ All selective-import re-encryption tests passed");
}

run().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
