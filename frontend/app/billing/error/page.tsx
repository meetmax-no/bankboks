"use client";

/**
 * Ko | Do · Vault — v4.3 Iter 14 — /billing/error (Skjerm 8)
 *
 * Feilside for provisjonering. Vises når:
 *   - /billing/success-polling detekterer `status: "provisioning_failed"`
 *   - 3-min-timeout slår inn
 *
 * URL-parametere:
 *   - subdomain: tenanten det gjelder
 *   - reason: "provisioning_failed" | "timeout"
 *
 * Vi forteller bruker at teamet er varslet (sant — webhook sender Telegram
 * via `notifyProvisioningFailure`), og gir tre alternativer:
 *   1. Vent og prøv igjen — refresh /billing/success kjører polling-en
 *   2. Send e-post til support
 *   3. Få status-oppdatering på e-post (forberedt for fremtid)
 *
 * Ko | Do-tema: mørk bakgrunn + rød/amber aksent.
 */
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Mail, RefreshCw, Loader2 } from "lucide-react";

const REASON_MESSAGES: Record<string, { title: string; body: string }> = {
  provisioning_failed: {
    title: "Oppsettet stoppet underveis",
    body:
      "Vi klarte ikke å fullføre oppsettet av vaulten din. Teamet er varslet og " +
      "vil rette dette manuelt. Du blir kontaktet på e-post så snart vaulten er klar.",
  },
  timeout: {
    title: "Oppsettet tar lengre tid enn forventet",
    body:
      "Vi venter fortsatt på at vault-miljøet skal bli live. Dette skjer typisk " +
      "fordi Vercel-bygget tar litt lengre tid. Vaulten din kan likevel være klar " +
      "om et øyeblikk — sjekk e-posten din eller prøv igjen om noen minutter.",
  },
};

function BillingErrorInner() {
  const params = useSearchParams();
  const subdomain = (params.get("subdomain") ?? "").toLowerCase().trim();
  const reason = params.get("reason") ?? "provisioning_failed";
  const message = REASON_MESSAGES[reason] ?? REASON_MESSAGES.provisioning_failed;

  const retryUrl = subdomain
    ? `/billing/success?subdomain=${encodeURIComponent(subdomain)}`
    : "/billing/success";

  const supportSubject = encodeURIComponent(
    `Vault-oppsett feilet${subdomain ? ` — ${subdomain}` : ""}`,
  );
  const supportBody = encodeURIComponent(
    `Hei Ko | Do-teamet,\n\nVault-oppsettet mitt fullførte ikke.\n\n` +
      `Subdomain: ${subdomain || "(ukjent)"}\n` +
      `Grunn: ${reason}\n\n`,
  );

  return (
    <div
      data-testid="billing-error-page"
      className="min-h-screen bg-[#0a0a0a] text-white"
    >
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' /></filter><rect width='100%' height='100%' filter='url(%23n)' /></svg>\")",
        }}
      />

      <div className="relative mx-auto max-w-xl px-6 py-16 sm:py-24 space-y-8">
        {/* Ikon + tittel */}
        <div className="space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-500/10 border border-rose-400/30">
            <AlertTriangle className="h-6 w-6 text-rose-300" />
          </div>
          <h1
            data-testid="billing-error-title"
            className="text-3xl sm:text-4xl font-semibold tracking-tight"
          >
            {message.title}
          </h1>
          <p
            data-testid="billing-error-body"
            className="text-white/70 text-base sm:text-lg leading-relaxed"
          >
            {message.body}
          </p>
          {subdomain && (
            <div
              data-testid="billing-error-subdomain"
              className="font-mono text-sm text-white/45 break-all"
            >
              {subdomain}.kodovault.no
            </div>
          )}
        </div>

        {/* Reassurance */}
        <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-4">
          <div className="text-sm text-amber-200/85">
            <strong className="font-semibold">Pengene dine er trygge.</strong>{" "}
            Stripe har bekreftet betalingen. Hvis vi ikke får vault-miljøet
            på lufta innen 24 timer kan du få full refusjon — bare svar på
            e-posten du får fra oss.
          </div>
        </div>

        {/* Handlingsknapper */}
        <div className="space-y-3">
          <a
            data-testid="billing-error-retry"
            href={retryUrl}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition"
          >
            <RefreshCw className="h-4 w-4" />
            Prøv polling igjen
          </a>

          <a
            data-testid="billing-error-support"
            href={`mailto:support@kodovault.no?subject=${supportSubject}&body=${supportBody}`}
            className="flex items-center justify-center gap-2 w-full h-12 rounded-full border border-white/15 hover:border-white/30 hover:bg-white/5 text-white text-sm font-semibold transition"
          >
            <Mail className="h-4 w-4" />
            Kontakt support
          </a>
        </div>

        {/* Diskret footer */}
        <div className="pt-8 text-xs text-white/40">
          Vi har allerede mottatt varsel om dette og jobber med saken. Du
          trenger ikke gjøre noe — vi tar kontakt så snart vaulten er klar.
        </div>
      </div>
    </div>
  );
}

export default function BillingErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-amber-300 animate-spin" />
        </div>
      }
    >
      <BillingErrorInner />
    </Suspense>
  );
}
