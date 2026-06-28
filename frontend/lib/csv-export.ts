/**
 * Ko | Do · Vault — CSV-eksport (Bitwarden-kompatibel)
 *
 * Iter 19.9.6 (#11): eksport av passord-blob til Bitwarden-vennlig CSV
 * slik at brukere kan migrere ut av Vault hvis de vil. Eksporterer KUN
 * passord-entries (ikke kort, ikke ID-er — de bruker egne datamodeller
 * som ikke har naturlig Bitwarden-mapping).
 *
 * Bitwarden CSV-header (eksportformat fra Bitwarden selv):
 *   name,login_uri,login_username,login_password,notes
 *
 * Vi følger nøyaktig samme kolonne-rekkefølge så brukere kan importere
 * direkte i Bitwarden, 1Password, KeePass etc. uten remapping.
 *
 * Mapping fra VaultEntry til Bitwarden-CSV:
 *   name           ← entry.title       (oppførings-navn)
 *   login_uri      ← entry.url ?? ""   (URL, tom hvis ikke satt)
 *   login_username ← entry.username ?? ""
 *   login_password ← entry.password    (alltid satt)
 *   notes          ← entry.notes ?? "" (kategori, favoritt-flagg etc.
 *                                       droppes — finnes ikke i Bitwarden-format)
 *
 * IKKE-funksjonelle krav:
 *   - Riktig CSV-escaping per RFC 4180: felt med ", \n eller , quotes;
 *     interne " dobles ("" → "" i csv).
 *   - UTF-8 BOM på første linje slik at Excel åpner æøå riktig.
 *   - LF (ikke CRLF) — moderne tools håndterer begge, og LF gir mindre
 *     filstørrelse.
 */

import type { VaultEntry } from "./types";

const BITWARDEN_HEADER = "name,login_uri,login_username,login_password,notes";
const UTF8_BOM = "\uFEFF";

/**
 * Escape et CSV-felt per RFC 4180.
 * - Returnerer "" hvis input er null/undefined/tom
 * - Wrapper i double-quotes hvis feltet inneholder ", , eller newline
 * - Dobler interne double-quotes
 */
function escapeCsvField(value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  const needsQuote =
    value.includes('"') ||
    value.includes(",") ||
    value.includes("\n") ||
    value.includes("\r");
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Generér Bitwarden-kompatibel CSV-tekst fra passord-entries.
 * Returnerer ferdig streng inkludert UTF-8 BOM og header.
 */
export function buildBitwardenCsv(entries: VaultEntry[]): string {
  const rows = entries.map((e) => {
    const cells = [
      escapeCsvField(e.title),
      escapeCsvField(e.url),
      escapeCsvField(e.username),
      escapeCsvField(e.password),
      escapeCsvField(e.notes),
    ];
    return cells.join(",");
  });
  return UTF8_BOM + BITWARDEN_HEADER + "\n" + rows.join("\n") + "\n";
}

/**
 * Last ned CSV som fil. Bruker `<a download>`-trick — ingen
 * server-roundtrip, alt skjer klient-side fra in-memory data.
 *
 * Filnavn-format: kodo-vault-export-YYYY-MM-DD.csv
 */
export function downloadCsv(content: string, filename?: string): void {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(
    today.getDate(),
  )}`;
  const name = filename ?? `kodo-vault-export-${dateStr}.csv`;

  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Frigi blob-URL etter en kort delay slik at nedlasting fullføres
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
