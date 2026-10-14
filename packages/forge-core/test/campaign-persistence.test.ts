import { emptyEEProject, type EEProject } from "@forge/contracts";
import { describe, expect, it } from "vitest";
import { createMarker, createObject } from "../src/editor/factories.js";
import { emptyDialogue } from "../src/editor/dialogue-forms.js";
import { TARGET_2024, TARGET_2026 } from "../src/targets.js";
import { simulate, type SimEvent } from "../src/logic/simulate.js";
import { diagnose } from "../src/editor/problems.js";
import { luaAvailable, runCampaignLua, type LuaStep } from "./fixtures/lua-world.js";

/**
 * Frozen sectors and campaign saves (ADR-0058), the generated Lua against a mock world: the rules of the model, with a real JSON round trip through
 * a mock ScriptStorage and a real second Lua state for the restart. NOT evidence about the engines (docs/verification/campaign-persistence/ is).
 */
const at = (x: number, y: number) => ({ x, y });
const hostile = (id: string, x: number, y: number) => createObject("CpuShip", id, at(x, y), { faction: "Kraylor", template: "MT52 Hornet", callsign: id.toUpperCase() });
const jump = (to: string, marker: string) => ({ kind: "change_sector" as const, sectorId: to, arrivalMarkerId: marker, rotation: null });
const num = (name: string, value: number) => ({ kind: "set_variable" as const, name, value });
const add = (name: string) => ({ kind: "add_variable" as const, name, delta: 1 });

/** Two sectors on the same coordinates. A holds two raiders and a station; B a guard. Jumps at t=10 (A→B) and t=40 (B→A) of the campaign clock. */
export function campaign(overrides: Partial<EEProject["campaign"]> = {}): EEProject {
  const base = emptyEEProject("camp", "Camp");
  return {
    ...base,
    campaign: { persistence: true, ...overrides },
    map: {
      sectors: [{ id: "sys-a", label: "A" }, { id: "sys-b", label: "B" }],
      startSector: "sys-a",
      groups: [
        { id: "ship", label: "Ship", when: "on_start", sector: null, objects: [createObject("PlayerSpaceship", "player", at(0, 0), { callsign: "Hopper" })] },
        { id: "a_station", label: "A station", when: "on_start", sector: "sys-a", objects: [createObject("SpaceStation", "stn_a", at(1000, 1000), { faction: "Human Navy", template: "Small Station", callsign: "STN-A" })] },
        { id: "a_raiders", label: "A raiders", when: "on_start", sector: "sys-a", objects: [hostile("ra1", 800, 0), hostile("ra2", 900, 100)] },
        { id: "a_ambush", label: "A ambush", when: "on_call", sector: "sys-a", objects: [hostile("aa1", 2000, 0)] },
        { id: "b_guards", label: "B guards", when: "on_start", sector: "sys-b", objects: [hostile("bg1", 800, 0)] },
      ],
      markers: [createMarker("arrive_a", "A", at(0, 0), "sys-a"), createMarker("arrive_b", "B", at(0, 0), "sys-b")],
    },
    logic: {
      ...base.logic,
      variables: ["reward", "a_timer", "b_timer", "a_rule", "wiped", "jumps", "called"].map((name) => ({ name, initial: 0 })),
      beats: [
        { id: "j1", label: "A to B", at: 10, sector: null, actions: [jump("sys-b", "arrive_b"), add("jumps")] },
        { id: "j2", label: "B to A", at: 40, sector: null, actions: [jump("sys-a", "arrive_a"), add("jumps")] },
        { id: "a_t", label: "A timer", at: 15, sector: "sys-a", actions: [num("a_timer", 1)] },
        { id: "b_t", label: "B timer", at: 5, sector: "sys-b", actions: [num("b_timer", 1)] },
      ],
      rules: [
        { id: "r_reward", label: "reward for ra1", once: true, sector: null, when: { kind: "object_destroyed", objectId: "ra1" }, conditions: [], actions: [add("reward")] },
        { id: "r_wipe", label: "A raiders wiped", once: false, sector: null, when: { kind: "group_destroyed", groupId: "a_raiders" }, conditions: [], actions: [add("wiped")] },
        { id: "r_a_local", label: "A local rule", once: true, sector: "sys-a", when: { kind: "elapsed", seconds: 12 }, conditions: [], actions: [num("a_rule", 1)] },
      ],
    },
  };
}

const sorted = (a: readonly string[]) => [...a].sort();
const hullOf = (id: string) => `tostring(camp_map.objects[${JSON.stringify(id)}] and camp_map.objects[${JSON.stringify(id)}]:getHull())`;
const posOf = (id: string) => `(function() local o = camp_map.objects[${JSON.stringify(id)}] if o == nil then return "-" end local x, y = o:getPosition() return string.format("%.0f,%.0f", x, y) end)()`;
const probe = (...exprs: string[]) => `(${exprs.map((e) => e).join(" .. '/' .. ")})`;
const state = probe(hullOf("stn_a"), posOf("ra2"), posOf("player"));

