// Offline sanity-test for ID-blob krypto-roundtrip.
// Kjøres med `npx tsx /app/frontend/lib/__tests__/ids-crypto.test.ts`.
//
// Verifiserer at:
//   - encryptPayload/decryptPayload roundtripper en IdsPayload riktig
//   - ID-blob bruker EGEN salt (ikke samme som vault/cards) — D-002/D-033
//   - Feil master-passord på ID-blob feiler tydelig
//   - encryptPayloadWithKey gjenbruker session-nøkkelen riktig
//   - Discriminated union (4 ID-typer) bevares gjennom roundtrip
//   - Vedlegg (base64 + bytes-felt) bevares

import {
  decryptPayload,
  decryptPayloadWithKey,
  encryptPayload,
  encryptPayloadWithKey,
  encryptVault,
} from "../crypto";
import type {
  DriverId,
  HealthId,
  IdCardId,
  IdsPayload,
  PassId,
  VaultPayload,
} from "../types";

// Polyfill / verifiser at Web Crypto API er tilgjengelig under tsx.
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

const NOW = new Date().toISOString();

const passId: PassId = {
  id: "id-pass-1",
  kind: "pass",
  title: "Pass — Norge",
  nation: "Norge",
  passportNumber: "C12345678",
  issuedBy: "Politiet, Oslo",
  issuedDate: "2024-03-15",
  expiryDate: "2034-03-14",
  notes: "Reise-pass",
  favorite: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const driverId: DriverId = {
  id: "id-driver-1",
  kind: "driver",
  title: "Førerkort Norge",
  country: "Norge",
  licenseNumber: "12345 67890",
  classes: ["B", "BE", "A1"],
  issuedDate: "2019-06-01",
  expiryDate: "2034-06-01",
  createdAt: NOW,
  updatedAt: NOW,
};

const idCardId: IdCardId = {
  id: "id-card-1",
  kind: "id-card",
  title: "Tekna medlemskort",
  type: "Medlemskort",
  issuer: "Tekna",
  number: "98765432",
  issuedDate: "2023-01-15",
  createdAt: NOW,
  updatedAt: NOW,
};

const healthId: HealthId = {
  id: "id-health-1",
  kind: "health",
  title: "Reiseforsikring If",
  type: "Reiseforsikring",
  company: "If",
  policyNumber: "12345-67-890",
  contactPhone: "+47 21 49 24 00",
  contactEmail: "skade@if.no",
  validFrom: "2025-01-01",
  validTo: "2025-12-31",
  attachments: [
    {
      mime: "application/pdf",
      data: "JVBERi0xLjQKJ8O0w6w=", // mini-PDF magic header som base64
      name: "if-reiseforsikring-2025.pdf",
      addedAt: NOW,
      bytes: 256_000,
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

// Førerkort med 2 vedlegg (forside + bakside) — Mike-utvidelse 2026-02
const driverIdWithTwoSides: DriverId = {
  ...driverId,
  id: "id-driver-2sides",
  attachments: [
    {
      mime: "image/jpeg",
      data: "/9j/4AAQSkZJRgABAQEA", // mini JPEG magic
      name: "forerkort-forside.jpg",
      addedAt: NOW,
      bytes: 480_000,
    },
    {
      mime: "image/jpeg",
      data: "/9j/4AAQSkZJRgABAQEA",
      name: "forerkort-bakside.jpg",
      addedAt: NOW,
      bytes: 460_000,
    },
  ],
};

const idsPayload: IdsPayload = {
  version: 1,
  ids: [passId, driverId, idCardId, healthId, driverIdWithTwoSides],
};

const PASSWORD = "lengre-test-passord-for-ids-blob";

(async () => {
  // 1. Encrypt + decrypt roundtrip — alle 4 typer
  const blob = await encryptPayload<IdsPayload>(idsPayload, PASSWORD);
  assert(blob.salt && blob.iv && blob.cipher, "blob har salt/iv/cipher satt");
  assert(blob.iterations === 600_000, "iterations bumper med D-001");

  const decrypted = await decryptPayload<IdsPayload>(blob, PASSWORD);
  assert(decrypted.payload.ids.length === 5, "roundtrip bevarer alle 5 ID-er (inkl. driver-2-sides)");

  // 2. Discriminated union bevares
  const kinds = decrypted.payload.ids.map((i) => i.kind);
  assert(
    kinds[0] === "pass" &&
      kinds[1] === "driver" &&
      kinds[2] === "id-card" &&
      kinds[3] === "health" &&
      kinds[4] === "driver",
    "discriminator-kind bevart i alle 5 ID-er",
  );

  // 3. Type-spesifikke felter bevart
  const pass = decrypted.payload.ids[0] as PassId;
  assert(
    pass.kind === "pass" &&
      pass.passportNumber === "C12345678" &&
      pass.nation === "Norge",
    "Pass-felt (passportNumber, nation) bevart",
  );

  const driver = decrypted.payload.ids[1] as DriverId;
  assert(
    driver.kind === "driver" &&
      driver.classes.length === 3 &&
      driver.classes[2] === "A1",
    "Driver-felt (classes-array) bevart",
  );

  const idCard = decrypted.payload.ids[2] as IdCardId;
  assert(
    idCard.kind === "id-card" && idCard.issuer === "Tekna",
    "IdCard-felt (issuer) bevart",
  );

  const health = decrypted.payload.ids[3] as HealthId;
  assert(
    health.kind === "health" && health.company === "If",
    "Health-felt (company) bevart",
  );

  // 4. Vedlegg bevart med riktig base64 + metadata (Helse-ID, 1 vedlegg)
  assert(
    health.attachments !== undefined && health.attachments.length === 1,
    "Helse-ID har 1 vedlegg etter roundtrip",
  );
  assert(
    health.attachments?.[0].mime === "application/pdf",
    "vedlegg[0].mime bevart (application/pdf)",
  );
  assert(
    health.attachments?.[0].data === "JVBERi0xLjQKJ8O0w6w=",
    "vedlegg[0].data (base64) bevart byte-for-byte",
  );
  assert(
    health.attachments?.[0].bytes === 256_000,
    "vedlegg[0].bytes (kvote-felt) bevart",
  );
  assert(
    health.attachments?.[0].name === "if-reiseforsikring-2025.pdf",
    "vedlegg[0].name bevart",
  );

  // 4b. Driver-2-sides: 2 vedlegg bevart i array (Mike-utvidelse 2026-02)
  const driverTwoSides = decrypted.payload.ids[4] as DriverId;
  assert(
    driverTwoSides.attachments !== undefined &&
      driverTwoSides.attachments.length === 2,
    "Driver-2-sides har 2 vedlegg etter roundtrip",
  );
  assert(
    driverTwoSides.attachments?.[0].name === "forerkort-forside.jpg" &&
      driverTwoSides.attachments?.[1].name === "forerkort-bakside.jpg",
    "Driver-2-sides: forside og bakside i riktig rekkefølge",
  );

  // 5. ID-blob bruker EGEN salt (D-002/D-033) — vault og ID med samme master-pwd
  //    skal produsere ulik salt og dermed ulik nøkkel.
  const vaultBlob = await encryptVault(
    {
      version: 1,
      entries: [],
      lastMasterAt: NOW,
    } as VaultPayload,
    PASSWORD,
  );
  assert(
    vaultBlob.salt !== blob.salt,
    "vault-blob og ID-blob har ulik salt (D-002/D-033)",
  );

  // 6. Feil master-passord skal kaste tydelig feil
  let errCaught = false;
  try {
    await decryptPayload<IdsPayload>(blob, "feil-passord");
  } catch (e) {
    errCaught = e instanceof Error && /master|passord|kunne/i.test(e.message);
  }
  assert(errCaught, "feil master-pwd kaster gjenkjennelig feil");

  // 7. encryptPayloadWithKey + decryptPayloadWithKey gjenbruker derived key
  const newPass: PassId = {
    ...passId,
    id: "id-pass-2",
    title: "Pass — Sverige",
    nation: "Sverige",
    passportNumber: "S88776655",
    expiryDate: "2030-01-01",
  };
  const updatedPayload: IdsPayload = {
    ...decrypted.payload,
    ids: [...decrypted.payload.ids, newPass],
  };
  const updatedBlob = await encryptPayloadWithKey<IdsPayload>(
    updatedPayload,
    decrypted.key,
    decrypted.salt,
    decrypted.iterations,
  );
  assert(
    updatedBlob.salt === blob.salt,
    "encryptPayloadWithKey gjenbruker samme salt",
  );
  const reread = await decryptPayloadWithKey<IdsPayload>(
    updatedBlob,
    decrypted.key,
  );
  assert(reread.ids.length === 6, "decryptPayloadWithKey leser ny payload");
  assert(
    (reread.ids[5] as PassId).nation === "Sverige",
    "lagt-til pass er bevart",
  );

  // 8. Tom ID-blob (initial state) skal også roundtrippe
  const emptyBlob = await encryptPayload<IdsPayload>(
    { version: 1, ids: [] },
    PASSWORD,
  );
  const emptyRead = await decryptPayload<IdsPayload>(emptyBlob, PASSWORD);
  assert(
    Array.isArray(emptyRead.payload.ids) && emptyRead.payload.ids.length === 0,
    "tom ID-blob roundtripper til tom liste",
  );

  console.log("\n10/10 tests passed");
})();
