import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EEProjectSchema,
  emptyEEProject,
  type EEAction,
  type EEBeamDef,
  type EEProject,
  type EESpawnOrder,
  type EETemplateDef,
} from "@forge/contracts";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject, validateProject } from "../src/codegen/build.js";
import { TEMPLATE_METHODS_NOT_EMITTED, orderTemplates } from "../src/codegen/content.js";
import { createBeam, createTemplate } from "../src/editor/factories.js";
import { CodegenError } from "../src/codegen/lua.js";
import { echoExtension } from "./fixtures/echo-extension.js";

const catalog = loadCatalog();
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function demoProject(): EEProject {
  const raw = readFileSync(join(repoRoot, "projects/forge_demo/project.json"), "utf8");
  return EEProjectSchema.parse(JSON.parse(raw));
}

/** Fixed hash keeps golden output stable when the document is edited. */
const build = (project: EEProject) =>
  buildProject(catalog, project, { sourceHash: "test-hash" });

/**
 * A template with every field set, and a copy of it.
 *
 * This is the oracle for "can the model reach all of ShipTemplate": if a
 * setter cannot appear in the Lua emitted from *this* project, no project
 * can produce it.
 */
function maximalProject(): EEProject {
  const base: EETemplateDef = {
    id: "maximal",
    name: "Maximal",
    localeName: "Massimale",
    kind: "ship",
    copyOf: null,
    className: "Corvette",
    subclassName: "Gunship",
    description: "Every setter, once.",
    model: "maximal_hull",
    radarTrace: "cruiser.png",
    hull: 200,
    shields: [100, 80],
    speed: {
      impulse: 80,
      turn: 15,
      acceleration: 30,
      reverseSpeed: 60,
      reverseAcceleration: 20,
    },
    combatManeuver: { boost: 400, strafe: 200 },
    warpSpeed: 1000,
    jumpDrive: { enabled: true, minRange: 5000, maxRange: 50000 },
    cloaking: true,
    energyStorage: 800,
    repairCrewCount: 3,
    beams: [
      {
        index: 0,
        arc: 90,
        direction: 0,
        range: 1200,
        cycleTime: 6,
        damage: 6,
        turret: { arc: 200, direction: 0, rotationRate: 5 },
        texture: "beam_orange.png",
        energyPerFire: 3,
        heatPerFire: 0.02,
      },
    ],
    tubes: {
      count: 2,
      loadTime: 10,
      perTube: [
        {
          index: 0,
          direction: 0,
          loadTime: 8,
          size: "large",
          exclusiveFor: "HVLI",
          allow: ["Homing"],
          disallow: ["Mine"],
        },
      ],
    },
    weaponStorage: [{ weapon: "HVLI", amount: 10 }],
    rooms: [
      { x: 0, y: 0, width: 2, height: 2, system: "reactor" },
      { x: 2, y: 0, width: 1, height: 1, system: null },
    ],
    doors: [{ x: 2, y: 0, horizontal: true }],
    longRangeRadarRange: 30000,
    shortRangeRadarRange: 5000,
    defaultAI: "fighter",
    externalDockClasses: ["Frigate", "Corvette"],
    internalDockClasses: ["Starfighter"],
    sharesEnergyWithDocked: true,
    repairDocked: true,
    restocksScanProbes: false,
    restocksMissilesDocked: true,
    impulseSoundFile: "sfx/engine_fighter.wav",
    canScan: true,
    canHack: false,
    canDock: true,
    canCombatManeuver: true,
    canSelfDestruct: false,
    canLaunchProbe: true,
    hidden: true,
  };
  const project = emptyEEProject("maximal", "Maximal");
  return {
    ...project,
    templates: [base, { ...base, id: "maximal_b", name: "Maximal B", copyOf: "Maximal" }],
  };
}

