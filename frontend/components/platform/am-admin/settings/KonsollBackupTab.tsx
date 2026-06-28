"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-087, 2026-06-27) — Konsoll Backup-fane
 *
 * Backup-eksport (CSV + JSON). Super-admin only (MPW kreves for å dekryptere
 * admin-notater i backupen).
 */
import { BackupSection } from "../BackupSection";

export function KonsollBackupTab() {
  return (
    <div className="space-y-5">
      <BackupSection />
    </div>
  );
}
