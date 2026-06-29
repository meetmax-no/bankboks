/**
 * Ko | Do · Vault — Cascade-delete av tenant (alle systemer)
 *
 * Sletter en tenant fra ALLE backend-systemer:
 *   1. Vercel-prosjekt (hvis provisjonert)
 *   2. Upstash-database (hvis provisjonert)
 *   3. Client-config i sentral Upstash
 *   4. B2B-prefiks (frigjøres hvis B2B og prefiks satt)
 *   5. TenantRecord (blob + indeks) — SIST, så vi har retry-objekt ved feil
 *
 * Filosofi (per Mike + spec):
 *   - Soft delete: aldri stopp ved enkeltfeil. Logg, fortsett, returner status.
 *   - TenantRecord slettes SIST — hvis noe annet feiler, har admin fortsatt
 *     record-en og kan retry-e via D-055-knappene eller denne funksjonen.
 *   - `tenant_deleted`-event appendes til provisioningLog FØR sletting av
 *     record (slik at loggen er komplett hvis caller velger å beholde
 *     record-en pga. feil i tidligere steg).
 *
 * Bruk:
 *   - Admin-modul (TenantDetailCard "Slett tenant"-knapp)
 *   - Dag 58-cron (Iter 17) — MÅ kalle canAutoDelete() FØR denne (D-069)
 *   - GDPR-forespørsler
 *
 * D-069: Denne funksjonen sjekker IKKE selv free-plan-beskyttelse. Caller
 *        er ansvarlig for å kalle `canAutoDelete()` fra lifecycle-guard.ts
 *        før denne kalles fra cron/webhook-context. Admin-manuell sletting
 *        bypasser D-069 per design.
 *
 * Node runtime.
 */
import {
  deleteTenantRecord,
  getTenant,
  appendProvisioningEvent,
} from "./tenant-store";
import { deleteVercelProject } from "./vercel-provision";
import { deleteUpstashDatabase } from "./upstash-provision";
import { deleteClientConfig } from "./client-config-store";
import { removeReservedPrefix } from "./subdomain";
import { deleteStripeCustomer, tenantHasPaidHistory } from "@/lib/stripe/cleanup";
import { deleteNote, deleteAllNotes } from "./am-admin-notes-store";
import { deleteAllOrgAdminsForPrefix } from "./org-admin-store";
import { deleteMpwVerifier } from "./am-admin-mpw-store";
import { listInvitesForParent, deleteInvite, deleteInvitesForSubdomain } from "./invite-store";

/**
 * Status for hvert ressurssletting-steg i `deleteTenant()`.
 *
 * - `"ok"`         — steget kjørte og lyktes
 * - `"failed"`     — steget kjørte men feilet (logges i errors[])
 * - `"skipped"`    — steget hoppet over (typisk: ingen ressurs-ID fantes)
 * - `"preserved"`  — Stripe-only. Bevisst bevart per D-070
 *                    (revisjonsspor for betalte tenants). Skiller seg
 *                    fra "skipped" som betyr "ingenting å gjøre".
 */
export type DeleteStepStatus = "ok" | "failed" | "skipped" | "preserved";

export type DeleteResult = {
  /**
   * True hvis sluttilstanden er "tenant er borte fra sentral DB".
   * Enkeltfeil i Vercel/Upstash/Stripe/client-config gjør IKKE
   * success=false — det er soft-failure og logges i `errors[]` for
   * caller å håndtere.
   */
  success: boolean;
  steps: {
    vercel: DeleteStepStatus;
    upstash: DeleteStepStatus;
    centralDb: DeleteStepStatus;
    clientConfig: DeleteStepStatus;
    b2bPrefix: DeleteStepStatus;
    stripe: DeleteStepStatus;
    adminNotes: DeleteStepStatus;
    /** D-091: orgAdmins purges (kun B2B-parent). */
    orgAdmins: DeleteStepStatus;
    /** D-091: MPW-verifier (kun B2B-parent). */
    mpw: DeleteStepStatus;
    /** D-091: pending/expired invites (kun B2B-parent). */
    invites: DeleteStepStatus;
  };
  errors: string[];
  /** D-091: meta-info om antall ressurser slettet (for audit-spor). */
  meta: {
    orgAdminsDeleted: number;
    invitesDeleted: number;
    adminNotesDeleted: number;
  };
};

