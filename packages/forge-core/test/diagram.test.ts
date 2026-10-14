import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EEProjectSchema, emptyEEProject, type EEProject } from "@forge/contracts";
import { buildDiagram, describeEdge, findReferences, groupSpawners } from "../src/editor/index.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demo = (): EEProject => EEProjectSchema.parse(JSON.parse(readFileSync(join(repo, "projects/forge_demo/project.json"), "utf8")));

/** Every way a group can be brought in or waited for, in one project. */
function everyWay(): EEProject {
  const base = emptyEEProject("w", "W");
  return {
    ...base,
    map: {
      sectors: [],
      markers: [],
      groups: [
        { id: "core", label: "Core", when: "on_start", objects: [] },
        { id: "a", label: "A", when: "on_call", objects: [] },
        { id: "b", label: "B", when: "on_call", objects: [] },
        { id: "c", label: "C", when: "on_call", objects: [] },
        { id: "d", label: "D", when: "on_call", objects: [] },
        { id: "never", label: "Never", when: "on_call", objects: [] },
      ],
    },
    logic: {
      ...base.logic,
      variables: [{ name: "alarm", initial: 0 }],
      beats: [{ id: "t", label: "Timed", at: 30, actions: [{ kind: "spawn_group", groupId: "a" }, { kind: "set_variable", name: "alarm", value: 1 }] }],
      gmButtons: [{ id: "g", label: "GM", actions: [{ kind: "spawn_group", groupId: "b" }] }],
      rules: [
        { id: "r", label: "Reads alarm", once: true, when: { kind: "variable_equals", name: "alarm", value: 1 }, conditions: [], actions: [{ kind: "spawn_group", groupId: "c" }, { kind: "destroy", target: { ref: "object", objectId: "sentry" } }] },
        { id: "w", label: "Waits A", once: true, when: { kind: "group_destroyed", groupId: "a" }, conditions: [], actions: [] },
        { id: "o", label: "Waits sentry", once: true, when: { kind: "object_destroyed", objectId: "sentry" }, conditions: [], actions: [] },
      ],
      dialogues: [
        {
          id: "hail",
          label: "Hail",
          entry: "n1",
          nodes: [{ id: "n1", text: "Hi", replies: [{ text: "Call help", target: { kind: "gm" }, conditions: [], actions: [{ kind: "spawn_group", groupId: "d" }] }] }],
        },
      ],
      exodusSteps: [{ id: "s", essential: false, alternative: { kind: "immediate", actions: [{ kind: "spawn_group", groupId: "d" }] }, answerWithinS: null, onSuccess: [] }],
    },
  };
}

describe("the diagram is derived from relations the project states", () => {
  const model = buildDiagram(everyWay());
  const spawners = (group: string): string[] => model.edges.filter((e) => e.kind === "spawns" && e.to === `group:${group}`).map((e) => e.from).sort();

  it("finds a group's spawner in a timed event, a GM control, a rule, a dialogue reply and an EXODUS step's fallback", () => {
    expect(spawners("a")).toEqual(["timed:t"]);
    expect(spawners("b")).toEqual(["gm:g"]);
    expect(spawners("c")).toEqual(["rule:r"]);
    expect(spawners("d")).toEqual(["reply:hail:n1", "step:s"]);
  });

  it("does not call a group that is spawned by something other than a rule “unspawned”", () => {
    for (const id of ["a", "b", "c", "d"]) expect(groupSpawners(everyWay(), id).length, id).toBeGreaterThan(0);
    expect(groupSpawners(everyWay(), "never")).toHaveLength(0);
  });

  it("draws a group wiped-out wait, a variable hand-over and a destroyed object", () => {
    expect(model.edges).toContainEqual({ from: "group:a", to: "rule:w", kind: "wiped", label: "wiped" });
    expect(model.edges).toContainEqual({ from: "timed:t", to: "rule:r", kind: "variable", label: "sets alarm" });
    expect(model.edges).toContainEqual({ from: "rule:r", to: "rule:o", kind: "destroys", label: "destroys sentry" });
  });

  it("every edge ends on drawn nodes and rests on a reference the project actually holds", () => {
    const ids = new Set(model.nodes.map((n) => n.id));
    const project = everyWay();
    for (const edge of model.edges) {
      expect(ids.has(edge.from), edge.from).toBe(true);
      expect(ids.has(edge.to), edge.to).toBe(true);
      if (edge.kind === "spawns") {
        const group = edge.to.slice("group:".length);
        const refs = findReferences(project, "group", group).filter((r) => r.via === "spawn_group");
        expect(refs.length).toBeGreaterThan(0);
      }
    }
  });

  it("never joins two timed events: earlier on the clock is not a cause", () => {
    const withTwo = everyWay();
    withTwo.logic.beats.push({ id: "t2", label: "Later", at: 60, actions: [] });
    const m = buildDiagram(withTwo);
    expect(m.edges.some((e) => e.from.startsWith("timed:") && e.to.startsWith("timed:"))).toBe(false);
  });

  it("puts timed events in clock order and leaves out groups nothing touches", () => {
    const m = buildDiagram(demo());
    const times = m.nodes.filter((n) => n.kind === "timed").map((n) => n.at ?? 0);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(model.nodes.some((n) => n.id === "group:core")).toBe(false);
  });

  it("reads each edge as a sentence", () => {
    const sentence = describeEdge(model, model.edges.find((e) => e.kind === "wiped")!);
    expect(sentence).toBe("Rule “Waits A” waits for Group “A” to be wiped out");
  });

  it("the demo's ambush group is spawned and waited for", () => {
    const m = buildDiagram(demo());
    expect(m.edges.some((e) => e.kind === "spawns" && e.to === "group:ambush")).toBe(true);
  });
});

