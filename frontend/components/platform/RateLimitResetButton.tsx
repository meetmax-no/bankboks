"use client";
/**
 * Ko | Do · Vault — D-152 (2026-02) — RateLimitResetButton
 *
 * Utplukket fra TenantViewer.tsx til egen fil så den kan gjenbrukes av
 * Test Tools sub-tab "Rate-Limit". Innhold uendret fra opprinnelig.
 */
import { useState } from "react";

export function RateLimitResetButton() {
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
