"use client";

// Iter 19.9.2 — Fane 4: Backup & Admin
//
// Innhold:
//  - SubscriptionInfoCard (eksisterende — Stripe-status, kun for trial/active/cancelled)
//  - Plan-basert CTA:
//      • trial   → "Aktiver abonnement" (amber CTA → /billing/upgrade)
//                 — vises ALLTID på trial, uavhengig av hasStripeCustomer (Mike-direktiv 2026-06-24)
//      • active  → "Administrer abonnement" → Stripe Portal
//      • cancel  → "Administrer abonnement" → Stripe Portal
//      • annet   → ingenting (pending/locked/unknown/free)
//  - Backup eksport/import
//  - Farlig sone: "Slett vault og konto"

import { useEffect, useRef, useState } from "react";
import {
  CreditCard,
  Download,
  FileDown,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { SubscriptionInfoCard } from "@/components/SubscriptionInfoCard";
import { useLocale } from "@/lib/i18n-context";
import { formatLongDate } from "@/lib/format-date";

/** Status-set fra /api/billing/checkout-info (Iter 19.5). */
type CheckoutInfoStatus =
  | "active"
  | "cancelled"
  | "trial"
  | "locked"
  | "free"
  | "pending"
  | "unknown";

/** Plan-set fra tenant.plan via /api/billing/checkout-info. */
type CheckoutInfoPlan =
  | "free"
  | "trial"
  | "monthly"
  | "yearly"
  | "unknown";

/**
 * Hvilket CTA som skal vises (om noe). Spec fra Mike 2026-06-24 (revidert):
 *   - plan = "free"             → ingen (hverken kort eller CTA)
 *   - plan = "trial"            → "Aktiver abonnement" (uavhengig av Stripe-customer)
 *   - plan = "monthly"/"yearly"
 *       + hasStripeCustomer     → "Administrer abonnement" (Stripe Portal)
 *   - alle andre kombinasjoner  → ingen (safe fallback for ukjent state)
 *
 * Bevisst: vi bruker `plan` ikke `status`. En "active"-status med plan="free"
 * (admin/eksempt-tenant) skal IKKE få portal-knapp — Stripe har ingen
 * customer å åpne portalen for. Dette var bug-en Mike rapporterte 2026-06-24.
 */
type CtaKind = "activate" | "manage" | "none";

function computeCta(
  plan: CheckoutInfoPlan,
  hasStripeCustomer: boolean,
): CtaKind {
  if (plan === "free") return "none";
  if (plan === "trial") return "activate";
  if ((plan === "monthly" || plan === "yearly") && hasStripeCustomer) {
    return "manage";
  }
  return "none";
}

interface BackupAdminTabProps {
  open: boolean;
  onExportBackup: () => void | Promise<void>;
  onImportFile: (file: File) => void;
  onExportPasswordsCsv: () => void;
  onDeleteVaultAndAccount: () => void;
}

export function BackupAdminTab({
  open,
  onExportBackup,
  onImportFile,
  onExportPasswordsCsv,
  onDeleteVaultAndAccount,
}: BackupAdminTabProps) {
  const { t, locale } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<CheckoutInfoPlan>("unknown");
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [cancelEffectiveAt, setCancelEffectiveAt] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/checkout-info");
        if (aborted) return;
        if (res.ok) {
          const data = (await res.json()) as {
            ok: true;
            status: string;
            plan?: string;
            hasStripeCustomer?: boolean;
            cancelAtPeriodEnd?: boolean;
            cancelEffectiveAt?: string | null;
          };
          const p = (data.plan ?? "unknown") as CheckoutInfoPlan;
          if (
            p === "free" ||
            p === "trial" ||
            p === "monthly" ||
            p === "yearly"
          ) {
            setPlan(p);
          } else {
            setPlan("unknown");
          }
          setHasStripeCustomer(data.hasStripeCustomer === true);
          setCancelAtPeriodEnd(data.cancelAtPeriodEnd === true);
          setCancelEffectiveAt(data.cancelEffectiveAt ?? null);
        } else {
          setPlan("unknown");
          setHasStripeCustomer(false);
        }
      } catch {
        setPlan("unknown");
        setHasStripeCustomer(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [open]);

  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportFile(file);
    e.target.value = "";
  };

  const cta = computeCta(plan, hasStripeCustomer);

  // SubscriptionInfoCard vises kun når det er en faktisk Stripe-customer.
  // Free-tenants (admin/eksempt) og trial-uten-customer får ingen card —
  // Stripe-API-et ville bare returnert no_subscription og laget tom UI.
  const showCard =
    hasStripeCustomer && (plan === "monthly" || plan === "yearly");

  return (
    <div className="space-y-4">
      {/* Stripe live info-kort (Iter 19.7) — kun for ekte planer */}
      {showCard && <SubscriptionInfoCard open={open} />}

      {/* Plan-basert CTA */}
      {cta === "activate" && (
        <ActivateSubscriptionRow
          title={t("settings.action_activate_subscription_title")}
          desc={t("settings.action_activate_subscription_desc")}
          onClick={() => {
            window.location.assign("/billing/upgrade");
          }}
        />
      )}
      {cta === "manage" && (
        <ActionRow
          testId="settings-manage-subscription"
          icon={CreditCard}
          iconColor={
            cancelAtPeriodEnd ? "text-amber-200" : "text-white/80"
          }
          iconBg={
            cancelAtPeriodEnd
              ? "bg-amber-400/15 border-amber-300/30"
              : "bg-white/10 border-white/15"
          }
          title={t("settings.action_manage_subscription_title")}
          desc={
            cancelAtPeriodEnd && cancelEffectiveAt
              ? `${t("settings.subscription_cancels_at_prefix")} ${formatLongDate(cancelEffectiveAt, locale)}`
              : t("settings.action_manage_subscription_desc")
          }
          onClick={() => {
            window.location.assign("/api/billing/portal");
          }}
        />
      )}

      {/* Backup */}
      <div className="space-y-2">
        <SectionTitle>{t("settings.section_backup")}</SectionTitle>
        <ActionRow
          testId="settings-export-backup"
          icon={Download}
          iconColor="text-sky-200"
          iconBg="bg-sky-400/15 border-sky-300/30"
          title={t("settings.action_export_title")}
          desc={t("settings.action_export_desc")}
          onClick={onExportBackup}
        />
        <ActionRow
          testId="settings-import-backup"
          icon={Upload}
          iconColor="text-violet-200"
          iconBg="bg-violet-400/15 border-violet-300/30"
          title={t("settings.action_import_title")}
          desc={t("settings.action_import_desc")}
          onClick={handleImportClick}
        />
        <input
          ref={fileInputRef}
          data-testid="import-file-input"
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChange}
        />
        <ActionRow
          testId="settings-export-passwords-csv"
          icon={FileDown}
          iconColor="text-amber-200"
          iconBg="bg-amber-400/15 border-amber-300/30"
          title={t("settings.action_export_passwords_csv_title")}
          desc={t("settings.action_export_passwords_csv_desc")}
          onClick={onExportPasswordsCsv}
        />
        <p className="text-[10px] text-white/40 leading-relaxed">
          {t("settings.backup_help")}
        </p>
      </div>

      {/* Farlig sone — nederst, rose-border, to-stegs bekreftelse i dialog */}
      <div className="pt-2">
        <div className="border-t border-white/10 my-3" aria-hidden="true" />
        <div
          data-testid="settings-danger-zone"
          className="rounded-2xl border border-rose-400/30 bg-rose-500/[0.04] p-4"
        >
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-lg bg-rose-500/15 border border-rose-400/30 flex items-center justify-center">
              <Trash2 className="h-4 w-4 text-rose-300" />
            </div>
            <span className="text-sm font-semibold text-rose-100">
              {t("settings.danger_zone_title")}
            </span>
          </div>
          <p className="text-[11px] text-white/55 leading-relaxed mb-3">
            {t("settings.danger_zone_desc")}
          </p>
          <button
            type="button"
            data-testid="settings-delete-vault-account"
            onClick={onDeleteVaultAndAccount}
            className="w-full px-4 py-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/40 text-sm font-semibold text-rose-100 transition focus:outline-none focus:ring-2 focus:ring-rose-300/50"
          >
            {t("settings.danger_zone_button")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-white/55 uppercase tracking-[0.12em] mb-1.5">
      {children}
    </h3>
  );
}

