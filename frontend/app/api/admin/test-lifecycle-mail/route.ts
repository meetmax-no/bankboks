/**
 * Ko | Do · Vault — v4.3 Iter 17 (2026-06-13) — Test-endepunkt for lifecycle-mail
 *
 * Sender én T-7/T-3/T-1-varsel direkte til en valgt tenant UTEN å endre
 * tenant-data eller idempotens-flagg. Brukes av admin-UI for å verifisere
 * at e-postkanalen fungerer + at templates renderes korrekt.
 *
 * Auth: Bearer `CRON_SECRET` (samme som cron-endpoint). Vi gjenbruker
 * eksisterende secret for å unngå enda en env-variabel.
 *
 * Bruk:
 *   POST /api/admin/test-lifecycle-mail
 *   Body: {
 *     "subdomain": "olsen17",
 *     "type": "trial-reminder-t5" | "locked-from-trial" | "locked-from-cancel"
 *           | "lifecycle-warning" | "deleted-confirmation",
 *     "localeOverride": "no" | "sv" | "da" | "en"  // valgfritt — tvinger
 *                                                  // språk i testmail uten
 *                                                  // å endre tenant-data
 *   }
 *
 * Returnerer Resend-resultatet rått så du ser presist hva som skjedde.
 */
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/platform/tenant-store";
import {
  sendLifecycleWarning,
  sendTrialReminderT5,
  sendLockedFromTrial,
  sendLockedFromCancel,
  sendDeletedConfirmation,
} from "@/lib/platform/notify-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Auth håndteres av middleware (admin-session-cookie kreves for hele
  // /api/admin/*). Hvis request når dette koden er den allerede admin-
  // verifisert. CRON_SECRET-sjekken som tidligere var her er fjernet
  // (Iter 17 full pakke, 2026-06-13) for å la admin-UI kalle endepunktet
  // direkte via fetch uten å eksponere secret'en til klient-bundle.

  let body: { subdomain?: string; type?: string; localeOverride?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const subdomain = (body.subdomain ?? "").trim().toLowerCase();
  const type = body.type;
  const localeOverrideRaw = body.localeOverride;
  let localeOverride: "no" | "sv" | "da" | "en" | undefined;
  if (localeOverrideRaw !== undefined) {
    if (
      localeOverrideRaw === "no" ||
      localeOverrideRaw === "sv" ||
      localeOverrideRaw === "da" ||
      localeOverrideRaw === "en"
    ) {
      localeOverride = localeOverrideRaw;
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_localeOverride",
          validValues: ["no", "sv", "da", "en"],
        },
        { status: 400 },
      );
    }
  }
  // Iter 17 full pakke (2026-06-13): 5 mail-typer i admin-UI per
  // endelig spec. "lifecycle-warning" representerer A3-malen som i
  // produksjon sendes 3 ganger (T-7/T-3/T-1) med samme innhold men
  // ulik {{daysLeft}}. Test-endepunktet renderer T-7-varianten siden
  // den viser mailen mest helhetlig — mal-innholdet er identisk for
  // alle tre tidspunktene.
  const VALID_TYPES = [
    "trial-reminder-t5",
    "locked-from-trial",
    "locked-from-cancel",
    "lifecycle-warning",
    "deleted-confirmation",
  ] as const;
  if (!subdomain) {
    return NextResponse.json(
      { ok: false, error: "subdomain_required" },
      { status: 400 },
    );
  }
  if (!type || !VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_type",
        validTypes: VALID_TYPES,
      },
      { status: 400 },
    );
  }

  const tenant = await getTenant(subdomain);
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "tenant_not_found" },
      { status: 404 },
    );
  }

  // localeOverride er en TEST-ONLY-bryter — vi lager en *flat kopi* av
  // tenant-recorden med overstyrt `locale` og sender den videre. Selve
  // notify-email.ts-funksjonene leser `tenant.locale` direkte (via
  // `resolveLocale`), så denne kopien er nok til å tvinge mal-språket.
  // Tenant-recorden i Upstash røres ALDRI.
  const effectiveTenant = localeOverride
    ? { ...tenant, locale: localeOverride }
    : tenant;

  // Simulert "delete date" — alltid lockedAt+28d for å speile produksjon
  // (cron beregner deleteDate som lockedAt+lockToDeleteDays). I test bruker
  // vi `now+28d` siden vi ikke endrer tenant.lockedAt for testen. Gjelder
  // alle mail-typer som bruker {{deleteDate}}; A3 (lifecycle-warning)
  // viser også daysLeft=7 ettersom det er den eneste varianten som sendes
  // i produksjon (dag 21 = 7 dager før delete).
  const deleteDate = new Date();
  deleteDate.setUTCDate(deleteDate.getUTCDate() + 28);

  let result;
  switch (type) {
    case "lifecycle-warning":
      result = await sendLifecycleWarning(effectiveTenant, "t7", deleteDate);
      break;
    case "trial-reminder-t5":
      result = await sendTrialReminderT5(effectiveTenant);
      break;
    case "locked-from-trial":
      result = await sendLockedFromTrial(effectiveTenant, deleteDate);
      break;
    case "locked-from-cancel":
      result = await sendLockedFromCancel(effectiveTenant);
      break;
    case "deleted-confirmation":
      result = await sendDeletedConfirmation(effectiveTenant);
      break;
    default:
      return NextResponse.json({ ok: false, error: "unhandled_type" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    tenant: {
      subdomain: tenant.subdomain,
      contactEmail: tenant.contactEmail ?? tenant.email,
      locale: tenant.locale,
      effectiveLocale: effectiveTenant.locale,
      localeOverride: localeOverride ?? null,
      lifecycleEmailsPref: tenant.emailPreferences?.lifecycle !== false,
    },
    deleteDate: deleteDate.toISOString(),
    emailResult: result,
    diag: {
      EMAIL_ENABLED: process.env.EMAIL_ENABLED === "true",
      RESEND_API_KEY_set: typeof process.env.RESEND_API_KEY === "string" && process.env.RESEND_API_KEY.length > 0,
      RESEND_FROM_EMAIL_set: typeof process.env.RESEND_FROM_EMAIL === "string" && process.env.RESEND_FROM_EMAIL.length > 0,
    },
  });
}
