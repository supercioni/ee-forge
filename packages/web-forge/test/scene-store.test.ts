import { emptyEEProject, type EEProject } from "@forge/contracts";
import { createObject, createTemplate } from "@forge/core/editor";
import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "../src/store/editor.js";

function project(): EEProject {
  const base = emptyEEProject("t", "T");
  return {
    ...base,
    map: {
      sectors: [],
      markers: [],
      groups: [
        { id: "a", label: "Start", when: "on_start", objects: [createObject("Mine", "m1", { x: 0, y: 0 }, { callsign: "MN-01" })] },
        { id: "b", label: "Wave", when: "on_call", objects: [createObject("Mine", "m2", { x: 5, y: 5 }, { callsign: "MN-01" })] },
      ],
    },
    logic: {
      ...base.logic,
      rules: [
        {
          id: "r1",
          label: "Go",
          once: true,
          when: { kind: "always" },
          conditions: [],
          actions: [{ kind: "spawn_group", groupId: "b" }],
        },
      ],
    },
  };
}

beforeEach(() => {
  useEditor.setState({
    project: project(),
    dirty: false,
    selection: [],
    markerSelection: [],
    activeGroupId: "a",
    view: "map",
    logicSelection: null,
    sceneFilter: { query: "", type: "" },
    collapsedGroups: [],
  });
});

describe("the scene panel's state", () => {
  it("choosing the active group does not forget the selection", () => {
    useEditor.getState().select(["m1"]);
    useEditor.getState().setActiveGroup("b");
    expect(useEditor.getState().activeGroupId).toBe("b");
    expect(useEditor.getState().selection).toEqual(["m1"]);
  });

  it("focusing an object in another group selects exactly it and makes its group the active one", () => {
    useEditor.getState().select(["m1"]);
    useEditor.getState().focusObject("m2");
    expect(useEditor.getState().selection).toEqual(["m2"]);
    expect(useEditor.getState().activeGroupId).toBe("b");
    useEditor.getState().focusObject("no-such");
    expect(useEditor.getState().selection).toEqual(["m2"]);
  });

  it("searching changes neither the selection nor the project, and does not make it unsaved", () => {
    useEditor.getState().select(["m1", "m2"]);
    const before = JSON.stringify(useEditor.getState().project);
    useEditor.getState().setSceneFilter({ query: "zzz" });
    useEditor.getState().setSceneFilter({ type: "Zone" });
    expect(useEditor.getState().selection).toEqual(["m1", "m2"]);
    expect(JSON.stringify(useEditor.getState().project)).toBe(before);
    expect(useEditor.getState().dirty).toBe(false);
    expect(useEditor.getState().sceneFilter).toEqual({ query: "zzz", type: "Zone" });
  });

  it("folds and unfolds a group, idempotently", () => {
    const { toggleGroupCollapsed } = useEditor.getState();
    toggleGroupCollapsed("a");
    expect(useEditor.getState().collapsedGroups).toEqual(["a"]);
    toggleGroupCollapsed("a", true);
    expect(useEditor.getState().collapsedGroups).toEqual(["a"]);
    toggleGroupCollapsed("a", false);
    expect(useEditor.getState().collapsedGroups).toEqual([]);
  });
});

describe("opening a reference from “Used by”", () => {
  it("goes to Mission and selects the rule, keeping the object selected", () => {
    useEditor.getState().select(["m2"]);
    useEditor.getState().openReference({ kind: "rule", id: "r1", label: "Go" });
    const s = useEditor.getState();
    expect(s.view).toBe("narrative");
    expect(s.logicSelection).toEqual({ kind: "rule", id: "r1" });
    expect(s.selection).toEqual(["m2"]);
  });

  it("opens the Mission section that holds what it opens", () => {
    const { openReference } = useEditor.getState();
    openReference({ kind: "beat", id: "b", label: "B" });
    expect(useEditor.getState().missionTab).toBe("timeline");
    openReference({ kind: "gmButton", id: "g", label: "G" });
    expect(useEditor.getState().missionTab).toBe("gm");
    openReference({ kind: "rule", id: "r1", label: "Go" });
    expect(useEditor.getState().missionTab).toBe("rules");
  });

  it("goes to Dialogues for a dialogue node", () => {
    useEditor.getState().openReference({ kind: "dialogueNode", id: "d", nodeId: "n", label: "D · n" });
    expect(useEditor.getState().view).toBe("dialogues");
    expect(useEditor.getState().logicSelection).toEqual({ kind: "dialogueNode", id: "d", nodeId: "n" });
  });

  it("goes to the Map and selects another object that holds the reference", () => {
    useEditor.setState({ view: "narrative" });
    useEditor.getState().openReference({ kind: "object", id: "m2", label: "MN-01" });
    expect(useEditor.getState().view).toBe("map");
    expect(useEditor.getState().selection).toEqual(["m2"]);
  });
});

