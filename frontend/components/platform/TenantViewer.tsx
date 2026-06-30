"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 1 — TenantViewer
 *
 * UI for å liste, vise detaljer for, opprette og slette TenantRecords i sentral
 * platform-database. Brukes på /platform/admin/tenants og gjenbrukes i Iter 20
 * (B2B admin-modul) per spec.
 *
 * Alle brukervendte strenger gjennom `t()` (D-036). Mørk tema, blå CTA per
 * D-031 (B-modellen): `PRIMARY_THEME` = blue-500/600. Amber er reservert
 * som warning-aksent (kun status-badge for "trial"-tenants).
 * glass-arkitektur (backdrop-blur-xl).
 */
import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Mail as MailIcon,
  CreditCard,
  RefreshCw,
  Trash2,
  ChevronLeft,
  AlertCircle,
  ShieldAlert,
  X,
  Search,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import { formatShortDate } from "@/lib/format-date";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DarkSelect } from "@/components/platform/DarkSelect";
import { PRIMARY_THEME } from "@/lib/feature-theme";
import type {
  CreateTenantInput,
  TenantRecord,
  TenantStatus,
  Plan,
  CustomerType,
} from "@/lib/platform/tenant-types";
import type { DeleteResult } from "@/lib/platform/delete-tenant";
import { PaymentLinkModal } from "@/components/platform/PaymentLinkModal";
import { LocaleRadioGroup } from "@/components/platform/LocaleRadioGroup";
import { SeatProgressBar } from "@/components/platform/am-admin/SeatProgressBar";
import { SubTabNav } from "@/components/platform/SubTabNav";
import { CreateOrgAdminCard } from "./CreateOrgAdminCard";
import { SendTestInvoiceCard } from "./SendTestInvoiceCard";
import { InvoiceHistoryCard } from "./InvoiceHistoryCard";
import { ClientConfigEditor } from "./ClientConfigEditor";
import { ConfigToolsButton } from "./ConfigToolsButton";
import { ProvisioningTracker } from "./ProvisioningTracker";
import defaultClientConfig from "../../public/clients/default.json";
import { validateOrgNumber, deriveVatNumber } from "@/lib/platform/org-number-validation";
import type { OrgValidationResult } from "@/lib/platform/org-number-validation";
import { usePostnrAutofill } from "@/lib/postal/use-postnr-autofill";

/**
 * Eneste sannhetskilde for default B2C trial-lengde i form-feltet:
 * `public/clients/default.json` → `pricing.b2c.trialDays` (D-127), med
 * bakoverkomp til legacy flat `pricing.trialDays`. Admin kan overstyre
 * per tenant via input-feltet i form-en.
 */
const DEFAULT_TRIAL_DAYS_FROM_CONFIG: number = (() => {
  const pricing = defaultClientConfig.pricing as
    | Record<string, unknown>
    | undefined;
  const nested = pricing?.b2c as Record<string, unknown> | undefined;
  const raw =
    (typeof nested?.trialDays === "number" ? nested.trialDays : undefined) ??
    (typeof pricing?.trialDays === "number" ? pricing.trialDays : undefined);
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const v = Math.floor(raw);
  return v >= 0 && v <= 365 ? v : 0;
})();

/**
 * Iter 20.4a: B2B-tenants får 45-dagers trial som default (3× B2C-flow).
 * Mike kan fortsatt overstyre i form-feltet.
 */
const DEFAULT_TRIAL_DAYS_B2B = 45;

type StatusFilter = "all" | TenantStatus | "active_expires";
type PlanFilter = "all" | Plan;
type CustomerTypeFilter = "all" | CustomerType;
type SortKey = "createdAt" | "subdomain";

type CreateFormState = {
  subdomain: string;
  email: string;
  customerType: "b2c" | "b2b";
  firstName: string;
  lastName: string;
  companyName: string;
  orgNumber: string;
  // D-112: vatNumber fjernet — utledes live via deriveVatNumber()
  companyStreet: string;
  companyPostalCode: string;
  companyCity: string;
  companyCountry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  billingStreet: string;
  billingPostalCode: string;
  billingCity: string;
  billingCountry: string;
  billingEmail: string;
  billingReference: string;
  adminSubdomain: string;
  tenantPrefix: string;
  maxLicenses: string;
  plan: Plan;
  status: TenantStatus;
  trialDays: number;
  lifecycleEmails: boolean;
  // Iter 19.9.7 (locale-fix): obligatorisk i Iter 19.9 for selvbetjent
  // registrering; må også settes i admin-flytene ellers blir
  // tenant.locale=null for evig (lifecycle-mailer faller tilbake til NO).
  locale: "no" | "sv" | "da" | "en" | null;
  notes: string;
};

const EMPTY_FORM: CreateFormState = {
  subdomain: "",
  email: "",
  customerType: "b2c",
  firstName: "",
  lastName: "",
  companyName: "",
  orgNumber: "",
  companyStreet: "",
  companyPostalCode: "",
  companyCity: "",
  companyCountry: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  billingStreet: "",
  billingPostalCode: "",
  billingCity: "",
  billingCountry: "",
  billingEmail: "",
  billingReference: "",
  adminSubdomain: "",
  tenantPrefix: "",
  maxLicenses: "",
  plan: "trial",
  status: "trial",
  trialDays: DEFAULT_TRIAL_DAYS_FROM_CONFIG,
  lifecycleEmails: true,
  locale: null,
  notes: "",
};

