"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 3 — /platform/test
 *
 * Public side (ingen middleware-beskyttelse) som demoer plan-velgeren som
 * B2C-registreringsflyten (Iter 7+) skal bruke. Fire plan-knapper:
 * Trial / Månedlig / Årlig (B2C — D-037) + Enterprise (B2B — D-038).
 *
 * Klikk på B2C-plan: lagrer valget + viser hva /api/register vil POSTe i
 * Iter 7+ og hvilken Stripe-pris-ID som vil brukes i Iter 11.
 *
 * Klikk på Enterprise: viser mailto-kontaktlink i stedet — B2B er
 * salgsdrevet (D-038), ingen self-service-Stripe-flow.
 *
 * **Stub:** ingen API-kall, ingen redirect, ingen Stripe. Plan-data leses
 * fra `lib/platform/plans.json`, priser/labels fra i18n.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Mail,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useLocale } from "@/lib/i18n-context";
import plansConfig from "@/lib/platform/plans.json";

type PlanId = "trial" | "monthly" | "yearly" | "enterprise";
type PlanEntry = (typeof plansConfig.plans)[number];

interface ClickResult {
  planId: PlanId;
  stripePriceId: string | null;
  contactOnly: boolean;
  contactEmail: string | null;
  clickedAt: string;
}

