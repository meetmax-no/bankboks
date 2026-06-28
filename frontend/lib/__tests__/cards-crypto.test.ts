// Offline sanity-test for cards-blob krypto-roundtrip.
// Kjøres med `npx tsx /app/frontend/lib/__tests__/cards-crypto.test.ts`.
//
// Verifiserer at:
//   - encryptPayload/decryptPayload roundtripper en CardsPayload riktig
//   - Cards-blob bruker EGEN salt (ikke samme som vault) — D-002
//   - Feil master-passord på cards-blob feiler tydelig
//   - encryptPayloadWithKey gjenbruker session-nøkkelen riktig

import {
  decryptPayload,
  decryptPayloadWithKey,
  encryptPayload,
  encryptPayloadWithKey,
  encryptVault,
} from "../crypto";
import type { CardsPayload, VaultCard, VaultPayload } from "../types";

// Polyfill / verifiser at Web Crypto API er tilgjengelig under tsx.
// Node 20+ har subtle på globalThis.crypto.
if (typeof crypto === "undefined" || !crypto.subtle) {
  console.error("FAIL: Web Crypto API ikke tilgjengelig (krever Node 20+)");
  process.exit(1);
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

const sampleCard: VaultCard = {
  id: "card-1",
  title: "AMEX Platinum",
  cardType: "credit",
  cardNumber: "374912345678901",
  holderName: "Mike Aagreen",
  expiryMonth: "09",
  expiryYear: "2027",
  cvv: "1234",
  pin: "9988",
  issuer: "American Express",
  customerServicePhone: "+47 22 96 00 00",
  notes: "Reisesvurdering",
  favorite: true,
  rewardProgram: "Membership Rewards",
  annualFee: "1450 NOK/år",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const cardsPayload: CardsPayload = {
  version: 1,
  cards: [sampleCard],
};

const PASSWORD = "lengre-test-passord-for-cards";

(async () => {
  // 1. Encrypt + decrypt roundtrip
  const blob = await encryptPayload<CardsPayload>(cardsPayload, PASSWORD);
  assert(blob.salt && blob.iv && blob.cipher, "blob har salt/iv/cipher satt");
  assert(blob.iterations === 600_000, "iterations bumper med D-001");

  const decrypted = await decryptPayload<CardsPayload>(blob, PASSWORD);
  assert(
    decrypted.payload.cards.length === 1,
    "roundtrip bevarer cards-listen",
  );
  assert(
    decrypted.payload.cards[0].title === "AMEX Platinum",
    "kort-tittel bevart",
  );
  assert(
    decrypted.payload.cards[0].cardType === "credit",
    "cardType bevart",
  );
  assert(
    decrypted.payload.cards[0].cardNumber === "374912345678901",
    "kortnummer bevart",
  );

  // 2. Cards-blob bruker EGEN salt (D-002) — verifiser at vault-blob med samme
  // master-pwd produserer ulik salt og dermed ulik nøkkel.
  const vaultBlob = await encryptVault(
    {
      version: 1,
      entries: [],
      lastMasterAt: new Date().toISOString(),
    } as VaultPayload,
    PASSWORD,
  );
  assert(
    vaultBlob.salt !== blob.salt,
    "vault-blob og cards-blob har ulik salt (D-002)",
  );

  // 3. Feil master-passord skal kaste tydelig feil
  let errCaught = false;
  try {
    await decryptPayload<CardsPayload>(blob, "feil-passord");
  } catch (e) {
    errCaught = e instanceof Error && /master|passord|kunne/i.test(e.message);
  }
  assert(errCaught, "feil master-pwd kaster gjenkjennelig feil");

  // 4. encryptPayloadWithKey + decryptPayloadWithKey gjenbruker derived key
  const updatedPayload: CardsPayload = {
    ...decrypted.payload,
    cards: [
      ...decrypted.payload.cards,
      {
        ...sampleCard,
        id: "card-2",
        title: "DnB Visa Debet",
        cardType: "debit",
        cardNumber: "4242424242424242",
      },
    ],
  };
  const updatedBlob = await encryptPayloadWithKey<CardsPayload>(
    updatedPayload,
    decrypted.key,
    decrypted.salt,
    decrypted.iterations,
  );
  assert(
    updatedBlob.salt === blob.salt,
    "encryptPayloadWithKey gjenbruker samme salt",
  );
  const reread = await decryptPayloadWithKey<CardsPayload>(
    updatedBlob,
    decrypted.key,
  );
  assert(reread.cards.length === 2, "decryptPayloadWithKey leser ny payload");
  assert(
    reread.cards[1].title === "DnB Visa Debet",
    "lagt-til kort er bevart",
  );

  // 5. Tom cards-blob (initial state) skal også roundtrippe
  const emptyBlob = await encryptPayload<CardsPayload>(
    { version: 1, cards: [] },
    PASSWORD,
  );
  const emptyRead = await decryptPayload<CardsPayload>(emptyBlob, PASSWORD);
  assert(
    Array.isArray(emptyRead.payload.cards) &&
      emptyRead.payload.cards.length === 0,
    "tom cards-blob roundtripper til tom liste",
  );

  console.log("\n5/5 tests passed");
})();
