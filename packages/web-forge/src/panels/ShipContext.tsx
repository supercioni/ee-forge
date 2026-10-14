import { useState } from "react";
import { instancesOfTemplate, stockTemplateNamed } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";

const SHOWN = 8;

/**
 * Where the selected hull is used.
 *
 * Three things are kept apart on purpose, because they were one list before and the difference is what an author
 * needs: the **original** in the install (read-only), the project's **own template** (what the scenario is built
 * from), and the **map objects** that spawn a template by name. Everything here is derived from the project every
 * time — there is no list to fall out of date — and each object is a button that goes to it on the map, with a way
 * back to this view.
 */
export function ShipContext(): JSX.Element {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const selectedId = useEditor((s) => s.selectedTemplateId);
  const selectedStock = useEditor((s) => s.selectedStockTemplate);
  const selectTemplate = useEditor((s) => s.selectTemplate);
  const selectStock = useEditor((s) => s.selectStockTemplate);
  const openInstance = useEditor((s) => s.openInstance);
  const [all, setAll] = useState(false);

  const own = project?.templates.find((t) => t.id === selectedId) ?? null;
  const name = own?.name ?? selectedStock;
  if (project === null || name === null) {
    return (
      <section className="panel ship-context">
        <h2>Used by</h2>
        <p className="hint">Select a template to see which map objects spawn it.</p>
      </section>
    );
  }

  const instances = instancesOfTemplate(project, name);
  const shown = all ? instances : instances.slice(0, SHOWN);
  const variants = own === null ? [] : project.templates.filter((t) => t.copyOf === own.name);
  const redefinedBy = own === null ? [] : project.templates.filter((t) => t.id !== own.id && t.name === own.name);
  const shadowed = own === null ? null : stockTemplateNamed(library, own.name);
  const overriding = selectedStock === null ? [] : project.templates.filter((t) => t.name === selectedStock);

  return (
    <section className="panel ship-context" aria-label="Used by">
      <h2>
        Used by <span className="muted">{instances.length}</span>
      </h2>
      <p className="hint">
        {own === null
          ? `Map objects spawn an original ship by its name, “${name}”. The original itself is never changed from here.`
          : `Map objects spawn this template by its name, “${name}”.`}
      </p>
      {instances.length === 0 ? (
        <p className="hint" data-testid="no-instances">
          No map object spawns “{name}” yet. Place a ship or station on the map and choose it in the object&apos;s inspector.
        </p>
      ) : (
        <ul className="used-by-list" aria-label={`Map objects using ${name}`}>
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="row-link"
                title="Show it on the map; Back returns here"
                aria-label={`Open ${i.callsign ?? i.id} on the map (${i.type}, group ${i.groupLabel})`}
                onClick={() => openInstance(i.id, { view: "ship", label: "Fleet" })}
              >
                {i.callsign ?? i.id}
              </button>
              <span className="muted">
                {" "}
                {i.type} · {i.groupLabel}
              </span>
            </li>
          ))}
        </ul>
      )}
      {instances.length > SHOWN && (
        <button type="button" className="small" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${instances.length}`}
        </button>
      )}

      {variants.length > 0 && (
        <>
          <h3 className="scene-subhead">Variants of this template</h3>
          <ul className="used-by-list" aria-label="Variants">
            {variants.map((v) => (
              <li key={v.id}>
                <button type="button" className="row-link" onClick={() => selectTemplate(v.id)}>
                  {v.name}
                </button>
                <span className="muted"> copies “{name}”</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {shadowed !== null && (
        <>
          <h3 className="scene-subhead">Original</h3>
          <p className="hint">
            The install also declares “{name}”.{" "}
            <button type="button" className="row-link" onClick={() => selectStock(name)}>
              Read the original
            </button>
          </p>
        </>
      )}
      {(overriding.length > 0 || redefinedBy.length > 0) && (
        <>
          <h3 className="scene-subhead">Project definition</h3>
          <ul className="used-by-list">
            {[...overriding, ...redefinedBy].map((t) => (
              <li key={t.id}>
                <button type="button" className="row-link" onClick={() => selectTemplate(t.id)}>
                  {t.name}
                </button>
                <span className="muted"> redefines the original in this project</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
