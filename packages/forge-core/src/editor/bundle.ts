import type { EEProject } from "@forge/contracts";

/**
 * The files a build of this project writes, by name — known before building, so an export or an install can
 * show what it is about to produce. A test builds the demonstration projects and compares: if the generator ever
 * writes another file, that test fails rather than this list quietly going out of date.
 */
export interface PlannedFile {
  readonly name: string;
  readonly kind: "scripts" | "shiptemplates";
  /** What the file is, in the author's words. */
  readonly role: string;
}

export function plannedBundle(project: Pick<EEProject, "id" | "templates" | "models">): readonly PlannedFile[] {
  const files: PlannedFile[] = [
    { name: `scenario_${project.id}.lua`, kind: "scripts", role: "the scenario EmptyEpsilon lists" },
    { name: `${project.id}_content.lua`, kind: "scripts", role: "factions, models and shared content" },
    { name: `${project.id}_map.lua`, kind: "scripts", role: "the map" },
  ];
  if (project.templates.length > 0 || project.models.length > 0) {
    files.push({ name: `${project.id}_templates.lua`, kind: "shiptemplates", role: "your ship templates and models (EmptyEpsilon reads them only at launch)" });
  }
  return files;
}
