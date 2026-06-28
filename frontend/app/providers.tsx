/**
 * Ko | Do · Vault — Client-side providers wrapper.
 *
 * Wrappes rundt children i `app/layout.tsx` (som er en Server Component).
 * Sentralt sted for alle React-contexts som krever klient-runtime —
 * starter med LocaleProvider (v4.2 D-036), kan utvides senere.
 *
 * Henter tenant-config via useAppConfig så LocaleProvider får riktig
 * `defaultLocale` per kunde. useAppConfig vil hente JSON-en på nytt inne i
 * page.tsx — det er en kjent dobbel-fetch (~3 KB) som er akseptabel kost
 * for clean separation. Hvis det blir et problem senere, kan vi løfte
 * config-state opp i en egen context i en patch-release.
 */

"use client";

import type { ReactNode } from "react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { LocaleProvider } from "@/lib/i18n-context";
import { isValidLocale, type Locale } from "@/lib/i18n";
import { LocalePromptToast } from "@/components/LocalePromptToast";
import { PWAInstallHint } from "@/components/platform/PWAInstallHint";
import { ServiceWorkerRegister } from "@/components/platform/ServiceWorkerRegister";
import { VaultRuntimeProvider } from "@/lib/vault-runtime";

export function Providers({ children }: { children: ReactNode }) {
  const { config } = useAppConfig();
  const tenantDefault: Locale | null =
    config.defaultLocale && isValidLocale(config.defaultLocale)
      ? config.defaultLocale
      : null;

  return (
    <LocaleProvider tenantDefaultLocale={tenantDefault}>
      <VaultRuntimeProvider>
        {children}
        <LocalePromptToast />
        <PWAInstallHint />
        <ServiceWorkerRegister />
      </VaultRuntimeProvider>
    </LocaleProvider>
  );
}
