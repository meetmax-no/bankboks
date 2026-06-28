"use client";

/**
 * Pakker-feature bruker emerald-aksent gjennomgående.
 * For å bytte fargen: se kommentar i PackModule.tsx eller lib/feature-theme.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  AlertTriangle,
  Check,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Lock,
  Package,
  X,
} from "lucide-react";
import {
  openContainer,
  formatBytes,
  type PackageFile,
} from "@/lib/package-zip";
import { PackageDecryptError, PackageParseError } from "@/lib/package";
import { PackagePreview } from "@/components/PackagePreview";
import { PACKAGES_THEME as T } from "@/lib/feature-theme";
import { useLocale } from "@/lib/i18n-context";

interface UnpackModuleProps {
  open: boolean;
  onClose: () => void;
  /**
   * SPEC rad 12 — master-pwd-vakt. Hvis vault er ulåst i samme tab, kalleren
   * gir denne callback'en. Når Anna/Lars taster pwd, verifiserer vi mot vault
   * — match = advarsel (de tastet vault-pwd i stedet for pakke-pwd).
   * Undefined når vault er låst eller ikke i samme tab.
   */
  verifyMasterPassword?: (pwd: string) => Promise<boolean>;
}

type Stage = "drop" | "password" | "decrypting" | "viewing" | "error";

