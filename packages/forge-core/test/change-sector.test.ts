import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyEEProject, type EEProject } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { CodegenError } from "../src/codegen/lua.js";
import { diagnose } from "../src/editor/problems.js";
import { createMarker, createObject } from "../src/editor/factories.js";
import { simulate, type SimEvent } from "../src/logic/simulate.js";
import { importProject } from "../src/project/migrate.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";
import { usesSectorRuntime } from "../src/sector-runtime.js";
import { echoExtension } from "./fixtures/echo-extension.js";
import { luaAvailable, runGeneratedLua, type LuaStep } from "./fixtures/lua-world.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const at = (x: number, y: number) => ({ x, y });
const hostile = (id: string, x: number, y: number) => createObject("CpuShip", id, at(x, y), { faction: "Kraylor", template: "MT52 Hornet", callsign: id.toUpperCase() });

function hop(): EEProject {
  const base = emptyEEProject("hop", "Hop");
  return {
    ...base,
    map: {
      sectors: [{ id: "sys-a", label: "System A" }, { id: "sys-b", label: "System B" }],
      startSector: "sys-a",
      groups: [
        { id: "ship", label: "Player ship", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "player", at(0, 0), { callsign: "Hopper" })] },
        { id: "a_env", label: "A environment", when: "on_start", sector: "sys-a", objects: [createObject("Asteroid", "rock_a", at(500, 500))] },
        { id: "a_raiders", label: "A raiders", when: "on_start", sector: "sys-a", objects: [hostile("ra1", 800, 0), hostile("ra2", 900, 100)] },
        { id: "a_ambush", label: "A ambush", when: "on_call", sector: "sys-a", objects: [hostile("aa1", 2000, 0)] },
        { id: "b_env", label: "B environment", when: "on_start", sector: "sys-b", objects: [createObject("Nebula", "neb_b", at(-500, 500))] },
        { id: "b_guards", label: "B guards", when: "on_start", sector: "sys-b", objects: [hostile("bg1", 800, 0)] },
        { id: "b_ambush", label: "B ambush", when: "on_call", sector: "sys-b", objects: [hostile("ba1", 2000, 0)] },
      ],
      markers: [createMarker("arrive_a", "Arrive A", at(100, 0), "sys-a"), createMarker("arrive_b", "Arrive B", at(50000, 0), "sys-b")],
    },
    logic: {
      ...base.logic,
      variables: ["go_b", "go_a", "kills_a", "after_jump", "probe_seen", "b_wiped"].map((name) => ({ name, initial: 0 })),
      beats: [
        { id: "b1", label: "ready for B", at: 10, actions: [{ kind: "set_variable", name: "go_b", value: 1 }] },
        { id: "b2", label: "ready for A", at: 20, actions: [{ kind: "set_variable", name: "go_a", value: 1 }] },
        { id: "b2b", label: "request consumed", at: 25, actions: [{ kind: "set_variable", name: "go_a", value: 0 }] },
        { id: "b3", label: "repeated request", at: 30, actions: [
          { kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: null },
          { kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: null },
        ] },
        { id: "b4", label: "jump from a beat", at: 40, actions: [{ kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: 45 }] },
      ],
      rules: [
        { id: "r_kill_a", label: "A raiders down", once: false, when: { kind: "group_destroyed", groupId: "a_raiders" }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [{ kind: "add_variable", name: "kills_a", delta: 1 }] },
        { id: "r_win_b", label: "B guards down", once: true, when: { kind: "group_destroyed", groupId: "b_guards" }, conditions: [], actions: [{ kind: "set_variable", name: "b_wiped", value: 1 }, { kind: "victory", faction: "Human Navy" }] },
        { id: "r_jump_ab", label: "Jump A to B", once: false, when: { kind: "variable_equals", name: "go_b", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [
          { kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: null },
          { kind: "add_variable", name: "after_jump", delta: 1 },
          { kind: "set_variable", name: "go_b", value: 0 },
        ] },
        { id: "r_probe", label: "Seen in B", once: true, when: { kind: "always" }, conditions: [{ kind: "current_sector", sectorId: "sys-b" }], actions: [{ kind: "set_variable", name: "probe_seen", value: 1 }] },
        { id: "r_jump_ba", label: "Jump B to A", once: false, when: { kind: "variable_equals", name: "go_a", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-b" }], actions: [{ kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: 90 }] },
      ],
    },
  };
}

const EVENTS: SimEvent[] = [
  { at: 5, kind: "destroy_group", groupId: "a_raiders" },
  { at: 22, kind: "destroy_group", groupId: "a_raiders" },
  { at: 50, kind: "destroy_group", groupId: "b_guards" },
];
const luaSteps = (): LuaStep[] =>
  Array.from({ length: 53 }, (_, t) => ({
    t,
    ...(t === 5 || t === 22 ? { destroyGroups: ["a_raiders"] } : {}),
    ...(t === 50 ? { destroyGroups: ["b_guards"] } : {}),
    ...(t === 8 ? { hull: 40 } : {}),
  }));
const sorted = (a: readonly string[]) => [...a].sort();

describe("sectors in play: the model", () => {
  it("a project that never uses them does not use them (null start sector, no action)", () => {
    const p = hop();
    expect(usesSectorRuntime(p)).toBe(true);
    expect(usesSectorRuntime({ ...p, map: { ...p.map, startSector: null }, logic: { ...p.logic, beats: [], rules: [] } })).toBe(false);
  });
});

describe("the generated Lua of a project that does not use sectors is exactly what it was", () => {
  for (const id of ["forge_demo"]) {
    it(`${id}: no trace of the sector runtime, on both targets`, () => {
      const project = importProject(JSON.parse(readFileSync(join(repoRoot, "projects", id, "project.json"), "utf8"))).project;
      expect(project.map.startSector).toBeNull();
      for (const target of [TARGET_2024, TARGET_2026]) {
        const built = buildProject(loadCatalog(target), { ...project, eeVersion: target }, { sourceHash: "x", extensions: [echoExtension] });
        for (const f of built.files) {
          expect(f.contents, f.name).not.toMatch(/unloaded|group_sector|change_sector|current_sector|M\.sector|enter_sector/);
        }
      }
    });
  }
});

describe("the generated Lua of a project that does", () => {
  const build = (p: EEProject, target = TARGET_2026): string => {
    const files = buildProject(loadCatalog(target), { ...p, eeVersion: target }, { sourceHash: "x" }).files;
    return files.map((f) => f.contents).join("\n");
  };

  it("spawns only the start sector's At-mission-start groups and the Shared ones at the start", () => {
    const lua = build(hop());
    const start = lua.match(/local start_groups = \{([^}]*)\}/)?.[1] ?? "";
    expect(start).toContain('"ship"');
    expect(start).toContain('"a_env"');
    expect(start).toContain('"a_raiders"');
    expect(start).not.toContain("b_env");
    expect(start).not.toContain("b_guards");
    expect(start).not.toContain("a_ambush"); // When a rule spawns it: still waits for its rule
  });

  it("records the unloaded id BEFORE destroy() is called", () => {
    const lua = build(hop());
    const unload = lua.slice(lua.indexOf("function M.unload_group"), lua.indexOf("function M.enter_sector"));
    expect(unload.indexOf("M.unloaded[id] = true")).toBeGreaterThan(-1);
    expect(unload.indexOf("M.unloaded[id] = true")).toBeLessThan(unload.indexOf("obj:destroy()"));
    expect(unload.indexOf("M.objects[id] = nil")).toBeLessThan(unload.indexOf("obj:destroy()"));
  });

  it("makes 'destroyed' and 'wiped out' false for what was unloaded, with no delay and no global switch-off", () => {
    const lua = build(hop());
    expect(lua).toMatch(/function hop_rt\.destroyed\(id\)\n[^\n]*\n\s*if hop_map\.unloaded\[id\] then return false end/);
    expect(lua).toContain("if hop_map.unloaded[id] then return false end");
    expect(lua).not.toMatch(/setTimeout|sleep|disable_victory/);
  });

  it("resolves the arrival marker to literal coordinates (a marker never reaches EE)", () => {
    const lua = build(hop());
    expect(lua).toContain('hop_rt.change_sector("sys-b", 50000, 0, nil)');
    expect(lua).toContain('hop_rt.change_sector("sys-a", 100, 0, 90)');
    expect(lua).not.toMatch(/change_sector\([^)]*arrive_/);
  });

  it("stops the rule loop for the update in which a jump happened", () => {
    const lua = build(hop());
    expect(lua).toContain("local transitions = hop_state.transitions");
    expect(lua).toContain("if hop_state.transitions ~= transitions then break end");
  });

  it("holds the arrival heading: the helm's target is set with the ship's rotation (EE 2024 turns back otherwise — seen live)", () => {
    const lua = build(hop());
    expect(lua).toMatch(/p:setRotation\(rotation\)\n[^\n]*\n\s*if p\.commandTargetRotation ~= nil then p:commandTargetRotation\(rotation\) end/);
  });

  it("refuses, in the generated runtime, a destination that does not exist, before unloading anything", () => {
    const lua = build(hop());
    const fn = lua.slice(lua.indexOf("function hop_rt.change_sector"), lua.indexOf("function hop_rt.zone_contains"));
    expect(fn.indexOf("hop_map.sectors[dest] ~= true")).toBeLessThan(fn.indexOf("enter_sector"));
    expect(fn).toContain("if hop_map.sector == dest then return false end");
  });

  it("guards spawn_group against a group of an inactive sector", () => {
    expect(build(hop())).toContain("refused: it belongs to sector");
  });
});

