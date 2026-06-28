/**
 * Ko | Do · Vault — v4.3 Iter 17 (2026-06-13) — /api/cron/lifecycle-sweep
 *
 * Daglig cron-jobb (Vercel Cron, 03:00 UTC, se vercel.json). Itererer alle
 * tenants og utfører lifecycle-handlinger per pure logikk i
 * `lib/platform/lifecycle-cron.ts`:
 *
 *   - LOCK:    trial utløpt → status="locked", lockedAt=now
 *   - WARN_T7: 7 dager før sletting → send e-post
 *   - WARN_T3: 3 dager før sletting → send e-post
 *   - WARN_T1: 1 dag før sletting   → send e-post
 *   - DELETE:  28 dager låst → hard delete via deleteTenant()
 *
 * Auth: Vercel Cron sender `Authorization: Bearer ${CRON_SECRET}`. Mismatch
 * → 401. Hindrer at uautoriserte triggere kan kjøre sweep'en manuelt.
 *
 * Idempotent: hver sweep skanner alle tenants på nytt; varsler har egne
 * `lifecycleWarningsSentAt`-flagg slik at samme dag-vindu ikke sender to
 * eposter ved replay. DELETE er beskyttet av D-069-guard via
 * `canAutoDelete()` på toppen av handlingen.
 *
 * Returnerer JSON-summary med tellere + per-tenant resultater (kun
 * handlinger ≠ NOOP for kompakthet).
 *
 * Node runtime — sletting krever Stripe/Vercel/Upstash-API-kall.
 */
import { NextResponse } from "next/server";
import {
  listTenants,
  putTenant,
  appendProvisioningEvent,
} from "@/lib/platform/tenant-store";
import { decideAction, DEFAULT_SWEEP_CONFIG } from "@/lib/platform/lifecycle-cron";
import { deleteTenant } from "@/lib/platform/delete-tenant";
import {
  sendLifecycleWarning,
  sendTrialReminderT5,
  sendLockedFromTrial,
  sendDeletedConfirmation,
} from "@/lib/platform/notify-email";
import { canAutoLock, canAutoDelete } from "@/lib/platform/lifecycle-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby timeout 10s; Pro 60s. Sweep kan ta tid → øk til 60s.
export const maxDuration = 60;

interface ActionLogEntry {
  subdomain: string;
  action: string;
  detail?: string;
  ok?: boolean;
  error?: string;
}

