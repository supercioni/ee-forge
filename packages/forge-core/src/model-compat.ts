import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EEProject } from "@forge/contracts";
import { readModelDefinitions } from "./scan/model-definitions.js";
import { modelResourceReader } from "./scan/model-resources.js";

/**
 * Can this project's models load in a given installation?
 *
 * A model read from one installation is only a *reference* in the project: a mesh and texture name that the
 * engine resolves at launch from its own `resources/` and `packs/`. So the question is separate from "does the
 * preview work": the destination must have each referenced resource, must define every stock model the project
 * names, and — when the source is known — should hold the same bytes behind the same name. Nothing here
 * removes a property, substitutes a model or copies a stock asset.
 */

export interface ModelDependency {
  /** Project model that needs it, or the template that names a stock model. */
  readonly owner: string;
  readonly kind: "resource" | "stock-model";
  /** The resource path relative to EE's resources, or the stock model name. */
  readonly name: string;
}

export interface ModelCompatIssue {
  /** `error` blocks build/install; `warning` is shown; `unverified` is a dependency nobody could check. */
  readonly severity: "error" | "warning" | "unverified";
  readonly dependency: ModelDependency;
  readonly message: string;
}

export interface ModelCompatReport {
  readonly dependencies: readonly ModelDependency[];
  readonly issues: readonly ModelCompatIssue[];
  /** Dependencies confirmed present in the destination. */
  readonly verified: number;
}

/** Resources the engine must find by itself: every referenced path that the project does not carry. */
export function modelDependencies(project: EEProject): ModelDependency[] {
  const out: ModelDependency[] = [];
  const seen = new Set<string>();
  const add = (dependency: ModelDependency): void => {
    const key = `${dependency.kind}\0${dependency.name}\0${dependency.owner}`;
    if (!seen.has(key)) { seen.add(key); out.push(dependency); }
  };
  const own = new Set(project.models.map(m => m.name));
  for (const model of project.models) {
    const embedded = new Set((model.resources ?? []).map(r => r.path));
    for (const path of [model.mesh, model.texture, model.specular, model.illumination, model.normalMap]) {
      if (path && !embedded.has(path)) add({ owner: model.name, kind: "resource", name: path });
    }
  }
  for (const template of project.templates) {
    if (template.model && !own.has(template.model)) add({ owner: template.name, kind: "stock-model", name: template.model });
  }
  return out;
}

function definedModels(install: string): Set<string> | null {
  const file = join(install, "scripts", "model_data.lua");
  if (!existsSync(file)) return null;
  return new Set(readModelDefinitions(readFileSync(file, "utf8")).keys());
}

/** A model another script of the installation defines (community content): literal `ModelData` + `setName("x")` in a scripts/ file. */
function definedElsewhere(install: string, name: string): boolean {
  const quoted = [`"${name}"`, `'${name}'`];
  for (const dir of [join(install, "scripts"), join(install, "scripts", "shiptemplates")]) {
    let files: string[];
    try { files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".lua") && f !== "model_data.lua"); } catch { continue; }
    for (const file of files) {
      try {
        const text = readFileSync(join(dir, file), "utf8");
        if (text.includes("ModelData") && quoted.some((q) => text.includes(`setName(${q}`))) return true;
      } catch { /* unreadable file: not evidence either way */ }
    }
  }
  return false;
}

/**
 * Check the project against `destination` (the installation the build goes to; null when exporting without one) and,
 * when given, compare content with `source` (the installation the models were read from).
 */
export function checkModelDependencies(project: EEProject, destination: string | null, source: string | null): ModelCompatReport {
  const dependencies = modelDependencies(project);
  const issues: ModelCompatIssue[] = [];
  let verified = 0;
  if (destination === null) {
    for (const dependency of dependencies) {
      issues.push({ severity: "unverified", dependency, message: dependency.kind === "resource"
        ? `${dependency.name} (used by ${dependency.owner}) must exist in the target game's resources or packs; no destination installation was available to check.`
        : `Stock model "${dependency.name}" (used by ${dependency.owner}) must be defined by the target game; no destination installation was available to check.` });
    }
    return { dependencies, issues, verified };
  }
  const reader = modelResourceReader(destination);
  const sourceReader = source !== null && source !== destination ? modelResourceReader(source) : null;
  const stock = definedModels(destination);
  for (const dependency of dependencies) {
    if (dependency.kind === "stock-model") {
      if (stock === null) issues.push({ severity: "unverified", dependency, message: `Cannot read scripts/model_data.lua in the destination, so stock model "${dependency.name}" (used by ${dependency.owner}) is unverified.` });
      else if (!stock.has(dependency.name) && !definedElsewhere(destination, dependency.name)) issues.push({ severity: "error", dependency, message: `Stock model "${dependency.name}" used by ${dependency.owner} is not defined in the destination installation. Use "Customise model" to copy it into the project, or choose another model.` });
      else verified++;
      continue;
    }
    const found = reader.resolve(dependency.name);
    if (found.state === "missing" || found.state === "refused" || found.state === "archive-unreadable") {
      issues.push({ severity: "error", dependency, message: `${dependency.name} (used by ${dependency.owner}) cannot be loaded from the destination: ${found.detail ?? found.state}. The ship would not load there.` });
      continue;
    }
    if (found.state === "unsupported-format") {
      issues.push({ severity: "warning", dependency, message: `${dependency.name}: ${found.detail}` });
    }
    verified++;
    if (sourceReader !== null) {
      const here = reader.hash(dependency.name), there = sourceReader.hash(dependency.name);
      if (there === null) issues.push({ severity: "unverified", dependency, message: `${dependency.name}: the model source no longer provides it, so its content could not be compared with the destination's.` });
      else if (here !== null && here !== there) issues.push({ severity: "warning", dependency, message: `${dependency.name} exists in both installations but with different content: the ship will look as the destination's file, not as previewed from the model source.` });
    }
  }
  return { dependencies, issues, verified };
}