function ActionRow({
  testId,
  icon: Icon,
  iconColor,
  iconBg,
  title,
  desc,
  onClick,
}: {
  testId: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-left transition focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)]"
    >
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${iconBg}`}
      >
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-[11px] text-white/55 mt-0.5">{desc}</div>
      </div>
    </button>
  );
}

/**
 * ActivateSubscriptionRow — den VIKTIGSTE konverterings-knappen i hele appen.
 * Visuelt prioritert: amber fill, mørk tekst, sterk shadow + sparkle-ikon.
 * Skiller seg klart fra de øvrige ActionRow-ene som er bg-white/5.
 */
function ActivateSubscriptionRow({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      data-testid="settings-activate-subscription"
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-[var(--kodo-accent)]/60 bg-gradient-to-r from-[var(--kodo-accent-soft)] to-[var(--kodo-accent-soft)] hover:from-[var(--kodo-accent)]/25 hover:to-[var(--kodo-accent)]/15 text-left transition shadow-[0_8px_24px_-12px_var(--kodo-accent-glow)] hover:shadow-[0_12px_32px_-10px_var(--kodo-accent-glow)] focus:outline-none focus:ring-2 focus:ring-[var(--kodo-accent-glow)]"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--kodo-accent)] flex items-center justify-center shadow-[inset_0_-2px_4px_rgba(0,0,0,0.15)]">
        <Sparkles
          className="h-[18px] w-[18px] text-[var(--kodo-accent-ink)]"
          strokeWidth={2.25}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-[11px] text-white/75 mt-0.5 leading-snug">
          {desc}
        </div>
      </div>
      <span
        className="flex-shrink-0 text-[var(--kodo-accent)] font-bold text-lg"
        aria-hidden="true"
      >
        →
      </span>
    </button>
  );
}
