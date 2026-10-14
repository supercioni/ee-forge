import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EEProject } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import {
  addSector,
  assignGroupToSector,
  assignMarkerToSector,
  checkSectorLabel,
  countsOfSector,
  danglingSectors,
  removeSector,
  renameSector,
  sectorLabel,
  sectorOfObject,
} from "../src/editor/sectors.js";
import { createMarker, createObject, starterProject } from "../src/editor/factories.js";
import { importProject, serializeProject } from "../src/project/migrate.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";
import { echoExtension } from "./fixtures/echo-extension.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PROJECTS = ["forge_demo"];
const load = (id: string): EEProject => importProject(JSON.parse(readFileSync(join(repo, "projects", id, "project.json"), "utf8"))).project;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function twoSystems(): EEProject {
  const base = starterProject("t", "T");
  const p = clone(base);
  p.map.sectors = [{ id: "a", label: "System A" }, { id: "b", label: "System B" }];
  p.map.groups = [
    { id: "player", label: "Player", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "pl", { x: 0, y: 0 }, {})] },
    { id: "a_env", label: "A env", when: "on_start", sector: "a", objects: [createObject("Asteroid", "r1", { x: 10, y: 10 }, {})] },
    { id: "b_env", label: "B env", when: "on_start", sector: "b", objects: [createObject("Asteroid", "r2", { x: 10, y: 10 }, {})] },
    { id: "b_wave", label: "B wave", when: "on_call", sector: "b", objects: [createObject("Mine", "m1", { x: 5, y: 5 }, {})] },
  ];
  p.map.markers = [createMarker("gate", "Gate", { x: 1, y: 1 }, "a"), createMarker("home", "Home", { x: 2, y: 2 }, null)];
  return p;
}

describe("sectors: organisation only", () => {
  it("a new project starts with one sector holding its starter group", () => {
    const p = starterProject("n", "N");
    expect(p.map.sectors).toEqual([{ id: "sector-1", label: "Sector 1" }]);
    expect(p.map.groups.every((g) => g.sector === "sector-1")).toBe(true);
  });

  it("moves a group between sectors without touching anything else, and keeps the order of map.groups", () => {
    const p = twoSystems();
    const moved = assignGroupToSector(p, "b_wave", "a");
    expect(moved.map.groups.map((g) => g.id)).toEqual(p.map.groups.map((g) => g.id));
    expect(moved.map.groups.find((g) => g.id === "b_wave")!.sector).toBe("a");
    const strip = (x: EEProject) => ({ ...x, map: { ...x.map, groups: x.map.groups.map(({ sector: _s, ...g }) => g) } });
    expect(strip(moved)).toEqual(strip(p));
    // ids, coordinates, properties, When: all inside "objects" and "when" — compared above; and the logic is the same object.
    expect(moved.logic).toBe(p.logic);
    expect(moved.map.groups.find((g) => g.id === "b_wave")!.when).toBe("on_call");
  });

  it("moving to Shared and back is a round trip", () => {
    const p = twoSystems();
    expect(assignGroupToSector(assignGroupToSector(p, "a_env", null), "a_env", "a")).toEqual(p);
    expect(assignGroupToSector(p, "a_env", "a")).toBe(p);
    expect(assignGroupToSector(p, "a_env", "ghost")).toBe(p);
  });

  it("files a marker under a sector or Shared and keeps its id, position and notes", () => {
    const p = twoSystems();
    const moved = assignMarkerToSector(p, "gate", "b");
    const before = p.map.markers.find((m) => m.id === "gate")!;
    const after = moved.map.markers.find((m) => m.id === "gate")!;
    expect({ ...after, sector: before.sector }).toEqual(before);
    expect(after.sector).toBe("b");
    expect(assignMarkerToSector(moved, "gate", null).map.markers.find((m) => m.id === "gate")!.sector).toBeNull();
  });

  it("creates and renames sectors with unique, non-empty, non-reserved names", () => {
    const p = twoSystems();
    const added = addSector(p, "System C");
    expect(added.ok && added.id).toBe("system_c");
    expect(addSector(p, "  ").ok).toBe(false);
    expect(addSector(p, "system a").ok).toBe(false);
    expect(addSector(p, "Shared").ok).toBe(false);
    const renamed = renameSector(p, "a", "Kepler");
    expect(renamed.ok && sectorLabel(renamed.project, "a")).toBe("Kepler");
    // Renaming changes the label and nothing else: the id every group points at is the same.
    expect(renamed.ok && renamed.project.map.groups).toEqual(p.map.groups);
    expect(renameSector(p, "a", "System B").ok).toBe(false);
    expect(checkSectorLabel(p, "System A", "a")).toBeNull();
  });

  it("never deletes what a sector holds: a non-empty sector needs a destination", () => {
    const p = twoSystems();
    const refused = removeSector(p, "b");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toMatch(/Choose where they go/);
    expect(removeSector(p, "b", "b").ok).toBe(false);
    expect(removeSector(p, "b", "ghost").ok).toBe(false);
    const toA = removeSector(p, "b", "a");
    expect(toA.ok).toBe(true);
    if (toA.ok) {
      expect(toA.project.map.sectors.map((s) => s.id)).toEqual(["a"]);
      expect(toA.project.map.groups.map((g) => g.id)).toEqual(p.map.groups.map((g) => g.id));
      expect(toA.project.map.groups.find((g) => g.id === "b_wave")!.sector).toBe("a");
      expect(toA.moved).toEqual({ groups: 2, objects: 2, markers: 0 });
    }
    const toShared = removeSector(p, "a", null);
    expect(toShared.ok && toShared.project.map.markers.find((m) => m.id === "gate")!.sector).toBeNull();
  });

  it("an empty sector can simply be deleted", () => {
    const p = addSector(twoSystems(), "Empty");
    expect(p.ok).toBe(true);
    if (p.ok) {
      const gone = removeSector(p.project, p.id);
      expect(gone.ok && gone.project.map.sectors.map((s) => s.id)).toEqual(["a", "b"]);
    }
  });

  it("counts and locates", () => {
    const p = twoSystems();
    expect(countsOfSector(p, "b")).toEqual({ groups: 2, objects: 2, markers: 0 });
    expect(countsOfSector(p, null)).toEqual({ groups: 1, objects: 1, markers: 1 });
    expect(sectorOfObject(p, "m1")).toBe("b");
    expect(sectorOfObject(p, "nope")).toBeUndefined();
  });

  it("reports groups filed under a sector that is not there", () => {
    const p = twoSystems();
    p.map.groups[1]!.sector = "ghost";
    expect(danglingSectors(p)).toEqual([{ kind: "group", id: "a_env", label: "A env", sector: "ghost" }]);
  });
});