export function TenantViewer({
  defaultCustomerType,
}: {
  /**
   * Iter 20.7: når satt, åpner viewer i en B2B-spesifikk modus:
   *   - `customerTypeFilter` defaultes til denne (kun B2B-tenants vises)
   *   - "Opprett ny"-modalen forhåndsutfyller customerType og skjuler
   *     TYPE-dropdownen
   *   - B2B-default trial (45d) brukes
   * Default: undefined → viser alle tenants som før, modal har TYPE-velger.
   */
  defaultCustomerType?: CustomerType;
} = {}) {
  const { t, locale } = useLocale();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TenantRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [provisioningSubdomain, setProvisioningSubdomain] = useState<
    string | null
  >(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false);

  // Søk + filter + sortering — per Mike's spec 2026-06-01
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [customerTypeFilter, setCustomerTypeFilter] = useState<CustomerTypeFilter>(
    defaultCustomerType ?? "all",
  );
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");

  const filteredAndSorted = useMemo(() => {
    const terms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = tenants.filter((tn) => {
      // D-102 (2026-06-28, Mike): D-078/D-079 — Super-admin SKAL IKKE se
      // ansatte-tenants i hovedlisten. Selve eksistensen av ansatt-vaults
      // er en del av kundens lukkede verden. Test Tools (OrphanInvitesCard,
      // OrgAdminListCard) viser fortsatt alt — det er debug-verktøyet for
      // platform-eier. Hovedlisten viser kun B2B-PARENTS + B2C-tenants.
      if (tn.customerType === "b2b" && tn.parentTenant) {
        return false;
      }

      // "active_expires" = active + cancel_at_period_end satt. Spesialfilter
      // for å finne abonnement som er på vei ut. Sjekkes FØR vanlig
      // status-match siden den ikke matcher en TenantStatus-enum-verdi.
      if (statusFilter === "active_expires") {
        if (tn.status !== "active" || !tn.cancelAtPeriodEnd) return false;
      } else if (statusFilter !== "all" && tn.status !== statusFilter) {
        return false;
      }
      if (planFilter !== "all" && tn.plan !== planFilter) return false;
      if (
        customerTypeFilter !== "all" &&
        tn.customerType !== customerTypeFilter
      )
        return false;
      if (terms.length > 0) {
        // D-100/D-102 (2026-06-28): D-078 — siden vi har filtrert bort
        // B2B-children ovenfor, trenger ikke haystacken inkludere
        // parentTenant for dem heller. Standard søk på subdomain/email/
        // firstName/lastName/companyName for det som vises.
        const haystack = [
          tn.subdomain,
          tn.email,
          tn.firstName,
          tn.lastName,
          tn.companyName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        // Per SearchPalette-mønsteret: alle termer må matche, uavhengig av rekkefølge.
        if (!terms.every((term) => haystack.includes(term))) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      if (sortKey === "subdomain") {
        return a.subdomain.localeCompare(b.subdomain);
      }
      // createdAt — nyeste først
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }, [tenants, searchQuery, statusFilter, planFilter, customerTypeFilter, sortKey]);

  // D-102 (Mike 2026-06-28): tellere må reflektere "synlige" tenants
  // (B2B-children er per D-078 ekskludert fra hovedlisten — de skal ikke
  // engang figurere i totaltellet på Super-admin).
  // VIKTIG (D-103d, 2026-06-28): denne useMemo MÅ stå FØR `if (selected)
  // return`-grenen lenger ned, ellers brytes Rules of Hooks (hooks i
  // forskjellig rekkefølge mellom renders → React #300 "Rendered fewer
  // hooks than expected" ved klikk på en rad).
  const visibleTenants = useMemo(
    () => tenants.filter((tn) => !(tn.customerType === "b2b" && tn.parentTenant)),
    [tenants],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tenants", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { tenants: TenantRecord[] };
      setTenants(body.tenants);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy) return;
    // Iter 19.9.7 locale-fix: obligatorisk locale-valg også i admin-flyt.
    // Uten dette blir tenant.locale=null og lifecycle-mailer faller til NO.
    if (!createForm.locale) {
      setCreateError(t("admin_tenants.error_locale_required"));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    const payload: Partial<CreateTenantInput> = {
      subdomain: createForm.subdomain.toLowerCase().trim(),
      email: createForm.email.toLowerCase().trim(),
      customerType: createForm.customerType,
      plan: createForm.plan,
      status: createForm.status,
      lifecycleEmails: createForm.lifecycleEmails,
      locale: createForm.locale,
    };
    // Free-plan er evigvarende (D-069) — sender ALDRI trialDays i payload
    // siden backend krever 1-365 og 0/undefined matcher ikke. Plan=free
    // ignorerer trial-feltet i UI også (disabled). For alle andre planer:
    // send trialDays normalt.
    if (createForm.plan !== "free") {
      payload.trialDays = createForm.trialDays;
    }
    if (createForm.firstName.trim()) payload.firstName = createForm.firstName.trim();
    if (createForm.lastName.trim()) payload.lastName = createForm.lastName.trim();
    if (createForm.notes.trim()) payload.notes = createForm.notes.trim();
    if (createForm.customerType === "b2b") {
      const trim = (v: string) => v.trim();
      const set = (key: keyof CreateTenantInput, v: string) => {
        if (v.trim()) (payload as Record<string, unknown>)[key] = trim(v);
      };
      set("companyName", createForm.companyName);
      set("orgNumber", createForm.orgNumber);
      // D-112: vatNumber fjernet — utledes live på server-side ved behov
      set("companyStreet", createForm.companyStreet);
      set("companyPostalCode", createForm.companyPostalCode);
      set("companyCity", createForm.companyCity);
      set("companyCountry", createForm.companyCountry);
      set("contactName", createForm.contactName);
      if (createForm.contactEmail.trim())
        payload.contactEmail = createForm.contactEmail.toLowerCase().trim();
      set("contactPhone", createForm.contactPhone);
      set("billingStreet", createForm.billingStreet);
      set("billingPostalCode", createForm.billingPostalCode);
      set("billingCity", createForm.billingCity);
      set("billingCountry", createForm.billingCountry);
      if (createForm.billingEmail.trim())
        payload.billingEmail = createForm.billingEmail.toLowerCase().trim();
      set("billingReference", createForm.billingReference);
      // adminSubdomain settes automatisk = subdomain av server-rute (Mike 2026-06-02).
      set("tenantPrefix", createForm.tenantPrefix);
      const maxLic = parseInt(createForm.maxLicenses, 10);
      if (Number.isFinite(maxLic) && maxLic > 0) payload.maxLicenses = maxLic;
    }
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 409) {
          setCreateError(t("admin_tenants.error_exists"));
        } else if (body.error === "invalid_subdomain") {
          setCreateError(t("admin_tenants.error_invalid_subdomain"));
        } else if (body.error === "reserved_subdomain") {
          setCreateError(t("admin_tenants.error_reserved"));
        } else if (body.error === "invalid_email") {
          setCreateError(t("admin_tenants.error_invalid_email"));
        } else {
          setCreateError(body.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      // D-067: åpne provisjonerings-tracker-modal som orkestrerer Upstash + Vercel
      setProvisioningSubdomain(payload.subdomain ?? null);
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "create_failed");
    } finally {
      setCreateBusy(false);
    }
  }

  async function onDelete(sub: string) {
    setDeleteBusy(sub);
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(sub)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as
        | DeleteResult
        | { error?: string; detail?: string };

      if (!res.ok) {
        // 409 active_licenses_exist eller andre server-feil — vis i banner.
        const errObj = body as { error?: string; detail?: string };
        if (errObj.error === "active_licenses_exist") {
          setError(t("admin_tenants.delete_active_licenses"));
        } else {
          setError(
            t("admin_tenants.error_delete") +
              ": " +
              (errObj.error ?? `HTTP ${res.status}`),
          );
        }
        setPendingDelete(null);
        return;
      }

      // Vellykket DELETE — vis DeleteResult-modal med stegvis status.
      const result = body as DeleteResult;
      setDeleteResult(result);
      setPendingDelete(null);
      // Hvis sentral DB ble slettet, fjern fra valgt-state og refresh listen.
      if (result.success) {
        if (selected?.subdomain === sub) setSelected(null);
        await refresh();
      }
    } catch (err) {
      setError(
        t("admin_tenants.error_delete") +
          ": " +
          (err instanceof Error ? err.message : "unknown"),
      );
      setPendingDelete(null);
    } finally {
      setDeleteBusy(null);
    }
  }

  async function onUpdateTenant(sub: string, patch: {
    plan?: TenantRecord["plan"];
    status?: TenantRecord["status"];
    lifecycleEmails?: boolean;
    trialEndsAt?: string | null;
    lockedAt?: string | null;
    cancelledAt?: string | null;
    cancelEffectiveAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    deletedAt?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeInvoiceId?: string | null;
    notes?: string | null;
    // Iter 19.9.9 — redigerbare identitets-felter
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
    locale?: "no" | "sv" | "da" | "en" | null;
    createdBy?: string;
  }) {
    try {
      const res = await fetch(`/api/admin/tenants/${encodeURIComponent(sub)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { tenant: TenantRecord };
      // Optimistisk: oppdater både listen og selected.
      setTenants((prev) =>
        prev.map((t) => (t.subdomain === sub ? body.tenant : t)),
      );
      if (selected?.subdomain === sub) setSelected(body.tenant);
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "unknown") + " (update failed)",
      );
    }
  }

  // ─── Render: detail-view ─────────────────────────────────────────────
  if (selected) {
    return (
      <div
        data-testid="tenant-detail-view"
        className="w-full relative"
      >
        <button
          data-testid="tenant-detail-back-btn"
          onClick={() => setSelected(null)}
          className="flex items-center gap-1.5 text-xs text-white/65 hover:text-white mb-5 transition"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t("admin_tenants.back_to_list")}
        </button>
        <div className="relative w-full">
          <div className="max-w-3xl">
            <TenantDetailCard
              record={selected}
              onPatch={(patch) => onUpdateTenant(selected.subdomain, patch)}
              onClose={() => setSelected(null)}
              onRefresh={() => void refresh()}
              logOpen={logOpen}
              setLogOpen={setLogOpen}
              configOpen={configOpen}
              setConfigOpen={setConfigOpen}
            />
          </div>
          {/* Konto-logg-panel — søsken til kortet, absolute right (D-065) */}
          {logOpen && (
            <ProvisioningLogSidePanel
              record={selected}
              onClose={() => setLogOpen(false)}
            />
          )}
          {/* Client-config-panel — søsken til kortet, absolute right */}
          {configOpen && selected.vercelProjectId && (
            <ClientConfigSidePanel
              subdomain={selected.subdomain}
              onClose={() => setConfigOpen(false)}
            />
          )}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            data-testid="tenant-detail-delete-btn"
            variant="destructive"
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => setPendingDelete(selected.subdomain)}
            disabled={deleteBusy === selected.subdomain}
          >
            {t("admin_tenants.delete")}
          </Button>
        </div>

        {/* ConfirmDialog MÅ rendres i detail-view også — ellers utløses ingenting
            ved klikk på Slett-knappen her. */}
        <ConfirmDialog
          open={pendingDelete !== null}
          title={t("admin_tenants.confirm_delete_title")}
          description={
            <span>
              {t("admin_tenants.confirm_delete_desc").replace(
                "{subdomain}",
                pendingDelete ?? "",
              )}
            </span>
          }
          confirmLabel={t("admin_tenants.delete")}
          variant="destructive"
          busy={deleteBusy !== null}
          requireConfirmText={pendingDelete ?? undefined}
          onConfirm={() => {
            if (pendingDelete) void onDelete(pendingDelete);
          }}
          onCancel={() => setPendingDelete(null)}
        />

        {deleteResult && (
          <DeleteResultModal
            result={deleteResult}
            onClose={() => setDeleteResult(null)}
          />
        )}
      </div>
    );
  }

  // ─── Render: liste-view ──────────────────────────────────────────────
  // D-102 flyttet over filteredAndSorted-blokken (D-103d-fix for Rules of Hooks).

  const hasAnyFilter =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    planFilter !== "all" ||
    customerTypeFilter !== "all";

  return (
    <div data-testid="tenant-list-view" className="w-full">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-white/55" data-testid="tenant-count">
          {loading
            ? t("admin_tenants.loading")
            : hasAnyFilter
            ? t("admin_tenants.count_filtered")
                .replace("{n}", String(filteredAndSorted.length))
                .replace("{total}", String(visibleTenants.length))
            : t("admin_tenants.count").replace("{n}", String(visibleTenants.length))}
        </p>
        <div className="flex items-center gap-2">
          <ConfigToolsButton />
          <RateLimitResetButton />
          <Button
            data-testid="tenant-refresh-btn"
            variant="secondary"
            leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />}
            onClick={refresh}
            disabled={loading}
          >
            {t("admin_tenants.refresh")}
          </Button>
          <Button
            data-testid="tenant-create-btn"
            variant="primary"
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              if (defaultCustomerType === "b2b") {
                // Iter 20.7: B2B-tab hopper over TYPE-velgeren og åpner
                // CreateTenantModal direkte med customerType=b2b + 45d trial.
                setCreateForm({
                  ...EMPTY_FORM,
                  customerType: "b2b",
                  trialDays: DEFAULT_TRIAL_DAYS_B2B,
                });
                setCreateError(null);
                setCreateOpen(true);
              } else {
                setCreateChoiceOpen(true);
              }
            }}
          >
            {t("admin_tenants.create_new")}
          </Button>
        </div>
      </div>

      {/* Søk + filter + sortering */}
      <div
        data-testid="tenant-filters"
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <input
            data-testid="tenant-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("admin_tenants.search_placeholder")}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-white/15 text-xs text-white placeholder-white/30 outline-none focus:border-blue-300/60 transition"
          />
        </div>
        <FilterSelect
          testId="tenant-filter-status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "all", label: t("admin_tenants.filter_status_all") },
            { value: "trial", label: "trial" },
            { value: "active", label: "active" },
            { value: "active_expires", label: "active · expires" },
            { value: "locked", label: "locked" },
            { value: "cancelled", label: "cancelled" },
            { value: "deleted", label: "deleted" },
            { value: "pending", label: "pending" },
            { value: "provisioning_failed", label: "provisioning_failed" },
            { value: "invoice_failed", label: "invoice_failed" },
          ]}
          label={t("admin_tenants.filter_status_label")}
        />
        <FilterSelect
          testId="tenant-filter-plan"
          value={planFilter}
          onChange={(v) => setPlanFilter(v as PlanFilter)}
          options={[
            { value: "all", label: t("admin_tenants.filter_plan_all") },
            { value: "trial", label: "trial" },
            { value: "free", label: "free" },
            { value: "monthly", label: "monthly" },
            { value: "yearly", label: "yearly" },
          ]}
          label={t("admin_tenants.filter_plan_label")}
        />
        <FilterSelect
          testId="tenant-filter-customertype"
          value={customerTypeFilter}
          onChange={(v) => setCustomerTypeFilter(v as CustomerTypeFilter)}
          options={[
            { value: "all", label: t("admin_tenants.filter_customertype_all") },
            { value: "b2c", label: "B2C" },
            { value: "b2b", label: "B2B" },
          ]}
          label={t("admin_tenants.filter_customertype_label")}
        />
        <FilterSelect
          testId="tenant-sort"
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          options={[
            { value: "createdAt", label: t("admin_tenants.sort_created_at") },
            { value: "subdomain", label: t("admin_tenants.sort_subdomain") },
          ]}
          label={t("admin_tenants.sort_label")}
        />
        {hasAnyFilter && (
          <button
            data-testid="tenant-filter-reset"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
              setPlanFilter("all");
              setCustomerTypeFilter("all");
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/65 transition"
          >
            {t("admin_tenants.filter_reset")}
          </button>
        )}
      </div>

      {error && (
        <div
          data-testid="tenant-list-error"
          className="mb-4 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && tenants.length === 0 && !error && (
        <div
          data-testid="tenant-empty-state"
          className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 text-center text-sm text-white/55"
        >
          {t("admin_tenants.empty_state")}
        </div>
      )}

      {!loading && tenants.length > 0 && filteredAndSorted.length === 0 && (
        <div
          data-testid="tenant-empty-filtered"
          className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 text-center text-sm text-white/55"
        >
          {t("admin_tenants.empty_filtered")}
        </div>
      )}

      {filteredAndSorted.length > 0 && (
        <ul className="space-y-2" data-testid="tenant-list">
          {filteredAndSorted.map((tn) => (
            <li key={tn.subdomain}>
              <button
                data-testid={`tenant-row-${tn.subdomain}`}
                onClick={() => setSelected(tn)}
                className="w-full text-left rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl hover:bg-white/10 px-4 py-3 transition flex items-center justify-between gap-4 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-nowrap min-w-0">
                    {/* D-110 (Mike 2026-06-28): Rekkefølge på B2B-parent-rad:
                        firmanavn → subdomain → trial-badges → seat-status.
                        For B2C/B2B-children: subdomain først (ingen firmanavn). */}
                    {tn.customerType === "b2b" && !tn.parentTenant ? (
                      <>
                        <span className="text-sm text-white/90 font-medium truncate min-w-0">
                          {tn.companyName || tn.subdomain}
                        </span>
                        <span className="font-mono text-sm text-white/70 flex-shrink-0">
                          {tn.subdomain}
                        </span>
                        <StatusBadge status={tn.status} cancelAtPeriodEnd={tn.cancelAtPeriodEnd} />
                        <PlanBadge plan={tn.plan} />
                        <div className="flex-shrink-0 min-w-[160px] max-w-[260px] ml-auto">
                          <SeatProgressBar
                            activeSeats={tn.activeLicenses ?? 0}
                            pendingSeats={tn.pendingInvitesCount ?? 0}
                            maxSeats={tn.maxLicenses}
                            compact
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-sm text-white flex-shrink-0">
                          {tn.subdomain}
                        </span>
                        <StatusBadge status={tn.status} cancelAtPeriodEnd={tn.cancelAtPeriodEnd} />
                        {/* D-101: B2B-children skjuler plan-badge (arver fra parent) */}
                        {!(tn.customerType === "b2b" && tn.parentTenant) && (
                          <PlanBadge plan={tn.plan} />
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-xs text-white/55 mt-0.5 flex items-center gap-2 flex-wrap">
                    {/* D-107 (2026-06-28): B2B-parent metadata flyttet til topp-
                        linjen (companyName + SeatProgressBar). Her vises kun
                        B2B-children fallback eller B2C-full-info. */}
                    {tn.customerType === "b2b" ? (
                      tn.parentTenant ? (
                        // D-102: B2B-children rendres ikke lenger — defensive fallback
                        <span className="truncate">
                          {t("admin_tenants.employee_under_parent")} {tn.parentTenant}
                        </span>
                      ) : null
                    ) : (
                      // B2C: full info som før
                      <span className="truncate">
                        {[tn.firstName, tn.lastName].filter(Boolean).join(" ") ||
                          tn.email}
                        {" · "}
                        {tn.email}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-white/40 hidden sm:inline">
                    {formatShortDate(tn.createdAt, locale)}
                  </span>
                  <button
                    data-testid={`tenant-row-delete-${tn.subdomain}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDelete(tn.subdomain);
                    }}
                    disabled={deleteBusy === tn.subdomain}
                    className="p-1.5 rounded-md hover:bg-rose-500/20 text-white/40 hover:text-rose-300 transition disabled:opacity-50"
                  >
                    {deleteBusy === tn.subdomain ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {createOpen && (
        <CreateTenantModal
          form={createForm}
          setForm={setCreateForm}
          busy={createBusy}
          error={createError}
          onClose={() => setCreateOpen(false)}
          onSubmit={onCreate}
          /* Iter 20.9 (Mike 2026-06-04): Lås customerType-velgeren basert
             på fanen. B2B-tab → "b2b". B2C-tab (Trial-valg) → "b2c". Hver
             fane skal kun eksponere sin egen tenant-type. */
          lockedCustomerType={defaultCustomerType ?? "b2c"}
        />
      )}

      {provisioningSubdomain && (
        <ProvisioningModal
          subdomain={provisioningSubdomain}
          onClose={() => {
            setProvisioningSubdomain(null);
            void refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("admin_tenants.confirm_delete_title")}
        description={
          <span>
            {t("admin_tenants.confirm_delete_desc").replace(
              "{subdomain}",
              pendingDelete ?? "",
            )}
          </span>
        }
        confirmLabel={t("admin_tenants.delete")}
        variant="destructive"
        busy={deleteBusy !== null}
        requireConfirmText={pendingDelete ?? undefined}
        onConfirm={() => {
          if (pendingDelete) void onDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {deleteResult && (
        <DeleteResultModal
          result={deleteResult}
          onClose={() => setDeleteResult(null)}
        />
      )}

      {createChoiceOpen && (
        <CreateChoiceModal
          onClose={() => setCreateChoiceOpen(false)}
          onSelectTrial={() => {
            setCreateChoiceOpen(false);
            setCreateForm(EMPTY_FORM);
            setCreateError(null);
            setCreateOpen(true);
          }}
          onSelectPaymentLink={() => {
            setCreateChoiceOpen(false);
            setPaymentLinkOpen(true);
          }}
        />
      )}

      <PaymentLinkModal
        open={paymentLinkOpen}
        onClose={() => setPaymentLinkOpen(false)}
        onCreated={() => void refresh()}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  cancelAtPeriodEnd = false,
}: {
  status: TenantRecord["status"];
  /**
   * Iter 19.7: når true (og status=active) viser vi "ACTIVE · EXPIRES" i
   * amber for å signalisere at abonnementet er kansellert ved periodens
   * slutt — fortsatt aktivt nå, men utløper på `cancelEffectiveAt`.
   */
  cancelAtPeriodEnd?: boolean;
}) {
  const palette: Record<TenantRecord["status"], string> = {
    active: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    trial: "bg-amber-500/15 text-amber-300 border-amber-400/30",
    locked: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    suspended: "bg-orange-500/15 text-orange-300 border-orange-400/30",
    cancelled: "bg-white/10 text-white/55 border-white/20",
    deleted: "bg-white/5 text-white/30 border-white/10",
    pending: "bg-sky-500/15 text-sky-300 border-sky-400/30",
    provisioning_failed:
      "bg-rose-500/15 text-rose-300 border-rose-400/30",
    invoice_failed: "bg-rose-500/15 text-rose-300 border-rose-400/30",
  };
  // Når active + cancel-pending → amber, bytt label til ACTIVE · EXPIRES
  const showExpiring = cancelAtPeriodEnd && status === "active";
  const cls = showExpiring
    ? "bg-amber-500/15 text-amber-300 border-amber-400/30"
    : palette[status];
  const label = showExpiring ? "active · expires" : status;
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}

function PlanBadge({ plan }: { plan: TenantRecord["plan"] }) {
  // Fargekoder per plan så de er lett gjenkjennelige i tenant-listen.
  const tone =
    plan === "yearly"
      ? "bg-violet-500/10 text-violet-300 border-violet-400/30"
      : plan === "monthly"
        ? "bg-sky-500/10 text-sky-300 border-sky-400/30"
        : plan === "trial"
          ? "bg-amber-500/10 text-amber-300 border-amber-400/30"
          : "bg-slate-500/10 text-slate-300 border-slate-400/25"; // free
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${tone}`}
    >
      {plan}
    </span>
  );
}

/**
 * Modal som viser steg-for-steg-status av en kaskade-sletting (DeleteResult).
 * Vises etter at DELETE /api/admin/tenants/[subdomain] har returnert.
 * Bruker glass-arkitektur + samme z-index-mønster som ConfirmDialog.
 */
function DeleteResultModal({
  result,
  onClose,
}: {
  result: DeleteResult;
  onClose: () => void;
}) {
  const { t } = useLocale();

  const titleKey = result.success
    ? result.errors.length === 0
      ? "admin_tenants.delete_result_title"
      : "admin_tenants.delete_result_partial"
    : "admin_tenants.delete_result_failed";

  const titleTone = result.success
    ? result.errors.length === 0
      ? "text-emerald-300"
      : "text-amber-300"
    : "text-rose-300";

  const stepRows: { labelKey: string; status: DeleteResult["steps"][keyof DeleteResult["steps"]] }[] = [
    {
      labelKey: "admin_tenants.delete_step_vercel",
      status: result.steps.vercel,
    },
    {
      labelKey: "admin_tenants.delete_step_upstash",
      status: result.steps.upstash,
    },
    {
      labelKey: "admin_tenants.delete_step_client_config",
      status: result.steps.clientConfig,
    },
    {
      labelKey: "admin_tenants.delete_step_stripe",
      status: result.steps.stripe,
    },
    {
      labelKey: "admin_tenants.delete_step_central_db",
      status: result.steps.centralDb,
    },
    {
      labelKey: "admin_tenants.delete_step_b2b_prefix",
      status: result.steps.b2bPrefix,
    },
  ];

  return (
    <div
      data-testid="delete-result-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl">
        <div className="p-5 border-b border-white/10 flex items-start justify-between gap-3">
          <h3
            data-testid="delete-result-title"
            className={`text-base font-medium ${titleTone}`}
          >
            {t(titleKey)}
          </h3>
          <button
            data-testid="delete-result-close-icon"
            onClick={onClose}
            className="text-white/55 hover:text-white transition"
            aria-label={t("admin_tenants.delete_result_close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {stepRows.map((row) => (
            <div
              key={row.labelKey}
              data-testid={`delete-step-${row.labelKey.split(".").pop()}`}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-white/75">{t(row.labelKey)}</span>
              <StepStatusBadge status={row.status} />
            </div>
          ))}

          {result.errors.length > 0 && (
            <div
              data-testid="delete-result-errors"
              className="mt-4 pt-4 border-t border-white/10 space-y-1"
            >
              {result.errors.map((err, i) => (
                <div
                  key={i}
                  className="text-xs text-rose-300/85 font-mono break-all"
                >
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-white/10 flex justify-end">
          <Button
            data-testid="delete-result-close-btn"
            onClick={onClose}
            variant="secondary"
          >
            {t("admin_tenants.delete_result_close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepStatusBadge({
  status,
}: {
  status: DeleteResult["steps"][keyof DeleteResult["steps"]];
}) {
  const { t } = useLocale();
  const palette = {
    ok: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    failed: "bg-rose-500/15 text-rose-300 border-rose-400/30",
    skipped: "bg-white/5 text-white/45 border-white/15",
    // Iter 17 (D-070-revisjon): Stripe customer bevart for betalt tenant.
    // Bruker amber for å signalisere "bevisst valg, ikke feil".
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

/**
 * Iter 14.8: tre-valgs-modal for "Ny tenant".
 * Tre kort: Trial (gratis 30d), Send betalingslink, B2B-bedrift (info).
 */
function CreateChoiceModal({
  onClose,
  onSelectTrial,
  onSelectPaymentLink,
}: {
  onClose: () => void;
  onSelectTrial: () => void;
  onSelectPaymentLink: () => void;
}) {
  return (
    <div
      data-testid="create-choice-modal"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <h3
            data-testid="create-choice-title"
            className="text-base font-semibold tracking-tight text-white"
          >
            Hva slags tenant?
          </h3>
          <button
            data-testid="create-choice-close"
            onClick={onClose}
            className="text-white/55 hover:text-white"
            aria-label="Lukk"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          <ChoiceCard
            testid="choice-trial"
            icon={<Plus className="h-4 w-4 text-emerald-300" />}
            iconBg="bg-emerald-500/15 border-emerald-400/30"
            title="Trial (gratis i 30 dager)"
            body="Privatkunde, ingen kortinfo. Auto-provisjoneres nå. Ber om kortinfo etter 25 dager."
            onClick={onSelectTrial}
          />
          <ChoiceCard
            testid="choice-payment-link"
            icon={<MailIcon className="h-4 w-4 text-amber-300" />}
            iconBg="bg-amber-500/15 border-amber-400/30"
            title="Send betalingslink"
            body="Du sender en Stripe Checkout-link til kunden. Vault auto-provisjoneres når de betaler."
            onClick={onSelectPaymentLink}
          />
          {/* Iter 20.9 (Mike 2026-06-04): B2B-hint-kortet fjernet fra B2C-flyten.
              B2C-fanen skal kun vise B2C-valg — samme prinsipp som B2B-fanen
              kun viser B2B. Bedriftsregistrering tilgjengelig fra "Bedrifter"-
              fanen øverst (eget skjema). */}
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({
  testid,
  icon,
  iconBg,
  title,
  body,
  onClick,
  disabled,
}: {
  testid: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  body: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base =
    "w-full text-left rounded-xl border p-4 flex items-start gap-3 transition";
  const interactive = disabled
    ? "border-white/10 bg-white/[0.02] opacity-60 cursor-not-allowed"
    : "border-white/15 bg-white/[0.04] hover:border-white/30 hover:bg-white/[0.07] cursor-pointer";
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${interactive}`}
    >
      <div className={`rounded-full border p-2 shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-white/55 mt-0.5 leading-relaxed">
          {body}
        </div>
      </div>
    </button>
  );
}





function TenantDetailCard({
  record,
  onPatch,
  onClose,
  onRefresh,
  logOpen,
  setLogOpen,
  configOpen,
  setConfigOpen,
}: {
  record: TenantRecord;
  onPatch: (patch: {
    plan?: TenantRecord["plan"];
    status?: TenantRecord["status"];
    lifecycleEmails?: boolean;
    trialEndsAt?: string | null;
    lockedAt?: string | null;
    cancelledAt?: string | null;
    cancelEffectiveAt?: string | null;
    cancelAtPeriodEnd?: boolean;
    deletedAt?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeInvoiceId?: string | null;
    notes?: string | null;
    // Iter 19.9.9 — redigerbare identitets-felter
    firstName?: string | null;
    lastName?: string | null;
    email?: string;
    locale?: "no" | "sv" | "da" | "en" | null;
    createdBy?: string;
  }) => void | Promise<void>;
  onClose: () => void;
  onRefresh: () => void;
  logOpen: boolean;
  setLogOpen: Dispatch<SetStateAction<boolean>>;
  configOpen: boolean;
  setConfigOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useLocale();
  // Iter 7 (revidert per Mike 2026-06-02): vis felter strukturert per
  // customerType. B2C skjuler B2B-feltene, men viser ALLTID Stripe +
  // provisjonering + lifecycle-datoer + notes (også når undefined → "(ikke satt)").
  type Fields = readonly (keyof TenantRecord)[];

  const BASE_FIELDS_B2C: Fields = [
    "customerType",
    // Iter 19.9.9: firstName/lastName/email/locale/createdBy nå redigerbare
    // i Identitet-seksjonen — fjernes fra read-only-listen.
    "createdAt",
    "trialEndsAt",
    "configGenerated",
    // Stripe (D-049 — just-in-time, normalt undefined for trial)
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripeInvoiceId",
    // Provisjonering (Iter 8-9 — undefined inntil ferdig)
    "vercelProjectId",
    "upstashDatabaseId",
    // Lifecycle-datoer (undefined inntil de skjer)
    "lockedAt",
    "cancelledAt",
    "cancelEffectiveAt",
    "deletedAt",
    "notes",
  ];

  const BASE_FIELDS_B2B: Fields = [
    "customerType",
    "companyName",
    "orgNumber",
    // D-112: vatNumber fjernet
    "companyStreet",
    "companyPostalCode",
    "companyCity",
    "companyCountry",
    "contactName",
    "contactEmail",
    "contactPhone",
    "billingStreet",
    "billingPostalCode",
    "billingCity",
    "billingCountry",
    "billingEmail",
    "billingReference",
    "adminSubdomain",
    "tenantPrefix",
    "maxLicenses",
    "activeLicenses",
    "parentTenant",
    // Iter 19.9.9: locale/createdBy nå redigerbare — fjernes fra read-only.
    "createdAt",
    "trialEndsAt",
    "configGenerated",
    "stripeCustomerId",
    "stripeSubscriptionId",
    "stripeInvoiceId",
    "vercelProjectId",
    "upstashDatabaseId",
    "lockedAt",
    "cancelledAt",
    "cancelEffectiveAt",
    "deletedAt",
    "notes",
  ];

  const fields = useMemo<Fields>(() => {
    return record.customerType === "b2b" ? BASE_FIELDS_B2B : BASE_FIELDS_B2C;
  }, [record.customerType]);

  // D-096 (2026-06-28) — Tab-refactor av TenantDetailCard
  // D-107 (2026-06-28, Mike): Nivå 1 = hode-tabs (Oversikt / Lisens & B2B /
  // Stripe & Fakturaer / System). Nivå 2 = under-tabs synlige kun når
  // "Oversikt" er aktiv (Selskap / Kontakt / Plan & Kommunikasjon /
  // Faktura-adresse). "Firmadata"-fanen (kortvarig D-106-eksperiment)
  // fjernet — innholdet bor nå som nivå-2 "Selskap".
  type Tab = "oversikt" | "lisens" | "fakturering" | "system";
  type OversiktSubTab =
    | "selskap"
    | "kontakt"
    | "plan-kommunikasjon"
    | "faktura-adresse";
  const isB2BParent =
    record.customerType === "b2b" && record.parentTenant === null;
  const [activeTab, setActiveTab] = useState<Tab>("oversikt");
  const [oversiktSubTab, setOversiktSubTab] = useState<OversiktSubTab>(
    isB2BParent ? "selskap" : "plan-kommunikasjon",
  );

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "oversikt", label: "Oversikt", show: true },
    { id: "lisens", label: "Lisens & B2B", show: isB2BParent },
    { id: "fakturering", label: "Stripe & Fakturaer", show: true },
    { id: "system", label: "System", show: true },
  ];

  // Nivå-2 under-tabs (kun under "Oversikt"). For ikke-B2B vises kun
  // "Plan & Kommunikasjon" (de andre er B2B-spesifikke).
  const oversiktSubTabs: { id: OversiktSubTab; label: string; show: boolean }[] =
    [
      { id: "selskap", label: "Selskap", show: isB2BParent },
      { id: "kontakt", label: "Kontakt", show: isB2BParent },
      { id: "plan-kommunikasjon", label: "Plan & Kommunikasjon", show: true },
      { id: "faktura-adresse", label: "Faktura-adresse", show: isB2BParent },
    ];
  return (
    <div
      data-testid="tenant-detail-card"
      className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5"
    >
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* D-110 (Mike 2026-06-28): For B2B-parent — firmanavn FØRST,
                deretter subdomain, deretter status/plan-badges. Samme
                rekkefølge som tenant-list-raden. */}
            {record.customerType === "b2b" &&
              record.parentTenant === null &&
              record.companyName && (
                <span
                  data-testid="tenant-detail-companyname"
                  className="text-base text-white/95 font-medium truncate"
                >
                  {record.companyName}
                </span>
              )}
            <h2
              className="font-mono text-base text-white/75 truncate flex-shrink-0"
              data-testid="tenant-detail-subdomain"
            >
              {record.subdomain}
            </h2>
            <StatusBadge status={record.status} cancelAtPeriodEnd={record.cancelAtPeriodEnd} />
            <PlanBadge plan={record.plan} />
            {record.vaultLive && (
              <span
                data-testid="tenant-detail-vault-live"
                className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
                title={record.vaultLiveAt ?? undefined}
              >
                vault live
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="tenant-detail-close-btn"
            onClick={onClose}
            aria-label={t("admin_tenants.back_to_list")}
            title={t("admin_tenants.back_to_list")}
            className="flex-shrink-0 p-1.5 rounded-md hover:bg-white/10 text-white/55 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          <ResendWelcomeButton subdomain={record.subdomain} compact />
          {record.stripeCustomerId && (
            <SyncStripeButton
              subdomain={record.subdomain}
              onSynced={onRefresh}
            />
          )}
          {(record.status === "trial" ||
            record.status === "locked" ||
            record.status === "pending") && (
            <TestCheckoutButton subdomain={record.subdomain} />
          )}
          {record.vercelProjectId && (
            <button
              type="button"
              data-testid="tenant-client-config-toggle"
              onClick={() => {
                if (!configOpen) setLogOpen(false);
                setConfigOpen(!configOpen);
              }}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                configOpen
                  ? "bg-sky-500 text-black hover:bg-sky-400"
                  : "bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 border border-sky-400/30"
              }`}
            >
              ⚙️ {configOpen ? "Skjul client-config" : "Vis client-config"}
            </button>
          )}
          <button
            type="button"
            data-testid="tenant-provisioning-log-toggle"
            onClick={() => {
              setLogOpen((s) => {
                if (!s) setConfigOpen(false);
                return !s;
              });
            }}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
              logOpen
                ? "bg-amber-500 text-black hover:bg-amber-400"
                : "bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 border border-amber-400/30"
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            {logOpen ? "Skjul konto-logg" : "Vis konto-logg"}
            <span className="text-[10px] opacity-70">
              ({(record.provisioningLog ?? []).length})
            </span>
          </button>
        </div>
      </div>
      {/* D-106 (2026-06-28, Mike): teknisk tagline flyttet til footer for
          å redusere visuell støy øverst. Skal ikke konkurrere med tab-nav. */}

      {/* D-096: Tab-nav */}
      <div
        data-testid="tenant-detail-tabs"
        className="flex items-center gap-1 mb-5 border-b border-white/10 -mx-5 px-5"
      >
        {tabs
          .filter((tt) => tt.show)
          .map((tt) => {
            const active = activeTab === tt.id;
            return (
              <button
                key={tt.id}
                type="button"
                data-testid={`tenant-detail-tab-${tt.id}`}
                onClick={() => setActiveTab(tt.id)}
                className={`px-3 py-2 text-xs font-medium transition border-b-2 -mb-px ${
                  active
                    ? "text-amber-200 border-amber-400"
                    : "text-white/55 border-transparent hover:text-white/85"
                }`}
              >
                {tt.label}
              </button>
            );
          })}
      </div>

      {/* D-107 (2026-06-28, Mike) / D-108 (gjenbrukbar SubTabNav): Nivå-2
          sub-tab-nav — vises kun når Oversikt er aktiv. For ikke-B2B vises
          kun "Plan & Kommunikasjon"-fanen (de andre er B2B-spesifikke). */}
      {activeTab === "oversikt" && (
        <SubTabNav
          items={oversiktSubTabs}
          active={oversiktSubTab}
          onChange={setOversiktSubTab}
          testIdPrefix="tenant-detail-oversikt-subtab"
          className="-mt-1"
        />
      )}

      {/* ═══ TAB 1: OVERSIKT ═══════════════════════════════════════ */}
      {activeTab === "oversikt" && oversiktSubTab === "plan-kommunikasjon" && (
        <>
          {/* Inline-editerbare felt: plan + status + lifecycle */}
          <div
            data-testid="tenant-detail-editable"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 pb-5 border-b border-white/10"
          >
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">plan</span>
          <DarkSelect
            testId="tenant-detail-plan-select"
            value={record.plan}
            onChange={(v) => void onPatch({ plan: v as TenantRecord["plan"] })}
            options={
              // D-129 (2026-02 · Mike): B2B parent-tenants skal kun se B2B-
              // plan-options i detail-card-ens dropdown. Tidligere viste den
              // alltid B2C-listen (trial/free/monthly/yearly) — så Mike kunne
              // ikke endre `mm-admin` til `b2b_yearly` via UI uten DB-edit.
              record.customerType === "b2b" && record.parentTenant === null
                ? getB2BPlanOptions(t)
                : PLAN_OPTIONS
            }
          />
          {record.plan === "free" && (
            <span
              data-testid="tenant-detail-free-plan-hint"
              className="text-[10px] text-emerald-300/85 mt-1"
              title="Free-plan er beskyttet mot auto-lock/cancel/delete"
            >
              🛡️ Evigvarende — beskyttet mot livssyklus-cron
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">status</span>
          <DarkSelect
            testId="tenant-detail-status-select"
            value={record.status}
            onChange={(v) => void onPatch({ status: v as TenantRecord["status"] })}
            options={STATUS_OPTIONS}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
            lifecycle emails
          </span>
          <label className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-black/40 border border-white/15 cursor-pointer hover:border-white/25 transition">
            <input
              type="checkbox"
              data-testid="tenant-detail-lifecycle-checkbox"
              checked={record.emailPreferences.lifecycle}
              onChange={(e) =>
                void onPatch({ lifecycleEmails: e.target.checked })
              }
              className="h-4 w-4 accent-blue-500"
            />
            <span className="text-sm text-white/85">
              {record.emailPreferences.lifecycle
                ? t("admin_tenants.lifecycle_on")
                : t("admin_tenants.lifecycle_off")}
            </span>
          </label>
        </label>
      </div>
      </>
      )}

      {/* ═══ TAB 3: FAKTURERING — Lifecycle-datoer ═════════════════ */}
      {activeTab === "fakturering" && (
        <>
      {/* Lifecycle-datoer — D-054 admin-overstyring */}
      <div
        data-testid="tenant-detail-dates"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 pb-5 border-b border-white/10"
      >
        <DateEditor
          label="trialEndsAt"
          value={record.trialEndsAt}
          testId="tenant-detail-trial-ends-at"
          nullable={false}
          onSave={(v) => onPatch({ trialEndsAt: v })}
        />
        <DateEditor
          label="lockedAt"
          value={record.lockedAt}
          testId="tenant-detail-locked-at"
          nullable
          onSave={(v) => onPatch({ lockedAt: v })}
        />
        <DateEditor
          label="cancelledAt"
          value={record.cancelledAt}
          testId="tenant-detail-cancelled-at"
          nullable
          onSave={(v) => onPatch({ cancelledAt: v })}
        />
        <DateEditor
          label="cancelEffectiveAt"
          value={record.cancelEffectiveAt}
          testId="tenant-detail-cancel-effective-at"
          nullable
          onSave={(v) => onPatch({ cancelEffectiveAt: v })}
        />
        <DateEditor
          label="deletedAt"
          value={record.deletedAt}
          testId="tenant-detail-deleted-at"
          nullable
          onSave={(v) => onPatch({ deletedAt: v })}
        />
      </div>

      {/* Iter 19.9.9 — redigerbare identitets-felter. Audit-log via
          buildAuditLines i PATCH-ruten (appendes til provisioningLog
          som stage:"admin_override"). */}
      </>
      )}

      {/* ═══ TAB 1 (forts.): OVERSIKT — Identity + Notes ════════════ */}
      {activeTab === "oversikt" && oversiktSubTab === "plan-kommunikasjon" && (
        <>
      <div
        data-testid="tenant-detail-identity"
        className="space-y-2 mb-5 pb-5 border-b border-white/10"
      >
        <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-2">
          Identitet &amp; kommunikasjon
        </div>
        {/* D-104 (2026-06-28): firstName/lastName er personnavn-felter for
            B2C. For B2B er dette ikke kundens navn (firma = companyName,
            kontaktperson = contactName). Skjul disse for B2B-parents for å
            unngå forvirring. */}
        {!isB2BParent && (
          <>
            <StringEditor
              label="firstName"
              placeholder="Fornavn"
              value={record.firstName}
              testId="tenant-detail-firstname"
              onSave={(v) => onPatch({ firstName: v })}
            />
            <StringEditor
              label="lastName"
              placeholder="Etternavn"
              value={record.lastName}
              testId="tenant-detail-lastname"
              onSave={(v) => onPatch({ lastName: v })}
            />
          </>
        )}
        <StringEditor
          label="email"
          placeholder="kunde@example.com"
          value={record.email}
          testId="tenant-detail-email"
          nullable={false}
          onSave={(v) => {
            if (v !== null) onPatch({ email: v });
          }}
        />
        <LocaleSelectEditor
          value={record.locale}
          testId="tenant-detail-locale"
          onSave={(v) => onPatch({ locale: v })}
        />
        <StringEditor
          label="createdBy"
          placeholder="admin / self / invite (eller fritekst)"
          value={record.createdBy}
          testId="tenant-detail-createdby"
          nullable={false}
          onSave={(v) => {
            if (v !== null) onPatch({ createdBy: v });
          }}
        />
      </div>
      </>
      )}

      {/* D-107 (2026-06-28, Mike): Firmadata-fanen fjernet — innholdet bor
          nå som nivå-2 under-tab "Selskap" / "Kontakt" / "Faktura-adresse"
          under hode-tab "Oversikt". Se sub-tab-nav lenger opp i tab 1. */}

      {/* ═══ TAB 1 sub: SELSKAP (kun B2B-parent) ════════════════════ */}
      {activeTab === "oversikt" &&
        oversiktSubTab === "selskap" &&
        isB2BParent && (
          <div data-testid="tenant-detail-subtab-selskap">
            <CompanyDataSection
              mode="edit"
              record={record}
              subdomain={record.subdomain}
              onRefresh={onRefresh}
              section="selskap"
            />
          </div>
        )}

      {/* ═══ TAB 1 sub: KONTAKT (kun B2B-parent) ════════════════════ */}
      {activeTab === "oversikt" &&
        oversiktSubTab === "kontakt" &&
        isB2BParent && (
          <div data-testid="tenant-detail-subtab-kontakt">
            <CompanyDataSection
              mode="edit"
              record={record}
              subdomain={record.subdomain}
              onRefresh={onRefresh}
              section="kontakt"
            />
          </div>
        )}

      {/* ═══ TAB 1 sub: FAKTURA-ADRESSE (kun B2B-parent) ═══════════ */}
      {activeTab === "oversikt" &&
        oversiktSubTab === "faktura-adresse" &&
        isB2BParent && (
          <div data-testid="tenant-detail-subtab-faktura">
            <CompanyDataSection
              mode="edit"
              record={record}
              subdomain={record.subdomain}
              onRefresh={onRefresh}
              section="faktura"
            />
          </div>
        )}

      {/* ═══ TAB 3 (forts.): FAKTURERING — Stripe + Provisioning ═════ */}
      {activeTab === "fakturering" && (
        <>
      <div
        data-testid="tenant-detail-stripe"
        className="space-y-2 mb-5 pb-5 border-b border-white/10"
      >
        <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-2">
          Stripe
        </div>
        <StringEditor
          label="stripeCustomerId"
          placeholder="cus_..."
          value={record.stripeCustomerId}
          testId="tenant-detail-stripe-customer"
          onSave={(v) => onPatch({ stripeCustomerId: v })}
        />
        <StringEditor
          label="stripeSubscriptionId"
          placeholder="sub_..."
          value={record.stripeSubscriptionId}
          testId="tenant-detail-stripe-subscription"
          onSave={(v) => onPatch({ stripeSubscriptionId: v })}
        />
        <StringEditor
          label="stripeInvoiceId"
          placeholder="in_..."
          value={record.stripeInvoiceId}
          testId="tenant-detail-stripe-invoice"
          onSave={(v) => onPatch({ stripeInvoiceId: v })}
        />
      </div>

      {/* Provisjonering (D-055) — manuell retry når automatisk feilet
          eller når et felt fortsatt er null. */}
      <ProvisionRow record={record} />
      {/* Konto-logg + Client-config-paneler rendres som søsken i parent-layout */}
      </>
      )}

      {/* ═══ TAB 1 (forts.): OVERSIKT — Notes ══════════════════════ */}
      {activeTab === "oversikt" && (
        <>
      {/* Notes editor — fritekst med audit-log appendet automatisk av server */}
      <div className="mb-5 pb-5 border-b border-white/10">
        <NotesEditor
          value={record.notes}
          onSave={(v) => onPatch({ notes: v })}
        />
      </div>
      </>
      )}

      {/* ═══ TAB 2: LISENS & B2B ════════════════════════════════════ */}
      {activeTab === "lisens" && isB2BParent && (
        <>
      {/* D-107 (Mike 2026-06-28): Live seat-teller (full størrelse) på toppen
          av Lisens-fanen. Header har IKKE seat-bar — kun her. */}
      <div className="mb-5">
        <SeatProgressBar
          activeSeats={record.activeLicenses ?? 0}
          pendingSeats={record.pendingInvitesCount ?? 0}
          maxSeats={record.maxLicenses}
        />
      </div>

      {/* am-admin-konto opprettelse — kun for B2B med tenantPrefix (Iter 20.2 / D-078) */}
      {record.customerType === "b2b" && record.tenantPrefix && (
        <CreateOrgAdminCard
          subdomain={record.subdomain}
          tenantPrefix={record.tenantPrefix}
          hasExistingSuperAdmin={(record.provisioningLog ?? []).some(
            (ev) => ev.stage === "org_admin_created",
          )}
        />
      )}

      {/* Invitasjoner — D-078 (2026-06-28): Super-admin SKAL IKKE se ansatt-
          invites (epost, navn, token). All invite-håndtering skjer i B2B-
          Konsoll (`<prefix>-admin.kodovault.no`). Mike-admin ser kun
          aggregerte lisens-tellere (active + pending / max) på tenant-raden. */}
      </>
      )}

      {/* ═══ TAB 3 (forts.): FAKTURERING — Send faktura ═════════ */}
      {activeTab === "fakturering" && (
        <>
      {/* Send faktura — kun for B2B-parents med Stripe customer (Iter 20.4f / D-080) */}
      {record.customerType === "b2b" && record.parentTenant === null && (
        <SendTestInvoiceCard
          subdomain={record.subdomain}
          customerType={record.customerType}
          parentTenant={record.parentTenant}
          stripeCustomerId={record.stripeCustomerId}
          maxLicenses={record.maxLicenses}
          contactEmail={record.contactEmail || record.email}
        />
      )}

      {/* D-139/D-141: fakturahistorikk for alle tenants som har stripeCustomerId
          (B2C + B2B parents). B2B children følger parents fakturaer. */}
      {record.parentTenant === null && record.stripeCustomerId && (
        <InvoiceHistoryCard
          endpoint={`/api/admin/tenants/${record.subdomain}/invoices`}
          stripeCustomerId={record.stripeCustomerId}
        />
      )}
      </>
      )}

      {/* ═══ TAB 4: SYSTEM — read-only field dump ═══════════════════ */}
      {activeTab === "system" && (
      <details
        data-testid="tenant-detail-system-raw"
        className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
        open
      >
        <summary className="text-[10px] uppercase tracking-wide text-white/55 font-mono cursor-pointer hover:text-white/85 transition">
          Rå felter ({fields.length})
        </summary>
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
        {fields.map((k) => {
          const v = record[k];
          const isEmpty = v === undefined || v === null || v === "";
          return (
            <div key={k} className="flex flex-col">
              <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                {k}
              </dt>
              <dd
                className={`break-all ${
                  isEmpty ? "text-white/30 italic" : "text-white/85"
                }`}
              >
                {isEmpty
                  ? t("admin_tenants.field_not_set")
                  : typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v)}
              </dd>
            </div>
          );
        })}
        </dl>
      </details>
      )}

      {/* D-106 (2026-06-28): teknisk tagline i footer — diskret hint om
          lagring, uten å distrahere fra tab-innhold. */}
      <p
        data-testid="tenant-detail-footer-tagline"
        className="text-[10px] text-white/30 mt-6 pt-3 border-t border-white/5 font-mono"
      >
        {t("admin_tenants.detail_intro")}
      </p>
    </div>
  );
}

/**
 * Ko | Do · Vault — D-104 (2026-06-28) — CompanyDataSection
 *
 * Tre seksjoner (Selskap / Kontakt / Fakturering) for B2B-tenant-data,
 * redigerbare i Oversikt-fanen av TenantViewer. Hver seksjon har egen
 * "Lagre"-knapp som PATCH'er kun de endrede feltene.
 *
 * - Selskap-seksjonen: orgNumber-endring viser rød bekreftelses-modal
 *   (org.nr endres sjelden men det skjer ved fusjon eller feilretting).
 * - Fakturering-seksjonen: "Samme som selskap"-checkbox auto-mirror-er
 *   adresse-feltene (samme mønster som CreateTenantForm step 2).
 * - PATCH-endepunktet auto-syncer til Stripe Customer hvis stripeCustomerId
 *   er satt (D-104 backend-implementasjon).
 *
 * For nå brukes komponenten kun i edit-mode. Senere iterasjon kan refaktorere
 * CreateTenantForm step 2 til å gjenbruke samme felt-definisjoner (D-104b).
 */
function nullToEmpty(v: string | null | undefined): string {
  return v ?? "";
}
function emptyToNull(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

// ═══════════════════════════════════════════════════════════════════════
// D-104b — Felles felt-blokker brukt av både edit- og create-mode i
// CompanyDataSection. D-105: én sannhetskilde, ingen duplisering.
// ═══════════════════════════════════════════════════════════════════════

type SelskapBlockValues = {
  companyName: string;
  orgNumber: string;
  companyStreet: string;
  companyPostalCode: string;
  companyCity: string;
  companyCountry: string;
};

type KontaktBlockValues = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

type FakturaBlockValues = {
  billingStreet: string;
  billingPostalCode: string;
  billingCity: string;
  billingCountry: string;
  billingEmail: string;
  billingReference: string;
};

type BlockMode = "edit" | "create";

/** Felles tekst-prefiks for testId-er — preserverer eksisterende testIds
 *  så Mike's eksisterende E2E-tester ikke brekker. */
function blockTestIds(mode: BlockMode) {
  return {
    /** Brukes som testId-prop til B2BField (som internt prefikser med "tenant-create-"). */
    b2bField: mode === "edit" ? "edit-" : "",
    /** Brukes som testId til raw Field-komponenter (uten B2BField-wrapping). */
    field: mode === "edit" ? "tenant-edit" : "tenant-create",
  } as const;
}

function fullSpanClass(mode: BlockMode): string {
  // Edit-modal har responsiv 1-col-mobile/2-col-sm grid. Create-modal har
  // alltid 2-col grid (ikke responsiv). Klassene må matche parent.
  return mode === "edit" ? "col-span-1 sm:col-span-2" : "col-span-2";
}

function SelskapFieldsBlock({
  values,
  onChange,
  mode,
  orgValidation,
}: {
  values: SelskapBlockValues;
  onChange: (next: SelskapBlockValues) => void;
  mode: BlockMode;
  orgValidation: OrgValidationResult;
}) {
  const { t } = useLocale();
  const ids = blockTestIds(mode);
  const fullSpan = fullSpanClass(mode);

  // D-112: utledet MVA (read-only-display under orgNumber)
  const derivedVat =
    orgValidation.valid && values.orgNumber.trim().length > 0
      ? deriveVatNumber(values.companyCountry, values.orgNumber)
      : null;

  // Postnr→poststed live autofill (NO/DK, debounced). D-105: delt hook.
  usePostnrAutofill({
    country: values.companyCountry,
    postnr: values.companyPostalCode,
    setCity: (city) => onChange({ ...values, companyCity: city }),
  });

  return (
    <>
      <B2BField
        labelKey="admin_tenants.field_company_name"
        testId={`${ids.b2bField}companyname`}
        className={fullSpan}
        value={values.companyName}
        onChange={(v) => onChange({ ...values, companyName: v })}
      />
      <Field
        label={t("admin_tenants.field_org_number")}
        testId={`${ids.field}-orgnumber`}
        hint={
          values.orgNumber.length > 0 && !orgValidation.valid
            ? t(orgValidation.reason)
            : undefined
        }
        render={
          <div className="relative">
            <input
              type="text"
              value={values.orgNumber}
              onChange={(e) =>
                onChange({ ...values, orgNumber: e.target.value })
              }
              data-testid={`${ids.field}-orgnumber-input`}
              className={`w-full rounded-lg bg-black/40 border px-3 py-2 pr-8 text-sm text-white outline-none transition ${
                values.orgNumber.length > 0 && !orgValidation.valid
                  ? "border-rose-400/60 focus:border-rose-300"
                  : values.orgNumber.length > 0 && orgValidation.valid
                    ? "border-emerald-400/60 focus:border-emerald-300"
                    : "border-white/15 focus:border-blue-300/60"
              }`}
            />
            {values.orgNumber.length > 0 && orgValidation.valid && (
              <span
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-300 text-base font-bold pointer-events-none"
                aria-hidden="true"
                data-testid={
                  mode === "create"
                    ? "tenant-create-orgnumber-valid-icon"
                    : undefined
                }
              >
                ✓
              </span>
            )}
          </div>
        }
      />
      {/* D-112: Utledet MVA-nr (read-only). Vises kun når orgNumber er
          gyldig OG landet er støttet (NO/DK/SE). Ren visning — Stripe
          tax_id-sync skjer separat ved JIT-customer-create. */}
      {derivedVat && (
        <Field
          label={t("admin_tenants.field_derived_vat")}
          testId={`${ids.field}-derived-vat`}
          className={fullSpan}
          render={
            <div
              data-testid={`${ids.field}-derived-vat-value`}
              className="w-full rounded-lg bg-emerald-500/5 border border-emerald-400/20 px-3 py-2 text-sm text-emerald-200/90 font-mono"
            >
              {derivedVat}
              <span className="ml-2 text-[10px] text-white/40 font-sans uppercase tracking-wide">
                {t("admin_tenants.derived_vat_hint")}
              </span>
            </div>
          }
        />
      )}
      <B2BField
        labelKey="admin_tenants.field_company_street"
        testId={`${ids.b2bField}company-street`}
        className={fullSpan}
        value={values.companyStreet}
        onChange={(v) => onChange({ ...values, companyStreet: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_company_postal_code"
        testId={`${ids.b2bField}company-postal`}
        value={values.companyPostalCode}
        onChange={(v) => onChange({ ...values, companyPostalCode: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_company_city"
        testId={`${ids.b2bField}company-city`}
        value={values.companyCity}
        onChange={(v) => onChange({ ...values, companyCity: v })}
      />
      <Field
        label={t("admin_tenants.field_company_country")}
        testId={`${ids.field}-company-country`}
        className={fullSpan}
        render={
          <DarkSelect
            testId={`${ids.field}-company-country-input`}
            value={values.companyCountry}
            onChange={(v) => onChange({ ...values, companyCountry: v })}
            options={[
              { value: "", label: "—" },
              { value: "NO", label: t("admin_tenants.country_option_no") },
              { value: "SE", label: t("admin_tenants.country_option_se") },
              { value: "DK", label: t("admin_tenants.country_option_dk") },
              { value: "OTHER", label: t("admin_tenants.country_option_other") },
            ]}
          />
        }
      />
    </>
  );
}

function KontaktFieldsBlock({
  values,
  onChange,
  mode,
}: {
  values: KontaktBlockValues;
  onChange: (next: KontaktBlockValues) => void;
  mode: BlockMode;
}) {
  const ids = blockTestIds(mode);
  const fullSpan = fullSpanClass(mode);

  return (
    <>
      <B2BField
        labelKey="admin_tenants.field_contact_name"
        testId={`${ids.b2bField}contactname`}
        className={fullSpan}
        value={values.contactName}
        onChange={(v) => onChange({ ...values, contactName: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_contact_email"
        testId={`${ids.b2bField}contact-email`}
        type="email"
        value={values.contactEmail}
        onChange={(v) => onChange({ ...values, contactEmail: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_contact_phone"
        testId={`${ids.b2bField}contact-phone`}
        type="tel"
        value={values.contactPhone}
        onChange={(v) => onChange({ ...values, contactPhone: v })}
      />
    </>
  );
}

function FakturaFieldsBlock({
  values,
  onChange,
  mode,
  billingSameAsCompany,
}: {
  values: FakturaBlockValues;
  onChange: (next: FakturaBlockValues) => void;
  mode: BlockMode;
  billingSameAsCompany: boolean;
}) {
  const ids = blockTestIds(mode);
  const fullSpan = fullSpanClass(mode);

  // Postnr→poststed live autofill for billing-adresse.
  usePostnrAutofill({
    country: values.billingCountry,
    postnr: values.billingPostalCode,
    setCity: (city) => onChange({ ...values, billingCity: city }),
  });

  return (
    <>
      <B2BField
        labelKey="admin_tenants.field_billing_street"
        testId={`${ids.b2bField}billing-street`}
        className={fullSpan}
        disabled={billingSameAsCompany}
        value={values.billingStreet}
        onChange={(v) => onChange({ ...values, billingStreet: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_billing_postal_code"
        testId={`${ids.b2bField}billing-postal`}
        disabled={billingSameAsCompany}
        value={values.billingPostalCode}
        onChange={(v) => onChange({ ...values, billingPostalCode: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_billing_city"
        testId={`${ids.b2bField}billing-city`}
        disabled={billingSameAsCompany}
        value={values.billingCity}
        onChange={(v) => onChange({ ...values, billingCity: v })}
      />
      {/* Eksisterende adferd: billing-country er tekst-input både i edit
          og create (ulikt company-country som er DarkSelect). Preserveres. */}
      <B2BField
        labelKey="admin_tenants.field_billing_country"
        testId={`${ids.b2bField}billing-country`}
        disabled={billingSameAsCompany}
        value={values.billingCountry}
        onChange={(v) => onChange({ ...values, billingCountry: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_billing_email"
        testId={`${ids.b2bField}billing-email`}
        type="email"
        value={values.billingEmail}
        onChange={(v) => onChange({ ...values, billingEmail: v })}
      />
      <B2BField
        labelKey="admin_tenants.field_billing_reference"
        testId={`${ids.b2bField}billing-ref`}
        value={values.billingReference}
        onChange={(v) => onChange({ ...values, billingReference: v })}
      />
    </>
  );
}



// ═══════════════════════════════════════════════════════════════════════
// D-104b — CompanyDataSection dispatcher. Discriminated union på mode-prop.
// edit-mode: per-seksjon Lagre/Tilbakestill (3 PATCH-kall). Brukes i
//   TenantDetailCard sin Oversikt-fane (Selskap/Kontakt/Faktura-sub-tabs).
// create-mode: controlled av parent via form/setForm. Ingen Lagre-knapper —
//   parent (CreateTenantModal) sin "Opprett"-knapp er ansvarlig for submit.
// ═══════════════════════════════════════════════════════════════════════
type CompanyDataSectionProps =
  | {
      mode: "edit";
      record: TenantRecord;
      subdomain: string;
      onRefresh: () => void;
      section?: "all" | "selskap" | "kontakt" | "faktura";
    }
  | {
      mode: "create";
      form: CreateFormState;
      setForm: (f: CreateFormState) => void;
    };

function CompanyDataSection(props: CompanyDataSectionProps) {
  if (props.mode === "edit") {
    return (
      <CompanyDataSectionEdit
        record={props.record}
        subdomain={props.subdomain}
        onRefresh={props.onRefresh}
        section={props.section}
      />
    );
  }
  return (
    <CompanyDataSectionCreate form={props.form} setForm={props.setForm} />
  );
}

/**
 * Create-mode rendering: alle 3 felt-blokker (Selskap/Kontakt/Faktura)
 * stablet flat inn i parent sin grid. Eier `billingSameAsCompany`-state
 * og mirror-useEffect så CreateTenantModal slipper å duplisere det.
 */
function CompanyDataSectionCreate({
  form,
  setForm,
}: {
  form: CreateFormState;
  setForm: (f: CreateFormState) => void;
}) {
  const { t } = useLocale();
  const [billingSameAsCompany, setBillingSameAsCompany] = useState(false);

  // Auto-mirror selskap → faktura når checkbox er på.
  useEffect(() => {
    if (!billingSameAsCompany) return;
    setForm({
      ...form,
      billingStreet: form.companyStreet,
      billingPostalCode: form.companyPostalCode,
      billingCity: form.companyCity,
      billingCountry: form.companyCountry,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    billingSameAsCompany,
    form.companyStreet,
    form.companyPostalCode,
    form.companyCity,
    form.companyCountry,
  ]);

  // Org.nr-validering basert på valgt land — samme regel som edit-mode.
  const orgValidation = useMemo(
    () => validateOrgNumber(form.orgNumber, form.companyCountry),
    [form.orgNumber, form.companyCountry],
  );

  return (
    <>
      <SelskapFieldsBlock
        mode="create"
        values={{
          companyName: form.companyName,
          orgNumber: form.orgNumber,
          companyStreet: form.companyStreet,
          companyPostalCode: form.companyPostalCode,
          companyCity: form.companyCity,
          companyCountry: form.companyCountry,
        }}
        onChange={(next) =>
          setForm({
            ...form,
            companyName: next.companyName,
            orgNumber: next.orgNumber,
            companyStreet: next.companyStreet,
            companyPostalCode: next.companyPostalCode,
            companyCity: next.companyCity,
            companyCountry: next.companyCountry,
          })
        }
        orgValidation={orgValidation}
      />
      <KontaktFieldsBlock
        mode="create"
        values={{
          contactName: form.contactName,
          contactEmail: form.contactEmail,
          contactPhone: form.contactPhone,
        }}
        onChange={(next) =>
          setForm({
            ...form,
            contactName: next.contactName,
            contactEmail: next.contactEmail,
            contactPhone: next.contactPhone,
          })
        }
      />
      {/* "Samme som selskap"-checkbox — auto-mirrorer adresse-feltene */}
      <Field
        label=""
        testId="tenant-create-billing-same"
        className="col-span-2"
        render={
          <label className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-indigo-500/10 border border-indigo-400/30 cursor-pointer hover:border-indigo-300/50 transition">
            <input
              type="checkbox"
              checked={billingSameAsCompany}
              onChange={(e) => setBillingSameAsCompany(e.target.checked)}
              data-testid="tenant-create-billing-same-input"
              className="h-4 w-4 accent-indigo-400"
            />
            <span className="text-sm text-indigo-100">
              {t("admin_tenants.billing_same_as_company")}
            </span>
          </label>
        }
      />
      <FakturaFieldsBlock
        mode="create"
        billingSameAsCompany={billingSameAsCompany}
        values={{
          billingStreet: form.billingStreet,
          billingPostalCode: form.billingPostalCode,
          billingCity: form.billingCity,
          billingCountry: form.billingCountry,
          billingEmail: form.billingEmail,
          billingReference: form.billingReference,
        }}
        onChange={(next) =>
          setForm({
            ...form,
            billingStreet: next.billingStreet,
            billingPostalCode: next.billingPostalCode,
            billingCity: next.billingCity,
            billingCountry: next.billingCountry,
            billingEmail: next.billingEmail,
            billingReference: next.billingReference,
          })
        }
      />
    </>
  );
}



function CompanyDataSectionEdit({
  record,
  subdomain,
  onRefresh,
  section = "all",
}: {
  record: TenantRecord;
  subdomain: string;
  onRefresh: () => void;
  /** D-107: hvilken under-seksjon som skal rendres. "all" beholdes for
   *  bakoverkompatibilitet (tidligere D-104-bruk i Firmadata-fanen). */
  section?: "all" | "selskap" | "kontakt" | "faktura";
}) {
  const { t } = useLocale();

  // ═══ SELSKAP-seksjon ═══
  const [companyForm, setCompanyForm] = useState({
    companyName: nullToEmpty(record.companyName),
    orgNumber: nullToEmpty(record.orgNumber),
    companyStreet: nullToEmpty(record.companyStreet),
    companyPostalCode: nullToEmpty(record.companyPostalCode),
    companyCity: nullToEmpty(record.companyCity),
    companyCountry: nullToEmpty(record.companyCountry),
  });
  const [companySaving, setCompanySaving] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [orgConfirmOpen, setOrgConfirmOpen] = useState(false);

  const companyDirty =
    companyForm.companyName !== nullToEmpty(record.companyName) ||
    companyForm.orgNumber !== nullToEmpty(record.orgNumber) ||
    companyForm.companyStreet !== nullToEmpty(record.companyStreet) ||
    companyForm.companyPostalCode !== nullToEmpty(record.companyPostalCode) ||
    companyForm.companyCity !== nullToEmpty(record.companyCity) ||
    companyForm.companyCountry !== nullToEmpty(record.companyCountry);

  const orgChanged =
    companyForm.orgNumber.trim() !== nullToEmpty(record.orgNumber).trim();

  const orgValidation = useMemo(
    () => validateOrgNumber(companyForm.orgNumber, companyForm.companyCountry),
    [companyForm.orgNumber, companyForm.companyCountry],
  );

  const resetCompany = () => {
    setCompanyForm({
      companyName: nullToEmpty(record.companyName),
      orgNumber: nullToEmpty(record.orgNumber),
      companyStreet: nullToEmpty(record.companyStreet),
      companyPostalCode: nullToEmpty(record.companyPostalCode),
      companyCity: nullToEmpty(record.companyCity),
      companyCountry: nullToEmpty(record.companyCountry),
    });
    setCompanyError(null);
  };

  const doSaveCompany = async () => {
    setCompanySaving(true);
    setCompanyError(null);
    try {
      const body = {
        companyName: emptyToNull(companyForm.companyName),
        orgNumber: emptyToNull(companyForm.orgNumber),
        companyStreet: emptyToNull(companyForm.companyStreet),
        companyPostalCode: emptyToNull(companyForm.companyPostalCode),
        companyCity: emptyToNull(companyForm.companyCity),
        companyCountry: emptyToNull(companyForm.companyCountry),
      };
      const r = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await r.json()) as { error?: string; warning?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
      setOrgConfirmOpen(false);
      onRefresh();
    } catch (e) {
      setCompanyError(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setCompanySaving(false);
    }
  };

  const triggerSaveCompany = () => {
    if (companyForm.orgNumber.trim() !== "" && !orgValidation.valid) {
      setCompanyError(`Ugyldig org.nr: ${t(orgValidation.reason)}`);
      return;
    }
    if (orgChanged) {
      setOrgConfirmOpen(true);
      return;
    }
    void doSaveCompany();
  };

  // ═══ KONTAKT-seksjon ═══
  const [contactForm, setContactForm] = useState({
    contactName: nullToEmpty(record.contactName),
    contactEmail: nullToEmpty(record.contactEmail),
    contactPhone: nullToEmpty(record.contactPhone),
  });
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const contactDirty =
    contactForm.contactName !== nullToEmpty(record.contactName) ||
    contactForm.contactEmail !== nullToEmpty(record.contactEmail) ||
    contactForm.contactPhone !== nullToEmpty(record.contactPhone);

  const resetContact = () => {
    setContactForm({
      contactName: nullToEmpty(record.contactName),
      contactEmail: nullToEmpty(record.contactEmail),
      contactPhone: nullToEmpty(record.contactPhone),
    });
    setContactError(null);
  };

  const doSaveContact = async () => {
    setContactSaving(true);
    setContactError(null);
    try {
      const r = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contactName: emptyToNull(contactForm.contactName),
            contactEmail: emptyToNull(contactForm.contactEmail),
            contactPhone: emptyToNull(contactForm.contactPhone),
          }),
        },
      );
      const data = (await r.json()) as { error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
      onRefresh();
    } catch (e) {
      setContactError(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setContactSaving(false);
    }
  };

  // ═══ FAKTURERING-seksjon ═══
  const billingMatchesCompanyInRecord =
    (record.billingStreet ?? "") === (record.companyStreet ?? "") &&
    (record.billingPostalCode ?? "") === (record.companyPostalCode ?? "") &&
    (record.billingCity ?? "") === (record.companyCity ?? "") &&
    (record.billingCountry ?? "") === (record.companyCountry ?? "");
  const [billingSameAsCompany, setBillingSameAsCompany] = useState(
    billingMatchesCompanyInRecord,
  );
  const [billingForm, setBillingForm] = useState({
    billingStreet: nullToEmpty(record.billingStreet),
    billingPostalCode: nullToEmpty(record.billingPostalCode),
    billingCity: nullToEmpty(record.billingCity),
    billingCountry: nullToEmpty(record.billingCountry),
    billingEmail: nullToEmpty(record.billingEmail),
    billingReference: nullToEmpty(record.billingReference),
  });
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  // Mirror selskap-adresse til faktura når checkbox er på — leser fra record
  // (ikke companyForm) så vi alltid speiler det som faktisk er lagret.
  useEffect(() => {
    if (billingSameAsCompany) {
      setBillingForm((prev) => ({
        ...prev,
        billingStreet: nullToEmpty(record.companyStreet),
        billingPostalCode: nullToEmpty(record.companyPostalCode),
        billingCity: nullToEmpty(record.companyCity),
        billingCountry: nullToEmpty(record.companyCountry),
      }));
    }
  }, [
    billingSameAsCompany,
    record.companyStreet,
    record.companyPostalCode,
    record.companyCity,
    record.companyCountry,
  ]);

  // Postnr→poststed autofill: håndteres internt i SelskapFieldsBlock og
  // FakturaFieldsBlock (D-104b — én sannhetskilde). Ingen hook her.

  const billingDirty =
    billingForm.billingStreet !== nullToEmpty(record.billingStreet) ||
    billingForm.billingPostalCode !== nullToEmpty(record.billingPostalCode) ||
    billingForm.billingCity !== nullToEmpty(record.billingCity) ||
    billingForm.billingCountry !== nullToEmpty(record.billingCountry) ||
    billingForm.billingEmail !== nullToEmpty(record.billingEmail) ||
    billingForm.billingReference !== nullToEmpty(record.billingReference);

  const resetBilling = () => {
    setBillingSameAsCompany(billingMatchesCompanyInRecord);
    setBillingForm({
      billingStreet: nullToEmpty(record.billingStreet),
      billingPostalCode: nullToEmpty(record.billingPostalCode),
      billingCity: nullToEmpty(record.billingCity),
      billingCountry: nullToEmpty(record.billingCountry),
      billingEmail: nullToEmpty(record.billingEmail),
      billingReference: nullToEmpty(record.billingReference),
    });
    setBillingError(null);
  };

  const doSaveBilling = async () => {
    setBillingSaving(true);
    setBillingError(null);
    try {
      const r = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            billingStreet: emptyToNull(billingForm.billingStreet),
            billingPostalCode: emptyToNull(billingForm.billingPostalCode),
            billingCity: emptyToNull(billingForm.billingCity),
            billingCountry: emptyToNull(billingForm.billingCountry),
            billingEmail: emptyToNull(billingForm.billingEmail),
            billingReference: emptyToNull(billingForm.billingReference),
          }),
        },
      );
      const data = (await r.json()) as { error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
      onRefresh();
    } catch (e) {
      setBillingError(e instanceof Error ? e.message : "Lagring feilet");
    } finally {
      setBillingSaving(false);
    }
  };

  const COUNTRY_OPTIONS = [
    { value: "", label: "—" },
    { value: "NO", label: t("admin_tenants.country_option_no") },
    { value: "SE", label: t("admin_tenants.country_option_se") },
    { value: "DK", label: t("admin_tenants.country_option_dk") },
    { value: "OTHER", label: t("admin_tenants.country_option_other") },
  ];

  const sectionHeader = (label: string) => (
    <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-3">
      {label}
    </div>
  );

  const saveButton = (
    onSave: () => void,
    onReset: () => void,
    dirty: boolean,
    saving: boolean,
    testId: string,
  ) => (
    <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-white/5">
      <button
        type="button"
        data-testid={`${testId}-reset`}
        onClick={onReset}
        disabled={!dirty || saving}
        className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-40 transition"
      >
        Tilbakestill
      </button>
      <button
        type="button"
        data-testid={`${testId}-save`}
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Lagre endringer
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ═══ SELSKAP ═══ */}
      {(section === "all" || section === "selskap") && (
      <div
        data-testid="company-data-section-selskap"
        className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
      >
        {sectionHeader("Selskap")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelskapFieldsBlock
            mode="edit"
            values={{
              companyName: companyForm.companyName,
              orgNumber: companyForm.orgNumber,
              companyStreet: companyForm.companyStreet,
              companyPostalCode: companyForm.companyPostalCode,
              companyCity: companyForm.companyCity,
              companyCountry: companyForm.companyCountry,
            }}
            onChange={(next) =>
              setCompanyForm({
                ...companyForm,
                companyName: next.companyName,
                orgNumber: next.orgNumber,
                companyStreet: next.companyStreet,
                companyPostalCode: next.companyPostalCode,
                companyCity: next.companyCity,
                companyCountry: next.companyCountry,
              })
            }
            orgValidation={orgValidation}
          />
        </div>
        {companyError && (
          <div
            data-testid="company-data-selskap-error"
            className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200"
          >
            {companyError}
          </div>
        )}
        {saveButton(
          triggerSaveCompany,
          resetCompany,
          companyDirty,
          companySaving,
          "company-data-selskap",
        )}
      </div>
      )}

      {/* ═══ KONTAKT ═══ */}
      {(section === "all" || section === "kontakt") && (
      <div
        data-testid="company-data-section-kontakt"
        className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
      >
        {sectionHeader("Kontakt")}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KontaktFieldsBlock
            mode="edit"
            values={{
              contactName: contactForm.contactName,
              contactEmail: contactForm.contactEmail,
              contactPhone: contactForm.contactPhone,
            }}
            onChange={(next) =>
              setContactForm({
                contactName: next.contactName,
                contactEmail: next.contactEmail,
                contactPhone: next.contactPhone,
              })
            }
          />
        </div>
        {contactError && (
          <div
            data-testid="company-data-kontakt-error"
            className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200"
          >
            {contactError}
          </div>
        )}
        {saveButton(
          () => void doSaveContact(),
          resetContact,
          contactDirty,
          contactSaving,
          "company-data-kontakt",
        )}
      </div>
      )}

      {/* ═══ FAKTURERING ═══ */}
      {(section === "all" || section === "faktura") && (
      <div
        data-testid="company-data-section-fakturering"
        className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
      >
        {sectionHeader("Fakturering")}
        <label
          className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-indigo-500/10 border border-indigo-400/30 cursor-pointer hover:border-indigo-300/50 transition mb-3"
          data-testid="company-data-billing-same"
        >
          <input
            type="checkbox"
            checked={billingSameAsCompany}
            onChange={(e) => setBillingSameAsCompany(e.target.checked)}
            data-testid="company-data-billing-same-input"
            className="h-4 w-4 accent-indigo-400"
          />
          <span className="text-sm text-indigo-100">
            {t("admin_tenants.billing_same_as_company")}
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FakturaFieldsBlock
            mode="edit"
            billingSameAsCompany={billingSameAsCompany}
            values={{
              billingStreet: billingForm.billingStreet,
              billingPostalCode: billingForm.billingPostalCode,
              billingCity: billingForm.billingCity,
              billingCountry: billingForm.billingCountry,
              billingEmail: billingForm.billingEmail,
              billingReference: billingForm.billingReference,
            }}
            onChange={(next) =>
              setBillingForm({
                ...billingForm,
                billingStreet: next.billingStreet,
                billingPostalCode: next.billingPostalCode,
                billingCity: next.billingCity,
                billingCountry: next.billingCountry,
                billingEmail: next.billingEmail,
                billingReference: next.billingReference,
              })
            }
          />
        </div>
        {billingError && (
          <div
            data-testid="company-data-fakturering-error"
            className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2.5 text-xs text-rose-200"
          >
            {billingError}
          </div>
        )}
        {saveButton(
          () => void doSaveBilling(),
          resetBilling,
          billingDirty,
          billingSaving,
          "company-data-fakturering",
        )}
      </div>
      )}

      {/* ═══ Org.nr-endring bekreftelses-modal ═══ */}
      {orgConfirmOpen && (
        <div
          data-testid="orgnumber-change-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !companySaving && setOrgConfirmOpen(false)}
        >
          <div
            className="max-w-md w-full rounded-2xl border border-rose-400/30 bg-neutral-900 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-rose-300" />
              </div>
              <h3 className="text-base font-semibold text-white">
                Endre organisasjonsnummer?
              </h3>
            </div>
            <p className="text-xs text-white/70 leading-relaxed">
              Org.nr er kundens juridiske identitet og endres sjelden (typisk
              ved fusjon eller feilretting ved opprettelse). Endring synes på
              fremtidige fakturaer og i Stripe-Customer-objektet hvis koblet.
            </p>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/80 font-mono space-y-1">
              <div>
                <span className="text-white/40">Før:</span>{" "}
                {record.orgNumber ?? "(ikke satt)"}
              </div>
              <div>
                <span className="text-white/40">Etter:</span>{" "}
                <span className="text-amber-200">
                  {companyForm.orgNumber.trim() === ""
                    ? "(ikke satt)"
                    : companyForm.orgNumber}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                data-testid="orgnumber-confirm-cancel"
                onClick={() => setOrgConfirmOpen(false)}
                disabled={companySaving}
                className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-50 transition"
              >
                Avbryt
              </button>
              <button
                type="button"
                data-testid="orgnumber-confirm-save"
                onClick={() => void doSaveCompany()}
                disabled={companySaving}
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold transition disabled:opacity-50"
              >
                {companySaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Bekreft endring
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



function RateLimitResetButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{
    bucket: string;
    count: number;
    ttlSeconds: number;
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const BUCKETS = [
    { key: "register", label: "register (2/24t)" },
    { key: "subdomain-check", label: "subdomain-check (60/min)" },
    { key: "verify-turnstile", label: "verify-turnstile (30/min)" },
    { key: "invite-validate", label: "invite-validate (60/min)" },
    { key: "invite-accept", label: "invite-accept (5/time)" },
  ];

  async function checkCounter(bucket: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/rate-limit?bucket=${encodeURIComponent(bucket)}`,
        { credentials: "same-origin" },
      );
      const body = (await res.json()) as {
        bucket: string;
        count: number;
        ttlSeconds: number;
        error?: string;
      };
      if (!res.ok || body.error) {
        setMsg(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setInfo(body);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "network_error");
    } finally {
      setBusy(false);
    }
  }

  async function reset(bucket: string, all = false) {
    setBusy(true);
    setMsg(null);
    try {
      const url = `/api/admin/rate-limit?bucket=${encodeURIComponent(bucket)}${
        all ? "&all=true" : ""
      }`;
      const res = await fetch(url, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await res.json()) as {
        ok?: boolean;
        deleted?: number;
        bucket?: string;
        ip?: string;
        scope?: string;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setMsg(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setMsg(
        all
          ? `✓ Nullstilt ALLE IPer i "${bucket}" (${body.deleted} nøkler slettet)`
          : `✓ Nullstilt "${bucket}" for ${body.ip} (${body.deleted} nøkler slettet)`,
      );
      setInfo(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "network_error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        data-testid="rate-limit-toggle-btn"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition"
        title="Nullstill rate-limit-tellere"
      >
        Rate-limit
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="rate-limit-toggle-btn"
        onClick={() => {
          setOpen(false);
          setInfo(null);
          setMsg(null);
        }}
        className="text-xs px-2 py-1.5 rounded-md bg-amber-500/20 text-amber-200 border border-amber-500/40 transition"
      >
        Lukk
      </button>
      <div
        data-testid="rate-limit-panel"
        className="absolute right-0 top-full mt-1.5 z-20 w-80 p-3 rounded-lg bg-neutral-900 border border-white/15 shadow-xl space-y-2"
      >
        <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
          Nullstill rate-limit-teller
        </div>
        <p className="text-[10px] text-white/45 leading-relaxed">
          Bruk når du treffer "rate_limited" under testing. Default sletter
          telleren for din egen IP — "Alle" sletter på tvers av alle IPer.
        </p>
        <ul className="space-y-1">
          {BUCKETS.map((b) => (
            <li
              key={b.key}
              className="flex items-center gap-1.5 text-[11px] font-mono"
            >
              <span className="flex-1 truncate text-white/65">{b.label}</span>
              <button
                type="button"
                data-testid={`rate-limit-check-${b.key}`}
                onClick={() => void checkCounter(b.key)}
                disabled={busy}
                className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-white/75 disabled:opacity-40"
              >
                Sjekk
              </button>
              <button
                type="button"
                data-testid={`rate-limit-reset-${b.key}`}
                onClick={() => void reset(b.key, false)}
                disabled={busy}
                className="px-1.5 py-0.5 rounded bg-blue-600/80 hover:bg-blue-500 text-white disabled:opacity-40"
              >
                Min IP
              </button>
              <button
                type="button"
                data-testid={`rate-limit-reset-all-${b.key}`}
                onClick={() => void reset(b.key, true)}
                disabled={busy}
                className="px-1.5 py-0.5 rounded bg-red-600/80 hover:bg-red-500 text-white disabled:opacity-40"
                title="ADVARSEL: sletter for ALLE IPer"
              >
                Alle
              </button>
            </li>
          ))}
        </ul>
        {info && (
          <div
            data-testid="rate-limit-info"
            className="text-[11px] font-mono text-white/75 bg-black/40 rounded px-2 py-1.5"
          >
            {info.bucket}: <span className="text-white">{info.count}</span>{" "}
            requests · TTL{" "}
            <span className="text-white">{info.ttlSeconds}s</span>
          </div>
        )}
        {msg && (
          <div
            data-testid="rate-limit-msg"
            className="text-[11px] font-mono text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1.5 break-all"
          >
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}

function ClientConfigSidePanel({
  subdomain,
  onClose,
}: {
  subdomain: string;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="tenant-client-config-panel"
      className="absolute top-0 left-[calc(48rem+1.5rem)] right-[-100px] h-[calc(100vh-9rem-35px)] flex flex-col rounded-2xl border border-sky-400/30 bg-black/85 backdrop-blur-xl shadow-2xl overflow-hidden animate-slide-in-right"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.03] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse shrink-0"></span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-sky-200">
              CLIENT-CONFIG
            </div>
            <div className="text-[10px] text-white/45 font-mono truncate">
              {subdomain}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="tenant-client-config-close"
          onClick={onClose}
          aria-label="Lukk client-config"
          className="shrink-0 p-1.5 rounded-md hover:bg-white/10 text-white/65 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col p-4">
        <ClientConfigEditor subdomain={subdomain} />
      </div>
    </div>
  );
}

function ProvisioningLogSidePanel({
  record,
  onClose,
}: {
  record: TenantRecord;
  onClose: () => void;
}) {
  const [view, setView] = useState<"text" | "json">("text");
  const [copied, setCopied] = useState(false);

  // Kronologisk: nyeste øverst (per Mike 2026-06-04)
  const log = [...(record.provisioningLog ?? [])].reverse();
  const json = JSON.stringify(log, null, 2);
  const text = formatLogAsText(log);
  const content = view === "json" ? json : text;
  const lineCount = content.split("\n").length;
  const byteCount = new Blob([content]).size;

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard kan feile i ikke-https eller iframes — ignorer stille */
    }
  }

  return (
    <div
      data-testid="tenant-provisioning-log-panel"
      className="absolute top-0 left-[calc(48rem+1.5rem)] right-[-100px] h-[calc(100vh-9rem-35px)] flex flex-col rounded-2xl border border-amber-400/30 bg-black/85 backdrop-blur-xl shadow-2xl overflow-hidden animate-slide-in-right"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-amber-200 flex items-center gap-2">
              KONTO-LOGG
              {record.vaultLive && (
                <span className="text-emerald-300 text-[10px]">
                  · vault live ✓
                </span>
              )}
            </div>
            <div className="text-[10px] text-white/45 font-mono truncate">
              {record.subdomain} · {log.length} event
              {log.length === 1 ? "" : "er"} · {lineCount} linjer ·{" "}
              {formatBytes(byteCount)}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid="tenant-provisioning-log-close"
          onClick={onClose}
          aria-label="Lukk konto-logg"
          className="shrink-0 p-1.5 rounded-md hover:bg-white/10 text-white/65 hover:text-white transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-white/10 bg-black/40">
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="tenant-provisioning-log-view-text"
            onClick={() => setView("text")}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
              view === "text"
                ? "bg-amber-500/30 text-amber-100"
                : "bg-white/10 hover:bg-white/15 text-white/65"
            }`}
          >
            Tekst
          </button>
          <button
            type="button"
            data-testid="tenant-provisioning-log-view-json"
            onClick={() => setView("json")}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
              view === "json"
                ? "bg-amber-500/30 text-amber-100"
                : "bg-white/10 hover:bg-white/15 text-white/65"
            }`}
          >
            JSON
          </button>
        </div>
        <button
          type="button"
          data-testid="tenant-provisioning-log-copy"
          onClick={copyToClipboard}
          className="text-xs px-3 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white/85 font-medium transition"
        >
          {copied ? "✓ Kopiert" : "Kopier"}
        </button>
      </div>

      <pre
        data-testid="tenant-provisioning-log-content"
        className="flex-1 text-[11px] leading-[1.6] font-mono text-emerald-300 px-4 py-3 overflow-auto whitespace-pre-wrap break-all"
      >
        {log.length === 0
          ? "(ingen events ennå — fylles etterhvert som flyten kjører)"
          : content}
      </pre>
    </div>
  );
}

function formatLogAsText(
  log: { timestamp: string; stage: string; status: string; detail?: string }[],
): string {
  return log
    .map((e) => {
      // D-124 (2026-06-29): trim-markere får skar-ikon så de visuelt
      // skiller seg fra ok/failed-events i text-visningen.
      const icon =
        e.stage === "log_trimmed"
          ? "✂️"
          : e.status === "ok"
            ? "✅"
            : e.status === "failed"
              ? "❌"
              : "↻";
      const ts = e.timestamp.replace(".000Z", "Z");
      const detail = e.detail ? ` — ${e.detail}` : "";
      return `[${ts}] ${e.stage} ${icon}${detail}`;
    })
    .join("\n");
}


/**
 * Iter 14.9: knapp som henter sannhetsdata fra Stripe og synker
 * tenant.status + stripeSubscriptionId + plan. Recovery-verktøy for
 * race-conditions eller andre desync-tilfeller.
 *
 * To-trinns flow (Mike-krav): klikk 1 = dry-run (vis diff), klikk 2 = bekreft.
 * Ingen endringer = ingen bekreftelse nødvendig.
 */
type SyncPreview = {
  stripeStatus: string;
  reasons: string[];
  before: { status: string; plan: string | null; stripeSubscriptionId: string | null };
  proposed: { status: string; plan: string | null; stripeSubscriptionId: string | null } | null;
};

function SyncStripeButton({
  subdomain,
  onSynced,
}: {
  subdomain: string;
  onSynced: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [result, setResult] = useState<{
    synced: boolean;
    stripeStatus: string;
    reasons?: string[];
    error?: string;
  } | null>(null);

  async function call(dryRun: boolean) {
    setBusy(true);
    if (dryRun) {
      setResult(null);
      setPreview(null);
    }
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}/sync-stripe${dryRun ? "?dryRun=1" : ""}`,
        { method: "POST", credentials: "same-origin" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        synced?: boolean;
        stripeStatus?: string;
        reasons?: string[];
        before?: SyncPreview["before"];
        proposed?: SyncPreview["proposed"];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok) {
        setResult({
          synced: false,
          stripeStatus: "error",
          error: `${data.error ?? `HTTP ${res.status}`}${data.detail ? `: ${data.detail}` : ""}`,
        });
        setPreview(null);
        setTimeout(() => setResult(null), 8000);
        return;
      }
      if (dryRun) {
        // Hvis ingen endringer (proposed === null): vis "ingen endring" som vanlig resultat.
        if (!data.proposed) {
          setResult({
            synced: false,
            stripeStatus: data.stripeStatus ?? "?",
            reasons: data.reasons ?? [],
          });
          setTimeout(() => setResult(null), 8000);
          return;
        }
        // Endringer foreslås — vis preview m/ bekreft-knapp.
        setPreview({
          stripeStatus: data.stripeStatus ?? "?",
          reasons: data.reasons ?? [],
          before: data.before ?? { status: "?", plan: null, stripeSubscriptionId: null },
          proposed: data.proposed,
        });
      } else {
        // Apply-respons.
        setPreview(null);
        setResult({
          synced: data.synced ?? false,
          stripeStatus: data.stripeStatus ?? "?",
          reasons: data.reasons ?? [],
        });
        if (data.synced) onSynced();
        setTimeout(() => setResult(null), 8000);
      }
    } catch (err) {
      setResult({
        synced: false,
        stripeStatus: "error",
        error: err instanceof Error ? err.message : "network_error",
      });
      setPreview(null);
      setTimeout(() => setResult(null), 8000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="tenant-sync-stripe-btn"
        onClick={() => call(true)}
        disabled={busy || !!preview}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-amber-400/30 hover:border-amber-300/60 hover:bg-amber-500/10 disabled:opacity-50 text-amber-200 text-xs font-medium transition"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CreditCard className="h-3.5 w-3.5" />
        )}
        {busy ? "Sjekker…" : "Sjekk Stripe-status"}
      </button>

      {/* PREVIEW (dry-run): vis diff + bekreft/avbryt */}
      {preview && (
        <div
          data-testid="tenant-sync-stripe-preview"
          className="absolute top-full right-0 mt-1.5 w-80 z-30 rounded-lg border border-amber-400/40 bg-slate-950/95 backdrop-blur-xl p-3 text-xs text-white/90 shadow-2xl"
        >
          <div className="font-semibold mb-2 text-amber-200">
            Stripe sier: {preview.stripeStatus}
          </div>
          <div className="text-white/60 mb-1">Foreslåtte endringer:</div>
          <ul className="space-y-0.5 list-disc list-inside text-white/80 mb-3">
            {preview.reasons.map((r, i) => (
              <li key={i} className="break-words">{r}</li>
            ))}
          </ul>
          <div className="flex gap-2 pt-2 border-t border-white/10">
            <button
              type="button"
              data-testid="tenant-sync-stripe-confirm"
              onClick={() => call(false)}
              disabled={busy}
              className="flex-1 h-8 px-3 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 font-medium disabled:opacity-50 transition"
            >
              {busy ? "Synker…" : "Bekreft og synk"}
            </button>
            <button
              type="button"
              data-testid="tenant-sync-stripe-cancel"
              onClick={() => setPreview(null)}
              disabled={busy}
              className="h-8 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 disabled:opacity-50 transition"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {/* RESULT (apply / no-op / error) */}
      {result && !preview && (
        <div
          data-testid="tenant-sync-stripe-result"
          className={`absolute top-full right-0 mt-1.5 w-72 z-20 rounded-lg border p-3 backdrop-blur-xl text-xs ${
            result.error
              ? "border-rose-400/40 bg-rose-950/80 text-rose-200"
              : result.synced
                ? "border-emerald-400/40 bg-emerald-950/80 text-emerald-200"
                : "border-white/15 bg-slate-900/90 text-white/80"
          }`}
        >
          {result.error ? (
            <div className="font-mono break-all">{result.error}</div>
          ) : (
            <>
              <div className="font-semibold mb-1">
                Stripe: {result.stripeStatus}{" "}
                {result.synced ? "→ oppdatert" : "→ ingen endring"}
              </div>
              {result.reasons && result.reasons.length > 0 && (
                <ul className="space-y-0.5 list-disc list-inside text-white/65">
                  {result.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Iter 12.5.1: admin-knapp som tester Stripe Checkout for en valgt tenant.
 * Krever bekreftelse av plan (monthly/yearly), kaller test-checkout-
 * endepunktet, viser URL + "Åpne i ny fane".
 */
function TestCheckoutButton({ subdomain }: { subdomain: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    url?: string;
    scenario?: "A" | "B" | "C";
    error?: string;
  } | null>(null);

  async function run(plan: "monthly" | "yearly") {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}/test-checkout`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        scenario?: "A" | "B" | "C";
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        setResult({
          error: `${data.error ?? `HTTP ${res.status}`}${data.detail ? `: ${data.detail}` : ""}`,
        });
      } else {
        setResult({ url: data.url, scenario: data.scenario });
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "network_error" });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setResult(null);
  }

  return (
    <>
      <button
        type="button"
        data-testid="tenant-test-checkout-btn"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-violet-400/30 hover:border-violet-300/60 hover:bg-violet-500/10 text-violet-200 text-xs font-medium transition"
      >
        <CreditCard className="h-3.5 w-3.5" />
        Test checkout
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            data-testid="tenant-test-checkout-modal"
            className="w-full max-w-md rounded-xl border border-white/15 bg-slate-950/95 backdrop-blur-xl p-5 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">
                Test Stripe Checkout
              </h3>
              <button
                type="button"
                onClick={close}
                className="p-1 rounded hover:bg-white/10 text-white/55 hover:text-white"
                aria-label="Lukk"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-white/60 mb-4">
              Oppretter en ekte Stripe Checkout-session for{" "}
              <span className="font-mono text-white/80">{subdomain}</span>.
              Scenario velges automatisk basert på tenant-status (A/B/C).
            </p>

            {!result && (
              <div className="space-y-2">
                <button
                  type="button"
                  data-testid="tenant-test-checkout-monthly"
                  onClick={() => run("monthly")}
                  disabled={busy}
                  className="w-full h-10 rounded-md bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-100 font-medium disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Månedlig
                </button>
                <button
                  type="button"
                  data-testid="tenant-test-checkout-yearly"
                  onClick={() => run("yearly")}
                  disabled={busy}
                  className="w-full h-10 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-violet-100 font-medium disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Årlig
                </button>
              </div>
            )}

            {result?.error && (
              <div
                data-testid="tenant-test-checkout-error"
                className="rounded-md border border-rose-400/40 bg-rose-950/60 p-3 text-xs text-rose-200 font-mono break-all"
              >
                {result.error}
              </div>
            )}

            {result?.url && (
              <div
                data-testid="tenant-test-checkout-result"
                className="space-y-3"
              >
                <div className="rounded-md border border-emerald-400/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                  <div className="font-semibold mb-1">
                    Scenario {result.scenario} — session opprettet
                  </div>
                  <div className="text-emerald-300/80 break-all font-mono">
                    {result.url}
                  </div>
                </div>
                <div className="flex gap-2">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="tenant-test-checkout-open"
                    className="flex-1 h-10 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-100 font-medium transition flex items-center justify-center gap-2"
                  >
                    Åpne i ny fane
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(result.url ?? "");
                    }}
                    data-testid="tenant-test-checkout-copy"
                    className="h-10 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/15 text-white/80 transition"
                  >
                    Kopier
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setResult(null)}
                  className="w-full text-xs text-white/55 hover:text-white/80 transition py-1"
                >
                  ← Lag ny session
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}


function ResendWelcomeButton({
  subdomain,
  compact = false,
}: {
  subdomain: string;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  async function onClick() {
    if (busy) return;
    if (
      !window.confirm(
        `Send velkomstmail til ${subdomain} på nytt? Den sendes til contactEmail (eller email).`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(subdomain)}/resend-welcome`,
        { method: "POST", credentials: "same-origin" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        emailId?: string;
        error?: string;
        reason?: string;
      };
      if (res.ok && body.ok) {
        setMsg({
          kind: "ok",
          text: `✓ Sendt (id=${body.emailId ?? "?"})`,
        });
      } else {
        setMsg({
          kind: "err",
          text: `${body.error ?? `HTTP ${res.status}`}${body.reason ? ` (${body.reason})` : ""}`,
        });
      }
    } catch (e) {
      setMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "network_error",
      });
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 6000);
    }
  }

  if (compact) {
    return (
      <>
        <button
          type="button"
          data-testid="tenant-resend-welcome-btn"
          onClick={onClick}
          disabled={busy}
          title="Send velkomstmail på nytt"
          className="text-xs px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1.5 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 border border-emerald-400/30 disabled:opacity-50"
        >
          📧 {busy ? "Sender…" : "Re-send velkomst"}
        </button>
        {msg && (
          <span
            data-testid="tenant-resend-welcome-result"
            className={`text-[10px] font-mono ${
              msg.kind === "ok" ? "text-emerald-300" : "text-red-300"
            }`}
          >
            {msg.text}
          </span>
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        data-testid="tenant-resend-welcome-btn"
        variant="secondary"
        onClick={onClick}
        disabled={busy}
      >
        {busy ? "Sender…" : "Send velkomstmail på nytt"}
      </Button>
      {msg && (
        <span
          data-testid="tenant-resend-welcome-result"
          className={`text-xs font-mono ${
            msg.kind === "ok" ? "text-emerald-300" : "text-red-300"
          }`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

function ProvisionRow({ record }: { record: TenantRecord }) {
  const [busy, setBusy] = useState<"vercel" | "upstash" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const needsUpstash = record.upstashDatabaseId === null;
  const needsVercel = record.vercelProjectId === null;

  async function provisionUpstash() {
    if (busy) return;
    setBusy("upstash");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(record.subdomain)}/provision-upstash`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        databaseId?: string;
        databaseName?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        `✓ Upstash-DB opprettet: ${body.databaseName ?? body.databaseId ?? ""}`,
      );
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setBusy(null);
    }
  }

  async function provisionVercel() {
    if (busy) return;
    setBusy("vercel");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/tenants/${encodeURIComponent(record.subdomain)}/provision-vercel`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        projectId?: string;
        domain?: string;
        domainVerified?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.detail || body.error || `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        `✓ Vercel-prosjekt opprettet: ${body.projectId ?? ""}${
          body.domainVerified ? " · domain verified" : " · domain pending DNS"
        }`,
      );
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    } finally {
      setBusy(null);
    }
  }

  if (!needsUpstash && !needsVercel) return null;

  return (
    <div
      data-testid="tenant-provision-row"
      className="space-y-2 mb-5 pb-5 border-b border-white/10"
    >
      <div className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
        Provisjonering (D-055 · D-064 — Upstash før Vercel)
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {needsUpstash && (
          <button
            type="button"
            data-testid="tenant-provision-upstash-btn"
            onClick={provisionUpstash}
            disabled={busy !== null}
            className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition"
          >
            {busy === "upstash" && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy === "upstash"
              ? "Provisjonerer…"
              : "1. Provisjoner Upstash-instans"}
          </button>
        )}
        {!needsUpstash && needsVercel && (
          <button
            type="button"
            data-testid="tenant-provision-vercel-btn"
            onClick={provisionVercel}
            disabled={busy !== null}
            className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition"
          >
            {busy === "vercel" && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy === "vercel"
              ? "Provisjonerer…"
              : "2. Provisjoner Vercel-prosjekt"}
          </button>
        )}
        {needsUpstash && needsVercel && (
          <span
            data-testid="tenant-provision-vercel-waiting"
            className="text-xs px-3 py-1.5 rounded-md bg-white/5 text-white/45 italic"
          >
            Vercel: venter på Upstash-instans
          </span>
        )}
      </div>
      {error && (
        <div
          data-testid="tenant-provision-error"
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          data-testid="tenant-provision-success"
          className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md px-2 py-1.5 font-mono break-all"
        >
          {success}
        </div>
      )}
    </div>
  );
}

function ProvisioningModal({
  subdomain,
  onClose,
}: {
  subdomain: string;
  onClose: () => void;
}) {
  const [done, setDone] = useState<"success" | "failed" | null>(null);

  return (
    <div
      data-testid="tenant-provisioning-modal"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        // Klikk utenfor → lukk (kun hvis ferdig — under provisjonering vil
        // vi at admin skal se hva som skjer, ikke lukke ved et uhell)
        if (e.target === e.currentTarget && done !== null) {
          onClose();
        }
      }}
    >
      <div
        className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-neutral-950/90 backdrop-blur-xl shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">
            Provisjonerer ny tenant
          </h3>
          <button
            type="button"
            data-testid="tenant-provisioning-modal-close"
            onClick={onClose}
            aria-label="Lukk"
            title={
              done === null
                ? "Lukk (provisjonering fortsetter i bakgrunnen)"
                : "Lukk"
            }
            className="p-1.5 rounded-md hover:bg-white/10 text-white/65 hover:text-white transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <ProvisioningTracker
            subdomain={subdomain}
            mode="admin"
            onDone={(ok) => setDone(ok ? "success" : "failed")}
            onClose={onClose}
          />
          {done !== null && (
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-testid="tenant-provisioning-modal-close-action"
                onClick={onClose}
                className="text-xs px-4 py-2 rounded-md bg-white/10 hover:bg-white/15 text-white font-medium transition"
              >
                {done === "success" ? "Se tenant-detaljer" : "Lukk"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateTenantModal({
  form,
  setForm,
  busy,
  error,
  onClose,
  onSubmit,
  lockedCustomerType,
}: {
  form: CreateFormState;
  setForm: (f: CreateFormState) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  /**
   * Iter 20.7: når satt skjules TYPE-dropdownen og customerType er
   * låst. Brukes fra B2B-tab så Mike ikke trenger å velge B2B
   * manuelt for hver bedrift.
   */
  lockedCustomerType?: CustomerType;
}) {
  const { t } = useLocale();

  // Iter 20.8: 3-stegs wizard for B2B-mode. B2C beholder linear-layout.
  const isWizard = lockedCustomerType === "b2b";
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // D-104b (2026-06-29): billing-same-state, mirror-useEffect,
  // postnr-autofill og org-validering eies nå av <CompanyDataSection
  // mode="create">. Bare lokal felt-styring igjen.

  // Iter 2.x — inline blur-sjekk mot /api/admin/subdomain-check.
  // Gjenbruker `isSubdomainAvailable()` server-side så denne sjekken og
  // POST /api/admin/tenants alltid har samme sannhetskilde.
  type SubdomainCheck =
    | { state: "idle" }
    | { state: "checking" }
    | { state: "available" }
    | { state: "unavailable"; reason: "taken" | "reserved" | "invalid_format" };
  const [subdomainCheck, setSubdomainCheck] = useState<SubdomainCheck>({
    state: "idle",
  });

  // Iter 20.7: når customerType toggles til B2B og trial fortsatt er den
  // gamle B2C-defaulten, bytt til 45 dager. Vi rører IKKE feltet hvis Mike
  // allerede har endret det manuelt til noe annet enn standard-defaultene.
  const prevCustomerType = useRef(form.customerType);
  useEffect(() => {
    if (
      form.customerType === "b2b" &&
      prevCustomerType.current !== "b2b" &&
      (form.trialDays === DEFAULT_TRIAL_DAYS_FROM_CONFIG ||
        form.trialDays === 0)
    ) {
      setForm({ ...form, trialDays: DEFAULT_TRIAL_DAYS_B2B });
    }
    prevCustomerType.current = form.customerType;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.customerType]);

  // 2026-06-02 (Mike): Auto-utled `tenantPrefix` fra subdomain for B2B.
  // Når customerType === "b2b" og subdomain matcher `<x>-admin`-mønster,
  // sett tenantPrefix = "<x>" automatisk. Mike kan overstyre manuelt
  // etterpå hvis han vil. Vi auto-fyller KUN når tenantPrefix er tomt
  // ELLER når det forrige verdien selv var utledet fra subdomain — så
  // vi ikke overskriver manuell overstyring.
  const lastAutoPrefixRef = useRef<string>("");
  useEffect(() => {
    if (form.customerType !== "b2b") return;
    const m = form.subdomain.toLowerCase().match(/^([a-z0-9]+)-admin$/);
    const derived = m ? m[1] : "";
    // Auto-fyll hvis tomt eller hvis forrige verdi var den vi utledet selv
    if (
      form.tenantPrefix === "" ||
      form.tenantPrefix === lastAutoPrefixRef.current
    ) {
      if (derived !== form.tenantPrefix) {
        setForm({ ...form, tenantPrefix: derived });
        lastAutoPrefixRef.current = derived;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.subdomain, form.customerType]);

  // Iter 2.x — inline e-post-validering på blur (klient-side regex, ingen
  // server-call). Samme regex som /api/admin/tenants POST bruker, så server
  // og UI alltid er enige.
  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  type EmailCheck = "idle" | "valid" | "invalid";
  const [emailCheck, setEmailCheck] = useState<EmailCheck>("idle");

  function checkEmail(raw: string) {
    const v = raw.trim();
    if (!v) {
      setEmailCheck("idle");
      return;
    }
    setEmailCheck(EMAIL_RX.test(v) ? "valid" : "invalid");
  }

  async function checkSubdomain(raw: string) {
    const sub = raw.toLowerCase().trim();
    if (!sub) {
      setSubdomainCheck({ state: "idle" });
      return;
    }
    setSubdomainCheck({ state: "checking" });
    try {
      // Admin har full overstyringsrett (Mike 2026-06-02) — server sjekker
      // kun format + duplikat. Ingen reservert/prefiks-blokk for admin.
      const res = await fetch(
        `/api/admin/subdomain-check?subdomain=${encodeURIComponent(sub)}`,
        { credentials: "same-origin" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        available?: boolean;
        reason?: "invalid_format" | "reserved" | "taken";
      };
      if (body.available === true) {
        setSubdomainCheck({ state: "available" });
      } else if (body.reason) {
        setSubdomainCheck({ state: "unavailable", reason: body.reason });
      } else {
        setSubdomainCheck({ state: "idle" });
      }
    } catch {
      // Nett-feil: ikke vis status — server vil uansett re-validere på POST
      setSubdomainCheck({ state: "idle" });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/60 backdrop-blur-sm animate-fade-in"
      data-testid="tenant-create-backdrop"
    >
      {/* Iter 20.9 (Mike 2026-06-04): Skjemaet skal IKKE lukkes ved klikk
          utenfor — 3-stegs wizard har for mange felter til at utilsiktet
          lukking er akseptabelt. Bruker × eller Avbryt-knapp for å lukke. */}
      <form
        data-testid="tenant-create-modal"
        onSubmit={onSubmit}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950/90 backdrop-blur-xl p-6 shadow-2xl animate-slide-up"
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <h3 className="text-sm font-semibold text-white shrink-0">
              {t("admin_tenants.create_title")}
            </h3>
            {/* Iter 20.9 (Mike 2026-06-04): Vis tenant-kontekst på steg 2/3
                så Mike alltid ser hvilken bedrift han konfigurerer. Bruker
                companyName hvis satt, ellers prefiksen som fallback. */}
            {isWizard && step > 1 && (
              <span
                data-testid="tenant-create-context-subtitle"
                className="text-xs font-mono text-indigo-300/90 truncate min-w-0"
                title={
                  form.companyName.trim() ||
                  `${form.subdomain.replace(/-admin$/, "")}-admin.kodovault.no`
                }
              >
                {form.companyName.trim() ||
                  `${form.subdomain.replace(/-admin$/, "")}-admin.kodovault.no`}
              </span>
            )}
          </div>
          <button
            type="button"
            data-testid="tenant-create-close-btn"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-white/55 transition shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isWizard && (
          <div
            className="flex items-center gap-2 mb-5"
            data-testid="tenant-create-wizard-stepper"
          >
            {([1, 2, 3] as const).map((n, idx) => (
              <div key={n} className="flex items-center gap-2 flex-1">
                <div
                  data-testid={`tenant-create-wizard-step-${n}`}
                  data-active={step === n}
                  className={`flex items-center gap-2 ${
                    step === n
                      ? "text-indigo-300"
                      : step > n
                      ? "text-emerald-300/80"
                      : "text-white/35"
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full border flex items-center justify-center text-[10px] font-mono ${
                      step === n
                        ? "border-indigo-400 bg-indigo-500/20"
                        : step > n
                        ? "border-emerald-400/60 bg-emerald-500/15"
                        : "border-white/20 bg-white/5"
                    }`}
                  >
                    {step > n ? "✓" : n}
                  </span>
                  <span className="text-xs uppercase tracking-wide">
                    {t(`admin_tenants.wizard_step${n}`)}
                  </span>
                </div>
                {idx < 2 && (
                  <div className="flex-1 h-px bg-white/10" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {!lockedCustomerType && (
            <Field
              label={t("admin_tenants.field_customer_type")}
              testId="tenant-create-customertype"
              render={
                <DarkSelect
                  testId="tenant-create-customertype-input"
                  value={form.customerType}
                  onChange={(v) =>
                    setForm({ ...form, customerType: v as "b2c" | "b2b" })
                  }
                  options={[
                    { value: "b2c", label: "B2C" },
                    { value: "b2b", label: "B2B" },
                  ]}
                />
              }
            />
          )}
          {(!isWizard || step === 1) && (<>
          <Field
            label={isWizard ? t("admin_tenants.field_b2b_prefix") : t("admin_tenants.field_subdomain")}
            testId="tenant-create-subdomain"
            className={isWizard ? "col-span-2" : undefined}
            render={
              isWizard ? (
                // Iter 20.9 (Mike 2026-06-04): I B2B-wizard skriver Mike kun
                // org-prefiksen (f.eks. `mm`). Vi appender automatisk `-admin`
                // og lagrer `mm-admin` som subdomain. `tenantPrefix` utledes
                // videre fra subdomain av useEffect lenger oppe (uendret).
                //
                // Layout: composed-input à la GitHub/Stripe slug — smalt
                // editbart felt + statisk suffix-segment ved siden av, visuelt
                // sammenslått til ett rektangel.
                <div className="space-y-1.5">
                  <div
                    className={`flex items-stretch rounded-lg border bg-black/40 overflow-hidden transition focus-within:ring-1 ${
                      subdomainCheck.state === "available"
                        ? "border-emerald-400/60 focus-within:border-emerald-300 focus-within:ring-emerald-300/30"
                        : subdomainCheck.state === "unavailable"
                        ? "border-rose-400/60 focus-within:border-rose-300 focus-within:ring-rose-300/30"
                        : "border-white/15 focus-within:border-blue-300/60 focus-within:ring-blue-300/30"
                    }`}
                  >
                    <input
                      type="text"
                      required
                      autoFocus
                      value={form.subdomain.replace(/-admin$/, "")}
                      onChange={(e) => {
                        const raw = e.target.value.toLowerCase();
                        // Tillat kun a-z0-9 i prefiks-inputen — fjern alt annet.
                        const prefix = raw.replace(/[^a-z0-9]/g, "");
                        setForm({
                          ...form,
                          subdomain: prefix ? `${prefix}-admin` : "",
                        });
                        if (subdomainCheck.state !== "idle") {
                          setSubdomainCheck({ state: "idle" });
                        }
                      }}
                      onBlur={(e) => {
                        const prefix = e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]/g, "");
                        if (prefix.length >= 2) {
                          checkSubdomain(`${prefix}-admin`);
                        }
                      }}
                      placeholder={t("admin_tenants.b2b_prefix_placeholder")}
                      maxLength={20}
                      data-testid="tenant-create-subdomain-input"
                      className="w-24 shrink-0 font-mono bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
                    />
                    <div
                      data-testid="tenant-create-b2b-prefix-suffix"
                      className="flex-1 flex items-center px-3 py-2 bg-white/[0.03] border-l border-white/10 text-xs font-mono select-none whitespace-nowrap"
                    >
                      {/* Iter 20.9 (Mike 2026-06-04): Live URL-preview. Tom
                          input → vis kun `-admin.kodovault.no` (dimmet
                          placeholder). Med prefix → vis full sammensatt URL. */}
                      {form.subdomain.replace(/-admin$/, "") ? (
                        <span className="text-white/80" aria-hidden="true">
                          {form.subdomain}.kodovault.no
                        </span>
                      ) : (
                        <span className="text-white/35" aria-hidden="true">
                          -admin.kodovault.no
                        </span>
                      )}
                    </div>
                  </div>
                  <SubdomainCheckBadge check={subdomainCheck} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <input
                    type="text"
                    required
                    autoFocus
                    value={form.subdomain}
                    onChange={(e) => {
                      setForm({ ...form, subdomain: e.target.value });
                      // Tøm tidligere status så bruker ikke ser stale "Ledig"-badge
                      // mens de retter på subdomenet.
                      if (subdomainCheck.state !== "idle") {
                        setSubdomainCheck({ state: "idle" });
                      }
                    }}
                    onBlur={(e) => checkSubdomain(e.target.value)}
                    placeholder="terje"
                    data-testid="tenant-create-subdomain-input"
                    className={`w-full font-mono rounded-lg bg-black/40 border px-3 py-2 text-sm text-white outline-none transition ${
                      subdomainCheck.state === "available"
                        ? "border-emerald-400/60 focus:border-emerald-300"
                        : subdomainCheck.state === "unavailable"
                        ? "border-rose-400/60 focus:border-rose-300"
                        : "border-white/15 focus:border-blue-300/60"
                    }`}
                  />
                  <SubdomainCheckBadge check={subdomainCheck} />
                </div>
              )
            }
          />
          <Field
            label={t("admin_tenants.field_email")}
            testId="tenant-create-email"
            className="col-span-2"
            render={
              <div className="space-y-1.5">
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => {
                    setForm({ ...form, email: e.target.value });
                    if (emailCheck !== "idle") setEmailCheck("idle");
                  }}
                  onBlur={(e) => checkEmail(e.target.value)}
                  placeholder="terje@example.no"
                  data-testid="tenant-create-email-input"
                  className={`w-full rounded-lg bg-black/40 border px-3 py-2 text-sm text-white outline-none transition ${
                    emailCheck === "valid"
                      ? "border-emerald-400/60 focus:border-emerald-300"
                      : emailCheck === "invalid"
                      ? "border-rose-400/60 focus:border-rose-300"
                      : "border-white/15 focus:border-blue-300/60"
                  }`}
                />
                {emailCheck === "invalid" && (
                  <p
                    data-testid="tenant-create-email-status"
                    data-state="invalid"
                    className="text-[11px] text-rose-300 font-medium"
                  >
                    {t("admin_tenants.error_invalid_email")}
                  </p>
                )}
              </div>
            }
          />
          </>)}
          {form.customerType === "b2c" ? (
            <>
              <Field
                label={t("admin_tenants.field_first_name")}
                testId="tenant-create-firstname"
                render={
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                    data-testid="tenant-create-firstname-input"
                    className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/60"
                  />
                }
              />
              <Field
                label={t("admin_tenants.field_last_name")}
                testId="tenant-create-lastname"
                render={
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                    data-testid="tenant-create-lastname-input"
                    className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/60"
                  />
                }
              />
            </>
          ) : (
            <>
              {/* D-104b (2026-06-29): Steg 1 har kun subdomain + email +
                  customerType. Steg 2 renderer ALLE B2B-firma-felter via
                  <CompanyDataSection mode="create"> — én sannhetskilde
                  delt med edit-mode i TenantDetailCard. */}
              {(!isWizard || step === 2) && (
                <CompanyDataSection
                  mode="create"
                  form={form}
                  setForm={setForm}
                />
              )}
            </>
          )}
          {(!isWizard || step === 3) && (<>
          {isWizard && (
            // Iter 20.9 (Mike 2026-06-04): Lisenser flyttet hit fra steg 2 —
            // hører naturlig hjemme under "Lisens & plan".
            <B2BField labelKey="admin_tenants.field_max_licenses" testId="max-licenses" type="number"
              value={form.maxLicenses}
              onChange={(v) => setForm({ ...form, maxLicenses: v })} />
          )}
          <Field
            label={t("admin_tenants.field_plan")}
            testId="tenant-create-plan"
            render={
              <DarkSelect
                testId="tenant-create-plan-input"
                value={form.plan}
                onChange={(v) => setForm({ ...form, plan: v as Plan })}
                options={isWizard ? getB2BPlanOptions(t) : PLAN_OPTIONS}
              />
            }
          />
          {/* Iter 20.8: Anbefalt-tag på B2B-plan-valg */}
          {isWizard && (form.plan === "b2b_yearly" || form.plan === "b2b_semiannual") && (
            <div
              data-testid="tenant-create-plan-badge"
              className={`text-[11px] rounded-md px-3 py-2 -mt-2 col-span-2 sm:col-span-1 ${
                form.plan === "b2b_yearly"
                  ? "bg-emerald-500/10 border border-emerald-400/30 text-emerald-200"
                  : "bg-amber-500/10 border border-amber-400/30 text-amber-200"
              }`}
            >
              {form.plan === "b2b_yearly"
                ? t("admin_tenants.plan_badge_recommended")
                : t("admin_tenants.plan_badge_flexible")}
            </div>
          )}
          {form.plan === "free" && (
            <div
              data-testid="tenant-create-free-plan-hint"
              className="text-[11px] text-emerald-300/85 bg-emerald-500/10 border border-emerald-400/30 rounded-md px-3 py-2 -mt-2"
            >
              <span className="font-semibold">🛡️ Free-plan:</span>{" "}
              Evigvarende. Beskyttet mot auto-lock, auto-cancel og auto-delete
              fra livssyklus-cron. Kun manuell endring fra admin.
            </div>
          )}
          <Field
            label={t("admin_tenants.field_status")}
            testId="tenant-create-status"
            render={
              <DarkSelect
                testId="tenant-create-status-input"
                value={form.status}
                onChange={(v) =>
                  setForm({ ...form, status: v as TenantStatus })
                }
                options={STATUS_OPTIONS}
              />
            }
          />
          <Field
            label={t("admin_tenants.field_trial_days")}
            testId="tenant-create-trial-days"
            hint={
              form.plan === "free"
                ? "Ikke aktuelt — free-plan er evigvarende."
                : undefined
            }
            render={
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={form.plan === "free"}
                value={form.plan === "free" ? "" : String(form.trialDays)}
                placeholder={form.plan === "free" ? "—" : "30"}
                onChange={(e) => {
                  // Aksepter kun siffer; tom streng → 0 (men "0" tillates kun
                  // som mellomliggende state, normaliseres ved blur via min=1
                  // i backend om plan!=free). Bruker kan slette helt og taste
                  // nytt tall fritt — ingen leading-zero-konkatenasjon.
                  const raw = e.target.value.replace(/[^0-9]/g, "");
                  const n = raw === "" ? 0 : parseInt(raw, 10);
                  setForm({
                    ...form,
                    trialDays: Number.isFinite(n) ? Math.min(n, 365) : 0,
                  });
                }}
                data-testid="tenant-create-trial-days-input"
                className="w-full font-mono rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/60 disabled:opacity-40 disabled:cursor-not-allowed"
              />
            }
          />
          <Field
            label={t("admin_tenants.field_lifecycle_emails")}
            testId="tenant-create-lifecycle"
            className="col-span-2"
            render={
              <label className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-black/40 border border-white/15 cursor-pointer hover:border-white/25 transition">
                <input
                  type="checkbox"
                  checked={form.lifecycleEmails}
                  onChange={(e) =>
                    setForm({ ...form, lifecycleEmails: e.target.checked })
                  }
                  data-testid="tenant-create-lifecycle-input"
                  className="h-4 w-4 accent-blue-500"
                />
                <span className="text-sm text-white/85">
                  {form.lifecycleEmails
                    ? t("admin_tenants.lifecycle_on")
                    : t("admin_tenants.lifecycle_off")}
                </span>
              </label>
            }
          />
          {/* Iter 19.9.7 locale-fix: gjenbruker eksisterende
              LocaleRadioGroup fra selvbetjenings-registrering (Iter 19.9). */}
          <div className="col-span-2">
            <LocaleRadioGroup
              value={form.locale}
              onChange={(loc) => setForm({ ...form, locale: loc })}
              label={t("register.field_locale")}
            />
          </div>
          <Field
            label={t("admin_tenants.field_notes")}
            testId="tenant-create-notes"
            className="col-span-2"
            render={
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                data-testid="tenant-create-notes-input"
                className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white outline-none focus:border-blue-300/60 resize-none"
              />
            }
          />
          </>)}
        </div>

        {error && (
          <p
            data-testid="tenant-create-error"
            className="mt-3 text-xs text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            data-testid="tenant-create-cancel-btn"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t("admin_tenants.cancel")}
          </Button>
          {isWizard && step > 1 && (
            <Button
              data-testid="tenant-create-wizard-prev-btn"
              variant="secondary"
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
              disabled={busy}
            >
              {t("admin_tenants.wizard_prev")}
            </Button>
          )}
          {isWizard && step < 3 && (
            <Button
              data-testid="tenant-create-wizard-next-btn"
              variant="primary"
              onClick={() => setStep((s) => (s < 3 ? ((s + 1) as 1 | 2 | 3) : s))}
              disabled={busy}
            >
              {t("admin_tenants.wizard_next")}
            </Button>
          )}
          {(!isWizard || step === 3) && (
            <Button
              data-testid="tenant-create-submit-btn"
              variant="primary"
              submit
              busy={busy}
              disabled={!form.subdomain || !form.email || !form.locale}
            >
              {busy ? t("admin_tenants.creating") : t("admin_tenants.create_submit")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

// ─── D-054 inline editors ──────────────────────────────────────────────

function DateEditor({
  label,
  value,
  testId,
  nullable,
  onSave,
}: {
  label: string;
  value: string | null;
  testId: string;
  nullable: boolean;
  onSave: (v: string | null) => void | Promise<void>;
}) {
  // datetime-local krever YYYY-MM-DDTHH:MM (lokaltid). Vi viser ISO som
  // local-streng for editing, men sender ISO UTC tilbake til server.
  const toLocalInput = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [local, setLocal] = useState(toLocalInput(value));
  // Re-sync når parent record oppdateres
  useEffect(() => setLocal(toLocalInput(value)), [value]);

  function commit() {
    if (!local) {
      if (nullable) onSave(null);
      return;
    }
    const d = new Date(local);
    if (isNaN(d.getTime())) return;
    const iso = d.toISOString();
    if (iso !== value) onSave(iso);
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
        {label}
      </span>
      <div className="flex gap-2">
        <input
          type="datetime-local"
          data-testid={testId}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className="flex-1 font-mono text-xs h-[38px] px-3 rounded-lg bg-black/40 border border-white/15 text-white outline-none focus:border-blue-300/60"
        />
        {nullable && local && (
          <button
            type="button"
            onClick={() => {
              setLocal("");
              onSave(null);
            }}
            data-testid={`${testId}-clear`}
            className="px-2 text-xs text-rose-300/70 hover:text-rose-200"
            title="Nullstill"
          >
            ✕
          </button>
        )}
      </div>
    </label>
  );
}

function StringEditor({
  label,
  value,
  placeholder,
  testId,
  nullable = true,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  testId: string;
  /**
   * Iter 19.9.9: false = feltet kan ikke nullstilles. ✕-knappen skjules
   * og onBlur-commit blokkerer null-send (forhindrer silent UI/DB-divergens
   * når parent-handler ignorerer null). Default true for bakoverkompabilitet
   * med Stripe-editorene som har lov å være null.
   */
  nullable?: boolean;
  onSave: (v: string | null) => void | Promise<void>;
}) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);

  function commit() {
    const next = local.trim() === "" ? null : local.trim();
    if (next === null && !nullable) {
      // Obligatorisk felt: tilbakestill til siste lagrede verdi i stedet for
      // å sende null. Forhindrer at clear-knapp eller ad-hoc clearing fører
      // til tap av synkronisering mot server.
      setLocal(value ?? "");
      return;
    }
    if (next !== value) onSave(next);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono w-44 flex-shrink-0">
        {label}
      </span>
      <input
        type="text"
        data-testid={testId}
        value={local}
        placeholder={placeholder}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        className="flex-1 font-mono text-xs h-[34px] px-3 rounded-lg bg-black/40 border border-white/15 text-white outline-none focus:border-blue-300/60"
      />
      {nullable && local && (
        <button
          type="button"
          onClick={() => {
            setLocal("");
            onSave(null);
          }}
          data-testid={`${testId}-clear`}
          className="px-2 text-xs text-rose-300/70 hover:text-rose-200"
          title="Fjern"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Iter 19.9.9 — Locale-velger for admin TenantViewer. Bruker DarkSelect
// (samme glass-mørke popup som plan/status-dropdowns) — IKKE native <select>,
// som ville gitt hvit OS-popup på Safari/macOS (jf. kommentar på DarkSelect-
// komponenten under). Tom verdi (null) representeres som sentinel "__null__"
// i DarkSelect og oversettes tilbake til null i onChange.
const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: "__null__", label: "(ikke satt)" },
  { value: "no", label: "NO — Norsk" },
  { value: "sv", label: "SV — Svensk" },
  { value: "da", label: "DA — Dansk" },
  { value: "en", label: "EN — English" },
];

function LocaleSelectEditor({
  value,
  testId,
  onSave,
}: {
  value: "no" | "sv" | "da" | "en" | null;
  testId: string;
  onSave: (v: "no" | "sv" | "da" | "en" | null) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono w-44 flex-shrink-0">
        locale
      </span>
      <div className="flex-1">
        <DarkSelect
          testId={testId}
          value={value ?? "__null__"}
          onChange={(v) => {
            if (v === "__null__") onSave(null);
            else onSave(v as "no" | "sv" | "da" | "en");
          }}
          options={LOCALE_OPTIONS}
          size="sm"
        />
      </div>
    </div>
  );
}


function NotesEditor({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void | Promise<void>;
}) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => setLocal(value ?? ""), [value]);
  const dirty = local !== (value ?? "");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
          notes (audit-log appendes automatisk)
        </span>
        {dirty && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLocal(value ?? "")}
              data-testid="tenant-detail-notes-cancel"
              className="px-3 py-1 text-[11px] rounded bg-white/10 hover:bg-white/15 text-white/85"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => onSave(local.trim() === "" ? null : local)}
              data-testid="tenant-detail-notes-save"
              className="px-3 py-1 text-[11px] rounded bg-amber-400 hover:bg-amber-300 text-neutral-900 font-medium"
            >
              Lagre
            </button>
          </div>
        )}
      </div>
      <textarea
        data-testid="tenant-detail-notes-textarea"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        rows={6}
        className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-white outline-none focus:border-blue-300/60 resize-y"
      />
    </div>
  );
}

function B2BField({
  labelKey,
  testId,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
  className,
}: {
  labelKey: string;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "number";
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <Field
      label={t(labelKey)}
      testId={`tenant-create-${testId}`}
      className={className}
      render={
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`tenant-create-${testId}-input`}
          className={`w-full rounded-lg bg-black/40 border px-3 py-2 text-sm outline-none focus:border-blue-300/60 ${
            disabled
              ? "border-white/5 text-white/40 cursor-not-allowed"
              : "border-white/15 text-white"
          }`}
        />
      }
    />
  );
}


function FilterSelect({
  testId,
  value,
  onChange,
  options,
  label,
}: {
  testId: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  // Bruk DarkSelect (samme glass-mørke popup som resten av admin-temaet)
  // i stedet for native <select> som får hvit OS-popup. Wrapperen beholder
  // aria-label så assistive tech fortsatt forstår filteret.
  return (
    <div aria-label={label} title={label}>
      <DarkSelect
        testId={testId}
        value={value}
        onChange={onChange}
        options={options}
        size="sm"
      />
    </div>
  );
}

function SubdomainCheckBadge({
  check,
}: {
  check:
    | { state: "idle" }
    | { state: "checking" }
    | { state: "available" }
    | {
        state: "unavailable";
        reason: "taken" | "reserved" | "invalid_format";
      };
}) {
  const { t } = useLocale();
  if (check.state === "idle") return null;
  if (check.state === "checking") {
    return (
      <p
        data-testid="tenant-create-subdomain-status"
        data-state="checking"
        className="text-[11px] text-white/55 font-medium whitespace-nowrap truncate"
      >
        {t("admin_tenants.subdomain_checking")}
      </p>
    );
  }
  if (check.state === "available") {
    return (
      <p
        data-testid="tenant-create-subdomain-status"
        data-state="available"
        className="text-[11px] text-emerald-300 font-medium whitespace-nowrap truncate"
      >
        {t("admin_tenants.subdomain_available")}
      </p>
    );
  }
  const msg =
    check.reason === "taken"
      ? t("admin_tenants.error_exists")
      : check.reason === "reserved"
      ? t("admin_tenants.error_reserved")
      : t("admin_tenants.error_invalid_subdomain");
  return (
    <p
      data-testid="tenant-create-subdomain-status"
      data-state="unavailable"
      data-reason={check.reason}
      className="text-[11px] text-rose-300 font-medium whitespace-nowrap truncate"
    >
      {msg}
    </p>
  );
}

function Field({
  label,
  testId,
  className,
  render,
  hint,
}: {
  label: string;
  testId: string;
  className?: string;
  render: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className={className} data-testid={`${testId}-field`}>
      <label className="block text-[10px] uppercase tracking-wide text-white/55 mb-1.5">
        {label}
      </label>
      {render}
      {hint && (
        <p
          className="mt-1.5 text-[11px] text-white/45 leading-relaxed"
          data-testid={`${testId}-hint`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * D-116 (2026-06-29): DarkSelect ekstrahert til
 * `components/platform/DarkSelect.tsx` så InlineInviteForm + andre
 * am-admin-flater kan gjenbruke samme komponent (D-105). Tidligere bodde
 * den her inline (~100 linjer). Adferd og data-testids er uendret.
 */

const PLAN_OPTIONS: { value: Plan; label: string }[] = [
  { value: "trial", label: "trial" },
  { value: "free", label: "free" },
  { value: "monthly", label: "monthly" },
  { value: "yearly", label: "yearly" },
];

/**
 * Iter 20.8: B2B-spesifikke plan-options (vises kun i B2B-tab-modus).
 * `b2b_yearly` markeres som "Anbefalt" — best margin og lavere churn.
 * Backend støtter dem allerede via VALID_PLANS i /api/admin/tenants.
 */
function getB2BPlanOptions(t: (k: string) => string): { value: Plan; label: string }[] {
  return [
    { value: "trial", label: "trial" },
    { value: "b2b_yearly", label: t("admin_tenants.plan_option_b2b_yearly") },
    { value: "b2b_semiannual", label: t("admin_tenants.plan_option_b2b_semiannual") },
    { value: "free", label: "free" },
  ];
}

const STATUS_OPTIONS: { value: TenantStatus; label: string }[] = [
  { value: "trial", label: "trial" },
  { value: "active", label: "active" },
  { value: "locked", label: "locked" },
  { value: "cancelled", label: "cancelled" },
  { value: "deleted", label: "deleted" },
  { value: "pending", label: "pending" },
  { value: "provisioning_failed", label: "provisioning_failed" },
  { value: "invoice_failed", label: "invoice_failed" },
];
