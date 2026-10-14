#!/usr/bin/env node
/**
 * "Hop Jump": the scenario the live Change-sector run plays in the isolated EE clones.
 *
 *   node scripts/sectors/make-jump-scenario.mjs <out-dir> [--target 2026|2024] [--id hop_jump]
 *
 * Two sectors, a Shared player ship and station, one hostile Idle ship in each sector 800 units ahead of the arrival point,
 * On-call groups that must never appear on their own, and a timeline of flags: a beat raises a flag, a rule conditioned on
 * the flag does the jump. Nothing here needs a person at the keyboard except the fighting (done with real mouse input).
 *
 * The rules damage the Shared depot (10 per kill of the A raider, 1 per jump) so that the engine itself shows how many times each fired.
 *
 *   t=60   hull damage and a damaged system (the "state" that must survive the jumps)
 *   t=80   a beat tries to spawn B's on-call group while the game is in A (must be refused)
 *   t=90   flag → jump 1 A→B (heading kept)           t=105  repeated requests for B (no-ops)
 *   t=120  flag → jump 2 B→A (heading 180)            t=135  repeated requests for A (no-ops)
 *   t=150  flag → jump 3 A→B (heading 0)              the guard of B is then destroyed in combat → victory
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const editor = await import(join(root, "packages/forge-core/dist/editor/index.js"));
const contracts = await import(join(root, "packages/forge-contracts/dist/index.js"));
const { createObject, createMarker } = editor;

const out = process.argv[2];
if (!out) throw new Error("usage: make-jump-scenario.mjs <out-dir> [--target 2026|2024] [--id hop_jump]");
const flag = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const target = flag("target", "2026") === "2024" ? "EE-2024.12.08" : "EE-2026.09.22PR";
const id = flag("id", "hop_jump");
const at = (x, y) => ({ x, y });
const obj = (type, oid, pos, extra = {}) => ({ ...createObject(type, oid, pos, {}), ...extra });
const hornet = (oid, callsign, pos) => obj("CpuShip", oid, pos, { faction: "Kraylor", template: "MT52 Hornet", callsign, order: { kind: "idle" } });
const msg = (text) => ({ kind: "ship_log", text, color: "white" });
const num = (name, value) => ({ kind: "set_variable", name, value });
const add = (name) => ({ kind: "add_variable", name, delta: 1 });
// What the rules DO is made visible to the engine itself: the Shared depot is damaged — 10 per kill of the A raider, 1 per jump — and the
// engine's own object list (readable over HTTP) shows its hull. (A scenario's variables are not readable that way.)
const hurt = (amount) => ({ kind: "damage_hull", target: { ref: "object", objectId: "depot" }, amount });

const base = contracts.emptyEEProject(id, "Hop Jump");
const project = {
  ...base,
  description: "Two sectors, a jump between them, and a real fight in each. Used to check Change sector in an isolated engine.",
  eeVersion: target,
  map: {
    sectors: [{ id: "sys-a", label: "System A" }, { id: "sys-b", label: "System B" }],
    startSector: "sys-a",
    groups: [
      { id: "ship", label: "Player ship", when: "on_start", sector: null, objects: [obj("PlayerSpaceship", "player", at(0, 0), { template: "Atlantis", faction: "Human Navy", callsign: "PS-01", rotation: 0 })] },
      { id: "depot", label: "Depot", when: "on_start", sector: null, objects: [obj("SpaceStation", "depot", at(-2500, 1500), { template: "Small Station", faction: "Human Navy", callsign: "DEPOT" })] },
      { id: "a_env", label: "A environment", when: "on_start", sector: "sys-a", objects: [obj("Asteroid", "ast_a", at(2500, 1800))] },
      { id: "a_raiders", label: "A raiders", when: "on_start", sector: "sys-a", objects: [hornet("raider_a", "TG-A", at(800, 0))] },
      { id: "a_ambush", label: "A ambush", when: "on_call", sector: "sys-a", objects: [hornet("amb_a", "AMB-A", at(3000, -2500))] },
      { id: "b_env", label: "B environment", when: "on_start", sector: "sys-b", objects: [obj("Nebula", "neb_b", at(52500, 1800))] },
      { id: "b_guards", label: "B guards", when: "on_start", sector: "sys-b", objects: [hornet("raider_b", "TG-B", at(50800, 0))] },
      { id: "b_ambush", label: "B ambush", when: "on_call", sector: "sys-b", objects: [hornet("amb_b", "AMB-B", at(53000, -2500))] },
    ],
    markers: [createMarker("arrive_a", "Arrive in A", at(0, 0), "sys-a"), createMarker("arrive_b", "Arrive in B", at(50000, 0), "sys-b")],
  },
  logic: {
    ...base.logic,
    variables: ["go_b", "go_a", "go_b2", "kills_a", "b_wiped", "jumps"].map((name) => ({ name, initial: 0 })),
    beats: [
      { id: "damage", label: "damage the ship", at: 60, actions: [{ kind: "damage_hull", target: { ref: "player" }, amount: 40 }, { kind: "set_system_health", target: { ref: "player" }, system: "reactor", value: 0.6 }] },
      { id: "refused_spawn", label: "spawn B's ambush while in A", at: 80, actions: [{ kind: "spawn_group", groupId: "b_ambush" }] },
      { id: "flag_b", label: "ready for B", at: 90, actions: [num("go_b", 1)] },
      { id: "again_b", label: "repeated requests for B", at: 105, actions: [{ kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: null }, { kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: null }] },
      { id: "flag_a", label: "ready for A", at: 120, actions: [num("go_a", 1)] },
      { id: "again_a", label: "repeated requests for A", at: 135, actions: [{ kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: null }, { kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: null }] },
      { id: "flag_b2", label: "ready for B again", at: 150, actions: [num("go_b2", 1)] },
    ],
    rules: [
      { id: "r_kill_a", label: "A raider down", once: false, when: { kind: "group_destroyed", groupId: "a_raiders" }, conditions: [], actions: [add("kills_a"), hurt(10), msg("The raider of sector A is down.")] },
      { id: "r_jump_1", label: "Jump A to B", once: false, when: { kind: "variable_equals", name: "go_b", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [{ kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: null }, add("jumps"), hurt(1), num("go_b", 0), msg("Arrived in sector B.")] },
      { id: "r_jump_2", label: "Jump B to A", once: false, when: { kind: "variable_equals", name: "go_a", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-b" }], actions: [{ kind: "change_sector", sectorId: "sys-a", arrivalMarkerId: "arrive_a", rotation: 180 }, add("jumps"), hurt(1), num("go_a", 0), msg("Back in sector A.")] },
      { id: "r_jump_3", label: "Jump A to B again", once: false, when: { kind: "variable_equals", name: "go_b2", value: 1 }, conditions: [{ kind: "current_sector", sectorId: "sys-a" }], actions: [{ kind: "change_sector", sectorId: "sys-b", arrivalMarkerId: "arrive_b", rotation: 0 }, add("jumps"), hurt(1), num("go_b2", 0), msg("Arrived in sector B again.")] },
      { id: "r_win_b", label: "B guard down", once: true, when: { kind: "group_destroyed", groupId: "b_guards" }, conditions: [], actions: [num("b_wiped", 1), { kind: "global_message", text: "Sector B cleared.", timeoutS: null }, { kind: "victory", faction: "Human Navy" }] },
    ],
  },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
console.log(`wrote ${join(out, "project.json")} (${target})`);
