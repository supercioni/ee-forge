import type { AssetManifest, EELibrary, EETemplateDef } from "@forge/contracts";
import { resolveShipModel } from "./ship-preview.js";

/**
 * What a hull needs from outside the project, and what is known about each need.
 *
 * Every report states **evidence**, not a guess: a name found in the project's own models, found in the scanned
 * install (with the file that declared it), not found in a scan that did run, or not checkable because no scan
 * exists. When the cause of an absence is not in the data — a mesh the manifest lists but the repo does not hold,
 * a model another engine version might have — the report says what was looked at and stops there.
 *
 * Nothing here changes a template: a name that cannot be found is reported, never replaced.
 */
export type ResourceState =
  /** Found, in this project or in the scanned install. */
  | "available"
  /** Looked for in a scan that ran, and not there. */
  | "missing"
  /** No scan to look in (or nothing set), so nothing can be said. */
  | "unverified"
  /** A stand-in that is not this hull. */
  | "generic"
  /** Listed, but for a ship the selected engine's install does not declare. */
  | "other-source";

export interface ResourceReport {
  readonly kind: "model" | "radarTrace" | "preview";
  /** What it is, in the author's words. */
  readonly label: string;
  /** The name or path being judged; null when the template sets none. */
  readonly name: string | null;
  readonly state: ResourceState;
  /** One sentence: what is known. */
  readonly summary: string;
  /** Where it was found ("EE-2026.09.22PR install · scripts/model_data.lua"), when it was. */
  readonly source: string | null;
  /** What the author can do about it, when there is something. */
  readonly action: string | null;
}

export interface TemplateNeeds {
  readonly name: string;
  readonly model: string | null;
  readonly radarTrace: string | null;
}

