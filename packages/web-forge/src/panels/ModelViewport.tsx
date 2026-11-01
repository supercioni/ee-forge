import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import { Box3, DoubleSide, Mesh, MeshPhongMaterial, SRGBColorSpace, TextureLoader, Vector3, type Object3D, type Texture } from "three";
import type { EEModelDef } from "@forge/contracts";
import { modelFileUrl } from "../api/transport.js";
import { fetchModelSourceReport } from "../api/client.js";
import type { ForgeModelResourceStatus } from "@forge/contracts";
import { readNativeModel, readObjNative } from "./model-geometry.js";

/** The model source the preview reads stock meshes and textures from; null when none is chosen. */
export interface ModelViewSource { readonly installId: string; readonly label: string; readonly epoch: number }
interface ResourceRow { readonly role: string; readonly path: string; readonly status: ForgeModelResourceStatus | "project" }
const ROLES = [["mesh", "Mesh"], ["texture", "Texture"], ["specular", "Specular"], ["illumination", "Illumination"], ["normalMap", "Normal map"]] as const;
export type ModelPoint = { kind: "engine" | "beam" | "tube"; index: number } | null;
export default function ModelViewport({ model, selected, onSelect, source, sourceNote = null }: { model: EEModelDef; selected: ModelPoint; onSelect: (p: ModelPoint) => void; source: ModelViewSource | null; sourceNote?: string | null }): JSX.Element {
  const [loaded, setLoaded] = useState<{ key: string; object: Object3D; diameter: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(0), [view, setView] = useState("perspective"), [wire, setWire] = useState(false);
  const [rows, setRows] = useState<readonly ResourceRow[]>([]), [sourceProblem, setSourceProblem] = useState<string | null>(null);
  const key = JSON.stringify([source?.installId ?? null, source?.epoch ?? 0, model.id, model.mesh, model.texture, model.specular, model.illumination, model.normalMap, model.resources, sourceNote]);
  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    const textures: Texture[] = [];
    let object: Object3D | null = null;
    setError(null); setLoaded(null); setRows([]); setSourceProblem(null);
    const run = async (): Promise<void> => {
      const embedded = new Set((model.resources ?? []).map(r => r.path));
      const wanted: Array<{ role: string; path: string }> = [];
      for (const [field, role] of ROLES) { const path = model[field]; if (path) wanted.push({ role, path }); }
      const needed = [...new Set(wanted.filter(r => !embedded.has(r.path)).map(r => r.path))];
      const stamps = new Map<string, string>();
      if (needed.length > 0) {
        if (!source) throw new Error(sourceNote ?? "No model source is selected. Choose the EmptyEpsilon installation to read this model's mesh and textures from.");
        const report = await fetchModelSourceReport(source.installId, needed);
        if (!alive) return;
        const byPath = new Map(report.resources.map(r => [r.path, r]));
        setRows(wanted.map(r => ({ role: r.role, path: r.path, status: embedded.has(r.path) ? "project" as const : byPath.get(r.path) ?? { path: r.path, state: "missing" as const, origin: null, bytes: null, detail: "Not reported by the model source" } })));
        if (!report.available) { setSourceProblem(report.problem); throw new Error(`The model source ${report.installation.label} is not available: ${report.problem}`); }
        const bad = report.resources.filter(r => r.state !== "ok");
        if (bad.length > 0) throw new Error(`${bad.length} resource(s) cannot be shown from ${report.installation.label}: ${bad.map(b => `${b.path} — ${b.detail ?? b.state}`).join("; ")}`);
        for (const r of report.resources) stamps.set(r.path, JSON.stringify([r.origin, r.bytes]));
      } else setRows(wanted.map(r => ({ role: r.role, path: r.path, status: "project" as const })));
      const url = (path: string): string => {
        const embeddedFile = model.resources?.find(r => r.path === path);
        if (embeddedFile) return `data:${path.endsWith(".png") ? "image/png" : /\.jpe?g$/.test(path) ? "image/jpeg" : "text/plain"};base64,${embeddedFile.base64}`;
        if (!source) throw new Error(`No model source for ${path}`);
        return modelFileUrl(source.installId, path, stamps.get(path) ?? "");
      };
      const response = await fetch(url(model.mesh), { signal: abort.signal });
      if (!response.ok) throw new Error(`Cannot read mesh: ${model.mesh}`);
      if (model.mesh.endsWith(".model")) object = new Mesh(readNativeModel(await response.arrayBuffer()));
      else if (model.mesh.toLowerCase().endsWith(".obj")) object = readObjNative(await response.text());
      else throw new Error("Preview supports EE .model and OBJ meshes");
      const loadTexture = async (path: string | null | undefined, colour = false): Promise<Texture | null> => {
        if (!path) return null;
        const texture = await new TextureLoader().loadAsync(url(path));
        textures.push(texture);
        if (colour) texture.colorSpace = SRGBColorSpace;
        return texture;
      };
      const map = await loadTexture(model.texture, true), specularMap = await loadTexture(model.specular);
      const emissiveMap = await loadTexture(model.illumination, true), normalMap = await loadTexture(model.normalMap);
      const material = new MeshPhongMaterial({ map, specularMap, emissiveMap, normalMap, color: map ? "white" : "#8299ac", emissive: emissiveMap ? "white" : "black", side: DoubleSide });
      object.traverse(child => { if (child instanceof Mesh) { const old = Array.isArray(child.material) ? child.material : [child.material]; old.forEach(m => m.dispose()); child.material = material; } });
      if (alive) setLoaded({ key, object, diameter: new Box3().setFromObject(object).getSize(new Vector3()).length() });
      else material.dispose();
    };
    void run().catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => {
      alive = false; abort.abort(); textures.forEach(t => t.dispose());
      object?.traverse(child => { if (child instanceof Mesh) { child.geometry.dispose(); (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.dispose()); } });
    };
  }, [key]); // Geometry/material resources only; coordinate edits never reload the mesh.
  const object = loaded?.key === key ? loaded.object : null;
  useEffect(() => { object?.traverse(child => { if (child instanceof Mesh) (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => { if (m instanceof MeshPhongMaterial) m.wireframe = wire; }); }); }, [object, wire]);
  const points = useMemo(() => [
    ...model.engineEmitters.map((p, index) => ({ ...p, kind: "engine" as const, index })),
    ...model.beamPositions.map((position, index) => ({ position, kind: "beam" as const, index, scale: 1 })),
    ...model.tubePositions.map((position, index) => ({ position, kind: "tube" as const, index, scale: 1 })),
  ], [model]);
  const scale = model.scale ?? 1, radius = model.radius ?? 1;
  const offset = model.renderOffset ?? [0, 0, 0];
  const diameter = loaded?.key === key ? loaded.diameter * scale : radius * 2;
  const extent = Math.max(radius, diameter / 2, ...offset.map(n => Math.abs(n * scale)), 1);
  const ring = Array.from({ length: 65 }, (_, i) => [radius * Math.cos(i * Math.PI / 32), radius * Math.sin(i * Math.PI / 32), 0] as [number, number, number]);
  return <div className="model-viewport">
    <div className="model-view-tools">
      {['perspective', 'top', 'front', 'side'].map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v[0]!.toUpperCase() + v.slice(1)}</button>)}
      <button type="button" onClick={() => setFit(f => f + 1)}>Fit view</button>
      <label><input type="checkbox" checked={wire} onChange={e => setWire(e.target.checked)} /> Wireframe</label>
    </div>
    {error ? <p role="alert" className="hint error">{error}</p> : object === null ? <p role="status">Loading actual model…</p> : <div className="model-canvas" data-testid="model-workbench-canvas">
      <Canvas camera={{ position: [extent * 2, -extent * 2, extent * 1.3], far: 1000000, fov: 45 }} onCreated={({ camera }) => camera.up.set(0, 0, 1)} dpr={[1, 1.5]}>
        <color attach="background" args={["#0b1723"]} />
        <ambientLight intensity={1.1} /><directionalLight position={[extent, -extent, extent * 2]} intensity={2.3} />
        <directionalLight position={[-extent, extent, extent]} intensity={1} />
        <CameraView view={view} fit={fit} extent={extent} />
        <group rotation={[0, 0, Math.PI]} scale={scale}><group position={[...offset] as [number, number, number]}><primitive object={object} /></group></group>
        <Line points={ring} color="#ffc36b" lineWidth={1.5} />
        {model.collisionBox && model.collisionBox.every(n => n > 0) && <Line points={[[ -model.collisionBox[0]/2, -model.collisionBox[1]/2, 0], [model.collisionBox[0]/2,-model.collisionBox[1]/2,0], [model.collisionBox[0]/2,model.collisionBox[1]/2,0], [-model.collisionBox[0]/2,model.collisionBox[1]/2,0], [-model.collisionBox[0]/2,-model.collisionBox[1]/2,0]]} color="#ff8d6b" />}
        <axesHelper args={[Math.max(radius, diameter / 2)]} />
        {points.map(p => {
          // ModelInfo::render scales engine origins without renderOffset. Beam/tube getters add the offset first.
          const pos = p.position.map((n, i) => (n + (p.kind === 'engine' ? 0 : offset[i]!)) * scale) as [number, number, number];
          const active = selected?.kind === p.kind && selected.index === p.index;
          return <group key={`${p.kind}-${p.index}`} position={pos}>
            <mesh onClick={e => { e.stopPropagation(); onSelect({ kind: p.kind, index: p.index }); }}>
              <sphereGeometry args={[Math.max(extent * .012, .05), 12, 8]} /><meshBasicMaterial color={active ? "white" : p.kind === "engine" ? "#50d8ff" : p.kind === "beam" ? "#ff7180" : "#b8a0ff"} depthTest={false} />
            </mesh>
            {p.kind === "engine" && <mesh rotation={[0, 0, Math.PI / 2]} position={[-p.scale * scale, 0, 0]}><coneGeometry args={[p.scale * scale / 2, p.scale * scale * 2, 12]} /><meshBasicMaterial color={"color" in p ? p.color : "#50d8ff"} transparent opacity={.55} depthWrite={false} /></mesh>}
            {active && <Html center position={[0, 0, extent * .035]}><span className="model-point-label">{p.kind} {p.index + 1}</span></Html>}
          </group>;
        })}
        <OrbitControls makeDefault />
      </Canvas>
    </div>}
    <ResourceList rows={rows} source={source} problem={sourceProblem} />
    <p className="hint">Actual mesh · X red, Y green, Z blue · Amber: radius · Coral: collision box. Engine cones show origin, colour and size; they are guides, not EE particle simulation. Drag to orbit; wheel to zoom.</p>
  </div>;
}
function CameraView({ view, fit, extent }: { view: string; fit: number; extent: number }): null {
  const { camera, controls } = useThree();
  useEffect(() => {
    const distance = extent * 2.2;
    camera.up.set(0, 0, 1);
    camera.position.set(...(view === "top" ? [0, -.001, distance] : view === "front" ? [distance, 0, 0] : view === "side" ? [0, -distance, 0] : [distance, -distance, distance * .8]) as [number, number, number]);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
    const orbit = controls as unknown as { target?: Vector3; update?: () => void } | null;
    orbit?.target?.set(0, 0, 0); orbit?.update?.();
  }, [view, fit, camera, controls]); // Keep camera fixed when scale/radius changes; Fit is explicit.
  return null;
}

