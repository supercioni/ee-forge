import { emptyEEProject, type EEProject } from "@forge/contracts";
import { NO_VIEW_PREFS, createMarker, createObject } from "@forge/core/editor";
import { beforeEach, describe, expect, it } from "vitest";
import { effectiveViewPrefs, readViewPrefs, useEditor } from "../src/store/editor.js";

function project(): EEProject {
  const base = emptyEEProject("hop", "Hop");
  return {
    ...base,
    map: {
      sectors: [{ id: "a", label: "System A" }, { id: "b", label: "System B" }],
      groups: [
        { id: "ship", label: "Player ship", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "player", { x: 0, y: 0 }, { callsign: "Hopper" })] },
        { id: "a_env", label: "A env", when: "on_start", sector: "a", objects: [createObject("Asteroid", "rock_a", { x: 100, y: 100 }, {})] },
        { id: "b_env", label: "B env", when: "on_start", sector: "b", objects: [createObject("Asteroid", "rock_b", { x: 100, y: 100 }, {})] },
        { id: "b_wave", label: "B wave", when: "on_call", sector: "b", objects: [createObject("Mine", "mine_b", { x: 300, y: 0 }, {})] },
      ],
      markers: [createMarker("gate_a", "Gate A", { x: 5, y: 5 }, "a"), createMarker("gate_b", "Gate B", { x: 6, y: 6 }, "b"), createMarker("home", "Home", { x: 0, y: 3 }, null)],
    },
    logic: {
      ...base.logic,
      rules: [{ id: "r1", label: "Ambush", once: true, when: { kind: "always" }, conditions: [], actions: [{ kind: "spawn_group", groupId: "b_wave" }] }],
    },
  };
}

const memory = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) },
};

const get = () => useEditor.getState();

beforeEach(() => {
  memory.clear();
  useEditor.setState({
    project: project(),
    dirty: false,
    revision: 0,
    selection: [],
    markerSelection: [],
    activeGroupId: "ship",
    viewPrefs: NO_VIEW_PREFS,
    viewNotice: null,
    markerSector: undefined,
    status: null,
    tool: { kind: "select" },
    pick: null,
  });
});

describe("opening a sector", () => {
  it("is a view change: not an edit, remembered per project", () => {
    const before = get().project;
    get().setOpenSector("a");
    expect(get().viewPrefs.sector).toBe("a");
    expect(get().project).toBe(before);
    expect(get().dirty).toBe(false);
    expect(readViewPrefs("hop").sector).toBe("a");
    expect(readViewPrefs("another").sector).toBeNull();
  });

  it("deselects what is not in the sector any more, and says so; Shared stays selected", () => {
    get().select(["rock_a", "rock_b", "player"]);
    get().setOpenSector("a");
    expect(get().selection).toEqual(["rock_a", "player"]);
    expect(get().status).toMatch(/1 selected item was deselected/);
  });

  it("new objects go to a group of the open sector, not to one that is out of view", () => {
    get().setActiveGroup("b_env");
    get().setOpenSector("a");
    expect(get().activeGroupId).toBe("a_env");
  });

  it("isolation does not follow the author into another sector", () => {
    get().isolateGroup("ship");
    get().setOpenSector("b");
    expect(get().viewPrefs.isolated).toBeNull();
  });

  it("ignores a remembered sector that no longer exists", () => {
    memory.set("exodus.forge.view.hop", JSON.stringify({ hidden: [], locked: [], isolated: null, sector: "gone" }));
    const stored = readViewPrefs("hop");
    expect(stored.sector).toBe("gone");
    const p = get().project!;
    useEditor.setState({ viewPrefs: stored, project: { ...p } });
    expect(get().viewPrefs.sector).toBeNull();
  });

  it("while something is picked, every sector is on screen", () => {
    get().setOpenSector("a");
    const prefs = effectiveViewPrefs({ viewPrefs: get().viewPrefs, pick: { want: "object", prompt: "x" } as never });
    expect(prefs.sector).toBeNull();
    expect(effectiveViewPrefs({ viewPrefs: get().viewPrefs, pick: null }).sector).toBe("a");
  });
});

