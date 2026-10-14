import { useEffect, useMemo, useRef, useState } from "react";
import type { EECatalog, EELibrary, EEProject, EETemplateDef, EETemplateRef } from "@forge/contracts";
import {
  searchTemplateFields,
  instancesOfTemplate,
  stockTemplateNamed,
  templateFieldDoc,
  templateSections,
  TEMPLATE_SECTIONS,
  type FieldSpec,
  type TemplateSectionId,
} from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { DeckPlan } from "./DeckPlan.js";
import { FieldControl } from "./FieldControl.js";
import { optionsFor } from "./options.js";
import { ShipDiagram } from "./ShipDiagram.js";
import { ShipPreview } from "./ShipPreview.js";
import { ShipResources } from "./ShipResources.js";

/**
 * The ship-template form.
 *
 * Same machinery as the object inspector — descriptors from
 * `@forge/core/editor`, help text from the generated EE catalog — with
 * two differences: the sections and the pictures.
 *
 * A hull is specified in blocks, and a flat list of forty controls is a
 * worse tool than the same forty in five sections (Identity, Hull,
 * Movement, Weapons, Interior — `templateSections()`, derived from the
 * descriptors' own groups, so every property stays reachable). The
 * picture that explains a block sits **beside** that block, in its
 * section: firing arcs next to the weapons, the deck plan next to the
 * rooms and doors, the model and what it needs next to the hull. The
 * numeric controls stay: the pictures are a second way to read, and to
 * edit where they allow it, never the only one.
 *
 * "Search properties" moves the view to a field. It reads descriptors and
 * changes nothing in the document, the values or the selection.
 *
 * A **stock** hull renders through the very same descriptors, wrapped in a
 * disabled fieldset. Reading EE's Atlantis and editing your own has to be
 * the same shape or the copy button is a leap of faith; a second, prettier
 * read-only view would be a second thing to keep true.
 */
export function ShipInspector(): JSX.Element {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const selectedId = useEditor((s) => s.selectedTemplateId);
  const selectedStock = useEditor((s) => s.selectedStockTemplate);

  if (project === null) return <section className="panel" />;

  if (selectedStock !== null) {
    const stock = stockTemplateNamed(library, selectedStock);
    return stock === null ? (
      <section className="panel">
        <h2>{selectedStock}</h2>
        <p className="hint error">
          Not in the scanned install any more. Re-index it from Install… in the toolbar.
        </p>
      </section>
    ) : (
      <StockTemplate stock={stock} />
    );
  }

  const template = project.templates.find((t) => t.id === selectedId) ?? null;
  if (template === null) {
    return (
      <section className="panel">
        <h2>Template</h2>
        <p className="hint">
          Pick a template on the left, make one, or copy a ship out of the install.
        </p>
      </section>
    );
  }

  return <ProjectTemplate project={project} template={template} library={library} />;
}

/**
 * Sections + search + the section on show.
 *
 * `renderField` supplies the control for one descriptor (editable or inert); `extras` maps a descriptor group to
 * the picture that goes beside it.
 */
