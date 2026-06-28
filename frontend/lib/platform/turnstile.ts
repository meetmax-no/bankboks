/**
 * Ko | Do · Vault — v4.3 Iter 5 — Cloudflare Turnstile server-side verifisering
 *
 * Verifiserer en Turnstile-token mot Cloudflares siteverify-endepunkt.
 * Returnerer { ok: true } eller { ok: false, codes: [...] }.
 *
 * Krever env-var `TURNSTILE_SECRET_KEY` (server-side only, IKKE prefix
 * NEXT_PUBLIC_). Mike legger denne i Vercel Project Settings → Env Vars
 * for Production, Preview og Development.
 *
 * Token kommer fra `<TurnstileWidget>` på klient-siden — den embedder
 * Cloudflares `turnstile.render()` som returnerer en challenge-token når
 * bruker har passert (synlig eller usynlig) challenge.
 *
 * Dokumentasjon: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
export interface TurnstileVerifyResult {
  ok: boolean;
  codes?: string[];
  hostname?: string;
  challenge_ts?: string;
}

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return {
      ok: false,
      codes: ["missing-secret-key"],
    };
  }
  if (!token || typeof token !== "string") {
    return {
      ok: false,
      codes: ["missing-input-response"],
    };
  }

  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      // Cloudflare svarer raskt — 5s timeout er rikelig.
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
      hostname?: string;
      challenge_ts?: string;
    };
    return {
      ok: body.success === true,
      codes: body["error-codes"],
      hostname: body.hostname,
      challenge_ts: body.challenge_ts,
    };
  } catch (err) {
    return {
      ok: false,
      codes: [err instanceof Error ? err.message : "fetch-failed"],
    };
  }
}
