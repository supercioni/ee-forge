#!/usr/bin/env node
/**
 * "Overlap Jump": the scenario the live temporary-object checks play in the isolated EE clones (ADR-0057).
 *
 *   node scripts/sectors/make-overlap-scenario.mjs <out-dir> [--target 2026|2024] [--id overlap_jump]
 *
 * Two sectors that OCCUPY THE SAME COORDINATES: both arrival markers are at (0, 0) and both sectors hold one hostile Idle ship 800
 * units ahead of it. A second player ship ("PS-02", Shared) stands 3000 units to the side, to be a Shared object that fires.
 * Nothing the sectors hold is meant to be told apart by distance. The crew's mines, probes and missiles (fired by the driver with
 * the engine's own station commands) are what the jump has to leave behind.
 *
 *   t=60   hull damage and a damaged reactor (the ship's state that must survive)
 *   t=100  A→B     t=170  B→A     t=240  A→B     t=245  the finale flag (a rule would end the game when TG-B is destroyed)
 *
 * The rules damage the Shared depot so that the engine itself shows what fired: 10 per wipe of the A raider, 20 per wipe of the B
 * guard, 1 per jump. Victory only when the finale flag is up, so a stray kill before the finale is visible but does not end the run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const editor = await import(join(root, "packages/forge-core/dist/editor/index.js"));
const contracts = await import(join(root, "packages/forge-contracts/dist/index.js"));
const { createObject, createMarker } = editor;

const out = process.argv[2];
if (!out) throw new Error("usage: make-overlap-scenario.mjs <out-dir> [--target 2026|2024] [--id overlap_jump]");
const flag = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const target = flag("target", "2026") === "2024" ? "EE-2024.12.08" : "EE-2026.09.22PR";
const id = flag("id", "overlap_jump");
const at = (x, y) => ({ x, y });
const obj = (type, oid, pos, extra = {}) => ({ ...createObject(type, oid, pos, {}), ...extra });
const hornet = (oid, callsign, pos) => obj("CpuShip", oid, pos, { faction: "Kraylor", template: "MT52 Hornet", callsign, order: { kind: "idle" } });
const msg = (text) => ({ kind: "ship_log", text, color: "white" });
const num = (name, value) => ({ kind: "set_variable", name, value });
const add = (name) => ({ kind: "add_variable", name, delta: 1 });
const hurt = (amount) => ({ kind: "damage_hull", target: { ref: "object", objectId: "depot" }, amount });
const jump = (sectorId, arrivalMarkerId, rotation = null) => ({ kind: "change_sector", sectorId, arrivalMarkerId, rotation });

const base = contracts.emptyEEProject(id, "Overlap Jump");
const project = {
  ...base,
  description: "Two sectors on the same coordinates, jumps between them, and the crew's mines, probes and missiles left behind. Used to check Change sector in an isolated engine.",
  eeVersion: target,
  map: {
    sectors: [{ id: "sys-a", label: "System A" }, { id: "sys-b", label: "System B" }],
    startSector: "sys-a",
    groups: [
      { id: "ship", label: "Player ship", when: "on_start", sector: null, objects: [obj("PlayerSpaceship", "player", at(0, 0), { template: "Atlantis", faction: "Human Navy", callsign: "PS-01", rotation: 0 })] },
      { id: "second", label: "Second ship (Shared)", when: "on_start", sector: null, objects: [obj("PlayerSpaceship", "second", at(800, -3000), { template: "Atlantis", faction: "Human Navy", callsign: "PS-02", rotation: 0 })] },
      { id: "depot", label: "Depot", when: "on_start", sector: null, objects: [obj("SpaceStation", "depot", at(-2500, 1500), { template: "Small Station", faction: "Human Navy", callsign: "DEPOT" })] },
      { id: "a_env", label: "A environment", when: "on_start", sector: "sys-a", objects: [obj("Asteroid", "ast_a", at(2500, 1800))] },
      { id: "a_raiders", label: "A raiders", when: "on_start", sector: "sys-a", objects: [hornet("raider_a", "TG-A", at(800, 0))] },
      { id: "b_env", label: "B environment", when: "on_start", sector: "sys-b", objects: [obj("Nebula", "neb_b", at(2500, 1800))] },
      { id: "b_guards", label: "B guards", when: "on_start", sector: "sys-b", objects: [hornet("raider_b", "TG-B", at(800, 0))] },
    ],
    markers: [createMarker("arrive_a", "Arrive in A", at(0, 0), "sys-a"), createMarker("arrive_b", "Arrive in B", at(0, 0), "sys-b")],
  },
  logic: {
    ...base.logic,
    variables: ["go_b", "go_a", "go_b2", "finale", "jumps"].map((name) => ({ name, initial: 0 })),
    beats: [
      { id: "damage", label: "damage the ship", at: 60, actions: [{ kind: "damage_hull", target: { ref: "player" }, amount: 40 }, { kind: "set_system_health", target: { ref: "player" }, system: "reactor", value: 0.6 }] },
      { id: "flag_b", label: "ready for B", at: 100, actions: [num("go_b", 1)] },
      { id: "flag_a", label: "ready for A", at: 170, actions: [num("go_a", 1)] },
      { id: "flag_b2", label: "ready for B again", at: 240, actions: [num("go_b2", 1)] },
      { id: "flag_finale", label: "finale", at: 245, actions: [num("finale", 1)] },
    ],
    rules: [
      { id: "r_kill_a", label: "A raider down", once: false, when: { kind: "group_destroyed", groupId: "a_raiders" }, conditions: [], actions: [hurt(10), msg("The raider of sector A is down.")] },
      { id: "r_kill_b", label: "B guard down", once: false, when: { kind: "group_destroyed", groupId: "b_guards" }, conditions: [], actions: [hurt(20), msg("The guard of sector B is down.")] },
      { id: "r_jump_1", label: "Jump A to B", once: false, when: { kind: "variable_equals", name: "go_b", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [jump("sys-b", "arrive_b"), add("jumps"), hurt(1), num("go_b", 0)] },
      { id: "r_jump_2", label: "Jump B to A", once: false, when: { kind: "variable_equals", name: "go_a", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-b" }], actions: [jump("sys-a", "arrive_a"), add("jumps"), hurt(1), num("go_a", 0)] },
      { id: "r_jump_3", label: "Jump A to B again", once: false, when: { kind: "variable_equals", name: "go_b2", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [jump("sys-b", "arrive_b"), add("jumps"), hurt(1), num("go_b2", 0)] },
      { id: "r_win", label: "Finale: B guard down", once: true, when: { kind: "group_destroyed", groupId: "b_guards" }, conditions: [{ kind: "variable_equals", name: "finale", value: 1 }], actions: [{ kind: "global_message", text: "Sector B cleared.", timeoutS: null }, { kind: "victory", faction: "Human Navy" }] },
    ],
  },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
console.log(`wrote ${join(out, "project.json")} (${target})`);