function SectionedForm({
  idPrefix,
  readOnly,
  catalog,
  renderField,
  extras,
}: {
  idPrefix: string;
  readOnly: boolean;
  catalog: EECatalog | null;
  renderField: (spec: FieldSpec) => JSX.Element;
  extras: Readonly<Record<string, JSX.Element>>;
}): JSX.Element {
  const section = useEditor((s) => s.shipSection);
  const setSection = useEditor((s) => s.setShipSection);
  const requested = useEditor((s) => s.shipJump);
  const clearJump = useEditor((s) => s.clearShipJump);
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => templateSections(), []);
  const matches = useMemo(() => searchTemplateFields(query, catalog), [query, catalog]);
  const searching = query.trim() !== "";
  const perSection = (id: TemplateSectionId): number => matches.filter((m) => m.section === id).length;
  const current = sections.find((s) => s.id === section) ?? sections[0]!;

  // A request from elsewhere (a problem that names this field): the section is already set, move to the field.
  useEffect(() => {
    if (requested === null) return;
    setJump(requested);
    clearJump();
  }, [requested, clearJump]);

  // Reaching a field = showing its section, then moving to it. Done after the render that shows the section, so the
  // field exists; a disabled (read-only) field cannot take the focus, so its row does.
  useEffect(() => {
    if (jump === null) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-field="${jump}"]`);
    if (row === null || row === undefined) return;
    row.scrollIntoView({ block: "center" });
    const control = row.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
    (control ?? row).focus();
    setFound(jump);
    setJump(null);
  }, [jump, section]);

  const reach = (key: string, target: TemplateSectionId): void => {
    setSection(target);
    setJump(key);
  };

  return (
    <div ref={root} className="ship-sectioned">
      <div className="ship-toolbar">
        <nav className="mission-tabs ship-tabs" aria-label="Ship sections">
          {TEMPLATE_SECTIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${section === t.id ? "active" : ""}${searching && perSection(t.id) === 0 ? " dim" : ""}`}
              aria-current={section === t.id ? "page" : undefined}
              onClick={() => setSection(t.id)}
            >
              {t.label}
              {searching && <span className="muted"> {perSection(t.id)}</span>}
            </button>
          ))}
        </nav>
        <div className="ship-search" role="search">
          <input
            type="search"
            aria-label="Search properties"
            placeholder="Search properties"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0] !== undefined) {
                e.preventDefault();
                reach(matches[0].spec.key, matches[0].section);
              }
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
        </div>
      </div>

      {searching && (
        <div className="ship-results" role="status" aria-live="polite">
          {matches.length === 0 ? (
            <p className="hint" data-testid="property-no-results">
              No property matches “{query.trim()}”. Try part of a field name, such as “radar” or “beam”, or{" "}
              <button type="button" className="small" onClick={() => setQuery("")}>
                clear the search
              </button>{" "}
              to see every section.
            </p>
          ) : (
            <>
              <p className="hint">
                {matches.length} {matches.length === 1 ? "property matches" : "properties match"}. Pick one to go to it.
              </p>
              <ul aria-label="Matching properties">
                {matches.map((m) => (
                  <li key={m.spec.key}>
                    <button type="button" className="row-link" onClick={() => reach(m.spec.key, m.section)}>
                      <strong>{m.spec.label}</strong>{" "}
                      <span className="muted">
                        {m.via === "help" ? "in the help text · " : ""}
                        {TEMPLATE_SECTIONS.find((s) => s.id === m.section)?.label}
                        {m.group !== "" && m.group !== TEMPLATE_SECTIONS.find((s) => s.id === m.section)?.label ? ` · ${m.group}` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="ship-section" data-section={current.id} id={`${idPrefix}-section-${current.id}`}>
        {current.blocks.map(([group, specs]) => {
          const extra = extras[group];
          return (
            <div key={group} className={extra === undefined ? "group-block" : "group-block with-picture"}>
              <fieldset disabled={readOnly}>
                <legend>{group}</legend>
                <div className="group-fields">
                {specs.map((spec) => (
                  <div key={spec.key} data-field={spec.key} data-widget={spec.widget} tabIndex={-1} className={`prop-row${found === spec.key ? " found" : ""}`} onBlur={() => found === spec.key && setFound(null)}>
                    {renderField(spec)}
                  </div>
                ))}
                </div>
              </fieldset>
              {extra !== undefined && <div className="group-picture">{extra}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One of the project's own templates: the editable form. */
function ProjectTemplate({
  project,
  template,
  library,
}: {
  project: EEProject;
  template: EETemplateDef;
  library: EELibrary | null;
}): JSX.Element {
  const catalog = useEditor((s) => s.catalog);
  const updateTemplate = useEditor((s) => s.updateTemplate);

  const set = (key: string, value: unknown): void =>
    updateTemplate(template.id, { [key]: value } as Partial<EETemplateDef>);

  /**
   * A template cannot copy itself, nor anything that already copies it —
   * the emitted `copy()` chains off the base's local, so a cycle has no
   * first line. The build refuses one; the picker simply does not offer it.
   */
  const copyableNames = (): readonly string[] => {
    const banned = new Set([template.name]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of project.templates) {
        if (t.copyOf !== null && banned.has(t.copyOf) && !banned.has(t.name)) {
          banned.add(t.name);
          grew = true;
        }
      }
    }
    return project.templates.map((t) => t.name).filter((name) => !banned.has(name));
  };

  // Redefining a stock name is legal and occasionally exactly right — it
  // is how you retune the Atlantis your campaign flies without touching
  // the install. It is also loud and far-reaching, so it is said out loud.
  const shadows = stockTemplateNamed(library, template.name);

  const value = (spec: FieldSpec): unknown => (template as unknown as Record<string, unknown>)[spec.key];
  const target = project.eeVersion;

  return (
    <section className="panel ship-form" aria-label={`Template ${template.name}`}>
      <div className="ship-head">
        <h2>
          {template.name} <span className="muted">{template.id}</span>
        </h2>
        <span className="origin-badge project" title="Saved in this project; this is the copy the generated scenario uses.">
          Project template
        </span>
      </div>
      {shadows !== null && (
        <p className="banner warn">
          Redefines the original ship <strong>{shadows.name}</strong> ({shadows.sourceFile}).
          EmptyEpsilon accepts it — the last definition wins, so every scenario that spawns
          this name gets your values — but it logs{" "}
          <code>ERROR: Duplicate ship template definition: {shadows.name}</code> at launch.
        </p>
      )}
      <SectionedForm
        idPrefix={template.id}
        readOnly={false}
        catalog={catalog}
        renderField={(spec) => (
          <Field
            spec={spec}
            value={value(spec)}
            catalog={catalog}
            options={spec.key === "copyOf" ? copyableNames() : optionsFor(spec, project, library)}
            onChange={(next) => set(spec.key, next)}
          />
        )}
        extras={{
          Hull: (
            <>
              <ShipResources template={template} library={library} target={target} />
              <ShipPreview template={template} templates={project.templates} library={library} target={target} />
            </>
          ),
          Weapons: <ShipDiagram template={template} />,
          "Deck plan": <DeckPlan template={template} />,
        }}
      />
    </section>
  );
}

/**
 * A hull the install declares, shown read-only with the button that brings
 * it into the project.
 *
 * The copy is a full materialisation, not a `copy()`: EE exposes no
 * `getShipTemplate()`, so nothing in a generated file could chain off a
 * stock template even if we wanted it to (ADR-0041).
 */
function StockTemplate({ stock }: { stock: EETemplateRef }): JSX.Element {
  const project = useEditor((s) => s.project);
  const catalog = useEditor((s) => s.catalog);
  const library = useEditor((s) => s.library);
  const copyStockTemplate = useEditor((s) => s.copyStockTemplate);

  // `copyOf` and `id` belong to a project document; a stock hull has
  // neither, and offering them would suggest EE can copy one. It cannot.
  const hidden = (spec: FieldSpec): boolean => spec.key === "copyOf";
  const asTemplate: EETemplateDef = { ...stock, id: stock.name, copyOf: null };
  const target = library?.eeVersion ?? project?.eeVersion ?? "";
  const flying = project === null ? 0 : instanceCount(project, stock.name);

  return (
    <section className="panel ship-form stock" aria-label={`Original ship ${stock.name}`}>
      <div className="ship-head">
        <h2>
          {stock.name} <span className="muted">from the install</span>
        </h2>
        <span className="origin-badge stock" title="Read from the EmptyEpsilon install. It cannot be edited here; copy it to change it.">
          Original · read-only
        </span>
      </div>
      <p className="banner">
        <code>{stock.sourceFile}</code>
        {library !== null && <> in the {library.eeVersion} install</>}
        {stock.copiedFrom !== null && (
          <>
            {" — "}EE writes it as a variant of <strong>{stock.copiedFrom}</strong>, already
            resolved here.
          </>
        )}
        {stock.hidden && <> — hidden from EE&apos;s own pickers.</>}
      </p>
      <button
        type="button"
        className="primary"
        disabled={project === null}
        onClick={() => copyStockTemplate(stock.name)}
      >
        Copy into project
      </button>
      <p className="hint">
        Creates a template of your own holding every value below; the original stays as the install
        has it. EmptyEpsilon cannot copy one of its own hulls at runtime, so this is the only way to
        start from one — and the copy loads at launch, which means restarting EE after the build.
        {flying > 0 && (
          <>
            {" "}
            {flying} map object(s) spawn “{stock.name}”: copying does not move them — you will be asked, with the list.
          </>
        )}
      </p>
      <SectionedForm
        idPrefix={`stock-${stock.name}`}
        readOnly
        catalog={catalog}
        renderField={(spec) =>
          hidden(spec) ? (
            <div className="muted">Not applicable to an original ship.</div>
          ) : (
            <Field
              spec={spec}
              value={(stock as unknown as Record<string, unknown>)[spec.key]}
              catalog={catalog}
              options={optionsFor(spec, project, library)}
              onChange={() => undefined}
            />
          )
        }
        extras={{
          Hull: (
            <>
              <ShipResources template={stock} library={library} target={target} ownModels={false} />
              <ShipPreview template={asTemplate} templates={project?.templates ?? []} library={library} target={target} />
            </>
          ),
          Weapons: <ShipDiagram template={asTemplate} />,
          "Deck plan": <DeckPlan template={asTemplate} readOnly />,
        }}
      />
    </section>
  );
}

function instanceCount(project: EEProject, name: string): number {
  return instancesOfTemplate(project, name).length;
}

function Field({
  spec,
  value,
  catalog,
  options,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  catalog: EECatalog | null;
  options: readonly string[] | null;
  onChange: (value: unknown) => void;
}): JSX.Element {
  const doc = catalog === null ? spec.hint ?? null : templateFieldDoc(catalog, spec);
  return (
    <div className="field" title={doc ?? undefined}>
      <label>
        {spec.label}
        {doc !== null && <span className="doc-dot">?</span>}
      </label>
      <FieldControl spec={spec} value={value} options={options} onChange={onChange} />
    </div>
  );
}
