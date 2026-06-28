"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — ClientConfigEditor (D-060)
 *
 * Vises i TenantDetailCard. Henter current config fra
 * /api/admin/client-config?id=<subdomain>, lar admin redigere som JSON,
 * validerer mot syntax-feil før save, og lagrer via PUT.
 *
 * "Reset til default"-knapp henter default-template med _meta mutert for
 * subdomenet og legger inn i editoren (ikke lagret før admin trykker Lagre).
 *
 * Iter 19.9.6 (#4 NOTES-cleanup, 2026-06-25): `_meta.notes` filtreres bort
 * både på load (admin ser ren JSON) og på save (admin kan ikke smugle inn
 * notater). Begrunnelse: etter Iter 19.9.2 vises ikke `_meta.notes` lenger
 * i klient-SettingsPanel — admin har sitt eget `tenant.notes`-felt i
 * TenantViewer for audit-notater. Eksisterende `_meta.notes`-verdier i
 * Upstash bevares (ingen destruktiv migrering), men er nå usynlige og
 * uredigerbare gjennom editoren.
 */
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save } from "lucide-react";

interface ClientConfigEditorProps {
  subdomain: string;
}

type LoadState =
  | { state: "loading" }
  | { state: "ready"; source: "upstash" | "default" }
  | { state: "error"; error: string };

/**
 * Fjern `_meta.notes` fra et config-objekt (mutering av kopi, ikke original).
 * Brukes både ved load (skjul fra editor) og save (hindre re-introduksjon).
 */
function stripMetaNotes(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...config };
  const meta = copy._meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const metaCopy = { ...(meta as Record<string, unknown>) };
    delete metaCopy.notes;
    copy._meta = metaCopy;
  }
  return copy;
}