describe("bundle shape", () => {
  it("emits the portable bundle plus a launch-time template file", () => {
    const result = build(demoProject());
    expect(result.files.map((f) => f.name)).toEqual([
      "forge_demo_content.lua",
      "forge_demo_map.lua",
      "scenario_forge_demo.lua",
      "forge_demo_templates.lua",
    ]);
  });

  it("routes the template file to shiptemplates/, everything else to scripts/", () => {
    // EE refuses ShipTemplate() from a scenario ("ShipTemplate objects can
    // not be created during a scenario"), so templates must load during the
    // engine's launch-time template phase.
    const byName = new Map(build(demoProject()).files.map((f) => [f.name, f.install]));
    expect(byName.get("forge_demo_templates.lua")).toBe("shiptemplates");
    expect(byName.get("forge_demo_content.lua")).toBe("scripts");
    expect(byName.get("scenario_forge_demo.lua")).toBe("scripts");
  });

  it("omits the launch-time file only when there are neither templates nor models", () => {
    const withModels = build({ ...demoProject(), templates: [] });
    expect(withModels.files.some((f) => f.install === "shiptemplates")).toBe(true);

    const bare = build({ ...demoProject(), templates: [], models: [] });
    expect(bare.files.some((f) => f.install === "shiptemplates")).toBe(false);
  });

  it("registers models in the launch-time file, not from the scenario", () => {
    // A template's setModel() is evaluated during shipTemplates.lua, long
    // before any scenario runs — a scenario-registered model would produce
    // "Failed to find model data" and a silent fallback mesh.
    const files = build(demoProject()).files;
    const launch = files.find((f) => f.install === "shiptemplates")?.contents ?? "";
    const content = files.find((f) => f.name.endsWith("_content.lua"))?.contents ?? "";

    expect(launch).toContain('ModelData()');
    expect(launch).toContain('setName("corsair_hull")');
    expect(content).not.toContain("ModelData()");
    // Models must precede the templates that reference them.
    expect(launch.indexOf("corsair_hull")).toBeLessThan(launch.indexOf("ShipTemplate()"));
  });

  it("emits GM callbacks that close over nothing but _ENV", () => {
    // EE's convert<ScriptSimpleCallback> reads upvalue 1 and requires a
    // table (_ENV). A callback capturing a local helper fails at load with
    // "Upvalue 1 of function is not a table" — observed 2026-08-09.
    const scenario = build(demoProject()).files[2]?.contents ?? "";
    const body = scenario.slice(scenario.indexOf("addGMFunction("));
    const callback = body.slice(0, body.indexOf("\nend"));
    // Every helper and state reference inside the callback is a global.
    expect(callback).toContain("forge_demo_rt.run(");
    expect(callback).toContain("forge_demo_map.spawn_group(");
    expect(callback).toContain("forge_demo_state.vars[");
    expect(callback).not.toMatch(/(?<![\w.])run\(/);
    expect(callback).not.toMatch(/(?<![\w.])map\./);
    expect(callback).not.toMatch(/(?<![\w.])S\./);
  });

  it("keeps ship templates out of the scenario's require chain", () => {
    const scenario = build(demoProject()).files[2]?.contents ?? "";
    expect(scenario).toContain('require("forge_demo_content.lua")');
    expect(scenario).toContain('require("forge_demo_map.lua")');
    expect(scenario).not.toContain("forge_demo_templates");

    const content = build(demoProject()).files[0]?.contents ?? "";
    expect(content).not.toContain("ShipTemplate()");
  });

  it("starts the scenario with EE's required header", () => {
    const scenario = build(demoProject()).files[2];
    const lines = scenario?.contents.split("\n") ?? [];
    // Without these three lines EE never lists the scenario in its menu.
    expect(lines[0]).toMatch(/^-- Name: /);
    expect(lines[1]).toMatch(/^-- Description: /);
    expect(lines[2]).toBe("-- Type: Basic");
  });

  it("keeps the provenance banner free of key: value lines", () => {
    // EE parses leading `-- Key: Value` comments as scenario metadata and
    // logs "Unknown scenario meta data" for each one it does not know.
    const scenario = build(demoProject()).files[2]?.contents ?? "";
    const banner = scenario.split("\n").slice(3, 12);
    for (const line of banner) {
      expect(line).not.toMatch(/^-- [A-Za-z][A-Za-z ]*: /);
    }
  });

  it("stamps every file as generated, with the source hash", () => {
    for (const file of build(demoProject()).files) {
      expect(file.contents).toContain("GENERATED BY EE FORGE — DO NOT EDIT");
      expect(file.contents).toContain("test-hash");
    }
  });
});

/**
 * The conformance gate: every method the emitters produce must resolve in
 * the catalog. This is what turns CLAUDE.md §0.3 from a discipline into a
 * failing test (ADR-0034 §2).
 */
describe("no invented EE API", () => {
  const knownMethods = new Set<string>();
  for (const cls of Object.values(catalog.classes)) {
    for (const method of cls.methods) knownMethods.add(method.name);
  }

  const EXODUS_HELPERS = new Set([
    "emit",
    "request_puzzle",
    "request_action",
    "lore_drop",
    "set_state",
    "complete_chapter",
    "scenario_started",
  ]);

  function methodTokens(lua: string): { receiver: string; method: string }[] {
    return [...lua.matchAll(/(\w+)?\s*:(\w+)\(/g)].map((m) => ({
      receiver: m[1] ?? "",
      method: m[2] ?? "",
    }));
  }

  it("only calls methods present in the pinned catalog", () => {
    for (const file of build(demoProject()).files) {
      for (const token of methodTokens(file.contents)) {
        if (token.receiver === "bridge") {
          expect(EXODUS_HELPERS.has(token.method)).toBe(true);
          continue;
        }
        expect(
          knownMethods.has(token.method),
          `${file.name} calls :${token.method}() which is not in ${catalog.eeVersion}`,
        ).toBe(true);
      }
    }
  });

  it("keeps vanilla output free of any EXODUS surface", () => {
    const project = demoProject();
    expect(project.requires).toEqual([]);
    for (const file of build(project).files) {
      expect(file.contents).not.toContain("bridge:");
      expect(file.contents).not.toContain("exodus_bridge");
    }
  });

  const loreBeat = (stepId: string | null) => ({
    id: "drop",
    label: "lore",
    at: 0,
    actions: [{ kind: "exodus_lore" as const, stepId, fragmentId: "frag_demo_001", foundBy: null }],
  });

  it("hands EXODUS actions to the registered extension, only when the project opts in", () => {
    const project: EEProject = {
      ...demoProject(),
      requires: ["exodus"],
      logic: { ...demoProject().logic, beats: [loreBeat(null)] },
    };
    const built = buildProject(catalog, project, {
      sourceHash: "test-hash",
      extensions: [echoExtension],
    });
    expect(built.mode).toBe("integrated");
    const scenario = built.files[2]?.contents ?? "";
    expect(scenario).toContain('require("exodus_bridge.lua")');
    expect(scenario).toContain('bridge:lore_drop("frag_demo_001")');
  });

  it("refuses an exodus action when the tier is not declared", () => {
    const project: EEProject = {
      ...demoProject(),
      logic: { ...demoProject().logic, beats: [loreBeat(null)] },
    };
    expect(() => buildProject(catalog, project, { sourceHash: "t", mode: "integrated", extensions: [echoExtension] })).toThrow(
      /requires the exodus tier/,
    );
  });

  it("will not build an integrated scenario when no extension is registered", () => {
    const project: EEProject = {
      ...demoProject(),
      requires: ["exodus"],
      logic: { ...demoProject().logic, beats: [loreBeat(null)] },
    };
    expect(() => buildProject(catalog, project, { sourceHash: "t", mode: "integrated" })).toThrow(
      /no EXODUS extension is registered/,
    );
  });
});

describe("map emission", () => {
  it("spawns an orbit parent before its satellite", () => {
    const map = build(demoProject()).files[1]?.contents ?? "";
    expect(map.indexOf('"anchorage"')).toBeLessThan(map.indexOf('"anchorage_moon"'));
    // setOrbit locks the radius to the current distance, so setPosition
    // must already have run on the satellite.
    const moonChain = map.slice(map.indexOf('track(created, "anchorage_moon"'));
    expect(moonChain.indexOf(":setPosition(")).toBeLessThan(moonChain.indexOf(":setOrbit("));
  });

  /**
   * The orbit argument is a PERIOD in seconds, not a rate: `planet.cpp`
   * does `angle += delta / orbit_time * 360`. EE's own doc comment says
   * "degrees per tick" and is wrong, which is how the key came to be
   * called `degreesPerTick` and how every orbit in this repo was
   * authored as a three-second lap.
   */
  it("emits the orbital period verbatim, and reads the old key name", () => {
    const raw = JSON.parse(
      readFileSync(join(repoRoot, "projects/forge_demo/project.json"), "utf8"),
    ) as { map: { sectors: [], groups: { objects: { id: string; orbit?: unknown }[] }[] } };
    for (const group of raw.map.groups) {
      for (const object of group.objects) {
        if (object.id === "anchorage_moon") object.orbit = { targetId: "anchorage", degreesPerTick: 900 };
      }
    }
    const legacy = EEProjectSchema.parse(raw);
    const map = build(legacy).files[1]?.contents ?? "";
    expect(map).toContain(':setOrbit(forge_demo_map.objects["anchorage"], 900)');
  });

  it("rejects a zero orbital period, which sends EE's angle to infinity", () => {
    const raw = JSON.parse(
      readFileSync(join(repoRoot, "projects/forge_demo/project.json"), "utf8"),
    ) as { map: { sectors: [], groups: { objects: { id: string; orbit?: unknown }[] }[] } };
    for (const group of raw.map.groups) {
      for (const object of group.objects) {
        if (object.id === "anchorage_moon") object.orbit = { targetId: "anchorage", orbitTimeS: 0 };
      }
    }
    expect(() => EEProjectSchema.parse(raw)).toThrow(/cannot be 0/);
  });

  it("returns created handles so callers can track them", () => {
    const map = build(demoProject()).files[1]?.contents ?? "";
    expect(map).toContain("function M.spawn()");
    expect(map).toContain("return all");
    expect(map).toContain("function M.spawn_group(name)");
  });

  it("spawns only on_start groups from spawn()", () => {
    const map = build(demoProject()).files[1]?.contents ?? "";
    expect(map).toContain('local start_groups = { "core" }');
  });
});

describe("a CpuShip's order at spawn", () => {
  /** The demo's `cpuship`, with one spawn order swapped in. */
  const withOrder = (order: EESpawnOrder | null): string => {
    const demo = demoProject();
    const project: EEProject = {
      ...demo,
      map: {
        sectors: [],
        groups: demo.map.groups.map((group) => ({
          ...group,
          objects: group.objects.map((object) =>
            object.id === "cpuship" ? { ...object, order } : object,
          ),
        })),
        markers: [],
      },
    };
    return build(project).files[1]?.contents ?? "";
  };
  const chain = (map: string): string =>
    map.slice(map.indexOf('track(created, "cpuship"')).split("\n\n")[0] ?? "";

  it("emits the EE verb each order names", () => {
    const cases: ReadonlyArray<readonly [EESpawnOrder, string]> = [
      [{ kind: "idle" }, ":orderIdle()"],
      [{ kind: "roaming" }, ":orderRoaming()"],
      [{ kind: "stand_ground" }, ":orderStandGround()"],
      [
        { kind: "defend_location", position: { ref: "point", position: { x: 1200, y: -800 } } },
        ":orderDefendLocation(1200, -800)",
      ],
    ];
    for (const [order, expected] of cases) {
      expect(chain(withOrder(order)), order.kind).toContain(expected);
    }
  });

  it("says nothing when there is no order, leaving EE's own default", () => {
    const emitted = chain(withOrder(null));
    expect(emitted).toContain("CpuShip()");
    expect(emitted).not.toContain(":order");
  });

  // The template carries a default AI and setTemplate applies it, so both
  // the per-ship AI and the order have to land after it to survive.
  it("orders the ship after its template and AI are set", () => {
    const emitted = chain(withOrder({ kind: "stand_ground" }));
    expect(emitted.indexOf(":setTemplate(")).toBeLessThan(emitted.indexOf(":orderStandGround("));
  });

  it("writes the defend point as literals, never a lookup", () => {
    const emitted = chain(
      withOrder({ kind: "defend_location", position: { ref: "point", position: { x: 0, y: 0 } } }),
    );
    expect(emitted).toContain(":orderDefendLocation(0, 0)");
  });
});

describe("markers", () => {
  /** The demo, with a marker and one record pointing at it. */
  const withMarker = (
    ref: { ref: "marker"; markerId: string } | { ref: "point"; position: { x: number; y: number } },
    markerId = "ambush_point",
  ): EEProject => {
    const demo = demoProject();
    return {
      ...demo,
      map: {
        ...demo.map,
        markers: [
          { id: markerId, label: "Ambush point", position: { x: 4200, y: -1600 }, notes: null },
        ],
      },
      logic: {
        ...demo.logic,
        rules: [
          {
            id: "ambush",
            label: "Ambush",
            when: { kind: "player_near_point", position: ref, distance: 3000 },
            conditions: [],
            once: true,
            actions: [],
          },
        ],
      },
    };
  };

  it("emits a marker's coordinates, never its name", () => {
    const scenario =
      build(withMarker({ ref: "marker", markerId: "ambush_point" })).files[2]?.contents ?? "";
    expect(scenario).toContain("near_point(4200, -1600, 3000)");
    // EE has no marker class; nothing about one may reach the Lua.
    expect(scenario).not.toContain("ambush_point");
    expect(scenario).not.toContain("marker");
  });

  it("produces exactly what the same place typed by hand would", () => {
    const viaMarker = build(withMarker({ ref: "marker", markerId: "ambush_point" }));
    const viaLiteral = build(
      withMarker({ ref: "point", position: { x: 4200, y: -1600 } }),
    );
    expect(viaMarker.files[2]?.contents).toBe(viaLiteral.files[2]?.contents);
  });

  it("refuses a place that names a marker nobody defines", () => {
    const project = withMarker({ ref: "marker", markerId: "deleted_one" });
    expect(() => build(project)).toThrow(/deleted_one/);
    expect(() => validateProject(project)).toThrow(/referenced but not defined/);
  });

  it("reports every broken reference at once, not just the first", () => {
    const project = withMarker({ ref: "marker", markerId: "gone_a" });
    const two: EEProject = {
      ...project,
      logic: {
        ...project.logic,
        beats: [
          {
            id: "b",
            label: "b",
            at: 0,
            actions: [
              {
                kind: "order_fly_towards",
                target: { ref: "player" },
                position: { ref: "marker", markerId: "gone_b" },
              },
            ],
          },
        ],
      },
    };
    expect(() => validateProject(two)).toThrow(/gone_a.*gone_b/s);
  });

  it("refuses two markers with the same id", () => {
    const project = withMarker({ ref: "point", position: { x: 0, y: 0 } });
    const dupes: EEProject = {
      ...project,
      map: {
        ...project.map,
        markers: [...project.map.markers, ...project.map.markers],
      },
    };
    expect(() => validateProject(dupes)).toThrow(/duplicate marker id/);
  });

  it("resolves a marker on an object as well as in the narrative", () => {
    const demo = demoProject();
    const project: EEProject = {
      ...demo,
      map: {
        ...demo.map,
        markers: [{ id: "gate_exit", label: "Gate exit", position: { x: 90000, y: 500 }, notes: null }],
        groups: demo.map.groups.map((group, i) =>
          i === 0
            ? {
                ...group,
                objects: [
                  ...group.objects,
                  {
                    id: "gate",
                    type: "WormHole",
                    callsign: null,
                    position: { x: 1000, y: 1000 },
                    description: null,
                    variables: [],
                    targetPosition: { ref: "marker", markerId: "gate_exit" },
                  },
                ],
              }
            : group,
        ),
      },
    };
    const map = build(project).files[1]?.contents ?? "";
    expect(map).toContain(":setTargetPosition(90000, 500)");
  });
});

describe("comms dialogues", () => {
  /** A station that talks, with a jump, a guard, the GM and the stock menu. */
  const talking = (): EEProject => {
    const demo = demoProject();
    return {
      ...demo,
      logic: {
        ...demo.logic,
        variables: [{ name: "identified", initial: false }],
        dialogues: [
          {
            id: "council",
            label: "Council",
            entry: "greeting",
            nodes: [
              {
                id: "greeting",
                text: "Anchorage here. Identify yourselves.",
                replies: [
                  {
                    text: "We are the Prometheus",
                    target: { kind: "node", nodeId: "cleared" },
                    conditions: [],
                    actions: [
                      { kind: "set_variable", name: "identified", value: true },
                    ],
                  },
                  {
                    text: "Classified",
                    target: { kind: "node", nodeId: "cleared" },
                    conditions: [
                      { kind: "variable_equals", name: "identified", value: true },
                    ],
                    actions: [],
                  },
                  { text: "Get me an officer", target: { kind: "gm" }, conditions: [], actions: [] },
                  { text: "Services", target: { kind: "services" }, conditions: [], actions: [] },
                ],
              },
              { id: "cleared", text: "Cleared for docking.", replies: [] },
            ],
          },
        ],
      },
      map: {
        ...demo.map,
        groups: demo.map.groups.map((group) => ({
          ...group,
          objects: group.objects.map((object) =>
            object.type === "SpaceStation" ? { ...object, dialogueId: "council" } : object,
          ),
        })),
      },
    };
  };

  const scenario = (project: EEProject): string => build(project).files[2]?.contents ?? "";

  it("emits one function per node, and a reply per button", () => {
    const lua = scenario(talking());
    expect(lua).toContain('forge_demo_rt.dlg["council"]["greeting"] = function(comms_source, comms_target)');
    expect(lua).toContain('setCommsMessage("Anchorage here. Identify yourselves.")');
    expect(lua).toContain('addCommsReply("We are the Prometheus"');
    expect(lua).toContain('forge_demo_rt.dlg["council"]["cleared"](comms_source, comms_target)');
  });

  it("guards a conditional reply instead of offering a dead button", () => {
    const lua = scenario(talking());
    const guarded = lua.slice(lua.indexOf('if (forge_demo_rt.var_get("identified")'));
    expect(guarded).toContain('addCommsReply("Classified"');
  });

  it("emits the GM handoff and the stock station menu", () => {
    const lua = scenario(talking());
    expect(lua).toContain("commsSwitchToGM()");
    expect(lua).toContain("commsStationMainMenu(comms_source, comms_target)");
    // The stock menu is a comms script, so the scenario has to load it —
    // and only when something actually uses it.
    expect(lua).toContain('pcall(require, "comms_station.lua")');
  });

  it("loads comms_station.lua only for a project that hands off to it", () => {
    const project = talking();
    const withoutServices: EEProject = {
      ...project,
      logic: {
        ...project.logic,
        dialogues: project.logic.dialogues.map((dialogue) => ({
          ...dialogue,
          nodes: dialogue.nodes.map((node) => ({
            ...node,
            replies: node.replies.filter((reply) => reply.target.kind !== "services"),
          })),
        })),
      },
    };
    // The runtime prelude always names the file — it is how `set_dialogue`
    // restores a station's default — so the assertion is on the require.
    expect(scenario(withoutServices)).not.toContain('pcall(require, "comms_station.lua")');
    expect(scenario(withoutServices)).toContain('o:setCommsScript("comms_station.lua")');
    expect(scenario(withoutServices)).toContain('o.components.physics.type == "static"');
    expect(scenario(withoutServices)).not.toContain("o.typeName");
  });

  /**
   * The rule that governs the whole emitter. `setCommsFunction` converts
   * its callback through `convert<ScriptSimpleCallback>`, which reads the
   * first upvalue and demands a table — probed live 2026-08-16, a callback
   * capturing a local raises "Upvalue 1 of function is not a table". So no
   * emitted comms callback may declare or capture one.
   */
  it("never lets a comms callback capture a local", () => {
    const lua = scenario(talking());
    const block = lua.slice(
      lua.indexOf("-- === Dialogues"),
      lua.indexOf("--- Register the GM console buttons"),
    );
    expect(block).not.toContain("local ");
  });

  it("attaches the dialogue at init and again after every spawn_group", () => {
    const lua = scenario(talking());
    expect(lua).toContain('forge_demo_rt.set_dialogue(forge_demo_rt.targets("object", "station"), "council")');
    expect(lua).toContain("forge_demo_rt.install_dialogues()");
    const spawnCall = lua.slice(lua.indexOf("forge_demo_map.spawn_group("));
    expect(spawnCall.slice(0, 120)).toContain("install_dialogues()");
  });

  it("refuses a dialogue whose opening node does not exist", () => {
    const project = talking();
    const broken: EEProject = {
      ...project,
      logic: {
        ...project.logic,
        dialogues: project.logic.dialogues.map((d) => ({ ...d, entry: "missing" })),
      },
    };
    expect(() => validateProject(broken)).toThrow(/opens on node "missing"/);
  });

  it("refuses a reply that jumps nowhere", () => {
    const project = talking();
    const broken: EEProject = {
      ...project,
      logic: {
        ...project.logic,
        dialogues: project.logic.dialogues.map((d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === "greeting"
              ? {
                  ...n,
                  replies: n.replies.map((r) => ({
                    ...r,
                    target: { kind: "node" as const, nodeId: "nowhere" },
                  })),
                }
              : n,
          ),
        })),
      },
    };
    expect(() => validateProject(broken)).toThrow(/jumps to nodes it does not define/);
  });

  it("refuses an object that answers with a dialogue nobody defines", () => {
    const project = talking();
    const broken: EEProject = { ...project, logic: { ...project.logic, dialogues: [] } };
    expect(() => validateProject(broken)).toThrow(/which this project does not define/);
  });

  it("warns about a node nothing reaches, without refusing the build", () => {
    const project = talking();
    const orphaned: EEProject = {
      ...project,
      logic: {
        ...project.logic,
        dialogues: project.logic.dialogues.map((d) => ({
          ...d,
          nodes: [...d.nodes, { id: "stranded", text: "…", replies: [] }],
        })),
      },
    };
    expect(validateProject(orphaned)).toContain(
      'dialogue "council" node "stranded" is unreachable from "greeting"',
    );
  });

  it("warns when a non-station offers EE's station services", () => {
    const project = talking();
    const onAShip: EEProject = {
      ...project,
      map: {
        ...project.map,
        groups: project.map.groups.map((group) => ({
          ...group,
          objects: group.objects.map((object) =>
            object.type === "CpuShip" ? { ...object, dialogueId: "council" } : object,
          ),
        })),
      },
    };
    expect(validateProject(onAShip).join(" ")).toContain("expects a SpaceStation");
  });
});