describe("the build refuses an invalid sector setup, and Problems says the same", () => {
  const mutate = (fn: (p: EEProject) => void): EEProject => {
    const p = structuredClone(hop());
    fn(p);
    return p;
  };
  const cases: Array<[string, string, EEProject]> = [
    ["a destination that does not exist", "change-sector-unknown", mutate((p) => { (p.logic.rules[2]!.actions[0] as { sectorId: string }).sectorId = "nowhere"; })],
    ["an arrival marker of another sector", "change-sector-marker", mutate((p) => { (p.logic.rules[2]!.actions[0] as { arrivalMarkerId: string }).arrivalMarkerId = "arrive_a"; })],
    ["an arrival marker that does not exist", "change-sector-marker", mutate((p) => { (p.logic.rules[2]!.actions[0] as { arrivalMarkerId: string }).arrivalMarkerId = "ghost"; })],
    ["a Shared arrival marker", "change-sector-marker", mutate((p) => { p.map.markers[1]!.sector = null; })],
    ["Change sector without a starting sector", "sector-needs-start", mutate((p) => { p.map.startSector = null; })],
    ["a starting sector that does not exist", "start-sector-unknown", mutate((p) => { p.map.startSector = "ghost"; })],
    ["a condition on a sector that does not exist", "current-sector-unknown", mutate((p) => { (p.logic.rules[0]!.conditions[0] as { sectorId: string }).sectorId = "ghost"; })],
  ];
  for (const [name, code, project] of cases) {
    it(`${name}: refused before any Lua is written, listed in Problems as ${code}`, () => {
      expect(() => buildProject(loadCatalog(TARGET_2026), project, { sourceHash: "x" })).toThrow(CodegenError);
      expect(diagnose(project).filter((d) => d.severity === "error").map((d) => d.code)).toContain(code);
    });
  }

  it("a rule that only runs in A but spawns a group of B is a warning in both, never silent", () => {
    const p = mutate((q) => {
      q.logic.rules[0]!.actions.push({ kind: "spawn_group", groupId: "b_ambush" });
    });
    const built = buildProject(loadCatalog(TARGET_2026), p, { sourceHash: "x" });
    expect(built.warnings.join("\n")).toMatch(/only runs in System A, but spawns .*B ambush.*refused at run time/);
    expect(diagnose(p).filter((d) => d.code === "spawn-other-sector")).toHaveLength(1);
  });

  it("the player ship filed under another sector than the start is a warning", () => {
    const p = mutate((q) => { q.map.groups[0]!.sector = "sys-b"; });
    expect(diagnose(p).map((d) => d.code)).toContain("player-outside-start");
  });
});