describe("sector operations leave the exported Lua byte-identical", () => {
  for (const id of PROJECTS) {
    it(`${id}: reorganising sectors changes no generated file, on both targets`, () => {
      const project = load(id);
      // Reorganise hard: new sectors, every group to a different place (round-robin incl. Shared), markers too, one sector renamed.
      let p = project;
      const a = addSector(p, "System A");
      expect(a.ok).toBe(true);
      if (!a.ok) return;
      p = a.project;
      const b = addSector(p, "System B");
      if (!b.ok) return;
      p = b.project;
      const places: (string | null)[] = [a.id, b.id, null];
      p.map.groups.forEach((g, i) => {
        p = assignGroupToSector(p, g.id, places[i % 3]!);
      });
      p.map.markers.forEach((m, i) => {
        p = assignMarkerToSector(p, m.id, places[(i + 1) % 3]!);
      });
      const renamed = renameSector(p, a.id, "Kepler");
      if (renamed.ok) p = renamed.project;
      expect(JSON.stringify(p)).not.toBe(JSON.stringify(project));
      for (const target of [TARGET_2024, TARGET_2026]) {
        const catalog = loadCatalog(target);
        const options = { sourceHash: "same", extensions: [echoExtension] };
        const before = buildProject(catalog, { ...project, eeVersion: target }, options);
        const after = buildProject(catalog, { ...p, eeVersion: target }, options);
        expect(after.files).toEqual(before.files);
        expect(after.warnings).toEqual(before.warnings);
      }
    });
  }

  it("a reorganised document still round-trips through save and import", () => {
    const p = twoSystems();
    const text = serializeProject(p);
    expect(serializeProject(importProject(JSON.parse(text)).project)).toBe(text);
  });
});

describe("migration 0003 on the demonstration projects", () => {
  for (const id of PROJECTS) {
    it(`${id}: one initial sector, everything filed in it, nothing else changed`, () => {
      const raw = JSON.parse(readFileSync(join(repo, "projects", id, "project.json"), "utf8")) as { map: { groups: unknown[]; markers?: unknown[] } };
      const imported = importProject(raw);
      const p = imported.project;
      expect(imported.applied).toContain("0003-sectors");
      expect(p.map.sectors).toEqual([{ id: "sector-1", label: "Sector 1" }]);
      expect(p.map.groups.every((g) => g.sector === "sector-1")).toBe(true);
      expect(p.map.markers.every((m) => m.sector === "sector-1")).toBe(true);
      // Same groups, same order, same objects (a name never decides membership).
      expect(p.map.groups.map((g) => g.id)).toEqual((raw.map.groups as { id: string }[]).map((g) => g.id));
      expect(p.map.groups.map((g) => g.objects)).toEqual(importProject(raw).project.map.groups.map((g) => g.objects));
      expect(imported.lost).toEqual([]);
    });
  }

  it("keeps sectors that are already there and files unfiled groups under the first", () => {
    const raw = JSON.parse(readFileSync(join(repo, "projects", "forge_demo", "project.json"), "utf8")) as { map: Record<string, unknown> };
    const withSectors = { ...raw, schemaVersion: 2, map: { ...raw.map, sectors: [{ id: "home", label: "Home" }] } };
    const p = importProject(withSectors).project;
    expect(p.map.sectors).toEqual([{ id: "home", label: "Home" }]);
    expect(p.map.groups.every((g) => g.sector === "home")).toBe(true);
  });
});
