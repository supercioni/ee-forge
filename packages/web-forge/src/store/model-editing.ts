import type { EEModelDef, EEProject, EELibrary, EETemplateDef } from "@forge/contracts";
import { EEModelDefSchema } from "@forge/contracts";
import { useEditor } from "./editor.js";

export function effectiveModelName(template: EETemplateDef, project: EEProject): string | null {
  const seen = new Set<string>();
  let current: EETemplateDef | undefined = template;
  while (current && !seen.has(current.name)) {
    seen.add(current.name);
    if (current.model !== null) return current.model;
    current = project.templates.find(t => t.name === current!.copyOf);
  }
  return null;
}
export function modelDefinition(name: string | null, project: EEProject, library: EELibrary | null): EEModelDef | null {
  return project.models.find(m => m.name === name) ?? library?.models.find(m => m.name === name)?.definition ?? null;
}
export function attachModel(project: EEProject, templateId: string, source: EEModelDef, origin?: { model: string; target: string }): EEProject {
  if (!project.templates.some(t => t.id === templateId)) throw new Error("The selected template no longer exists");
  let n = 1;
  while (project.models.some(m => m.id === `model_${n}` || m.name === `${project.id}_model_${n}`)) n++;
  const model = EEModelDefSchema.parse({ ...structuredClone(source), id: `model_${n}`, name: `${project.id}_model_${n}`, ...(origin ? { origin } : {}) });
  const result = { ...project, models: [...project.models, model], templates: project.templates.map(t => t.id === templateId ? { ...t, model: model.name } : t) };
  // Both desktop IPC and browser HTTP accept at most 32 MiB. Reject here before dirtying a document that cannot save.
  if (new TextEncoder().encode(JSON.stringify(result)).length > 30 * 1024 * 1024) throw new Error("The project would exceed the 30 MiB save limit. Use smaller model textures or a separate project.");
  return result;
}
export function replaceModel(project: EEProject, id: string, patch: Partial<EEModelDef>): EEProject {
  const previous = project.models.find(m => m.id === id);
  if (!previous) throw new Error("This model no longer exists");
  const model = EEModelDefSchema.parse({ ...previous, ...patch });
  if (project.models.some(m => m.id !== id && m.name === model.name)) throw new Error("Another project model has this name");
  return { ...project, models: project.models.map(m => m.id === id ? model : m), templates: project.templates.map(t => t.model === previous.name ? { ...t, model: model.name } : t) };
}
/** One atomic store update: selecting another project while an import reads files cannot modify that project. */
export function commitModelEdit(projectId: string, change: (project: EEProject) => EEProject): void {
  const current = useEditor.getState().project;
  if (!current || current.id !== projectId) throw new Error("Project changed; import cancelled. Select the files again in the intended project.");
  const project = change(current);
  useEditor.setState({ project, dirty: true });
}
