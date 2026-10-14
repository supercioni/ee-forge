import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EEProjectSchema, emptyEEProject, type EEProject } from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { simulate } from "../src/logic/simulate.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function demoProject(): EEProject {
  return EEProjectSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "projects/forge_demo/project.json"), "utf8")),
  );
}

function projectWith(logic: Partial<EEProject["logic"]>): EEProject {
  const base = emptyEEProject("sim", "Sim");
  return { ...base, logic: { ...base.logic, ...logic } };
}

describe("beat scheduling", () => {
  it("fires beats in ascending time order", () => {
    const project = projectWith({
      beats: [
        { id: "second", label: "b", at: 30, actions: [] },
        { id: "first", label: "a", at: 10, actions: [] },
      ],
    });
    const result = simulate(project, { untilSeconds: 60 });
    expect(result.firings.map((f) => f.id)).toEqual(["first", "second"]);
  });

  it("fires every beat a long tick skipped, in order", () => {
    // Matches the emitted `while` loop: a 60 s step must not swallow the
    // beats it jumped over (docs/authoring/scenarios.md).
    const project = projectWith({
      beats: [
        { id: "a", label: "a", at: 5, actions: [] },
        { id: "b", label: "b", at: 15, actions: [] },
        { id: "c", label: "c", at: 25, actions: [] },
      ],
    });
    const result = simulate(project, { untilSeconds: 60, stepSeconds: 60 });
    expect(result.firings.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("never re-fires a beat", () => {
    const project = projectWith({
      beats: [{ id: "once", label: "once", at: 0, actions: [] }],
    });
    const result = simulate(project, { untilSeconds: 120 });
    expect(result.firings.filter((f) => f.id === "once")).toHaveLength(1);
  });
});

describe("rule edge triggering", () => {
  const risingProject = (once: boolean): EEProject =>
    projectWith({
      variables: [{ name: "flag", initial: 0 }],
      beats: [
        {
          id: "raise",
          label: "raise",
          at: 10,
          actions: [{ kind: "set_variable", name: "flag", value: 1 }],
        },
        {
          id: "lower",
          label: "lower",
          at: 20,
          actions: [{ kind: "set_variable", name: "flag", value: 0 }],
        },
        {
          id: "raise_again",
          label: "raise again",
          at: 30,
          actions: [{ kind: "set_variable", name: "flag", value: 1 }],
        },
      ],
      rules: [
        {
          id: "watch",
          label: "watch",
          when: { kind: "variable_equals", name: "flag", value: 1 },
          conditions: [],
          once,
          actions: [],
        },
      ],
    });

  it("fires once per rising edge, not every tick", () => {
    const result = simulate(risingProject(false), { untilSeconds: 60 });
    const fires = result.firings.filter((f) => f.source === "rule");
    expect(fires.map((f) => f.at)).toEqual([10, 30]);
  });

  it("stops after the first fire when once is set", () => {
    const result = simulate(risingProject(true), { untilSeconds: 60 });
    expect(result.firings.filter((f) => f.source === "rule")).toHaveLength(1);
  });

  it("ands the conditions with the trigger", () => {
    const project = projectWith({
      variables: [{ name: "ready", initial: false }],
      beats: [
        {
          id: "arm",
          label: "arm",
          at: 40,
          actions: [{ kind: "set_variable", name: "ready", value: true }],
        },
      ],
      rules: [
        {
          id: "gated",
          label: "gated",
          when: { kind: "elapsed", seconds: 10 },
          conditions: [{ kind: "variable_equals", name: "ready", value: true }],
          once: true,
          actions: [],
        },
      ],
    });
    const result = simulate(project, { untilSeconds: 60 });
    expect(result.firings.find((f) => f.id === "gated")?.at).toBe(40);
  });
});

describe("world predicates", () => {
  const demo = demoProject();

  it("treats a never-spawned object as absent, not destroyed", () => {
    // `ambush` is an on_call group: before it spawns, "destroyed" must be
    // false, or every rule watching it would fire at T+0.
    const result = simulate(demo, { untilSeconds: 5 });
    expect(result.firings.some((f) => f.id === "ambush_cleared")).toBe(false);
  });

  it("uses zone geometry rather than a mocked flag", () => {
    const inside = simulate(demo, {
      untilSeconds: 120,
      events: [{ at: 60, kind: "player_position", x: 12000, y: 3000 }],
    });
    expect(inside.firings.some((f) => f.id === "spring_ambush")).toBe(true);

    const outside = simulate(demo, {
      untilSeconds: 120,
      events: [{ at: 60, kind: "player_position", x: 30000, y: 30000 }],
    });
    expect(outside.firings.some((f) => f.id === "spring_ambush")).toBe(false);
  });

  it("runs the demo through to victory", () => {
    const result = simulate(demo, {
      untilSeconds: 240,
      events: [
        { at: 90, kind: "player_position", x: 12000, y: 3000 },
        { at: 150, kind: "destroy_object", objectId: "corsair_a" },
        { at: 170, kind: "destroy_object", objectId: "corsair_b" },
      ],
    });
    expect(result.firings.map((f) => f.id)).toEqual([
      "arrival",
      "warning",
      "spring_ambush",
      "ambush_cleared",
    ]);
    expect(result.endedWith).toBe("Human Navy");
    expect(result.variables).toMatchObject({ alarm: 1, briefed: true });
  });

  it("stops the clock at victory", () => {
    const result = simulate(demo, {
      untilSeconds: 600,
      events: [
        { at: 90, kind: "player_position", x: 12000, y: 3000 },
        { at: 150, kind: "destroy_group", groupId: "ambush" },
      ],
    });
    const last = result.firings[result.firings.length - 1];
    expect(last?.id).toBe("ambush_cleared");
  });

  it("reports what it cannot model instead of pretending", () => {
    const result = simulate(demo, {
      untilSeconds: 120,
      events: [{ at: 60, kind: "player_position", x: 12000, y: 3000 }],
    });
    expect(result.notSimulated).toContain("AI orders (no combat model)");
  });
});

/**
 * Parity between the two executors of the same model (ADR-0034 §5).
 * If they drift, a dry-run stops predicting what EE will do.
 */
describe("markers in a dry run", () => {
  const near = (position: unknown, markers: unknown[]): EEProject => {
    const base = emptyEEProject("m", "M");
    return {
      ...base,
      map: {
        sectors: [],
        groups: [
          {
            id: "core",
            label: "Core",
            when: "on_start",
            objects: [
              {
                id: "player",
                type: "PlayerSpaceship",
                callsign: "PS-01",
                position: { x: 0, y: 0 },
                description: null,
                rotation: null,
                variables: [],
                faction: "Human Navy",
                template: "Atlantis",
              },
            ],
          },
        ],
        markers,
      },
      logic: {
        ...base.logic,
        rules: [
          {
            id: "arrive",
            label: "Arrive",
            when: { kind: "player_near_point", position, distance: 1000 },
            conditions: [],
            once: true,
            actions: [{ kind: "banner", text: "here" }],
          },
        ],
      },
    } as EEProject;
  };

  it("fires where the marker is, exactly as a literal there would", () => {
    // The player starts at the origin, so a marker on it fires at once.
    const viaMarker = simulate(
      near({ ref: "marker", markerId: "here" }, [
        { id: "here", label: "Here", position: { x: 0, y: 0 }, notes: null },
      ]),
      { untilSeconds: 5 },
    );
    const viaLiteral = simulate(
      near({ ref: "point", position: { x: 0, y: 0 } }, []),
      { untilSeconds: 5 },
    );
    expect(viaMarker.firings.map((f) => f.label)).toEqual(
      viaLiteral.firings.map((f) => f.label),
    );
    expect(viaMarker.firings.length).toBeGreaterThan(0);
  });

  it("never fires on a marker that does not exist", () => {
    // The build refuses the same document; a dry run that triggered at
    // (0, 0) instead would be worse than one that stayed quiet.
    const result = simulate(near({ ref: "marker", markerId: "gone" }, []), {
      untilSeconds: 5,
    });
    expect(result.firings).toEqual([]);
  });
});

describe("object variables", () => {
  /** A one-ship project whose ship carries variables. */
  const shipWith = (
    variables: ReadonlyArray<{ name: string; initial: string | number | boolean }>,
    logic: Partial<EEProject["logic"]> = {},
  ): EEProject => {
    const base = emptyEEProject("sim", "Sim");
    return {
      ...base,
      map: {
        sectors: [],
        groups: [
          {
            id: "wing",
            label: "Wing",
            when: "on_start",
            objects: [
              {
                id: "raider",
                type: "CpuShip",
                callsign: "SH-EN-01",
                position: { x: 0, y: 0 },
                description: null,
                variables: [...variables],
                rotation: null,
                faction: "Kraylor",
                template: "Phobos T3",
                ai: null,
              },
            ],
          },
        ],
        markers: [],
      },
      logic: { ...base.logic, ...logic },
    };
  };

  it("starts at the value declared on the object", () => {
    const result = simulate(shipWith([{ name: "alerted", initial: false }]), {
      untilSeconds: 10,
    });
    expect(result.objectVariables["raider"]).toEqual({ alerted: false });
  });

  it("is written by an action and read by a predicate", () => {
    const project = shipWith([{ name: "alerted", initial: false }], {
      beats: [
        {
          id: "alert",
          label: "Alert",
          at: 5,
          actions: [
            {
              kind: "set_object_variable",
              target: { ref: "group", groupId: "wing" },
              name: "alerted",
              value: true,
            },
          ],
        },
      ],
      rules: [
        {
          id: "notices",
          label: "Notices",
          when: {
            kind: "object_variable_equals",
            objectId: "raider",
            name: "alerted",
            value: true,
          },
          conditions: [],
          once: true,
          actions: [{ kind: "banner", text: "alerted" }],
        },
      ],
    });

    const result = simulate(project, { untilSeconds: 30 });
    const firing = result.firings.find((f) => f.id === "notices");
    expect(firing).toBeDefined();
    // The rule is edge-triggered, so it lands on the tick after the write,
    // never before it.
    expect(firing?.at).toBeGreaterThanOrEqual(5);
    expect(result.objectVariables["raider"]?.["alerted"]).toBe(true);
  });

  it("counts up from nothing, like the global counterpart", () => {
    const project = shipWith([], {
      beats: [
        {
          id: "tally",
          label: "Tally",
          at: 1,
          actions: [
            {
              kind: "add_object_variable",
              target: { ref: "object", objectId: "raider" },
              name: "kills",
              delta: 2,
            },
          ],
        },
      ],
    });
    expect(simulate(project, { untilSeconds: 10 }).objectVariables["raider"]).toEqual({
      kills: 2,
    });
  });

  it("still answers after the object is destroyed", () => {
    // The property that decides where these live: on the EE handle the
    // value would die with the ship, and a rule asking "was it alerted
    // when it blew up?" could never be written.
    const project = shipWith([{ name: "alerted", initial: true }], {
      rules: [
        {
          id: "post_mortem",
          label: "Post mortem",
          when: { kind: "object_destroyed", objectId: "raider" },
          conditions: [
            {
              kind: "object_variable_equals",
              objectId: "raider",
              name: "alerted",
              value: true,
            },
          ],
          once: true,
          actions: [{ kind: "banner", text: "it saw us coming" }],
        },
      ],
    });

    const result = simulate(project, {
      untilSeconds: 30,
      events: [{ at: 10, kind: "destroy_object", objectId: "raider" }],
    });
    expect(result.firings.map((f) => f.id)).toContain("post_mortem");
    expect(result.objectVariables["raider"]?.["alerted"]).toBe(true);
  });

  it("keeps two objects' variables apart", () => {
    const project = shipWith([{ name: "alerted", initial: false }]);
    const twoShips: EEProject = {
      ...project,
      map: {
        sectors: [],
        groups: project.map.groups.map((g) => ({
          ...g,
          objects: [
            ...g.objects,
            { ...(g.objects[0] as (typeof g.objects)[number]), id: "raider_b" },
          ],
        })),
        markers: [],
      },
      logic: {
        ...project.logic,
        beats: [
          {
            id: "one",
            label: "One",
            at: 1,
            actions: [
              {
                kind: "set_object_variable",
                target: { ref: "object", objectId: "raider" },
                name: "alerted",
                value: true,
              },
            ],
          },
        ],
      },
    };
    const result = simulate(twoShips, { untilSeconds: 10 });
    expect(result.objectVariables["raider"]?.["alerted"]).toBe(true);
    expect(result.objectVariables["raider_b"]?.["alerted"]).toBe(false);
  });
});

describe("simulator ↔ codegen parity", () => {
  const catalog = loadCatalog();

  it("emits beats in the order the simulator fires them", () => {
    const project = demoProject();
    const lua = buildProject(catalog, project, { sourceHash: "parity" }).files[2]?.contents ?? "";

    const emittedIds = [...lua.matchAll(/\n    id = "([^"]+)",\n    at = /g)].map((m) => m[1]);
    const simulatedIds = simulate(project, { untilSeconds: 3600 })
      .firings.filter((f) => f.source === "beat")
      .map((f) => f.id);

    expect(emittedIds).toEqual(simulatedIds);
  });

  it("emits every rule the model declares", () => {
    const project = demoProject();
    const lua = buildProject(catalog, project, { sourceHash: "parity" }).files[2]?.contents ?? "";
    for (const rule of project.logic.rules) {
      expect(lua).toContain(`id = "${rule.id}"`);
    }
  });

  it("emits a GM button per declared button", () => {
    const project = demoProject();
    const lua = buildProject(catalog, project, { sourceHash: "parity" }).files[2]?.contents ?? "";
    for (const button of project.logic.gmButtons) {
      expect(lua).toContain(`addGMFunction("${button.label}"`);
    }
  });
});