export function ClientConfigEditor({ subdomain }: ClientConfigEditorProps) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [text, setText] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  async function loadConfig() {
    setLoad({ state: "loading" });
    setSaveMsg(null);
    try {
      const res = await fetch(
        `/api/admin/client-config?id=${encodeURIComponent(subdomain)}`,
        { credentials: "same-origin" },
      );
      const body = (await res.json()) as
        | {
            ok: true;
            config: Record<string, unknown>;
            source: "upstash" | "default";
          }
        | { error: string };
      if (!res.ok || "error" in body) {
        throw new Error(("error" in body && body.error) || `HTTP ${res.status}`);
      }
      // Iter 19.9.6 #4: skjul `_meta.notes` fra editor — admin har egen
      // notatfunksjon i TenantViewer, og dette feltet rendres ikke i UI
      // lenger etter Iter 19.9.2 SettingsPanel-refaktor.
      const cleaned = stripMetaNotes(body.config);
      setText(JSON.stringify(cleaned, null, 2));
      setLoad({ state: "ready", source: body.source });
    } catch (e) {
      setLoad({
        state: "error",
        error: e instanceof Error ? e.message : "load_failed",
      });
    }
  }

  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subdomain]);

  function validateJson(raw: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setValidationError("Config må være et JSON-objekt på øverste nivå.");
        return null;
      }
      setValidationError(null);
      return parsed as Record<string, unknown>;
    } catch (e) {
      setValidationError(
        "JSON-feil: " + (e instanceof Error ? e.message : "unknown"),
      );
      return null;
    }
  }

  async function onSave() {
    if (saveBusy) return;
    const parsed = validateJson(text);
    if (!parsed) return;
    setSaveBusy(true);
    setSaveMsg(null);
    try {
      // Iter 19.9.6 #4: strip `_meta.notes` også på save — hvis admin
      // skriver inn et notes-felt manuelt, persister vi det ikke.
      const cleaned = stripMetaNotes(parsed);
      const res = await fetch(
        `/api/admin/client-config?id=${encodeURIComponent(subdomain)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleaned),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        setSaveMsg("❌ " + (body.error ?? `HTTP ${res.status}`));
        return;
      }
      setSaveMsg("✓ Lagret. Tenant ser endring innen 30 sek (browser-cache).");
      setLoad({ state: "ready", source: "upstash" });
    } catch (e) {
      setSaveMsg("❌ " + (e instanceof Error ? e.message : "network_error"));
    } finally {
      setSaveBusy(false);
    }
  }

  async function onResetToDefault() {
    if (resetBusy) return;
    if (
      !window.confirm(
        `Tilbakestill ${subdomain} til default-template? (Ikke lagret før du trykker Lagre.)`,
      )
    ) {
      return;
    }
    setResetBusy(true);
    try {
      // Slett fra Upstash → neste GET returnerer default-template
      const delRes = await fetch(
        `/api/admin/client-config?id=${encodeURIComponent(subdomain)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!delRes.ok) {
        const body = (await delRes.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${delRes.status}`);
      }
      await loadConfig();
      setSaveMsg(
        "✓ Slettet fra Upstash. Tenant bruker default. Klikk Lagre for å persistere editert versjon.",
      );
    } catch (e) {
      setSaveMsg("❌ " + (e instanceof Error ? e.message : "network_error"));
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div
      data-testid="client-config-editor"
      className="flex flex-col h-full min-h-0 gap-3"
    >
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wide text-white/55 font-mono">
            Client config
          </span>
          {load.state === "ready" && (
            <span
              className={`text-[10px] font-mono ${
                load.source === "upstash"
                  ? "text-emerald-300"
                  : "text-amber-300"
              }`}
            >
              {load.source === "upstash"
                ? "lagret"
                : "default (ikke lagret)"}
            </span>
          )}
        </div>
      </div>

      {load.state === "loading" && (
        <div className="flex items-center gap-2 text-xs text-white/55">
          <Loader2 className="h-3 w-3 animate-spin" />
          Laster…
        </div>
      )}

      {load.state === "error" && (
        <div
          data-testid="client-config-load-error"
          className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
        >
          <AlertCircle className="h-3 w-3 inline mr-1" />
          {load.error}
        </div>
      )}

      {load.state === "ready" && (
        <>
          <textarea
            data-testid="client-config-textarea"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (validationError) validateJson(e.target.value);
            }}
            onBlur={() => validateJson(text)}
            spellCheck={false}
            className="flex-1 min-h-[200px] w-full px-3 py-2 rounded-md bg-black/40 border border-white/15 text-[12px] leading-relaxed text-white/90 font-mono focus:border-blue-500 focus:outline-none resize-none"
          />
          {validationError && (
            <div
              data-testid="client-config-validation-error"
              className="shrink-0 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-2 py-1.5"
            >
              {validationError}
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="client-config-save-btn"
              onClick={onSave}
              disabled={saveBusy || !!validationError}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium flex items-center gap-1.5 transition"
            >
              {saveBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {saveBusy ? "Lagrer…" : "Lagre"}
            </button>
            <button
              type="button"
              data-testid="client-config-reset-btn"
              onClick={onResetToDefault}
              disabled={resetBusy}
              className="text-xs px-3 py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-200 border border-amber-500/30 flex items-center gap-1.5 transition"
            >
              {resetBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
              Reset til default
            </button>
          </div>
          {saveMsg && (
            <div
              data-testid="client-config-save-msg"
              className={`shrink-0 text-xs font-mono rounded-md px-2 py-1.5 break-all ${
                saveMsg.startsWith("✓")
                  ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/30"
                  : "text-red-300 bg-red-500/10 border border-red-500/30"
              }`}
            >
              {saveMsg.startsWith("✓") ? (
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
              ) : (
                <AlertCircle className="h-3 w-3 inline mr-1" />
              )}
              {saveMsg.replace(/^[✓❌]\s*/, "")}
            </div>
          )}
        </>
      )}
    </div>
  );
}