describe("documents written before the order field", () => {
  it("still parse, and mean no order", () => {
    // Every project.json on disk predates this field. Refusing to open
    // them would make a schema addition a migration, which is exactly what
    // `.default(null)` is there to avoid.
    const demo = demoProject();
    const ship = demo.map.groups
      .flatMap((group) => group.objects)
      .find((object) => object.id === "cpuship");
    expect(ship?.type).toBe("CpuShip");

    const legacy = JSON.parse(
      readFileSync(join(repoRoot, "projects/forge_demo/project.json"), "utf8"),
    ) as { map: { sectors: [], groups: { objects: Record<string, unknown>[] }[] } };
    const raw = legacy.map.groups
      .flatMap((group) => group.objects)
      .find((object) => object["id"] === "cpuship");
    expect(raw).toBeDefined();
    expect("order" in raw!).toBe(false);
    expect(ship?.type === "CpuShip" && ship.order).toBeNull();
  });
});

describe("AI orders", () => {
  /** The demo's ambush wing, with one order action swapped in. */
  const withOrder = (action: EEAction): EEProject => {
    const demo = demoProject();
    return {
      ...demo,
      logic: {
        ...demo.logic,
        beats: [{ id: "orders", label: "Orders", at: 0, actions: [action] }],
        rules: [],
      },
    };
  };
  const scenarioWith = (action: EEAction): string =>
    build(withOrder(action)).files[2]?.contents ?? "";

  const wing = { ref: "group", groupId: "ambush" } as const;

  it("emits the EE method each order names, for all twelve", () => {
    // The catalog is the authority on the method names; this pins that
    // every order action reaches one of them, so an order added to the
    // model without an emitter fails here rather than at load time.
    const cases: ReadonlyArray<readonly [EEAction, string]> = [
      [{ kind: "order_idle", target: wing }, "orderIdle()"],
      [{ kind: "order_roaming", target: wing }, "orderRoaming()"],
      [{ kind: "order_stand_ground", target: wing }, "orderStandGround()"],
      [
        { kind: "order_roaming_at", target: wing, position: { ref: "point", position: { x: 10, y: 20 } } },
        "orderRoamingAt(10, 20)",
      ],
      [
        { kind: "order_defend_location", target: wing, position: { ref: "point", position: { x: 10, y: 20 } } },
        "orderDefendLocation(10, 20)",
      ],
      [
        { kind: "order_fly_towards", target: wing, position: { ref: "point", position: { x: 10, y: 20 } } },
        "orderFlyTowards(10, 20)",
      ],
      [
        { kind: "order_fly_towards_blind", target: wing, position: { ref: "point", position: { x: 10, y: 20 } } },
        "orderFlyTowardsBlind(10, 20)",
      ],
      [
        { kind: "order_attack", target: wing, objectId: "atlantis" },
        'orderAttack(forge_demo_map.objects["atlantis"])',
      ],
      [
        { kind: "order_dock", target: wing, objectId: "anchorage" },
        'orderDock(forge_demo_map.objects["anchorage"])',
      ],
      [
        { kind: "order_retreat", target: wing, objectId: "anchorage" },
        'orderRetreat(forge_demo_map.objects["anchorage"])',
      ],
      [
        { kind: "order_defend_target", target: wing, objectId: "atlantis" },
        'orderDefendTarget(forge_demo_map.objects["atlantis"])',
      ],
      [
        {
          kind: "order_fly_formation",
          target: wing,
          leaderId: "corsair_a",
          offset: { x: 800, y: -400 },
        },
        'orderFlyFormation(forge_demo_map.objects["corsair_a"], 800, -400)',
      ],
    ];

    for (const [action, expected] of cases) {
      expect(scenarioWith(action), action.kind).toContain(expected);
    }
  });

  it("passes fly-formation's three arguments in EE's order", () => {
    // object, offset_x, offset_y — the signature the old flat action could
    // not express at all, since it offered a position OR an object.
    expect(
      scenarioWith({
        kind: "order_fly_formation",
        target: wing,
        leaderId: "corsair_a",
        offset: { x: 800, y: -400 },
      }),
    ).toContain('orderFlyFormation(forge_demo_map.objects["corsair_a"], 800, -400)');
  });

  it("refuses an order aimed at something that cannot take one", () => {
    // No new validation: forEachTarget checks the call against every class
    // the target resolves to, and a Planet has no orderAttack.
    expect(() =>
      build(
        withOrder({
          kind: "order_attack",
          target: { ref: "object", objectId: "anchorage_moon" },
          objectId: "atlantis",
        }),
      ),
    ).toThrow(/orderAttack/);
  });

  it("refuses an order pointed at an object the map does not have", () => {
    expect(() =>
      build(withOrder({ kind: "order_attack", target: wing, objectId: "ghost_ship" })),
    ).toThrow(/unknown object "ghost_ship"/);
  });
});