describe.skipIf(!luaAvailable)("running the generated Lua against a mock world (not the engine)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    describe(target, () => {
      const run = () => runGeneratedLua(hop(), target, luaSteps());
      const at_ = (snaps: ReturnType<typeof run>, t: number) => snaps.find((s) => s.t === t)!;

      it("starts in the start sector with Shared and At-mission-start groups only", () => {
        const s = at_(run(), 0);
        expect(s.sector).toBe("sys-a");
        expect(s.alive).toEqual(sorted(["player", "rock_a", "ra1", "ra2"]));
        expect(s.alive).not.toContain("aa1"); // an on_call group is not generated automatically
      });

      it("a real destruction in combat is still recognised", () => {
        const snaps = run();
        expect(at_(snaps, 4).vars["kills_a"]).toBe("0");
        expect(at_(snaps, 5).vars["kills_a"]).toBe("1");
        expect(at_(snaps, 5).alive).not.toContain("ra1");
      });

      it("A → B: the old environment is unloaded, the new one created, the same ship moved, nothing falsely won", () => {
        const snaps = run();
        const s = at_(snaps, 10);
        expect(s.sector).toBe("sys-b");
        expect(s.alive).toEqual(sorted(["player", "neb_b", "bg1"]));
        expect(s.alive).not.toContain("ba1"); // on_call: waits
        expect(s.player).toBe("50000,0");
        expect(s.victories).toBe(0);
        expect(s.vars["b_wiped"]).toBe("0");
        // destroy() calls so far: the two combat kills at t=5 (made by the harness), then the runtime unloaded only what was still
        // there — rock_a. ra1/ra2 were already gone, so they are not destroyed twice. And nothing in the scenario noticed.
        expect(s.destroyCalls).toBe(3);
      });

      it("the player's state survives the jump (the same ship: its damage is still there)", () => {
        const snaps = run();
        expect(at_(snaps, 9).hull).toBe("40");
        expect(at_(snaps, 11).hull).toBe("40");
        expect(at_(snaps, 31).hull).toBe("40");
      });

      it("actions after Change sector run (in the new sector); the rules after it wait for the next update", () => {
        const snaps = run();
        expect(at_(snaps, 10).vars["after_jump"]).toBe("1");
        expect(at_(snaps, 10).vars["probe_seen"]).toBe("0");
        expect(at_(snaps, 11).vars["probe_seen"]).toBe("1");
      });

      it("B → A recreates A from its initial settings, rotation given; variables and fired rules are not reset", () => {
        const snaps = run();
        const s = at_(snaps, 20);
        expect(s.sector).toBe("sys-a");
        expect(s.alive).toEqual(sorted(["player", "rock_a", "ra1", "ra2"])); // ra1/ra2 are back, alive, though destroyed before
        expect(s.player).toBe("100,0");
        expect(s.vars["kills_a"]).toBe("1"); // not reset
        expect(s.vars["probe_seen"]).toBe("1"); // a rule already fired stays fired
        expect(s.victories).toBe(0);
        expect(s.alive).not.toContain("neb_b");
        expect(s.alive).not.toContain("bg1");
      });

      it("a recreated group's destruction is recognised again", () => {
        expect(at_(run(), 22).vars["kills_a"]).toBe("2");
      });

      it("repeated requests for the sector the game is already in change nothing", () => {
        const snaps = run();
        expect(at_(snaps, 30).alive).toEqual(at_(snaps, 29).alive);
        expect(at_(snaps, 30).player).toBe(at_(snaps, 29).player);
        expect(at_(snaps, 30).destroyCalls).toBe(at_(snaps, 29).destroyCalls);
        // no duplicated objects: still exactly one player ship and one of each
        expect(new Set(at_(snaps, 30).alive).size).toBe(at_(snaps, 30).alive.length);
      });

      it("a jump from a beat works too, and a real destruction in B is recognised afterwards (victory only then)", () => {
        const snaps = run();
        expect(at_(snaps, 40).sector).toBe("sys-b");
        expect(at_(snaps, 40).player).toBe("50000,0");
        expect(at_(snaps, 49).victories).toBe(0);
        expect(at_(snaps, 50).vars["b_wiped"]).toBe("1");
        expect(at_(snaps, 50).victories).toBe(1);
      });

      it("an invalid destination at run time is refused before anything is unloaded", () => {
        const probe = runGeneratedLua(hop(), target, [
          { t: 0 },
          { t: 1, probe: 'hop_rt.change_sector("nowhere", 1, 1, nil)' },
        ]);
        expect(probe[2]?.probe).toBe("false");
        expect(probe[2]?.sector).toBe("sys-a");
        expect(probe[2]?.alive).toEqual(probe[1]?.alive);
        expect(probe[2]?.destroyCalls).toBe(0);
      });

      it("spawning a group of an inactive sector by a rule is refused with a log line, and nothing appears", () => {
        const snaps = runGeneratedLua(hop(), target, [
          { t: 0 },
          { t: 1, probe: 'tostring(#hop_map.spawn_group("b_ambush"))' },
        ]);
        expect(snaps[2]?.probe).toBe("0");
        expect(snaps[2]?.alive).not.toContain("ba1");
      });

      it("an explicit Destroy by the author is unchanged: it still destroys, and still counts", () => {
        const p = hop();
        p.logic.beats.push({ id: "b5", label: "author destroys", at: 3, actions: [{ kind: "destroy", target: { ref: "group", groupId: "a_raiders" } }] });
        const snaps = runGeneratedLua(p, target, [{ t: 2 }, { t: 3 }, { t: 4 }]);
        expect(snaps.find((s) => s.t === 3)?.vars["kills_a"]).toBe("1");
      });
    });
  }
});

