import { useMemo, useState } from "react";
import type { EETemplateRef } from "@forge/contracts";
import { useEditor } from "../store/editor.js";

/**
 * Every ship EmptyEpsilon already has.
 *
 * The install declares 168 of them across 13 files and offers no way to
 * enumerate them at runtime — no `getAllTemplateNames()` reaches Lua — so
 * this list is the scanned library (ADR-0034), now read whole rather than
 * by name (ADR-0041). Seeing them is half the point; the other half is the
 * Copy button in the inspector, which materialises one into the project.
 *
 * `hidden()` templates are out by default, matching what EE does in its own
 * ship picker, with a checkbox because a scenario can still spawn one by
 * name and an author looking for it should not conclude it is gone.
 */
export function StockTemplateList(): JSX.Element {
  const library = useEditor((s) => s.library);
  const installLabel = useEditor((s) => s.libraryInstall?.label);
  const selected = useEditor((s) => s.selectedStockTemplate);
  const selectStock = useEditor((s) => s.selectStockTemplate);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matches = (t: EETemplateRef): boolean => {
      if (t.hidden && !showHidden) return false;
      if (needle === "") return true;
      // Name and class, because "corvette" is how an author looks for a
      // hull whose name they do not remember.
      return [t.name, t.className, t.subclassName]
        .filter((s): s is string => s !== null)
        .some((s) => s.toLowerCase().includes(needle));
    };
    const found = (library?.templates ?? []).filter(matches);
    return [
      ["Player ships", found.filter((t) => t.kind === "playership")],
      ["Ships", found.filter((t) => t.kind === "ship")],
      ["Stations", found.filter((t) => t.kind === "station")],
    ] as const;
  }, [library, filter, showHidden]);

  if (library === null) {
    return (
      <section className="panel">
        <h2>Original ships</h2>
        <p className="hint">
          No install indexed yet. Register an EmptyEpsilon install (Install… or Installations… in the toolbar) and rescan.
        </p>
      </section>
    );
  }

  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <section className="panel stock-list">
      <h2>
        Original ships <span className="muted">{library.templates.length}</span>
      </h2>
      <p className="hint">
        Read-only, from {installLabel ?? `the ${library.eeVersion} install`} ({library.eeVersion}, {library.installPath}). Copy one to change it.
      </p>
      <input
        aria-label="Filter original ships"
        placeholder="filter by name or class"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
        />
        show hidden
      </label>
      {groups.map(([label, list]) =>
        list.length === 0 ? null : (
          <div key={label}>
            <h3>
              {label} <span className="muted">{list.length}</span>
            </h3>
            <ul className="template-list">
              {list.map((t) => (
                <li key={t.name} className={t.name === selected ? "selected" : ""}>
                  <button type="button" className="row" onClick={() => selectStock(t.name)}>
                    <span>{t.name}</span>
                    <span className="muted">{t.className ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
      {shown === 0 && <p className="hint">Nothing matches.</p>}
    </section>
  );
}
