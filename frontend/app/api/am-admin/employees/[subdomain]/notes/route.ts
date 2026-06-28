/**
 * Ko | Do · Vault — Iter 20.5c — GET/PUT/DELETE /api/am-admin/employees/[subdomain]/notes
 *
 * Per-employee admin-notater (kryptert MpwEnvelope). Kun envelope krysser
 * nettverket — server kan IKKE lese innholdet (D-079 zero-knowledge).
 *
 * Autorisasjon: am-admin-session + subdomain MÅ tilhøre admin sin egen
 * org (`<prefix>-...`). Cross-org access blokkeres av
 * `assertSubdomainBelongsToOrg`.
 *
 * Krever IKKE at MPW er låst opp på server-siden — det er en
 * klient-side-tilstand. Server sender bare envelopen videre.
 *
 * Sanity-cap: envelope.cipher er base64 av plaintext+auth-tag. Server
 * påser at den ikke overstiger 10 000 base64-tegn (~7 500 bytes
 * plaintext, godt over klientens 5 000-tegns plaintext-grense per
 * blokker-svar 2=B). Forhindrer Upstash-memory-abuse uten å lekke
 * informasjon om innholdet.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  requireAmAdmin,
  assertSubdomainBelongsToOrg,
} from "@/lib/platform/am-admin-session-helper";
import {
  getNoteStatus,
  setNote,
  deleteNote,
} from "@/lib/platform/am-admin-notes-store";
import { isMpwEnvelope } from "@/lib/platform/am-admin-mpw";
import { tenantExists } from "@/lib/platform/tenant-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sanity-cap på envelope.cipher base64-lengde. Klient-grensen er 5000
 * plaintext-tegn. Worst-case multi-byte UTF-8 (emoji = 4 bytes/char):
 *   5000 chars × 4 bytes/char + 16 (AES-GCM auth tag) = 20 016 cipher-bytes
 *   → base64 ≈ 26 688 chars
 * Vi setter 30 000 med komfortabel margin uten å invitere abuse.
 * Forhindrer Upstash-memory-abuse uten å lekke informasjon om innholdet.
 */
const MAX_CIPHER_BASE64 = 30_000;

async function resolveSubdomain(
  params: Promise<{ subdomain: string }>,
): Promise<string> {
  const { subdomain } = await params;
  return subdomain.toLowerCase();
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const subdomain = await resolveSubdomain(ctx.params);
  const blocked = assertSubdomainBelongsToOrg(subdomain, admin.tenantPrefix);
  if (blocked) return blocked;

  const status = await getNoteStatus(admin.tenantPrefix, subdomain);
  if (status.state === "corrupt") {
    // Notat finnes i Upstash men har feil shape — UI bør vise advarsel
    // før brukeren overskriver med tom textarea. Returnerer 200 + flag
    // (ikke 500, fordi tilstanden er "fortsett med forsiktighet" snarere
    // enn server-feil).
    return NextResponse.json({ envelope: null, corrupt: true });
  }
  return NextResponse.json({ envelope: status.state === "ok" ? status.envelope : null });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const subdomain = await resolveSubdomain(ctx.params);
  const blocked = assertSubdomainBelongsToOrg(subdomain, admin.tenantPrefix);
  if (blocked) return blocked;

  // Verifiser at den ansatte faktisk finnes — vi vil ikke lagre notater
  // for ikke-eksisterende tenants (orphan data).
  if (!(await tenantExists(subdomain))) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const envelope =
    body && typeof body === "object"
      ? (body as { envelope?: unknown }).envelope
      : undefined;

  if (!isMpwEnvelope(envelope)) {
    return NextResponse.json({ error: "invalid_envelope" }, { status: 400 });
  }
  if (envelope.cipher.length > MAX_CIPHER_BASE64) {
    return NextResponse.json(
      {
        error: "note_too_large",
        detail: `Maks ${MAX_CIPHER_BASE64} base64-tegn cipher (~5000 tegn plaintext også for tekst med æøå/emoji).`,
      },
      { status: 413 },
    );
  }

  await setNote(admin.tenantPrefix, subdomain, envelope);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ subdomain: string }> },
) {
  const auth = await requireAmAdmin(req);
  if (!auth.ok) return auth.response;
  const { admin } = auth.ctx;

  const subdomain = await resolveSubdomain(ctx.params);
  const blocked = assertSubdomainBelongsToOrg(subdomain, admin.tenantPrefix);
  if (blocked) return blocked;

  await deleteNote(admin.tenantPrefix, subdomain);
  return NextResponse.json({ ok: true });
}
