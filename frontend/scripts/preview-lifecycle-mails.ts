/**
 * Render lifecycle-mail templates lokalt for preview-verifisering.
 * Ingen Resend-kall — bare loadTemplate + dump til stdout.
 *
 * Kjør: tsx scripts/preview-lifecycle-mails.ts
 */
import { promises as fs } from "node:fs";
import path from "node:path";

async function loadTpl(name: string, locale: "no" | "en", vars: Record<string, string>) {
  const file = path.join(process.cwd(), "lib", "platform", "email-templates", `${name}.${locale}.html`);
  let html = await fs.readFile(file, "utf8");
  for (const [k, v] of Object.entries(vars)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }
  return html;
}

function fmt(d: Date, locale: "no" | "en") {
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "nb-NO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function extractText(html: string, marker: string, maxChars = 400): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return `(marker '${marker}' ikke funnet)`;
  // Hent nærmeste <p>...<p> rundt
  const start = html.lastIndexOf("<p ", idx);
  const end = html.indexOf("</p>", idx);
  const block = html.slice(start, end + 4);
  // Strip HTML-tags
  const text = block
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, maxChars);
}

async function main() {
  const now = new Date();
  const deleteDate28 = new Date(now);
  deleteDate28.setUTCDate(deleteDate28.getUTCDate() + 28);
  const trialEnds5 = new Date(now);
  trialEnds5.setUTCDate(trialEnds5.getUTCDate() + 5);
  const lockedAt = new Date(now);
  lockedAt.setUTCDate(lockedAt.getUTCDate() - 21); // dag 21 etter lock

  console.log("=== Render-verifisering — alle 5 maler, NO+EN ===\n");
  console.log(`Beregnet deleteDate (now+28d):  ${fmt(deleteDate28, "no")}`);
  console.log(`Beregnet trialEndsAt (now+5d):  ${fmt(trialEnds5, "no")}`);
  console.log(`Simulert lockedAt (now-21d):    ${fmt(lockedAt, "no")}`);
  console.log();

  // ── A2 locked-from-trial ────────────────────────────────────────
  for (const lang of ["no", "en"] as const) {
    const html = await loadTpl("locked-from-trial", lang, {
      firstName: lang === "en" ? "Alice" : "Alice",
      subdomain: "alice",
      deleteDate: fmt(deleteDate28, lang),
    });
    console.log(`── A2 locked-from-trial (${lang}) ──`);
    console.log("Brødtekst-1:", extractText(html, "midlertidig"));
    console.log("Brødtekst-1 (en):", extractText(html, "temporarily"));
    console.log("Info-blokk:", extractText(html, "påminnelse"));
    console.log("Info-blokk (en):", extractText(html, "reminder"));
    console.log();
  }

  // ── B1 locked-from-cancel ───────────────────────────────────────
  for (const lang of ["no", "en"] as const) {
    const html = await loadTpl("locked-from-cancel", lang, {
      firstName: "Bob",
      subdomain: "bob",
      deleteDate: fmt(deleteDate28, lang),
    });
    console.log(`── B1 locked-from-cancel (${lang}) ──`);
    console.log("Brødtekst-1:", extractText(html, "Takk for"));
    console.log("Brødtekst-1 (en):", extractText(html, "Thank you"));
    console.log("Info-blokk:", extractText(html, "påminnelse"));
    console.log("Info-blokk (en):", extractText(html, "reminder"));
    console.log();
  }

  // ── A3 lifecycle-warning — TO varianter ─────────────────────────
  const reasonTextTrial = {
    no: `Prøveperioden din utløp ${fmt(lockedAt, "no")} og kontoen ble låst.`,
    en: `Your trial ended on ${fmt(lockedAt, "en")} and the account was locked.`,
  };
  const reasonTextCancel = {
    no: `Abonnementet ditt ble kansellert ${fmt(lockedAt, "no")} og kontoen ble låst.`,
    en: `Your subscription was cancelled on ${fmt(lockedAt, "en")} and the account was locked.`,
  };

  for (const lang of ["no", "en"] as const) {
    for (const variant of ["trial", "cancel"] as const) {
      const html = await loadTpl("lifecycle-warning", lang, {
        firstName: "Carol",
        subdomain: "carol",
        daysLeft: "7",
        dayWord: lang === "en" ? "days" : "dager",
        lockedAt: fmt(lockedAt, lang),
        deleteDate: fmt(deleteDate28, lang),
        reasonText: variant === "trial" ? reasonTextTrial[lang] : reasonTextCancel[lang],
      });
      console.log(`── A3 lifecycle-warning (${lang}, variant=${variant}) ──`);
      console.log("Brødtekst:", extractText(html, "reasonText" /*fallback*/) || "");
      const marker = variant === "trial"
        ? (lang === "en" ? "trial ended" : "Prøveperioden")
        : (lang === "en" ? "subscription was cancelled" : "Abonnementet ditt");
      console.log("Brødtekst:", extractText(html, marker));
      console.log();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