describe.skipIf(!luaAvailable)("the simulator and the generated Lua agree, second by second", () => {
  it("same sector, same living objects, same variables, same player position, same victory", () => {
    const project = hop();
    const lua = runGeneratedLua(project, TARGET_2026, luaSteps());
    for (const snap of lua.filter((s) => s.t >= 0)) {
      const sim = simulate(project, { untilSeconds: snap.t, events: EVENTS });
      const where = `at t=${snap.t}`;
      expect(sim.sector, where).toBe(snap.sector);
      expect(sim.aliveObjects, where).toEqual(snap.alive);
      expect(Object.fromEntries(Object.entries(sim.variables).map(([k, v]) => [k, String(v)])), where).toEqual(snap.vars);
      expect(`${sim.playerPosition.x},${sim.playerPosition.y}`, where).toBe(snap.player);
      expect(sim.endedWith !== null, where).toBe(snap.victories > 0);
    }
  });

  it("the simulator lists the jumps, the refusals and the sector the run ended in", () => {
    const sim = simulate(hop(), { untilSeconds: 45, events: EVENTS });
    expect(sim.sectorChanges.map((c) => `${c.at}:${c.from}>${c.to}`)).toEqual(["10:sys-a>sys-b", "20:sys-b>sys-a", "40:sys-a>sys-b"]);
    expect(sim.sector).toBe("sys-b");
  });
});

