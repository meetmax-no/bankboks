// Offline sanity-test for ids-attachment-pipelinen.
// Kjøres med `npx tsx /app/frontend/lib/__tests__/ids-attachment.test.ts`.
//
// Tester pure-funksjoner som ikke krever DOM/canvas:
//   - PDF-pipeline (validering, 1 MB hard maks, MIME-sjekk)
//   - Empty-file detection
//   - Unsupported MIME rejection
//   - base64ByteSize-matematikk
//   - arrayBufferToBase64 roundtrip
//
// Bilde-pipelinen krever HTMLCanvasElement → testes manuelt + via testing_agent
// i Iter 3 når komponenten er integrert i IdModal.

import {
  AttachmentEmptyError,
  AttachmentTooLargeError,
  AttachmentUnsupportedError,
  MAX_ATTACHMENT_BYTES,
  arrayBufferToBase64,
  base64ByteSize,
  isImageMime,
  isPdfMime,
  processPdfFile,
  stripDataUrlPrefix,
} from "../ids-attachment";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

/** Minimal File-polyfill — tsx kjører i Node, File er fra Web API. Node 20+ har File globalt. */
function makeFile(content: ArrayBuffer | Uint8Array, name: string, type: string): File {
  // Bruk Blob → File-konstruktør som finnes i Node 20+
  const buf = content instanceof Uint8Array ? content : new Uint8Array(content);
  return new File([buf as BlobPart], name, { type });
}

(async () => {
  // 1. MIME-helpers
  assert(isPdfMime("application/pdf"), "isPdfMime: application/pdf");
  assert(!isPdfMime("image/jpeg"), "isPdfMime: rejects image/jpeg");
  assert(isImageMime("image/jpeg"), "isImageMime: image/jpeg");
  assert(isImageMime("image/heic"), "isImageMime: image/heic (iPhone)");
  assert(!isImageMime("application/pdf"), "isImageMime: rejects PDF");
  assert(!isImageMime("text/plain"), "isImageMime: rejects text/plain");

  // 2. base64 byte-matematikk
  assert(base64ByteSize("") === 0, "base64ByteSize: tom streng → 0");
  // "Hello" = 5 bytes → SGVsbG8=  (8 chars + 1 padding = 6 bytes raw, minus 1 pad = 5)
  assert(base64ByteSize("SGVsbG8=") === 5, "base64ByteSize: 'Hello' → 5 bytes");
  // "Hi" = 2 bytes → SGk=
  assert(base64ByteSize("SGk=") === 2, "base64ByteSize: 'Hi' → 2 bytes");

  // 3. stripDataUrlPrefix
  assert(
    stripDataUrlPrefix("data:image/jpeg;base64,/9j/4AAQ") === "/9j/4AAQ",
    "stripDataUrlPrefix: fjerner data:-prefix",
  );
  assert(
    stripDataUrlPrefix("/9j/4AAQ") === "/9j/4AAQ",
    "stripDataUrlPrefix: passerer gjennom ren base64",
  );

  // 4. arrayBufferToBase64 roundtrip
  const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const b64 = arrayBufferToBase64(original.buffer);
  assert(b64 === "SGVsbG8=", "arrayBufferToBase64: 'Hello' → SGVsbG8=");

  // 5. PDF — gyldig, liten fil
  const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
  const tinyPdf = makeFile(pdfMagic, "test.pdf", "application/pdf");
  const result = await processPdfFile(tinyPdf);
  assert(result.mime === "application/pdf", "PDF: mime bevart");
  assert(result.name === "test.pdf", "PDF: filnavn bevart");
  assert(result.bytes === 8, "PDF: bytes-felt riktig (8)");
  assert(result.data === "JVBERi0xLjQ=", "PDF: data base64-encoded korrekt");
  assert(
    typeof result.addedAt === "string" && result.addedAt.includes("T"),
    "PDF: addedAt er ISO-tid",
  );

  // 6. PDF — for stor (> 1 MB)
  const oversize = new Uint8Array(MAX_ATTACHMENT_BYTES + 100).fill(0x25);
  const bigPdf = makeFile(oversize, "huge.pdf", "application/pdf");
  let oversizeCaught = false;
  try {
    await processPdfFile(bigPdf);
  } catch (e) {
    oversizeCaught = e instanceof AttachmentTooLargeError;
    if (e instanceof AttachmentTooLargeError) {
      assert(e.bytes > MAX_ATTACHMENT_BYTES, "TooLargeError.bytes > 1 MB");
      assert(e.maxBytes === MAX_ATTACHMENT_BYTES, "TooLargeError.maxBytes = 1 MB");
    }
  }
  assert(oversizeCaught, "PDF > 1 MB kaster AttachmentTooLargeError");

  // 7. PDF — galt MIME
  const fakePdf = makeFile(pdfMagic, "fake.pdf", "text/plain");
  let mimeCaught = false;
  try {
    await processPdfFile(fakePdf);
  } catch (e) {
    mimeCaught = e instanceof AttachmentUnsupportedError;
  }
  assert(mimeCaught, "PDF med text/plain MIME kaster AttachmentUnsupportedError");

  // 8. PDF — tom fil
  const emptyPdf = makeFile(new Uint8Array(0), "empty.pdf", "application/pdf");
  let emptyCaught = false;
  try {
    await processPdfFile(emptyPdf);
  } catch (e) {
    emptyCaught = e instanceof AttachmentEmptyError;
  }
  assert(emptyCaught, "Tom PDF kaster AttachmentEmptyError");

  // 9. PDF — akkurat på grensen (1 MB - 1 byte) skal passere
  const justUnder = new Uint8Array(MAX_ATTACHMENT_BYTES - 1).fill(0x25);
  // Inject %PDF-magic så det er gjenkjennelig
  justUnder[0] = 0x25;
  justUnder[1] = 0x50;
  justUnder[2] = 0x44;
  justUnder[3] = 0x46;
  const edgePdf = makeFile(justUnder, "edge.pdf", "application/pdf");
  const edgeResult = await processPdfFile(edgePdf);
  assert(
    edgeResult.bytes === MAX_ATTACHMENT_BYTES - 1,
    "PDF 1 MB - 1 byte aksepteres (edge case)",
  );

  // 10. Konstant-sjekk
  assert(MAX_ATTACHMENT_BYTES === 1_048_576, "MAX_ATTACHMENT_BYTES = 1 MB");

  console.log("\n13/13 attachment tests passed");
})();
