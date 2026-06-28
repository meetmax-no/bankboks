"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-087, 2026-06-27) — Konsoll Team-fane
 *
 * Egen fane med kun team-administrasjon (opprett/suspend/slett admins).
 * Super-admin only — håndhevet både i UI og på alle underliggende endepunkter.
 */
import { TeamManagementSection } from "../TeamManagementSection";

type Props = { currentAdminId: string };

export function KonsollTeamTab({ currentAdminId }: Props) {
  return (
    <div className="space-y-5">
      <TeamManagementSection currentAdminId={currentAdminId} />
    </div>
  );
}
