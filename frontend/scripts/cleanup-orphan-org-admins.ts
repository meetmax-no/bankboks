#!/usr/bin/env tsx
/**
 * Ko | Do · Vault — D-091 (2026-06-28, Mike) — Cleanup orphan OrgAdmins
 *
 * Sletter alle org-admin-records i sentral Upstash som peker på et
 * tenantPrefix der parent-recorden (`<prefix>-admin`) IKKE lenger
 * eksisterer. Disse er orphans — de blokkerer gjenopprettelse av samme
 * org fordi e-post-uniqueness fortsatt feiler ved
 * `POST /admin/tenants/<sub>/create-org-admin`.
 *
 * Per Mike's bekreftelse 2026-06-28: "Du kan slette dem som du finner —
 * ingen av dem som evt. finnes er aktive på noen virksomhet."
 *
 * KJØR (fra `/app/frontend`):
 *
 *   # Dry-run (anbefalt først):
 *   CENTRAL_KV_REST_API_URL=https://xxx CENTRAL_KV_REST_API_TOKEN=xxx \
 *   CENTRAL_ENCRYPTION_KEY=xxx \
 *     npx tsx scripts/cleanup-orphan-org-admins.ts
 *
 *   # Faktisk sletting:
 *   CENTRAL_KV_REST_API_URL=https://xxx CENTRAL_KV_REST_API_TOKEN=xxx \
 *   CENTRAL_ENCRYPTION_KEY=xxx \
 *     npx tsx scripts/cleanup-orphan-org-admins.ts --confirm
 *
 *   # Force-delete ALLE org-admins uansett (kun ved bekreftet "nuke" fra Mike):
 *   CENTRAL_KV_REST_API_URL=https://xxx CENTRAL_KV_REST_API_TOKEN=xxx \
 *   CENTRAL_ENCRYPTION_KEY=xxx \
 *     npx tsx scripts/cleanup-orphan-org-admins.ts --confirm --all
 *
 * Hva slettes:
 *   - `org-admin:<prefix>:admin:<id>`            (record-blob)
 *   - `org-admin:<prefix>:admins`                (indeks-SET)
 *   - `org-admin-login-events:<adminId>`         (sorted-set per admin)
 *   - `org-meta:<prefix>:mpw`                    (MPW-verifier)
 *   - `org-admin-notes:<prefix>:<sub>` + index   (admin-notater)
 *   - `invite:<token>` + `invite-index:<sub>`    (alle invites for parent)
 *
 * Hva slettes ALDRI:
 *   - Tenant-records (`tenant:*`) — script er ren admin-rydding
 *   - Stripe customers — bevares per D-070 for betalte historikk
 */

import { Redis } from "@upstash/redis";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const NUKE_ALL = args.includes("--all");

function env(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`✗ Mangler env-var: ${key}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  console.log("─────────────────────────────────────────");
  console.log("Ko|Do Vault — cleanup-orphan-org-admins.ts");
  console.log(`Mode: ${CONFIRM ? "DELETE" : "DRY-RUN"}${NUKE_ALL ? " · NUKE-ALL" : ""}`);
  console.log("─────────────────────────────────────────\n");

  const client = new Redis({
    url: env("CENTRAL_KV_REST_API_URL"),
    token: env("CENTRAL_KV_REST_API_TOKEN"),
  });

  // ─── Step 1: scan alle org-admin-indekser ───────────────────────────────
  console.log("→ Skanner `org-admin:*:admins` …");
  const adminIndexKeys: string[] = [];
  let cursor: string = "0";
  do {
    const result = (await client.scan(cursor, {
      match: "org-admin:*:admins",
      count: 100,
    })) as [string, string[]];
    cursor = result[0];
    adminIndexKeys.push(...result[1]);
  } while (cursor !== "0");
  console.log(`  Funnet ${adminIndexKeys.length} prefix-indekser`);

  // ─── Step 2: utled alle prefikser + sjekk om parent-tenant finnes ───────
  // tenantPrefix-uttrekk: "org-admin:<prefix>:admins"
  const prefixesFound: string[] = [];
  for (const idxKey of adminIndexKeys) {
    const m = idxKey.match(/^org-admin:([a-z0-9-]+):admins$/);
    if (m && m[1]) prefixesFound.push(m[1]);
  }

  // For hver prefix: sjekk om `tenant:<prefix>-admin` finnes
  const orphanPrefixes: string[] = [];
  for (const prefix of prefixesFound) {
    const parentSub = `${prefix}-admin`;
    const exists = await client.exists(`tenant:${parentSub}`);
    if (!exists) {
      orphanPrefixes.push(prefix);
    } else if (NUKE_ALL) {
      // --all flag: marker selv aktive også (Mike's nuke-from-orbit-modus)
      orphanPrefixes.push(prefix);
    }
  }

  if (orphanPrefixes.length === 0) {
    console.log("\n✓ Ingen orphans funnet. Ferdig.");
    return;
  }

  console.log(
    `\n→ Vil ${CONFIRM ? "slette" : "(DRY-RUN) slette"} admins for ${orphanPrefixes.length} prefiks:`,
  );

  // ─── Step 3: per prefix — liste hvilke nøkler som vil slettes ───────────
  let totalAdmins = 0;
  let totalInvites = 0;
  for (const prefix of orphanPrefixes) {
    const parentSub = `${prefix}-admin`;
    const adminIds = (await client.smembers(`org-admin:${prefix}:admins`)) ?? [];
    // invite-index er nøklet på tenantPrefix (mm), ikke full subdomain.
    const inviteTokens =
      (await client.smembers(`invite-index:${prefix}`)) ?? [];
    const noteSubs =
      (await client.smembers(`org-admin-notes:${prefix}:index`)) ?? [];
    const hasMpw = await client.exists(`org-meta:${prefix}:mpw`);

    console.log(`\n  • prefix=${prefix} (parent=${parentSub})`);
    console.log(`      org-admins:        ${adminIds.length}`);
    console.log(`      pending-invites:   ${inviteTokens.length}`);
    console.log(`      admin-notes:       ${noteSubs.length}`);
    console.log(`      mpw-verifier:      ${hasMpw ? "yes" : "no"}`);

    totalAdmins += adminIds.length;
    totalInvites += inviteTokens.length;

    if (!CONFIRM) continue;

    // ─── Slett admins + login-events ──────────────────────────────────
    for (const adminId of adminIds) {
      await client.del(`org-admin:${prefix}:admin:${adminId}`);
      await client.del(`org-admin-login-events:${adminId}`);
    }
    await client.del(`org-admin:${prefix}:admins`);

    // ─── Slett invites ────────────────────────────────────────────────
    for (const token of inviteTokens) {
      await client.del(`invite:${token}`);
    }
    await client.del(`invite-index:${prefix}`);

    // ─── Slett admin-notater ──────────────────────────────────────────
    for (const sub of noteSubs) {
      await client.del(`org-admin-notes:${prefix}:${sub}`);
    }
    await client.del(`org-admin-notes:${prefix}:index`);

    // ─── Slett MPW ────────────────────────────────────────────────────
    await client.del(`org-meta:${prefix}:mpw`);

    console.log(`      ✓ slettet`);
  }

  console.log("\n─────────────────────────────────────────");
  console.log(`Sum: ${totalAdmins} admins · ${totalInvites} invites · ${orphanPrefixes.length} prefiks`);
  if (CONFIRM) {
    console.log("✓ Slettet.");
  } else {
    console.log("(DRY-RUN — kjør med --confirm for å faktisk slette.)");
  }
}

main().catch((e) => {
  console.error("✗ Uventet feil:", e);
  process.exit(1);
});