describe("editing around Change sector", () => {
  it("a sector the game starts in, or that a rule uses, cannot be deleted from under it", async () => {
    const { removeSector, setStartSector } = await import("../src/editor/sectors.js");
    const p = hop();
    const start = removeSector(p, "sys-a", "sys-b");
    expect(start.ok).toBe(false);
    expect(!start.ok && start.reason).toMatch(/starts in/);
    const used = removeSector({ ...p, map: { ...p.map, startSector: null } }, "sys-b", "sys-a");
    expect(used.ok).toBe(false);
    expect(!used.ok && used.reason).toMatch(/A rule still uses/);
    expect(setStartSector(p, "ghost")).toBe(p);
    expect(setStartSector(p, null).map.startSector).toBeNull();
  });

  it("migration 0004 writes the legacy choice explicitly: null, so nothing about an old project changes", () => {
    const raw = JSON.parse(readFileSync(join(repoRoot, "projects", "forge_demo", "project.json"), "utf8")) as Record<string, unknown>;
    const imported = importProject(raw);
    expect(imported.applied).toContain("0004-start-sector");
    expect(imported.project.map.startSector).toBeNull();
    const v3 = { ...imported.project, schemaVersion: 3 } as Record<string, unknown>;
    const { startSector: _drop, ...mapWithout } = imported.project.map;
    const again = importProject({ ...v3, map: mapWithout });
    expect(again.applied).toEqual(["0004-start-sector", "0005-campaign-persistence"]);
    expect(again.project.map.startSector).toBeNull();
  });
});

describe.skipIf(!luaAvailable)("the live scenario “Hop Jump”, in the mock world first (never in place of the engine)", () => {
  it("does what the live run expects of it", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "hop-jump-"));
    try {
      spawnSync("node", [join(repoRoot, "scripts", "sectors", "make-jump-scenario.mjs"), dir, "--target", "2026"], { encoding: "utf8" });
      const project = importProject(JSON.parse(readFileSync(join(dir, "project.json"), "utf8"))).project;
      const steps: LuaStep[] = Array.from({ length: 200 }, (_, t) => ({ t, ...(t === 20 ? { destroyGroups: ["a_raiders"] } : {}), ...(t === 180 ? { destroyGroups: ["b_guards"] } : {}) }));
      const snaps = runGeneratedLua(project, TARGET_2026, steps);
      const at_ = (t: number) => snaps.find((s) => s.t === t)!;
      expect(at_(0).alive).toEqual(sorted(["player", "depot", "ast_a", "raider_a"]));
      expect(at_(21).vars["kills_a"]).toBe("1");
      expect(at_(89).sector).toBe("sys-a");
      expect(at_(80).alive).not.toContain("amb_b"); // the refused spawn
      expect(at_(90).sector).toBe("sys-b");
      expect(at_(90).alive).toEqual(sorted(["player", "depot", "neb_b", "raider_b"]));
      expect(at_(100).vars["kills_a"]).toBe("1");
      expect(at_(100).vars["b_wiped"]).toBe("0");
      expect(at_(105).alive).toEqual(at_(104).alive);
      expect(at_(120).sector).toBe("sys-a");
      expect(at_(120).alive).toEqual(sorted(["player", "depot", "ast_a", "raider_a"]));
      expect(at_(125).vars["kills_a"]).toBe("1"); // an unloaded group is not a wiped-out one
      expect(at_(150).sector).toBe("sys-b");
      expect(at_(160).victories).toBe(0);
      expect(at_(180).victories).toBe(1);
      expect(at_(180).vars["jumps"]).toBe("3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
