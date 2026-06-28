"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 9 (D-066/D-067 · 2026-06-04)
 *
 * Gjenbrukbar provisjonerings-tracker. Brukes av:
 *   - Skjerm 5 (/platform/register) — public mode, kun polling
 *   - Admin-modal (TenantViewer) — admin mode, orkestrerer Upstash → Vercel
 *
 * Begge modi ender med `/api/status`-polling for å fange `vault_live`.
 *
 * Public mode: provisjonering startes av /api/register. Vi poller bare.
 * Admin mode: vi orkestrerer kallene mot D-055 retry-rutene
 *             (/api/admin/tenants/<sub>/provision-upstash, deretter
 *             /provision-vercel), så starter polling automatisk.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Sparkles, X } from "lucide-react";

export type ProvisioningTrackerMode = "public" | "admin";

export type StatusEvent = {
  timestamp: string;
  stage: string;
  status: string;
  detail?: string;
};

export type StatusResponse = {
  vaultLive: boolean;
  status: string;
  latestEvent: StatusEvent | null;
  recentEvents: StatusEvent[];
};

const STEPS: { stage: string; label: string }[] = [
  { stage: "upstash_create", label: "Sikker lagring opprettet" },
  { stage: "vercel_create", label: "Vault-miljø konfigurert" },
  { stage: "vercel_env", label: "Kryptering satt opp" },
  { stage: "vercel_redeploy", label: "Vault startet" },
  { stage: "subdomain_attach", label: "Kobler til kodovault.no" },
  { stage: "vault_live", label: "Vault er live" },
];

const STAGE_MESSAGES_NO: Record<string, string> = {
  upstash_create: "Oppretter sikker lagring…",
  vercel_create: "Konfigurerer vault-miljø…",
  vercel_env: "Setter opp kryptering…",
  vercel_redeploy: "Starter din vault…",
  subdomain_attach: "Kobler til kodovault.no…",
  vault_live: "Din vault er klar!",
};