export type DeleteContext = "admin" | "cron" | "gdpr";

/**
 * Slett en tenant i alle systemer.
 *
 * Idempotent: hvis tenant ikke finnes i sentral DB returneres umiddelbart
 * med `success: false` og en notis i errors. Caller kan tolke dette som
 * "allerede borte" og fortsette.
 *
 * @param subdomain — tenantens subdomain (normaliseres til lowercase internt)
 * @param context — hvem som trigget slettingen (for audit-log-detail)
 */
export async function deleteTenant(
  subdomain: string,
  context: DeleteContext = "admin",
): Promise<DeleteResult> {
  const result: DeleteResult = {
    success: false,
    steps: {
      vercel: "skipped",
      upstash: "skipped",
      centralDb: "skipped",
      clientConfig: "skipped",
      b2bPrefix: "skipped",
      stripe: "skipped",
      adminNotes: "skipped",
      orgAdmins: "skipped",
      mpw: "skipped",
      invites: "skipped",
    },
    errors: [],
    meta: {
      orgAdminsDeleted: 0,
      invitesDeleted: 0,
      adminNotesDeleted: 0,
    },
  };

  const sub = subdomain.toLowerCase().trim();

  // ─── Steg 0: hent record (trenger projectId, databaseId, customerType) ───
  const record = await getTenant(sub);
  if (!record) {
    result.errors.push(`Tenant '${sub}' finnes ikke i sentral DB.`);
    return result;
  }

  // ─── Steg 0.5: logg "tenant_deleted"-event FØR vi sletter record ────────
  // (legges til record-en så loggen er komplett selv om resten feiler)
  try {
    await appendProvisioningEvent(sub, {
      timestamp: new Date().toISOString(),
      stage: "tenant_deleted",
      status: "ok",
      detail: `Slettet av ${context}`,
    });
  } catch (e) {
    // Ikke kritisk — fortsett.
    console.error("[deleteTenant] log event failed:", e);
  }

  // ─── Steg 1: slett Vercel-prosjekt ──────────────────────────────────────
  if (record.vercelProjectId) {
    try {
      await deleteVercelProject(record.vercelProjectId);
      result.steps.vercel = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.vercel = "failed";
      result.errors.push(`Vercel: ${msg}`);
      console.error(`[deleteTenant ${sub}] Vercel failed:`, e);
    }
  }

  // ─── Steg 2: slett Upstash-database ─────────────────────────────────────
  if (record.upstashDatabaseId) {
    try {
      await deleteUpstashDatabase(record.upstashDatabaseId);
      result.steps.upstash = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.upstash = "failed";
      result.errors.push(`Upstash: ${msg}`);
      console.error(`[deleteTenant ${sub}] Upstash failed:`, e);
    }
  }

  // ─── Steg 3: slett client-config fra sentral Upstash ────────────────────
  try {
    await deleteClientConfig(sub);
    result.steps.clientConfig = "ok";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.steps.clientConfig = "failed";
    result.errors.push(`client-config: ${msg}`);
    console.error(`[deleteTenant ${sub}] client-config failed:`, e);
  }

  // ─── Steg 3.25: rydd am-admin adminNotes (Iter 20.5c orphan-prevention) ──
  // Hvis tenant er et B2B-barn under en am-admin-org, kan det finnes
  // krypterte adminNotes lagret på `org-admin-notes:<parentPrefix>:<sub>`.
  // Vi sletter idempotent — notatet er allerede uleselig hvis MPW-verifier
  // er borte, men recorden i Upstash forblir som orphan til "Glemt MPW"-
  // reset hvis vi ikke rydder her.
  //
  // D-118 (2026-06-29): I tillegg slettes invite-record(er) som peker på
  // dette subdomenet. Tidligere D-101 stempler dem som "Child-vault
  // slettet" for audit-spor, men `logEvent` på parent dekker det allerede
  // — invite-recordene tilfører ingen ny info, bare orphan-støy.
  if (record.parentTenant && record.customerType === "b2c") {
    try {
      // parentTenant for B2B-barn er parent-subdomenet, men am-admin-
      // notes-storage er indeksert via parent-prefiks. Vi avleder prefiks
      // fra subdomain-format: <prefix>-<rest>. Dette matcher subdomain-
      // valideringen i invites-flowen (D-079).
      const dashIdx = sub.indexOf("-");
      if (dashIdx > 0) {
        const parentPrefix = sub.slice(0, dashIdx);
        await deleteNote(parentPrefix, sub);
        result.steps.adminNotes = "ok";
      } else {
        result.steps.adminNotes = "skipped";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.adminNotes = "failed";
      result.errors.push(`adminNotes: ${msg}`);
      console.error(`[deleteTenant ${sub}] adminNotes cleanup failed:`, e);
    }

    // D-118: slett alle invite-records (pending/expired/used) der
    // subdomain matcher denne barn-tenanten. Audit-spor er allerede sikret
    // via logEvent på parent (provisioningLog).
    try {
      const deleted = await deleteInvitesForSubdomain(sub);
      result.meta.invitesDeleted = deleted;
      result.steps.invites = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.invites = "failed";
      result.errors.push(`invites: ${msg}`);
      console.error(`[deleteTenant ${sub}] invites cleanup failed:`, e);
    }
  }

  // ─── Steg 3.4 (D-091, 2026-06-28): B2B-parent cascade ──────────────────
  // Hvis vi sletter selve am-admin parent-recorden (`<prefix>-admin` med
  // customerType=b2b og parentTenant=null), MÅ vi også slette alle
  // OrgAdmin-records, MPW-verifier, admin-notater og pending-invites under
  // det prefikset. Uten dette blir admin-records "orphans" som blokkerer
  // gjenopprettelse av samme org (samme e-post-unique-constraint feiler).
  //
  // ⚠️ Denne grenen kjører IKKE for B2B child-vaults (parentTenant !== null)
  // eller B2C-tenants — de har ingen org-admins/MPW/notes/invites å rydde.
  const isB2BParent =
    record.customerType === "b2b" &&
    record.parentTenant === null &&
    record.tenantPrefix &&
    sub.endsWith("-admin");

  if (isB2BParent && record.tenantPrefix) {
    const prefix = record.tenantPrefix.toLowerCase();

    // 3.4a — Slett alle OrgAdmin-records + login-events (bypasser
    // last-super-admin-invariant per design — hele orgen forsvinner).
    try {
      const { deletedCount } = await deleteAllOrgAdminsForPrefix(prefix);
      result.meta.orgAdminsDeleted = deletedCount;
      result.steps.orgAdmins = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.orgAdmins = "failed";
      result.errors.push(`orgAdmins: ${msg}`);
      console.error(`[deleteTenant ${sub}] orgAdmins purge failed:`, e);
    }

    // 3.4b — Slett MPW-verifier-envelope.
    try {
      await deleteMpwVerifier(prefix);
      result.steps.mpw = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.mpw = "failed";
      result.errors.push(`mpw: ${msg}`);
      console.error(`[deleteTenant ${sub}] mpw delete failed:`, e);
    }

    // 3.4c — Slett ALLE admin-notater (alle subdomains) + indeks.
    try {
      const deleted = await deleteAllNotes(prefix);
      result.meta.adminNotesDeleted = deleted;
      result.steps.adminNotes = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.adminNotes = "failed";
      result.errors.push(`adminNotes (parent purge): ${msg}`);
      console.error(`[deleteTenant ${sub}] adminNotes parent-purge failed:`, e);
    }

    // 3.4d — Slett alle invites under denne parent (pending + expired + used).
    // `listInvitesForParent` slår opp via `invite-index:<parentTenant>` der
    // parentTenant er TENANT-PREFIKSET (mm), ikke full subdomain (mm-admin),
    // fordi InviteRecord.parentTenant settes til prefiks av invite-create-route.
    try {
      const invites = await listInvitesForParent(record.tenantPrefix);
      for (const inv of invites) {
        await deleteInvite(inv);
      }
      result.meta.invitesDeleted = invites.length;
      result.steps.invites = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.invites = "failed";
      result.errors.push(`invites: ${msg}`);
      console.error(`[deleteTenant ${sub}] invites purge failed:`, e);
    }
  }

  // ─── Steg 3.5: rydd Stripe customer (med D-070-bevaringsregel) ─────
  // Per D-070-revisjon 2026-06-13: customer slettes KUN for tenants som
  // aldri har betalt. Betalte tenants får customer-objektet bevart hos
  // Stripe for revisjonsspor (bokføringsloven, 5 år). Markørene er
  // dokumentert i `lib/stripe/cleanup.ts` (tenantHasPaidHistory).
  // Skjer FØR sentral DB-sletting så vi har customerId + log tilgjengelig.
  {
    const hasPaidHistory = tenantHasPaidHistory(record);
    const stripeResult = await deleteStripeCustomer(record.stripeCustomerId, {
      hasPaidHistory,
    });
    result.steps.stripe = stripeResult.status;
    if (stripeResult.status === "failed" && stripeResult.detail) {
      result.errors.push(`Stripe: ${stripeResult.detail}`);
    }
    // Logg "preserved" eksplisitt i tenant-loggen (selv om tenant-recorden
    // slettes rett etter) — gir et audit-spor i fremtidig anonymisert
    // audit-tabell (ROADMAP P3) hvis vi noensinne lekker eventene dit
    // før sletting.
    if (stripeResult.status === "preserved") {
      await appendProvisioningEvent(sub, {
        timestamp: new Date().toISOString(),
        stage: "tenant_deleted",
        status: "ok",
        detail: `Stripe customer ${record.stripeCustomerId} BEVART (D-070): ${stripeResult.detail ?? ""}`,
      });
    }
  }

  // ─── Steg 4: slett TenantRecord fra sentral Upstash (SIST) ──────────────
  try {
    const removed = await deleteTenantRecord(sub);
    result.steps.centralDb = removed ? "ok" : "failed";
    if (!removed) {
      result.errors.push("Sentral DB: record var allerede borte.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.steps.centralDb = "failed";
    result.errors.push(`Sentral DB: ${msg}`);
    console.error(`[deleteTenant ${sub}] central DB failed:`, e);
    // Hvis sentral DB feiler er det DEN feilen som teller for success.
    // Vi returnerer her — B2B-prefiks frigjøres KUN hvis record faktisk er borte.
    return result;
  }

  // ─── Steg 5: frigjør B2B-prefiks (kun etter vellykket DB-sletting) ──────
  if (
    record.customerType === "b2b" &&
    record.tenantPrefix &&
    result.steps.centralDb === "ok"
  ) {
    try {
      await removeReservedPrefix(record.tenantPrefix);
      result.steps.b2bPrefix = "ok";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.steps.b2bPrefix = "failed";
      result.errors.push(`B2B-prefiks: ${msg}`);
      console.error(`[deleteTenant ${sub}] B2B prefix release failed:`, e);
    }
  }

  // success = sentral DB faktisk slettet. Andre steg er soft-failure.
  result.success = result.steps.centralDb === "ok";
  return result;
}