describe("Fleet: opening an instance and coming back", () => {
  const withShips = (): EEProject => {
    const p = project();
    const ship = (id: string, template: string) => ({ ...createObject("CpuShip", id, { x: 1, y: 1 }, {}), template }) as never;
    return {
      ...p,
      map: { ...p.map, groups: [{ ...p.map.groups[0]!, objects: [ship("s1", "Atlantis"), ship("s2", "Atlantis"), ship("s3", "Other")] }, p.map.groups[1]!] },
    };
  };
  const library = (): never =>
    ({ eeVersion: "EE-2026.09.22PR", installPath: "/ee", scannedAt: "2026-10-01", models: [], factions: [], warnings: [], resources: { radarTraces: [], planetTextures: [], meshes: [], textures: [], sounds: [], packs: [] }, templates: [{ ...createTemplate("x", "Atlantis"), name: "Atlantis", sourceFile: "scripts/shiptemplates/x.lua", copiedFrom: null }] }) as never;

  it("goes to the object on the map and remembers where it came from", () => {
    useEditor.setState({ project: withShips(), view: "ship", returnTo: null });
    useEditor.getState().openInstance("s2", { view: "ship", label: "Fleet" });
    const s = useEditor.getState();
    expect(s.view).toBe("map");
    expect(s.selection).toEqual(["s2"]);
    expect(s.returnTo).toEqual({ view: "ship", label: "Fleet" });
    useEditor.getState().returnToPrevious();
    expect(useEditor.getState().view).toBe("ship");
    expect(useEditor.getState().returnTo).toBeNull();
    expect(useEditor.getState().selection).toEqual(["s2"]);
  });

  it("forgets the way back when the author chooses another view", () => {
    useEditor.setState({ project: withShips(), view: "ship", returnTo: null });
    useEditor.getState().openInstance("s1", { view: "ship", label: "Fleet" });
    useEditor.getState().setView("narrative");
    expect(useEditor.getState().returnTo).toBeNull();
    useEditor.getState().returnToPrevious();
    expect(useEditor.getState().view).toBe("narrative");
  });

  it("keeps the section of the ship form across template switches", () => {
    useEditor.getState().setShipSection("weapons");
    useEditor.getState().selectTemplate("t1");
    expect(useEditor.getState().shipSection).toBe("weapons");
  });

  it("duplicating a template moves no object, and says so", () => {
    const p = withShips();
    useEditor.setState({ project: { ...p, templates: [createTemplate("atl", "Atlantis")] }, status: "" });
    const before = JSON.stringify(useEditor.getState().project?.map);
    useEditor.getState().copyTemplate("atl");
    const s = useEditor.getState();
    expect(JSON.stringify(s.project?.map)).toBe(before);
    expect(s.status).toMatch(/2 object\(s\) using "Atlantis" still use it/);
    expect(s.pendingRetarget).toBeNull();
  });

  it("copying a stock ship moves nothing until the offer is accepted, then moves exactly those objects", () => {
    useEditor.setState({ project: withShips(), library: library(), pendingRetarget: null });
    const before = JSON.stringify(useEditor.getState().project?.map);
    useEditor.getState().copyStockTemplate("Atlantis");
    const s = useEditor.getState();
    expect(JSON.stringify(s.project?.map)).toBe(before);
    expect(s.pendingRetarget?.from).toBe("Atlantis");
    useEditor.getState().applyRetarget();
    const objects = useEditor.getState().project!.map.groups.flatMap((g) => g.objects) as unknown as { id: string; template?: string }[];
    const to = useEditor.getState().project!.templates[0]!.name;
    expect(objects.filter((o) => o.template === to).map((o) => o.id)).toEqual(["s1", "s2"]);
    expect(objects.find((o) => o.id === "s3")?.template).toBe("Other");
    expect((useEditor.getState().library as unknown as { templates: { name: string }[] }).templates.map((t) => t.name)).toEqual(["Atlantis"]);
  });
});

describe("revisions, results and problems", () => {
  const sample = (): EEProject => project();
  it("counts edits, not saves, and starts again when a project is opened", () => {
    useEditor.setState({ project: sample(), dirty: false, revision: 0, savedRevision: 0, verification: null });
    useEditor.getState().updateGroup("a", { label: "One" });
    useEditor.getState().updateGroup("a", { label: "Two" });
    expect(useEditor.getState().revision).toBe(2);
    expect(useEditor.getState().dirty).toBe(true);
    expect(useEditor.getState().savedRevision).toBe(0);
  });

  it("keeps a result's revision so that any later edit makes it out of date", async () => {
    const { freshnessOf } = await import("../src/ui/verification.js");
    useEditor.setState({ project: sample(), dirty: false, revision: 4, savedRevision: 4 });
    const record = { projectId: "t", revision: 4 } as never;
    expect(freshnessOf(record, { projectId: "t", revision: useEditor.getState().revision })).toBe("current");
    useEditor.getState().updateGroup("a", { label: "Edited" });
    expect(freshnessOf(record, { projectId: "t", revision: useEditor.getState().revision })).toBe("outdated");
  });

  it("goes to what a problem is about: an object, a dialogue line, a template field, a variable", () => {
    const p = sample();
    p.templates = [{ ...createTemplate("t1", "Hull"), model: null }];
    p.logic.dialogues = [{ id: "d", label: "D", entry: "n1", nodes: [{ id: "n1", text: "x", replies: [] }, { id: "n2", text: "y", replies: [] }] }] as never;
    useEditor.setState({ project: p, view: "narrative", returnTo: null });
    const { openProblem } = useEditor.getState();
    openProblem({ kind: "object", id: "m2" });
    expect(useEditor.getState()).toMatchObject({ view: "map", selection: ["m2"], activeGroupId: "b" });
    openProblem({ kind: "dialogue", id: "d", nodeId: "n2" });
    expect(useEditor.getState()).toMatchObject({ view: "dialogues", logicSelection: { kind: "dialogueNode", id: "d", nodeId: "n2" } });
    openProblem({ kind: "template", name: "Hull", field: "model" });
    expect(useEditor.getState()).toMatchObject({ view: "ship", selectedTemplateId: "t1", shipSection: "hull", shipJump: "model" });
    openProblem({ kind: "variable", name: "x" });
    expect(useEditor.getState()).toMatchObject({ view: "narrative", missionTab: "variables" });
  });
});