export function ProvisioningTracker({
  subdomain,
  mode,
  onDone,
  onClose,
  className = "",
}: {
  subdomain: string;
  mode: ProvisioningTrackerMode;
  onDone?: (success: boolean) => void;
  /**
   * D-097 (2026-06-28): kalles av "Lukk"-knappen i B2B-parent-skipped-
   * dialogen. Hvis utelatt faller komponenten tilbake til kun `onDone(true)`.
   */
  onClose?: () => void;
  className?: string;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "starting_upstash" | "starting_vercel" | "polling" | "done"
  >(mode === "admin" ? "starting_upstash" : "polling");
  // Iter 20.9 (D-088, 2026-06-27): B2B parent (`<prefix>-admin`) bruker
  // host-prefix-routing — har ingen vault, ingen tenant-Upstash, ingen egen
  // Vercel-pod. provision-vercel/upstash returnerer { skipped: true } og vi
  // viser en KORT dialog med "Klar — ingen vault" i stedet for å polle.
  const [isB2BParentSkipped, setIsB2BParentSkipped] = useState(false);
  const startedRef = useRef(false);

  // Admin-mode: orkestrer Upstash + Vercel før polling tar over
  useEffect(() => {
    if (mode !== "admin" || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        setPhase("starting_upstash");
        const u = await fetch(
          `/api/admin/tenants/${encodeURIComponent(subdomain)}/provision-upstash`,
          { method: "POST", credentials: "same-origin" },
        );
        const uBody = (await u.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          detail?: string;
          skipped?: boolean;
          reason?: string;
        };
        if (!u.ok || !uBody.ok) {
          setError(
            `Upstash: ${uBody.detail || uBody.error || `HTTP ${u.status}`}`,
          );
          // Polling vil fortsatt vise log med failed-event
          setPhase("polling");
          return;
        }

        setPhase("starting_vercel");
        const v = await fetch(
          `/api/admin/tenants/${encodeURIComponent(subdomain)}/provision-vercel`,
          { method: "POST", credentials: "same-origin" },
        );
        const vBody = (await v.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          detail?: string;
          skipped?: boolean;
          reason?: string;
        };
        if (!v.ok || !vBody.ok) {
          setError(
            `Vercel: ${vBody.detail || vBody.error || `HTTP ${v.status}`}`,
          );
          setPhase("polling");
          return;
        }

        // D-088: hvis begge ble skippet (B2B parent), short-circuit til done.
        // Ingen polling — ingen vault eksisterer på dette subdomenet.
        if (uBody.skipped === true && vBody.skipped === true) {
          setIsB2BParentSkipped(true);
          setPhase("done");
          onDone?.(true);
          return;
        }

        setPhase("polling");
      } catch (e) {
        setError(e instanceof Error ? e.message : "network_error");
        setPhase("polling");
      }
    })();
  }, [mode, subdomain]);

  // Polling — kjører alltid (også underveis i admin-orkestrering, slik at
  // log-events vises mens kjeden går). D-088 unntak: B2B parent som ble
  // skippet har ingen vault å polle.
  useEffect(() => {
    if (isB2BParentSkipped) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/status?subdomain=${encodeURIComponent(subdomain)}`,
          { credentials: "omit" },
        );
        if (!res.ok) {
          if (!cancelled) {
            timer = setTimeout(poll, 2000);
          }
          return;
        }
        const body = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(body);
        if (body.vaultLive) {
          setPhase("done");
          onDone?.(true);
          return;
        }
        if (body.status === "provisioning_failed") {
          setPhase("done");
          onDone?.(false);
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch {
        if (cancelled) return;
        timer = setTimeout(poll, 2000);
      }
    }
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [subdomain, onDone, isB2BParentSkipped]);

  const stage = status?.latestEvent?.stage ?? null;
  const failed = status?.status === "provisioning_failed";
  const live = status?.vaultLive === true;
  const events = status?.recentEvents ?? [];

  // Bygg checklist: hvilke steg er gjennomført?
  // D-067 fix: scan alle events for hver stage. ok-event = grønn, uansett
  // om det også finnes en retried/failed-event på samme stage. Dette gjør
  // det robust mot rekkefølgen events kommer i fra API'et.
  const stepState = STEPS.map((s) => {
    const matches = events.filter((e) => e.stage === s.stage);
    const okEvent = matches.find((e) => e.status === "ok");
    const failedEvent = matches.find((e) => e.status === "failed");
    if (okEvent) return { ...s, state: "ok" as const, detail: okEvent.detail };
    if (failedEvent)
      return { ...s, state: "failed" as const, detail: failedEvent.detail };
    return { ...s, state: "pending" as const, detail: undefined };
  });

  // Aktivt steg = første pending (med mindre vi er live/failed)
  let activeIdx = stepState.findIndex((s) => s.state === "pending");
  if (live) activeIdx = -1;

  let headerMessage: string;
  let headerDetail: string | null = null;
  if (failed) {
    headerMessage = "Noe gikk galt — vi har varslet teamet";
    headerDetail = error ?? status?.latestEvent?.detail ?? null;
  } else if (live) {
    headerMessage = "Din vault er klar!";
  } else if (stage && STAGE_MESSAGES_NO[stage]) {
    headerMessage = STAGE_MESSAGES_NO[stage];
  } else if (phase === "starting_upstash") {
    headerMessage = "Oppretter sikker lagring…";
  } else if (phase === "starting_vercel") {
    headerMessage = "Konfigurerer vault-miljø…";
  } else {
    headerMessage = "Starter opp…";
  }

  return (
    <div
      data-testid="provisioning-tracker"
      className={`rounded-2xl border border-emerald-400/30 bg-emerald-500/5 backdrop-blur-xl p-6 ${className}`}
    >
      {/* D-088: B2B parent får en kort, distinkt dialog som forklarer
          at am-admin ikke er en vault og at host-routing er klar. */}
      {isB2BParentSkipped ? (
        <div data-testid="provisioning-tracker-b2b-parent">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 className="h-7 w-7 text-emerald-300 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-lg font-semibold text-white">
                Org-konsoll klar
              </p>
              <p className="text-xs font-mono text-emerald-200/80 mt-1">
                {subdomain}.kodovault.no
              </p>
            </div>
          </div>
          <div className="space-y-2 text-sm text-white/75 leading-relaxed pl-10">
            <p>
              Dette er en{" "}
              <span className="text-amber-200 font-medium">
                bedrifts-admin
              </span>{" "}
              (ikke en vault). Den lagrer ingen kryptert data — kun
              org-metadata i sentral database.
            </p>
            <ul className="space-y-1.5 mt-3 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-emerald-300 mt-0.5">✓</span>
                <span>Org-metadata lagret (sentral Upstash)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-300 mt-0.5">✓</span>
                <span>Ingen egen Vercel-pod (host-prefix-routing)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-300 mt-0.5">✓</span>
                <span>Klar — opprett super-admin neste steg</span>
              </li>
            </ul>
          </div>
          <button
            onClick={() => {
              onDone?.(true);
              onClose?.();
            }}
            className="mt-5 w-full px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm transition"
            data-testid="provisioning-tracker-b2b-close"
          >
            Lukk
          </button>
        </div>
      ) : (
        <DefaultTrackerBody
          live={live}
          failed={failed}
          headerMessage={headerMessage}
          headerDetail={headerDetail}
          subdomain={subdomain}
          stepState={stepState}
          activeIdx={activeIdx}
        />
      )}
    </div>
  );
}

// ─── Default body (eksisterende UI for vault-provisjonering) ───────────
function DefaultTrackerBody({
  live,
  failed,
  headerMessage,
  headerDetail,
  subdomain,
  stepState,
  activeIdx,
}: {
  live: boolean;
  failed: boolean;
  headerMessage: string;
  headerDetail: string | null;
  subdomain: string;
  stepState: Array<{ stage: string; label: string; state: "ok" | "failed" | "pending"; detail?: string }>;
  activeIdx: number;
}) {
  return (
    <>
      <div className="flex items-start gap-3 mb-5">
        {live ? (
          <CheckCircle2 className="h-7 w-7 text-emerald-300 shrink-0 mt-0.5" />
        ) : failed ? (
          <X className="h-7 w-7 text-red-300 shrink-0 mt-0.5" />
        ) : (
          <Loader2 className="h-7 w-7 text-amber-300 shrink-0 animate-spin mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div
            data-testid="provisioning-tracker-message"
            className={`text-lg font-semibold leading-tight ${
              live
                ? "text-emerald-200"
                : failed
                ? "text-red-200"
                : "text-white"
            }`}
          >
            {headerMessage}
          </div>
          {headerDetail && (
            <div className="text-sm text-red-300/85 mt-1 break-all">
              {headerDetail}
            </div>
          )}
          <div className="text-sm text-white/55 mt-1 font-mono break-all">
            {subdomain}.kodovault.no
          </div>
        </div>
      </div>

      {/* Checklist — viser progresjon visuelt med ✅ */}
      <ul className="space-y-2 mb-4">
        {stepState.map((s, i) => {
          const isActive = !live && !failed && i === activeIdx;
          const done = s.state === "ok";
          const stepFailed = s.state === "failed";
          return (
            <li
              key={s.stage}
              data-testid={`provisioning-step-${s.stage}`}
              className={`flex items-center gap-3 text-base ${
                done
                  ? "text-emerald-200"
                  : stepFailed
                  ? "text-red-200"
                  : isActive
                  ? "text-white"
                  : "text-white/40"
              }`}
            >
              <span className="w-6 h-6 shrink-0 flex items-center justify-center">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : stepFailed ? (
                  <X className="h-5 w-5 text-red-400" />
                ) : isActive ? (
                  <Loader2 className="h-5 w-5 text-amber-300 animate-spin" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-white/25" />
                )}
              </span>
              <span className={`${isActive ? "font-medium" : ""}`}>
                {s.label}
              </span>
            </li>
          );
        })}
      </ul>

      {live && (
        <div className="pt-4 border-t border-emerald-400/20">
          <a
            data-testid="provisioning-tracker-go-to-vault"
            href={`https://${subdomain}.kodovault.no`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-semibold transition"
          >
            <Sparkles className="h-4 w-4" />
            Åpne vault
          </a>
        </div>
      )}

      {!live && !failed && (
        <div className="pt-3 mt-1 border-t border-amber-400/20 text-xs text-white/55">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
            Sjekker hvert 2. sekund — Vercel-bygget tar typisk 1-3 min
          </div>
        </div>
      )}

      {failed && (
        <div className="pt-4 border-t border-red-400/20 text-sm text-white/65">
          Ko | Do-teamet er varslet. Du kan retry-e via D-055-knappene på
          tenant-detaljvisningen.
        </div>
      )}
    </>
  );
}
