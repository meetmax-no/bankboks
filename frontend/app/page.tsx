"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { MasterPasswordSetup } from "@/components/MasterPasswordSetup";
import { MasterPasswordLogin } from "@/components/MasterPasswordLogin";
import { DashboardShell } from "@/components/DashboardShell";
import { DeleteAccountDialog } from "@/components/DeleteAccountDialog";
import { ExportPasswordsDialog } from "@/components/ExportPasswordsDialog";
import { UpgradeBanner } from "@/components/UpgradeBanner";
import { PaywallOverlay } from "@/components/PaywallOverlay";
import { CardModal } from "@/components/CardModal";
import { IdModal } from "@/components/IdModal";
import { BiometricEnableCard } from "@/components/Biometric";
import { SearchPalette } from "@/components/SearchPalette";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ChangeMasterDialog } from "@/components/ChangeMasterDialog";
import { EntryModal } from "@/components/EntryModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BackupExportModal } from "@/components/BackupExportModal";
import { BackupImportModal } from "@/components/BackupImportModal";
import { PasswordLab } from "@/components/PasswordLab";
import { EventLogPanel } from "@/components/EventLogPanel";
import { MobileBottomBar } from "@/components/MobileBottomBar";
import { PackageHubModal } from "@/components/PackageHubModal";
import { PackModule } from "@/components/PackModule";
import { UnpackModule } from "@/components/UnpackModule";
import { PackageEntryButton } from "@/components/PackageEntryButton";
import { LanguagePicker } from "@/components/LanguagePicker";
import { useLocale } from "@/lib/i18n-context";
import { localeToBcp47 } from "@/lib/format-date";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useIsMac } from "@/hooks/useIsMac";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useIsSafari } from "@/hooks/useIsSafari";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useVaultRuntime } from "@/lib/vault-runtime";
import { APP_VERSION } from "@/lib/version";
import {
  BackupParseError,
  buildEnvelope,
  downloadEnvelope,
  parseEnvelope,
  readFileAsText,
  type BackupEnvelope,
} from "@/lib/backup";
import type { BackupBlobSource } from "@/lib/backup-registry";
import {
  loadBgPreference,
  saveBgPreference,
  type BgMode,
  type BgPreference,
} from "@/lib/bg-preference";
import { GRADIENT_BACKGROUNDS } from "@/lib/settings/background-gradients";
import type {
  VaultEntry,
  EncryptedVaultBlob,
  VaultPayload,
  CardsPayload,
  IdsPayload,
} from "@/lib/types";
import { clearClipboardNow } from "@/lib/clipboard";

const DEFAULT_BG =
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=2070&auto=format&fit=crop";

/**
 * Strip interne ADR-suffikser fra `_meta.createdBy` før visning i footer.
 *
 * Provisjoneringen brukte tidligere strengen "Ko | Do · Vault provisioning
 * (D-060)" som createdBy — ADR-referansen lekket til sluttbrukerens footer
 * (2026-06-24 fix). Nye tenants får nå "Ko | Do Consult" direkte fra
 * tenant-config-builder. Eksisterende tenants beholder gammel verdi i
 * Upstash til neste config-rebuild — denne helperen stripper ADR-suffix
 * defensivt slik at legacy også vises pent.
 *
 * Eksempler:
 *   "Ko | Do · Vault provisioning (D-060)" → "Ko | Do Consult"
 *   "Ko | Do Consult"                      → "Ko | Do Consult"  (uberørt)
 *   undefined                              → "Ko | Do Consult"  (fallback)
 *   "Annet selskap (D-099)"                → "Annet selskap"     (suffix strippes)
 */
function sanitizeCreatedBy(raw: string | undefined | null): string {
  if (!raw) return "Ko | Do Consult";
  // Spesifikk legacy-streng → kanonisk navn
  if (/provisioning\s*\(D-\d{3}\)/i.test(raw)) return "Ko | Do Consult";
  // Generisk: strip alle " (D-NNN)"-suffikser
  return raw.replace(/\s*\(D-\d{3}\)\s*$/, "").trim() || "Ko | Do Consult";
}

