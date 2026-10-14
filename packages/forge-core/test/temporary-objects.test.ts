import { emptyEEProject, type EEProject } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load.js";
import { buildProject } from "../src/codegen/build.js";
import { createMarker, createObject } from "../src/editor/factories.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";
import { luaAvailable, runGeneratedLua, type LuaStep } from "./fixtures/lua-world.js";

/**
 * The crew's mines, probes and missiles across a jump (ADR-0057). The generated Lua runs against a mock world: this is the
 * model of the rule ("remove only what is known to belong to the old side"), NOT evidence about the engines — those runs are in
 * docs/verification/temporary-objects/.
 */
const at = (x: number, y: number) => ({ x, y });
const hostile = (id: string, x: number, y: number) => createObject("CpuShip", id, at(x, y), { faction: "Kraylor", template: "MT52 Hornet", callsign: id.toUpperCase() });
const jump = (to: string, marker: string) => ({ kind: "change_sector" as const, sectorId: to, arrivalMarkerId: marker, rotation: null });

/** Two sectors on the SAME coordinates, a Shared second ship, a guard in each sector. Jumps at t=10 (A→B), t=20 (B→A), t=30 (A→B), 12 (refused). */
function overlap(): EEProject {
  const base = emptyEEProject("tmp", "Tmp");
  return {
    ...base,
    map: {
      sectors: [{ id: "sys-a", label: "A" }, { id: "sys-b", label: "B" }],
      startSector: "sys-a",
      groups: [
        { id: "ship", label: "Ship", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "player", at(0, 0), {})] },
        { id: "second", label: "Second", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "second", at(800, -3000), {})] },
        { id: "a_guard", label: "A guard", when: "on_start", sector: "sys-a", objects: [hostile("ga", 800, 0)] },
        { id: "b_guard", label: "B guard", when: "on_start", sector: "sys-b", objects: [hostile("gb", 800, 0)] },
      ],
      markers: [createMarker("arrive_a", "A", at(0, 0), "sys-a"), createMarker("arrive_b", "B", at(0, 0), "sys-b")],
    },
    logic: {
      ...base.logic,
      variables: [{ name: "wiped", initial: 0 }],
      beats: [
        { id: "j1", label: "A to B", at: 10, actions: [jump("sys-b", "arrive_b")] },
        { id: "same", label: "same sector", at: 12, actions: [jump("sys-b", "arrive_b")] },
        { id: "j2", label: "B to A", at: 20, actions: [jump("sys-a", "arrive_a")] },
        { id: "j3", label: "A to B", at: 30, actions: [jump("sys-b", "arrive_b")] },
      ],
      rules: [
        { id: "r_a", label: "A guard down", once: false, when: { kind: "group_destroyed", groupId: "a_guard" }, conditions: [], actions: [{ kind: "add_variable", name: "wiped", delta: 1 }] },
        { id: "r_b", label: "B guard down", once: false, when: { kind: "group_destroyed", groupId: "b_guard" }, conditions: [], actions: [{ kind: "victory", faction: "Human Navy" }] },
      ],
    },
  };
}

const M = "tmp_map";
/** Lua helpers used by the probes: a temporary object fired by a map object (or by nobody, or by a stranger), and a census. */
const fire = (kind: string, owner: string | "nobody" | "stranger", x = 0, y = 0) =>
  `__W.temp(${JSON.stringify(kind)}, ${owner === "nobody" ? "nil" : owner === "stranger" ? "CpuShip()" : `${M}.objects[${JSON.stringify(owner)}]`}, ${x}, ${y})`;
const census = `(function() local n = 0 for _, o in pairs(getAllObjects()) do if o._cls == "Mine" or o._cls == "ScanProbe" or o._cls == "HomingMissile" or o._cls == "Missile" then n = n + 1 end end return n end)()`;
const registry = `(function() local n = 0 for _ in pairs(${M}.temporary or {}) do n = n + 1 end return n end)()`;
/** The engine forgetting a dead owner: 2024 returns nil from getOwner(); 2026's component field no longer names it. */
const forget = (o: string) => `${o}._owner = nil; local c = rawget(${o}, "components"); if c ~= nil and c.explode_on_touch ~= nil then c.explode_on_touch.owner = nil end`;
const lines = (...stmts: string[]) => `(function() ${stmts.join(" ")} return ${census} .. "/" .. ${registry} end)()`;
const steps = (extra: Record<number, Partial<LuaStep>>): LuaStep[] => Array.from({ length: 36 }, (_, t) => ({ t, probe: census, ...(extra[t] ?? {}) }));