export default function PlatformTestPage() {
  const { t, locale } = useLocale();
  const [result, setResult] = useState<ClickResult | null>(null);

  function onPick(plan: PlanEntry) {
    setResult({
      planId: plan.id as PlanId,
      stripePriceId: plan.stripePriceId,
      contactOnly: plan.contactOnly ?? false,
      contactEmail:
        "contactEmail" in plan ? (plan.contactEmail as string) : null,
      clickedAt: new Date().toISOString(),
    });
  }

  const bcp47 =
    locale === "no"
      ? "nb-NO"
      : locale === "sv"
      ? "sv-SE"
      : locale === "da"
      ? "da-DK"
      : "en-US";

  return (
    <div
      data-testid="platform-test-page"
      className="min-h-screen w-full bg-neutral-950 text-white"
    >
      {/* Top bar */}
      <div className="border-b border-white/10 bg-neutral-950/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full bg-amber-400/10 border border-amber-300/30 p-2">
              <Sparkles className="h-4 w-4 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h1
                data-testid="platform-test-title"
                className="text-sm font-semibold tracking-tight"
              >
                {t("platform_test.title")}
              </h1>
              <p className="text-[10px] text-white/50">
                {t("platform_test.subtitle")}
              </p>
            </div>
          </div>
          <Link
            data-testid="platform-test-back-link"
            href="/platform/admin"
            prefetch={false}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-full bg-white/10 hover:bg-white/15 border border-white/20 text-white/80 hover:text-white transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("platform_test.back_to_admin")}
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight mb-2">
            {t("platform_test.heading")}
          </h2>
          <p className="text-sm text-white/55 max-w-2xl mx-auto">
            {t("platform_test.intro")}
          </p>
        </div>

        {/* Plan-kort — 4 kolonner desktop, 2 tablet, 1 mobil */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {plansConfig.plans.map((plan) => {
            const planId = plan.id as PlanId;
            const isPicked = result?.planId === planId;
            const tone =
              plan.ctaTone === "primary"
                ? "bg-blue-500 hover:bg-blue-600 text-white"
                : plan.ctaTone === "accent"
                ? "bg-amber-400 hover:bg-amber-300 text-neutral-900"
                : plan.ctaTone === "contact"
                ? "bg-violet-500 hover:bg-violet-600 text-white"
                : "bg-white/10 hover:bg-white/15 text-white border border-white/20";
            return (
              <div
                key={planId}
                data-testid={`platform-test-plan-card-${planId}`}
                className={`rounded-2xl border bg-white/5 backdrop-blur-xl p-6 flex flex-col transition ${
                  isPicked
                    ? "border-emerald-400/60 shadow-lg shadow-emerald-500/10"
                    : "border-white/10"
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3
                    className="text-base font-semibold"
                    data-testid={`platform-test-plan-name-${planId}`}
                  >
                    {t(`platform_test.plan_${planId}_name`)}
                  </h3>
                  {isPicked && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-300 flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-white/55 mb-4">
                  {t(`platform_test.plan_${planId}_desc`)}
                </p>
                <div className="text-2xl font-bold mb-4">
                  {t(`platform_test.plan_${planId}_price`)}
                </div>
                <ul className="space-y-1.5 text-xs text-white/70 mb-6 flex-1">
                  <li className="flex gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-300 flex-shrink-0 mt-0.5" />
                    <span>{t(`platform_test.plan_${planId}_bullet1`)}</span>
                  </li>
                  <li className="flex gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-300 flex-shrink-0 mt-0.5" />
                    <span>{t(`platform_test.plan_${planId}_bullet2`)}</span>
                  </li>
                </ul>
                <button
                  type="button"
                  data-testid={`platform-test-plan-cta-${planId}`}
                  onClick={() => onPick(plan)}
                  className={`h-10 rounded-full px-4 text-sm font-medium transition inline-flex items-center justify-center gap-1.5 ${tone}`}
                >
                  {plan.ctaTone === "contact" && (
                    <Mail className="h-3.5 w-3.5" />
                  )}
                  {t(`platform_test.plan_${planId}_cta`)}
                </button>
              </div>
            );
          })}
        </div>

        {/* Resultat-panel — synlig først etter klikk */}
        {result && (
          <div
            data-testid="platform-test-result-panel"
            className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 backdrop-blur-xl p-5 animate-fade-in"
          >
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              <h3 className="text-sm font-semibold text-emerald-200">
                {t("platform_test.result_title")}
              </h3>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <div className="flex flex-col">
                <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                  {t("platform_test.result_plan")}
                </dt>
                <dd
                  className="text-white font-mono"
                  data-testid="platform-test-result-plan"
                >
                  {result.planId}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                  {t("platform_test.result_clicked_at")}
                </dt>
                <dd
                  className="text-white font-mono"
                  data-testid="platform-test-result-timestamp"
                >
                  {new Date(result.clickedAt).toLocaleString(bcp47)}
                </dd>
              </div>
              {result.contactOnly ? (
                <div className="flex flex-col">
                  <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                    {t("platform_test.result_contact_email")}
                  </dt>
                  <dd className="text-white font-mono">
                    {result.contactEmail ?? "—"}
                  </dd>
                </div>
              ) : (
                <div className="flex flex-col">
                  <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                    {t("platform_test.result_stripe_price_id")}
                  </dt>
                  <dd className="text-white/70 font-mono">
                    {result.stripePriceId ?? (
                      <span className="text-amber-300">
                        {t("platform_test.result_stripe_pending")}
                      </span>
                    )}
                  </dd>
                </div>
              )}
              <div className="flex flex-col sm:col-span-2">
                <dt className="text-white/40 font-mono text-[10px] uppercase tracking-wide">
                  {t("platform_test.result_next_step")}
                </dt>
                <dd className="text-white/85 font-mono break-all">
                  {result.contactOnly && result.contactEmail
                    ? `mailto:${result.contactEmail}?subject=Ko | Do · Vault — Enterprise`
                    : `POST /api/register?plan=${result.planId}`}
                </dd>
              </div>
            </dl>
            <p className="mt-4 pt-3 border-t border-emerald-400/20 text-[11px] text-white/55">
              {result.contactOnly
                ? t("platform_test.result_stub_note_contact")
                : t("platform_test.result_stub_note")}
            </p>
            {!result.contactOnly && (
              <div className="mt-4 flex justify-end">
                <Link
                  data-testid="platform-test-goto-register"
                  href={`/platform/register?plan=${result.planId}`}
                  prefetch={false}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-amber-400 hover:bg-amber-300 text-neutral-900 text-sm font-medium transition"
                >
                  {t("platform_test.result_goto_register")}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Iter 4 — Public subdomain-check live demo */}
        <SubdomainCheckDemo />
      </div>
    </div>
  );
}

type CheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | {
      state: "unavailable";
      reason: "invalid_format" | "reserved" | "taken";
    }
  | { state: "error"; message: string };

function SubdomainCheckDemo() {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [check, setCheck] = useState<CheckState>({ state: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>("");

  // Debounced live-check — 350ms etter siste tastetrykk.
  // Aborterer ikke pågående fetch (acceptabelt for stub), men ignorerer
  // svar hvis input har endret seg siden fetch startet.
  useEffect(() => {
    const trimmed = value.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setCheck({ state: "idle" });
      return;
    }
    setCheck({ state: "checking" });
    debounceRef.current = setTimeout(async () => {
      const query = trimmed;
      lastQueryRef.current = query;
      try {
        const res = await fetch(
          `/api/register/subdomain-check?subdomain=${encodeURIComponent(query)}`,
        );
        if (lastQueryRef.current !== query) return; // ignore stale response
        const body = (await res.json().catch(() => ({}))) as {
          available?: boolean;
          reason?: "invalid_format" | "reserved" | "taken";
          error?: string;
        };
        if (body.available === true) {
          setCheck({ state: "available" });
        } else if (body.reason) {
          setCheck({ state: "unavailable", reason: body.reason });
        } else if (body.error) {
          setCheck({ state: "error", message: body.error });
        } else {
          setCheck({ state: "idle" });
        }
      } catch (err) {
        if (lastQueryRef.current !== query) return;
        setCheck({
          state: "error",
          message: err instanceof Error ? err.message : "fetch_failed",
        });
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div
      data-testid="platform-test-subdomain-demo"
      className="mt-10 rounded-2xl border border-blue-400/20 bg-blue-500/5 backdrop-blur-xl p-6"
    >
      <div className="flex items-center gap-2 mb-2">
        <Search className="h-4 w-4 text-blue-300" />
        <h3 className="text-sm font-semibold text-blue-100">
          {t("platform_test.iter4_title")}
        </h3>
      </div>
      <p className="text-xs text-white/55 mb-4">
        {t("platform_test.iter4_intro")}
      </p>

      <div className="space-y-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono mb-1.5 block">
            {t("platform_test.iter4_label")}
          </span>
          <div className="relative">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("platform_test.iter4_placeholder")}
              data-testid="platform-test-subdomain-input"
              autoComplete="off"
              className={`w-full font-mono rounded-lg bg-black/40 border pl-3 pr-10 py-2.5 text-sm text-white outline-none transition ${
                check.state === "available"
                  ? "border-emerald-400/60 focus:border-emerald-300"
                  : check.state === "unavailable" || check.state === "error"
                  ? "border-rose-400/60 focus:border-rose-300"
                  : "border-white/15 focus:border-blue-300/60"
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {check.state === "checking" && (
                <Loader2 className="h-4 w-4 text-white/55 animate-spin" />
              )}
              {check.state === "available" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              )}
              {(check.state === "unavailable" || check.state === "error") && (
                <X className="h-4 w-4 text-rose-300" />
              )}
            </div>
          </div>
        </label>

        <SubdomainStatusBadge check={check} />

        <div
          data-testid="platform-test-subdomain-raw"
          className="mt-4 pt-3 border-t border-blue-400/15 text-[11px] text-white/50 font-mono"
        >
          <span className="text-white/40 uppercase tracking-wide mr-2">
            GET
          </span>
          /api/register/subdomain-check?subdomain={value.trim() || "<tom>"}
        </div>
      </div>
    </div>
  );
}

function SubdomainStatusBadge({ check }: { check: CheckState }) {
  const { t } = useLocale();
  if (check.state === "idle") {
    return (
      <p
        data-testid="platform-test-subdomain-status"
        data-state="idle"
        className="text-[11px] text-white/40 italic"
      >
        {t("platform_test.iter4_hint")}
      </p>
    );
  }
  if (check.state === "checking") {
    return (
      <p
        data-testid="platform-test-subdomain-status"
        data-state="checking"
        className="text-[11px] text-white/55"
      >
        {t("admin_tenants.subdomain_checking")}
      </p>
    );
  }
  if (check.state === "available") {
    return (
      <p
        data-testid="platform-test-subdomain-status"
        data-state="available"
        className="text-[11px] text-emerald-300 font-medium"
      >
        {t("admin_tenants.subdomain_available")}
      </p>
    );
  }
  if (check.state === "error") {
    return (
      <p
        data-testid="platform-test-subdomain-status"
        data-state="error"
        className="text-[11px] text-rose-300 font-medium"
      >
        {check.message}
      </p>
    );
  }
  const msg =
    check.reason === "reserved"
      ? t("admin_tenants.error_reserved")
      : check.reason === "taken"
      ? t("admin_tenants.error_exists")
      : t("admin_tenants.error_invalid_subdomain");
  return (
    <p
      data-testid="platform-test-subdomain-status"
      data-state="unavailable"
      data-reason={check.reason}
      className="text-[11px] text-rose-300 font-medium"
    >
      {msg}
    </p>
  );
}
