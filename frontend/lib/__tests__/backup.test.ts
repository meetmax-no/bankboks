// Offline sanity-test for backup-parse og envelope-bygging (v3.0.5+).
// Kjøres med `npx tsx /app/frontend/lib/__tests__/backup.test.ts`.
//
// Dekker:
//  - V3 build + roundtrip (selektive blobs)
//  - V2 → V3 migrering ved import (bakoverkomp)
//  - V1 avvises (ingen bakoverkomp)
//  - Validering av korrupt format

import { buildEnvelope, parseEnvelope, BackupParseError } from "../backup";
import type { EncryptedVaultBlob } from "../types";

const fakeVault: EncryptedVaultBlob = {
  version: 1,
  salt: "AAAAAAAAAAAAAAAAAAAAAA==",
  iv: "AAAAAAAAAAAAAAAA",
  cipher: "VAULT",
  iterations: 600_000,
  updatedAt: new Date().toISOString(),
};

const fakeCards: EncryptedVaultBlob = {
  version: 1,
  salt: "BBBBBBBBBBBBBBBBBBBBBB==",
  iv: "BBBBBBBBBBBBBBBB",
  cipher: "CARDS",
  iterations: 600_000,
  updatedAt: new Date().toISOString(),
};

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

// ===== V3 — produsert format =====

// 1. Bygg v3-envelope med flere blobs og roundtrip via parse
const env = buildEnvelope(
  { vault: fakeVault, cards: fakeCards },
  { appVersion: "v3.0.5" },
);
const parsed = parseEnvelope(JSON.stringify(env));
assert(parsed.kind === "kodo-vault-backup", "kind satt");
assert(parsed.envelopeVersion === 3, "envelopeVersion er 3");
assert(parsed.blobs.vault.cipher === "VAULT", "vault-blob bevart");
assert(parsed.blobs.cards.cipher === "CARDS", "cards-blob bevart");
assert(
  parsed.includedBlobs.length === 2 &&
    parsed.includedBlobs.includes("vault") &&
    parsed.includedBlobs.includes("cards"),
  "includedBlobs ['vault','cards']",
);
assert(parsed.appVersion === "v3.0.5", "appVersion bevart");

// 2. Selektiv eksport — kun vault
const onlyVault = buildEnvelope({ vault: fakeVault }, { appVersion: "v3.0.5" });
const onlyVaultParsed = parseEnvelope(JSON.stringify(onlyVault));
assert(onlyVaultParsed.includedBlobs.length === 1, "selektiv vault: 1 blob");
assert(
  onlyVaultParsed.blobs.cards === undefined,
  "selektiv vault: cards-blob er IKKE i fila",
);

// 3. Selektiv eksport — kun cards
const onlyCards = buildEnvelope({ cards: fakeCards }, { appVersion: "v3.0.5" });
const onlyCardsParsed = parseEnvelope(JSON.stringify(onlyCards));
assert(onlyCardsParsed.includedBlobs.length === 1, "selektiv cards: 1 blob");
assert(
  onlyCardsParsed.includedBlobs[0] === "cards",
  "selektiv cards: includedBlobs har kun 'cards'",
);
assert(
  onlyCardsParsed.blobs.vault === undefined,
  "selektiv cards: vault-blob er IKKE i fila",
);

// 4. buildEnvelope avviser tom blobs-map
try {
  buildEnvelope({}, { appVersion: "v3.0.5" });
  assert(false, "skal kastet på tom blobs");
} catch (e) {
  assert(
    e instanceof Error && /minst én/.test(e.message),
    "Error for tom blobs-map",
  );
}

// ===== V2 — bakoverkomp ved import =====

// 5. V2-fil med vault + cards migreres til v3 internt
const v2WithBoth = JSON.stringify({
  kind: "kodo-vault-backup",
  envelopeVersion: 2,
  exportedAt: "2026-01-15T12:00:00Z",
  app: "Ko | Do · Vault",
  appVersion: "v3.0",
  vault: fakeVault,
  cards: fakeCards,
});
const v2Parsed = parseEnvelope(v2WithBoth);
assert(v2Parsed.envelopeVersion === 3, "v2 migreres til v3 internt");
assert(v2Parsed.blobs.vault.cipher === "VAULT", "v2-migrert: vault bevart");
assert(v2Parsed.blobs.cards?.cipher === "CARDS", "v2-migrert: cards bevart");
assert(
  v2Parsed.includedBlobs.length === 2,
  "v2-migrert: begge blobs i includedBlobs",
);

