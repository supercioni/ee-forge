import { Suspense, lazy, useEffect } from "react";
import type { EELibrary, EETemplateDef } from "@forge/contracts";
import { useEditor } from "../store/editor.js";
import { useModelSource } from "../store/model-source.js";
import { ErrorBoundary } from "../ui/ErrorBoundary.js";
import type { ModelViewSource } from "./ModelViewport.js";

/**
 * Read-only 3D view of an original hull: the game's own mesh and textures, read live from the model source
 * installation (ADR-0061) — the same viewer as the Model workshop, without the editing controls.
 *
 * The heavy component is behind `lazy`, so three.js is a chunk the editor fetches only when someone opens a ship.
 * When the model cannot be shown the panel says why in words; it never draws a stand-in that looks like the hull.
 */
const Viewport = lazy(async () => import("./ModelViewport.js"));

export function ShipPreview({
  template,
  library,
}: {
  template: EETemplateDef;
  templates: readonly EETemplateDef[];
  library: EELibrary | null;
  target: string;
}): JSX.Element {
  const project = useEditor((s) => s.project);
  const src = useModelSource();
  const projectId = project?.id ?? null, projectTarget = project?.eeVersion ?? null;
  useEffect(() => {
    const state = useModelSource.getState();
    if (projectId !== null && projectTarget !== null && (state.projectId !== projectId || state.target !== projectTarget)) void state.open(projectId, projectTarget);
  }, [projectId, projectTarget]);

  const name = template.model;
  const stock = name === null ? undefined : (src.library?.models.find((m) => m.name === name) ?? library?.models.find((m) => m.name === name));
  const model = stock?.definition ?? null;
  const source: ModelViewSource | null = src.installation && src.phase !== "unavailable" ? { installId: src.installation.id, label: src.installation.label, epoch: src.epoch } : null;

  let message: string | null = null;
  if (name === null) message = "No model is set for this hull.";
  else if (src.phase === "loading" || src.phase === "idle") message = "Reading the model source…";
  else if (stock === undefined) message = `“${name}” is not among the models of ${src.installation?.label ?? "the scanned installation"}.`;
  else if (model === null) message = `The scan of ${src.installation?.label ?? "the installation"} predates complete model definitions. Rescan it (Installations…) to see “${name}”.`;

  return (
    <div className="diagram" data-testid="ship-preview">
      <h3>3D preview</h3>
      {src.installation && <p className="hint">Model “{name}” read from {src.installation.label} ({src.installation.target}). Choose another model source in the Model workshop of a project ship.</p>}
      {src.problem && <p className="banner warn" role="alert">{src.problem}</p>}
      {message !== null || model === null ? (
        <p className="hint">{message}</p>
      ) : (
        <ErrorBoundary resetKey={`${template.id}|${model.mesh}`} fallback={() => <p className="hint error">3D preview unavailable.</p>}>
          <Suspense fallback={<p className="hint">Loading the 3D view…</p>}>
            <Viewport key={`${name}-${source?.installId ?? ""}`} model={model} selected={null} onSelect={() => undefined} source={source} sourceNote={src.problem} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
