/**
 * Ko | Do · Vault — v4.3 Iter 8.3 — Admin client-config editor endpoint (D-060)
 *
 * GET    ?id=<subdomain>       → hent for redigering
 * PUT    ?id=<subdomain> body=JSON  → overskriv i Upstash
 * DELETE ?id=<subdomain>       → slett (tenant faller tilbake til default)
 *
 * Beskyttet av middleware. Body på PUT må være gyldig JSON, ingen
 * skjema-validering — Mike kan editere fritt og se konsekvensen i
 * tenantens app innen 30 sek (browser-cache).
 */
import { NextResponse } from "next/server";
import {
  deleteClientConfig,
  getClientConfig,
  putClientConfig,
} from "@/lib/platform/client-config-store";
import {
  buildTenantConfig,
  readDefaultTemplate,
  type ClientConfigJson,
} from "@/lib/platform/tenant-config-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getId(req: Request): string | null {
  const { searchParams } = new URL(req.url);
  return searchParams.get("id")?.toLowerCase().trim() || null;
}

export async function GET(req: Request) {
  const id = getId(req);
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  try {
    let config = await getClientConfig(id);
    let source: "upstash" | "default" = "upstash";
    if (!config) {
      // Hjelpsom default: returner template med _meta mutert, så editor
      // ikke står tom for nye tenants som ennå ikke har Upstash-key.
      const template = await readDefaultTemplate();
      config = buildTenantConfig(template, id);
      source = "default";
    }
    return NextResponse.json({ ok: true, config, source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/client-config GET]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const id = getId(req);
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  let body: ClientConfigJson;
  try {
    body = (await req.json()) as ClientConfigJson;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "config_must_be_object" },
      { status: 400 },
    );
  }
  try {
    await putClientConfig(id, body);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/client-config PUT]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = getId(req);
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400 });
  }
  try {
    const removed = await deleteClientConfig(id);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[admin/client-config DELETE]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
