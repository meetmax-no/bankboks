"use client";

/**
 * Ko | Do · Vault — D-108 (2026-06-28) — SubTabNav
 *
 * Gjenbrukbar nivå-2 under-tab-navigasjon for modaler med mange
 * under-kategorier. Kanonisk implementasjon per D-105 (anti-duplisering).
 *
 * Bruksmønster:
 *   const [sub, setSub] = useState<SubId>("a");
 *   <SubTabNav
 *     items={[
 *       { id: "a", label: "Første", show: true },
 *       { id: "b", label: "Andre", show: isB2B },
 *     ]}
 *     active={sub}
 *     onChange={setSub}
 *     testIdPrefix="my-modal-subtab"
 *   />
 *
 * Stil-prinsipper:
 *   - Pille-form (rounded-lg), kompakt høyde (py-1.5)
 *   - Aktiv = blå-bakgrunn + blå-tekst + blå-kant
 *   - Inaktiv = transparent kant, hover = subtil bakgrunn
 *   - Gap-1 mellom tabs
 *   - margin-bottom 5 (mb-5) som default-spacing før innholdet
 */

export type SubTabItem<TId extends string> = {
  id: TId;
  label: string;
  show: boolean;
};

export function SubTabNav<TId extends string>({
  items,
  active,
  onChange,
  testIdPrefix,
  className = "",
}: {
  items: SubTabItem<TId>[];
  active: TId;
  onChange: (id: TId) => void;
  testIdPrefix: string;
  className?: string;
}) {
  return (
    <div
      data-testid={`${testIdPrefix}-nav`}
      className={`flex gap-1 mb-5 ${className}`}
    >
      {items
        .filter((it) => it.show)
        .map((it) => {
          const isActive = active === it.id;
          return (
            <button
              key={it.id}
              type="button"
              data-testid={`${testIdPrefix}-${it.id}`}
              onClick={() => onChange(it.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition ${
                isActive
                  ? "bg-blue-500/15 text-blue-200 border border-blue-400/40"
                  : "text-white/55 hover:text-white/85 hover:bg-white/5 border border-transparent"
              }`}
            >
              {it.label}
            </button>
          );
        })}
    </div>
  );
}
