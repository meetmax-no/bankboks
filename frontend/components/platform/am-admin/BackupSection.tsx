"use client";
/**
 * Ko | Do · Vault — Iter 20.5d — am-admin BackupSection
 *
 * "Last ned backup"-seksjon på am-admin dashboard. Synlig kun når MPW
 * er låst opp (siden vi må kunne dekryptere adminNotes klient-side).
 *
 * Flow:
 *   1. Klikk knapp → GET /api/am-admin/backup/data
 *   2. Dekrypter alle note-envelopene med MPW key
 *   3. Bygg CSV eller JSON-string klient-side
 *   4. Last ned via <a href="blob:...">
 *
 * Per user-svar (2026-06-26):
 *   1=B → am-admin-spesifikk CSV (IKKE Bitwarden)
 *   2=B → filnavn med timestamp
 *   Innhold: ansatte + adminNotes + license (ingen audit-logs)
 */
import { useCallback, useState } from "react";
import { useLocale } from "@/lib/i18n-context";
import {
  decryptEmployeeNotes,
  mapEmployeesPreservingEnvelope,
  buildBackupCsv,
  buildBackupJson,
  buildBackupFilename,
  type BackupData,
  type DecryptedEmployee,
} from "@/lib/platform/am-admin-backup";
import { useMpw } from "./MpwContext";

type DownloadFormat = "csv" | "json";

export function BackupSection() {
  const { t } = useLocale();
  const { isUnlocked, getUnlocked } = useMpw();
  const [busy, setBusy] = useState<DownloadFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastStats, setLastStats] = useState<{
    format: DownloadFormat;
    employees: number;
    notes: number;
    decryptErrors: number;
    /** D-109 (Mike 2026-06-28): true hvis notater ble eksportert som
     *  envelope-JSON i stedet for klartekst (MPW låst/usatt). */
    notesEncrypted: boolean;
  } | null>(null);

  const handleDownload = useCallback(
    async (format: DownloadFormat) => {
      if (busy) return;
      // D-109 (Mike 2026-06-28): MPW er ALDRI et krav for å ta backup.
      // - MPW ulåst → dekrypter notater til klartekst i backupen.
      // - MPW låst eller ikke satt → bevar notater som envelope-JSON
      //   (restore er mulig senere med samme MPW). Ingen bruker blokkeres.
      setBusy(format);
      setError(null);
      try {
        const res = await fetch("/api/am-admin/backup/data", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: BackupData = await res.json();

        const unlocked = getUnlocked();
        let entries: DecryptedEmployee[];
        let notesEncrypted: boolean;
        if (unlocked) {
          entries = await decryptEmployeeNotes(data.employees, unlocked.key);
          notesEncrypted = false;
        } else {
          entries = mapEmployeesPreservingEnvelope(data.employees);
          notesEncrypted = true;
        }

        let blob: Blob;
        let filename: string;
        if (format === "csv") {
          const csv = buildBackupCsv(data.admin, entries, data.invites);
          // BOM for UTF-8 Excel-kompatibilitet (æøå rendres riktig).
          blob = new Blob(["\uFEFF" + csv], {
            type: "text/csv;charset=utf-8",
          });
          filename = buildBackupFilename(data.prefix, "csv");
        } else {
          const json = buildBackupJson(data, entries);
          blob = new Blob([JSON.stringify(json, null, 2)], {
            type: "application/json;charset=utf-8",
          });
          filename = buildBackupFilename(data.prefix, "json");
        }

        // Trigger download via temporary anchor.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Defer revoke for å unngå race på eldre Firefox der synkron
        // revoke kan avbryte download før byte-streamen starter
        // (iter-17 LOW-fix). 1s er trygt over alle moderne nettlesere.
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        setLastStats({
          format,
          employees: data.employeeCount,
          notes: data.notedCount,
          decryptErrors: entries.filter((e) => e.noteDecryptError).length,
          notesEncrypted,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [busy, getUnlocked],
  );

  return (
    <section
      className="bg-slate-900/80 backdrop-blur-xl border border-white/15 rounded-2xl shadow-xl p-6"
      data-testid="am-admin-backup-section"
    >
      <header className="mb-3">
        <h2 className="text-base font-medium">{t("am_admin_backup.heading")}</h2>
        <p className="text-xs text-white/55 mt-1">
          {t("am_admin_backup.description")}
        </p>
      </header>

      {/* D-109 (Mike 2026-06-28): MPW er ALDRI et krav for å ta backup.
          Knappene vises alltid. Hvis MPW er låst eller usatt, blir notater
          eksportert som envelope-JSON (restore-able med samme MPW senere). */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleDownload("csv")}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            data-testid="am-admin-backup-csv-btn"
          >
            {busy === "csv"
              ? t("am_admin_backup.btn_busy")
              : t("am_admin_backup.btn_csv")}
          </button>
          <button
            onClick={() => void handleDownload("json")}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="am-admin-backup-json-btn"
          >
            {busy === "json"
              ? t("am_admin_backup.btn_busy")
              : t("am_admin_backup.btn_json")}
          </button>
        </div>

        {!isUnlocked && (
          <p
            className="text-xs text-white/55 italic"
            data-testid="am-admin-backup-encrypted-hint"
          >
            MPW er låst eller ikke satt — admin-notater eksporteres som
            kryptert envelope-JSON. Lås opp MPW for klartekst-eksport.
          </p>
        )}

        {error && (
          <p
            className="text-xs text-rose-300"
            data-testid="am-admin-backup-error"
          >
            {error}
          </p>
        )}

        {lastStats && !error && (
          <p
            className="text-xs text-emerald-300/90"
            data-testid="am-admin-backup-success"
          >
            {t("am_admin_backup.success_prefix")} {lastStats.format.toUpperCase()} ·{" "}
            {lastStats.employees} {t("am_admin_backup.employees_unit")} ·{" "}
            {lastStats.notes} {t("am_admin_backup.notes_unit")}
            {lastStats.notesEncrypted && (
              <span className="text-white/55">
                {" "}· notater kryptert
              </span>
            )}
            {lastStats.decryptErrors > 0 && (
              <span className="text-amber-300/85">
                {" "}
                · {lastStats.decryptErrors}{" "}
                {t("am_admin_backup.decrypt_errors_unit")}
              </span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