describe("sectors in the document", () => {
  it("creating a sector adds it, opens it and marks the project changed", () => {
    expect(get().addSector("System C")).toBeNull();
    expect(get().project!.map.sectors.map((s) => s.id)).toEqual(["a", "b", "system_c"]);
    expect(get().viewPrefs.sector).toBe("system_c");
    expect(get().dirty).toBe(true);
  });

  it("refuses an empty, reserved or repeated name and says why", () => {
    expect(get().addSector(" ")).toMatch(/needs a name/);
    expect(get().addSector("Shared")).toMatch(/Shared/);
    expect(get().addSector("system a")).toMatch(/already exists/);
    expect(get().dirty).toBe(false);
  });

  it("renames a sector without touching what is filed in it", () => {
    const groups = get().project!.map.groups;
    expect(get().renameSector("a", "Kepler")).toBeNull();
    expect(get().project!.map.sectors[0]!.label).toBe("Kepler");
    expect(get().project!.map.groups).toBe(groups);
  });

  it("moving a group keeps its ids, coordinates, timing and the order of the list", () => {
    const before = get().project!;
    get().moveGroupToSector("b_wave", "a");
    const after = get().project!;
    expect(after.map.groups.map((g) => g.id)).toEqual(before.map.groups.map((g) => g.id));
    const moved = after.map.groups.find((g) => g.id === "b_wave")!;
    expect(moved.sector).toBe("a");
    expect(moved.when).toBe("on_call");
    expect(moved.objects).toBe(before.map.groups.find((g) => g.id === "b_wave")!.objects);
    expect(after.logic).toBe(before.logic);
    expect(get().dirty).toBe(true);
  });

  it("a group moved out of the open sector leaves the view and says where it went", () => {
    get().setOpenSector("b");
    get().select(["mine_b"]);
    get().moveGroupToSector("b_wave", "a");
    expect(get().selection).toEqual([]);
    expect(get().status).toMatch(/open System A to see it/);
  });

  it("deleting a sector with contents is refused without a destination, and nothing is lost", () => {
    const before = get().project!;
    expect(get().deleteSector("b")).toMatch(/Choose where they go/);
    expect(get().project).toBe(before);
    expect(get().deleteSector("b", "a")).toBeNull();
    const after = get().project!;
    expect(after.map.sectors.map((s) => s.id)).toEqual(["a"]);
    expect(after.map.groups.flatMap((g) => g.objects.map((o) => o.id))).toEqual(before.map.groups.flatMap((g) => g.objects.map((o) => o.id)));
    expect(after.map.markers.find((m) => m.id === "gate_b")!.sector).toBe("a");
  });

  it("deleting the open sector returns the view to All sectors", () => {
    get().setOpenSector("b");
    expect(get().deleteSector("b", null)).toBeNull();
    expect(get().viewPrefs.sector).toBeNull();
  });

  it("a new group is filed where it is told, at the end of the list", () => {
    get().addGroup("Patrol", "on_start", "b");
    const groups = get().project!.map.groups;
    expect(groups[groups.length - 1]).toMatchObject({ id: "patrol", sector: "b", when: "on_start" });
    expect(get().activeGroupId).toBe("patrol");
  });

  it("a marker needs an explicit sector when All sectors is open, and goes to the open sector otherwise", () => {
    get().setTool({ kind: "marker" });
    get().placeAt({ x: 1, y: 1 });
    expect(get().project!.map.markers).toHaveLength(3);
    expect(get().status).toMatch(/Choose which sector/);
    get().setMarkerSector(null);
    get().placeAt({ x: 1, y: 1 });
    expect(get().project!.map.markers.find((m) => m.id === "marker")!.sector).toBeNull();
    get().setOpenSector("b");
    get().setMarkerSector(undefined);
    get().placeAt({ x: 2, y: 2 });
    expect(get().project!.map.markers.find((m) => m.id === "marker_2")!.sector).toBe("b");
  });
});

