/**
 * Ko | Do · Vault — i18n React context + hook (D-036)
 *
 * Bygger på `lib/i18n.ts` (pure kjerne). Denne fila legger på React-laget:
 *   - <LocaleProvider> som wrapper appen
 *   - useLocale()-hook som komponenter bruker
 *
 * SSR-trygghet: Initial render bruker DEFAULT_LOCALE ("no") for å unngå
 * hydration-mismatch. Klient-side useEffect korrigerer etter mount.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  isValidLocale,
  readStoredLocale,
  resolveInitialLocale,
  translate,
  writeStoredLocale,
  type Locale,
} from "@/lib/i18n";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * LocaleProvider — wrap rundt appen i app/providers.tsx.
 *
 * `tenantDefaultLocale` mates fra `useAppConfig().config.defaultLocale` —
 * Provideren tar den som prop slik at den ikke trenger å kjenne config-laget.
 */
export function LocaleProvider({
  children,
  tenantDefaultLocale,
}: {
  children: ReactNode;
  tenantDefaultLocale?: Locale | null;
}) {
  // SSR-safe initial: alltid DEFAULT_LOCALE (norsk). Klient korrigerer i useEffect.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  // På mount: les localStorage + bruk deteksjons-kjeden
  useEffect(() => {
    const stored = readStoredLocale();
    const navLang = typeof navigator !== "undefined" ? navigator.language : null;
    const resolved = resolveInitialLocale({
      stored,
      tenantDefault: tenantDefaultLocale ?? null,
      navLanguage: navLang,
    });
    setLocaleState(resolved);
    if (typeof document !== "undefined") {
      document.documentElement.lang = resolved;
      const title = translate("app.html_title", resolved);
      if (title && title !== "app.html_title") {
        document.title = title;
      }
    }
    setHydrated(true);
    // Intensjonelt tom dep-liste: vi vil kun kjøre én gang på mount.
    // tenantDefault håndteres separat i neste useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hvis tenant-default lander asynkront (useAppConfig laster JSON) etter
  // mount, og brukeren ikke har eksplisitt valgt: ta tenant-defaulten.
  useEffect(() => {
    if (!hydrated) return;
    if (readStoredLocale()) return; // brukerens valg står
    if (tenantDefaultLocale && isValidLocale(tenantDefaultLocale)) {
      setLocaleState(tenantDefaultLocale);
      if (typeof document !== "undefined") {
        document.documentElement.lang = tenantDefaultLocale;
        const title = translate("app.html_title", tenantDefaultLocale);
        if (title && title !== "app.html_title") {
          document.title = title;
        }
      }
    }
  }, [tenantDefaultLocale, hydrated]);

  const setLocale = useCallback((next: Locale) => {
    if (!isValidLocale(next)) return;
    setLocaleState(next);
    writeStoredLocale(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
      const title = translate("app.html_title", next);
      if (title && title !== "app.html_title") {
        document.title = title;
      }
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key: string) => translate(key, locale),
    }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * useLocale — React-hook for å lese + sette aktiv locale, samt få bundet t()-funksjon.
 *
 * Throws hvis brukt utenfor LocaleProvider (utviklings-feil — skal aldri skje i prod).
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      "useLocale() må brukes innenfor <LocaleProvider>. Sjekk at app/providers.tsx wrappet appen.",
    );
  }
  return ctx;
}