const describeOrigin = (status: ResourceRow["status"], source: ModelViewSource | null): string => {
  if (status === "project") return "Imported into this project";
  const where = status.origin === null ? "" : status.origin.kind === "file" ? `${status.origin.file}` : `${status.origin.pack} → ${status.path} (offset ${status.origin.offset}, ${status.origin.length} bytes)`;
  return `${source?.label ?? "?"}${where ? ` · ${where}` : ""}`;
};
const STATE_TEXT: Readonly<Record<string, string>> = { ok: "found", missing: "missing", "unsupported-format": "format not supported", refused: "refused", "archive-unreadable": "archive unreadable", project: "in project" };
function ResourceList({ rows, source, problem }: { rows: readonly ResourceRow[]; source: ModelViewSource | null; problem: string | null }): JSX.Element | null {
  if (rows.length === 0 && !problem) return null;
  return <details className="model-resources" open={rows.some(r => r.status !== "project" && r.status.state !== "ok") || !!problem} data-testid="model-resource-report">
    <summary>Resource origin ({rows.length})</summary>
    {problem && <p className="hint error">{problem}</p>}
    <ul className="model-resource-list">{rows.map(r => {
      const state = r.status === "project" ? "project" : r.status.state;
      return <li key={`${r.role}-${r.path}`} data-state={state} data-origin={describeOrigin(r.status, source)}>
        <div><strong>{r.role}</strong> <code>{r.path}</code> <span className={state === "ok" || state === "project" ? "ok" : "error"}>{STATE_TEXT[state] ?? state}</span></div>
        <small>{describeOrigin(r.status, source)}{r.status !== "project" && r.status.detail ? ` — ${r.status.detail}` : ""}</small></li>;
    })}</ul>
  </details>;
}