/** Phase 1: t = 0 … 20 in A then B. At t=2 ra1 is destroyed; at t=3 the station is damaged and ra2 moved. */
const phase1 = (): LuaStep[] =>
  Array.from({ length: 21 }, (_, t) => ({
    t,
    probe: state,
    ...(t === 2 ? { destroyObjects: ["ra1"] } : {}),
    // the crew presses Save checkpoint (the Engineering button) just before the engine is closed
    ...(t === 20 ? { probe: `(function() camp_rt.persist.manual_save() return ${state} end)()` } : {}),
    ...(t === 3 ? { probe: `(function() camp_map.objects["stn_a"]:setHull(77) camp_map.objects["ra2"]:setPosition(1234, 567) return ${state} end)()` } : {}),
  }));

describe.skipIf(!luaAvailable)("frozen sectors and campaign saves, in a mock world (not the engine)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    describe(target, () => {
      const first = () => runCampaignLua(campaign(), target, phase1());
      const at_ = (run: { snaps: { t: number }[] }, t: number) => run.snaps.find((s) => s.t === t)!;

      it("starts a new campaign in the starting sector and writes checkpoint 1", () => {
        const run = first();
        const s0 = run.snaps.find((s) => s.t === -1)!;
        expect(s0.sector).toBe("sys-a");
        expect(sorted(s0.alive)).toEqual(sorted(["player", "stn_a", "ra1", "ra2"]));
        const keys = Object.keys(run.storage).sort();
        expect(keys).toContain("forge/camp/index");
        expect(keys).toContain("forge/camp/c1/head");
        expect(keys.filter((k) => /forge\/camp\/c1\/[ab]$/.test(k)).length).toBeGreaterThan(0);
        expect(Object.keys(run.storage).every((k) => k.startsWith("forge/camp/"))).toBe(true);
      });

      it("a reward fires once, and a real kill is recognised", () => {
        const run = first();
        expect(at_(run, 1).vars["reward"]).toBe("0");
        expect(at_(run, 2).vars["reward"]).toBe("1"); // destroyed just before t=2's update
        expect(at_(run, 19).vars["reward"]).toBe("1");
      });

      it("A → B unloads A (alive, destroyed or not) and builds B; the ship goes along", () => {
        const run = first();
        const s = at_(run, 10);
        expect(s.sector).toBe("sys-b");
        expect(sorted(s.alive)).toEqual(sorted(["player", "bg1"]));
        expect(s.vars["wiped"]).toBe("0"); // A's group was unloaded: not wiped out
        expect(s.victories).toBe(0);
      });

      it("B's own clock runs only while B is active (its scoped beat at 5 s fires at t=15)", () => {
        const run = first();
        expect(at_(run, 14).vars["b_timer"]).toBe("0");
        expect(at_(run, 15).vars["b_timer"]).toBe("1");
      });

      it("a scoped beat and rule of A did not run while A was unloaded", () => {
        const run = first();
        expect(at_(run, 19).vars["a_timer"]).toBe("0");
        expect(at_(run, 19).vars["a_rule"]).toBe("0");
      });

      describe("after a restart (a fresh Lua state reading what the first one left in ScriptStorage)", () => {
        const resumed = () => {
          const run1 = first();
          const phase2: LuaStep[] = Array.from({ length: 31 }, (_, t) => ({ t, probe: state, ...(t === 30 ? { destroyObjects: ["ra2"] } : {}) }));
          return { run1, run2: runCampaignLua(campaign(), target, phase2, { storage: run1.storage }) };
        };

        it("resumes the saved campaign in sector B, not a new one", () => {
          const { run2 } = resumed();
          const s0 = run2.snaps.find((s) => s.t === -1)!;
          expect(s0.sector).toBe("sys-b");
          expect(sorted(s0.alive)).toEqual(sorted(["player", "bg1"]));
          expect(s0.vars["reward"]).toBe("1");
          expect(s0.vars["b_timer"]).toBe("1");
          expect(Object.keys(run2.storage).filter((k) => /forge\/camp\/c\d+\/head/.test(k))).toEqual(["forge/camp/c1/head"]); // the same game, no second one
        });

        it("the engineer's power and coolant sliders of the player ship come back as REQUESTS (a plain setter is snapped back by the engine, measured live)", () => {
          const slider = `(function() local s = camp_map.objects["player"]._sys.impulse return tostring(s.pwreq) .. "/" .. tostring(s.clreq) end)()`;
          const steps: LuaStep[] = Array.from({ length: 21 }, (_, t) => ({
            t,
            probe: t === 20 ? slider : state,
            ...(t === 5 ? { probe: `(function() local p = camp_map.objects["player"] p:commandSetSystemPowerRequest("impulse", 2) p:commandSetSystemCoolantRequest("impulse", 4) return ${state} end)()` } : {}),
            ...(t === 19 ? { probe: `(function() camp_rt.persist.manual_save() return ${state} end)()` } : {}),
          }));
          const run1 = runCampaignLua(campaign(), target, steps);
          const run2 = runCampaignLua(campaign(), target, [{ t: 1, probe: slider }], { storage: run1.storage });
          expect(run2.snaps.find((s) => s.t === 1)!.probe).toBe("2/4");
        });

        it("the campaign clock continues: the global beat at 40 fires 20 s into the second run", () => {
          const { run2 } = resumed();
          expect(at_(run2, 19).sector).toBe("sys-b");
          expect(at_(run2, 20).sector).toBe("sys-a");
          expect(at_(run2, 20).vars["jumps"]).toBe("2");
        });

        it("back in A: the dead enemy is still dead, the station kept its damage, the moved ship its position, the reward is not repeated", () => {
          const { run2 } = resumed();
          const s = at_(run2, 21);
          expect(s.sector).toBe("sys-a");
          expect(sorted(s.alive)).toEqual(sorted(["player", "stn_a", "ra2"])); // ra1 is not rebuilt
          expect(s.alive).not.toContain("ra1");
          expect(s.probe.split("/")[0]).toBe("77"); // the station's hull
          expect(s.probe.split("/")[1]).toBe("1234,567"); // ra2 where it was left
          expect(s.vars["reward"]).toBe("1");
          expect(s.vars["wiped"]).toBe("0"); // ra1 dead, ra2 alive: not wiped
          expect(s.victories).toBe(0);
        });

        it("A's local timer was frozen while A was away: its clock stood at 11 s (eleven updates of one second in A), so the beat at 15 fires four seconds after the return", () => {
          const { run2 } = resumed();
          expect(at_(run2, 23).vars["a_timer"]).toBe("0");
          expect(at_(run2, 24).vars["a_timer"]).toBe("1");
          expect(at_(run2, 20).vars["a_rule"]).toBe("0");
          expect(at_(run2, 21).vars["a_rule"]).toBe("1"); // elapsed 12 on A's clock: one update after the return
        });

        it("a later real destruction is still recognised, once", () => {
          const { run2 } = resumed();
          expect(at_(run2, 29).vars["wiped"]).toBe("0");
          expect(at_(run2, 30).vars["wiped"]).toBe("1");
        });

        it("no duplicates: one of each object after the return", () => {
          const { run2 } = resumed();
          const s = at_(run2, 25);
          expect(new Set(s.alive).size).toBe(s.alive.length);
        });
      });
    });
  }
});

