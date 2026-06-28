"use client";

/**
 * Pakker-feature bruker emerald-aksent gjennomgående.
 * For å bytte fargen til hele Pakker-flowen:
 *   1) Endre PACKAGES_THEME i /app/frontend/lib/feature-theme.ts
 *   2) Søk-erstatt `emerald-` → `<ny-farge>-` i:
 *      - components/PackModule.tsx
 *      - components/UnpackModule.tsx
 *      - components/PackageHubModal.tsx
 *      - components/PackageEntryButton.tsx
 *      - components/PackagePreview.tsx
 *   3) Verifiser på /colors-ruta etter endring
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Dices,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Package,
  Trash2,
  X,
} from "lucide-react";
import {
  buildContainer,
  estimateEncryptSeconds,
  formatBytes,
  planContainers,
  validateFileSize,
  type PackageFile,
} from "@/lib/package-zip";
import { analyzeStrength, scoreColor, scoreLabel } from "@/lib/password-strength";
import { APP_VERSION } from "@/lib/version";
import { PACKAGES_THEME as T } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";

interface PackModuleProps {
  open: boolean;
  maxFileSizeMB: number;
  onClose: () => void;
}

type Stage = "select" | "containers" | "password" | "encrypting" | "done";

interface BuiltContainer {
  name: string;
  bytes: Uint8Array;
}

/**
 * Lars sin pakke-flyt (Iter 3). Fire stages:
 *   1. select    — velg filer + pakke-navn
 *   2. containers — D-009 antall containere + bin-packing forhåndsvisning
 *   3. password  — Lars taster pwd (selv eller Generer-knapp)
 *   4. encrypting → 5. done — last ned + "slett original"-påminnelse
 *
 * SPEC: /app/memory/v4.0-SPEC.md seksjon 2.2 + 9.1 + 9.3
 */
