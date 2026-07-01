"use client";
/**
 * Ko | Do · Vault — D-147 (2026-02) — EnvVarsCard
 *
 * Test Tools-seksjon som viser alle env-vars i Vercel etter passord-
 * bekreftelse. Verdiene er skjult inntil `ADMIN_REVEAL_SECRETS_PASSWORD_HASH`-
 * passord er verifisert server-side (bcrypt-compare).
 *
 * Etter reveal:
 *   - Gruppert tabell (Auth & Session, Encryption, Central Upstash, ...)
 *   - Kopier-knapp per rad
 *   - Manuell "Skjul verdier" for å tømme state
 *
 * SPW-integrasjon planlagt i senere iterasjon — dette er MVP med enkelt
 * passord.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Copy, Check, ShieldAlert, FileDown, FileJson } from "lucide-react";

type Row = {
  name: string;
  value: string;
  group: string;
  description: string;
  isSet: boolean;
};

export function EnvVarsCard() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const handleReveal = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password) {
      toast.error("Skriv inn passord først");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/env-vars", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "invalid_password") {
          toast.error("Feil passord");
        } else if (data.error === "server_misconfigured") {
          toast.error(
            "Server ikke konfigurert — ADMIN_REVEAL_SECRETS_PASSWORD_HASH mangler i Vercel env",
          );
        } else {
          toast.error(data.detail || data.error || `HTTP ${res.status}`);
        }
        return;
      }
      setRows(data.rows as Row[]);
      setPassword(""); // Tøm input umiddelbart
      toast.success(`Hentet ${data.rows.length} env-vars`);
    } finally {
      setBusy(false);
    }
  };

  const handleHide = () => {
    setRows(null);
    setCopiedName(null);
    toast("Verdiene er skjult");
  };

  const handleCopy = async (name: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedName(name);
      setTimeout(() => setCopiedName(null), 1500);
    } catch {
      toast.error("Kunne ikke kopiere");
    }
  };

  // D-148 (2026-02): CSV/JSON-eksport av env-vars. Klient-side —
  // ingen server-endring nødvendig, dataene er allerede lastet inn i
  // state etter vellykket reveal.
  //
  // CSV-format: RFC 4180 + OWASP formula-injection-mitigering — samme
  // mønster som am-admin-backup D-113. Kolonner: group, name, value,
  // description, isSet.
  //
  // Filnavn: env-vars-YYYY-MM-DD-HHMM.{csv,json} (samme konvensjon som D-113).
  const csvEscape = (cell: string): string => {
    if (cell.length === 0) return "";
    // Formula injection: hvis cellen starter med =, +, -, @, TAB eller CR
    // → prefiks apostrof
    const first = cell.charAt(0);
    let out = cell;
    if (first === "=" || first === "+" || first === "-" || first === "@" ||
        first === "\t" || first === "\r") {
      out = "'" + out;
    }
    // Escape " som "" og wrap i "" hvis cellen inneholder komma, ", eller newline
    if (out.includes('"') || out.includes(",") || out.includes("\n")) {
      out = '"' + out.replace(/"/g, '""') + '"';
    }
    return out;
  };

  const buildFilename = (ext: "csv" | "json"): string => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return `env-vars-${stamp}.${ext}`;
  };

  const downloadBlob = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    if (!rows || rows.length === 0) return;
    const header = ["group", "name", "value", "description", "isSet"]
      .map(csvEscape)
      .join(",");
    const lines = rows.map((r) =>
      [
        csvEscape(r.group),
        csvEscape(r.name),
        csvEscape(r.value),
        csvEscape(r.description),
        csvEscape(r.isSet ? "true" : "false"),
      ].join(","),
    );
    const content = [header, ...lines].join("\r\n") + "\r\n";
    downloadBlob(content, "text/csv", buildFilename("csv"));
    toast.success(`CSV-eksport: ${rows.length} rader`);
  };

  const handleExportJson = () => {
    if (!rows || rows.length === 0) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      count: rows.length,
      rows,
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      "application/json",
      buildFilename("json"),
    );
    toast.success(`JSON-eksport: ${rows.length} rader`);
  };

  // Grupper radene
  const grouped: Record<string, Row[]> = {};
  (rows ?? []).forEach((row) => {
    if (!grouped[row.group]) grouped[row.group] = [];
    grouped[row.group]!.push(row);
  });
  const groupOrder = [
    "Auth & Session",
    "Encryption",
    "Central Upstash",
    "Per-tenant Upstash",
    "Upstash Management",
    "Vercel",
    "Stripe",
    "E-post (Resend)",
    "Telegram",
    "Cron & Internal",
    "Client Config",
    "Runtime",
    "Ukjent",
  ];

  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
      data-testid="env-vars-card"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-amber-500/15 border border-amber-400/30 flex items-center justify-center">
          <ShieldAlert className="h-4 w-4 text-amber-300" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold tracking-tight">
            ENV-variabler
          </h3>
          <p className="text-[11px] text-white/50 mt-0.5">
            Vis alle env-vars satt i Vercel. Krever bekreftelses-passord.
            Verdier logges ikke serverside — kun at endepunktet ble kalt.
          </p>
        </div>
      </div>

      {!rows && (
        <form
          onSubmit={handleReveal}
          className="flex items-center gap-2 flex-wrap"
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passord"
            autoComplete="off"
            className="px-3 py-1.5 rounded-lg bg-black/30 border border-white/15 text-sm min-w-[240px] focus:outline-none focus:border-amber-400/60"
            data-testid="env-vars-password-input"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !password}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 text-amber-100 text-sm font-medium disabled:opacity-50"
            data-testid="env-vars-reveal-btn"
          >
            <Eye className="h-3.5 w-3.5" />
            {busy ? "Verifiserer …" : "Vis"}
          </button>
        </form>
      )}

      {rows && (
        <>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <span className="text-[11px] text-white/50">
              {rows.length} env-vars hentet
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-emerald-100 text-xs"
                data-testid="env-vars-export-csv"
              >
                <FileDown className="h-3 w-3" />
                Eksport CSV
              </button>
              <button
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-100 text-xs"
                data-testid="env-vars-export-json"
              >
                <FileJson className="h-3 w-3" />
                Eksport JSON
              </button>
              <button
                onClick={handleHide}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-xs"
                data-testid="env-vars-hide-btn"
              >
                <EyeOff className="h-3 w-3" />
                Skjul verdier
              </button>
            </div>
          </div>

          <div className="space-y-5">
            {groupOrder.map((groupName) => {
              const groupRows = grouped[groupName];
              if (!groupRows || groupRows.length === 0) return null;
              return (
                <div
                  key={groupName}
                  data-testid={`env-vars-group-${groupName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
                >
                  <h4 className="text-[10px] uppercase tracking-wider text-white/45 mb-2">
                    {groupName}
                  </h4>
                  <div className="rounded-lg border border-white/10 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-white/[0.02]">
                        <tr className="text-left text-[10px] uppercase tracking-wide text-white/45 border-b border-white/10">
                          <th className="py-2 px-3 font-medium">Nøkkel</th>
                          <th className="py-2 px-3 font-medium">Verdi</th>
                          <th className="py-2 px-3 font-medium">Bruk</th>
                          <th className="py-2 px-3 font-medium w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map((row) => (
                          <tr
                            key={row.name}
                            className="border-b border-white/5 last:border-0"
                            data-testid={`env-vars-row-${row.name}`}
                          >
                            <td className="py-2 px-3 font-mono text-white/85 align-top">
                              {row.name}
                            </td>
                            <td className="py-2 px-3 font-mono text-white/70 align-top max-w-[42ch] break-all">
                              {row.isSet ? (
                                row.value
                              ) : (
                                <span className="text-white/30 italic">
                                  (ikke satt)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-white/55 align-top">
                              {row.description}
                            </td>
                            <td className="py-2 px-3 align-top">
                              {row.isSet && (
                                <button
                                  onClick={() => handleCopy(row.name, row.value)}
                                  className="text-white/45 hover:text-white p-1 -m-1"
                                  data-testid={`env-vars-copy-${row.name}`}
                                  aria-label={`Kopier ${row.name}`}
                                >
                                  {copiedName === row.name ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