describe.skipIf(!luaAvailable)("the simulator and the generated Lua agree, second by second, across a restart", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    it(`${target}: sector, living objects and variables`, () => {
      const run1 = runCampaignLua(campaign(), target, phase1());
      const phase2: LuaStep[] = Array.from({ length: 31 }, (_, t) => ({ t, ...(t === 30 ? { destroyObjects: ["ra2"] } : {}) }));
      const run2 = runCampaignLua(campaign(), target, phase2, { storage: run1.storage });
      const events: SimEvent[] = [
        { at: 2, kind: "destroy_object", objectId: "ra1" },
        { at: 20, kind: "checkpoint" },
        { at: 20, kind: "restart" },
        { at: 50, kind: "destroy_object", objectId: "ra2" },
      ];
      const luaAt = (campaignT: number) => (campaignT < 20 ? run1.snaps.find((s) => s.t === campaignT) : run2.snaps.find((s) => s.t === campaignT - 20))!;
      for (let t = 0; t <= 50; t += 1) {
        const sim = simulate(campaign(), { untilSeconds: t, events });
        const lua = luaAt(t);
        const where = `t=${t}`;
        expect(sim.sector, where).toBe(lua.sector);
        expect([...sim.aliveObjects].sort(), where).toEqual([...lua.alive].sort());
        for (const [name, value] of Object.entries(sim.variables)) expect(String(value), `${where} ${name}`).toBe(lua.vars[name] ?? String(value));
      }
    });
  }
});

// ----------------------------------------------------------------------------------------------------------------------------------------------------------
const messagesProbe = `table.concat(__W.messages, " ## ")`;
const slotKeys = (storage: Record<string, string>): string[] => Object.keys(storage).filter((k) => /forge\/camp\/c\d+\/[ab]$/.test(k));
const gamesOf = (storage: Record<string, string>): string[] => Object.keys(storage).filter((k) => /forge\/camp\/c\d+\/head$/.test(k)).map((k) => k.split("/")[2] ?? "").sort();
const bootStep = (extra: Partial<LuaStep> = {}): LuaStep[] => [{ t: 0, probe: messagesProbe, ...extra }];

