import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { EEModelDef, EETemplateDef } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { useModelSource } from "../store/model-source.js";
import { attachModel, commitModelEdit, effectiveModelName, replaceModel } from "../store/model-editing.js";
import { NumberInput } from "../ui/NumberInput.js";
import { ErrorBoundary } from "../ui/ErrorBoundary.js";
import type { ModelPoint, ModelViewSource } from "./ModelViewport.js";
import "./model-workbench.css";
const Viewport = lazy(() => import("./ModelViewport.js"));
type XYZ = [number, number, number];
export function ModelWorkbench({ template }: { template: EETemplateDef }): JSX.Element | null {
  const project = useEditor(s => s.project), library = useEditor(s => s.library), eeDir = useEditor(s => s.eeDir);
  const updateTemplate = useEditor(s => s.updateTemplate);
  const src = useModelSource();
  const [selected, setSelected] = useState<ModelPoint>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [browse, setBrowse] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const projectId = project?.id ?? null, projectTarget = project?.eeVersion ?? null;
  useEffect(() => {
    const state = useModelSource.getState();
    if (projectId !== null && projectTarget !== null && (state.projectId !== projectId || state.target !== projectTarget)) void state.open(projectId, projectTarget);
  }, [projectId, projectTarget]);
  if (!project) return null;
  const assigned = effectiveModelName(template, project);
  // Browsing a source-only model previews it without assigning anything to the template.
  const name = browse ?? assigned;
  const own = project.models.find(m => m.name === name);
  const stock = src.library?.models.find(m => m.name === name) ?? (src.library === null ? library?.models.find(m => m.name === name) : undefined);
  const model = own ?? stock?.definition ?? null;
  const targetStock = library?.models.find(m => m.name === name);
  const users = own ? project.templates.filter(t => effectiveModelName(t, project) === name) : [];
  const viewSource: ModelViewSource | null = src.installation && src.phase !== "unavailable" ? { installId: src.installation.id, label: src.installation.label, epoch: src.epoch } : null;
  const sourceTarget = src.installation?.target ?? null;
  const foreign = !own && !!model && sourceTarget !== null && sourceTarget !== project.eeVersion;
  const differsFromTarget = !own && !!stock?.definition && !!targetStock?.definition && JSON.stringify({ ...stock.definition, id: "" }) !== JSON.stringify({ ...targetStock.definition, id: "" });
  const notInTarget = !own && !!stock && library !== null && !targetStock;
  const sourceModels = src.library?.models ?? [];
  const guard = (action: () => void): void => { try { action(); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const patch = (values: Partial<EEModelDef>): void => { if (own) guard(() => commitModelEdit(project.id, p => replaceModel(p, own.id, values))); };
  const copy = (): void => { if (model) guard(() => { commitModelEdit(project.id, p => attachModel(p, template.id, model, own?.origin ?? (name ? { model: name, target: sourceTarget ?? project.eeVersion } : undefined))); setBrowse(null); }); };
  const pick = (point: ModelPoint): void => { setSelected(point); if (point) document.getElementById(`model-${point.kind}-${point.index}`)?.scrollIntoView({ block: "nearest" }); };
  const importFiles = async (files: File[]): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const { importModelFiles } = await import("./import-model.js");
      const imported = await importModelFiles(files);
      commitModelEdit(project.id, p => attachModel(p, template.id, imported)); setSelected(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <section className="model-workbench" aria-label="Model workshop">
    <div className="model-workbench-head"><div><span className="model-eyebrow">MODEL WORKSHOP</span><h3>Shape, collision & engine trails</h3></div><span className={`origin-badge ${own ? 'project' : 'stock'}`}>{own ? "Project model" : "Original · read-only"}</span></div>
    <ModelSourcePanel projectTarget={project.eeVersion} eeDir={eeDir} />
    {browse && <p className="banner warn" role="status">Preview only: “{browse}” is not defined by the project's target engine ({project.eeVersion}), so it is <strong>not assigned</strong> to {template.name}. “Customise model” copies it into the project as a new model (its mesh and textures must exist in the game you install to — checked at Verify / Install).</p>}
    {foreign && !browse && <p className="banner">Previewing from {src.installation?.label} ({sourceTarget}); this project targets {project.eeVersion}.</p>}
    {differsFromTarget && <p className="banner warn">“{name}” is defined differently in the project's target engine than in the model source; the game will use its own definition unless you customise a copy.</p>}
    {notInTarget && !browse && <p className="banner warn">“{name}” is not defined by {project.eeVersion}. It cannot load there unless copied into the project.</p>}
    {own?.origin && <p className="hint">Copied from “{own.origin.model}” ({own.origin.target}). Mesh and texture names still refer to the installation's files; they are read from the model source above.</p>}
    <div className="model-actions">
      <label className="model-picker">3D model<select aria-label="3D model" value={name ?? ""} onChange={e => {
        const chosen = e.target.value || null;
        // A model the target engine does not define is previewed, never assigned behind the author's back.
        const assignable = chosen === null || project.models.some(m => m.name === chosen) || library === null || library.models.some(m => m.name === chosen);
        if (assignable) { setBrowse(null); if (chosen !== assigned) updateTemplate(template.id, { model: chosen }); } else setBrowse(chosen);
        setSelected(null); setError(null);
      }}>
        <option value="">Choose a model…</option>
        {name && !project.models.some(m => m.name === name) && !sourceModels.some(m => m.name === name) && <option value={name}>{name} (not in the model source)</option>}
        <optgroup label="Project models">{project.models.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</optgroup>
        <optgroup label={`Models in ${src.installation?.label ?? "the model source"}`}>{sourceModels.filter(m => !project.models.some(p => p.name === m.name)).map(m => <option key={m.name} value={m.name}>{m.name}{library !== null && !library.models.some(l => l.name === m.name) ? " — preview only (not in target engine)" : ""}</option>)}</optgroup>
      </select></label>
      <button type="button" disabled={!model || (!own && !!stock?.definitionWarnings?.length)} onClick={copy}>{own ? "Make separate copy" : "Customise model"}</button>
      <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Importing…" : "Import OBJ + textures…"}</button>
      <input ref={input} type="file" accept=".obj,.png,.jpg,.jpeg" multiple hidden aria-label="Import model files" onChange={e => { const files = Array.from(e.target.files ?? []); if (files.length) void importFiles(files); }} />
    </div>
    <p className="hint">Import one OBJ and its PNG/JPG textures together (8 MiB/file, 20 MiB/model). Use one material and a shared UV atlas. MTL, GLB and glTF are not imported. Resources travel inside the project and its exported bundle.</p>
    {error && <p className="banner warn" role="alert">{error}</p>}
    {!model ? <p className="banner">Select a model, or rescan the model source to retrieve complete model definitions.</p> : <>
      {!own && !!stock?.definitionWarnings?.length && <p className="banner warn">This model uses expressions the scanner cannot reproduce safely. Copy is disabled: {stock.definitionWarnings.join(" ")}</p>}
      {users.length > 1 && <p className="banner warn">Shared by {users.map(t => t.name).join(", ")}. Changes affect all these templates. “Make separate copy” assigns a new model only to this template.</p>}
      {model.normalMap && project.eeVersion.includes('2024') && <p className="banner warn" role="alert">This model uses a normal map, which EE 2024 does not support, so the project cannot be built or installed for 2024 as it is.{own ? <> <button type="button" onClick={() => patch({ normalMap: null })}>Remove normal map for 2024</button></> : " Customise a copy to remove it."}</p>}
      <div className="model-workbench-grid">
        <div className="model-stage"><ErrorBoundary resetKey={`${model.id}-${model.mesh}`} fallback={() => <p className="hint error">3D preview unavailable. Numeric controls remain usable.</p>}><Suspense fallback={<p>Loading model workshop…</p>}><Viewport key={`${model.id}-${name}-${viewSource?.installId ?? ''}`} model={model} selected={selected} onSelect={pick} source={viewSource} sourceNote={src.phase === "loading" ? null : src.problem} /></Suspense></ErrorBoundary></div>
        <fieldset disabled={!own || busy} className="model-controls"><legend>Model parameters</legend>
          {!own && <p className="hint">Customise this model to edit a project copy.</p>}
          <label>Model name<input aria-label="Model name" value={model.name} onChange={e => patch({ name: e.target.value })} /></label>
          <div className="model-two"><Scalar label="Model scale" value={model.scale} onChange={scale => patch({ scale })} positive nullable /><Scalar label="Radius (game units)" value={model.radius} onChange={radius => patch({ radius })} positive nullable /></div>
          <p className="hint">Scale changes the mesh and attachment points. Radius is independent: it controls collisions/render bounds, not the mesh size. Empty values use EE defaults (1).</p>
          <Vector label="Render offset" value={model.renderOffset ?? [0, 0, 0]} onChange={renderOffset => patch({ renderOffset })} />
          <label className="model-check"><input type="checkbox" checked={model.collisionBox !== null} onChange={e => patch({ collisionBox: e.target.checked ? [100, 100] : null })} /> Rectangular collision box</label>
          {model.collisionBox && <div className="model-two">{['Width', 'Length'].map((l, i) => <Scalar key={l} label={`Collision ${l.toLowerCase()}`} value={model.collisionBox![i]!} positive onChange={v => { if (v !== null) { const b: [number, number] = [...model.collisionBox!]; b[i] = v; patch({ collisionBox: b }); } }} />)}</div>}
          <details><summary>Mesh & texture resources</summary><p className="hint">Paths are relative to EE resources. Imported images appear in this list. The first image is initially used as the main texture; choose its role here.</p>
            {(['mesh','texture','specular','illumination','normalMap'] as const).map(field => <label key={field}>{field === 'normalMap' ? 'Normal map (2026 only)' : field}<input list={`model-resources-${model.id}`} aria-label={`Model ${field}`} value={model[field] ?? ""} disabled={field === 'normalMap' && project.eeVersion.includes('2024')} onChange={e => patch({ [field]: e.target.value || (field === 'mesh' ? model.mesh : null) })} /></label>)}
            <datalist id={`model-resources-${model.id}`}>{model.resources?.map(r => <option key={r.path} value={r.path} />)}</datalist>
          </details>
          <div className="model-list-head"><h4>Engine trails <span>{model.engineEmitters.length}</span></h4><button type="button" onClick={() => { patch({ engineEmitters: [...model.engineEmitters, { position: [0,0,0], color: [0.2,0.6,1], scale: 1 }] }); pick({ kind:'engine', index:model.engineEmitters.length }); }}>+ Engine</button></div>
          <p className="hint">Origins use model coordinates; EE multiplies them by model scale. Render offset does not move engine origins. RGB uses 0–1; size is also multiplied by model scale.</p>
          {model.engineEmitters.map((emitter, i) => {
            const update = (value: Partial<typeof emitter>): void => patch({ engineEmitters: model.engineEmitters.map((p, j) => i === j ? { ...p, ...value } : p) });
            return <div className={`model-point ${selected?.kind === 'engine' && selected.index === i ? 'selected' : ''}`} id={`model-engine-${i}`} key={i}>
              <div className="model-list-head"><button type="button" aria-pressed={selected?.kind === 'engine' && selected.index === i} onClick={() => pick({ kind:'engine', index:i })}>Engine {i + 1}</button><button type="button" aria-label={`Duplicate engine ${i+1}`} onClick={() => patch({ engineEmitters: [...model.engineEmitters, structuredClone(emitter)] })}>Duplicate</button><button type="button" aria-label={`Delete engine ${i+1}`} onClick={() => { patch({ engineEmitters: model.engineEmitters.filter((_, j) => i !== j) }); setSelected(null); }}>Delete</button></div>
              <Vector label={`Engine ${i+1} origin`} value={emitter.position} onChange={position => update({ position })} />
              <Vector label={`Engine ${i+1} RGB`} value={emitter.color} onChange={color => update({ color })} colour />
              {emitter.color.some(n => n > 1) && <p className="hint error">Legacy colour above 1: preserved as saved. Use 0–1 for normal RGB intensity.</p>}
              <Scalar label={`Engine ${i+1} size`} value={emitter.scale} positive onChange={scale => { if (scale !== null) update({ scale }); }} />
            </div>;
          })}
          {(['beam','tube'] as const).map(kind => { const field = kind === 'beam' ? 'beamPositions' : 'tubePositions'; return <details key={kind}><summary>{kind === 'beam' ? 'Beam origins' : 'Missile tube origins'} ({model[field].length})</summary><p className="hint">Positions are numbered in list order. EE adds render offset and then model scale. Weapon behaviour is configured under Weapons.</p><button type="button" onClick={() => patch({ [field]: [...model[field], [0,0,0]] })}>+ {kind === 'beam' ? 'Beam' : 'Tube'} origin</button>{model[field].map((p,i) => <div className="model-point" id={`model-${kind}-${i}`} key={i}><button type="button" onClick={() => pick({kind,index:i})}>{kind} {i+1}</button><Vector label={`${kind} ${i+1}`} value={p} onChange={v => patch({ [field]: model[field].map((old,j) => i === j ? v : old) })} /><button type="button" onClick={() => { patch({ [field]: model[field].filter((_,j) => i !== j) }); setSelected(null); }}>Delete origin</button></div>)}</details>; })}
        </fieldset>
      </div>
      <p className="banner">Save → Verify → Install scenario, then restart EmptyEpsilon completely. Models and ship templates are loaded at launch.</p>
    </>}
  </section>;
}
function Scalar({ label, value, onChange, positive = false, nullable = false }: { label:string; value:number|null; onChange:(n:number|null)=>void; positive?:boolean; nullable?:boolean }): JSX.Element {
  return <label>{label}<NumberInput label={label} value={value} nullable={nullable} min={positive ? .000001 : undefined} step={.1} onChange={n => { if (n === null ? nullable : Number.isFinite(n) && (!positive || n > 0)) onChange(n); }} /></label>;
}
function Vector({ label, value, onChange, colour = false }: { label:string; value:XYZ; onChange:(p:XYZ)=>void; colour?:boolean }): JSX.Element {
  return <div className="model-vector"><span>{label}</span><div>{(colour ? ['R','G','B'] : ['X','Y','Z']).map((axis,i) => <label key={axis}>{axis}<NumberInput label={`${label} ${axis}`} value={value[i]!} min={colour ? 0 : undefined} step={colour ? .05 : .1} onChange={n => { if (n !== null && Number.isFinite(n) && (!colour || n >= 0)) { const p:XYZ = [...value]; p[i] = n; onChange(p); } }} /></label>)}</div></div>;
}

function ModelSourcePanel({ projectTarget, eeDir }: { projectTarget: string; eeDir: string }): JSX.Element {
  const src = useModelSource();
  const destination = src.installs.find(i => i.id === eeDir);
  return <div className="model-source" role="group" aria-label="Model source">
    <label>Model source
      <select aria-label="Model source" value={src.chosenId ?? ""} disabled={src.phase === "loading"} onChange={e => { if (e.target.value) void src.choose(e.target.value); }}>
        {src.chosenId === null && <option value="">Choose an installation…</option>}
        {src.chosenId !== null && !src.installs.some(i => i.id === src.chosenId) && <option value={src.chosenId}>Unavailable installation ({src.chosenId})</option>}
        {src.installs.map(i => <option key={i.id} value={i.id}>{i.label} — {i.target}{i.verified ? "" : " (declared)"} — {i.path}</option>)}
      </select>
    </label>
    {src.installation && src.phase !== "ready" && src.phase !== "loading" && <button type="button" onClick={() => void src.rescanChosen()}>Rescan model source</button>}
    <dl className="model-roles" aria-label="Which installation does what">
      <div><dt>Project target</dt><dd>{projectTarget}</dd></div>
      <div><dt>Model source</dt><dd>{src.installation ? `${src.installation.label} (${src.installation.target})` : "not available"}{src.remembered ? "" : " · starting default"}</dd></div>
      <div><dt>Install scenario goes to</dt><dd>{destination ? `${destination.label} (${destination.target})` : eeDir || "not chosen"}</dd></div>
    </dl>
    <p className="hint">Changing the model source only changes where meshes and textures are read from. It does not change the project's target, the install destination or any ship, and it is not saved in the project file. The original ship templates in Fleet come from the project's target engine, not from this source.</p>
    {src.problem && <p className="banner warn" role="alert">{src.problem}</p>}
  </div>;
}
