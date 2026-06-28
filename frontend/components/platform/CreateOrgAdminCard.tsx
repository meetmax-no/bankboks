"use client";
/**
 * Ko | Do · Vault — Iter 20.2 — CreateOrgAdminCard
 *
 * Vises i Mike's TenantViewer for B2B-parents med tenantPrefix. Lar Mike
 * opprette første super-admin for org-admin-modulen.
 *
 * UI-flyt:
 *   1. Card vises kollapset med "+ Opprett am-admin-konto"-knapp
 *   2. Klikk → form for firstName, lastName, email, password (med generator)
 *   3. Submit → POST /api/admin/tenants/[subdomain]/create-org-admin
 *   4. Suksess → vis admin-info + login-URL kopierbar, behold formen kollapset
 *
 * Etter første opprettelse vises card-en med "Opprettet ✓"-stempel + login-URL.
 */
import { useState, useCallback, useEffect } from "react";
import { Loader2, Plus, ShieldCheck, Copy, Check } from "lucide-react";

type Props = {
  subdomain: string;
  tenantPrefix: string;
  /** Hint fra parent — om en super-admin allerede er opprettet (fra
   *  provisioningLog). Hvis true vises card-en som "lukket" med info-tekst. */
  hasExistingSuperAdmin: boolean;
};

type CreateResult = {
  admin: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: "super-admin" | "admin";
    createdAt: string;
  };
  superAdminCount: number;
  loginUrl: string;
  /**
   * Iter 20.9 (D-081): Status på velkomstmail sendt av create-org-admin-
   * endepunktet. `skipped` betyr EMAIL_ENABLED er av (lokal-dev). `ok=true`
   * → mail levert til Resend. `ok=false` + `error` → leveringsfeil.
   */
  welcomeEmail?:
    | { ok: true; emailId?: string }
    | { ok: false; error: string }
    | { skipped: true; reason: string };
};

function generatePassword(): string {
  // Generer 20-tegns passord: 4 grupper á 5 alfanum med bindestrek
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz23456789";
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let chunk = "";
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 5; i++) chunk += alphabet[bytes[i] % alphabet.length];
    groups.push(chunk);
  }
  return groups.join("-");
}

