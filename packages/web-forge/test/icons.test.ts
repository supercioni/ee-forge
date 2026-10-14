import { describe, expect, it } from "vitest";
import type { EELibrary, EEObject } from "@forge/contracts";
import { createObject } from "@forge/core/editor";
import { iconMaskId, iconRotates, radarIconFor } from "../src/canvas/icons.js";

/**
 * The map draws EE's own radar sprites, picked the way EE picks them —
 * from the ship template's `setRadarTrace`. These pin that rule.
 */

const library = {
  eeVersion: "EE-2024.12.08",
  installPath: "/fake",
  scannedAt: "2026-08-09T00:00:00.000Z",
  templates: [
    {
      name: "Phobos T3",
      type: "ship",
      model: null,
      className: null,
      subclassName: null,
      hull: null,
      shields: [],
      radarTrace: "cruiser.png",
      sourceFile: "scripts/shiptemplates/frigates.lua",
      hidden: false,
    },
    {
      name: "Medium Station",
      type: "station",
      model: null,
      className: null,
      subclassName: null,
      hull: null,
      shields: [],
      radarTrace: "mediumstation.png",
      sourceFile: "scripts/shiptemplates/stations.lua",
      hidden: false,
    },
    {
      name: "No Trace",
      type: "ship",
      model: null,
      className: null,
      subclassName: null,
      hull: null,
      shields: [],
      radarTrace: null,
      sourceFile: "x.lua",
      hidden: false,
    },
  ],
  models: [],
  factions: [],
  resources: {
    radarTraces: [],
    planetTextures: [],
    meshes: [],
    textures: [],
    sounds: [],
    packs: [],
  },
  warnings: [],
} satisfies EELibrary;

const at = (type: Parameters<typeof createObject>[0], template?: string): EEObject =>
  createObject(type, "o", { x: 0, y: 0 }, template === undefined ? {} : { template });

describe("radar icon selection", () => {
  it("uses the template's own trace, the way EE does", () => {
    expect(radarIconFor(at("CpuShip", "Phobos T3"), library)).toBe("cruiser.png");
    expect(radarIconFor(at("SpaceStation", "Medium Station"), library)).toBe(
      "mediumstation.png",
    );
  });

  it("falls back to EE's documented defaults when a template sets none", () => {
    expect(radarIconFor(at("CpuShip", "No Trace"), library)).toBe("ship.png");
    expect(radarIconFor(at("CpuShip", "Unknown Hull"), library)).toBe("ship.png");
    // setType("station") implies blip.png in EE.
    expect(radarIconFor(at("SpaceStation", "Unknown Station"), library)).toBe("blip.png");
  });

  it("still picks a sprite with no install scan available", () => {
    expect(radarIconFor(at("CpuShip", "Phobos T3"), null)).toBe("ship.png");
  });

  it("uses fixed sprites for the types EE gives one", () => {
    expect(radarIconFor(at("Mine"), library)).toBe("mine.png");
    expect(radarIconFor(at("ScanProbe"), library)).toBe("probe.png");
    expect(radarIconFor(at("BlackHole"), library)).toBe("blackHole.png");
    expect(radarIconFor(at("WormHole"), library)).toBe("wormHole.png");
  });

  it("leaves geometrically-drawn types without an icon", () => {
    // These are rendered at their true radius, which says more than a glyph.
    for (const type of ["Planet", "Nebula", "Asteroid", "VisualAsteroid", "Zone"] as const) {
      expect(radarIconFor(at(type), library), type).toBeNull();
    }
  });

  it("only gives an artifact a trace when the author set one", () => {
    const plain = at("Artifact");
    expect(radarIconFor(plain, library)).toBeNull();
    expect(
      radarIconFor({ ...plain, type: "Artifact", radarTraceIcon: "arrow.png" } as EEObject, library),
    ).toBe("arrow.png");
  });

  it("rotates hulls but leaves stationary furniture upright, as EE does", () => {
    expect(iconRotates(at("CpuShip"))).toBe(true);
    expect(iconRotates(at("PlayerSpaceship"))).toBe(true);
    expect(iconRotates(at("SpaceStation"))).toBe(false);
    expect(iconRotates(at("Mine"))).toBe(false);
  });

  it("derives CSS-safe mask ids", () => {
    expect(iconMaskId("blackHole.png")).toBe("radar-blackHole-png");
    expect(iconMaskId("exuari_frigate_1.png")).toBe("radar-exuari-frigate-1-png");
  });
});
