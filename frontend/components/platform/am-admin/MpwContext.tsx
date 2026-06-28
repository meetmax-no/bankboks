"use client";
/**
 * Ko | Do · Vault — Iter 20.5b — am-admin MPW React Context
 *
 * In-memory hold av derivet MPW-nøkkel + salt for aktiv sesjon. Brukes av
 * UI-komponenter (MpwSection, EmployeeListSection → AdminNotesModal i
 * 20.5c, BackupExportSection i 20.5d) for å kryptere/dekryptere uten
 * å derive på nytt for hver operasjon.
 *
 * SECURITY:
 *   - Nøkkelen holdes KUN i React-state (ikke localStorage/sessionStorage)
 *   - Auto-låses ved unmount/navigation/reload (browser GC)
 *   - "Lås"-knapp i UI tømmer state manuelt
 *   - MPW-passord lagres ALDRI — kun derivet CryptoKey
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type MpwUnlocked = {
  key: CryptoKey;
  salt: Uint8Array;
  iterations: number;
};

type MpwContextValue = {
  /** True hvis MPW er låst opp i denne sesjonen. */
  isUnlocked: boolean;
  /** Returnerer aktiv nøkkel + salt, eller null hvis låst. */
  getUnlocked: () => MpwUnlocked | null;
  /** Setter aktiv nøkkel (kalles fra MpwSetupModal/MpwUnlockModal). */
  setUnlocked: (unlocked: MpwUnlocked) => void;
  /** Tømmer aktiv nøkkel (manuell "Lås"-knapp). */
  lock: () => void;
};

const MpwContext = createContext<MpwContextValue | null>(null);

export function MpwProvider({ children }: { children: ReactNode }) {
  // Vi bruker BÅDE state (for re-render) og ref (for å lese siste verdi
  // fra event-handlers uten å re-rendre konsumenter ved hver lesing).
  const [unlocked, setUnlockedState] = useState<MpwUnlocked | null>(null);
  const unlockedRef = useRef<MpwUnlocked | null>(null);

  const setUnlocked = useCallback((next: MpwUnlocked) => {
    unlockedRef.current = next;
    setUnlockedState(next);
  }, []);

  const lock = useCallback(() => {
    unlockedRef.current = null;
    setUnlockedState(null);
  }, []);

  const getUnlocked = useCallback(() => unlockedRef.current, []);

  const value = useMemo<MpwContextValue>(
    () => ({
      isUnlocked: unlocked !== null,
      getUnlocked,
      setUnlocked,
      lock,
    }),
    [unlocked, getUnlocked, setUnlocked, lock],
  );

  return <MpwContext.Provider value={value}>{children}</MpwContext.Provider>;
}

export function useMpw(): MpwContextValue {
  const ctx = useContext(MpwContext);
  if (!ctx) {
    throw new Error(
      "useMpw() må brukes innenfor <MpwProvider>. Wrap am-admin-siden med providere.",
    );
  }
  return ctx;
}
