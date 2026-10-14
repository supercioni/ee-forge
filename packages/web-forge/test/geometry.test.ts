import { describe, expect, it } from "vitest";
import { emptyEEProject, type EELibrary, type EEProject } from "@forge/contracts";
import { createObject } from "@forge/core/editor";
import { factionColors, objectColor } from "../src/canvas/geometry.js";

/**
 * Map colours. The question an author asks looking at the canvas is
 * "whose is that?", so a factioned object wears its faction's colour —
 * EmptyEpsilon's own `setGMColor`, read from the scanned install or from
 * the project's own factions.
 */

const library = {
  eeVersion: "EE-2024.12.08",
  installPath: "/tmp",
  scannedAt: "now",
  templates: [],
  models: [],
  factions: [
    { name: "Kraylor", gmColor: [255, 0, 0], enemies: [], friends: [], sourceFile: "f.lua" },
    { name: "Human Navy", gmColor: [255, 255, 255], enemies: [], friends: [], sourceFile: "f.lua" },
    { name: "Ghosts", gmColor: null, enemies: [], friends: [], sourceFile: "f.lua" },
  ],
  resources: { textures: [], models: [], sounds: [], scripts: [] },
  warnings: [],
} as unknown as EELibrary;

const ship = (faction: string) =>
  createObject("CpuShip", "s", { x: 0, y: 0 }, { faction });

describe("faction colours", () => {
  it("gives an object its faction's colour, not its type's", () => {
    // The bug this exists for: every CpuShip drew red whatever its
    // allegiance, so changing the faction in the inspector changed nothing.
    const colors = factionColors(null, library);
    expect(objectColor(ship("Kraylor"), colors)).toBe("rgb(255, 0, 0)");
    expect(objectColor(ship("Human Navy"), colors)).toBe("rgb(255, 255, 255)");
  });

  it("distinguishes two ships of different factions", () => {
    const colors = factionColors(null, library);
    expect(objectColor(ship("Kraylor"), colors)).not.toBe(
      objectColor(ship("Human Navy"), colors),
    );
  });

  it("lets a project's own faction override a stock name", () => {
    // `validateProject` resolves faction references project-first; the
    // canvas has to show what will actually load.
    const project: EEProject = {
      ...emptyEEProject("p", "P"),
      factions: [
        {
          id: "kraylor",
          name: "Kraylor",
          localeName: null,
          gmColor: [0, 128, 255],
          description: null,
          enemies: [],
          friends: [],
        },
      ],
    };
    const colors = factionColors(project, library);
    expect(objectColor(ship("Kraylor"), colors)).toBe("rgb(0, 128, 255)");
  });

  it("falls back to the type's colour for a faction nobody defines", () => {
    // A typo the build warns about. Showing the type colour beats
    // inventing one, and beats drawing nothing.
    const colors = factionColors(null, library);
    expect(objectColor(ship("Klingon"), colors)).toBe(objectColor(ship("Klingon")));
  });

  it("falls back for a faction that never set a GM colour", () => {
    const colors = factionColors(null, library);
    expect(colors.has("Ghosts")).toBe(false);
    expect(objectColor(ship("Ghosts"), colors)).toBe(objectColor(ship("Ghosts")));
  });

  it("leaves objects with no faction to the type palette", () => {
    const colors = factionColors(null, library);
    const planet = createObject("Planet", "p", { x: 0, y: 0 });
    expect(objectColor(planet, colors)).toBe(objectColor(planet));
  });
});
