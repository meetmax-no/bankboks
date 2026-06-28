// Offline-test for ids-export pure-funksjoner (date-format, filnavn,
// error-typer). Canvas-rendering testes via testing_agent i Iter 5.

import {
  WatermarkExportError,
  WatermarkUnsupportedError,
  buildStampText,
  exportImageWithWatermark,
  formatStampDate,
  suggestedFilename,
} from "../ids-export";
import type { IdAttachment, VaultId } from "../types";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

(async () => {
  // 1. formatStampDate — ISO YYYY-MM-DD i lokal tidssone
  const d = new Date(2026, 1, 8); // 8. februar 2026 (lokal)
  assert(formatStampDate(d) === "2026-02-08", "formatStampDate: 2026-02-08");

  const d2 = new Date(2024, 11, 31);
  assert(formatStampDate(d2) === "2024-12-31", "formatStampDate: 2024-12-31 (zero-pad)");

  const d3 = new Date(2025, 0, 1);
  assert(formatStampDate(d3) === "2025-01-01", "formatStampDate: 2025-01-01 (jan)");

  // 2. buildStampText — "KOPI · YYYY-MM-DD"
  assert(buildStampText(d) === "KOPI · 2026-02-08", "buildStampText: 'KOPI · 2026-02-08'");

  // 3. suggestedFilename — sanitiserer norske tegn + slash etc.
  const passId: VaultId = {
    id: "p1",
    kind: "pass",
    title: "Pass Norge 2024",
    nation: "Norge",
    passportNumber: "C123",
    expiryDate: "2034-03-15",
    createdAt: "",
    updatedAt: "",
  };
  assert(
    suggestedFilename(passId, d) === "pass-norge-2024-kopi-2026-02-08.jpg",
    "suggestedFilename: enkel tittel",
  );

  const norwegianId: VaultId = { ...passId, title: "Førerkort Mæ Øksa Åsa" };
  assert(
    suggestedFilename(norwegianId, d) === "forerkort-ma-oksa-asa-kopi-2026-02-08.jpg",
    "suggestedFilename: norske tegn å/æ/ø sanitisert",
  );

  const slashId: VaultId = { ...passId, title: "If / Reiseforsikring 2025-2026" };
  assert(
    suggestedFilename(slashId, d) === "if-reiseforsikring-2025-2026-kopi-2026-02-08.jpg",
    "suggestedFilename: slash + mellomrom blir bindestrek, kollapses",
  );

  const emptyId: VaultId = { ...passId, title: "" };
  assert(
    suggestedFilename(emptyId, d) === "pass-kopi-2026-02-08.jpg",
    "suggestedFilename: tom tittel faller tilbake til kind",
  );

  // 4. PDF skal kaste WatermarkUnsupportedError
  const pdfAtt: IdAttachment = {
    mime: "application/pdf",
    data: "JVBERi0xLjQ=",
    bytes: 100,
    addedAt: new Date().toISOString(),
  };
  let pdfCaught = false;
  try {
    await exportImageWithWatermark(pdfAtt);
  } catch (e) {
    pdfCaught = e instanceof WatermarkUnsupportedError;
  }
  assert(pdfCaught, "PDF kaster WatermarkUnsupportedError");

  // 5. Inheritance: WatermarkUnsupportedError extends WatermarkExportError
  const u = new WatermarkUnsupportedError();
  assert(
    u instanceof WatermarkExportError,
    "WatermarkUnsupportedError er en WatermarkExportError (instanceof)",
  );

  // 6. Text-formatering robust mot custom date + custom text
  const customDate = new Date(2030, 5, 15);
  assert(
    buildStampText(customDate) === "KOPI · 2030-06-15",
    "buildStampText: custom date 2030-06-15",
  );

  console.log("\n11/11 export tests passed");
})();
