import type { EELibrary, EEProject } from "@forge/contracts";
import type { FieldSpec, OptionSource } from "@forge/core/editor";

/**
 * What fills a `select`.
 *
 * Two sources, merged in one place because both inspectors need the same
 * answer: the scanned EE install (what the engine already has) and the open
 * project (what the author just made). Project entries come first — they
 * are the ones being worked on — and `copyOf` is deliberately *not*
 * merged, because EE exposes no `getShipTemplate()` and a stock name there
 * would only fail at build time.
 */
export function optionsFor(
  spec: FieldSpec,
  project: EEProject | null,
  library: EELibrary | null,
): readonly string[] | null {
  if (spec.options !== undefined) return spec.options;
  const source = spec.optionsFrom;
  if (source === undefined) return null;

  const own = projectOptions(source, project);
  const fromLibrary = libraryOptions(source, library);
  if (fromLibrary === null && own.length === 0) return null;
  return [...new Set([...own, ...(fromLibrary ?? [])])];
}

function projectOptions(source: OptionSource, project: EEProject | null): readonly string[] {
  if (project === null) return [];
  switch (source) {
    case "factions":
      return project.factions.map((f) => f.name);
    case "models":
      return project.models.map((m) => m.name);
    case "shipTemplates":
    case "stationTemplates":
    case "playerTemplates":
    case "projectTemplates":
      return project.templates.map((t) => t.name);
    case "radarTraces":
    case "planetTextures":
    case "sounds":
    case "textures":
      return [];
  }
}

function libraryOptions(source: OptionSource, library: EELibrary | null): readonly string[] | null {
  if (library === null) return null;
  switch (source) {
    case "factions":
      return library.factions.map((f) => f.name);
    case "shipTemplates":
      return library.templates.filter((t) => t.kind === "ship").map((t) => t.name);
    case "stationTemplates":
      return library.templates.filter((t) => t.kind === "station").map((t) => t.name);
    case "playerTemplates":
      return library.templates.filter((t) => t.kind === "playership").map((t) => t.name);
    case "models":
      return library.models.map((m) => m.name);
    case "radarTraces":
      return library.resources.radarTraces.map((p) => p.replace(/^radar\//, ""));
    case "planetTextures":
      return library.resources.planetTextures;
    case "sounds":
      return library.resources.sounds;
    case "textures":
      return library.resources.textures;
    // The install's templates are not copyable: EE has no getShipTemplate(),
    // so `copy()` can only chain off a template this project defines.
    case "projectTemplates":
      return [];
  }
}
