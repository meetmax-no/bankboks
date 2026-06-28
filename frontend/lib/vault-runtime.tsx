"use client";

/**
 * Ko | Do · Vault — v4.3 — VaultRuntime-context
 *
 * Pakker `useVault()`, `useCards()` og `useIds()` i en React Context på
 * layout-nivå slik at state overlever route-bytter (f.eks. mellom `/` og
 * `/platform/admin`). Per D-001 zero-knowledge: master-pwd-derivert nøkkel
 * lever fortsatt KUN i RAM — bare flyttet fra page-komponentens minne til
 * layout-providerens minne. Begge er flyktig.
 *
 * Brukes via:
 *   const { vault, cards, ids } = useVaultRuntime();
 *
 * Opts (autoLockMinutes, rpName, etc.) leses fra useAppConfig() inne i
 * provideren slik at hver tenant kan ha sine egne security-policies.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useVault, type UseVaultResult } from "@/hooks/useVault";
import { useCards, type UseCardsResult } from "@/hooks/useCards";
import { useIds, type UseIdsResult } from "@/hooks/useIds";
import { useLocale } from "@/lib/i18n-context";

export interface VaultRuntime {
  vault: UseVaultResult;
  cards: UseCardsResult;
  ids: UseIdsResult;
}

const VaultRuntimeContext = createContext<VaultRuntime | null>(null);

export function VaultRuntimeProvider({ children }: { children: ReactNode }) {
  const { config } = useAppConfig();
  const { t } = useLocale();

  const cards = useCards();
  const ids = useIds();

  // Iter 19.9.2 — auto-lås-advarsel: toast-ID lagres i ref så bumpActivity
  // kan dismisse den hvis bruker blir aktiv igjen før timeren går ut.
  // Late-binding-ref til vault så toast-action kan kalle bumpAutoLockActivity
  // (vault er ikke definert ennå i closure-tidspunktet).
  const warningToastIdRef = useRef<string | number | null>(null);
  const vaultRef = useRef<UseVaultResult | null>(null);
  const warningSecs = Math.min(
    120,
    Math.max(30, config.security?.autoLockWarningSecs ?? 60),
  );

  const vault = useVault({
    autoLockMinutes: config.security?.autoLockMinutes ?? 15,
    autoLockWarningSecs: warningSecs,
    forceMasterAfterDays: config.security?.forceMasterAfterDays ?? 14,
    rpName: config.brand?.name ?? "Ko | Do · Vault",
    userDisplayName: config._meta?.createdBy ?? "Vault-bruker",
    onMasterUnlock: (pwd) => {
      // Master-pwd er transient — forsvinner når denne callbacken returnerer.
      // Cards/ids stasher kun pwd til de selv låser opp sin egen blob.
      cards.prepareWithMasterPassword(pwd);
      ids.prepareWithMasterPassword(pwd);
    },
    onAutoLockWarning: () => {
      if (warningToastIdRef.current !== null) return;
      const tid = toast(t("autolocks.warning_message"), {
        duration: warningSecs * 1000,
        action: {
          label: t("autolocks.warning_action"),
          onClick: () => {
            vaultRef.current?.bumpAutoLockActivity();
            if (warningToastIdRef.current !== null) {
              toast.dismiss(warningToastIdRef.current);
              warningToastIdRef.current = null;
            }
          },
        },
        onAutoClose: () => {
          warningToastIdRef.current = null;
        },
        onDismiss: () => {
          warningToastIdRef.current = null;
        },
      });
      warningToastIdRef.current = tid;
    },
    onAutoLockActivity: () => {
      if (warningToastIdRef.current !== null) {
        toast.dismiss(warningToastIdRef.current);
        warningToastIdRef.current = null;
      }
    },
  });
  vaultRef.current = vault;

  // D-062: Atomisk re-kryptering av side-blobs ved master-pwd-bytte.
  // Sendes som callback til changeMasterPassword. Rekkefølge:
  //   1. reEncryptInPlace(cards) → push ny blob, behold original i RAM
  //   2. reEncryptInPlace(ids)   → samme
  //   3. (vault pushes etter denne returnerer — håndteres av useVault)
  // Ved feil rulles allerede pushed-blobs tilbake.
  // useRef pga vi vil ikke at endring i hook-instances trigger
  // changeMasterPassword-rerendering.
  const sideBlobsRef = useRef({ cards, ids });
  sideBlobsRef.current = { cards, ids };
  const reEncryptSideBlobs = async (oldPwd: string, newPwd: string) => {
    const c = sideBlobsRef.current.cards;
    const i = sideBlobsRef.current.ids;
    let cardsRollback: import("@/lib/types").EncryptedVaultBlob | null = null;
    let idsRollback: import("@/lib/types").EncryptedVaultBlob | null = null;
    try {
      const cardsResult = await c.reEncryptInPlace(oldPwd, newPwd);
      if (cardsResult.hadBlob) cardsRollback = cardsResult.originalBlob;
      try {
        const idsResult = await i.reEncryptInPlace(oldPwd, newPwd);
        if (idsResult.hadBlob) idsRollback = idsResult.originalBlob;
      } catch (idsErr) {
        // ids feilet — rull tilbake cards hvis vi pushet
        if (cardsRollback) {
          try {
            await c.rollbackToBlob(cardsRollback);
          } catch {
            /* rollback-feil logges men vi kaster opprinnelig feil */
          }
        }
        throw idsErr;
      }
    } catch (err) {
      // Re-throw — useVault sin VaultPushFailedNeedsRollback fanges også her
      // hvis vi får den senere
      throw err;
    }
    // Stash rollback-blobs på vault-runtime-instansen så de er tilgjengelige
    // hvis vault-push feiler etterpå
    pendingRollbackRef.current = { cardsRollback, idsRollback };
  };

  // Rollback-blobs hvis vault-push feiler EFTER side-blobs er re-kryptert
  const pendingRollbackRef = useRef<{
    cardsRollback: import("@/lib/types").EncryptedVaultBlob | null;
    idsRollback: import("@/lib/types").EncryptedVaultBlob | null;
  } | null>(null);

  // Re-derive aktive side-blob sessions etter MP-bytte (D-062 steg 7).
  // useVault sin onMasterUnlock kalles, men den setter bare ephemeral pwd.
  // For re-derive må vi gjøre det eksplisitt her.
  const rederiveAfterMpChange = async (newPwd: string) => {
    try {
      await cards.rederiveSessionAfterMpChange(newPwd);
    } catch {
      /* graceful — bruker kan låse opp på nytt */
    }
    try {
      await ids.rederiveSessionAfterMpChange(newPwd);
    } catch {
      /* graceful */
    }
  };

  // Wrap vault.changeMasterPassword så side-blobs alltid sendes med +
  // rollback håndteres ved vault-push-feil
  const originalChange = vault.changeMasterPassword;
  const wrappedChangeMP = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    pendingRollbackRef.current = null;
    try {
      await originalChange(currentPassword, newPassword, reEncryptSideBlobs);
      // Vault-push lyktes → re-derive aktive sessions
      await rederiveAfterMpChange(newPassword);
      pendingRollbackRef.current = null;
    } catch (err) {
      // Hvis vault-push feilet etter side-blobs ble re-kryptert: rollback
      if (
        err instanceof Error &&
        err.name === "VaultPushFailedNeedsRollback" &&
        pendingRollbackRef.current
      ) {
        const { cardsRollback, idsRollback } = pendingRollbackRef.current;
        if (cardsRollback) {
          try {
            await cards.rollbackToBlob(cardsRollback);
          } catch {
            /* logge ved feil — vi har allerede en exception å kaste */
          }
        }
        if (idsRollback) {
          try {
            await ids.rollbackToBlob(idsRollback);
          } catch {
            /* */
          }
        }
        pendingRollbackRef.current = null;
      }
      throw err;
    }
  };
  // Override changeMasterPassword på den eksponerte vault-resultatet.
  // Vi lager et nytt objekt så referansen endres når vault selv endres.
  const vaultWithWrappedMP: UseVaultResult = {
    ...vault,
    changeMasterPassword: wrappedChangeMP,
  };

  // v4.3 Iter 1 — Auto-lock cards + ids + admin-session når vault låses.
  // Plassert på layout-nivå (ikke i app/page.tsx) slik at det fyres uansett
  // hvilken rute brukeren er på når lås skjer — f.eks. fra "Lås"-knappen på
  // /platform/admin, fra auto-lås etter idle, eller fra app/page.tsx.
  const prevVaultStatus = useRef(vault.status);
  useEffect(() => {
    if (prevVaultStatus.current === "unlocked" && vault.status !== "unlocked") {
      cards.lock();
      ids.lock();
      if (typeof window !== "undefined") {
        // Fire-and-forget — vault er uansett låst klient-side om POST feiler.
        fetch("/api/admin/logout", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => {
          /* ignorér */
        });
      }
    }
    prevVaultStatus.current = vault.status;
  }, [vault.status, cards, ids]);

  return (
    <VaultRuntimeContext.Provider value={{ vault: vaultWithWrappedMP, cards, ids }}>
      {children}
    </VaultRuntimeContext.Provider>
  );
}

export function useVaultRuntime(): VaultRuntime {
  const ctx = useContext(VaultRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useVaultRuntime() må kalles inne i <VaultRuntimeProvider>. Sjekk app/providers.tsx.",
    );
  }
  return ctx;
}
