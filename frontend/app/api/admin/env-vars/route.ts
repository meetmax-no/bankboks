/**
 * Ko | Do · Vault — D-147 (2026-02) — SuperAdmin ENV-var reveal
 *
 * POST /api/admin/env-vars
 *
 * Returnerer alle env-vars som er satt i Vercel (process.env) med gruppe-
 * kategorisering og korte beskrivelser. Beskyttet av:
 *
 *   1. `kodo_admin_session`-cookie (middleware validerer)
 *   2. Ekstra reveal-passord (bcrypt-compare mot
 *      `ADMIN_REVEAL_SECRETS_PASSWORD_HASH` env-var)
 *
 * Hash genereres av Mike manuelt via `bcrypt-cli` eller `openssl passwd`,
 * og settes i Vercel env-vars. Aldri hardkodet i repo. Se README-notat
 * lenger ned i denne filen.
 *
 * SPW (dedikert Secrets Password Word) planlegges i senere iterasjon —
 * denne løsningen bruker ett enkelt bcrypt-hash-passord i env inntil da.
 *
 * Sikkerhet:
 *   - Passordet leses fra request-body (POST), aldri query — hindrer
 *     lekasje til Vercel-loggen.
 *   - Ingen env-verdier logges. Kun forsøket + status logges.
 *   - Constant-time bcrypt-compare (biblioteket sørger for dette).
 *
 * Rate-limiting: ingen (foreløpig — bak admin-session-cookie,
 * angrepsflaten er allerede snevret inn). Iter 2 kan legge på
 * per-IP-throttle om ønskelig.
 *
 * ─── ENV-var som må settes i Vercel ─────────────────────────────────
 *   ADMIN_REVEAL_SECRETS_PASSWORD_HASH
 *
 * Slik genereres den (én-linje i terminal, IKKE i chat):
 *   node -e "console.log(require('bcrypt').hashSync('DITT_PASSORD', 12))"
 *
 * Kopier resultat-strengen (starter med $2a$12$...) inn i Vercel Dashboard
 * → Project kodo-vault → Settings → Environment Variables. Aldri lim
 * passordet inn i chat eller commit hash-en i repo.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcrypt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnvVarMeta = {
  group: string;
  description: string;
};

/**
 * Metadata-katalog for kjente env-vars. Ukjente vars grupperes under
 * "Ukjent" med tom beskrivelse. Grupper er utformet for lesbarhet i
 * SuperAdmin-UI.
 */