// 6. V2-fil med kun vault (cards: null) migreres riktig
const v2VaultOnly = JSON.stringify({
  kind: "kodo-vault-backup",
  envelopeVersion: 2,
  exportedAt: "2026-01-15T12:00:00Z",
  app: "Ko | Do · Vault",
  appVersion: "v3.0",
  vault: fakeVault,
  cards: null,
});
const v2VaultOnlyParsed = parseEnvelope(v2VaultOnly);
assert(
  v2VaultOnlyParsed.includedBlobs.length === 1 &&
    v2VaultOnlyParsed.includedBlobs[0] === "vault",
  "v2 cards:null migreres til v3 med kun vault",
);
assert(
  v2VaultOnlyParsed.blobs.cards === undefined,
  "v2 cards:null → ingen cards-blob i v3",
);

// ===== Avvisninger =====

// 7. parseEnvelope avviser ugyldig JSON
try {
  parseEnvelope("{not valid json");
  assert(false, "skal kastet på invalid JSON");
} catch (e) {
  assert(e instanceof BackupParseError, "BackupParseError for ugyldig JSON");
}

// 8. parseEnvelope avviser feil kind
try {
  parseEnvelope(JSON.stringify({ kind: "other-app", envelopeVersion: 3 }));
  assert(false, "skal kastet på feil kind");
} catch (e) {
  assert(e instanceof BackupParseError, "BackupParseError for feil kind");
}

// 9. parseEnvelope avviser GAMMEL v1 backup (per Mike: ingen v1-bakoverkomp)
try {
  parseEnvelope(
    JSON.stringify({
      kind: "kodo-vault-backup",
      envelopeVersion: 1,
      blob: fakeVault,
    }),
  );
  assert(false, "skal avvise v1 backup");
} catch (e) {
  assert(
    e instanceof BackupParseError && /støttes ikke/.test(e.message),
    "BackupParseError for v1 backup",
  );
}

// 10. v3 avviser tom includedBlobs-liste
try {
  parseEnvelope(
    JSON.stringify({
      kind: "kodo-vault-backup",
      envelopeVersion: 3,
      blobs: {},
      includedBlobs: [],
      exportedAt: "x",
      app: "x",
      appVersion: "x",
    }),
  );
  assert(false, "skal avvise tom includedBlobs");
} catch (e) {
  assert(
    e instanceof BackupParseError,
    "BackupParseError for tom includedBlobs",
  );
}

// 11. v3 avviser når includedBlobs refererer til en blob som mangler
try {
  parseEnvelope(
    JSON.stringify({
      kind: "kodo-vault-backup",
      envelopeVersion: 3,
      blobs: { vault: fakeVault },
      includedBlobs: ["vault", "cards"], // cards ikke i blobs
      exportedAt: "x",
      app: "x",
      appVersion: "x",
    }),
  );
  assert(false, "skal avvise referanse til manglende blob");
} catch (e) {
  assert(
    e instanceof BackupParseError && /mangler|korrupt/.test(e.message),
    "BackupParseError for manglende blob",
  );
}

// 12. v3 avviser korrupt blob (mangler iv/cipher)
try {
  parseEnvelope(
    JSON.stringify({
      kind: "kodo-vault-backup",
      envelopeVersion: 3,
      blobs: {
        vault: { salt: "ok" }, // mangler iv, cipher, iterations
      },
      includedBlobs: ["vault"],
      exportedAt: "x",
      app: "x",
      appVersion: "x",
    }),
  );
  assert(false, "skal kastet på korrupt blob");
} catch (e) {
  assert(
    e instanceof BackupParseError,
    "BackupParseError for korrupt blob",
  );
}

console.log("\n✓ All backup tests passed (v3 + v2 migration)");
