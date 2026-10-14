#!/usr/bin/env node
/**
 * The test project for sectors, hide/isolate/lock: "Hop Test".
 *
 *   node scripts/sectors/make-fixture.mjs <out-dir> [--sectors] [--id hop_test]
 *
 * Two systems that sit on top of each other in coordinates (same planet, nebula, station and patrol positions, a
 * few hundred units apart), a Shared player ship, on_start and on_call groups, markers in each system and a Shared
 * one, and references that cross systems (a rule spawning the other system's ambush; a dialogue doing the same; a
 * patrol order pointing at a Shared marker).
 *
 * Without `--sectors` it writes the document as Forge 0.7.0 wrote it (schema 2, no sector anywhere) — the project a
 * migration has to carry. With `--sectors` it writes the same scenario organised in System A / System B / Shared.
 * Nothing but the organisation differs: same ids, coordinates, groups, order.
 *
 * `--as-schema 4` (with `--sectors`) writes it as Forge 0.8.0 wrote it: schema 4, no `campaign` and no `sector` on rules or timed events — the project a
 * migration to campaign saves (schema 5) has to carry.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const editor = await import(join(root, "packages/forge-core/dist/editor/index.js"));
const contracts = await import(join(root, "packages/forge-contracts/dist/index.js"));
const core = await import(join(root, "packages/forge-core/dist/index.js"));
const { createObject, createMarker, emptyDialogue, emptyReply } = editor;

const out = process.argv[2];
if (!out) throw new Error("usage: make-fixture.mjs <out-dir> [--sectors] [--id hop_test]");
const withSectors = process.argv.includes("--sectors");
const asSchema = process.argv.includes("--as-schema") ? Number(process.argv[process.argv.indexOf("--as-schema") + 1]) : null;
const idArg = process.argv.indexOf("--id");
const id = idArg === -1 ? "hop_test" : process.argv[idArg + 1];

const at = (x, y) => ({ x, y });
const obj = (type, oid, pos, extra = {}) => ({ ...createObject(type, oid, pos, {}), ...extra });
const hostile = (oid, pos, callsign, extra = {}) => obj("CpuShip", oid, pos, { faction: "Kraylor", callsign, template: "MT52 Hornet", ...extra });
const rocks = (prefix, cx, cy) => [0, 1, 2, 3, 4, 5].map((i) => obj("Asteroid", `${prefix}_${i}`, at(cx + (i % 3) * 900, cy + Math.floor(i / 3) * 900)));

const A = withSectors ? "sys-a" : undefined;
const B = withSectors ? "sys-b" : undefined;
const S = withSectors ? null : undefined;
const tag = (sector, g) => (sector === undefined ? g : { ...g, sector });

const groups = [
  tag(S, { id: "shared_player", label: "Player ship", when: "on_start", objects: [obj("PlayerSpaceship", "player", at(0, 0), { callsign: "Hopper" })] }),
  tag(A, { id: "a_env", label: "A · Environment", when: "on_start", objects: [
    obj("Planet", "pl_a", at(10000, 5000), { radius: 3000, callsign: "Aster" }),
    obj("Nebula", "neb_a", at(-12000, -8000)),
    ...rocks("rock_a", 9000, -9000),
  ] }),
  tag(A, { id: "a_stations", label: "A · Stations", when: "on_start", objects: [
    obj("SpaceStation", "st_a", at(-8000, 3000), { callsign: "Alpha Depot", dialogueId: "alpha" }),
  ] }),
  tag(A, { id: "a_patrol", label: "A · Patrol", when: "on_start", objects: [
    hostile("pat_a1", at(3000, -6000), "KR-A1", { order: { kind: "defend_location", position: { ref: "marker", markerId: "rally" } } }),
    hostile("pat_a2", at(3500, -6200), "KR-A2"),
  ] }),
  tag(B, { id: "b_env", label: "B · Environment", when: "on_start", objects: [
    obj("Planet", "pl_b", at(10200, 4800), { radius: 2400, callsign: "Brume" }),
    obj("Nebula", "neb_b", at(-12000, -7000)),
    ...rocks("rock_b", 9400, -8700),
    // A companion on a wide orbit round system A's planet: a reference that reaches across the two systems.
    obj("Planet", "wanderer_b", at(-3000, 12000), { radius: 800, callsign: "Wanderer", orbit: { targetId: "pl_a", orbitTimeS: 900 } }),
  ] }),
  tag(B, { id: "b_stations", label: "B · Stations", when: "on_start", objects: [
    obj("SpaceStation", "st_b", at(-8000, 3400), { callsign: "Beta Yard" }),
  ] }),
  tag(B, { id: "b_ambush", label: "B · Ambush", when: "on_call", objects: [
    hostile("amb_b1", at(6000, -6500), "KR-B1"),
    hostile("amb_b2", at(6500, -6700), "KR-B2"),
  ] }),
];

const markers = [
  { ...createMarker("gate_a", "Gate A", at(14000, 0)), ...(withSectors ? { sector: A } : {}) },
  { ...createMarker("gate_b", "Gate B", at(14000, 200)), ...(withSectors ? { sector: B } : {}) },
  { ...createMarker("rally", "Rally point", at(0, 3000)), ...(withSectors ? { sector: null } : {}) },
];

const dialogue = emptyDialogue("alpha", "Alpha Depot");
dialogue.nodes[0].text = "Alpha Depot: pilots report an ambush waiting at system B's gate.";
dialogue.nodes[0].replies = [
  { ...emptyReply("start"), text: "Show me", actions: [{ kind: "spawn_group", groupId: "b_ambush" }] },
  { ...emptyReply("start"), text: "Not now" },
];

const base = contracts.emptyEEProject(id, "Hop Test");
const project = {
  ...base,
  schemaVersion: asSchema ?? (withSectors ? contracts.PROJECT_SCHEMA_VERSION : 2),
  description: "Two systems on top of each other, for sector, visibility and lock checks.",
  eeVersion: "EE-2026.09.22PR",
  map: {
    ...(withSectors ? { sectors: [{ id: "sys-a", label: "System A" }, { id: "sys-b", label: "System B" }] } : {}),
    groups,
    markers,
  },
  logic: {
    ...base.logic,
    rules: [
      { id: "r_gate_b", label: "Ambush at gate B", once: true, when: { kind: "player_near_point", position: { ref: "marker", markerId: "gate_b" }, distance: 3000 }, conditions: [], actions: [{ kind: "spawn_group", groupId: "b_ambush" }] },
      { id: "r_patrol_down", label: "Patrol A destroyed", once: true, when: { kind: "group_destroyed", groupId: "a_patrol" }, conditions: [], actions: [{ kind: "global_message", text: "Patrol A is down.", timeoutS: null }] },
    ],
    dialogues: [dialogue],
  },
};

if (asSchema === 4) delete project.campaign; // schema 4 had no campaign block
mkdirSync(out, { recursive: true });
const text = withSectors
  ? `${JSON.stringify(project, null, 2)}\n`
  : `${JSON.stringify(project, null, 2)}\n`;
writeFileSync(join(out, "project.json"), text);
console.log(`wrote ${join(out, "project.json")} (${withSectors ? "sectors" : "schema 2, no sectors"}, ${groups.length} groups, ${markers.length} markers)`);
void core;