const ENV_META: Record<string, EnvVarMeta> = {
  // Auth & Session
  ADMIN_SESSION_SECRET: {
    group: "Auth & Session",
    description: "HMAC-secret for admin-cookie signering",
  },
  ORG_ADMIN_SESSION_SECRET: {
    group: "Auth & Session",
    description: "HMAC-secret for firma-admin-cookie signering",
  },
  TURNSTILE_SECRET_KEY: {
    group: "Auth & Session",
    description: "Cloudflare Turnstile server-verifisering",
  },
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: {
    group: "Auth & Session",
    description: "Cloudflare Turnstile klient-widget-nøkkel",
  },
  ADMIN_REVEAL_SECRETS_PASSWORD_HASH: {
    group: "Auth & Session",
    description: "Bcrypt-hash for denne env-viser (D-147)",
  },

  // Encryption
  CENTRAL_ENCRYPTION_KEY: {
    group: "Encryption",
    description: "AES-GCM nøkkel for sentral Upstash-data",
  },

  // Central Upstash
  CENTRAL_KV_REST_API_URL: {
    group: "Central Upstash",
    description: "REST API URL — sentral tenant-database",
  },
  CENTRAL_KV_REST_API_TOKEN: {
    group: "Central Upstash",
    description: "REST API token — sentral tenant-database",
  },
  CENTRAL_UPSTASH_URL: {
    group: "Central Upstash",
    description: "Alias for CENTRAL_KV_REST_API_URL (kompabilitet)",
  },
  CENTRAL_UPSTASH_TOKEN: {
    group: "Central Upstash",
    description: "Alias for CENTRAL_KV_REST_API_TOKEN (kompabilitet)",
  },

  // Per-tenant Upstash (denne pod-en)
  KV_REST_API_URL: {
    group: "Per-tenant Upstash",
    description: "Vercel KV integration URL for denne tenant-podden",
  },
  KV_REST_API_TOKEN: {
    group: "Per-tenant Upstash",
    description: "Vercel KV integration token for denne tenant-podden",
  },
  UPSTASH_REDIS_REST_URL: {
    group: "Per-tenant Upstash",
    description: "Alternativ Upstash REST URL (direkte, ikke via Vercel)",
  },
  UPSTASH_REDIS_REST_TOKEN: {
    group: "Per-tenant Upstash",
    description: "Alternativ Upstash REST token (direkte, ikke via Vercel)",
  },

  // Upstash Management (provisjonering)
  UPSTASH_MANAGEMENT_API_KEY: {
    group: "Upstash Management",
    description: "API-nøkkel for å opprette nye Upstash-DBer",
  },
  UPSTASH_MANAGEMENT_EMAIL: {
    group: "Upstash Management",
    description: "Kontoeier-epost for Upstash management API",
  },

  // Vercel
  VERCEL_API_TOKEN: {
    group: "Vercel",
    description: "API-token for å opprette prosjekter og domener",
  },
  VERCEL_TEAM_ID: {
    group: "Vercel",
    description: "Team-ID hvis prosjektene tilhører et Vercel-team",
  },

  // Stripe
  STRIPE_SECRET_KEY: {
    group: "Stripe",
    description: "Server-side API-nøkkel (sk_live_... eller sk_test_...)",
  },
  STRIPE_WEBHOOK_SECRET: {
    group: "Stripe",
    description: "Signature-secret for webhook-verifisering (whsec_...)",
  },
  STRIPE_PRICE_MONTHLY: {
    group: "Stripe",
    description: "Price-ID for B2C månedsabonnement",
  },
  STRIPE_PRICE_YEARLY: {
    group: "Stripe",
    description: "Price-ID for B2C årsabonnement",
  },
  STRIPE_PRICE_B2B_SEMIANNUAL: {
    group: "Stripe",
    description: "Price-ID for B2B halvårlig plan",
  },
  STRIPE_PRICE_B2B_YEARLY: {
    group: "Stripe",
    description: "Price-ID for B2B årlig plan",
  },

  // Email (Resend)
  RESEND_API_KEY: {
    group: "E-post (Resend)",
    description: "API-nøkkel for utgående e-post via Resend",
  },
  RESEND_FROM_EMAIL: {
    group: "E-post (Resend)",
    description: "Standard avsender-adresse for systemmail",
  },
  EMAIL_ENABLED: {
    group: "E-post (Resend)",
    description: 'Global e-post-toggle ("true"/"false")',
  },

  // Notify (Telegram)
  TELEGRAM_BOT_TOKEN: {
    group: "Telegram",
    description: "Bot-token for provisioning-varsler",
  },
  TELEGRAM_CHAT_ID: {
    group: "Telegram",
    description: "Chat-ID hvor varsler sendes",
  },
  TELEGRAM_ENABLED: {
    group: "Telegram",
    description: 'Global Telegram-toggle ("true"/"false")',
  },

  // Cron & Internal
  CRON_SECRET: {
    group: "Cron & Internal",
    description: "Delt hemmelighet for Vercel cron-endpoint-auth",
  },
  INTERNAL_RPC_SECRET: {
    group: "Cron & Internal",
    description: "HMAC-secret for intern service-til-service kall",
  },
  ADMIN_INTERNAL_URL: {
    group: "Cron & Internal",
    description: "Intern base-URL for cross-pod admin-kall",
  },

  // Client Config
  NEXT_PUBLIC_CLIENT_CONFIG: {
    group: "Client Config",
    description: "Client-config-slug — hvilken kunde denne pod-en er",
  },
  NEXT_PUBLIC_ADMIN_ORIGIN: {
    group: "Client Config",
    description: "Origin (URL) til SuperAdmin-appen",
  },
  IDENTIFIER: {
    group: "Client Config",
    description: "Kunde-identifikator brukt i client-config-oppslag",
  },

  // Vercel runtime-injected
  NODE_ENV: {
    group: "Runtime",
    description: 'Node.js-miljø ("production"/"development")',
  },
  VERCEL: {
    group: "Runtime",
    description: 'Satt til "1" på Vercel-hosted deploys',
  },
  VERCEL_ENV: {
    group: "Runtime",
    description: '"production" | "preview" | "development"',
  },
  VERCEL_URL: {
    group: "Runtime",
    description: "Deploy-URL for denne kjøringen",
  },
  VERCEL_REGION: {
    group: "Runtime",
    description: "AWS-region denne serverless-funksjonen kjører i",
  },
  VERCEL_GIT_COMMIT_SHA: {
    group: "Runtime",
    description: "Git commit SHA for denne deployen",
  },
  VERCEL_GIT_COMMIT_MESSAGE: {
    group: "Runtime",
    description: "Git commit-melding for denne deployen",
  },
  VERCEL_GIT_COMMIT_REF: {
    group: "Runtime",
    description: "Git branch/tag for denne deployen",
  },
  VERCEL_GIT_REPO_SLUG: {
    group: "Runtime",
    description: "Git repo-navn i owner/name-format",
  },
  VERCEL_GIT_REPO_OWNER: {
    group: "Runtime",
    description: "Git repo-eier (org eller bruker)",
  },
};

