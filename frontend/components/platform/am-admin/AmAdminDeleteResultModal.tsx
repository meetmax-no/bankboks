"use client";

/**
 * Ko | Do · Vault — D-116 (2026-06-29) — AmAdminDeleteResultModal
 *
 * Result-modal for sletting i firma-admin (am-admin Konsoll). Tilsvarer
 * `DeleteResultModal` i super-admin TenantViewer, men med to viktige
 * forskjeller (per Mike-direktiv 2C):
 *
 *   1. Steg-labels er brukervennlige, ikke infra-jargon. "Upstash slettet"
 *      blir "Kryptert lagring slettet" etc. Begrunnelse: am-admin er
 *      kunden, og skal ikke eksponeres for stack-detaljer (D-078a).
 *
 *   2. Steg som er irrelevante for ansatt-sletting (b2bPrefix, orgAdmins,
 *      mpw, invites) vises IKKE — de gjelder kun B2B-parent-sletting,
 *      som am-admin ikke har tilgang til.
 *
 * Brukes også for invitasjons-sletting (3B): da kollapser modalen til en
 * enklere visning (subdomene + e-post + tidspunkt), siden invite-sletting
 * ikke har noe steg-spor å vise.
 */
import { CheckCircle2, X, AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import type { DeleteResult } from "@/lib/platform/delete-tenant";

export type AmAdminTenantDeleteResult = {
  kind: "tenant";
  subdomain: string;
  result: DeleteResult;
  deletedAt: string;
};

export type AmAdminInviteDeleteResult = {
  kind: "invite";
  subdomain: string;
  email: string | null;
  success: boolean;
  error?: string | null;
  deletedAt: string;
};

export type AmAdminDeleteResultPayload =
  | AmAdminTenantDeleteResult
  | AmAdminInviteDeleteResult;

// Mapping fra teknisk steg-navn → brukervennlig i18n-nøkkel. Steg som ikke
// er med her (b2bPrefix, orgAdmins, mpw, invites) vises ikke for am-admin.
const TENANT_STEP_KEYS: ReadonlyArray<{
  key: keyof DeleteResult["steps"];
  labelKey: string;
}> = [
  { key: "vercel", labelKey: "am_admin_employees.delete_step_vault_env" },
  { key: "upstash", labelKey: "am_admin_employees.delete_step_encrypted_storage" },
  { key: "centralDb", labelKey: "am_admin_employees.delete_step_account" },
  { key: "clientConfig", labelKey: "am_admin_employees.delete_step_client_config" },
  { key: "stripe", labelKey: "am_admin_employees.delete_step_billing" },
  { key: "adminNotes", labelKey: "am_admin_employees.delete_step_admin_notes" },
];

export function AmAdminDeleteResultModal({
  payload,
  onClose,
}: {
  payload: AmAdminDeleteResultPayload;
  onClose: () => void;
}) {
  const { t } = useLocale();

  // Avled tittel + tone
  const isTenant = payload.kind === "tenant";
  const success = isTenant ? payload.result.success : payload.success;
  const hasErrors = isTenant
    ? payload.result.errors.length > 0
    : Boolean(payload.error);

  const titleKey = isTenant
    ? success
      ? hasErrors
        ? "am_admin_employees.delete_result_title_partial"
        : "am_admin_employees.delete_result_title_ok"
      : "am_admin_employees.delete_result_title_failed"
    : success
      ? "am_admin_invites.delete_result_title_ok"
      : "am_admin_invites.delete_result_title_failed";

  const titleTone = success
    ? hasErrors
      ? "text-amber-300"
      : "text-emerald-300"
    : "text-rose-300";

  const closeLabelKey = isTenant
    ? "am_admin_employees.delete_result_close"
    : "am_admin_invites.delete_result_close";

  const subdomainLabelKey = isTenant
    ? "am_admin_employees.delete_result_subdomain_label"
    : "am_admin_invites.delete_result_subdomain_label";

  const timestampLabelKey = isTenant
    ? "am_admin_employees.delete_result_timestamp_label"
    : "am_admin_invites.delete_result_timestamp_label";

  return (
    <div
      data-testid="am-admin-delete-result-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {success ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-300 shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-300 shrink-0" />
            )}
            <h3
              data-testid="am-admin-delete-result-title"
              className={`text-base font-semibold tracking-tight ${titleTone}`}
            >
              {t(titleKey)}
            </h3>
          </div>
          <button
            data-testid="am-admin-delete-result-close-icon"
            onClick={onClose}
            className="p-1 rounded-md text-white/55 hover:text-white hover:bg-white/10 transition"
            aria-label={t(closeLabelKey)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — meta-rader (subdomene + e-post + tidspunkt) */}
        <div className="px-5 pt-4 pb-2 space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-white/55 text-xs uppercase tracking-wide font-mono">
              {t(subdomainLabelKey)}
            </span>
            <span
              data-testid="am-admin-delete-result-subdomain"
              className="text-white/90 font-mono break-all text-right"
            >
              {payload.subdomain}
            </span>
          </div>

          {payload.kind === "invite" && payload.email && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-white/55 text-xs uppercase tracking-wide font-mono">
                {t("am_admin_invites.delete_result_email_label")}
              </span>
              <span
                data-testid="am-admin-delete-result-email"
                className="text-white/90 break-all text-right"
              >
                {payload.email}
              </span>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-3">
            <span className="text-white/55 text-xs uppercase tracking-wide font-mono">
              {t(timestampLabelKey)}
            </span>
            <span
              data-testid="am-admin-delete-result-timestamp"
              className="text-white/75 text-right"
            >
              {formatTimestamp(payload.deletedAt)}
            </span>
          </div>
        </div>

        {/* Tenant: brukervennlig stegliste */}
        {payload.kind === "tenant" && (
          <div className="px-5 pt-4 pb-2 space-y-2">
            {TENANT_STEP_KEYS.map(({ key, labelKey }) => {
              const status = payload.result.steps[key];
              return (
                <div
                  key={key}
                  data-testid={`am-admin-delete-step-${key}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-white/75">{t(labelKey)}</span>
                  <StepBadge status={status} />
                </div>
              );
            })}
          </div>
        )}

        {/* Generisk support-melding ved feil (skjuler tekniske feilstrenger
            som tilhører Mike-loggen, ikke am-admin) */}
        {!success && (
          <div className="px-5 pt-2 pb-2 text-xs text-white/55 leading-relaxed">
            {t("am_admin_employees.delete_result_contact_support")}
          </div>
        )}

        {/* Footer — Lukk-knapp */}
        <div className="p-5 border-t border-white/10 flex justify-end">
          <button
            data-testid="am-admin-delete-result-close-btn"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/20 text-sm font-medium text-white transition"
          >
            {t(closeLabelKey)}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepBadge({
  status,
}: {
  status: DeleteResult["steps"][keyof DeleteResult["steps"]];
}) {
  const { t } = useLocale();
  const palette = {
    ok: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    failed: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    skipped: "bg-white/5 text-white/45 border-white/15",
    preserved: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  } as const;
  const labels = {
    ok: t("admin_tenants.delete_step_ok"),
    failed: t("admin_tenants.delete_step_failed"),
    skipped: t("admin_tenants.delete_step_skipped"),
    preserved: t("admin_tenants.delete_step_preserved"),
  } as const;
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${palette[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