const SCAN_ACTION = "Register an EmptyEpsilon install of this engine and scan it (Installations… in the toolbar).";
const trace = (path: string): string => path.replace(/^radar\//, "");

export function describeTemplateResources(
  template: TemplateNeeds,
  context: { readonly projectModels: readonly string[]; readonly library: EELibrary | null; readonly target: string; /** How to name the installation the scan came from ("Juegos/2026"); default "the <engine> install". */ readonly installLabel?: string },
): readonly ResourceReport[] {
  const { library, target } = context;
  const reports: ResourceReport[] = [];
  const where = (lib: EELibrary): string => context.installLabel ?? `the ${lib.eeVersion} install`;

  // --- the model (ModelData name)
  if (template.model === null) {
    reports.push({ kind: "model", label: "Model", name: null, state: "unverified", summary: "No model is set. EE will not load a ship template without one.", source: null, action: "Choose a model in the Hull section." });
  } else if (context.projectModels.includes(template.model)) {
    reports.push({ kind: "model", label: "Model", name: template.model, state: "available", summary: `“${template.model}” is defined by this project.`, source: "this project (Models)", action: null });
  } else if (library === null) {
    reports.push({ kind: "model", label: "Model", name: template.model, state: "unverified", summary: `No install is scanned for ${target}, so “${template.model}” cannot be checked.`, source: null, action: SCAN_ACTION });
  } else {
    const found = library.models.find((m) => m.name === template.model);
    reports.push(
      found === undefined
        ? { kind: "model", label: "Model", name: template.model, state: "missing", summary: `“${template.model}” is not a model of this project and not in ${where(library)} scanned ${library.scannedAt.slice(0, 10)}.`, source: null, action: "Choose another model, define one in the project, or rescan the install if it was added after the scan." }
        : { kind: "model", label: "Model", name: template.model, state: "available", summary: `“${template.model}” is declared by ${where(library)}.`, source: `${context.installLabel ?? `${library.eeVersion} install`} · ${found.sourceFile}`, action: null },
    );
  }

  // --- the radar trace
  if (template.radarTrace === null) {
    reports.push({ kind: "radarTrace", label: "Radar trace", name: null, state: "unverified", summary: "No radar trace is set; EE draws its default.", source: null, action: null });
  } else if (library === null) {
    reports.push({ kind: "radarTrace", label: "Radar trace", name: template.radarTrace, state: "unverified", summary: `No install is scanned for ${target}, so “${template.radarTrace}” cannot be checked.`, source: null, action: SCAN_ACTION });
  } else {
    const wanted = trace(template.radarTrace);
    const found = library.resources.radarTraces.some((p) => trace(p) === wanted);
    reports.push(
      found
        ? { kind: "radarTrace", label: "Radar trace", name: template.radarTrace, state: "available", summary: `“${template.radarTrace}” is a radar image of ${where(library)}.`, source: `${context.installLabel ?? `${library.eeVersion} install`} · resources/radar`, action: null }
        : { kind: "radarTrace", label: "Radar trace", name: template.radarTrace, state: "missing", summary: `“${template.radarTrace}” is not among the radar images of ${where(library)} scanned ${library.scannedAt.slice(0, 10)}.`, source: null, action: "Choose one from the list, or rescan the install if the image was added after the scan." },
    );
  }
  return reports;
}

/**
 * The 3D preview, which is a different question from the model: the preview shows whichever glTF the asset
 * manifest lists for this hull or an ancestor, and says so. `file` is what the loader reported — "loading"
 * until it has either drawn the mesh or failed.
 */
export function describePreview(input: {
  readonly template: EETemplateDef;
  readonly templates: readonly EETemplateDef[];
  readonly manifest: AssetManifest | null;
  readonly manifestError: string | null;
  readonly library: EELibrary | null;
  readonly target: string;
  readonly installLabel?: string;
  readonly file: "loading" | "loaded" | "failed";
  readonly failure: string | null;
}): ResourceReport {
  const { template, templates, manifest, library, target } = input;
  const base = { kind: "preview", label: "3D preview", name: template.name } as const;
  if (input.manifestError !== null) {
    return { ...base, state: "unverified", summary: `The asset manifest could not be read (${input.manifestError}), so no model can be named.`, source: null, action: null };
  }
  if (manifest === null) return { ...base, state: "unverified", summary: "Reading the asset manifest…", source: null, action: null };
  const found = resolveShipModel(manifest, template, templates);
  if (found === null) {
    const empty = Object.keys(manifest).length === 0;
    return {
      ...base,
      state: "generic",
      summary: empty
        ? "The asset manifest lists no 3D model at all, so this is a generic stand-in, not this hull. A stand-in says nothing about whether the game's own model exists or works."
        : `The asset manifest has no 3D model for “${template.name}” or the hull it copies, so this is a generic stand-in, not this hull. A stand-in says nothing about whether the game's own model exists or works.`,
      source: null,
      action: null,
    };
  }
  const via = found.viaTemplateName;
  const known = via === template.name || templates.some((t) => t.name === via) || (library !== null && library.templates.some((t) => t.name === via));
  if (library !== null && !known) {
    return {
      ...base,
      state: "other-source",
      summary: `The model listed for “${via}” is not matched by any ship ${input.installLabel ?? `the ${target} install`} declares — it may belong to another engine version or to Forge's own set; the manifest does not say which.`,
      source: null,
      action: null,
    };
  }
  if (input.file === "failed") {
    return { ...base, state: "missing", summary: input.failure ?? `The model file for “${via}” could not be loaded.`, source: null, action: "Restore the file under assets/, or remove its manifest entry." };
  }
  if (input.file === "loading") {
    return { ...base, state: "unverified", summary: `Loading the model listed for “${via}”…`, source: found.entry.model, action: null };
  }
  const borrowed = via !== template.name;
  return {
    ...base,
    state: "available",
    summary: borrowed ? `Shows the model of “${via}”, the hull this one copies — a likeness, not this hull's own mesh.` : `Shows the model listed for “${via}”.`,
    source: found.entry.model,
    action: null,
  };
}