describe.skipIf(!luaAvailable)("temporary objects across a jump, in a mock world (not the engine)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    const kinds = target === TARGET_2024 ? { missile: "HomingMissile" } : { missile: "Missile" };
    describe(target, () => {
      it("removes what the ship, a Shared ship and an object of the old sector fired; keeps what has no known owner", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          9: { probe: lines() },
          5: { probe: lines(
            `${fire("Mine", "player", -900, 0)};`, `${fire("ScanProbe", "player", 2900, 0)};`, `${fire(kinds.missile, "player", 0, -300)};`,
            `${fire(kinds.missile, "second", 800, -3800)};`, `${fire(kinds.missile, "ga", 900, 0)};`,
            // not identifiable: nobody's, and a stranger's (an object the map did not place)
            `${fire("Mine", "nobody", 5000, 5000)};`, `${fire("Mine", "stranger", 6000, 6000)};`) },
        }));
        const at_ = (t: number) => snaps.find((s) => s.t === t)!;
        // (a probe reads the world BEFORE that second's update; the jump at t=10 shows in the probe of t=11)
        expect(at_(9).probe).toBe("7/5"); // 7 exist; the watch (every 2 s) registered the five of known owners
        expect(at_(10).probe).toBe("7");
        expect(at_(11).probe).toBe("2"); // the jump: the five of known owners are gone, the two unidentifiable ones are NOT touched
        expect(at_(10).sector).toBe("sys-b");
        expect(at_(10).victories).toBe(0);
      });

      it("a removal is not a destruction: nothing in the scenario notices, and combat still counts", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          5: { probe: lines(`${fire("Mine", "ga", -900, 0)};`, `${fire(kinds.missile, "player", 0, -300)};`) },
          25: { destroyGroups: ["a_guard"] },
        }));
        const at_ = (t: number) => snaps.find((s) => s.t === t)!;
        expect(at_(11).vars["wiped"]).toBe("0"); // the guard of A was unloaded, not killed
        expect(at_(24).vars["wiped"]).toBe("0");
        expect(at_(25).vars["wiped"]).toBe("1"); // a real kill in A (after the B→A jump) is recognised
        expect(at_(35).victories).toBe(0);
      });

      it("an object whose owner died after the watch saw it is still removed (the engine forgets such an owner)", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          // fired at t=3 by the A guard; the watch at t=4 registers it; the owner dies at t=6 and the engine forgets it
          3: { probe: lines(`${M}._orphan = ${fire(kinds.missile, "ga", 900, 0)};`) },
          6: { destroyGroups: ["a_guard"], probe: `(function() ${forget(`${M}._orphan`)} return ${census} end)()` },
        }));
        const at_ = (t: number) => snaps.find((s) => s.t === t)!;
        expect(at_(10).probe).toBe("1");
        expect(at_(11).probe).toBe("0");
      });

      it("one fired and orphaned between two scans is NOT removed (the limit: the engine no longer says whose it was)", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          7: { probe: `(function() local o = ${fire(kinds.missile, "ga", 900, 0)}; ${forget("o")} return ${census} end)()` },
        }));
        expect(snaps.find((s) => s.t === 11)!.probe).toBe("1");
      });

      it("reads a list with nil holes (EE 2024 returns one where an object is already gone) without stopping at the first", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          1: { probe: `(function() local real = getAllObjects; getAllObjects = function() local r = {}; for i, o in ipairs(real()) do r[i + 2] = o end; return r end return 0 end)()` },
          5: { probe: lines(`${fire("Mine", "player", -900, 0)};`, `${fire(kinds.missile, "second", 800, -3800)};`) },
        }));
        expect(snaps.find((s) => s.t === 9)!.probe).toBe("2"); // there, behind the holes
        expect(snaps.find((s) => s.t === 11)!.probe).toBe("0");
      });

      it("a refused or same-sector request removes nothing", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({ 11: { probe: lines(`${fire("Mine", "player", -900, 0)};`) } }));
        // t=12 asks for B again while in B: a no-op, so the mine of the player stays; t=20 is the next real jump
        expect(snaps.find((s) => s.t === 13)!.probe).toBe("1");
        expect(snaps.find((s) => s.t === 21)!.probe).toBe("0");
      });

      it("the registry does not grow: it is empty after every jump, and invalid handles are dropped at the next scan", () => {
        const snaps = runGeneratedLua(overlap(), target, steps({
          5: { probe: lines(`${fire("Mine", "player")};`, `${fire("ScanProbe", "player")};`) },
          11: { probe: lines() },
          15: { probe: lines(`${fire("Mine", "player")};`) },
          21: { probe: lines() },
          // an object destroyed by something else (it exploded on a target) is forgotten by the next watch
          23: { probe: lines(`${M}._x = ${fire("Mine", "player")};`) },
          25: { probe: registry },
          26: { probe: `(function() ${M}._x:destroy(); return ${registry} end)()` },
          28: { probe: registry },
          31: { probe: lines() },
        }));
        const at_ = (t: number) => snaps.find((s) => s.t === t)!;
        expect(at_(5).probe).toBe("2/0");
        expect(at_(11).probe).toBe("0/0");
        expect(at_(21).probe).toBe("0/0");
        expect(at_(25).probe).toBe("1"); // registered at the scan of t=24
        expect(at_(26).probe).toBe("1"); // destroyed from outside, not yet dropped (the scan of t=26 runs after the probe)
        expect(at_(28).probe).toBe("0"); // dropped
        expect(at_(31).probe).toBe("0/0");
      });

      it("many jumps leave nothing behind: every jump empties the registry and the world of the crew's objects", () => {
        const project = overlap();
        const beats = Array.from({ length: 40 }, (_, i) => ({ id: `h${i}`, label: `hop ${i}`, at: 10 + i * 2, actions: [i % 2 === 0 ? jump("sys-b", "arrive_b") : jump("sys-a", "arrive_a")] }));
        const many: EEProject = { ...project, logic: { ...project.logic, beats, rules: [] } };
        const plan: LuaStep[] = Array.from({ length: 95 }, (_, t) => ({ t, probe: `(function() ${t % 2 === 0 && t >= 9 ? `${fire("Mine", "player")}; ${fire(kinds.missile, "second")};` : ""} return ${census} .. "/" .. ${registry} end)()` }));
        const snaps = runGeneratedLua(many, target, plan);
        const last = snaps[snaps.length - 1]!;
        // 40 jumps, two objects fired every second second: neither the registry nor the world ever holds more than what two cycles fire
        expect(last.t).toBe(94);
        // while the jumps go on (the last is at t=88) every second second shows exactly the two just fired, and the registry is empty after each
        for (const s of snaps.filter((x) => x.t >= 10 && x.t <= 89)) expect(s.probe).toBe(s.t % 2 === 0 ? "2/0" : "0/0");
        // after the last jump the crew's objects are simply the new sector's: they accumulate only because nobody leaves it
      });
    });
  }
});

