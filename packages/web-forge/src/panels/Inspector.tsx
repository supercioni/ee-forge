import type { EEMarker, EEObject, EEProject } from "@forge/contracts";
import { blockOfObject, describeBlock, firstBlock, sectorLabel, SHARED_LABEL, findReferences, fieldDoc, sectionedFields, type FieldSection } from "@forge/core/editor";
import { useEffect, useState } from "react";
import { checkMarkerId, checkObjectId, describeIdProblem } from "@forge/core/editor";
import { useEditor } from "../store/editor.js";
import { FieldControl } from "./FieldControl.js";
import { UsedBy } from "./UsedBy.js";
import { optionsFor } from "./options.js";
import { objectTypeLabel } from "../ui/glossary.js";
import { NumberInput } from "../ui/NumberInput.js";
import { EyeOffIcon, LockIcon } from "../ui/icons.js";

/**
 * Property inspector.
 *
 * Fields come from `@forge/core`'s descriptors — one table, shared
 * with the tests that assert it covers every key in the project schema —
 * and each control's help text comes from the generated EE catalog. So the
 * tooltip on "Radius" is EmptyEpsilon's own prose for
 * `Planet:setPlanetRadius`, not something an editor author paraphrased.
 */
export function Inspector(): JSX.Element {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const markerSelection = useEditor((s) => s.markerSelection);
  const catalog = useEditor((s) => s.catalog);
  const library = useEditor((s) => s.library);
  const updateObject = useEditor((s) => s.updateObject);
  const viewPrefs = useEditor((s) => s.viewPrefs);
  const toggleGroupLocked = useEditor((s) => s.toggleGroupLocked);
  const toggleGroupHidden = useEditor((s) => s.toggleGroupHidden);

  if (project === null) return <section className="panel" />;

  const objects = project.map.groups.flatMap((g) => g.objects);
  const selected = objects.filter((o) => selection.includes(o.id));
  const markers = project.map.markers.filter((m) => markerSelection.includes(m.id));
  const multiBlock = selected.length > 1 ? firstBlock(project, viewPrefs, selected.map((o) => o.id)) : null;

  // Markers first: they are a different namespace, so a selection can only
  // be one or the other, and the marker form is the smaller answer.
  if (selected.length === 0 && markers.length === 1) {
    return <MarkerInspector marker={markers[0] as EEMarker} />;
  }
  if (selected.length === 0 && markers.length > 1) {
    return (
      <section className="panel">
        <h2>Inspector</h2>
        <p className="hint">{markers.length} markers selected — drag to move, Delete to remove.</p>
      </section>
    );
  }

  if (selected.length === 0) {
    return (
      <section className="panel">
        <h2>Inspector</h2>
        <p className="hint">Nothing selected. Click an object, or pick a palette type and click the map.</p>
      </section>
    );
  }
  if (selected.length > 1) {
    return (
      <section className="panel">
        <h2>Inspector</h2>
        <p className="hint">{selected.length} objects selected — drag to move, Delete to remove.</p>
        {multiBlock !== null && (
          <p className="hint inspector-block" role="status">
            <span className="block-glyph" aria-hidden="true">{multiBlock.kind === "locked" ? <LockIcon /> : <EyeOffIcon />}</span>
            <span>{describeBlock(multiBlock)} Nothing in this selection can be moved or deleted until then.</span>
          </p>
        )}
      </section>
    );
  }

  const object = selected[0] as EEObject;
  const group = project.map.groups.find((g) => g.objects.some((o) => o.id === object.id));

  const set = (key: string, value: unknown): void =>
    updateObject(object.id, { [key]: value } as Partial<EEObject>);
  // A locked group is looked at, not edited; so is one the map is not showing. The store refuses these edits too —
  // the form says so up front instead of letting a field accept a keystroke that goes nowhere.
  const block = blockOfObject(project, viewPrefs, object.id);

  return (
    <section className="panel inspector">
      <h2 title={object.type}>{objectTypeLabel(object.type)}</h2>
      {group !== undefined && (
        <p className="hint inspector-where">
          In <strong>{sectorLabel(project, group.sector)}</strong> › group <strong>{group.label}</strong> ·{" "}
          <span className={group.when === "on_call" ? "spawn-badge by-rule" : "spawn-badge at-start"}>
            {group.when === "on_call" ? "Appears when something spawns it" : "There from the mission start"}
          </span>
        </p>
      )}

      {block !== null && (
        <p className="hint inspector-block" role="status">
          <span className="block-glyph" aria-hidden="true">{block.kind === "locked" ? <LockIcon /> : <EyeOffIcon />}</span>
          <span>{describeBlock(block)}</span>
          {block.kind === "locked" && (
            <button type="button" className="small" onClick={() => toggleGroupLocked(block.group.id)}>
              Unlock group
            </button>
          )}
          {block.kind === "hidden" && viewPrefs.isolated === null && (
            <button type="button" className="small" onClick={() => toggleGroupHidden(block.group.id)}>
              Show group
            </button>
          )}
        </p>
      )}

      <InspectorSection name="Used by" count={usedByCount(project, object.id)} open>
        <UsedBy target="object" id={object.id} />
      </InspectorSection>

      <fieldset className="inspector-fields" disabled={block !== null}>
      {sectionedFields(object.type).map(({ section, fields }) => (
        <InspectorSection key={section} name={section} defaultOpen={!((section === "Appearance" || section === "More") && fields.length > 3)}>
          {section === "Identity" && <IdField object={object} />}
          {fields.map((spec) => {
            const value = (object as unknown as Record<string, unknown>)[spec.key];
            const doc = catalog === null ? spec.hint ?? null : fieldDoc(catalog, spec);
            return (
              // Keyed by object too: selecting a different object must not hand
              // its fields the half-typed text left in the previous one.
              <div className="field" key={`${object.id}:${spec.key}`} title={doc ?? undefined}>
                <label>
                  {spec.label}
                  {doc !== null && <span className="doc-dot">?</span>}
                </label>
                <FieldControl
                  spec={spec}
                  value={value}
                  options={optionsFor(spec, project, library)}
                  markers={project.map.markers}
                  dialogues={project.logic.dialogues}
                  origin={object.position}
                  onChange={(next) => set(spec.key, next)}
                />
              </div>
            );
          })}
        </InspectorSection>
      ))}
      </fieldset>
    </section>
  );
}

