/**
 * Farge-palett-utforsker (kun for designer-bruk).
 * Ikke linket fra noen sted i appen — gå til /colors manuelt.
 *
 * Viser:
 *   - Hovedaksent-kandidater (blue, sky, emerald, teal, cyan, indigo, violet, amber, rose)
 *   - Hver med 6 nyanser (300, 400, 500 + tilsvarende /15-bg + /40-border)
 *   - Header-knapp-mockup i ulike farger så Mike kan klikke gjennom
 *   - Krypter-knapp-mockup
 */
"use client";

import { useState } from "react";
import { Check, FlaskConical, Lock, Package, Settings } from "lucide-react";

type Palette = {
  name: string;
  key: string;
  // Tailwind klasse-fragmenter. Format: { base: "blue", note?: string }
  note?: string;
};

const PALETTES: Palette[] = [
  { name: "Blue (nåværende app-default)", key: "blue", note: "Brukes i Backup, Biometric, EntryModal, ConfirmDialog" },
  { name: "Sky", key: "sky", note: "Lysere/cyan-aktig blå" },
  { name: "Cyan", key: "cyan", note: "Mer grønn-blå" },
  { name: "Teal", key: "teal", note: "Grønn-blå hybrid" },
  { name: "Emerald (nåværende pakker)", key: "emerald", note: "Brukes nå i Pakker-feature + Card-kamera" },
  { name: "Indigo", key: "indigo", note: "Mørkere blå mot lilla" },
  { name: "Violet", key: "violet", note: "Lilla — matcher Password Lab" },
  { name: "Purple", key: "purple", note: "Litt rødere lilla" },
  { name: "Fuchsia", key: "fuchsia", note: "Rosa-lilla" },
  { name: "Amber", key: "amber", note: "Nåværende clipboard-warning" },
  { name: "Orange", key: "orange", note: "Sterkere oransje" },
  { name: "Rose", key: "rose", note: "Brukes for feilmeldinger" },
];