export function PackModule({ open, maxFileSizeMB, onClose }: PackModuleProps) {
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>("select");
  const [packageName, setPackageName] = useState("");
  const [files, setFiles] = useState<PackageFile[]>([]);
  const [containerCount, setContainerCount] = useState(1);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [wasGenerated, setWasGenerated] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState<{
    score: 0 | 1 | 2 | 3 | 4;
    label: string;
  } | null>(null);
  const [builtContainers, setBuiltContainers] = useState<BuiltContainer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const totalBytes = useMemo(
    () => files.reduce((s, f) => s + f.bytes.byteLength, 0),
    [files],
  );
  const maxBytes = maxFileSizeMB * 1024 * 1024;
  const overLimit = totalBytes > maxBytes;

  // Reset state hver gang modalen åpnes
  useEffect(() => {
    if (open) {
      setStage("select");
      setPackageName("");
      setFiles([]);
      setContainerCount(1);
      setPassword("");
      setPasswordConfirm("");
      setWasGenerated(false);
      setShowPassword(false);
      setStrength(null);
      setBuiltContainers([]);
      setError(null);
      setBusy(false);
      setTimeout(() => cancelRef.current?.focus(), 50);
    }
  }, [open]);

  // Esc lukker (men ikke under encrypting)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stage !== "encrypting") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, onClose]);

  // Analyser passord-styrke når pwd endres
  useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    analyzeStrength(password).then((r) => {
      if (!cancelled) setStrength({ score: r.score, label: scoreLabel(r.score) });
    });
    return () => {
      cancelled = true;
    };
  }, [password]);

  const handleFilesAdded = useCallback(
    async (filelist: FileList | File[], explicitPaths?: Map<File, string>) => {
      const arr = Array.from(filelist);
      const newFiles: PackageFile[] = [];
      for (const f of arr) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        // 1) explicitPaths (fra mappe-drag via webkitGetAsEntry) har prioritet
        // 2) webkitRelativePath (fra <input webkitdirectory>) bevarer mappe-struktur
        // 3) ellers bare filnavn
        const wf = f as File & { webkitRelativePath?: string };
        const path =
          explicitPaths?.get(f) ||
          (wf.webkitRelativePath && wf.webkitRelativePath.length > 0
            ? wf.webkitRelativePath
            : f.name);
        newFiles.push({ path, bytes });
      }
      setFiles((prev) => [...prev, ...newFiles]);
    },
    [],
  );

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Drag-and-drop med mapper. Bruker DataTransferItem.webkitGetAsEntry() for å
   * rekursivt traverse mappe-struktur. Faller tilbake til flat fil-liste hvis
   * webkitGetAsEntry mangler.
   */
  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        const collected: { file: File; path: string }[] = [];
        for (const entry of entries) {
          await collectEntry(entry, "", collected);
        }
        if (collected.length === 0) return;
        const pathMap = new Map<File, string>();
        for (const c of collected) pathMap.set(c.file, c.path);
        await handleFilesAdded(
          collected.map((c) => c.file),
          pathMap,
        );
        return;
      }
    }
    // Fallback: flat fil-liste
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void handleFilesAdded(files);
    }
  }

  async function handleGeneratePassword() {
    // Bruker Web Crypto direkte for å lage en sterk, lesbar passfrase
    // (samme alfabet som SPEC seksjon 6.3: A-Z + 2-9, utelat 0/1/I/O/L)
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let pwd = "";
    for (let i = 0; i < bytes.length; i++) {
      pwd += alphabet[bytes[i] % alphabet.length];
      if (i === 1 || i === 3 || i === 5 || i === 7 || i === 9 || i === 11 || i === 13) {
        pwd += "-";
      }
    }
    setPassword(pwd);
    setPasswordConfirm(pwd);
    setWasGenerated(true);
    setShowPassword(true);
  }

  async function handleEncrypt() {
    setError(null);
    setBusy(true);
    setStage("encrypting");
    try {
      // Plan containere
      const plan = planContainers(files, containerCount);
      const built: BuiltContainer[] = [];
      const baseName = (packageName || "pakke").trim();
      for (let i = 0; i < plan.groups.length; i++) {
        const groupFiles = plan.groups[i].map((idx) => files[idx]);
        const bytes = await buildContainer({
          files: groupFiles,
          password,
          appVersion: APP_VERSION,
        });
        const containerName =
          plan.groups.length === 1 ? `${baseName}.kodoenc` : `${baseName}-${i + 1}.kodoenc`;
        built.push({ name: containerName, bytes });
      }
      setBuiltContainers(built);
      setStage("done");

      // 1 container → trigger nedlasting direkte (ingen Chrome-batch-prompt)
      // N containere → la brukeren velge FSAccess (mappe) eller ZIP i DoneStage
      if (built.length === 1) {
        triggerDownload(built[0].name, built[0].bytes);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("pack.error_encryption_failed");
      setError(msg);
      setStage("password");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      data-testid="pack-module-modal"
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && stage !== "encrypting") onClose();
      }}
    >
      <div className="w-full max-w-xl">
        <div className="rounded-2xl backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <Package className="h-5 w-5 text-emerald-300" />
              <h2 className="text-base font-semibold text-white">
                {stage === "done" ? t("pack.title_done") : t("pack.title")}
              </h2>
            </div>
            {stage !== "encrypting" && (
              <button
                ref={cancelRef}
                data-testid="pack-close-btn"
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Stage content */}
          <div className="p-5 max-h-[70vh] overflow-y-auto">
            {stage === "select" && (
              <SelectStage
                t={t}
                packageName={packageName}
                setPackageName={setPackageName}
                files={files}
                totalBytes={totalBytes}
                maxFileSizeMB={maxFileSizeMB}
                overLimit={overLimit}
                fileInputRef={fileInputRef}
                folderInputRef={folderInputRef}
                onFilesAdded={handleFilesAdded}
                onRemoveFile={removeFile}
                onDrop={handleDrop}
              />
            )}
            {stage === "containers" && (
              <ContainersStage
                t={t}
                files={files}
                totalBytes={totalBytes}
                containerCount={containerCount}
                setContainerCount={setContainerCount}
              />
            )}
            {stage === "password" && (
              <PasswordStage
                t={t}
                password={password}
                setPassword={(p) => {
                  setPassword(p);
                  setWasGenerated(false);
                }}
                passwordConfirm={passwordConfirm}
                setPasswordConfirm={setPasswordConfirm}
                wasGenerated={wasGenerated}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                strength={strength}
                onGenerate={handleGeneratePassword}
                error={error}
              />
            )}
            {stage === "encrypting" && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="h-10 w-10 text-emerald-300 animate-spin" />
                <p className="text-sm text-white/80 text-center">
                  {t("pack.encrypting")}
                </p>
                <p className="text-xs text-white/50 text-center">
                  {t("pack.encrypting_dont_close")}
                </p>
              </div>
            )}
            {stage === "done" && (
              <DoneStage t={t} builtContainers={builtContainers} packageName={packageName} />
            )}
          </div>

          {/* Footer (actions) */}
          {stage !== "encrypting" && (
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10 bg-black/15">
              {stage === "done" ? (
                <button
                  data-testid="pack-done-btn"
                  onClick={onClose}
                  className={`ml-auto h-9 px-5 rounded-full ${T.primaryButton} text-white text-sm font-semibold transition`}
                >
                  {t("pack.done_button")}
                </button>
              ) : (
                <>
                  <button
                    data-testid="pack-back-btn"
                    onClick={() => {
                      if (stage === "containers") setStage("select");
                      else if (stage === "password") setStage("containers");
                      else onClose();
                    }}
                    disabled={busy}
                    className="h-9 px-4 rounded-full text-white/70 hover:text-white text-sm transition disabled:opacity-50"
                  >
                    {stage === "select" ? t("common.cancel") : t("pack.back_button")}
                  </button>

                  {stage === "select" && (
                    <button
                      data-testid="pack-next-files-btn"
                      onClick={() => setStage("containers")}
                      disabled={
                        files.length === 0 || overLimit || !packageName.trim()
                      }
                      className={`h-9 px-5 rounded-full ${T.primaryButton} text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5`}
                    >
                      {t("pack.next_button")} <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  {stage === "containers" && (
                    <button
                      data-testid="pack-next-containers-btn"
                      onClick={() => setStage("password")}
                      className={`h-9 px-5 rounded-full ${T.primaryButton} text-white text-sm font-semibold transition flex items-center gap-1.5`}
                    >
                      {t("pack.next_button")} <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                  {stage === "password" && (
                    <button
                      data-testid="pack-encrypt-btn"
                      onClick={handleEncrypt}
                      disabled={
                        password.length < 8 ||
                        busy ||
                        (!wasGenerated && password !== passwordConfirm)
                      }
                      className={`h-9 px-5 rounded-full ${T.primaryButton} text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5`}
                    >
                      {t("pack.encrypt_button")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Stage 1 — Velg filer + pakke-navn =====
function SelectStage(props: {
  t: (key: string) => string;
  packageName: string;
  setPackageName: (s: string) => void;
  files: PackageFile[];
  totalBytes: number;
  maxFileSizeMB: number;
  overLimit: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesAdded: (files: FileList | File[]) => Promise<void>;
  onRemoveFile: (index: number) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}) {
  const { t } = props;
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">
          {t("pack.label_name")}
        </label>
        <input
          data-testid="pack-name-input"
          type="text"
          value={props.packageName}
          onChange={(e) => props.setPackageName(e.target.value)}
          placeholder={t("pack.placeholder_name")}
          className="w-full h-10 px-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-emerald-300/60 transition"
        />
        <p className="text-[11px] text-white/50 mt-1.5">
          {t("pack.name_hint_1")}<code className="text-white/70">{t("pack.name_example")}</code>{t("pack.name_hint_2")}
        </p>
        {props.packageName.trim() && (
          <p className="text-[11px] text-emerald-300/80 mt-1">
            {t("pack.saves_as_prefix")} <code className="text-white/90">{props.packageName.trim()}.kodoenc</code>
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">
          {t("pack.label_files")}
        </label>
        <div
          data-testid="pack-drop-zone"
          onDrop={props.onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="rounded-lg border-2 border-dashed border-white/25 hover:border-emerald-300/60 hover:bg-white/5 transition p-6 text-center"
        >
          <Package className="h-8 w-8 mx-auto text-white/40 mb-2" />
          <p className="text-sm text-white/80">
            {t("pack.drop_zone_title")}
          </p>
          <p className="text-xs text-white/50 mt-1 mb-3">
            {t("pack.drop_zone_subtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              data-testid="pack-pick-files-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.fileInputRef.current?.click();
              }}
              className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold transition"
            >
              {t("pack.pick_files_button")}
            </button>
            <button
              data-testid="pack-pick-folder-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.folderInputRef.current?.click();
              }}
              className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold transition"
              title={t("pack.pick_folder_title")}
            >
              {t("pack.pick_folder_button")}
            </button>
          </div>
        </div>
        <input
          ref={props.fileInputRef}
          data-testid="pack-file-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void props.onFilesAdded(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={props.folderInputRef}
          data-testid="pack-folder-input"
          type="file"
          multiple
          // @ts-expect-error - webkitdirectory er non-standard men støttes i alle moderne nettlesere
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void props.onFilesAdded(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-white/45 mt-2">
          {t("pack.tip_drag")}
        </p>
      </div>

      {props.files.length > 0 && (
        <div className="rounded-lg border border-white/15 bg-black/20 p-3 max-h-56 overflow-y-auto">
          <div className="flex items-center justify-between mb-2 sticky top-0 bg-slate-900/80 backdrop-blur-sm py-1 -mx-1 px-1">
            <span className="text-xs text-white/70 font-semibold">
              {props.files.length} {props.files.length === 1 ? t("pack.count_file_singular") : t("pack.count_file_plural")} ·{" "}
              <span className={props.overLimit ? "text-rose-300" : "text-white/60"}>
                {formatBytes(props.totalBytes)}
              </span>
            </span>
          </div>
          <ul className="space-y-1">
            {props.files.map((f, i) => (
              <li
                key={`${f.path}-${i}`}
                data-testid={`pack-file-row-${i}`}
                className="flex items-center justify-between gap-2 text-xs text-white/85 py-1 hover:bg-white/5 rounded px-1"
              >
                <span className="truncate flex-1" title={f.path}>
                  {f.path}
                </span>
                <span className="text-white/45 flex-shrink-0">
                  {formatBytes(f.bytes.byteLength)}
                </span>
                <button
                  data-testid={`pack-remove-file-${i}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemoveFile(i);
                  }}
                  className="text-white/45 hover:text-rose-300 transition flex-shrink-0"
                  aria-label={`${t("pack.remove_file_aria_prefix")} ${f.path}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.overLimit && (
        <div
          data-testid="pack-overlimit-warning"
          className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-200 flex items-start gap-2"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>
            {t("pack.overlimit_1")} {formatBytes(props.totalBytes)} {t("pack.overlimit_2")}{" "}
            {props.maxFileSizeMB} {t("pack.overlimit_3")}
          </span>
        </div>
      )}
    </div>
  );
}

// ===== Stage 2 — Antall containere =====
function ContainersStage(props: {
  t: (key: string) => string;
  files: PackageFile[];
  totalBytes: number;
  containerCount: number;
  setContainerCount: (n: number) => void;
}) {
  const { t } = props;
  // Antall container-tilbud (Mike sin briefing):
  //   <5 MB        → 1 (ingen splitting tilbys, vises som info)
  //   5-20 MB      → 2
  //   21-30 MB     → 3
  //   31-40 MB     → 4
  //   41+ MB       → 5+ (kappes på 5)
  //   Aldri flere enn antall filer.
  const tenMB = 10 * 1024 * 1024;
  const fiveMB = 5 * 1024 * 1024;
  const maxBySize =
    props.totalBytes < fiveMB
      ? 1
      : Math.max(2, Math.ceil(props.totalBytes / tenMB));
  const maxOptions = Math.min(5, props.files.length, Math.max(1, maxBySize));

  // Klamping + default-valg.
  // Ved første ankomst (containerCount=1 == initial state) → velg maks-antall som default
  // slik at den øverste/sikreste opsjonen er pre-valgt. De fleste klarer 10 MB,
  // ikke alle klarer 37 MB → splitt så mye som mulig som default.
  // Hvis brukeren har valgt manuelt, respekter det (klamp bare ned hvis nødvendig).
  useEffect(() => {
    if (props.containerCount === 1 && maxOptions > 1) {
      props.setContainerCount(maxOptions);
    } else if (props.containerCount > maxOptions) {
      props.setContainerCount(maxOptions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxOptions]);

  // Single-option edge case (8 MB-fila som Mike eksempel): vis info, ingen valg
  if (maxOptions === 1) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-white/80">
          {t("pack.containers_single_info_1")}{formatBytes(props.totalBytes)}{t("pack.containers_single_info_2")}
        </p>
        <div className="rounded-lg border border-white/15 bg-black/20 p-3 text-xs text-white/75">
          <strong>{t("pack.container_count_one")}</strong> · {props.files.length}{" "}
          {props.files.length === 1 ? t("pack.count_file_singular") : t("pack.count_file_plural")} · {formatBytes(props.totalBytes)} ·
          {" "}{t("pack.estimated_encryption_prefix")} {estimateEncryptSeconds(props.totalBytes)}s
        </div>
        <p className="text-[11px] text-white/50">
          {t("pack.tip_splitting_threshold")}
        </p>
      </div>
    );
  }

  // Rekkefølge: høyeste øverst (4, 3, 2, 1) — flere containere = mindre filer = tryggere
  // for de fleste e-post-mottakere. Mike sin briefing: 10 MB OK, 37 MB ikke.
  const options = Array.from({ length: maxOptions }, (_, i) => maxOptions - i);

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/80">
        {t("pack.containers_intro_1")} {props.files.length} {t("pack.containers_intro_2")}{formatBytes(props.totalBytes)}{t("pack.containers_intro_3")}
      </p>
      <div className="space-y-2">
        {options.map((n) => {
          const plan = planContainers(props.files, n);
          const maxContainer = Math.max(...plan.totalBytes);
          const encSec = estimateEncryptSeconds(maxContainer);
          const isSelected = props.containerCount === n;
          return (
            <button
              key={n}
              data-testid={`pack-container-opt-${n}`}
              onClick={() => props.setContainerCount(n)}
              className={`w-full text-left rounded-lg border p-3 transition ${
                isSelected
                  ? "border-emerald-300/60 bg-emerald-400/10"
                  : "border-white/15 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                      isSelected
                        ? "border-emerald-300 bg-emerald-400"
                        : "border-white/40"
                    }`}
                  />
                  <span className="text-sm font-semibold text-white">
                    {n === 1 ? t("pack.container_count_one") : `${n} ${t("pack.container_count_n_suffix")}`}
                  </span>
                </div>
                <span className="text-[11px] text-white/55">
                  {t("pack.estimated_seconds_prefix")}{encSec}{t("pack.estimated_seconds_suffix")}
                </span>
              </div>
              <p className="text-[11px] text-white/55 mt-1 ml-6">
                {t("pack.largest_container_prefix")} {formatBytes(maxContainer)}{" "}
                {plan.groups.length > 1 &&
                  `· ${plan.groups[0].length}+${plan.groups.length > 2 ? "..." : plan.groups[plan.groups.length - 1].length} ${t("pack.count_file_plural")}`}
              </p>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-white/50">
        {t("pack.containers_independence_note")}
      </p>
    </div>
  );
}

// ===== Stage 3 — Engangs-passord =====
function PasswordStage(props: {
  t: (key: string) => string;
  password: string;
  setPassword: (s: string) => void;
  passwordConfirm: string;
  setPasswordConfirm: (s: string) => void;
  wasGenerated: boolean;
  showPassword: boolean;
  setShowPassword: (b: boolean) => void;
  strength: { score: 0 | 1 | 2 | 3 | 4; label: string } | null;
  onGenerate: () => void;
  error: string | null;
}) {
  const { t } = props;
  const confirmMismatch =
    !props.wasGenerated &&
    props.passwordConfirm.length > 0 &&
    props.password !== props.passwordConfirm;
  const confirmOk =
    !props.wasGenerated &&
    props.password.length >= 8 &&
    props.password === props.passwordConfirm;
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/80">
        {t("pack.password_intro")}
      </p>

      <div>
        <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">
          {t("pack.label_password")}
        </label>
        <div className="relative">
          <input
            data-testid="pack-password-input"
            type={props.showPassword ? "text" : "password"}
            value={props.password}
            onChange={(e) => props.setPassword(e.target.value)}
            placeholder={t("pack.placeholder_password")}
            className="w-full h-10 pl-3 pr-20 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-emerald-300/60 font-mono"
          />
          <button
            data-testid="pack-toggle-show-pwd-btn"
            type="button"
            onClick={() => props.setShowPassword(!props.showPassword)}
            className="absolute right-9 top-1/2 -translate-y-1/2 text-white/55 hover:text-white"
            aria-label={props.showPassword ? t("common.hide_password") : t("common.show_password")}
          >
            {props.showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
        <button
          data-testid="pack-generate-pwd-btn"
          type="button"
          onClick={props.onGenerate}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-200 transition"
        >
          <Dices className="h-3.5 w-3.5" /> {t("pack.generate_button")}
        </button>
        {props.password.length > 0 && props.password.length < 8 && (
          <p className="text-[11px] text-rose-300 mt-1">
            {t("pack.error_min_8")}
          </p>
        )}
        {props.strength && props.password.length >= 8 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-white/15 overflow-hidden">
              <div
                className={`h-full ${scoreColor(props.strength.score)} transition-all`}
                style={{ width: `${((props.strength.score + 1) / 5) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-white/70 w-24 text-right">
              {props.strength.label}
            </span>
          </div>
        )}
      </div>

      {!props.wasGenerated && (
        <div>
          <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">
            {t("pack.label_confirm")}
          </label>
          <input
            data-testid="pack-password-confirm-input"
            type={props.showPassword ? "text" : "password"}
            value={props.passwordConfirm}
            onChange={(e) => props.setPasswordConfirm(e.target.value)}
            placeholder={t("pack.placeholder_confirm")}
            className={`w-full h-10 px-3 rounded-lg bg-white/10 border text-white placeholder-white/40 focus:outline-none font-mono transition ${
              confirmMismatch
                ? "border-rose-400/60 focus:border-rose-300"
                : confirmOk
                  ? "border-emerald-400/60 focus:border-emerald-300"
                  : "border-white/20 focus:border-emerald-300/60"
            }`}
          />
          {confirmMismatch && (
            <p
              data-testid="pack-password-mismatch"
              className="text-[11px] text-rose-300 mt-1"
            >
              {t("pack.error_mismatch")}
            </p>
          )}
          {confirmOk && (
            <p
              data-testid="pack-password-match"
              className="text-[11px] text-emerald-300 mt-1"
            >
              {t("pack.confirm_match")}
            </p>
          )}
        </div>
      )}

      {props.wasGenerated && (
        <div
          data-testid="pack-password-generated-note"
          className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-2.5 text-[11px] text-emerald-100 flex items-center gap-2"
        >
          <Dices className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" />
          <span>{t("pack.generated_note")}</span>
        </div>
      )}

      <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-100 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-300" />
        <div className="space-y-1.5">
          <p>
            <strong>{t("pack.warning_pwd_once_strong")}</strong>{" "}
            {t("pack.warning_pwd_rest")}
          </p>
          <p>
            {t("pack.warning_forever")}
          </p>
        </div>
      </div>

      {props.error && (
        <div
          data-testid="pack-error"
          className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {props.error}
        </div>
      )}
    </div>
  );
}

// ===== Stage 5 — Done =====
function DoneStage(props: { t: (key: string) => string; builtContainers: BuiltContainer[]; packageName: string }) {
  const { t } = props;
  const multi = props.builtContainers.length > 1;
  const fsAccessAvailable = hasFsAccess();
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [completion, setCompletion] = useState<
    | { mode: "folder"; count: number; folderName: string }
    | { mode: "zip"; fileName: string; count: number }
    | { mode: "single"; fileName: string }
    | null
  >(null);

  async function handleDownloadOne(name: string, bytes: Uint8Array) {
    triggerDownload(name, bytes);
    setCompletion({ mode: "single", fileName: name });
  }

  async function handleDownloadAllZip() {
    const zip = new JSZip();
    for (const c of props.builtContainers) {
      zip.file(c.name, c.bytes as Uint8Array);
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    const base = (props.packageName || "pakke").trim();
    const zipName = `${base}-containere.zip`;
    triggerDownload(zipName, bytes);
    setCompletion({ mode: "zip", fileName: zipName, count: props.builtContainers.length });
  }

  async function handleDownloadAllToFolder() {
    if (!fsAccessAvailable) return;
    let rootHandle: FileSystemDirectoryHandle;
    try {
      // @ts-expect-error - showDirectoryPicker er ikke i lib.dom for alle TS-versjoner
      rootHandle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      });
    } catch {
      return;
    }
    setProgress({ current: 0, total: props.builtContainers.length });
    let okCount = 0;
    for (let i = 0; i < props.builtContainers.length; i++) {
      const c = props.builtContainers[i];
      try {
        const handle = await rootHandle.getFileHandle(c.name, { create: true });
        const stream = await handle.createWritable();
        await stream.write(c.bytes as BufferSource);
        await stream.close();
        okCount++;
      } catch (e) {
        console.error("FSAccess write failed for", c.name, e);
      }
      setProgress({ current: i + 1, total: props.builtContainers.length });
    }
    await new Promise((r) => setTimeout(r, 400));
    setProgress(null);
    setCompletion({
      mode: "folder",
      count: okCount,
      folderName: rootHandle.name || "valgt mappe",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="h-12 w-12 rounded-full bg-emerald-400/20 flex items-center justify-center">
          <Download className="h-6 w-6 text-emerald-300" />
        </div>
        <p className="text-sm text-white/85 text-center">
          {multi
            ? `${props.builtContainers.length} ${t("pack.done_multi_1")}`
            : t("pack.done_single")}
        </p>
      </div>

      {multi && (
        <div className="space-y-2">
          {fsAccessAvailable && (
            <button
              data-testid="pack-download-to-folder-btn"
              onClick={handleDownloadAllToFolder}
              disabled={progress !== null}
              className={`w-full h-11 rounded-xl ${T.primaryButton} disabled:opacity-60 text-white text-sm font-semibold transition flex items-center justify-center gap-2 px-3`}
              title={t("pack.btn_pick_folder_title")}
            >
              <FolderOpen className="h-4 w-4" />
              <span className="truncate">{t("pack.btn_pick_folder")}</span>
            </button>
          )}
          <button
            data-testid="pack-download-all-zip-btn"
            onClick={handleDownloadAllZip}
            disabled={progress !== null}
            className={`w-full h-11 rounded-xl disabled:opacity-60 text-white text-sm font-semibold transition flex items-center justify-center gap-2 px-3 ${
              fsAccessAvailable
                ? "bg-white/10 hover:bg-white/20 border border-white/20"
                : "bg-emerald-500 hover:bg-emerald-600"
            }`}
            title={t("pack.btn_zip_all_title")}
          >
            <Download className="h-4 w-4" />
            <span className="truncate">{t("pack.btn_zip_all")}</span>
          </button>
          {progress && (
            <div
              data-testid="pack-folder-progress"
              className="rounded-lg border border-white/15 bg-black/20 p-3 space-y-2"
            >
              <p className="text-xs text-white/75">
                {t("pack.progress_writing_1")} {progress.current} {t("pack.progress_writing_2")} {progress.total} {t("pack.progress_writing_3")}
              </p>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {completion && completion.mode === "folder" && (
            <div
              data-testid="pack-completion-folder"
              className={`rounded-lg ${T.successBanner} p-3 flex items-start gap-2`}
            >
              <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-300" />
              <div className="text-xs text-emerald-100 space-y-0.5">
                <p className="font-semibold">
                  {completion.count === 1
                    ? t("pack.completion_single")
                    : t("pack.completion_multi")}
                </p>
                <p className="text-emerald-100/80">
                  {t("pack.completion_folder_prefix")} <code className="text-white/90">{completion.folderName}</code>
                </p>
              </div>
            </div>
          )}
          {completion && completion.mode === "zip" && (
            <div
              data-testid="pack-completion-zip"
              className={`rounded-lg ${T.successBanner} p-3 flex items-start gap-2`}
            >
              <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-300" />
              <div className="text-xs text-emerald-100 space-y-0.5">
                <p className="font-semibold">
                  {t("pack.completion_multi")}
                </p>
                <p className="text-emerald-100/80 font-mono truncate" title={completion.fileName}>
                  {completion.fileName}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {!multi && (
        <div
          data-testid="pack-completion-single"
          className={`rounded-lg ${T.successBanner} p-3 flex items-start gap-2`}
        >
          <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-300" />
          <div className="text-xs text-emerald-100 space-y-0.5">
            <p className="font-semibold">
              {t("pack.completion_single")}
            </p>
            <p className="text-emerald-100/80 font-mono truncate" title={props.builtContainers[0]?.name}>
              {props.builtContainers[0]?.name}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/15 bg-black/20 p-3 space-y-1.5 max-h-40 overflow-y-auto">
        {props.builtContainers.map((c) => (
          <div
            key={c.name}
            data-testid={`pack-result-${c.name}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-white/85 font-mono truncate flex-1" title={c.name}>
              {c.name}
            </span>
            <span className="text-white/55 flex-shrink-0">
              {formatBytes(c.bytes.byteLength)}
            </span>
            {multi && (
              <button
                data-testid={`pack-download-one-${c.name}`}
                onClick={() => handleDownloadOne(c.name, c.bytes)}
                className="flex-shrink-0 h-6 px-2 rounded-md bg-white/5 hover:bg-white/15 text-white/75 hover:text-white text-[10px] transition"
                title={t("pack.btn_download_one_title")}
              >
                {t("pack.btn_download_one")}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/5 p-3 text-xs text-white/85">
        <p className="font-semibold text-emerald-200 mb-1.5">{t("pack.recipient_instructions_title")}</p>
        <ol className="space-y-1 list-decimal list-inside text-white/75">
          <li>{t("pack.recipient_step_1_a")} <code>.kodoenc</code>{t("pack.recipient_step_1_b")}</li>
          <li>{t("pack.recipient_step_2")}</li>
          <li>
            {t("pack.recipient_step_3_a")} <code>kodo-vault.vercel.app/unpack</code>
          </li>
        </ol>
      </div>
    </div>
  );
}

// ===== Helper: trigger nedlasting av bytes som fil =====
function triggerDownload(filename: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File System Access API-detektor (Chrome/Edge 86+, ikke Safari/Firefox). */
function hasFsAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// validateFileSize-eksport gjenbruk for andre konsumenter
export { validateFileSize };

/**
 * Rekursivt traverse en FileSystemEntry (fra dataTransfer.items[i].webkitGetAsEntry()).
 * Bygger en flat liste av File-objekter med riktig relativ sti.
 */
async function collectEntry(
  entry: FileSystemEntry,
  basePath: string,
  out: { file: File; path: string }[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) =>
      fileEntry.file(resolve, reject),
    );
    const path = basePath ? `${basePath}/${entry.name}` : entry.name;
    out.push({ file, path });
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    // readEntries() returnerer maks ~100 av gangen — må kalles til tom batch
    let allChildren: FileSystemEntry[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      allChildren = allChildren.concat(batch);
    }
    const nextBase = basePath ? `${basePath}/${entry.name}` : entry.name;
    for (const child of allChildren) {
      await collectEntry(child, nextBase, out);
    }
  }
}