/** Detect File System Access API (Chrome 86+, Edge 86+ — ikke Safari/Firefox). */
function hasFsAccess(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

interface FlatProgress {
  current: number;
  total: number;
  cancelRequested: boolean;
}

/**
 * Anna sin pakk-ut-flyt (Iter 4). Brukes BÅDE av Anna (på login-siden via
 * PackageEntryButton) og Lars (i appen via PackageHubModal).
 *
 * SPEC: /app/memory/v4.0-SPEC.md seksjon 2.1 + 9.2 + 9.4
 */
export function UnpackModule({
  open,
  onClose,
  verifyMasterPassword,
}: UnpackModuleProps) {
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>("drop");
  const [envelopeBytes, setEnvelopeBytes] = useState<Uint8Array | null>(null);
  const [envelopeName, setEnvelopeName] = useState<string>("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [files, setFiles] = useState<PackageFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [masterPwdWarning, setMasterPwdWarning] = useState(false);
  const [previewFile, setPreviewFile] = useState<PackageFile | null>(null);
  const [flatProgress, setFlatProgress] = useState<FlatProgress | null>(null);
  const [completion, setCompletion] = useState<
    | { mode: "folder"; count: number; folderName: string }
    | { mode: "zip"; fileName: string; count: number }
    | { mode: "single"; fileName: string }
    | null
  >(null);
  const flatCancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset state hver gang modalen åpnes
  useEffect(() => {
    if (open) {
      setStage("drop");
      setEnvelopeBytes(null);
      setEnvelopeName("");
      setPassword("");
      setShowPassword(false);
      setFiles([]);
      setError(null);
      setMasterPwdWarning(false);
      setPreviewFile(null);
      setCompletion(null);
      setTimeout(() => cancelRef.current?.focus(), 50);
    }
  }, [open]);

  // Esc lukker (men ikke under decrypting eller preview)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        stage !== "decrypting" &&
        previewFile === null
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, stage, previewFile, onClose]);

  const handleFile = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setEnvelopeBytes(bytes);
    setEnvelopeName(file.name);
    setStage("password");
    setError(null);
  }, []);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  async function handleUnpack() {
    if (!envelopeBytes) return;
    setStage("decrypting");
    setError(null);
    setMasterPwdWarning(false);

    // SPEC rad 12 — master-pwd-vakt
    if (verifyMasterPassword) {
      try {
        const isMaster = await verifyMasterPassword(password);
        if (isMaster) {
          setMasterPwdWarning(true);
          setStage("password");
          return;
        }
      } catch {
        // Ignorer verify-feil — fortsett til pakke-decrypt
      }
    }

    try {
      const opened = await openContainer(envelopeBytes, password);
      setFiles(opened.files);
      setStage("viewing");
    } catch (e) {
      const msg =
        e instanceof PackageDecryptError
          ? t("unpack.error_wrong_password")
          : e instanceof PackageParseError
            ? e.message
            : e instanceof Error
              ? e.message
              : t("unpack.error_generic");
      setError(msg);
      setStage("password");
    }
  }

  async function handleDownloadAllZip() {
    if (files.length === 0) return;
    // Bygg en ZIP STORE (uten kompresjon — SPEC rad 5) med alle filer
    // Mappe-struktur bevares (Hoppeslott/Underlag/skanning.pdf osv.)
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.path, f.bytes as Uint8Array);
    }
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const baseName = envelopeName.replace(/\.kodoenc$/i, "") || "pakke";
    const fname = `${baseName}-utpakket.zip`;
    triggerDownload(fname, bytes);
    setCompletion({ mode: "zip", fileName: fname, count: files.length });
  }

  /**
   * Chrome/Edge: bruker velger én mappe via showDirectoryPicker(),
   * og alle filer skrives direkte dit med bevart mappe-struktur. Ingen
   * per-fil-prompts, ingen batch-blokkering.
   */
  async function handleDownloadAllToFolder() {
    if (files.length === 0) return;
    if (!hasFsAccess()) return;
    let rootHandle: FileSystemDirectoryHandle;
    try {
      // @ts-expect-error - showDirectoryPicker er ikke i lib.dom for alle TS-versjoner
      rootHandle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      });
    } catch {
      // Brukeren avbrøt picker — gjør ingenting
      return;
    }

    flatCancelRef.current = false;
    setFlatProgress({ current: 0, total: files.length, cancelRequested: false });

    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      if (flatCancelRef.current) break;
      const f = files[i];
      try {
        await writeFileToDirectory(rootHandle, f.path, f.bytes);
        okCount++;
      } catch (e) {
        console.error("FSAccess write failed for", f.path, e);
      }
      setFlatProgress({
        current: i + 1,
        total: files.length,
        cancelRequested: flatCancelRef.current,
      });
    }

    await new Promise((r) => setTimeout(r, 500));
    setFlatProgress(null);
    if (!flatCancelRef.current && okCount > 0) {
      setCompletion({
        mode: "folder",
        count: okCount,
        folderName: rootHandle.name || t("unpack.fallback_folder_name"),
      });
    }
  }

  function handleCancelFlat() {
    flatCancelRef.current = true;
    setFlatProgress((p) => (p ? { ...p, cancelRequested: true } : null));
  }

  function handleDownloadOne(file: PackageFile) {
    const name = file.path.split("/").pop() || "fil";
    triggerDownload(name, file.bytes);
    setCompletion({ mode: "single", fileName: name });
  }

  if (!open) return null;

  return (
    <>
      <div
        data-testid="unpack-module-modal"
        className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
        onClick={(e) => {
          if (
            e.target === e.currentTarget &&
            stage !== "decrypting" &&
            previewFile === null
          ) {
            onClose();
          }
        }}
      >
        <div className="w-full max-w-xl">
          <div className="rounded-2xl backdrop-blur-xl border border-white/20 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <Package className="h-5 w-5 text-emerald-300" />
                <h2 className="text-base font-semibold text-white">
                  {t("unpack.title")}
                </h2>
              </div>
              {stage !== "decrypting" && (
                <button
                  ref={cancelRef}
                  data-testid="unpack-close-btn"
                  onClick={onClose}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
                  aria-label={t("common.close")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Body */}
            <div className="p-5 max-h-[70vh] overflow-y-auto">
              {stage === "drop" && (
                <DropStage
                  t={t}
                  fileInputRef={fileInputRef}
                  onDrop={handleDrop}
                  onFile={handleFile}
                />
              )}
              {stage === "password" && envelopeBytes && (
                <PasswordStage
                  t={t}
                  envelopeName={envelopeName}
                  envelopeBytes={envelopeBytes}
                  password={password}
                  setPassword={(p) => {
                    setPassword(p);
                    setMasterPwdWarning(false);
                  }}
                  showPassword={showPassword}
                  setShowPassword={setShowPassword}
                  error={error}
                  masterPwdWarning={masterPwdWarning}
                  showMasterWarning={!!verifyMasterPassword}
                />
              )}
              {stage === "decrypting" && (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Loader2 className="h-10 w-10 text-emerald-300 animate-spin" />
                  <p className="text-sm text-white/80 text-center">
                    {t("unpack.decrypting")}
                  </p>
                </div>
              )}
              {stage === "viewing" && (
                <ViewingStage
                  t={t}
                  files={files}
                  completion={completion}
                  onPreview={(f) => setPreviewFile(f)}
                  onDownloadOne={handleDownloadOne}
                  onDownloadAllZip={handleDownloadAllZip}
                  onDownloadAllToFolder={handleDownloadAllToFolder}
                />
              )}
            </div>

            {/* Footer (actions) */}
            {stage !== "decrypting" && (
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10 bg-black/15">
                {stage === "viewing" ? (
                  <button
                    data-testid="unpack-done-btn"
                    onClick={onClose}
                    className="ml-auto h-9 px-5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition"
                  >
                    {t("unpack.done_button")}
                  </button>
                ) : (
                  <>
                    <button
                      data-testid="unpack-back-btn"
                      onClick={() => {
                        if (stage === "password") {
                          setStage("drop");
                          setEnvelopeBytes(null);
                          setEnvelopeName("");
                          setPassword("");
                          setError(null);
                        } else {
                          onClose();
                        }
                      }}
                      className="h-9 px-4 rounded-full text-white/70 hover:text-white text-sm transition"
                    >
                      {stage === "drop" ? t("common.cancel") : t("unpack.back_button")}
                    </button>
                    {stage === "password" && (
                      <button
                        data-testid="unpack-decrypt-btn"
                        onClick={handleUnpack}
                        disabled={password.length === 0}
                        className="h-9 px-5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t("unpack.decrypt_button")}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline preview overlay */}
      <PackagePreview file={previewFile} onClose={() => setPreviewFile(null)} />

      {/* Progress + Cancel modal for "Alle flatt" / FSAccess */}
      {flatProgress && (
        <div
          data-testid="unpack-flat-progress-modal"
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm rounded-2xl backdrop-blur-xl border border-white/20 shadow-2xl p-5 space-y-3">
            <h3 className="text-base font-semibold text-white">
              {flatProgress.cancelRequested
                ? t("unpack.progress_canceling")
                : flatProgress.current === flatProgress.total
                  ? t("unpack.progress_done")
                  : t("unpack.progress_downloading")}
            </h3>
            <p className="text-xs text-white/70">
              {flatProgress.current} {t("unpack.progress_count_separator")} {flatProgress.total} {t("unpack.progress_count_suffix")}
            </p>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{
                  width: `${(flatProgress.current / flatProgress.total) * 100}%`,
                }}
              />
            </div>
            {!flatProgress.cancelRequested &&
              flatProgress.current < flatProgress.total && (
                <button
                  data-testid="unpack-flat-cancel-btn"
                  onClick={handleCancelFlat}
                  className="w-full h-9 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-300/40 text-rose-200 text-xs font-medium transition"
                >
                  {t("common.cancel")}
                </button>
              )}
          </div>
        </div>
      )}
    </>
  );
}

// ===== Stage 1 — Drop =====
function DropStage(props: {
  t: (key: string) => string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onFile: (f: File) => Promise<void>;
}) {
  const { t } = props;
  return (
    <div className="space-y-4">
      <div
        data-testid="unpack-drop-zone"
        onDrop={props.onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => props.fileInputRef.current?.click()}
        className="rounded-lg border-2 border-dashed border-white/25 hover:border-emerald-300/60 hover:bg-white/5 transition p-10 cursor-pointer text-center"
      >
        <Package className="h-12 w-12 mx-auto text-white/40 mb-3" />
        <p className="text-sm text-white/85 font-medium mb-1">
          {t("unpack.drop_zone_title")}
        </p>
        <p className="text-xs text-white/55">{t("unpack.drop_zone_subtitle")}</p>
      </div>
      <input
        ref={props.fileInputRef}
        data-testid="unpack-file-input"
        type="file"
        accept=".kodoenc"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void props.onFile(f);
          e.target.value = "";
        }}
      />
      <p className="text-[11px] text-white/50 text-center">
        {t("unpack.privacy_note")}
      </p>
    </div>
  );
}

// ===== Stage 2 — Password =====
function PasswordStage(props: {
  t: (key: string) => string;
  envelopeName: string;
  envelopeBytes: Uint8Array;
  password: string;
  setPassword: (p: string) => void;
  showPassword: boolean;
  setShowPassword: (b: boolean) => void;
  error: string | null;
  masterPwdWarning: boolean;
  showMasterWarning: boolean;
}) {
  const { t } = props;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/15 bg-black/20 p-3 flex items-center gap-3">
        <Package className="h-5 w-5 text-emerald-300 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p
            className="text-sm text-white/90 font-mono truncate"
            title={props.envelopeName}
          >
            {props.envelopeName}
          </p>
          <p className="text-[11px] text-white/55">
            {formatBytes(props.envelopeBytes.byteLength)}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
          <Lock className="h-3 w-3" />
          {t("unpack.label_password")}
          {props.showMasterWarning && (
            <span className="text-amber-300/90 normal-case font-normal text-[10px]">
              {t("unpack.label_password_warning")}
            </span>
          )}
        </label>
        <div className="relative">
          <input
            data-testid="unpack-password-input"
            type={props.showPassword ? "text" : "password"}
            value={props.password}
            onChange={(e) => props.setPassword(e.target.value)}
            placeholder={t("unpack.placeholder_password")}
            autoFocus
            className="w-full h-10 pl-3 pr-10 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-emerald-300/60 font-mono"
          />
          <button
            data-testid="unpack-toggle-show-pwd-btn"
            type="button"
            onClick={() => props.setShowPassword(!props.showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/55 hover:text-white p-1"
            aria-label={props.showPassword ? t("common.hide_password") : t("common.show_password")}
          >
            {props.showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {props.masterPwdWarning && (
        <div
          data-testid="unpack-master-pwd-warning"
          className="rounded-lg border border-amber-400/50 bg-amber-500/15 p-3 text-xs text-amber-100 flex items-start gap-2"
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-300" />
          <div>
            <p className="font-semibold mb-1">
              {t("unpack.master_pwd_warning_title")}
            </p>
            <p className="text-amber-100/85">
              {t("unpack.master_pwd_warning_body")}
            </p>
          </div>
        </div>
      )}

      {props.error && !props.masterPwdWarning && (
        <div
          data-testid="unpack-error"
          className="rounded-lg border border-rose-400/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          {props.error}
        </div>
      )}
    </div>
  );
}

// ===== Stage 3 — Viewing =====
function ViewingStage(props: {
  t: (key: string) => string;
  files: PackageFile[];
  completion:
    | { mode: "folder"; count: number; folderName: string }
    | { mode: "zip"; fileName: string; count: number }
    | { mode: "single"; fileName: string }
    | null;
  onPreview: (f: PackageFile) => void;
  onDownloadOne: (f: PackageFile) => void;
  onDownloadAllZip: () => void;
  onDownloadAllToFolder: () => void;
}) {
  const { t } = props;
  const totalBytes = props.files.reduce((s, f) => s + f.bytes.byteLength, 0);
  const fsAccessAvailable = hasFsAccess();
  const supportsPreview = (path: string) => {
    const lower = path.toLowerCase();
    return (
      lower.endsWith(".pdf") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".svg") ||
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".csv") ||
      lower.endsWith(".json") ||
      lower.endsWith(".log")
    );
  };

  // Sjekk om noen filer har mappe-struktur — påvirker ZIP-knappens nytte
  const hasFolders = props.files.some((f) => f.path.includes("/"));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-white/70">
        <span className="font-semibold">
          {t("unpack.opened_prefix")} {props.files.length}{" "}
          {props.files.length === 1 ? t("unpack.count_file_singular") : t("unpack.count_file_plural")} ({formatBytes(totalBytes)})
        </span>
      </div>

      {/* PRIMÆR: Nedlasting-knapper øverst */}
      {props.files.length > 1 && (
        <div className="space-y-2">
          {/* Velg mappe — kun Chrome/Edge — PRIMÆR når tilgjengelig */}
          {fsAccessAvailable && (
            <button
              data-testid="unpack-download-to-folder-btn"
              onClick={props.onDownloadAllToFolder}
              className={`w-full h-11 rounded-xl ${T.primaryButton} text-white text-sm font-semibold transition flex items-center justify-center gap-2 px-3`}
              title={t("unpack.btn_pick_folder_title")}
            >
              <FolderOpen className="h-4 w-4" />
              <span className="truncate">
                {t("unpack.btn_pick_folder")}{hasFolders ? t("unpack.btn_pick_folder_struct_suffix") : ""}
              </span>
            </button>
          )}
          {/* ZIP — alltid tilgjengelig, fungerer overalt */}
          <button
            data-testid="unpack-download-all-zip-btn"
            onClick={props.onDownloadAllZip}
            className={`w-full h-11 rounded-xl text-white text-sm font-semibold transition flex items-center justify-center gap-2 px-3 ${
              fsAccessAvailable
                ? "bg-white/10 hover:bg-white/20 border border-white/20"
                : "bg-emerald-500 hover:bg-emerald-600"
            }`}
            title={
              hasFolders
                ? t("unpack.btn_zip_all_title_with_folders")
                : t("unpack.btn_zip_all_title")
            }
          >
            <Download className="h-4 w-4" />
            <span className="truncate">
              {t("unpack.btn_zip_all")}{hasFolders ? t("unpack.btn_zip_all_folders_suffix") : ""}
            </span>
          </button>
        </div>
      )}

      {/* Fil-liste — preview + valgfri enkeltfil-nedlasting */}
      <div className="rounded-lg border border-white/15 bg-black/20 divide-y divide-white/10 max-h-72 overflow-y-auto">
        {props.files.map((f, i) => {
          const canPreview = supportsPreview(f.path);
          return (
            <div
              key={`${f.path}-${i}`}
              data-testid={`unpack-file-row-${i}`}
              className="flex items-center gap-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs text-white/90 truncate font-mono"
                  title={f.path}
                >
                  {f.path}
                </p>
                <p className="text-[10px] text-white/50">
                  {formatBytes(f.bytes.byteLength)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {canPreview && (
                  <button
                    data-testid={`unpack-preview-${i}`}
                    onClick={() => props.onPreview(f)}
                    className="h-7 px-2 rounded-md bg-white/5 hover:bg-white/15 text-white/75 hover:text-white text-[11px] transition flex items-center gap-1"
                    aria-label={`${t("unpack.preview_aria_prefix")} ${f.path}`}
                  >
                    <Eye className="h-3 w-3" /> {t("unpack.btn_preview")}
                  </button>
                )}
                <button
                  data-testid={`unpack-download-${i}`}
                  onClick={() => props.onDownloadOne(f)}
                  className="h-7 px-2 rounded-md bg-white/5 hover:bg-white/15 text-white/75 hover:text-white text-[11px] transition flex items-center gap-1"
                  aria-label={`${t("unpack.download_aria_prefix")} ${f.path}`}
                  title={t("unpack.btn_download_one_title")}
                >
                  <Download className="h-3 w-3" /> {t("unpack.btn_download_one")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {props.completion && (
        <div
          data-testid={`unpack-completion-${props.completion.mode}`}
          className={`rounded-lg ${T.successBanner} p-3 flex items-start gap-2`}
        >
          <Check className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-300" />
          <div className="text-xs space-y-0.5 min-w-0 flex-1">
            <p className="font-semibold">
              {props.completion.mode === "folder"
                ? props.completion.count === 1
                    ? t("unpack.completion_folder_single")
                    : `${t("unpack.completion_folder_multi_prefix")} ${props.completion.count} ${t("unpack.completion_folder_multi_suffix")}`
                : props.completion.mode === "zip"
                  ? t("unpack.completion_zip")
                  : t("unpack.completion_single")}
            </p>
            <p className="text-emerald-100/80 font-mono truncate">
              {props.completion.mode === "folder"
                ? `${t("unpack.completion_folder_prefix")} ${props.completion.folderName}`
                : props.completion.fileName}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-amber-400/30 bg-amber-500/5 p-3 text-[11px] text-amber-100/85 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-300" />
        <span>
          {t("unpack.recipient_warning")}
        </span>
      </div>
    </div>
  );
}

// ===== Helper =====
function triggerDownload(filename: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Skriver en fil til en valgt mappe via File System Access API.
 * Bevarer mappe-struktur ved å lage subdirektorier på veien.
 */
async function writeFileToDirectory(
  root: FileSystemDirectoryHandle,
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const segments = filePath.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return;
  const fileName = segments.pop()!;
  let dir = root;
  for (const segment of segments) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const stream = await fileHandle.createWritable();
  await stream.write(bytes as BufferSource);
  await stream.close();
}