describe("object variables", () => {
  const withVariables = (): EEProject => {
    const demo = demoProject();
    return {
      ...demo,
      map: {
        sectors: [],
        groups: demo.map.groups.map((group) =>
          group.id !== "ambush"
            ? group
            : {
                ...group,
                objects: group.objects.map((object) => ({
                  ...object,
                  variables: [{ name: "alerted", initial: false }],
                })),
              },
        ),
        markers: [],
      },
      logic: {
        ...demo.logic,
        beats: [
          {
            id: "alert",
            label: "Alert",
            at: 0,
            actions: [
              {
                kind: "set_object_variable",
                target: { ref: "group", groupId: "ambush" },
                name: "alerted",
                value: true,
              },
              {
                kind: "add_object_variable",
                target: { ref: "object", objectId: "corsair_a" },
                name: "kills",
                delta: 1,
              },
            ],
          },
        ],
        rules: [
          {
            id: "reads",
            label: "Reads it",
            when: {
              kind: "object_variable_equals",
              objectId: "corsair_a",
              name: "alerted",
              value: true,
            },
            conditions: [],
            once: true,
            actions: [{ kind: "banner", text: "seen" }],
          },
        ],
      },
    };
  };

  const scenario = (): string => build(withVariables()).files[2]?.contents ?? "";

  it("seeds declared variables at init, from the objects that own them", () => {
    expect(scenario()).toContain(
      'forge_demo_state.obj_vars["corsair_a"]["alerted"] = false',
    );
  });

  it("writes to every member of a group, by literal id", () => {
    // Resolved at build time: group membership is in the document, so the
    // emitted Lua needs no handle lookup and works before anything spawns.
    const lua = scenario();
    expect(lua).toContain('for _, id in ipairs({ "corsair_a", "corsair_b" }) do');
    expect(lua).toContain('forge_demo_rt.obj_vars(id)["alerted"] = true');
  });

  it("adds through a nil-safe read, like the global counterpart", () => {
    expect(scenario()).toContain(
      'forge_demo_rt.obj_vars("corsair_a")["kills"] = (forge_demo_rt.obj_vars("corsair_a")["kills"] or 0) + 1',
    );
  });

  it("reads without touching the handle, so a dead ship still answers", () => {
    expect(scenario()).toContain(
      'forge_demo_rt.obj_get("corsair_a", "alerted") == true',
    );
  });

  it("refuses a player target when the map spawns no player ship", () => {
    const demo = withVariables();
    const noPlayer: EEProject = {
      ...demo,
      map: {
        sectors: [],
        groups: demo.map.groups.map((g) => ({
          ...g,
          objects: g.objects.filter((o) => o.type !== "PlayerSpaceship"),
        })),
        markers: [],
      },
      logic: {
        ...demo.logic,
        beats: [
          {
            id: "b",
            label: "b",
            at: 0,
            actions: [
              {
                kind: "set_object_variable",
                target: { ref: "player" },
                name: "flag",
                value: 1,
              },
            ],
          },
        ],
        rules: [],
      },
    };
    expect(() => build(noPlayer)).toThrow(/no PlayerSpaceship/);
  });
});

