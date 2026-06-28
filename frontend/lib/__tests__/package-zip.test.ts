// Ko | Do · Vault — v4.0 Iter 2 offline test for `lib/package-zip.ts`
//
// Kjøres med `npx tsx /app/frontend/lib/__tests__/package-zip.test.ts`
//
// Dekker testene fra SPEC seksjon 9.11 som krever ZIP-laget:
//  - Roundtrip 12 filer med mappe-struktur (test #2 i SPEC)
//  - Zip-slip-sanitering per path-segment (test #8)
//  - Bin-packing av 12 filer i 3 containere (test #10)
//  - Single-file edge case (test #11)
//  - Over-grense (test #12)
//  - Duplikat-filnavn håndtering (test #13)
//  - sanitizeZipPath enhetstester (flere zip-slip-vinkler)

import { webcrypto } from "node:crypto";
import {
  buildContainer,
  openContainer,
  planContainers,
  sanitizeZipPath,
  estimateEncryptSeconds,
  validateFileSize,
  type PackageFile,
} from "../package-zip";

// Polyfill Web Crypto + atob/btoa for Node tsx-kjøring
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

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

const enc = new TextEncoder();

function makeFile(path: string, content: string): PackageFile {
  return { path, bytes: enc.encode(content) };
}

async function main() {
  // ===== Test 1: Roundtrip 12 filer med mappe-struktur =====
  {
    const files: PackageFile[] = [
      makeFile("NDA-Hoppeslott.pdf", "PDF content 1"),
      makeFile("Klient-grunnlag.pdf", "PDF content 2"),
      makeFile("Faktura-2026-01.pdf", "PDF content 3"),
      makeFile("Hoppeslott/Underlag/skanning.pdf", "Skanning"),
      makeFile("Hoppeslott/Underlag/foto.jpg", "JPEG bytes"),
      makeFile("Hoppeslott/Notater/draft.md", "# Draft"),
      makeFile("Hoppeslott/Notater/strategi.md", "# Strategi"),
      makeFile("Korrespondanse/2026-02-01.eml", "From: lars"),
      makeFile("Korrespondanse/2026-02-15.eml", "From: anna"),
      makeFile("logo.png", "PNG bytes"),
      makeFile("README.txt", "Hei Anna,"),
      makeFile("dypt/nestet/mappe/struktur/fil.txt", "Dypt"),
    ];
    const pwd = "felles-pakke-passord-2026";

    const pkg = await buildContainer({ files, password: pwd, appVersion: "v4.0.0" });
    const opened = await openContainer(pkg, pwd);

    assert(opened.files.length === 12, "1a. 12 filer roundtripped");
    assert(
      opened.files.find((f) => f.path === "Hoppeslott/Underlag/skanning.pdf"),
      "1b. Mappe-struktur bevart (Hoppeslott/Underlag/skanning.pdf)",
    );
    assert(
      opened.files.find((f) => f.path === "dypt/nestet/mappe/struktur/fil.txt"),
      "1c. Dypt-nestet mappe-struktur bevart (5 nivåer)",
    );

    // Verifiser bytes-likhet for én fil med bevart sti
    const orig = files.find((f) => f.path === "Hoppeslott/Notater/draft.md")!;
    const out = opened.files.find((f) => f.path === "Hoppeslott/Notater/draft.md")!;
    assert(bytesEqual(orig.bytes, out.bytes), "1d. Bytes identiske for nestet fil");

    // Metadata bevart
    assert(
      opened.metadata.fileCount === 12,
      "1e. _metadata.json bevart med riktig fileCount",
    );
    assert(opened.metadata.appVersion === "v4.0.0", "1f. _metadata.appVersion bevart");
  }

  // ===== Test 2: Zip-slip-sanitering per path-segment =====
  {
    // Vi tester sanitizeZipPath direkte fordi vi vil verifisere segment-by-segment-logikk
    assert(
      sanitizeZipPath("../../etc/passwd") === "etc/passwd",
      "2a. ../../etc/passwd → etc/passwd (traversal stripped)",
    );
    assert(
      sanitizeZipPath("/etc/passwd") === "etc/passwd",
      "2b. /etc/passwd → etc/passwd (leading slash stripped)",
    );
    assert(
      sanitizeZipPath("Hoppeslott/../../leak.pdf") === "Hoppeslott/leak.pdf",
      "2c. Hoppeslott/../../leak.pdf → Hoppeslott/leak.pdf (mid-path traversal stripped)",
    );
    assert(
      sanitizeZipPath("Hoppeslott/Underlag/skanning.pdf") ===
        "Hoppeslott/Underlag/skanning.pdf",
      "2d. Normal sti uendret",
    );
    assert(
      sanitizeZipPath("C:\\Windows\\System32\\evil.exe") ===
        "C_/Windows/System32/evil.exe",
      "2e. Windows-tegn-stripping: drev-bokstav blir _",
    );
    assert(
      sanitizeZipPath("file\x00name.txt") === "file_name.txt",
      "2f. NUL-byte i navn erstattes med _",
    );
    assert(sanitizeZipPath("../..") === "ukjent-fil" || sanitizeZipPath("../..") === "", "2g. Helt tomt path-resultat — uansett ikke escape ut av root");
    assert(sanitizeZipPath("./") === "", "2h. Bare relative dot strippes til tom (skip ved openContainer)");
  }

  // ===== Test 3: Roundtrip av pakke med zip-slip-forsøk i path =====
  {
    // Vi bygger en pakke med vondsinnede paths og verifiserer at åpning saniterer
    // (JSZip selv normaliserer path-aritmetic — vår sanitizeZipPath er andre forsvarslag)
    const files: PackageFile[] = [
      makeFile("../../etc/passwd", "ondsinnet innhold"),
      makeFile("Hoppeslott/../../leak.pdf", "lekkasje forsøk"),
      makeFile("normal-fil.txt", "ok innhold"),
    ];
    const pwd = "test-pwd-1234";
    const pkg = await buildContainer({ files, password: pwd, appVersion: "v4.0.0" });
    const opened = await openContainer(pkg, pwd);

    const paths = opened.files.map((f) => f.path).sort();
    assert(paths.length === 3, "3a. Alle 3 filer beholdt etter sanitering");
    assert(paths.includes("normal-fil.txt"), "3b. normal-fil uendret");

    // Ingen path begynner med slash, .., eller inneholder traversal — full check
    for (const p of paths) {
      assert(
        !p.startsWith("/") &&
          !p.startsWith("..") &&
          !p.includes("/../") &&
          !p.includes("/.."),
        `3c. Sanitert path er trygg (ingen escape): "${p}"`,
      );
    }

    // Verifiser at innholdet fortsatt kan leses
    const contents = opened.files.map((f) => new TextDecoder().decode(f.bytes));
    assert(
      contents.includes("ondsinnet innhold") &&
        contents.includes("lekkasje forsøk") &&
        contents.includes("ok innhold"),
      "3d. Filinnhold bevart selv om path saniterte",
    );
  }

  // ===== Test 4: Bin-packing av 12 filer i 3 containere =====
  {
    const files: PackageFile[] = Array.from({ length: 12 }, (_, i) =>
      makeFile(`fil-${i + 1}.bin`, "X".repeat(1000 + i * 500)), // ulik størrelse 1000-6500 bytes
    );
    const plan = planContainers(files, 3);

    assert(plan.groups.length === 3, "4a. 3 containere når 3 requested");
    const totalFiles = plan.groups.reduce((s, g) => s + g.length, 0);
    assert(totalFiles === 12, "4b. Alle 12 filer fordelt");
    // Sjekk at fordelingen er omtrent jevn (max - min < median)
    const sortedTotals = [...plan.totalBytes].sort((a, b) => a - b);
    const median = sortedTotals[1];
    assert(
      sortedTotals[2] - sortedTotals[0] < median,
      `4c. Bin-packing fordeler rimelig jevnt (spread=${sortedTotals[2] - sortedTotals[0]}, median=${median})`,
    );
    // Ingen overlapp mellom grupper
    const allIndices = new Set<number>();
    for (const group of plan.groups) {
      for (const idx of group) {
        assert(!allIndices.has(idx), `4d. Ingen overlapp: fil-idx ${idx}`);
        allIndices.add(idx);
      }
    }
  }

  // ===== Test 5: Single-file edge case (1 fil + 3 containere → 1 container) =====
  {
    const files: PackageFile[] = [makeFile("alone.txt", "kun én fil")];
    const plan = planContainers(files, 3);
    assert(
      plan.groups.length === 1,
      "5a. Single-file: tvinges til 1 container (uansett requested)",
    );
    assert(plan.groups[0].length === 1, "5b. Den ene fila er i den ene containeren");
  }

  // ===== Test 6: Over-grense (validateFileSize kaster) =====
  {
    const big: PackageFile = {
      path: "diger.bin",
      bytes: new Uint8Array(51 * 1024 * 1024), // 51 MB
    };
    let threw = false;
    try {
      validateFileSize([big], 50);
    } catch (e) {
      threw = e instanceof Error && /overskrider/.test(e.message);
    }
    assert(threw, "6. validateFileSize avviser fil over maxFileSizeMB-grense");

    // OK på akkurat grensen
    const ok: PackageFile = {
      path: "stor.bin",
      bytes: new Uint8Array(50 * 1024 * 1024),
    };
    let ok_threw = false;
    try {
      validateFileSize([ok], 50);
    } catch {
      ok_threw = true;
    }
    assert(!ok_threw, "6b. Fil på akkurat grensen er OK");
  }

  // ===== Test 7: Duplikat-filnavn-håndtering =====
  {
    const files: PackageFile[] = [
      makeFile("rapport.pdf", "Versjon 1"),
      makeFile("rapport.pdf", "Versjon 2"),
      makeFile("rapport.pdf", "Versjon 3"),
    ];
    const pwd = "test-pwd-1234";
    const pkg = await buildContainer({ files, password: pwd, appVersion: "v4.0.0" });
    const opened = await openContainer(pkg, pwd);

    assert(opened.files.length === 3, "7a. Alle 3 dupes bevart");
    const paths = opened.files.map((f) => f.path).sort();
    assert(paths.includes("rapport.pdf"), "7b. Første beholder original-sti");
    assert(paths.includes("rapport-2.pdf"), "7c. Andre fil får -2-suffix");
    assert(paths.includes("rapport-3.pdf"), "7d. Tredje fil får -3-suffix");

    // Verifiser at bytes er ulike (innholdet er bevart per fil)
    const contents = opened.files.map((f) => new TextDecoder().decode(f.bytes));
    assert(
      contents.includes("Versjon 1") &&
        contents.includes("Versjon 2") &&
        contents.includes("Versjon 3"),
      "7e. Alle 3 versjoner av innholdet bevart",
    );
  }

  // ===== Test 8: Multi-container fysisk roundtrip (3 containere, samme pwd) =====
  {
    // Lager 6 filer, fordeler i 3 containere, åpner hver uavhengig
    const files: PackageFile[] = Array.from({ length: 6 }, (_, i) =>
      makeFile(`fil-${i + 1}.txt`, `innhold ${i + 1}`),
    );
    const pwd = "felles-pwd-multi";
    const plan = planContainers(files, 3);
    const containers: Uint8Array[] = [];
    for (const group of plan.groups) {
      const groupFiles = group.map((idx) => files[idx]);
      const pkg = await buildContainer({
        files: groupFiles,
        password: pwd,
        appVersion: "v4.0.0",
      });
      containers.push(pkg);
    }
    assert(containers.length === 3, "8a. 3 containere bygget");

    // Åpne hver uavhengig — verifiser at samme pwd virker
    let totalFiles = 0;
    for (const c of containers) {
      const opened = await openContainer(c, pwd);
      assert(opened.files.length >= 1, "8b. Container åpnes uavhengig med samme pwd");
      totalFiles += opened.files.length;
    }
    assert(totalFiles === 6, "8c. Alle 6 filer fordelt og åpnet uavhengig");
  }

  // ===== Test 9: Tidsestimat-fornuft =====
  {
    const e10mb = estimateEncryptSeconds(10 * 1024 * 1024);
    const e100mb = estimateEncryptSeconds(100 * 1024 * 1024);
    assert(e10mb >= 1, "9a. 10 MB estimert til minst 1 sek");
    assert(e100mb >= e10mb, "9b. 100 MB tar mer enn 10 MB (monotont)");
    assert(e100mb < 30, "9c. 100 MB estimert under 30 sek (rimelig)");
  }

  console.log("\n✓ All Iter 2 package-zip tests passed");
}

main().catch((err) => {
  console.error("UNCAUGHT ERROR:", err);
  process.exit(1);
});