export default function Home() {
  const { config, status: configStatus } = useAppConfig();
  const { t, locale } = useLocale();
  const isMobile = useIsMobile();
  const isSafari = useIsSafari();
  const isMac = useIsMac();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // v4.3: vault/cards/ids leves nå i VaultRuntime-context på layout-nivå
  // (lib/vault-runtime.tsx). State overlever route-bytter (f.eks. mellom
  // / og /platform/admin) — master-pwd-derivert nøkkel forblir i RAM.
  // Side-effekt ved vault.lock() (cards.lock + ids.lock + admin-cookie
  // ryddes) håndteres i selve providern slik at det fungerer fra hvilken
  // som helst rute, ikke bare når app/page.tsx er montert.
  const { vault, cards, ids } = useVaultRuntime();

  // v4.3 Iter 0 — Rydd opp residue fra gammel "Logg ut"-flow.
  // Den gamle implementasjonen satte `kodo-force-vault-lock` i localStorage og
  // `kodo-admin-just-logged-out` i sessionStorage før full sidereload. Begge
  // flaggene er erstattet av direkte `vault.lock()`-kall via context, så vi
  // sletter eventuelle residuer en gang ved mount så de ikke fortsetter å
  // låse vault på senere navigering.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("kodo-force-vault-lock");
    window.localStorage.removeItem("kodo-passwords-view-mode");
    window.sessionStorage.removeItem("kodo-admin-just-logged-out");
  }, []);


  // ───────────────────────────────────────────────────────────────────────────
  // v4.3 Iter 0 — Admin-session bootstrap
  //
  // Per D-035 + Mike's beslutning 2026-06-01: admin.kodovault.no + vault
  // unlocked = admin-tilgang. Når vault unlockes på admin-host, POSTer vi til
  // /api/admin/session/start som setter HMAC-cookie. Hvis URL har
  // ?adminRedirect=<path>, redirecter vi videre dit (middleware har sendt oss
  // hit fra /platform/admin/* uten gyldig session).
  // ───────────────────────────────────────────────────────────────────────────
  // v4.3 Iter 0 — Rydd `?adminRedirect=`-param fra URL umiddelbart ved mount
  // og lagre i sessionStorage. Brukeren ser dermed bare `/` mens hun skriver
  // master-pwd, ikke en stygg query-string. Bootstrap-hooket nedenfor leser
  // intensjonen fra sessionStorage etter unlock.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("adminRedirect");
    if (redirect && redirect.startsWith("/platform/admin")) {
      window.sessionStorage.setItem("kodo-pending-admin-redirect", redirect);
      // Erstatt URL uten query-paramen (uten å trigge route-bytte).
      params.delete("adminRedirect");
      const cleanUrl =
        window.location.pathname +
        (params.toString() ? "?" + params.toString() : "") +
        window.location.hash;
      window.history.replaceState(null, "", cleanUrl);
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // v4.3 Iter 0 — Admin-session bootstrap
  //
  // Per D-035 + Mike's beslutning 2026-06-01: admin.kodovault.no + vault
  // unlocked = admin-tilgang. Når vault unlockes på admin-host, POSTer vi til
  // /api/admin/session/start som setter HMAC-cookie. Hvis sessionStorage har
  // 'kodo-pending-admin-redirect' (lagret av forrige hook), redirecter vi
  // videre dit (middleware har sendt oss hit fra /platform/admin/* uten gyldig
  // session).
  // ───────────────────────────────────────────────────────────────────────────
  const adminSessionAttempted = useRef(false);
  useEffect(() => {
    if (vault.status !== "unlocked") {
      adminSessionAttempted.current = false;
      return;
    }
    if (adminSessionAttempted.current) return;
    if (typeof window === "undefined") return;

    const host = window.location.hostname.toLowerCase();
    const isAdminHost =
      host === "admin.kodovault.no" ||
      // Tillat dev/preview for testing.
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".preview.emergentagent.com") ||
      host.endsWith(".preview.emergentcf.cloud") ||
      host.endsWith(".vercel.app");

    if (!isAdminHost) return;

    const adminRedirect = window.sessionStorage.getItem(
      "kodo-pending-admin-redirect",
    );
    // Vi setter session selv uten pending-redirect — Mike kan unlocke
    // vault'en sin og deretter klikke seg manuelt inn på /platform/admin.
    adminSessionAttempted.current = true;

    fetch("/api/admin/session/start", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (res) => {
        if (!res.ok) {
          console.warn("[admin-session] start feilet:", res.status);
          return;
        }
        if (adminRedirect && adminRedirect.startsWith("/platform/admin")) {
          window.sessionStorage.removeItem("kodo-pending-admin-redirect");
          // Client-side navigation bevarer VaultProvider-state.
          router.push(adminRedirect);
        }
      })
      .catch((err) => {
        console.warn("[admin-session] start kunne ikke fullføres:", err);
      });
  }, [vault.status, router]);
  // ───────────────────────────────────────────────────────────────────────────


  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Iter 19 — true når PaywallOverlay viser paywall (status=locked eller
  // trial-expired). Brukes til å disable AppHeader-knapper unntatt Lock +
  // Settings (som rommer "Administrer abonnement" + logout).
  const [paywallActive, setPaywallActive] = useState(false);
  const [changeMasterOpen, setChangeMasterOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  // Iter 19.9.6 (#11): CSV-eksport av passord-blob til Bitwarden-format.
  const [exportPasswordsOpen, setExportPasswordsOpen] = useState(false);
  const [viewEntry, setViewEntry] = useState<VaultEntry | null>(null);
  const [searchSelectedCard, setSearchSelectedCard] = useState<
    import("@/lib/types").VaultCard | null
  >(null);
  const [searchSelectedId, setSearchSelectedId] = useState<
    import("@/lib/types").VaultId | null
  >(null);
  const [pendingImport, setPendingImport] = useState<BackupEnvelope | null>(
    null,
  );
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [bgPref, setBgPref] = useState<BgPreference | null>(null);

  // Hydrer bg-preferanse fra localStorage etter mount. Vi initialiserer alltid
  // til null på BÅDE server og første klient-render for å garantere at
  // server-HTML matcher klient-HTML (unngår React error #418). Etter mount
  // setter useEffect den faktiske preferansen — det utløser en re-render som
  // swapper til riktig bilde uten å ødelegge hydration.
  useEffect(() => {
    const stored = loadBgPreference();
    if (stored) setBgPref(stored);
  }, []);
  const [labOpen, setLabOpen] = useState(false);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  // Iter 19.9.2 — "X skal lede til forrige vindu" (Mike 2026-06-24).
  // Når en sub-modal åpnes FRA Settings, settes denne ref-en. Sub-modalens
  // X-knapp leser ref-en og gjenåpner Settings i tillegg til å lukke seg
  // selv. Ref (ikke state) for å unngå unødvendige re-renders + alltid
  // fersk lesing av verdien i close-callbacks. Reset etter en gjenåpning.
  // Berører IKKE sub-modaler som åpnes fra header/CommandPalette direkte
  // (de setter ikke ref-en, og close-handler tar derfor ingen action).
  const returnToSettingsRef = useRef(false);
  const closeAndMaybeReturnToSettings = useCallback((closer: () => void) => {
    closer();
    if (returnToSettingsRef.current) {
      returnToSettingsRef.current = false;
      setSettingsOpen(true);
    }
  }, []);
  const [pendingClearEvents, setPendingClearEvents] = useState(false);
  const [clearEventsBusy, setClearEventsBusy] = useState(false);
  // Iter 19.9.2 — bekreftelses-dialog før Touch ID / Face ID fjernes
  // (Mike 2026-06-24: "ikke bare slette den"). State styrer ConfirmDialog
  // som åpnes fra Settings → Sikkerhet → "Fjern Touch ID". Bruker
  // returnToSettingsRef-mønsteret slik at både Cancel og fullført handling
  // tar brukeren tilbake til Settings-modalen.
  const [pendingRemoveBiometric, setPendingRemoveBiometric] = useState(false);
  // v4.0 — Sikker overlevering (Iter 3 + 4)
  const [packageHubOpen, setPackageHubOpen] = useState(false);
  const [packModuleOpen, setPackModuleOpen] = useState(false);
  const [unpackModuleOpen, setUnpackModuleOpen] = useState(false);
  const packagesConfig = config.features?.packages;
  // To separate toggles per tenant: vises pakk-ut på login? vises pakk-modul i appen?
  const packagesShowOnLogin = packagesConfig?.showOnLogin === true;
  const packagesShowInApp = packagesConfig?.showInApp === true;
  const packagesMaxMB = packagesConfig?.maxFileSizeMB ?? 50;

  // Hent events i bakgrunnen når Settings ELLER EventLog åpnes
  useEffect(() => {
    if (
      vault.status === "unlocked" &&
      (settingsOpen || eventLogOpen)
    ) {
      vault.refreshLoginHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, eventLogOpen, vault.status]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Cmd+K / Ctrl+K → åpne søk + lazy-trigger cards-load slik at søket dekker kort.
  // Iter 19: Blokkeres når paywall er aktiv (skal ikke kunne bypass'es via tastatur).
  useEffect(() => {
    if (vault.status !== "unlocked") return;
    if (paywallActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vault.status, paywallActive]);

  // Når søk åpnes ELLER bruker klikker søkeknapp: trigger cards-activate hvis
  // ikke allerede gjort. Dette overstyrer D-002 lazy-load i tilfelle brukeren
  // går rett til søk uten å åpne Kort-fanen — krevd for cross-tab søk.
  // v4.1: Samme mønster for ID-blob (Mike-beslutning B+ 2026-02).
  useEffect(() => {
    if (searchOpen && cards.status === "idle") {
      cards.activate().catch(() => {
        /* feilen settes i cards.error / cards.status */
      });
    }
    if (searchOpen && ids.status === "idle") {
      ids.activate().catch(() => {
        /* feilen settes i ids.error / ids.status */
      });
    }
  }, [searchOpen, cards, ids]);

  // Effektiv modus: bruker-override > config-default
  const effectiveBgMode: BgMode = (() => {
    if (bgPref) return bgPref.mode;
    const m = config.rotate ?? "daily";
    return m === "random" ? "session" : (m as BgMode);
  })();

  // SSR + før hydration: returner null så `<Image>` ikke rendres i det hele
  // tatt. Hvorfor ikke bare velge images[0]? Fordi det ville gitt en
  // 100-200ms "feil-bilde-flash" før klient swappet til bgPref/Math.random-
  // resultatet. I stedet rendrer SSR kun den mørke `bg-overlay`-div-en, og
  // <Image> popper inn med `animate-fade-in` på det riktige bildet etter
  // mount. Hydration matcher (begge sider rendrer ingen <Image>).
  const backgroundUrl = useMemo(() => {
    if (!mounted) return null;
    const images = config.backgrounds ?? [];
    if (images.length === 0) return DEFAULT_BG;

    // Fast bilde — enten brukervalgt URL (inkl. "gradient:<id>") eller første i lista.
    // Iter 19.9.2: gradient-URLer slipper images-check; rendering håndterer dem.
    if (effectiveBgMode === "fixed") {
      const pinned = bgPref?.fixedUrl;
      if (pinned && pinned.startsWith("gradient:")) return pinned;
      if (pinned && images.some((i) => i.url === pinned)) return pinned;
      return images[0].url;
    }
    if (effectiveBgMode === "session") {
      return images[Math.floor(Math.random() * images.length)].url;
    }
    // Daglig
    const dayOfYear = Math.floor(
      (Date.now() -
        new Date(new Date().getFullYear(), 0, 0).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return images[dayOfYear % images.length].url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.backgrounds, effectiveBgMode, bgPref?.fixedUrl, mounted]);

  const handleBgModeChange = useCallback(
    (mode: BgMode) => {
      const next: BgPreference = { mode, overlay: bgPref?.overlay };
      // Behold fixedUrl bare hvis vi går tilbake til fixed
      if (mode === "fixed" && bgPref?.fixedUrl) {
        next.fixedUrl = bgPref.fixedUrl;
      }
      saveBgPreference(next);
      setBgPref(next);
    },
    [bgPref],
  );

  const handleBgPickImage = useCallback(
    (url: string) => {
      // Iter 19.9.2 — Mike-direktiv 2026-06-24:
      // Når en GRADIENT velges, settes overlay automatisk til 0 så
      // fargene vises rent. For PHOTOS beholdes nåværende overlay-verdi
      // (brukerens slider-preferanse). Brukeren kan alltid overstyre
      // manuelt via slider etterpå.
      const isGradient = url.startsWith("gradient:");
      const next: BgPreference = {
        mode: "fixed",
        fixedUrl: url,
        overlay: isGradient ? 0 : bgPref?.overlay,
      };
      saveBgPreference(next);
      setBgPref(next);
      toast.success(t("toast.bg_locked"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bgPref?.overlay],
  );

  // Iter 19.9.2 — user overlay override (0..0.8). Clamp via saveBgPreference.
  const handleBgOverlayChange = useCallback(
    (overlay: number) => {
      const next: BgPreference = {
        mode: effectiveBgMode,
        fixedUrl: bgPref?.fixedUrl,
        overlay,
      };
      saveBgPreference(next);
      setBgPref(next);
    },
    [effectiveBgMode, bgPref?.fixedUrl],
  );

  // Effektiv overlay: user pref > config-default > 0.10 fallback.
  const effectiveOverlay =
    typeof bgPref?.overlay === "number"
      ? bgPref.overlay
      : (config.bgImageOverlay ?? 0.1);

  const useSolid = isMobile && config.mobileSolidBackground;
  const solidColor = config.mobileSolidColor || "#1A1A1A";

  // Browser-spesifikk blur-styrke OG card-bakgrunn for `.backdrop-blur-xl`.
  // Settes via CSS-variabler på `:root` slik at en enkelt CSS-regel i
  // globals.css plukker verdiene opp. Påvirker IKKE `backdrop-blur-sm`.
  // Se D-022. Chrome får lett glass; Safari får tilnærmet solid mørk
  // slate fordi blur er svak — lesbarhet garantert uavhengig av bg-bilde.
  const blurChrome = config.backdropBlurChrome ?? "24px";
  const blurSafari = config.backdropBlurSafari ?? blurChrome;
  const effectiveBlur = isSafari ? blurSafari : blurChrome;
  const cardBgChrome = config.cardBgChrome ?? "rgba(255, 255, 255, 0.10)";
  const cardBgSafari = config.cardBgSafari ?? "rgba(30, 41, 59, 0.85)";
  const effectiveCardBg = isSafari ? cardBgSafari : cardBgChrome;
  useEffect(() => {
    document.documentElement.style.setProperty("--kodo-blur-xl", effectiveBlur);
    document.documentElement.style.setProperty("--kodo-card-bg", effectiveCardBg);
  }, [effectiveBlur, effectiveCardBg]);

  const showBiometricPrompt =
    vault.status === "unlocked" &&
    vault.biometric.supported &&
    !vault.biometric.registered &&
    !vault.biometric.promptDismissed;

  const headerStatus =
    vault.status === "error"
      ? "locked"
      : vault.status === "loading"
        ? "loading"
        : vault.status;

  const netStatus = useNetworkStatus(vault.status === "error");

  const handleChangeMaster = async (
    currentPwd: string,
    newPwd: string,
  ) => {
    await vault.changeMasterPassword(currentPwd, newPwd);
    toast.success(
      vault.biometric.registered
        ? t("toast.master_changed_with_biometric")
        : t("toast.master_changed"),
    );
  };

  // ---- Backup-registry ----
  // Sentral, dynamisk liste over hvilke blobs som kan eksporteres/importeres.
  // Når v3.2 legger til ID-er, registreres bare en ny BackupBlobSource her —
  // selve modal-logikken og fil-formatet trenger ingen endring.
  const blobLabels = useMemo<Record<string, string>>(
    () => ({
      vault: "Passord",
      cards: "Kort",
    }),
    [],
  );

  const blobSources = useMemo<BackupBlobSource[]>(
    () => [
      {
        id: "vault",
        label: "Passord",
        itemCount: vault.entries.length,
        fetchFromServer: vault.fetchBlobForBackup,
        validateAndDecrypt: vault.validateAndDecryptVault,
        applyImportedPayload: (payload, targetPwd) =>
          vault.applyImportedVaultPayload(payload as VaultPayload, targetPwd),
      },
      {
        id: "cards",
        label: "Kort",
        itemCount: cards.status === "ready" ? cards.cards.length : null,
        fetchFromServer: cards.fetchBlobForBackup,
        validateAndDecrypt: cards.validateAndDecrypt,
        applyImportedPayload: (payload, targetPwd) =>
          cards.applyImportedPayload(payload as CardsPayload, targetPwd),
      },
      {
        id: "ids",
        label: "ID-er",
        itemCount: ids.status === "ready" ? ids.ids.length : null,
        fetchFromServer: ids.fetchBlobForBackup,
        validateAndDecrypt: ids.validateAndDecrypt,
        applyImportedPayload: (payload, targetPwd) =>
          ids.applyImportedPayload(payload as IdsPayload, targetPwd),
      },
    ],
    [vault, cards, ids],
  );

  const handleOpenExport = useCallback(() => {
    setExportModalOpen(true);
  }, []);

  const handleConfirmExport = useCallback(
    async (selectedIds: string[]) => {
      // Hent ferskt fra Upstash for hver valgt blob — backup speiler server, ikke RAM.
      const blobs: Record<string, EncryptedVaultBlob> = {};
      const missing: string[] = [];
      for (const id of selectedIds) {
        const src = blobSources.find((s) => s.id === id);
        if (!src) continue;
        const blob = await src.fetchFromServer();
        if (!blob) {
          missing.push(src.label);
        } else {
          blobs[id] = blob;
        }
      }
      if (Object.keys(blobs).length === 0) {
        throw new Error(
          missing.length > 0
            ? `${t("page.toast_no_data_for_prefix")} ${missing.join(", ")}`
            : t("page.toast_no_blobs_to_export"),
        );
      }
      const env = buildEnvelope(blobs, { appVersion: APP_VERSION });
      downloadEnvelope(env);
      setExportModalOpen(false);
      setSettingsOpen(false);
      const summary = env.includedBlobs
        .map((id) => blobLabels[id] ?? id)
        .join(" + ");
      const skipped =
        missing.length > 0
          ? ` (hoppet over: ${missing.join(", ")} — ingen data på server)`
          : "";
      toast.success(`${t("toast.backup_exported_prefix")} ${summary}${skipped}`);
    },
    [blobSources, blobLabels],
  );

  const handleImportFile = useCallback(async (file: File) => {
    try {
      const text = await readFileAsText(file);
      const envelope = parseEnvelope(text);
      setPendingImport(envelope);
    } catch (err) {
      if (err instanceof BackupParseError) {
        toast.error(err.message);
      } else {
        toast.error(
          err instanceof Error ? err.message : t("toast.backup_read_failed"),
        );
      }
    }
  }, []);

  const handleConfirmImport = useCallback(
    async (
      selectedIds: string[],
      backupPwd: string,
      currentPwd?: string,
    ) => {
      if (!pendingImport) return;
      setImportBusy(true);
      try {
        // ---- TRINN 1: Atomisk dekryptering med backup-pwd ----
        // Dekrypter ALLE valgte blobs. Hvis én feiler → ingen ting pushes.
        // Klartekst-payloads holdes kun i RAM gjennom denne funksjonen.
        //
        // D-062: Hvis brukeren har valgt FLERE blobs og noen feiler mens andre
        // lykkes med samme backup-pwd → blobs er kryptert med forskjellige
        // master-pwds (typisk fordi backup ble laget etter MP-bytte uten å
        // re-eksportere alle blobs). Da blokkerer vi hele restoren og krever
        // at brukeren tar én blob av gangen.
        const payloads: Record<string, unknown> = {};
        const decryptFailures: string[] = [];
        const decryptSuccesses: string[] = [];
        for (const id of selectedIds) {
          const blob = pendingImport.blobs[id];
          const src = blobSources.find((s) => s.id === id);
          if (!blob || !src) {
            throw new Error(`Backup mangler blob "${id}"`);
          }
          try {
            payloads[id] = await src.validateAndDecrypt(blob, backupPwd);
            decryptSuccesses.push(id);
          } catch {
            decryptFailures.push(id);
          }
        }
        // D-062: blandede passord — noen lyktes, andre feilet
        if (decryptFailures.length > 0 && decryptSuccesses.length > 0) {
          const failedLabels = decryptFailures
            .map((id) => blobLabels[id] ?? id)
            .join(", ");
          throw new Error(
            t("page.toast_mixed_passwords").replace("{labels}", failedLabels),
          );
        }
        // Alle feilet → opprinnelig "feil passord"-error
        if (decryptFailures.length > 0) {
          const firstFailed = decryptFailures[0];
          throw new Error(
            `Master-passordet kunne ikke dekryptere "${
              blobLabels[firstFailed] ?? firstFailed
            }". Sjekk at du bruker passordet som tilhørte backupen.`,
          );
        }

        // ---- TRINN 2: Bestem target-pwd ----
        // Logikk:
        //  - Vault låst → target = backup-pwd. Server-blobs krypteres med
        //    backup-pwd. Bruker må låse opp med backup-pwd etterpå. Cards-only
        //    import krever at vault er ulåst (vi vet ikke nåværende pwd).
        //  - Vault ulåst, backup-pwd === current → target = backup-pwd (= current).
        //    Re-krypter med ny salt, men samme effective pwd. Ingen lock.
        //  - Vault ulåst, backup-pwd ≠ current → vi trenger nåværende pwd.
        //    Hvis ikke gitt → kast NeedsCurrentPasswordError, modalen viser
        //    nytt felt. Ellers verifiser current-pwd er korrekt og bruk det
        //    som target. Backup-data lagres med dagens pwd.
        const vaultUnlocked = vault.status === "unlocked";
        let targetPwd: string;

        if (!vaultUnlocked) {
          // Vault låst — vi har ingen current pwd. Krev at vault importeres
          // også, ellers ville sub-blobs (cards) ende opp med pwd som ikke
          // matcher server-vault.
          const importingVault = selectedIds.includes("vault");
          const importingSubBlobs = selectedIds.some((id) => id !== "vault");
          if (importingSubBlobs && !importingVault) {
            throw new Error(
              t("page.toast_unlock_for_cards_import"),
            );
          }
          targetPwd = backupPwd;
        } else {
          // Vault ulåst — sammenlign backup-pwd med current master-pwd
          const currentMasterPwd = cards.getCurrentMasterPassword();
          const sameAsCurrent =
            currentMasterPwd !== null && currentMasterPwd === backupPwd;

          if (sameAsCurrent) {
            targetPwd = backupPwd; // = current
          } else if (!currentPwd) {
            // Trenger andre runde — modalen viser current-pwd-felt
            const err = new Error(
              "Backup-pwd er forskjellig fra current — be om current pwd",
            );
            err.name = "NeedsCurrentPasswordError";
            throw err;
          } else {
            // Verifiser at oppgitt current-pwd faktisk er current
            const ok = await vault.verifyMasterPassword(currentPwd);
            if (!ok) {
              throw new Error(
                t("page.toast_master_pwd_wrong"),
              );
            }
            targetPwd = currentPwd;
          }
        }

        // ---- TRINN 3: Re-krypter og push hver valgt payload ----
        // D-062: Vi rører ALDRI blobs på server som ikke er valgt for import.
        // F.eks. hvis bruker valgte kun "cards", forblir vault- og ids-blobs
        // på server urørt. Dette er kritisk når brukeren restorer selektivt
        // etter et MP-bytte mellom backup-tidspunktet og nåtid.
        for (const id of selectedIds) {
          const src = blobSources.find((s) => s.id === id);
          if (!src) continue;
          await src.applyImportedPayload(payloads[id], targetPwd);
        }

        // ---- TRINN 4: Post-import håndtering ----
        // Hvis vault var låst og target = backup-pwd → bruker må unlocke med
        // backup-pwd. Vi forblir i låst tilstand.
        // Hvis vault var ulåst og target = current pwd → server matcher session.
        // applyImportedVaultPayload har allerede re-derived session med ny salt.
        // Ingen yterligere cleanup nødvendig.
        if (!vaultUnlocked) {
          // Allerede låst — ingen cleanup nødvendig.
        }
        // (Bevisst ingen importBackup-call her — applyImportedVaultPayload
        // håndterer session-state internt.)

        const summary = selectedIds
          .map((id) => blobLabels[id] ?? id)
          .join(" + ");
        const reEncrypted = vaultUnlocked && currentPwd; // brukte current pwd som target
        toast.success(
          !vaultUnlocked
            ? `${t("toast.backup_imported_prefix")} (${summary}) ${t("toast.backup_imported_suffix_locked")}`
            : reEncrypted
              ? `${t("toast.backup_imported_prefix")} (${summary}) ${t("toast.backup_imported_suffix_reencrypted")}`
              : `${t("toast.backup_imported_prefix")} (${summary})`,
        );
        setPendingImport(null);
        setSettingsOpen(false);
      } finally {
        setImportBusy(false);
      }
    },
    [pendingImport, vault, cards, blobSources, blobLabels],
  );

  return (
    // Merk: `overflow-hidden` ligger IKKE på root, men på selve `bg-wrapper`-
    // diven lenger ned. Grunn: Safari/WebKit har dokumenterte problemer med
    // `backdrop-filter` på etterkommere når en stamfar har `overflow: hidden`
    // (clipping-context påvirker compositing-pipeline). Ved å clippe kun
    // bg-bildet (som er det eneste som potensielt går utenfor viewport)
    // unngår vi at glass-kortene har en `overflow: hidden`-stamfar.
    <div className="relative min-h-screen w-full">      {useSolid ? (
        <div
          className="absolute inset-0"
          style={{ backgroundColor: solidColor }}
          data-testid="solid-background"
        />
      ) : (
        <>
          {/* Solid placeholder mens vi venter på (a) client-mount og (b) at
             klient-config er lastet ferdig. Først da vet vi hvilket bilde som
             faktisk skal vises (FALLBACK_CONFIG har andre bilder enn default.json,
             og bgPref fra localStorage kan overstyre alt). Uten denne gaten ville
             vi fått: svart → fallback-bilde → config-bilde → bgPref-bilde. */}
          {(!mounted || configStatus !== "ready") && (
            <div
              className="absolute inset-0 bg-neutral-900"
              data-testid="bg-placeholder"
            />
          )}
          {mounted && configStatus === "ready" && (
            // Vi pakker <Image> i en wrapper-div uten compositing-egenskaper,
            // og legger en mørkleggings-overlay-div som søsken til <Image>
            // INNI samme wrapper.
            //
            // Hvorfor ikke `filter: brightness()` på wrapperen?
            // ────────────────────────────────────────────────────────────
            // `filter: brightness(...)` skaper en stacking context per
            // CSS-spec. I Safari/WebKit kan `backdrop-filter` på glass-kort
            // i søsken-stacking-context da IKKE sample piksler riktig fra
            // den filtrerte wrapperen → blur-effekten forsvinner / blir
            // svak. Chromium er permissiv her, derav "virker i Chrome,
            // knekt i Safari". Verdien (`brightness(0.65)`) er irrelevant
            // — det er at filter-egenskapen finnes som skaper problemet.
            //
            // Med overlay-div-tilnærmingen har wrapperen ingen compositing-
            // egenskaper. Image + overlay rendres som én flat enhet, og
            // backdrop-filter på kortene sampler denne flate rendringen
            // konsistent i alle nettlesere (Safari inkludert).
            //
            // Den opprinnelige bekymringen om "uforutsigbar mørkning" med
            // overlay-div gjaldt en overlay PLASSERT MELLOM bg-wrapper og
            // kortene (sibling utenfor wrapper). Plassert INNI wrapper som
            // søsken til <Image> oppfører den seg lineært i alle browsere.
            //
            // ⚠️ Aldri legg `filter:`, `opacity:` (verdi < 1), eller
            // `isolation: isolate` på bg-wrapper eller dens umiddelbare
            // søsken-overlay igjen. Alle disse skaper stacking contexts som
            // bryter `backdrop-filter`-sampling i Safari/WebKit. Overlay-en
            // bruker derfor `rgba(0,0,0,X)` for mørklegging i stedet for
            // `opacity` — alfa-kanalen på fargen skaper IKKE stacking
            // context. Verifisert ekte macOS Safari 17.0 +
            // Playwright/WebKit 2026-05-18.
            <div
              className="absolute inset-0 overflow-hidden animate-fade-in"
              data-testid="bg-wrapper"
            >
              {(() => {
                // Iter 19.9.2 — eksplisitt gradient vs photo branching.
                // Vi rendrer ALDRI både <div> og <Image> samtidig, men
                // bruker en eksplisitt if-else så det er åpenbart hva som
                // skjer + at unmount/mount-rekkefølgen er forutsigbar.
                if (!backgroundUrl) return null;

                if (backgroundUrl.startsWith("gradient:")) {
                  const gid = backgroundUrl.slice("gradient:".length);
                  const g = GRADIENT_BACKGROUNDS.find((x) => x.id === gid);
                  return (
                    <div
                      key={`grad-${gid}`}
                      className="absolute inset-0"
                      style={{ background: g?.css ?? "#0a0e1a" }}
                      data-testid="bg-gradient"
                      aria-hidden="true"
                    />
                  );
                }

                return (
                  <Image
                    key={`img-${backgroundUrl}`}
                    src={backgroundUrl}
                    alt="Bakgrunn"
                    fill
                    className="object-cover"
                    priority
                    data-testid="bg-image"
                  />
                );
              })()}
              <div
                className="absolute inset-0"
                style={{ backgroundColor: `rgba(0, 0, 0, ${effectiveOverlay})` }}
                data-testid="bg-overlay"
                aria-hidden="true"
              />
            </div>
          )}
        </>
      )}

      <AppHeader
        status={headerStatus}
        netStatus={netStatus}
        refreshing={vault.refreshing}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        packagesEnabled={packagesShowInApp}
        paywallActive={paywallActive}
        onLockClick={vault.lock}
        onSearchClick={() => setSearchOpen(true)}
        onSettingsClick={() => setSettingsOpen(true)}
        onPasswordLabClick={() => setLabOpen(true)}
        onPackagesClick={() => setPackageHubOpen(true)}
        onRefreshClick={async () => {
          await vault.refresh();
          toast.success(t("toast.refreshed"));
        }}
        onClipboardClearClick={async () => {
          const ok = await clearClipboardNow();
          if (ok) {
            toast.success(t("toast.clipboard_cleared"));
          } else {
            toast.error(
              t("toast.clipboard_clear_failed_full"),
            );
          }
        }}
      />

      <main className="relative min-h-screen w-full flex flex-col items-center justify-center px-4 pt-24 pb-32 sm:pb-16">
        {(vault.status === "loading" || configStatus === "loading") && (
          <div
            data-testid="vault-loading"
            className="flex items-center gap-3 text-white/70"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">{t("common.synchronizing")}</span>
          </div>
        )}

        {vault.status === "error" && (
          // Wrapper-div for samme Safari-quirk som setup-cardet (se D-022 og
          // kommentar over `<MasterPasswordSetup>`-renderen). Direkte
          // flex-barn av <main> med backdrop-filter blir feilkompositert i
          // WebKit.
          <div className="w-full max-w-md">
            <div
              data-testid="vault-sync-error"
              className="w-full backdrop-blur-xl border border-rose-400/30 rounded-2xl shadow-2xl p-6 text-white animate-slide-up"
            >
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold mb-1">
                  Server ikke tilgjengelig
                </h3>
                <p className="text-[12px] text-white/65 leading-relaxed">
                  Kunne ikke koble til Upstash.{" "}
                  {vault.error && (
                    <span className="text-rose-200/80">({vault.error})</span>
                  )}
                </p>
              </div>
            </div>
            <button
              data-testid="vault-retry-btn"
              onClick={vault.retry}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Prøv igjen
            </button>
            </div>
          </div>
        )}

        {mounted && vault.status === "needs-setup" && (
          // ⚠️ Wrapper-diven er KRITISK. Uten den havner backdrop-filter-kortet
          // som direkte flex-barn av <main>, og Safari/WebKit kompositerer
          // backdrop-blur feil → glass-effekten forsvinner (kortet blir nesten
          // transparent). Locked-state har samme wrapper av andre grunner
          // ("— For X —"-strip) og fungerer derfor riktig. Verifisert ved
          // DOM-diff Playwright/WebKit 2026-05-18.
          <>
            <div className="w-full max-w-md">
              <MasterPasswordSetup onSetup={vault.setupVault} />
            </div>
            {/* LanguagePicker (v4.2 D-036) — desktop kun. Sentrert under form. */}
            <div
              data-testid="below-form-language-picker-setup"
              className="hidden sm:flex justify-center mt-[30px]"
            >
              <LanguagePicker size="sm" />
            </div>
          </>
        )}

        {mounted && vault.status === "locked" && (
          <>
            <div className="w-full max-w-md flex flex-col items-center gap-3">
              {config._meta?.client && (
                <div
                  data-testid="login-client-strip"
                  className="text-xs text-white/55 tracking-wide font-light select-none animate-fade-in"
                >
                  — For {config._meta.client} —
                </div>
              )}
              <MasterPasswordLogin
                onUnlock={vault.unlock}
                onUnlockBiometric={vault.unlockWithBiometric}
                onDestroy={async () => {
                  await vault.destroyVault();
                  await cards.destroy();
                }}
                biometric={vault.biometric}
                extraFooter={
                  packagesShowOnLogin ? (
                    <PackageEntryButton
                      variant="login"
                      onClick={() => setUnpackModuleOpen(true)}
                    />
                  ) : undefined
                }
              />
            </div>
            {/* LanguagePicker (v4.2 D-036) — desktop kun. Sentrert under form. */}
            <div
              data-testid="below-form-language-picker-locked"
              className="hidden sm:flex justify-center mt-[30px]"
            >
              <LanguagePicker size="sm" />
            </div>
          </>
        )}

        {mounted && vault.status === "unlocked" && (
          <div className="w-full flex flex-col items-center gap-0">
            <PaywallOverlay onPaywallActiveChange={setPaywallActive}>
              <UpgradeBanner />
              {showBiometricPrompt && (
                <BiometricEnableCard
                  onEnable={vault.registerBiometric}
                  onDismiss={vault.dismissBiometricPrompt}
                />
              )}
              <DashboardShell
                entries={vault.entries}
                config={config}
                biometric={vault.biometric}
                onSaveEntries={vault.saveEntries}
                onRemoveBiometric={vault.removeBiometric}
                cardsStatus={cards.status}
                cardsError={cards.error}
                cards={cards.cards}
                onActivateCards={cards.activate}
                onSaveCards={cards.saveCards}
                idsShowInApp={config.features?.ids?.enabled !== false && config.features?.ids?.showInApp !== false}
                idsStatus={ids.status}
                idsError={ids.error}
                ids={ids.ids}
                onActivateIds={ids.activate}
                onSaveIds={ids.saveIds}
              />
            </PaywallOverlay>
          </div>
        )}
      </main>

      {/* Søk (Cmd+K) — trigger background-fetch av alle lazy-blobs første
          gang paletten åpnes, slik at søket dekker passord+kort+ID fra første
          åpning (Mike-beslutning B+ 2026-02 — fikser også eksisterende
          cards-lazy-issue samtidig). */}
      <SearchPalette
        open={searchOpen && vault.status === "unlocked"}
        entries={vault.entries}
        cards={cards.cards}
        ids={ids.ids}
        categories={config.categories}
        onClose={() => setSearchOpen(false)}
        onSelect={(entry) => setViewEntry(entry)}
        onSelectCard={(card) => {
          // For å vise kort fra søk: bruker DashboardShell sin Cards-fane
          // ville krevd ekstra orchestrering. Enkleste løsning i v3.0:
          // åpne en ren CardModal-instans direkte. Polish kommer i v3.0.x.
          setSearchSelectedCard(card);
        }}
        onSelectId={(id) => {
          // Speiler card-mønsteret: standalone IdModal (utenfor DashboardShell).
          setSearchSelectedId(id);
        }}
      />

      {/* Settings */}
      <SettingsPanel
        open={settingsOpen && vault.status === "unlocked"}
        config={config}
        biometricActive={vault.biometric.registered}
        currentBackground={!useSolid && backgroundUrl ? backgroundUrl : undefined}
        bgMode={effectiveBgMode}
        bgOverlay={effectiveOverlay}
        onBgModeChange={handleBgModeChange}
        onBgPickImage={handleBgPickImage}
        onBgOverlayChange={handleBgOverlayChange}
        loginHistory={vault.loginHistory}
        loginHistoryLoading={vault.loginHistoryLoading}
        onOpenEventLog={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setEventLogOpen(true);
        }}
        onClose={() => setSettingsOpen(false)}
        onChangeMaster={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setChangeMasterOpen(true);
        }}
        onRemoveBiometric={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setPendingRemoveBiometric(true);
        }}
        onExportBackup={handleOpenExport}
        onImportFile={handleImportFile}
        onOpenPasswordLab={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setLabOpen(true);
        }}
        onExportPasswordsCsv={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setExportPasswordsOpen(true);
        }}
        onDeleteVaultAndAccount={() => {
          returnToSettingsRef.current = true;
          setSettingsOpen(false);
          setDeleteAccountOpen(true);
        }}
      />

      {/* Passord-lab (fra header + settings) */}
      <PasswordLab
        open={labOpen && vault.status === "unlocked"}
        clipboardClearSeconds={config.security.clipboardClearSeconds}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        onClose={() =>
          closeAndMaybeReturnToSettings(() => setLabOpen(false))
        }
      />

      {/* Hendelses-logg (eget vindu) */}
      <EventLogPanel
        open={eventLogOpen && vault.status === "unlocked"}
        events={vault.loginHistory}
        loading={vault.loginHistoryLoading}
        locale={localeToBcp47(locale)}
        onRefresh={vault.refreshLoginHistory}
        onClear={() => setPendingClearEvents(true)}
        onClose={() =>
          closeAndMaybeReturnToSettings(() => setEventLogOpen(false))
        }
      />

      {/* Backup eksport-modal — selektivt valg av blobs (v3.0.5+) */}
      <BackupExportModal
        open={exportModalOpen && vault.status === "unlocked"}
        sources={blobSources}
        onConfirm={handleConfirmExport}
        onCancel={() => setExportModalOpen(false)}
      />

      {/* Backup import-modal — selektiv import + master-pwd-validering (v3.0.5+) */}
      <BackupImportModal
        open={pendingImport !== null}
        envelope={pendingImport}
        blobLabels={blobLabels}
        onConfirm={handleConfirmImport}
        onCancel={() => {
          if (!importBusy) setPendingImport(null);
        }}
      />

      {/* Confirm dialog for å tømme hendelses-logg */}
      <ConfirmDialog
        open={pendingClearEvents}
        title={t("event_log_clear.dialog_title")}
        variant="destructive"
        confirmLabel={t("event_log_clear.dialog_confirm")}
        cancelLabel={t("common.cancel")}
        busy={clearEventsBusy}
        description={
          <p>
            {t("event_log_clear.dialog_description")}
          </p>
        }
        onCancel={() => {
          if (!clearEventsBusy) setPendingClearEvents(false);
        }}
        onConfirm={async () => {
          setClearEventsBusy(true);
          try {
            await vault.clearLoginHistory();
            toast.success(t("toast.event_log_cleared"));
            setPendingClearEvents(false);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : t("toast.event_log_clear_failed"),
            );
          } finally {
            setClearEventsBusy(false);
          }
        }}
      />

      {/* Iter 19.9.2 — Confirm dialog for å fjerne Touch ID / Face ID.
          Bruker closeAndMaybeReturnToSettings så både Cancel og Confirm
          tar brukeren tilbake til Settings (returnToSettingsRef ble satt
          da onRemoveBiometric åpnet dialogen). */}
      <ConfirmDialog
        open={pendingRemoveBiometric}
        title={t("biometric_remove.dialog_title")}
        variant="destructive"
        confirmLabel={t("biometric_remove.dialog_confirm")}
        cancelLabel={t("common.cancel")}
        description={
          <p>{t("biometric_remove.dialog_description")}</p>
        }
        onCancel={() =>
          closeAndMaybeReturnToSettings(() =>
            setPendingRemoveBiometric(false),
          )
        }
        onConfirm={() => {
          vault.removeBiometric();
          toast.success(t("toast.biometric_removed"));
          closeAndMaybeReturnToSettings(() =>
            setPendingRemoveBiometric(false),
          );
        }}
      />

      {/* Change master-pwd */}
      <ChangeMasterDialog
        open={changeMasterOpen}
        biometricActive={vault.biometric.registered}
        onClose={() =>
          closeAndMaybeReturnToSettings(() => setChangeMasterOpen(false))
        }
        onChange={handleChangeMaster}
      />

      {/* Slett vault + konto (GDPR art. 17) — to-stegs bekreftelse + pwd */}
      <DeleteAccountDialog
        open={deleteAccountOpen && vault.status === "unlocked"}
        verifyMasterPassword={
          vault.status === "unlocked"
            ? vault.verifyMasterPassword
            : async () => false
        }
        onCancel={() =>
          closeAndMaybeReturnToSettings(() => setDeleteAccountOpen(false))
        }
        onConfirmedDelete={async () => {
          const res = await fetch("/api/account/delete", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          let data: { ok?: boolean; redirectTo?: string; detail?: string } = {};
          try {
            data = await res.json();
          } catch {
            /* ignorer parse-fail */
          }
          if (!res.ok || !data.ok) {
            throw new Error(
              data.detail ?? `Kunne ikke slette konto (HTTP ${res.status})`,
            );
          }
          // Suksess: lås vault (rydder client-state) og redirect til
          // landingsside. window.location.assign sørger for full re-load
          // slik at ingen residue i RAM henger igjen.
          vault.lock();
          const target = data.redirectTo ?? "https://kodovault.no";
          window.location.assign(target);
        }}
      />

      {/* Iter 19.9.6 (#11) — CSV-eksport av passord-blob (Bitwarden-format) */}
      <ExportPasswordsDialog
        open={exportPasswordsOpen && vault.status === "unlocked"}
        entryCount={
          vault.status === "unlocked" ? vault.entries.length : 0
        }
        verifyMasterPassword={
          vault.status === "unlocked"
            ? vault.verifyMasterPassword
            : async () => false
        }
        onCancel={() =>
          closeAndMaybeReturnToSettings(() => setExportPasswordsOpen(false))
        }
        onConfirmedExport={async () => {
          if (vault.status !== "unlocked") return;
          const { buildBitwardenCsv, downloadCsv } = await import(
            "@/lib/csv-export"
          );
          const csv = buildBitwardenCsv(vault.entries);
          downloadCsv(csv);
          const count = vault.entries.length;
          closeAndMaybeReturnToSettings(() => setExportPasswordsOpen(false));
          // Iter 19.9.6 (#11 follow-up): bekreft nedlasting + minne om
          // sletteansvar via toast. 6s duration → lenge nok til å lese,
          // kort nok til ikke å forstyrre.
          toast.success(
            t("export.success_toast").replace("{N}", String(count)),
            { duration: 6000 },
          );
        }}
      />

      {/* View-modal for entry valgt fra søk */}
      <EntryModal
        open={viewEntry !== null}
        mode="view"
        entry={viewEntry}
        categories={config.categories}
        clipboardClearSeconds={config.security.clipboardClearSeconds}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        onClose={() => setViewEntry(null)}
        onSave={async (e) => {
          const next = vault.entries.map((x) => (x.id === e.id ? e : x));
          await vault.saveEntries(next);
          setViewEntry(e);
        }}
        onDelete={async (id) => {
          await vault.saveEntries(vault.entries.filter((x) => x.id !== id));
          setViewEntry(null);
        }}
      />

      {/* View-modal for kort valgt fra søk (separat fra DashboardShell sin) */}
      <CardModal
        open={searchSelectedCard !== null}
        mode="view"
        card={searchSelectedCard}
        clipboardClearSeconds={config.security.clipboardClearSeconds}
        clipboardEnabled={config.security.clipboardEnabled !== false}
        imageConfig={config.image}
        onClose={() => setSearchSelectedCard(null)}
        onSave={async (c) => {
          const next = cards.cards.map((x) => (x.id === c.id ? c : x));
          await cards.saveCards(next);
          setSearchSelectedCard(c);
        }}
        onDelete={async (id) => {
          await cards.saveCards(cards.cards.filter((x) => x.id !== id));
          setSearchSelectedCard(null);
        }}
      />

      {/* View-modal for ID valgt fra søk (v4.1, speiler card-mønsteret) */}
      <IdModal
        open={searchSelectedId !== null}
        mode="view"
        id={searchSelectedId}
        onClose={() => setSearchSelectedId(null)}
        onSave={async (updated) => {
          const exists = ids.ids.some((x) => x.id === updated.id);
          const next = exists
            ? ids.ids.map((x) => (x.id === updated.id ? updated : x))
            : [...ids.ids, updated];
          await ids.saveIds(next);
          setSearchSelectedId(updated);
        }}
        onDelete={async (id) => {
          await ids.saveIds(ids.ids.filter((x) => x.id !== id));
          setSearchSelectedId(null);
        }}
      />

      <div
        data-testid="app-footer"
        className="hidden sm:block fixed bottom-0 left-0 right-0 z-10 px-4 py-4 text-center text-base text-white/75 font-medium select-none pointer-events-none"
      >
        <span className="text-white/85">{config.brand.name}</span>
        <span className="mx-1.5 text-white/35">·</span>
        <span>By {sanitizeCreatedBy(config._meta?.createdBy)}</span>
        <span className="mx-1.5 text-white/35">·</span>
        <span className="font-mono text-white/70">{APP_VERSION}</span>
        {vault.status === "unlocked" && (
          <>
            <span className="mx-1.5 text-white/35">·</span>
            {/* Iter 19.9.2 (Mike 2026-06-24): kompakt pille med reverse
                farger så snarvei-hintet skiller seg ut fra footer-strømmen
                uten å rope. Hvit/95 bg + slate-tekst = sterk kontrast mot
                ethvert bakgrunns-bilde. */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/95 text-slate-900 text-[13px] font-medium align-middle shadow-sm">
              <kbd className="text-[11px] font-mono bg-slate-900/10 border border-slate-900/15 rounded px-1.5 py-px text-slate-900">
                {isMac ? "⌘K" : "Ctrl+K"}
              </kbd>
              <span>{t("footer.cmdk_hint")}</span>
            </span>
          </>
        )}
      </div>

      {/* Mobil: bunn-bar med 5-7 ikoner + branding-strip — erstatter footer + header-ikoner */}
      {vault.status === "unlocked" && (
        <MobileBottomBar
          refreshing={vault.refreshing}
          brand={config.brand.name}
          client={sanitizeCreatedBy(config._meta?.createdBy)}
          version={APP_VERSION}
          clipboardEnabled={config.security.clipboardEnabled !== false}
          packagesEnabled={packagesShowInApp}
          paywallActive={paywallActive}
          onSearchClick={() => setSearchOpen(true)}
          onPasswordLabClick={() => setLabOpen(true)}
          onPackagesClick={() => setPackageHubOpen(true)}
          onRefreshClick={async () => {
            await vault.refresh();
            toast.success(t("toast.refreshed"));
          }}
          onSettingsClick={() => setSettingsOpen(true)}
          onLockClick={vault.lock}
          onClipboardClearClick={async () => {
            const ok = await clearClipboardNow();
            if (ok) {
              toast.success(t("toast.clipboard_cleared"));
            } else {
              toast.error(
                t("toast.clipboard_clear_failed_short"),
              );
            }
          }}
        />
      )}

      {/* v4.0 — Sikker overlevering (Iter 3 + 4) */}
      <PackageHubModal
        open={packageHubOpen}
        onClose={() => setPackageHubOpen(false)}
        onChoosePack={() => {
          setPackageHubOpen(false);
          setPackModuleOpen(true);
        }}
        onChooseUnpack={() => {
          setPackageHubOpen(false);
          setUnpackModuleOpen(true);
        }}
      />
      <PackModule
        open={packModuleOpen}
        maxFileSizeMB={packagesMaxMB}
        onClose={() => setPackModuleOpen(false)}
      />
      <UnpackModule
        open={unpackModuleOpen}
        onClose={() => setUnpackModuleOpen(false)}
        verifyMasterPassword={
          vault.status === "unlocked" ? vault.verifyMasterPassword : undefined
        }
      />
    </div>
  );
}
