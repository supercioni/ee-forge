import { describe, expect, it } from "vitest";
import { emptyEEProject, type EELibrary, type EEProject, type EETemplateRef } from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { createObject, createTemplate, diagnose, problemsFor, retargetTemplate, unknownTemplateReferences } from "../src/editor/index.js";

/**
 * A ship whose template does not exist is not a warning: in EE 2026 the map stops being built at that ship, in EE 2024 it
 * is never created, and the log says nothing. Found by playing it (docs/verification/template-ship/before-fix), where
 * Verify passed and the dialog said "Installed — every file written and read back".
 */
const library = (names: Array<[string, string]>): EELibrary => ({
  eeVersion: "EE-2026.09.22PR",
  installPath: "/x",
  scannedAt: "2026-10-21",
  templates: names.map(([name, sourceFile]) => ({ ...createTemplate("x", name), sourceFile, copiedFrom: null }) as EETemplateRef),
  models: [],
  factions: [],
  resources: { radarTraces: [], planetTextures: [], meshes: [], textures: [], sounds: [], packs: [] },
  warnings: [],
});
const STOCK = library([["Atlantis", "scripts/shiptemplates/corvette.lua"]]);

function projectWith(template: string, own: string[] = []): EEProject {
  const base = emptyEEProject("tpl_demo", "Tpl demo");
  const player = { ...createObject("PlayerSpaceship", "player", { x: 0, y: 0 }, {}), template, faction: "Human Navy", callsign: "PS-01" };
  return { ...base, eeVersion: "EE-2026.09.22PR", templates: own.map((n) => ({ ...createTemplate(n.toLowerCase().replace(/\W+/g, "_"), n), model: "small_frigate_1" })), map: { ...base.map, groups: [{ id: "g", label: "G", when: "on_start", sector: null, objects: [player] }] } };
}
const build = (p: EEProject, lib?: EELibrary) => buildProject(loadCatalog(p.eeVersion), p, { sourceHash: "x", ...(lib !== undefined ? { library: lib } : {}) });

describe("a ship that spawns a template nobody defines", () => {
  it("is found, by object, when an install was scanned", () => {
    const found = unknownTemplateReferences(projectWith("Atlantis (copy)"), STOCK);
    expect(found).toEqual([{ objectId: "player", callsign: "PS-01", type: "PlayerSpaceship", template: "Atlantis (copy)" }]);
  });

  it("is not claimed without a scan (nothing is known), and not found when the name is an original or the project's own", () => {
    expect(unknownTemplateReferences(projectWith("Atlantis (copy)"), null)).toEqual([]);
    expect(unknownTemplateReferences(projectWith("Atlantis (copy)"), library([]))).toEqual([]); // an empty scan proves nothing
    expect(unknownTemplateReferences(projectWith("Atlantis"), STOCK)).toEqual([]);
    expect(unknownTemplateReferences(projectWith("Mine B", ["Mine B"]), STOCK)).toEqual([]);
  });

  it("refuses the build with the object, the name and what to do — and the same project builds once the name is right", () => {
    expect(() => build(projectWith("Atlantis (copy)"), STOCK)).toThrow(/PlayerSpaceship "PS-01" spawns the template "Atlantis \(copy\)".*Choose a template/s);
    expect(() => build(projectWith("Atlantis (copy)", ["Atlantis Forge A"]), STOCK)).toThrow();
    expect(() => build(projectWith("Atlantis Forge A", ["Atlantis Forge A"]), STOCK)).not.toThrow();
  });

  it("stays a note without a scan: the build cannot know", () => {
    const built = build(projectWith("Atlantis (copy)"));
    expect(built.warnings.some((w) => /unverified/.test(w))).toBe(true);
  });

  it("is a blocking problem in the list, pointing at the object, exactly when the build refuses", () => {
    const bad = projectWith("Atlantis (copy)");
    const blocking = problemsFor(diagnose(bad, { library: STOCK }), "vanilla").filter((p) => p.severity === "error");
    expect(blocking.map((p) => p.code)).toEqual(["object-unknown-template"]);
    expect(blocking[0]?.where).toEqual({ kind: "object", id: "player" });
    expect(problemsFor(diagnose(projectWith("Atlantis"), { library: STOCK }), "vanilla").filter((p) => p.severity === "error")).toEqual([]);
  });

  it("does not take the project's own installed templates file as proof: it is what the next install replaces", () => {
    // The clone still holds last install's file, which defines a name the project has since renamed away.
    const stale = library([["Atlantis", "scripts/shiptemplates/corvette.lua"], ["Old Name", "scripts/shiptemplates/tpl_demo_templates.lua"]]);
    expect(unknownTemplateReferences(projectWith("Old Name"), stale)).toHaveLength(1);
    expect(() => build(projectWith("Old Name"), stale)).toThrow(/Old Name/);
    // another project's file is an original as far as this one is concerned
    const other = library([["Other Hull", "scripts/shiptemplates/other_templates.lua"]]);
    expect(unknownTemplateReferences(projectWith("Other Hull"), other)).toEqual([]);
  });
});

describe("moving ships onto a copy", () => {
  it("lands on the name the copy has now", () => {
    const p = projectWith("Atlantis", ["Atlantis Forge A"]);
    expect(retargetTemplate(p, "Atlantis", "Atlantis Forge A").map.groups[0]?.objects[0]).toMatchObject({ template: "Atlantis Forge A" });
  });
});