describe("content emission", () => {
  const templatesFile = (project: EEProject) =>
    build(project).files.find((f) => f.install === "shiptemplates")?.contents ?? "";

  it("derives a variant with copy() from a project-defined base", () => {
    expect(templatesFile(demoProject())).toContain(
      'local template_corsair_mk2 = template_corsair_mk1:copy("Corsair Mk2")',
    );
  });

  it("refuses to copy a template the project does not define", () => {
    const project = demoProject();
    const templates = project.templates.map((t) =>
      t.id === "corsair_mk2" ? { ...t, copyOf: "Atlantis" } : t,
    );
    // EE exposes no getShipTemplate(), so a stock template has no handle
    // to copy from — better a build error than a nil index in EE.
    expect(() => build({ ...project, templates })).toThrow(/no getShipTemplate\(\)/);
  });

  it("guards faction creation so a re-run does not duplicate it", () => {
    const content = build(demoProject()).files[0]?.contents ?? "";
    expect(content).toContain("local function existing_faction(name)");
    expect(content).toContain('local faction_corsairs = existing_faction("Corsairs")');
  });

  it("can express every authoring method ShipTemplate has", () => {
    const lua = templatesFile(maximalProject());
    const methods = catalog.classes["ShipTemplate"]?.methods ?? [];
    expect(methods.length).toBeGreaterThan(0);

    const missing = methods
      .map((m) => m.name)
      .filter((name) => !(name in TEMPLATE_METHODS_NOT_EMITTED))
      .filter((name) => !lua.includes(`:${name}(`));

    expect(
      missing,
      "ShipTemplate methods the schema cannot reach — model them or record why not " +
        "in TEMPLATE_METHODS_NOT_EMITTED",
    ).toEqual([]);
  });

  it("never lists a skipped method that the catalog does not have", () => {
    const known = new Set((catalog.classes["ShipTemplate"]?.methods ?? []).map((m) => m.name));
    for (const name of Object.keys(TEMPLATE_METHODS_NOT_EMITTED)) {
      expect(known, `${name} is skipped but no longer exists`).toContain(name);
    }
  });

  it("clears a tube's exclusivity before allowing anything back", () => {
    // setWeaponTubeExclusiveFor wipes every other type, so an allow written
    // before it would be silently undone.
    const lua = templatesFile(maximalProject());
    const exclusive = lua.indexOf(":setWeaponTubeExclusiveFor(");
    const allow = lua.indexOf(":weaponTubeAllowMissle(");
    expect(exclusive).toBeGreaterThan(-1);
    expect(allow).toBeGreaterThan(exclusive);
  });

  /**
   * `ShipTemplate::copy()` assigns member by member and leaves six behind,
   * so a variant that merely *matches* the base on one of them must still
   * write it — otherwise EE hands the variant its constructor default. The
   * jump-drive pair is the trap: `has_jump_drive` is carried, the range is
   * not, so the variant keeps the drive and loses the tuning.
   */
  it("re-states the fields copy() does not carry, even when unchanged", () => {
    const base = maximalProject().templates[0];
    expect(base).toBeDefined();
    if (base === undefined) return;

    const variant: EETemplateDef = {
      ...base,
      id: "corsair_mk3",
      name: "Corsair Mk3",
      copyOf: base.name,
      // The only real difference. Everything else matches the base, which
      // is exactly when the old emitter went quiet.
      hull: (base.hull ?? 100) + 50,
    };
    const lua = templatesFile({ ...maximalProject(), templates: [base, variant] });
    const chain = lua.slice(lua.indexOf(':copy("Corsair Mk3")'));

    for (const method of [
      "setLocaleName",
      "setJumpDrive",
      "setJumpDriveRange",
      "setLongRangeRadarRange",
      "setShortRangeRadarRange",
      "setImpulseSoundFile",
    ]) {
      expect(chain, `${method} must survive copy()`).toContain(`:${method}(`);
    }

    // And the ones copy() DOES carry stay quiet, or the whole point of
    // emitting a variant instead of a second full template is lost.
    expect(chain).not.toContain(":setModel(");
    expect(chain).not.toContain(":setShields(");
    expect(chain).not.toContain(":addRoomSystem(");
  });

  it("emits a variadic dock-class list as one call", () => {
    expect(templatesFile(maximalProject())).toContain(
      ':setExternalDockClasses("Frigate", "Corvette")',
    );
  });

  /**
   * `setDockClasses` and `setExternalDockClasses` assign the SAME member,
   * `external_dock_classes` — there is no `dock_classes` in
   * `shipTemplate.cpp`. The model used to carry both as separate lists and
   * the emitter wrote both, in order, so whichever ran second silently won.
   */
  it("keeps one docking list, and takes the old key into it", () => {
    const project = maximalProject();
    const template = project.templates[0];
    expect(template).toBeDefined();
    const legacy = EEProjectSchema.parse(
      JSON.parse(
        JSON.stringify({
          ...project,
          templates: [{ ...template, externalDockClasses: ["Frigate"], dockClasses: ["Starfighter"] }],
        }),
      ),
    );
    expect(legacy.templates[0]?.externalDockClasses).toEqual(["Frigate", "Starfighter"]);
    expect(legacy.templates[0]).not.toHaveProperty("dockClasses");

    const lua = templatesFile(legacy);
    expect(lua).toContain(':setExternalDockClasses("Frigate", "Starfighter")');
    expect(lua).not.toContain(":setDockClasses(");
  });
});

