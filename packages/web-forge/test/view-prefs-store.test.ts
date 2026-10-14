import { emptyEEProject, type EEProject } from "@forge/contracts";
import { NO_VIEW_PREFS, createObject } from "@forge/core/editor";
import { beforeEach, describe, expect, it } from "vitest";
import { readViewPrefs, useEditor } from "../src/store/editor.js";

function project(id = "t"): EEProject {
  const base = emptyEEProject(id, "T");
  return {
    ...base,
    map: {
      sectors: [],
      markers: [],
      groups: [
        { id: "a", label: "Start", when: "on_start", objects: [createObject("Mine", "m1", { x: 0, y: 0 }, { callsign: "MN-01" })] },
        { id: "b", label: "Wave", when: "on_call", objects: [createObject("Mine", "m2", { x: 500, y: 0 }, { callsign: "MN-02" })] },
      ],
    },
  };
}

const memory = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
  },
};

beforeEach(() => {
  memory.clear();
  useEditor.setState({
    project: project(),
    dirty: false,
    revision: 0,
    savedRevision: 0,
    selection: [],
    markerSelection: [],
    activeGroupId: "a",
    viewPrefs: NO_VIEW_PREFS,
    status: null,
    tool: { kind: "select" },
  });
});

describe("map view state (hide, isolate, lock)", () => {
  it("is not an edit: the document, dirty flag and revision stay put", () => {
    const before = useEditor.getState().project;
    useEditor.getState().toggleGroupHidden("a");
    useEditor.getState().toggleGroupLocked("b");
    useEditor.getState().isolateGroup("b");
    useEditor.getState().exitIsolation();
    const s = useEditor.getState();
    expect(s.project).toBe(before);
    expect(s.dirty).toBe(false);
    expect(s.revision).toBe(0);
  });

  it("hiding a group deselects its objects and says so; the others stay selected", () => {
    useEditor.getState().select(["m1", "m2"]);
    useEditor.getState().toggleGroupHidden("a");
    const s = useEditor.getState();
    expect(s.selection).toEqual(["m2"]);
    expect(s.status).toMatch(/1 selected item was deselected/);
  });

  it("isolation then exit restores exactly the previous visibility", () => {
    useEditor.getState().toggleGroupHidden("b");
    const before = useEditor.getState().viewPrefs;
    useEditor.getState().isolateGroup("b");
    expect(useEditor.getState().viewPrefs.isolated).toBe("b");
    useEditor.getState().exitIsolation();
    expect(useEditor.getState().viewPrefs).toEqual(before);
  });

  it("while isolating, the other groups' visibility cannot be toggled", () => {
    useEditor.getState().isolateGroup("a");
    useEditor.getState().toggleGroupHidden("b");
    expect(useEditor.getState().viewPrefs.hidden).toEqual([]);
  });

  it("Show all brings back hidden groups and leaves isolation", () => {
    useEditor.getState().toggleGroupHidden("a");
    useEditor.getState().showAllGroups();
    useEditor.getState().isolateGroup("b");
    useEditor.getState().showAllGroups();
    expect(useEditor.getState().viewPrefs).toEqual({ hidden: [], locked: [], isolated: null, sector: null });
  });

  it("a locked group refuses move, delete, edit and rename — and keeps the object selected for reading", () => {
    useEditor.getState().toggleGroupLocked("a");
    useEditor.getState().select(["m1"]);
    expect(useEditor.getState().selection).toEqual(["m1"]);
    const before = useEditor.getState().project;
    useEditor.getState().moveSelection({ x: 100, y: 0 });
    expect(useEditor.getState().project).toBe(before);
    expect(useEditor.getState().status).toMatch(/locked/);
    useEditor.getState().deleteSelection();
    useEditor.getState().updateObject("m1", { callsign: "XX" } as never);
    useEditor.getState().renameObject("m1", "renamed");
    expect(useEditor.getState().project).toBe(before);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("a mixed selection is refused whole, not half-moved", () => {
    useEditor.getState().toggleGroupLocked("a");
    useEditor.getState().select(["m1", "m2"]);
    const before = useEditor.getState().project;
    useEditor.getState().moveSelection({ x: 100, y: 0 });
    expect(useEditor.getState().project).toBe(before);
  });

  it("unlocking allows the change again", () => {
    useEditor.getState().toggleGroupLocked("a");
    useEditor.getState().toggleGroupLocked("a");
    useEditor.getState().select(["m1"]);
    useEditor.getState().moveSelection({ x: 100, y: 0 });
    expect(useEditor.getState().dirty).toBe(true);
    expect(useEditor.getState().project?.map.groups[0]?.objects[0]?.position.x).toBe(100);
  });

  it("an object of a hidden group cannot be changed unseen (reached from the list)", () => {
    useEditor.getState().toggleGroupHidden("b");
    useEditor.getState().focusObject("m2");
    expect(useEditor.getState().selection).toEqual(["m2"]);
    useEditor.getState().deleteSelection();
    expect(useEditor.getState().project?.map.groups[1]?.objects).toHaveLength(1);
    expect(useEditor.getState().status).toMatch(/hidden/);
  });

  it("nothing is placed into a locked or hidden active group", () => {
    useEditor.getState().toggleGroupLocked("a");
    useEditor.getState().setTool({ kind: "place", type: "Mine" });
    useEditor.getState().placeAt({ x: 5, y: 5 });
    expect(useEditor.getState().project?.map.groups[0]?.objects).toHaveLength(1);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("a locked group cannot be renamed, re-timed or deleted", () => {
    useEditor.getState().toggleGroupLocked("a");
    const before = useEditor.getState().project;
    useEditor.getState().updateGroup("a", { label: "Other" });
    useEditor.getState().updateGroup("a", { when: "on_call" });
    useEditor.getState().deleteGroup("a");
    expect(useEditor.getState().project).toBe(before);
  });

  it("is remembered per project and does not leak into another", () => {
    useEditor.getState().toggleGroupHidden("a");
    useEditor.getState().toggleGroupLocked("b");
    expect(readViewPrefs("t")).toEqual({ hidden: ["a"], locked: ["b"], isolated: null, sector: null });
    expect(readViewPrefs("other")).toEqual(NO_VIEW_PREFS);
  });

  it("forgets groups that are gone, in the state and in storage", () => {
    useEditor.getState().toggleGroupHidden("b");
    useEditor.getState().deleteGroup("b");
    expect(useEditor.getState().viewPrefs).toEqual(NO_VIEW_PREFS);
    expect(readViewPrefs("t")).toEqual(NO_VIEW_PREFS);
    // A group removed some other way (a reload of the document, say) takes its lock with it.
    useEditor.getState().toggleGroupLocked("a");
    const only = useEditor.getState().project!;
    useEditor.setState({ project: { ...only, map: { ...only.map, groups: [] } } });
    expect(useEditor.getState().viewPrefs).toEqual(NO_VIEW_PREFS);
  });

  it("ignores stored ids that no longer exist when a project is read", () => {
    memory.set("exodus.forge.view.t", JSON.stringify({ hidden: ["a", "ghost"], locked: ["gone"], isolated: "nope" }));
    expect(readViewPrefs("t").hidden).toEqual(["a", "ghost"]);
  });
});