function usedByCount(project: EEProject, id: string): number {
  return findReferences(project, "object", id).length;
}

/**
 * A titled, foldable block of an inspector form. Folding hides nothing for good: every section is one click away,
 * and the heading says how many references a "Used by" holds so a closed one still tells its news.
 */
export function InspectorSection({
  name,
  count,
  open,
  defaultOpen = true,
  children,
}: {
  name: FieldSection | "Used by";
  count?: number;
  /** Always open (no toggle behaviour change): the references are the point of that block. */
  open?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [shown, setShown] = useState(open ?? defaultOpen);
  const id = `insp-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <div className="insp-section">
      <h3>
        <button
          type="button"
          className="section-toggle"
          aria-expanded={shown}
          aria-controls={id}
          onClick={() => setShown(!shown)}
        >
          <span aria-hidden="true">{shown ? "▾" : "▸"}</span> {name}
          {count !== undefined && <span className="muted"> ({count})</span>}
        </button>
      </h3>
      <div id={id} hidden={!shown}>
        {children}
      </div>
    </div>
  );
}

/**
 * A marker: a named place that only this document knows about (ADR-0038).
 *
 * Deliberately not rendered from `fields.ts`: those descriptors describe
 * EE object properties and each cites the setter it maps to. A marker maps
 * to no EE call at all, which is the whole idea, so it gets its own small
 * form rather than a row of descriptors with nothing to cite.
 */
function MarkerInspector({ marker }: { marker: EEMarker }): JSX.Element {
  const project = useEditor((s) => s.project);
  const updateMarker = useEditor((s) => s.updateMarker);
  const rename = useEditor((s) => s.renameMarker);
  const moveMarkerToSector = useEditor((s) => s.moveMarkerToSector);
  const [draft, setDraft] = useState(marker.id);

  useEffect(() => setDraft(marker.id), [marker.id]);

  const problem = project === null ? null : checkMarkerId(project, marker.id, draft);
  const commit = (): void => {
    if (draft === marker.id) return;
    if (problem !== null) {
      setDraft(marker.id);
      return;
    }
    rename(marker.id, draft);
  };

  return (
    <section className="panel">
      <h2>Marker</h2>
      <p className="hint">
        Not an EmptyEpsilon object — nothing spawns and players never see it. It is a place
        the narrative can name.
      </p>

      <div className="field" title="How records refer to this place. Renaming carries them all along.">
        <label>
          Id<span className="doc-dot">?</span>
        </label>
        <div className="id-field">
          <input
            className={problem === null ? "" : "invalid"}
            aria-label="Id"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem !== null}
            aria-describedby={problem !== null ? "marker-id-problem" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(marker.id);
            }}
          />
          <span id="marker-id-problem" className="error" role="alert">
            {problem !== null ? describeIdProblem(problem) : ""}
          </span>
        </div>
      </div>

      <div className="field">
        <label>Label</label>
        <input
          aria-label="Label"
          value={marker.label}
          onChange={(e) => updateMarker(marker.id, { label: e.target.value })}
        />
      </div>

      <div className="field">
        <label>Position</label>
        <div className="vec2">
          <NumberInput
            label="Position x"
            value={marker.position.x}
            step={100}
            onChange={(x) =>
              x !== null && updateMarker(marker.id, { position: { ...marker.position, x } })
            }
          />
          <NumberInput
            label="Position y"
            value={marker.position.y}
            step={100}
            onChange={(y) =>
              y !== null && updateMarker(marker.id, { position: { ...marker.position, y } })
            }
          />
        </div>
      </div>

      <div className="field" title="Which sector this place is filed under. Moving it changes only where you find it in the editor; its id, position and every reference to it stay as they are.">
        <label>Sector</label>
        <select
          aria-label="Sector of this marker"
          value={marker.sector === null ? "~shared" : marker.sector}
          onChange={(e) => moveMarkerToSector(marker.id, e.target.value === "~shared" ? null : e.target.value)}
        >
          <option value="~shared">{SHARED_LABEL}</option>
          {(project?.map.sectors ?? []).map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Notes</label>
        <textarea
          aria-label="Notes"
          rows={2}
          value={marker.notes ?? ""}
          onChange={(e) =>
            updateMarker(marker.id, { notes: e.target.value === "" ? null : e.target.value })
          }
        />
      </div>

      <InspectorSection name="Used by" count={project === null ? 0 : findReferences(project, "marker", marker.id).length} open>
        <UsedBy target="marker" id={marker.id} />
        <p className="hint">Move this place and every record that names it follows.</p>
      </InspectorSection>
    </section>
  );
}

/**
 * The object's id, editable.
 *
 * Not one of the descriptors in `fields.ts`, deliberately: those describe
 * *properties*, and an id is the handle the rest of the document holds the
 * object by. Committing one rewrites every reference (`renameObject`), so
 * it commits on Enter or blur rather than per keystroke, and refuses a
 * duplicate or a malformed id with the reason instead of silently keeping
 * the old one.
 */
function IdField({ object }: { object: EEObject }): JSX.Element {
  const project = useEditor((s) => s.project);
  const rename = useEditor((s) => s.renameObject);
  const [draft, setDraft] = useState(object.id);

  // Selecting a different object must show that object's id, not the
  // half-typed text left in the box for the previous one.
  useEffect(() => setDraft(object.id), [object.id]);

  const problem = project === null ? null : checkObjectId(project, object.id, draft);

  const commit = (): void => {
    if (draft === object.id) return;
    if (problem !== null) {
      setDraft(object.id);
      return;
    }
    rename(object.id, draft);
  };

  return (
    <div
      className="field"
      title="How the rest of the document refers to this object. Renaming carries orbits, triggers and orders with it."
    >
      <label>
        Id
        <span className="doc-dot">?</span>
      </label>
      <div className="id-field">
        <input
          className={problem === null ? "" : "invalid"}
          aria-label="Id"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem !== null}
          aria-describedby={problem !== null ? "object-id-problem" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(object.id);
          }}
        />
        <span id="object-id-problem" className="error" role="alert">
          {problem !== null ? describeIdProblem(problem) : ""}
        </span>
      </div>
    </div>
  );
}