/**
 * Filter ut runtime-injected system-vars som ikke er interessante for
 * en admin (PATH, HOME, PWD, etc.). Vi beholder alt annet — inkludert
 * eventuelle vars vi ikke har metadata for.
 */
const SYSTEM_DENYLIST = new Set([
  "PATH",
  "HOME",
  "PWD",
  "TMPDIR",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SHELL",
  "USER",
  "LOGNAME",
  "_",
  "SHLVL",
  "OLDPWD",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_LAMBDA_FUNCTION_VERSION",
  "AWS_LAMBDA_FUNCTION_MEMORY_SIZE",
  "AWS_LAMBDA_LOG_GROUP_NAME",
  "AWS_LAMBDA_LOG_STREAM_NAME",
  "AWS_LAMBDA_RUNTIME_API",
  "AWS_EXECUTION_ENV",
  "AWS_XRAY_DAEMON_ADDRESS",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "LAMBDA_TASK_ROOT",
  "LAMBDA_RUNTIME_DIR",
  "_HANDLER",
  "_LAMBDA_CONSOLE_SOCKET",
  "_LAMBDA_CONTROL_SOCKET",
  "_LAMBDA_LOG_FD",
  "_LAMBDA_RUNTIME_LOAD_TIME",
  "_LAMBDA_SB_ID",
  "_LAMBDA_SERVER_PORT",
  "_LAMBDA_SHARED_MEM_FD",
  "_X_AMZN_TRACE_ID",
  "NODE_OPTIONS",
  "NODE_PATH",
]);

/**
 * Klient-IP for audit-logging. Cloudflare/Vercel setter typisk
 * `x-forwarded-for` med kommaseparert liste — første IP er faktisk kilde.
 */
function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const ua = req.headers.get("user-agent") ?? "unknown";
  const ts = new Date().toISOString();

  const hash = process.env.ADMIN_REVEAL_SECRETS_PASSWORD_HASH;
  if (!hash) {
    console.error(
      `[env-vars D-147] ${ts} ip=${ip} — server_misconfigured: ADMIN_REVEAL_SECRETS_PASSWORD_HASH mangler i env`,
    );
    return NextResponse.json(
      {
        error: "server_misconfigured",
        detail:
          "ADMIN_REVEAL_SECRETS_PASSWORD_HASH er ikke satt i Vercel env-vars. Se instruksjoner i /app/frontend/app/api/admin/env-vars/route.ts.",
      },
      { status: 500 },
    );
  }

  let body: { password?: string };
  try {
    body = (await req.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const password = body.password ?? "";
  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "missing_password" }, { status: 400 });
  }

  // Bcrypt-compare i constant time.
  const ok = await bcrypt.compare(password, hash);
  if (!ok) {
    console.warn(
      `[env-vars D-147] ${ts} ip=${ip} ua="${ua.slice(0, 80)}" — password_mismatch`,
    );
    return NextResponse.json(
      { error: "invalid_password" },
      { status: 401 },
    );
  }

  console.info(
    `[env-vars D-147] ${ts} ip=${ip} ua="${ua.slice(0, 80)}" — reveal_ok`,
  );

  // Bygg respons: iterér faktisk process.env, gruppér, tilføy metadata.
  type Row = {
    name: string;
    value: string;
    group: string;
    description: string;
    isSet: boolean;
  };

  const rows: Row[] = [];
  const seenNames = new Set<string>();

  // Først: kjente vars (i deterministisk rekkefølge fra ENV_META)
  for (const [name, meta] of Object.entries(ENV_META)) {
    if (SYSTEM_DENYLIST.has(name)) continue;
    const raw = process.env[name];
    rows.push({
      name,
      value: raw ?? "",
      isSet: typeof raw === "string" && raw.length > 0,
      group: meta.group,
      description: meta.description,
    });
    seenNames.add(name);
  }

  // Deretter: ukjente vars som faktisk finnes i env, men vi ikke har metadata for.
  for (const name of Object.keys(process.env).sort()) {
    if (seenNames.has(name)) continue;
    if (SYSTEM_DENYLIST.has(name)) continue;
    const raw = process.env[name];
    rows.push({
      name,
      value: raw ?? "",
      isSet: typeof raw === "string" && raw.length > 0,
      group: "Ukjent",
      description: "(ingen beskrivelse — legg til i ENV_META)",
    });
  }

  return NextResponse.json({ ok: true, rows });
}