describe("reaching across sectors", () => {
  it("going to an object of another sector opens that sector, says so, and changes nothing", () => {
    get().setOpenSector("a");
    const before = get().project;
    get().focusObject("mine_b");
    expect(get().viewPrefs.sector).toBe("b");
    expect(get().selection).toEqual(["mine_b"]);
    expect(get().viewNotice).toMatch(/Opened System B to show mine_b/);
    expect(get().project).toBe(before);
    expect(get().dirty).toBe(false);
  });

  it("a Shared object does not change the open sector", () => {
    get().setOpenSector("a");
    get().focusObject("player");
    expect(get().viewPrefs.sector).toBe("a");
    expect(get().viewNotice).toBeNull();
  });

  it("going to a marker or a group of another sector opens it too", () => {
    get().setOpenSector("a");
    get().focusMarker("gate_b");
    expect(get().viewPrefs.sector).toBe("b");
    expect(get().markerSelection).toEqual(["gate_b"]);
    get().setOpenSector("a");
    get().openProblem({ kind: "group", id: "b_wave" });
    expect(get().viewPrefs.sector).toBe("b");
    expect(get().activeGroupId).toBe("b_wave");
  });

  it("opening a rule's target from Used by lands in the right sector and keeps a hidden group hidden (the map says so)", () => {
    get().setOpenSector("a");
    get().toggleGroupHidden("b_wave");
    get().openReference({ kind: "object", id: "mine_b", label: "mine_b" });
    expect(get().viewPrefs.sector).toBe("b");
    expect(get().viewPrefs.hidden).toEqual(["b_wave"]);
    expect(get().selection).toEqual(["mine_b"]);
  });

  it("view state is respected inside a sector: a locked group of the open sector still refuses changes", () => {
    get().setOpenSector("a");
    get().toggleGroupLocked("a_env");
    get().select(["rock_a"]);
    const before = get().project;
    get().moveSelection({ x: 10, y: 0 });
    expect(get().project).toBe(before);
  });

  it("an object outside the open sector cannot be changed through a stale selection", () => {
    get().select(["rock_b"]);
    useEditor.setState({ viewPrefs: { ...NO_VIEW_PREFS, sector: "a" } });
    const before = get().project;
    get().deleteSelection();
    expect(get().project).toBe(before);
    expect(get().status).toMatch(/another sector/);
  });
});

describe("the starting sector (ADR-0056)", () => {
  it("is the document's, an edit; the open sector is not", () => {
    get().setOpenSector("b");
    expect(get().dirty).toBe(false);
    get().setStartSector("a");
    expect(get().project!.map.startSector).toBe("a");
    expect(get().dirty).toBe(true);
    expect(get().viewPrefs.sector).toBe("b"); // unrelated to the sector open in the editor
    expect(get().status).toMatch(/starts in System A/);
    get().setStartSector(null);
    expect(get().project!.map.startSector).toBeNull();
  });

  it("an unknown sector is ignored", () => {
    const before = get().project;
    get().setStartSector("ghost");
    expect(get().project).toBe(before);
  });

  it("the sector the game starts in cannot be deleted, and neither can one a rule jumps to", () => {
    get().setStartSector("a");
    expect(get().deleteSector("a", "b")).toMatch(/starts in/);
    const p = get().project!;
    useEditor.setState({
      project: {
        ...p,
        map: { ...p.map, startSector: "a", markers: [...p.map.markers, createMarker("arr_b", "Arrive B", { x: 1, y: 1 }, "b")] },
        logic: { ...p.logic, rules: [{ id: "j", label: "Jump", once: false, when: { kind: "always" }, conditions: [], actions: [{ kind: "change_sector", sectorId: "b", arrivalMarkerId: "arr_b", rotation: null }] }] },
      },
    });
    expect(get().deleteSector("b", "a")).toMatch(/A rule still uses/);
    expect(get().project!.map.sectors.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
