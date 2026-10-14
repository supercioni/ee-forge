import { emptyEEProject, type EEProject } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { createObject } from "../src/editor/factories.js";
import {
  NO_VIEW_PREFS,
  blockOfObject,
  describeBlock,
  dropUnshown,
  exitIsolation,
  firstBlock,
  isGroupLocked,
  isGroupShown,
  isolate,
  parseViewPrefs,
  pruneViewPrefs,
  showAll,
  shownGroups,
  shownMarkers,
  sweepableGroups,
  toggleHidden,
  toggleLocked,
} from "../src/editor/view-state.js";

function project(): EEProject {
  const base = emptyEEProject("v", "V");
  return {
    ...base,
    map: {
      sectors: [],
      markers: [],
      groups: [
        { id: "env", label: "Environment", when: "on_start", objects: [createObject("Asteroid", "a1", { x: 0, y: 0 }, {})] },
        { id: "stations", label: "Stations", when: "on_start", objects: [createObject("SpaceStation", "s1", { x: 10, y: 0 }, {})] },
        { id: "wave", label: "Wave", when: "on_call", objects: [createObject("Mine", "m1", { x: 20, y: 0 }, {})] },
      ],
    },
  };
}

describe("view state", () => {
  it("starts with everything shown and nothing locked", () => {
    const p = project();
    expect(shownGroups(p, NO_VIEW_PREFS).map((g) => g.id)).toEqual(["env", "stations", "wave"]);
    expect(isGroupLocked(NO_VIEW_PREFS, "env")).toBe(false);
  });

  it("hides and shows a group, and keeps the others", () => {
    const p = project();
    const hidden = toggleHidden(NO_VIEW_PREFS, "stations");
    expect(shownGroups(p, hidden).map((g) => g.id)).toEqual(["env", "wave"]);
    expect(shownGroups(p, toggleHidden(hidden, "stations")).map((g) => g.id)).toEqual(["env", "stations", "wave"]);
  });

  it("isolation shows only the chosen group, even one that was hidden, and leaving restores exactly what was before", () => {
    const p = project();
    const before = toggleHidden(toggleHidden(NO_VIEW_PREFS, "env"), "wave");
    const alone = isolate(before, "wave");
    expect(shownGroups(p, alone).map((g) => g.id)).toEqual(["wave"]);
    expect(isGroupShown(alone, p.map.groups[1]!)).toBe(false);
    const after = exitIsolation(alone);
    expect(after).toEqual(before);
    expect(shownGroups(p, after).map((g) => g.id)).toEqual(["stations"]);
  });

  it("Show all clears hidden groups and isolation but not locks", () => {
    const p = project();
    const prefs = toggleLocked(isolate(toggleHidden(NO_VIEW_PREFS, "env"), "wave"), "stations");
    const all = showAll(p, prefs);
    expect(shownGroups(p, all)).toHaveLength(3);
    expect(all.locked).toEqual(["stations"]);
  });

  it("a locked group blocks its objects with the reason; a hidden one too; locked wins", () => {
    const p = project();
    const locked = toggleLocked(NO_VIEW_PREFS, "env");
    expect(blockOfObject(p, locked, "a1")?.kind).toBe("locked");
    expect(blockOfObject(p, locked, "s1")).toBeNull();
    const hiddenToo = toggleHidden(locked, "env");
    expect(blockOfObject(p, hiddenToo, "a1")?.kind).toBe("locked");
    const hidden = toggleHidden(NO_VIEW_PREFS, "stations");
    const block = firstBlock(p, hidden, ["a1", "s1"]);
    expect(block?.kind).toBe("hidden");
    expect(describeBlock(block!)).toMatch(/Stations.*hidden/);
    expect(firstBlock(p, NO_VIEW_PREFS, ["a1", "s1"])).toBeNull();
  });

  it("an object isolated away from view is not editable either", () => {
    const p = project();
    expect(blockOfObject(p, isolate(NO_VIEW_PREFS, "wave"), "a1")?.kind).toBe("hidden");
  });

  it("a selection that turns hidden loses exactly the hidden members, and says how many", () => {
    const p = project();
    const prefs = toggleHidden(NO_VIEW_PREFS, "stations");
    const kept = dropUnshown(p, prefs, ["a1", "s1", "m1"], []);
    expect(kept.selection).toEqual(["a1", "m1"]);
    expect(kept.droppedObjects).toBe(1);
  });

  it("a locked selection stays selected (it can be consulted)", () => {
    const p = project();
    const kept = dropUnshown(p, toggleLocked(NO_VIEW_PREFS, "env"), ["a1"], []);
    expect(kept.selection).toEqual(["a1"]);
  });

  it("a rubber band never sweeps hidden or locked groups", () => {
    const p = project();
    const prefs = toggleLocked(toggleHidden(NO_VIEW_PREFS, "wave"), "env");
    expect(sweepableGroups(p, prefs).map((g) => g.id)).toEqual(["stations"]);
  });

  it("prunes ids that no longer exist and returns the same object when nothing changes", () => {
    const p = project();
    const clean = toggleLocked(toggleHidden(NO_VIEW_PREFS, "env"), "wave");
    expect(pruneViewPrefs(clean, p)).toBe(clean);
    const stale = { hidden: ["env", "ghost"], locked: ["gone"], isolated: "nope", sector: "vanished" };
    expect(pruneViewPrefs(stale, p)).toEqual({ hidden: ["env"], locked: [], isolated: null, sector: null });
  });

  it("reads storage tolerantly", () => {
    expect(parseViewPrefs(null)).toEqual(NO_VIEW_PREFS);
    expect(parseViewPrefs("x")).toEqual(NO_VIEW_PREFS);
    expect(parseViewPrefs({ hidden: ["a", 3, "a"], locked: "no", isolated: 4 })).toEqual({ hidden: ["a"], locked: [], isolated: null, sector: null });
  });
});

describe("markers under isolation", () => {
  it("places step aside while one group is isolated, and come back after", () => {
    const base = project();
    const p: EEProject = { ...base, map: { ...base.map, markers: [{ id: "gate", label: "Gate", position: { x: 1, y: 1 }, notes: null }] } };
    expect(shownMarkers(p, NO_VIEW_PREFS)).toHaveLength(1);
    expect(shownMarkers(p, isolate(NO_VIEW_PREFS, "env"))).toHaveLength(0);
  });
});
