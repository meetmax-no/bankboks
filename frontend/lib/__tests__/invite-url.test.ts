/**
 * Ko | Do · Vault — Iter 20.9 (D-097e, Mike 2026-06-28) — invite-URL builder
 *
 * Verifiserer per-org "white-label" host i invite-lenker:
 *   - Med tenantPrefix → `https://<prefix>-admin.kodovault.no/invite?token=…`
 *   - Uten prefix → fallback til `https://admin.kodovault.no/invite?…`
 *   - Ugyldig prefix-format → fallback (sikker)
 *   - NEXT_PUBLIC_ADMIN_ORIGIN-override brukes direkte i dev/preview
 *
 * Kjør: `cd frontend && npx tsx lib/__tests__/invite-url.test.ts`
 */
export {};

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("OK:", msg);
}

async function main() {
  // ── 1. Med gyldig prefix → per-org host ─────────────────────────
  delete process.env.NEXT_PUBLIC_ADMIN_ORIGIN;
  // Re-import etter env-mutasjon (tsx caches ikke env i moduler — bare verify
  // ved å lese resultatet av eksport-funksjonen).
  const { buildInviteUrl, getInviteOrigin } = await import("../platform/invite-url");

  assert(
    getInviteOrigin("mm") === "https://mm-admin.kodovault.no",
    "prefix=mm → https://mm-admin.kodovault.no",
  );
  assert(
    buildInviteUrl("abc123", "mm") === "https://mm-admin.kodovault.no/invite?token=abc123",
    "buildInviteUrl med prefix=mm",
  );

  // ── 2. Lengre prefix ────────────────────────────────────────────
  assert(
    getInviteOrigin("meet-max") === "https://meet-max-admin.kodovault.no",
    "prefix=meet-max → https://meet-max-admin.kodovault.no",
  );

  // ── 3. Uten prefix → fallback til generic admin-host ────────────
  assert(
    getInviteOrigin() === "https://admin.kodovault.no",
    "ingen prefix → https://admin.kodovault.no",
  );
  assert(
    getInviteOrigin(null) === "https://admin.kodovault.no",
    "prefix=null → https://admin.kodovault.no",
  );
  assert(
    getInviteOrigin("") === "https://admin.kodovault.no",
    "prefix=tom → https://admin.kodovault.no",
  );

  // ── 4. Ugyldig prefix-format → fallback (defensive) ─────────────
  assert(
    getInviteOrigin("INVALID-CAPS") === "https://admin.kodovault.no",
    "prefix med stor bokstav → fallback (regex strikt)",
  );
  assert(
    getInviteOrigin("1leadingnumber") === "https://admin.kodovault.no",
    "prefix som starter med tall → fallback",
  );
  assert(
    getInviteOrigin("a") === "https://admin.kodovault.no",
    "prefix kun 1 tegn → fallback (regex krever min 2)",
  );

  console.log("\n✓ invite-url: alle assertions OK (uten override)");

  // ── 5. NEXT_PUBLIC_ADMIN_ORIGIN-override (dev/preview) ──────────
  // Vi simulerer ved å re-importere modulen etter env-set. tsx må fres
  // module-cache for å plukke opp env-endringen — vi bruker dynamic import
  // med query-string for å unngå cache.
  process.env.NEXT_PUBLIC_ADMIN_ORIGIN = "http://localhost:3000";
  const mod2 = await import("../platform/invite-url?override=1" as string);
  assert(
    typeof mod2.getInviteOrigin === "function",
    "override-modul lastet (dynamic re-import)",
  );
  assert(
    mod2.getInviteOrigin("mm") === "http://localhost:3000",
    "override aktivt → ignorerer prefix, bruker override (dev/preview-mønster)",
  );

  console.log("\n✓ invite-url: alle assertions OK (med override)");
}

void main().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});