describe.skipIf(!luaAvailable)("campaign saves are validated, never loaded partially and never overwritten (mock world)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    describe(target, () => {
      const saved = () => runCampaignLua(campaign(), target, phase1());
      const boot = (storage: Record<string, string>, project: EEProject = campaign(), settings?: Record<string, string>) =>
        runCampaignLua(project, target, bootStep(), { storage, ...(settings === undefined ? {} : { settings }) });

      it("a first run with no save starts campaign c1; its head, its slots, the index and the message trail are the only keys, all under forge/camp/", () => {
        const { storage } = saved();
        expect(Object.keys(storage).sort()).toEqual(["forge/camp/c1/a", "forge/camp/c1/b", "forge/camp/c1/head", "forge/camp/index", "forge/camp/messages"]);
      });

      it("the checkpoint is small and does not grow with the number of checkpoints", () => {
        const { storage } = saved();
        const size = (storage["forge/camp/c1/a"] ?? "").length;
        expect(size).toBeGreaterThan(500);
        expect(size).toBeLessThan(8000);
        // run again from that store for the same number of steps: the same keys, about the same size
        const again = runCampaignLua(campaign(), target, phase1(), { storage, settings: { Campaign: "New" } });
        expect(slotKeys(again.storage).length).toBe(4); // c1 a/b and c2 a/b: the old game untouched, the new one beside it
      });

      it("a malformed head with readable slots: the newest readable checkpoint is recovered, and the crew is told that the pointer was the problem", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/head": "{not json" };
        const run = boot(broken);
        const msg = run.snaps[1]?.probe ?? "";
        expect(msg).toContain("resumed from checkpoint");
        expect(msg).toContain("pointer to the newest checkpoint was unreadable");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("a malformed head and no readable slot: the resume is BLOCKED (nothing built, nothing changed), the old keys are untouched", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/head": "{not json", "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const run = boot(broken);
        const msg = run.snaps[1]?.probe ?? "";
        expect(msg).toContain("CAMPAIGN NOT RESUMED");
        expect(msg).toContain("is damaged and cannot be read");
        expect(msg).not.toContain("incompatible");
        for (const k of Object.keys(broken).filter((k) => !k.endsWith("/messages"))) expect(run.storage[k], k).toBe(broken[k]);
        expect(gamesOf(run.storage)).toEqual(["c1"]);
        expect(run.snaps.find((s) => s.t === -1)!.alive).toEqual([]);
      });

      it("a project changed structurally since the save: refused with the reason, nothing loaded", () => {
        const { storage } = saved();
        const changed = campaign();
        const extra = createObject("Asteroid", "rock_new", at(10, 10));
        const edited: EEProject = { ...changed, map: { ...changed.map, groups: changed.map.groups.map((g) => (g.id === "a_station" ? { ...g, objects: [...g.objects, extra] } : g)) } };
        const run = boot(storage, edited);
        const msg = run.snaps[1]?.probe ?? "";
        expect(msg).toContain("CAMPAIGN NOT RESUMED");
        expect(msg).toContain("different version or structure");
        expect(msg).toContain("the project has changed structurally");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("a project retuned but not restructured (a position, a hull value) still resumes", () => {
        const { storage } = saved();
        const base = campaign();
        const retuned: EEProject = { ...base, map: { ...base.map, groups: base.map.groups.map((g) => (g.id === "a_raiders" ? { ...g, objects: g.objects.map((o) => ({ ...o, position: { x: o.position.x + 5, y: o.position.y } })) } : g)) } };
        const run = boot(storage, retuned);
        expect(run.snaps[1]?.probe ?? "").toContain("resumed from checkpoint");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("a save made for the other EmptyEpsilon build is refused", () => {
        const other = target === TARGET_2024 ? TARGET_2026 : TARGET_2024;
        const { storage } = runCampaignLua(campaign(), other, phase1());
        const run = boot(storage);
        expect(run.snaps[1]?.probe ?? "").toContain("another EmptyEpsilon build");
        expect(run.snaps[1]?.probe ?? "").toContain("CAMPAIGN NOT RESUMED");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("another format version is refused", () => {
        const { storage } = saved();
        const head = JSON.parse(storage["forge/camp/c1/head"] ?? "{}") as { slot: string };
        const doc = JSON.parse(storage[`forge/camp/c1/${head.slot}`] ?? "{}") as Record<string, unknown>;
        const other = head.slot === "a" ? "b" : "a";
        const doc2 = JSON.parse(storage[`forge/camp/c1/${other}`] ?? "{}") as Record<string, unknown>;
        const run = boot({ ...storage, [`forge/camp/c1/${head.slot}`]: JSON.stringify({ ...doc, v: 2 }), [`forge/camp/c1/${other}`]: JSON.stringify({ ...doc2, v: 2 }) });
        expect(run.snaps[1]?.probe ?? "").toContain("another format version");
        expect(run.snaps[1]?.probe ?? "").toContain("CAMPAIGN NOT RESUMED");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("an unreadable newest slot: the one before it is recovered, the crew is told which checkpoint, and nothing is duplicated", () => {
        const { storage } = saved();
        const head = JSON.parse(storage["forge/camp/c1/head"] ?? "{}") as { slot: string; seq: number };
        const run = boot({ ...storage, [`forge/camp/c1/${head.slot}`]: "garbage" });
        const msg = run.snaps[1]?.probe ?? "";
        expect(msg).toContain(`the newest one (${head.seq}) could not be used`);
        expect(msg).toContain("the one before it was recovered");
        expect(msg).toContain(`resumed from checkpoint ${head.seq - 1}`);
        expect(gamesOf(run.storage)).toEqual(["c1"]);
        const alive = run.snaps.find((s) => s.t === -1)!.alive;
        expect(new Set(alive).size).toBe(alive.length);
      });

      it("both slots unreadable: the resume is BLOCKED as damaged, nothing is built, the old save is not touched", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const run = boot(broken);
        expect(run.snaps[1]?.probe ?? "").toContain("CAMPAIGN NOT RESUMED");
        expect(gamesOf(run.storage)).toEqual(["c1"]);
        for (const k of ["a", "b", "head"]) expect(run.storage[`forge/camp/c1/${k}`]).toBe(broken[`forge/camp/c1/${k}`]);
      });

      it("a blocked resume runs nothing: no rule, timer or reward advances, no object or ship exists, and no checkpoint is written", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const run = runCampaignLua(campaign(), target, Array.from({ length: 80 }, (_, t) => ({ t, probe: `${state}` })), { storage: broken });
        for (const snap of run.snaps) {
          expect(snap.alive).toEqual([]);
          expect(snap.victories).toBe(0);
        }
        for (const k of ["a", "b", "head", "index"]) expect(run.storage[`forge/camp/${k === "index" ? "" : "c1/"}${k}`]).toBe(broken[`forge/camp/${k === "index" ? "" : "c1/"}${k}`]);
        expect(gamesOf(run.storage)).toEqual(["c1"]);
      });

      it("after a blocked resume, the explicit choice 'Start a NEW campaign' creates c2 beside c1, and the new campaign starts from its own zero", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const steps: LuaStep[] = Array.from({ length: 50 }, (_, t) => ({ t, probe: t === 30 ? `(function() camp_persist_new() return ${state} end)()` : state }));
        const run = runCampaignLua(campaign(), target, steps, { storage: broken });
        expect(gamesOf(run.storage)).toEqual(["c1", "c2"]);
        for (const k of ["a", "b", "head"]) expect(run.storage[`forge/camp/c1/${k}`]).toBe(broken[`forge/camp/c1/${k}`]);
        const after = run.snaps.find((s) => s.t === 31)!;
        expect(after.sector).toBe("sys-a");
        // the first timed event (A to B at 10 s) fires 10 s after the choice, not at once because 30 s of scenario time had gone by
        expect(run.snaps.find((s) => s.t === 39)!.sector).toBe("sys-a");
        expect(run.snaps.find((s) => s.t === 45)!.sector).toBe("sys-b");
      });

      it("after a blocked resume, 'Play without saving' builds the map and writes nothing", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const steps: LuaStep[] = Array.from({ length: 10 }, (_, t) => ({ t, probe: t === 3 ? `(function() camp_persist_off() return ${state} end)()` : state }));
        const run = runCampaignLua(campaign(), target, steps, { storage: broken });
        expect(run.snaps.find((s) => s.t === 4)!.alive).toContain("player");
        for (const k of Object.keys(broken).filter((k) => !k.endsWith("/messages"))) expect(run.storage[k], k).toBe(broken[k]);
      });

      it("the choices are refused when the game is not blocked", () => {
        const run = runCampaignLua(campaign(), target, [{ t: 1, probe: `(function() camp_persist_new() camp_persist_off() return camp_rt.persist.game end)()` }]);
        expect(gamesOf(run.storage)).toEqual(["c1"]);
        expect(run.snaps.find((s) => s.t === 1)!.probe).toBe("c1");
      });

      it("a first start (no save at all) says so", () => {
        const run = runCampaignLua(campaign(), target, bootStep());
        expect(run.snaps[1]?.probe ?? "").toContain("No saved campaign yet: this is a first start");
      });

      it("Campaign = New with a save present starts c2 and leaves c1 byte for byte as it was; the next default start resumes c2", () => {
        const { storage } = saved();
        const next = boot(storage, campaign(), { Campaign: "New" });
        expect(gamesOf(next.storage)).toEqual(["c1", "c2"]);
        for (const k of ["a", "b", "head"]) expect(next.storage[`forge/camp/c1/${k}`]).toBe(storage[`forge/camp/c1/${k}`]);
        const resumed = boot(next.storage);
        expect(resumed.snaps[1]?.probe ?? "").toContain("Campaign c2 resumed");
        expect(resumed.snaps[1]?.probe ?? "").not.toContain("c1 resumed");
      });

      it("Campaign = Do not save writes nothing at all", () => {
        const { storage } = saved();
        const off = boot(storage, campaign(), { Campaign: "Off" });
        expect(off.storage).toEqual(storage);
        const fresh = runCampaignLua(campaign(), target, phase1(), { settings: { Campaign: "Off" } });
        expect(Object.keys(fresh.storage)).toEqual([]);
        expect(fresh.snaps.find((s) => s.t === 10)!.sector).toBe("sys-b"); // the jump still works, as in ADR-0056
      });

      it("an unreadable list of campaigns: the resume is BLOCKED, nothing at all is written (no new game could be filed without overwriting the list), and only 'Play without saving' is offered", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/index": "{{" };
        const run = boot(broken);
        expect(run.snaps[1]?.probe ?? "").toContain("CAMPAIGN NOT RESUMED");
        expect(run.snaps[1]?.probe ?? "").toContain("list of saved campaigns is unreadable");
        expect(run.storage).toEqual(broken);
        const refused = runCampaignLua(campaign(), target, [{ t: 1, probe: `(function() camp_persist_new() return tostring(camp_rt.persist.game) end)()` }], { storage: broken });
        expect(refused.storage).toEqual(broken);
        const off = runCampaignLua(campaign(), target, [{ t: 1, probe: `(function() camp_persist_off() return tostring(camp_rt.persist.mode) end)()` }, { t: 2, probe: "tostring(camp_rt.persist.mode)" }], { storage: broken });
        expect(off.storage).toEqual(broken);
        expect(off.snaps.find((s) => s.t === 1)!.probe).toBe("blocked"); // the choice is carried out by the next update, not inside the button's own callback
        expect(off.snaps.find((s) => s.t === 2)!.probe).toBe("off");
      });

      it("a blocked game holds ONE stock ship (NO CAMPAIGN) so the crew can see the message and choose: the engines never show a global message on the ship-selection screen", () => {
        const { storage } = saved();
        const broken = { ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" };
        const buttons = runCampaignLua(campaign(), target, [{ t: 1, probe: `table.concat(__W.buttons or {}, ";")` }], { storage: broken });
        expect(buttons.snaps.find((s) => s.t === 1)!.probe).toBe(`${target === TARGET_2024 ? "Engineering" : "engineering"}~Start a NEW campaign;${target === TARGET_2024 ? "Engineering" : "engineering"}~Play without saving`);
        const steps: LuaStep[] = [{ t: 1, probe: `tostring(#__W.players) .. "/" .. tostring(getPlayerShip(-1):getCallSign())` }, { t: 2, probe: `(function() camp_persist_new() return "x" end)()` }, { t: 4, probe: `(function() local n = 0 for _, p in ipairs(__W.players) do if p:isValid() then n = n + 1 end end return tostring(n) .. "/" .. tostring(getPlayerShip(-1) == camp_map.objects["player"]) end)()` }];
        const run = runCampaignLua(campaign(), target, steps, { storage: broken });
        expect(run.snaps.find((s) => s.t === 1)!.probe.startsWith("1/")).toBe(true);
        expect(run.snaps.find((s) => s.t === 4)!.probe).toBe("1/true"); // the holding ship is gone; the campaign's own ship is the only one
        // an unreadable list: only 'Play without saving' is offered
        const idx = runCampaignLua(campaign(), target, [{ t: 1, probe: `table.concat(__W.buttons or {}, ";")` }], { storage: { ...storage, "forge/camp/index": "{{" } });
        expect(idx.snaps.find((s) => s.t === 1)!.probe).toBe(`${target === TARGET_2024 ? "Engineering" : "engineering"}~Play without saving`);
      });

      it("what the crew sees fits one banner line: a station clips a message to its last line (measured in a real window), so every routine message and the blocked reminder stay short", () => {
        const { storage } = saved();
        const head = JSON.parse(storage["forge/camp/c1/head"] ?? "{}") as { slot: string };
        const lengths = (messages: string): number[] => messages.split(" ## ").map((m) => m.length);
        const fresh = runCampaignLua(campaign(), target, [{ t: 0, probe: messagesProbe }]).snaps[1]!.probe;
        const resumed = boot(storage).snaps[1]!.probe;
        const fallback = boot({ ...storage, [`forge/camp/c1/${head.slot}`]: "garbage" }).snaps[1]!.probe;
        const headless = boot({ ...storage, "forge/camp/c1/head": "{nope" }).snaps[1]!.probe;
        for (const text of [fresh, resumed, fallback, headless]) for (const n of lengths(text)) expect(n).toBeLessThanOrEqual(150);
        const manual = runCampaignLua(campaign(), target, [{ t: 1, probe: `(function() camp_rt.persist.manual_save() return table.concat(__W.messages, " ## ") end)()` }]).snaps.find((x) => x.t === 1)!.probe;
        expect(Math.max(...lengths(manual))).toBeLessThanOrEqual(150);
        for (const broken of [{ ...storage, "forge/camp/c1/a": "x", "forge/camp/c1/b": "y" }, { ...storage, "forge/camp/index": "{{" }]) {
          const short = runCampaignLua(campaign(), target, [{ t: 1, probe: "camp_rt.persist.blocked_short" }], { storage: broken }).snaps.find((x) => x.t === 1)!.probe;
          expect(short.length).toBeGreaterThan(40);
          expect(short.length).toBeLessThanOrEqual(130);
          expect(short).toContain("CAMPAIGN NOT RESUMED");
        }
      });

      it("a store holding other projects' and other tools' keys is never touched", () => {
        const { storage } = saved();
        const mixed = { ...storage, "exodus.codewords.json": "{\"a\":1}", "forge/other/c1/head": "{}", "something": "else" };
        const run = boot(mixed, campaign(), { Campaign: "New" });
        for (const k of ["exodus.codewords.json", "forge/other/c1/head", "something"]) expect(run.storage[k]).toBe(mixed[k]);
      });
    });
  }
});

describe.skipIf(!luaAvailable)("transitions are all or nothing (mock world)", () => {
  for (const target of [TARGET_2024, TARGET_2026]) {
    it(`${target}: a destination that cannot be built refuses the jump, keeps the current sector and the ship, and removes what it had made`, () => {
      const steps: LuaStep[] = Array.from({ length: 14 }, (_, t) => ({
        t,
        probe: state,
        ...(t === 3 ? { probe: `(function() local orig = camp_map.spawn_group camp_map.spawn_group = function(name, opts) if name == "b_guards" then error("boom") end return orig(name, opts) end return ${state} end)()` } : {}),
      }));
      const run = runCampaignLua(campaign(), target, steps);
      const after = run.snaps.find((s) => s.t === 11)!;
      expect(after.sector).toBe("sys-a");
      expect(sorted(after.alive)).toEqual(sorted(["player", "stn_a", "ra1", "ra2"]));
      expect(after.alive).not.toContain("bg1");
      expect(after.player).toBe("0,0");
      expect(run.snaps.find((s) => s.t === 10)!.probe).toBeDefined();
      // the pre-jump checkpoint is on disk, in the OLD sector: a crash now resumes in A
      const head = JSON.parse(run.storage["forge/camp/c1/head"] ?? "{}") as { slot: string; sector: string };
      expect(head.sector).toBe("sys-a");
    });

    it(`${target}: many jumps in a row leave one of everything, the same few keys and a checkpoint of a stable size`, () => {
      const base = campaign();
      const beats = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, label: `hop ${i}`, at: 5 + i * 2, sector: null, actions: [jump(i % 2 === 0 ? "sys-b" : "sys-a", i % 2 === 0 ? "arrive_b" : "arrive_a")] }));
      const many: EEProject = { ...base, logic: { ...base.logic, beats, rules: [] } };
      const run = runCampaignLua(many, target, Array.from({ length: 70 }, (_, t) => ({ t })));
      expect(Object.keys(run.storage).sort()).toEqual(["forge/camp/c1/a", "forge/camp/c1/b", "forge/camp/c1/head", "forge/camp/index", "forge/camp/messages"]);
      const last = run.snaps[run.snaps.length - 1]!;
      expect(new Set(last.alive).size).toBe(last.alive.length);
      expect((run.storage["forge/camp/c1/a"] ?? "").length).toBeLessThan(8000);
    });
  }
});

describe("the generated Lua of a project with campaign saves", () => {
  it("never calls the engine's toJSON (EE 2024's raises on nested tables) and writes only under forge/<project>/", async () => {
    const { buildProject } = await import("../src/codegen/build.js");
    const { loadCatalog } = await import("../src/catalog/load.js");
    for (const target of [TARGET_2024, TARGET_2026]) {
      const built = buildProject(loadCatalog(target), { ...campaign(), eeVersion: target }, { sourceHash: "x" });
      const lua = built.files.map((f) => f.contents).join("\n");
      expect(lua).not.toMatch(/\btoJSON\(/);
      // ScriptStorage:set reports nothing about the disk: no message may claim a write that nobody observed
      expect(lua).not.toMatch(/saved to disk|written to disk|checkpoint[^"\n]*\bsaved\b|Checkpoint 1 saved/i);
      expect(lua).toContain("The game cannot confirm it reached the disk");
      expect(lua).toContain("sent to the save file");
      expect(lua).toContain("function P.encode");
      const keys = [...lua.matchAll(/P\.KEY \.\. [^\n]*/g)].length;
      expect(keys).toBeGreaterThan(0);
      expect(lua).toContain("Campaign[Resume|Default]");
    }
  });

  it("a project that does not turn them on has no trace of them", async () => {
    const { buildProject } = await import("../src/codegen/build.js");
    const { loadCatalog } = await import("../src/catalog/load.js");
    const off = { ...campaign({ persistence: false }), logic: { ...campaign().logic, beats: campaign().logic.beats.filter((b) => b.sector === null), rules: campaign().logic.rules.filter((r) => r.sector === null) } };
    const built = buildProject(loadCatalog(TARGET_2026), { ...off, eeVersion: TARGET_2026 }, { sourceHash: "x" });
    const lua = built.files.map((f) => f.contents).join("\n");
    expect(lua).not.toMatch(/persist|Campaign\[|checkpoint|forge\/camp/);
  });

  it("the build refuses the settings that make no sense", async () => {
    const { buildProject } = await import("../src/codegen/build.js");
    const { loadCatalog } = await import("../src/catalog/load.js");
    const lua = (p: EEProject) => buildProject(loadCatalog(TARGET_2026), { ...p, eeVersion: TARGET_2026 }, { sourceHash: "x" });
    expect(() => lua({ ...campaign(), map: { ...campaign().map, startSector: null } })).toThrow(/start/i);
    expect(() => lua(campaign({ persistence: false }))).toThrow(/scoped to a sector|needs campaign saves|campaign saves are on/);
    const bad = campaign();
    expect(() => lua({ ...bad, logic: { ...bad.logic, beats: [...bad.logic.beats, { id: "x", label: "x", at: 1, sector: "nowhere", actions: [] }] } })).toThrow(/does not exist|not in this project/);
    const noSaves = { ...campaign({ persistence: false }), logic: { ...campaign().logic, beats: [{ id: "c", label: "c", at: 1, sector: null, actions: [{ kind: "save_checkpoint" as const }] }], rules: [] } };
    expect(() => lua(noSaves)).toThrow(/checkpoint/);
  });
});

describe("Problems says what the build says about campaign saves", () => {
  const codes = (p: EEProject): string[] => diagnose(p).filter((x) => x.severity === "error").map((x) => x.code);
  it("a project with saves on and no starting sector", () => {
    expect(codes({ ...campaign(), map: { ...campaign().map, startSector: null } })).toContain("persistence-needs-start-sector");
  });
  it("a sector-scoped rule or timed event while saves are off", () => {
    expect(codes(campaign({ persistence: false }))).toEqual(expect.arrayContaining(["scope-needs-persistence"]));
  });
  it("a scope that names a sector the project does not have", () => {
    const c = campaign();
    expect(codes({ ...c, logic: { ...c.logic, rules: c.logic.rules.map((r) => (r.id === "r_a_local" ? { ...r, sector: "nowhere" } : r)) } })).toContain("scope-unknown-sector");
  });
  it("a Save checkpoint action while saves are off", () => {
    const off = { ...campaign({ persistence: false }), logic: { ...campaign().logic, beats: [{ id: "c", label: "c", at: 1, sector: null, actions: [{ kind: "save_checkpoint" as const }] }], rules: [] } };
    expect(codes(off)).toContain("checkpoint-needs-persistence");
  });
  it("a clean campaign project has none of them", () => {
    expect(codes(campaign()).filter((c) => /persistence|scope|checkpoint/.test(c))).toEqual([]);
  });
});

describe.skipIf(!luaAvailable)("orders and dialogues a Forge action gave come back after a restart (mock world)", () => {
  /** campaign() without the jumps, plus: at t=3 RA-2 is ordered to attack the station and the station gets a dialogue; at t=5 the dialogue changes. */
  const withOrders = (): EEProject => {
    const c = campaign();
    const dialogue = emptyDialogue("hello", "Hello");
    return {
      ...c,
      logic: {
        ...c.logic,
        dialogues: [dialogue],
        beats: [
          { id: "ord", label: "order", at: 3, sector: null, actions: [
            { kind: "order_attack", target: { ref: "object", objectId: "ra2" }, objectId: "stn_a" },
            { kind: "set_dialogue", target: { ref: "object", objectId: "stn_a" }, dialogueId: "hello" },
          ] },
        ],
        rules: [],
      },
    };
  };
  const count = (n: string) => `tostring(__W.${n} or 0)`;

  for (const target of [TARGET_2024, TARGET_2026]) {
    it(`${target}: an order with a target that still exists is given again, to the new object`, () => {
      const run1 = runCampaignLua(withOrders(), target, Array.from({ length: 9 }, (_, t) => ({ t, ...(t === 8 ? { probe: `(function() camp_rt.persist.manual_save() return "saved" end)()` } : {}) })));
      const doc = JSON.parse(run1.storage[`forge/camp/c1/${(JSON.parse(run1.storage["forge/camp/c1/head"] ?? "{}") as { slot: string }).slot}`] ?? "{}") as { orders: Record<string, { m: string; id: string }>; dialogues: Record<string, unknown> };
      expect(doc.orders["ra2"]).toEqual({ m: "orderAttack", id: "stn_a" });
      expect(doc.dialogues["stn_a"]).toBe("hello");
      const run2 = runCampaignLua(withOrders(), target, [{ t: 0, probe: `(function() local ra2, stn = camp_map.objects["ra2"], camp_map.objects["stn_a"] return tostring(ra2._attack == stn and stn ~= nil) .. "/" .. ${count("attacks")} end)()` }], { storage: run1.storage });
      expect(run2.snaps.find((s) => s.t === 0)!.probe).toBe("true/1");
    });

    it(`${target}: an order whose target no longer exists holds position (idle) instead of pointing at nothing, and says so`, () => {
      const run1 = runCampaignLua(withOrders(), target, Array.from({ length: 9 }, (_, t) => ({
        t,
        ...(t === 5 ? { destroyObjects: ["stn_a"] } : {}),
        ...(t === 8 ? { probe: `(function() camp_rt.persist.manual_save() return "saved" end)()` } : {}),
      })));
      const run2 = runCampaignLua(withOrders(), target, [{ t: 0, probe: `${count("idle")} .. "/" .. ${count("attacks")}` }], { storage: run1.storage });
      expect(run2.snaps.find((s) => s.t === 0)!.probe).toBe("1/0");
      expect(run2.snaps.find((s) => s.t === -1)!.alive).not.toContain("stn_a"); // the dead station is not rebuilt either
    });
  }
});