export default function ColorsPage() {
  const [selected, setSelected] = useState<string>("blue");

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Farge-palett-utforsker</h1>
          <p className="text-sm text-white/60">
            Klikk på en farge under for å se mock-up av hvordan headeren og «Krypter»-knappen
            ville sett ut med den fargen. Ingen endringer lagres — kun visuell sammenligning.
          </p>
          <p className="text-xs text-amber-200/80">
            Denne sida er bare en sandkasse. Gå tilbake til <code>/</code> for selve appen.
          </p>
        </header>

        {/* Palett-grid */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tilgjengelige farge-familier</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {PALETTES.map((p) => (
              <button
                key={p.key}
                onClick={() => setSelected(p.key)}
                className={`text-left rounded-xl border p-3 transition ${
                  selected === p.key
                    ? "border-white/60 bg-white/10"
                    : "border-white/15 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  {selected === p.key && <Check className="h-4 w-4 text-emerald-300" />}
                </div>
                <div className="flex gap-1">
                  <Swatch palette={p.key} shade={300} />
                  <Swatch palette={p.key} shade={400} />
                  <Swatch palette={p.key} shade={500} />
                  <Swatch palette={p.key} shade={600} />
                  <Swatch palette={p.key} shade={700} />
                </div>
                {p.note && (
                  <p className="text-[10px] text-white/50 mt-2 leading-tight">{p.note}</p>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Header mock-up */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Header-knapper med <span className="text-emerald-300">{selected}</span> som accent</h2>
          <p className="text-xs text-white/55">
            Slik vil knappene se ut på hover hvis vi bruker valgt farge som universell accent.
          </p>
          <div className="rounded-2xl border border-white/15 bg-slate-800/60 p-4 flex items-center gap-2">
            <HeaderBtn icon={<FlaskConical className="h-4 w-4" />} accent={selected} label="Lab" />
            <HeaderBtn icon={<Package className="h-4 w-4" />} accent={selected} label="Pakker" />
            <HeaderBtn icon={<Settings className="h-4 w-4" />} accent={selected} label="Innst." />
            <HeaderBtn icon={<Lock className="h-4 w-4" />} accent={selected} label="Lås" wider />
          </div>
          <p className="text-[11px] text-white/45">
            Standard er <code>bg-white/10</code> + <code>hover:bg-{selected}-300/15</code> +{" "}
            <code>hover:text-{selected}-200</code>
          </p>
        </section>

        {/* Primær knapp-mockup */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Primær handlings-knapp («Krypter og last ned»)</h2>
          <div className="rounded-2xl border border-white/15 bg-slate-800/60 p-4 flex flex-wrap items-center gap-3">
            <PrimaryBtn accent={selected} label="Krypter og last ned" />
            <PrimaryBtn accent={selected} label="Velg mappe og lagre alle" />
            <PrimaryBtn accent={selected} label="Pakk ut" />
          </div>
          <p className="text-[11px] text-white/45">
            <code>bg-{selected}-500 hover:bg-{selected}-600</code>
          </p>
        </section>

        {/* Tekst-aksent mock-up */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tekst- og link-aksent</h2>
          <div className="rounded-2xl border border-white/15 bg-slate-800/60 p-4 space-y-2">
            <p className="text-sm">
              Inline-link: <a className={`text-${selected}-300 hover:text-${selected}-200 underline transition`}>
                Generer sterkt passord
              </a>
            </p>
            <p className="text-sm">
              Suksess-banner-stil:
            </p>
            <div className={`rounded-lg border border-${selected}-400/50 bg-${selected}-500/15 p-3 flex items-start gap-2 text-xs`}>
              <Check className={`h-4 w-4 flex-shrink-0 mt-0.5 text-${selected}-300`} />
              <p className={`text-${selected}-100`}>
                <strong>Den krypterte pakken er lastet ned.</strong> hoppeslott.kodoenc
              </p>
            </div>
          </div>
        </section>

        {/* Sammenligningstabell */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Hvordan resten av appen ser ut nå</h2>
          <ul className="text-sm text-white/75 space-y-1.5 list-disc list-inside">
            <li><span className="text-blue-300 font-mono">blue</span> — Backup, Biometric, EntryModal, ConfirmDialog, CardModal-edit (default primær-aksjon)</li>
            <li><span className="text-emerald-300 font-mono">emerald</span> — CardCamera/Cropper «Lagre», Pakker-feature (nytt i v4.0)</li>
            <li><span className="text-amber-300 font-mono">amber</span> — Clipboard-clear-knappen i header (warning-aksent)</li>
            <li><span className="text-rose-300 font-mono">rose</span> — Feilmeldinger, slett-bekreftelser</li>
            <li><span className="text-violet-300 font-mono">violet/indigo</span> — Password-Lab-modal (interne knapper og tabs)</li>
          </ul>
        </section>

        {/* Konsistens-rapport */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">⚠️ Inkonsistens-rapport (per modul)</h2>
          <p className="text-xs text-white/55">
            Mike sin observasjon stemmer: passord-modulen og bankkort-modulen bruker
            forskjellige farge-paletter i dag.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/15 bg-slate-800/60 p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Passord-modul</h3>
              <ul className="text-xs text-white/70 space-y-1">
                <li>🟦 <span className="text-blue-300">blue-500/600</span> — Lagre / primær</li>
                <li>🟥 <span className="text-rose-300">rose-500/600</span> — Slett</li>
                <li>🟩 <span className="text-emerald-300">emerald-400</span> — 1 sted (suksess)</li>
              </ul>
              <p className="text-[11px] text-emerald-300/80 mt-2">Konsistent. 2 farger.</p>
            </div>
            <div className="rounded-xl border border-amber-400/40 bg-amber-500/5 p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Bankkort-modul</h3>
              <ul className="text-xs text-white/70 space-y-1">
                <li>🟦 <span className="text-blue-300">blue-500/600</span> — Lagre / Edit</li>
                <li>🟩 <span className="text-emerald-300">emerald-500/600</span> — Kamera / Lagre-kort</li>
                <li>🟪 <span className="text-violet-300">violet-500/600</span> — Vis / preview</li>
                <li>🟧 <span className="text-amber-300">amber-400/500</span> — Egenskaper</li>
                <li>🟥 <span className="text-rose-300">rose-500/600</span> — Slett</li>
              </ul>
              <p className="text-[11px] text-rose-300/80 mt-2">⚠️ 5 farger — bør ryddes opp.</p>
            </div>
          </div>
        </section>

        {/* Forslag */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">📐 Forslag til universell palett (B-modellen)</h2>
          <p className="text-xs text-white/55">
            Hvis vi går for per-feature-koding, men gjennomført på tvers av alle moduler:
          </p>
          <div className="rounded-xl border border-white/15 bg-slate-800/60 p-4">
            <table className="w-full text-xs">
              <thead className="text-white/55 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="text-left py-1.5 pr-3">Rolle</th>
                  <th className="text-left py-1.5 pr-3">Farge</th>
                  <th className="text-left py-1.5">Brukes til</th>
                </tr>
              </thead>
              <tbody className="text-white/85">
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold">Primær</td>
                  <td className="py-2 pr-3"><span className="inline-block w-4 h-4 rounded bg-blue-500 mr-1.5 align-middle" /> blue</td>
                  <td className="py-2">Lagre, Edit, OK, Lås — overalt</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold">Pakker</td>
                  <td className="py-2 pr-3"><span className="inline-block w-4 h-4 rounded bg-emerald-500 mr-1.5 align-middle" /> emerald</td>
                  <td className="py-2">Hele Pakker-featuren (alle stages, banners, header-knapp)</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold">Lab</td>
                  <td className="py-2 pr-3"><span className="inline-block w-4 h-4 rounded bg-violet-500 mr-1.5 align-middle" /> violet</td>
                  <td className="py-2">Password-Lab-modal + header-knapp (hover)</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold">Warning</td>
                  <td className="py-2 pr-3"><span className="inline-block w-4 h-4 rounded bg-amber-500 mr-1.5 align-middle" /> amber</td>
                  <td className="py-2">Clipboard-clear, advarsels-bannere, OBS-info</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="py-2 pr-3 font-semibold">Slett / Feil</td>
                  <td className="py-2 pr-3"><span className="inline-block w-4 h-4 rounded bg-rose-500 mr-1.5 align-middle" /> rose</td>
                  <td className="py-2">Slett-knapper, feilmeldinger, brudd-varsler</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-white/55">
            Med dette mønsteret må vi: <strong>(1)</strong> fjerne violet og amber fra
            bankkort-modulen (de er ikke Lab eller warning der), <strong>(2)</strong> samle
            emerald fra spredte steder til kun Pakker-feature, <strong>(3)</strong> sørge for
            at alle header-knappene har hover-farge.
          </p>
        </section>

        <p className="text-xs text-white/40 pt-4 border-t border-white/10">
          Når du har bestemt deg: si fra hvilken farge du vil bruke som <em>universell</em>{" "}
          aksent (én farge for alt) eller behold <em>per-feature</em>-mønster (Pakker=X,
          Lab=lilla, Clipboard=amber, resten=blå).
        </p>
      </div>
    </div>
  );
}

function Swatch(props: { palette: string; shade: number }) {
  // Hardcoded class-strings så Tailwind PurgeCSS faktisk inkluderer dem
  const cls = `flex-1 h-6 rounded bg-${props.palette}-${props.shade}`;
  return <div className={cls} title={`${props.palette}-${props.shade}`} />;
}

function HeaderBtn(props: { icon: React.ReactNode; accent: string; label: string; wider?: boolean }) {
  const base = "h-10 flex items-center justify-center rounded-full bg-white/10 border border-white/20 text-white/85 transition gap-1.5 text-sm font-medium";
  // Hardcoded variants — Tailwind PurgeCSS plukker dem opp
  const accentMap: Record<string, string> = {
    blue: "hover:bg-blue-300/15 hover:border-blue-300/40 hover:text-blue-200",
    sky: "hover:bg-sky-300/15 hover:border-sky-300/40 hover:text-sky-200",
    cyan: "hover:bg-cyan-300/15 hover:border-cyan-300/40 hover:text-cyan-200",
    teal: "hover:bg-teal-300/15 hover:border-teal-300/40 hover:text-teal-200",
    emerald: "hover:bg-emerald-300/15 hover:border-emerald-300/40 hover:text-emerald-200",
    indigo: "hover:bg-indigo-300/15 hover:border-indigo-300/40 hover:text-indigo-200",
    violet: "hover:bg-violet-300/15 hover:border-violet-300/40 hover:text-violet-200",
    purple: "hover:bg-purple-300/15 hover:border-purple-300/40 hover:text-purple-200",
    fuchsia: "hover:bg-fuchsia-300/15 hover:border-fuchsia-300/40 hover:text-fuchsia-200",
    amber: "hover:bg-amber-300/15 hover:border-amber-300/40 hover:text-amber-200",
    orange: "hover:bg-orange-300/15 hover:border-orange-300/40 hover:text-orange-200",
    rose: "hover:bg-rose-300/15 hover:border-rose-300/40 hover:text-rose-200",
  };
  const hover = accentMap[props.accent] || accentMap.blue;
  return (
    <button className={`${base} ${hover} ${props.wider ? "px-4" : "w-10"}`} title={props.label}>
      {props.icon}
      {props.wider && <span>{props.label}</span>}
    </button>
  );
}

function PrimaryBtn(props: { accent: string; label: string }) {
  const map: Record<string, string> = {
    blue: "bg-blue-500 hover:bg-blue-600",
    sky: "bg-sky-500 hover:bg-sky-600",
    cyan: "bg-cyan-500 hover:bg-cyan-600",
    teal: "bg-teal-500 hover:bg-teal-600",
    emerald: "bg-emerald-500 hover:bg-emerald-600",
    indigo: "bg-indigo-500 hover:bg-indigo-600",
    violet: "bg-violet-500 hover:bg-violet-600",
    purple: "bg-purple-500 hover:bg-purple-600",
    fuchsia: "bg-fuchsia-500 hover:bg-fuchsia-600",
    amber: "bg-amber-500 hover:bg-amber-600",
    orange: "bg-orange-500 hover:bg-orange-600",
    rose: "bg-rose-500 hover:bg-rose-600",
  };
  const cls = map[props.accent] || map.blue;
  return (
    <button className={`${cls} h-10 px-5 rounded-full text-white text-sm font-semibold transition shadow`}>
      {props.label}
    </button>
  );
}
