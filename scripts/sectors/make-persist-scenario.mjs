#!/usr/bin/env node
/**
 * "Persist Jump": the scenario the live campaign-save checks play in the isolated EE clones (ADR-0058).
 *
 *   node scripts/sectors/make-persist-scenario.mjs <out-dir> [--target 2026|2024] [--id persist_jump]
 *
 * Two sectors on the SAME coordinates (both arrival markers at 0,0). Campaign saves are on. A holds a station and two hostile Idle ships; B holds a guard.
 * What the rules DO is made visible to the engine itself, through the hull of a SHARED depot (readable over HTTP):
 *
 *   ra1 destroyed          → the reward rule (global, once): the depot loses 10 hull
 *   A's scoped beat        → at 130 s of A's own clock: the depot loses 3 (A's clock is ~100 s when the ship leaves, so it fires ~30 s after the return)
 *   B's scoped beat        → at 20 s of B's own clock: the depot loses 2
 *   each jump              → the depot loses 1
 *   A's wipe (both ra1, ra2) → the depot loses 20
 *   finale                 → when bg1 (B's guard) is destroyed after the flag: victory
 *
 *   campaign clock:  t=100  A→B     t=125 story checkpoint     t=240  B→A     t=380  A→B (repeated jumps)     t=385 finale flag
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const editor = await import(join(root, "packages/forge-core/dist/editor/index.js"));
const contracts = await import(join(root, "packages/forge-contracts/dist/index.js"));
const { createObject, createMarker } = editor;

const out = process.argv[2];
if (!out) throw new Error("usage: make-persist-scenario.mjs <out-dir> [--target 2026|2024] [--id persist_jump]");
const flag = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const target = flag("target", "2026") === "2024" ? "EE-2024.12.08" : "EE-2026.09.22PR";
const id = flag("id", "persist_jump");
const at = (x, y) => ({ x, y });
const obj = (type, oid, pos, extra = {}) => ({ ...createObject(type, oid, pos, {}), ...extra });
const hornet = (oid, callsign, pos) => obj("CpuShip", oid, pos, { faction: "Kraylor", template: "MT52 Hornet", callsign, order: { kind: "idle" } });
const num = (name, value) => ({ kind: "set_variable", name, value });
const add = (name) => ({ kind: "add_variable", name, delta: 1 });
const hurt = (amount) => ({ kind: "damage_hull", target: { ref: "object", objectId: "depot" }, amount });
const jump = (sectorId, arrivalMarkerId) => ({ kind: "change_sector", sectorId, arrivalMarkerId, rotation: null });

const base = contracts.emptyEEProject(id, "Persist Jump");
const project = {
  ...base,
  description: "Two sectors on the same coordinates, frozen between visits, with campaign saves. Used to check the saves in an isolated engine.",
  eeVersion: target,
  campaign: { persistence: true },
  map: {
    sectors: [{ id: "sys-a", label: "System A" }, { id: "sys-b", label: "System B" }],
    startSector: "sys-a",
    groups: [
      { id: "ship", label: "Player ship", when: "on_start", sector: null, objects: [obj("PlayerSpaceship", "player", at(0, 0), { template: "Atlantis", faction: "Human Navy", callsign: "PS-01", rotation: 0 })] },
      { id: "depot", label: "Depot (Shared)", when: "on_start", sector: null, objects: [obj("SpaceStation", "depot", at(-2500, 1500), { template: "Small Station", faction: "Human Navy", callsign: "DEPOT" })] },
      { id: "a_station", label: "A station", when: "on_start", sector: "sys-a", objects: [obj("SpaceStation", "stn_a", at(2500, -1500), { template: "Small Station", faction: "Human Navy", callsign: "STN-A" })] },
      { id: "a_raiders", label: "A raiders", when: "on_start", sector: "sys-a", objects: [hornet("ra1", "RA-1", at(800, 0)), hornet("ra2", "RA-2", at(900, 1200))] },
      { id: "a_ambush", label: "A ambush", when: "on_call", sector: "sys-a", objects: [hornet("aa1", "AA-1", at(3000, 3000))] },
      { id: "b_guards", label: "B guards", when: "on_start", sector: "sys-b", objects: [hornet("bg1", "BG-1", at(800, 0))] },
    ],
    markers: [createMarker("arrive_a", "Arrive in A", at(0, 0), "sys-a"), createMarker("arrive_b", "Arrive in B", at(0, 0), "sys-b")],
  },
  logic: {
    ...base.logic,
    variables: ["reward", "jumps", "finale", "a_wiped", "a_timer", "b_timer"].map((name) => ({ name, initial: 0 })),
    beats: [
      { id: "j1", label: "A to B", at: 100, sector: null, actions: [jump("sys-b", "arrive_b"), add("jumps"), hurt(1)] },
      { id: "j2", label: "B to A", at: 240, sector: null, actions: [jump("sys-a", "arrive_a"), add("jumps"), hurt(1)] },
      { id: "j3", label: "A to B again", at: 380, sector: null, actions: [jump("sys-b", "arrive_b"), add("jumps"), hurt(1)] },
      { id: "flag", label: "finale flag", at: 385, sector: null, actions: [num("finale", 1)] },
      { id: "save_b", label: "story checkpoint", at: 125, sector: null, actions: [{ kind: "save_checkpoint" }] },
      { id: "a_timer", label: "A's own timer (130 s of A's clock)", at: 130, sector: "sys-a", actions: [add("a_timer"), hurt(3)] },
      { id: "b_timer", label: "B's own timer (20 s of B's clock)", at: 20, sector: "sys-b", actions: [add("b_timer"), hurt(2)] },
    ],
    rules: [
      { id: "r_reward", label: "reward for RA-1", once: true, sector: null, when: { kind: "object_destroyed", objectId: "ra1" }, conditions: [], actions: [add("reward"), hurt(10)] },
      { id: "r_wipe", label: "A raiders wiped out", once: true, sector: null, when: { kind: "group_destroyed", groupId: "a_raiders" }, conditions: [], actions: [add("a_wiped"), hurt(20)] },
      { id: "r_win", label: "Finale: BG-1 down", once: true, sector: null, when: { kind: "object_destroyed", objectId: "bg1" }, conditions: [{ kind: "variable_equals", name: "finale", value: 1 }], actions: [{ kind: "global_message", text: "Sector B cleared.", timeoutS: null }, { kind: "victory", faction: "Human Navy" }] },
    ],
  },
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "project.json"), `${JSON.stringify(project, null, 2)}\n`);
console.log(`wrote ${join(out, "project.json")} (${target})`);