export async function GET(req: Request) {
  // ─── 1. Auth ─────────────────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/lifecycle-sweep] CRON_SECRET ikke satt — avbryter");
    return NextResponse.json(
      { ok: false, error: "cron_secret_not_configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ─── 2. Iterer tenants ───────────────────────────────────────────────
  const now = new Date();
  const tenants = await listTenants();
  const counters = {
    scanned: tenants.length,
    locked: 0,
    warned: 0,
    deleted: 0,
    noop: 0,
    errors: 0,
  };
  const actions: ActionLogEntry[] = [];

  for (const tenant of tenants) {
    try {
      const decision = decideAction(tenant, now, DEFAULT_SWEEP_CONFIG);

      switch (decision.type) {
        case "LOCK": {
          // D-069 defensiv dobbeltsjekk — decideAction har allerede sjekket,
          // men vi verifiserer igjen rett før mutering. Tenant kan ha endret
          // status mellom decideAction og putTenant (race).
          const guard = canAutoLock(tenant);
          if (!guard.allowed) {
            counters.noop++;
            actions.push({
              subdomain: tenant.subdomain,
              action: "LOCK_BLOCKED",
              ok: false,
              detail: `D-069: ${guard.reason}`,
            });
            break;
          }
          const lockedTenant = {
            ...tenant,
            status: "locked" as const,
            lockedAt: now.toISOString(),
          };
          await putTenant(lockedTenant);
          await appendProvisioningEvent(tenant.subdomain, {
            timestamp: now.toISOString(),
            stage: "status_change",
            status: "ok",
            detail: `cron lifecycle-sweep: trial→locked (${decision.reason})`,
          });
          // Iter 17 full pakke: send A2 (locked-from-trial). Webhook
          // håndterer B1 (locked-from-cancel) i sin egen flow, så cron
          // sender ALDRI A2 for tenants som ble låst via cancel.
          // `fromCancel`-flagget settes false for trial-cron her.
          if (!decision.fromCancel) {
            const deleteDate = new Date(now.getTime());
            deleteDate.setUTCDate(
              deleteDate.getUTCDate() + DEFAULT_SWEEP_CONFIG.lockToDeleteDays,
            );
            const mail = await sendLockedFromTrial(lockedTenant, deleteDate);
            if (mail.ok === true || mail.skipped === true) {
              await putTenant({
                ...lockedTenant,
                lockedNotificationSentAt: now.toISOString(),
              });
            }
            await appendProvisioningEvent(tenant.subdomain, {
              timestamp: new Date().toISOString(),
              stage: "status_change",
              status: mail.ok === false ? "failed" : "ok",
              detail: `A2 locked-from-trial mail: ${
                mail.ok
                  ? `sendt (${mail.emailId ?? "?"})`
                  : mail.skipped
                    ? `hoppet (${mail.reason ?? "?"})`
                    : `feilet: ${mail.error ?? "?"}`
              }`,
            });
          }
          counters.locked++;
          actions.push({
            subdomain: tenant.subdomain,
            action: "LOCK",
            detail: decision.reason,
            ok: true,
          });
          break;
        }

        case "WARN_TRIAL_T5": {
          // Iter 17 full pakke: A1 — sendes 5 dager før trial-utløp.
          // Idempotent via tenant.trialReminderT5SentAt (sjekkes i
          // decideAction; vi setter feltet etter vellykket send).
          const mail = await sendTrialReminderT5(tenant);
          const shouldPersist =
            mail.ok === true || mail.skipped === true;
          if (shouldPersist) {
            await putTenant({
              ...tenant,
              trialReminderT5SentAt: now.toISOString(),
            });
          }
          await appendProvisioningEvent(tenant.subdomain, {
            timestamp: now.toISOString(),
            stage: "status_change",
            status: mail.ok === false ? "failed" : "ok",
            detail: `A1 trial-reminder-t5 mail: ${
              mail.ok
                ? `sendt (${mail.emailId ?? "?"})`
                : mail.skipped
                  ? `hoppet (${mail.reason ?? "?"})`
                  : `feilet: ${mail.error ?? "?"}`
            }`,
          });
          counters.warned++;
          actions.push({
            subdomain: tenant.subdomain,
            action: "WARN_TRIAL_T5",
            ok: mail.ok !== false,
            detail: mail.skipped ? mail.reason : undefined,
            error: mail.error,
          });
          break;
        }

        case "WARN_A3": {
          // Iter 17 endelig vedtak (2026-06-13): ÉN A3-varsel per tenant,
          // sendt dag 21 etter lock. Lifecycle-warning-templaten bruker
          // daysLeft=7 (fast — det er alltid 7 dager til hard delete på
          // dag 28). Idempotens via lifecycleWarningsSentAt.t7.
          const lockedAt = new Date(tenant.lockedAt!);
          const deleteDate = new Date(lockedAt.getTime());
          deleteDate.setUTCDate(
            deleteDate.getUTCDate() + DEFAULT_SWEEP_CONFIG.lockToDeleteDays,
          );

          const emailRes = await sendLifecycleWarning(
            tenant,
            "t7",
            deleteDate,
          );

          const shouldPersist =
            emailRes.ok === true || emailRes.skipped === true;
          if (shouldPersist) {
            await putTenant({
              ...tenant,
              lifecycleWarningsSentAt: {
                ...tenant.lifecycleWarningsSentAt,
                t7: now.toISOString(),
              },
            });
          }
          await appendProvisioningEvent(tenant.subdomain, {
            timestamp: now.toISOString(),
            stage: "status_change",
            status: emailRes.ok === false ? "failed" : "ok",
            detail: `cron lifecycle-sweep: WARN_A3 → ${
              emailRes.ok
                ? `sendt (${emailRes.emailId ?? "?"})`
                : emailRes.skipped
                  ? `hoppet (${emailRes.reason ?? "?"})`
                  : `feilet: ${emailRes.error ?? "?"}`
            }`,
          });
          counters.warned++;
          actions.push({
            subdomain: tenant.subdomain,
            action: "WARN_A3",
            ok: emailRes.ok !== false,
            detail: emailRes.skipped ? emailRes.reason : undefined,
            error: emailRes.error,
          });
          break;
        }

        case "B2B_GRACE_LOCK": {
          // Iter 20.4b (D-080 · 2026-06-26): B2B parent har passert grace-
          // perioden. Vi låser parent og cascade-låser alle children under
          // samme prefix som ikke allerede er låst. Children får
          // `parentLockedAt` satt så `invoice.paid`-webhook vet hvilke
          // som skal cascade-unlocke ved gjenopprettet betaling.
          const guard = canAutoLock(tenant);
          if (!guard.allowed) {
            counters.noop++;
            actions.push({
              subdomain: tenant.subdomain,
              action: "B2B_GRACE_LOCK_BLOCKED",
              ok: false,
              detail: `D-069: ${guard.reason}`,
            });
            break;
          }

          // 1. Lås parent
          await putTenant({
            ...tenant,
            status: "locked",
            lockedAt: now.toISOString(),
          });

          // 2. Cascade-lås children (samme listTenants-snapshot — vi sjekker
          //    `parentTenant === tenant.subdomain` for å unngå utilsiktet
          //    prefix-match med andre orgs)
          const children = tenants.filter(
            (t) =>
              t.parentTenant === tenant.subdomain &&
              t.subdomain !== tenant.subdomain &&
              t.status !== "locked" &&
              t.status !== "deleted",
          );
          let cascadeCount = 0;
          for (const child of children) {
            try {
              // ⚠️ Designvalg (D-080): cascade-låste children får
              // `parentLockedAt` satt men `lockedAt` forblir NULL. Dette
              // ekskluderer dem fra 28-dagers auto-delete-pathen i
              // decideAction() — gjenoppretting skjer KUN via parent-
              // betaling (cascadeUnlockB2BChildren i handleInvoicePaid).
              // Hvis Mike senere ønsker auto-delete på vedvarende cascade-
              // lock, må vi legge til en separat sweep-fase her.
              await putTenant({
                ...child,
                status: "locked",
                parentLockedAt: now.toISOString(),
              });
              cascadeCount++;
              await appendProvisioningEvent(child.subdomain, {
                timestamp: now.toISOString(),
                stage: "status_change",
                status: "ok",
                detail: `b2b_cascade_lock: parent='${tenant.subdomain}' grace utløp (${decision.graceExpiredAt})`,
              });
            } catch (childErr) {
              const msg =
                childErr instanceof Error
                  ? childErr.message
                  : String(childErr);
              console.error(
                `[cron/lifecycle-sweep] cascade-lock child=${child.subdomain} feilet:`,
                msg,
              );
              actions.push({
                subdomain: child.subdomain,
                action: "B2B_CASCADE_LOCK_ERROR",
                ok: false,
                error: msg,
              });
            }
          }

          await appendProvisioningEvent(tenant.subdomain, {
            timestamp: now.toISOString(),
            stage: "status_change",
            status: "ok",
            detail: `cron lifecycle-sweep: B2B_GRACE_LOCK (${decision.reason}); cascade-låst ${cascadeCount}/${children.length} children`,
          });
          counters.locked++;
          actions.push({
            subdomain: tenant.subdomain,
            action: "B2B_GRACE_LOCK",
            ok: true,
            detail: `${decision.reason}; cascade=${cascadeCount}/${children.length}`,
          });
          break;
        }

        case "DELETE": {
          // D-069 defensiv dobbeltsjekk for hard delete også.
          const guard = canAutoDelete(tenant);
          if (!guard.allowed) {
            counters.noop++;
            actions.push({
              subdomain: tenant.subdomain,
              action: "DELETE_BLOCKED",
              ok: false,
              detail: `D-069: ${guard.reason}`,
            });
            break;
          }
          // Iter 17 full pakke: send A4/B3 (deleted-confirmation) FØR
          // selve sletting, slik at vi rekker å hente firstName/email
          // fra recorden. Idempotensesjekk gjør at hvis cron-kjøringen
          // krasjer mellom mail-send og deleteTenant og kjøres på nytt,
          // sendes ikke mailen to ganger.
          if (!tenant.deletedNotificationSentAt) {
            const mail = await sendDeletedConfirmation(tenant);
            if (mail.ok === true || mail.skipped === true) {
              // OBS: vi skriver tilbake til tenant-recorden selv om vi
              // skal slette den straks. Dette gir et audit-spor i
              // provisioningLog som append'es videre, og hindrer
              // dobbel-send hvis race oppstår.
              await putTenant({
                ...tenant,
                deletedNotificationSentAt: now.toISOString(),
              });
            }
            await appendProvisioningEvent(tenant.subdomain, {
              timestamp: new Date().toISOString(),
              stage: "status_change",
              status: mail.ok === false ? "failed" : "ok",
              detail: `A4/B3 deleted-confirmation mail (pre-delete): ${
                mail.ok
                  ? `sendt (${mail.emailId ?? "?"})`
                  : mail.skipped
                    ? `hoppet (${mail.reason ?? "?"})`
                    : `feilet: ${mail.error ?? "?"}`
              }`,
            });
          }
          const result = await deleteTenant(tenant.subdomain, "cron");
          counters.deleted++;
          actions.push({
            subdomain: tenant.subdomain,
            action: "DELETE",
            ok: result.success,
            detail: `Stripe: ${result.steps.stripe}, Vercel: ${result.steps.vercel}, central: ${result.steps.centralDb}`,
            error: result.errors.join("; ") || undefined,
          });
          break;
        }

        case "NOOP":
        default:
          counters.noop++;
          break;
      }
    } catch (err) {
      counters.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron/lifecycle-sweep] tenant=${tenant.subdomain} feilet:`,
        msg,
      );
      actions.push({
        subdomain: tenant.subdomain,
        action: "ERROR",
        ok: false,
        error: msg,
      });
    }
  }

  console.log(
    `[cron/lifecycle-sweep] ${counters.scanned} scanned, ` +
      `${counters.locked} locked, ${counters.warned} warned, ` +
      `${counters.deleted} deleted, ${counters.errors} errors`,
  );

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    counters,
    actions,
  });
}