import { variableInfos } from "../src/editor/index.js";

describe("variables as the project uses them", () => {
  it("lists a declared variable with who sets it and who waits for it", () => {
    const alarm = variableInfos(everyWay()).find((v) => v.name === "alarm")!;
    expect(alarm.declared).toBe(true);
    expect(alarm.initial).toBe(0);
    expect(alarm.writers.map((w) => w.owner.id)).toEqual(["t"]);
    expect(alarm.readers.map((r) => r.owner.id)).toEqual(["r"]);
  });
  it("lists a name that is used but never declared", () => {
    const p = everyWay();
    p.logic.rules.push({ id: "x", label: "X", once: true, when: { kind: "variable_at_least", name: "ghost", value: 1 }, conditions: [], actions: [] });
    const ghost = variableInfos(p).find((v) => v.name === "ghost")!;
    expect(ghost.declared).toBe(false);
    expect(ghost.readers).toHaveLength(1);
    expect(ghost.writers).toHaveLength(0);
  });
  it("keeps an object's variable apart from a scenario variable of the same name", () => {
    const p = everyWay();
    p.map.groups[0]!.objects.push({ ...({ type: "Mine", id: "mine1", callsign: null, position: { x: 0, y: 0 }, description: null, variables: [{ name: "alarm", initial: 5 }] } as never) });
    const infos = variableInfos(p).filter((v) => v.name === "alarm");
    expect(infos.map((v) => v.scope).sort()).toEqual(["object", "scenario"]);
  });
});

describe("declaring a name that is used but not declared", () => {
  const withRule = (when: object, actions: object[] = []) => {
    const p = everyWay();
    p.logic.rules.push({ id: "g", label: "G", once: true, when, conditions: [], actions } as never);
    return p;
  };
  it("suggests a flag when records set or compare it as a flag", () => {
    const info = variableInfos(withRule({ kind: "always" } as never, [{ kind: "set_variable", name: "flagged", value: true }])).find((v) => v.name === "flagged")!;
    expect(info.declared).toBe(false);
    expect(info.suggestedInitial).toBe(false);
  });
  it("suggests text for a text comparison and a number otherwise", () => {
    expect(variableInfos(withRule({ kind: "variable_equals", name: "stage", value: "done" })).find((v) => v.name === "stage")!.suggestedInitial).toBe("");
    expect(variableInfos(withRule({ kind: "variable_at_least", name: "score", value: 3 })).find((v) => v.name === "score")!.suggestedInitial).toBe(0);
  });
  it("keeps the type of a variable that is already declared", () => {
    const p = everyWay();
    p.logic.variables.push({ name: "open", initial: true });
    expect(variableInfos(p).find((v) => v.name === "open")!.suggestedInitial).toBe(false);
  });
});

describe("object variables written through a group or the player", () => {
  it("are matched to the members that declare them, not to a placeholder", () => {
    const p = demo();
    const rows = variableInfos(p).filter((v) => v.scope === "object" && v.name === "alerted");
    expect(rows.map((r) => r.objectId).sort()).toEqual(["corsair_a", "corsair_b"]);
    expect(rows.every((r) => r.declared)).toBe(true);
    expect(rows.every((r) => r.writers.length === 1)).toBe(true);
    expect(variableInfos(p).some((v) => v.objectId === "?")).toBe(false);
  });
  it("shows a member that does not declare it as not declared", () => {
    const p = demo();
    const ambush = p.map.groups.find((g) => g.id === "ambush")!;
    ambush.objects[0]!.variables = [];
    const row = variableInfos(p).find((v) => v.name === "alerted" && v.objectId === ambush.objects[0]!.id)!;
    expect(row.declared).toBe(false);
  });
});