describe("project validation", () => {
  it("rejects a rule that points at a group which does not exist", () => {
    const project = demoProject();
    const logic = {
      ...project.logic,
      rules: [
        {
          id: "bogus",
          label: "bogus",
          when: { kind: "group_destroyed" as const, groupId: "ghosts" },
          conditions: [],
          once: true,
          actions: [],
        },
      ],
    };
    expect(() => build({ ...project, logic })).toThrow(/unknown group "ghosts"/);
  });

  it("rejects duplicate object ids across groups", () => {
    const project = demoProject();
    const groups = project.map.groups.map((g) =>
      g.id === "ambush"
        ? { ...g, objects: g.objects.map((o) => ({ ...o, id: "atlantis" })) }
        : g,
    );
    expect(() => validateProject({ ...project, map: { sectors: [], groups, markers: [] } })).toThrow(
      /duplicate object id/,
    );
  });

  it("rejects an orbit cycle", () => {
    const project = demoProject();
    const groups = project.map.groups.map((g) => ({
      ...g,
      objects: g.objects.map((o) =>
        o.type === "Planet" && o.id === "anchorage"
          ? { ...o, orbit: { targetId: "anchorage_moon", orbitTimeS: 1800 } }
          : o,
      ),
    }));
    expect(() => build({ ...project, map: { sectors: [], groups, markers: [] } })).toThrow(/orbit cycle/);
  });

  it("warns about references only the EE install could satisfy", () => {
    const warnings = validateProject(demoProject());
    expect(warnings.some((w) => w.includes('template "Atlantis"'))).toBe(true);
  });

  it("builds an empty project without complaint", () => {
    const result = build(emptyEEProject("blank", "Blank"));
    expect(result.warnings).toEqual([]);
    expect(result.files).toHaveLength(3);
  });
});

