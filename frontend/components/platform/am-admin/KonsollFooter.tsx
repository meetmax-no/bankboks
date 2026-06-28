"use client";
/**
 * Ko | Do · Vault — Iter 20.9 (D-086, 2026-06-27) — Konsoll Footer
 *
 * Crypto-detalj-strip nederst på Konsoll-shellet (alle faner) — matcher
 * footer-en i vault SettingsPanel (Mike-direktiv D-086 d=2, "generelt i
 * bunnen av hele Konsoll-shellet, alle faner").
 */
export function KonsollFooter() {
  return (
    <footer
      className="mt-8 mb-4 text-center text-[10px] font-mono text-white/30 tracking-wide select-none"
      data-testid="konsoll-footer"
    >
      Zero-knowledge · PBKDF2 600k · AES-256-GCM · Upstash Redis
    </footer>
  );
}