export function CreateOrgAdminCard({
  subdomain,
  tenantPrefix,
  hasExistingSuperAdmin,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // D-107 (2026-06-28, Mike): Hent OPPRINNELIG super-admin for å vise
  // "opprinnelig kontaktperson" når Admin-modulen er aktiv.
  const [firstAdmin, setFirstAdmin] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    createdAt: string;
    suspended: boolean;
  } | null>(null);
  const [firstAdminLoaded, setFirstAdminLoaded] = useState(false);

  useEffect(() => {
    if (!hasExistingSuperAdmin) {
      setFirstAdminLoaded(true);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/admin/tenants/${encodeURIComponent(subdomain)}/first-org-admin`,
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: { admin: typeof firstAdmin }) => {
        if (cancelled) return;
        setFirstAdmin(d.admin ?? null);
        setFirstAdminLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFirstAdminLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasExistingSuperAdmin, subdomain]);

  const handleGenerate = useCallback(() => {
    setPassword(generatePassword());
  }, []);

  const handleCopy = useCallback(async (field: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField((cur) => (cur === field ? null : cur)), 1500);
    } catch {
      // ignore
    }
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch(
          `/api/admin/tenants/${encodeURIComponent(subdomain)}/create-org-admin`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              firstName,
              lastName,
              email,
              password,
              role: "super-admin",
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.detail || data.error || "Opprettelse feilet.");
          return;
        }
        setResult(data as CreateResult);
        // Behold passordet synlig i resultatet — Mike trenger det for å sende
        // til org-en. Tøm bare e-post-feltet så han kan legge til en til.
        setFirstName("");
        setLastName("");
        setEmail("");
        setExpanded(false);
      } catch {
        setError("Kunne ikke nå serveren.");
      } finally {
        setSubmitting(false);
      }
    },
    [subdomain, firstName, lastName, email, password],
  );

  // Vis kollapsert info-card hvis allerede opprettet og brukeren ikke har
  // ekspandert for å lage flere.
  if (hasExistingSuperAdmin && !expanded && !result) {
    const fullName = firstAdmin
      ? `${firstAdmin.firstName} ${firstAdmin.lastName}`.trim()
      : null;
    const createdDate = firstAdmin
      ? new Date(firstAdmin.createdAt).toLocaleDateString("no-NO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : null;
    return (
      <div
        className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.04] p-6"
        data-testid="create-org-admin-card-existing"
      >
        {/* D-107 (2026-06-28, Mike): "Admin Modul Aktiv" — tidligere "am-admin-modul aktiv".
            Header med ikon + tittel + knapp. Skikkelig padding så knappen ikke klemmes. */}
        <div className="flex items-start justify-between gap-6 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
            </div>
            <div className="min-w-0">
              <h3
                className="text-sm font-semibold text-emerald-100"
                data-testid="admin-module-active-heading"
              >
                Admin Modul Aktiv
              </h3>
              <p className="text-[11px] text-emerald-100/55 mt-0.5 truncate font-mono">
                {tenantPrefix}-admin.kodovault.no
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/[0.06] hover:bg-white/[0.10] border border-white/15 text-xs text-white/85 transition whitespace-nowrap"
            data-testid="create-org-admin-add-another"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Legg til en til
          </button>
        </div>

        {/* D-107 — Opprinnelig super-admin (kontaktperson) */}
        <div
          className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
          data-testid="first-super-admin-info"
        >
          <div className="text-[10px] uppercase tracking-wide text-white/45 font-mono mb-2">
            Opprinnelig super-admin
          </div>
          {!firstAdminLoaded ? (
            <div className="flex items-center gap-2 text-xs text-white/55">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Henter...
            </div>
          ) : firstAdmin ? (
            <div className="space-y-1">
              <div className="text-sm text-white/95 font-medium">
                {fullName || "(navn ikke satt)"}
                {firstAdmin.suspended && (
                  <span
                    className="ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] uppercase bg-amber-500/20 text-amber-300 align-middle"
                    data-testid="first-super-admin-suspended"
                  >
                    suspended
                  </span>
                )}
              </div>
              <div className="text-xs text-white/65 font-mono break-all">
                {firstAdmin.email}
              </div>
              <div className="text-[11px] text-white/40">
                Opprettet {createdDate}
              </div>
            </div>
          ) : (
            <div
              className="text-xs text-amber-200/80"
              data-testid="first-super-admin-missing"
            >
              (opprinnelig super-admin slettet)
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
      data-testid="create-org-admin-card"
    >
      <header className="flex items-start justify-between gap-6 mb-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold mb-1.5">
            Admin-konto (B2B-forvaltning)
          </h3>
          <p className="text-xs text-white/55 leading-relaxed">
            Opprett en super-admin som kan logge inn på{" "}
            <span className="font-mono text-white/75">{tenantPrefix}-admin.kodovault.no</span>{" "}
            og forvalte sine ansatte.
          </p>
        </div>
        {!expanded && !result && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold transition whitespace-nowrap shadow-lg shadow-blue-500/20"
            data-testid="create-org-admin-open-btn"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            Opprett konto
          </button>
        )}
      </header>

      {expanded && !result && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Fornavn"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm"
              data-testid="create-org-admin-first-name"
            />
            <input
              type="text"
              placeholder="Etternavn"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm"
              data-testid="create-org-admin-last-name"
            />
          </div>
          <input
            type="email"
            placeholder="E-post"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm"
            data-testid="create-org-admin-email"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Passord (≥ 8 tegn)"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/15 focus:border-white/35 outline-none text-sm font-mono"
              data-testid="create-org-admin-password"
            />
            <button
              type="button"
              onClick={handleGenerate}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              data-testid="create-org-admin-generate-pwd"
            >
              Generer
            </button>
          </div>

          {error && (
            <div
              className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2"
              data-testid="create-org-admin-error"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setError(null);
              }}
              disabled={submitting}
              className="h-9 px-4 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs text-white/80 disabled:opacity-40 transition"
              data-testid="create-org-admin-cancel"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={submitting || !firstName || !lastName || !email || password.length < 8}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/40 text-white text-xs font-semibold transition disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 disabled:shadow-none"
              data-testid="create-org-admin-submit"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {submitting ? "Oppretter..." : "Opprett super-admin"}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div
          className="space-y-3 bg-emerald-500/5 border border-emerald-400/25 rounded-xl p-4"
          data-testid="create-org-admin-result"
        >
          <div className="text-sm font-medium text-emerald-200">
            ✓ am-admin opprettet — send påloggingsinfo til org-en
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <dt className="w-24 text-white/50">Navn:</dt>
              <dd className="font-mono">
                {result.admin.firstName} {result.admin.lastName}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-24 text-white/50">E-post:</dt>
              <dd className="font-mono">{result.admin.email}</dd>
              <CopyBtn
                value={result.admin.email}
                copied={copiedField === "email"}
                onCopy={() => handleCopy("email", result.admin.email)}
              />
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-24 text-white/50">Passord:</dt>
              <dd className="font-mono">{password}</dd>
              <CopyBtn
                value={password}
                copied={copiedField === "password"}
                onCopy={() => handleCopy("password", password)}
              />
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-24 text-white/50">Login-URL:</dt>
              <dd className="font-mono break-all">{result.loginUrl}</dd>
              <CopyBtn
                value={result.loginUrl}
                copied={copiedField === "loginUrl"}
                onCopy={() => handleCopy("loginUrl", result.loginUrl)}
              />
            </div>
            {/* Iter 20.9 (D-081): Status på velkomstmail. Mike trenger
                umiddelbar trygghet for at admin faktisk mottar invitasjonen. */}
            {result.welcomeEmail && (
              <div className="flex items-center gap-2">
                <dt className="w-24 text-white/50">Velkomstmail:</dt>
                <dd
                  data-testid="create-org-admin-welcome-status"
                  data-state={
                    "ok" in result.welcomeEmail && result.welcomeEmail.ok
                      ? "sent"
                      : "skipped" in result.welcomeEmail
                        ? "skipped"
                        : "error"
                  }
                  className={
                    "ok" in result.welcomeEmail && result.welcomeEmail.ok
                      ? "text-emerald-300"
                      : "skipped" in result.welcomeEmail
                        ? "text-white/55"
                        : "text-rose-300"
                  }
                >
                  {"ok" in result.welcomeEmail && result.welcomeEmail.ok
                    ? "Sendt ✓"
                    : "skipped" in result.welcomeEmail
                      ? `Hoppet over (${result.welcomeEmail.reason})`
                      : `Feil: ${result.welcomeEmail.error}`}
                </dd>
              </div>
            )}
          </dl>
          <button
            onClick={() => {
              setResult(null);
              setPassword("");
            }}
            className="text-xs text-emerald-200/70 hover:text-emerald-200 underline underline-offset-2"
            data-testid="create-org-admin-dismiss-result"
          >
            Lukk
          </button>
        </div>
      )}
    </div>
  );
}

function CopyBtn({
  copied,
  onCopy,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="ml-auto px-2 py-1 rounded text-[10px] bg-white/10 hover:bg-white/15"
    >
      {copied ? "✓ Kopiert" : "Kopier"}
    </button>
  );
}