describe("the generated Lua only carries this when the project can jump", () => {
  const build = (project: EEProject, target: string) => buildProject(loadCatalog(target), { ...project, eeVersion: target }, { sourceHash: "test" }).files.map((f) => f.contents).join("\n");

  it("a project that names a start sector but never jumps has no registry, no scan, no sweep", () => {
    const p = overlap();
    const noJump: EEProject = { ...p, logic: { ...p.logic, beats: [], rules: [] } };
    for (const target of [TARGET_2024, TARGET_2026]) {
      const lua = build(noJump, target);
      expect(lua).not.toContain("sweep_temporaries");
      expect(lua).not.toContain("watch_if_due");
      expect(lua).not.toContain("M.temporary");
    }
  });

  it("a project that jumps has the registry and the periodic watch, in the flavour of its engine", () => {
    const l24 = build(overlap(), TARGET_2024);
    const l26 = build(overlap(), TARGET_2026);
    expect(l24).toContain("o.typeName");
    expect(l24).not.toContain("delayed_explode_on_touch");
    expect(l26).toContain("delayed_explode_on_touch");
    expect(l26).not.toContain("TEMPORARY_KINDS");
    for (const lua of [l24, l26]) {
      expect(lua).toContain("watch_if_due(getScenarioTime())");
      // the sweep comes before anything is unloaded, while the owners are alive
      expect(lua.indexOf("pcall(M.sweep_temporaries)")).toBeGreaterThan(-1);
      expect(lua.indexOf("pcall(M.sweep_temporaries)")).toBeLessThan(lua.indexOf("M.unload_group(name) end"));
    }
  });
});