describe("golden output", () => {
  it("matches the committed snapshot", () => {
    const result = build(demoProject());
    for (const file of result.files) {
      expect(file.contents).toMatchSnapshot(file.name);
    }
  });
});

describe("codegen errors are typed", () => {
  it("throws CodegenError, not a bare Error", () => {
    const project = demoProject();
    const logic = {
      ...project.logic,
      beats: [
        {
          id: "bad",
          label: "bad",
          at: 0,
          actions: [{ kind: "spawn_group" as const, groupId: "nope" }],
        },
      ],
    };
    expect(() => build({ ...project, logic })).toThrow(CodegenError);
  });
});

describe("template copy order", () => {
  const named = (id: string, copyOf: string | null): EETemplateDef => ({
    ...createTemplate(id, id),
    copyOf,
  });

  it("emits a base before the variant that copies it, whatever the document order", () => {
    // `copy()` chains off the base's local, so a variant written first in
    // the document would index a nil in EE.
    const ordered = orderTemplates([named("b", "a"), named("a", null)]);
    expect(ordered.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("refuses a copy cycle instead of picking a starting point", () => {
    expect(() => orderTemplates([named("a", "b"), named("b", "a")])).toThrow(/cycle/);
  });

  it("leaves a missing base to the emitter, which explains it", () => {
    expect(orderTemplates([named("a", "Atlantis")]).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("variants restate only what they change", () => {
  const withTemplates = (templates: readonly EETemplateDef[]): EEProject => ({
    ...emptyEEProject("variants", "Variants"),
    templates: [...templates],
  });
  const lua = (project: EEProject): string =>
    build(project).files.find((f) => f.install === "shiptemplates")?.contents ?? "";

  const base: EETemplateDef = {
    ...createTemplate("base", "Base"),
    rooms: [{ x: 0, y: 0, width: 2, height: 1, system: "reactor" }],
    doors: [{ x: 1, y: 0, horizontal: false }],
  };

  it("does not add the base's rooms and doors a second time", () => {
    // addRoom/addDoor only ever add: restating them would give the variant
    // two reactors sitting on the same cells.
    const variant: EETemplateDef = { ...base, id: "v", name: "Variant", copyOf: "Base" };
    const emitted = lua(withTemplates([base, variant]));
    expect(emitted.split(":addRoomSystem(").length - 1).toBe(1);
    expect(emitted.split(":addDoor(").length - 1).toBe(1);
  });

  it("refuses a variant whose deck plan differs from its base", () => {
    const variant: EETemplateDef = {
      ...base,
      id: "v",
      name: "Variant",
      copyOf: "Base",
      rooms: [{ x: 0, y: 0, width: 1, height: 1, system: "impulse" }],
    };
    expect(() => build(withTemplates([base, variant]))).toThrow(/deck plan/);
  });

  it("zeroes a beam the variant drops, the way EE's own Atlantis does", () => {
    const twoBeams: EETemplateDef = {
      ...base,
      beams: [
        { ...createBeam([]), index: 0 },
        { ...createBeam([{ ...createBeam([]), index: 0 }]), index: 1 },
      ],
    };
    const variant: EETemplateDef = {
      ...twoBeams,
      id: "v",
      name: "Variant",
      copyOf: "Base",
      beams: [twoBeams.beams[0] as EEBeamDef],
    };
    expect(lua(withTemplates([twoBeams, variant]))).toContain(":setBeamWeapon(1, 0, 0, 0, 0, 0)");
  });

  it("says nothing at all when a variant changes nothing but its name", () => {
    const variant: EETemplateDef = { ...base, id: "v", name: "Variant", copyOf: "Base" };
    const body = lua(withTemplates([base, variant]));
    const tail = body.slice(body.indexOf('copy("Variant")'));
    expect(tail.trim()).toBe('copy("Variant")');
  });
});

describe("a template without a model", () => {
  // EE quits during shipTemplates.lua — exit code 5, no Lua error, nothing
  // in EmptyEpsilon.log. Verified 2026-08-12 by loading the same generated
  // file twice, differing only in whether one template named a model.
  it("is refused by the build, because EE would simply die", () => {
    const bare: EETemplateDef = { ...createTemplate("bare", "Bare"), model: null };
    expect(() =>
      validateProject({ ...emptyEEProject("p", "P"), templates: [bare] }),
    ).toThrow(/has no model/);
  });

  it("is fine when it copies a template that has one", () => {
    const base = createTemplate("base", "Base");
    const variant: EETemplateDef = {
      ...createTemplate("v", "Variant"),
      model: null,
      copyOf: "Base",
    };
    expect(() =>
      validateProject({ ...emptyEEProject("p", "P"), templates: [base, variant] }),
    ).not.toThrow();
  });

  it("gives a freshly created template a stock model", () => {
    expect(createTemplate("fresh", "Fresh").model).not.toBeNull();
  });
});
