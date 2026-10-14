import type { EEProject } from "@forge/contracts";
import { GROUP_ID_KEYS, MARKER_ID_KEYS, OBJECT_ID_KEYS } from "./rename.js";

/**
 * "Used by": everything in a project that names an object, a group or a marker.
 *
 * Derived, never stored (the project document is the only state): it is the same deep walk the rename uses, keyed
 * on the field names that hold an id of each namespace, so a reference added to the model tomorrow is found the day
 * it exists — `rename.ts`'s schema-walking test already fails when a new id-holding field has a name this module
 * does not know.
 *
 * Each hit says *who* holds the reference (an owner the editor can open), *where* in it (when / if / then…), and
 * *how* (the kind of the nearest record around it, e.g. `spawn_group`, `player_in_zone`), without this module having
 * to know every predicate and action.
 */

export type ReferenceTarget = "object" | "group" | "marker";

export type ReferenceOwner =
  | { readonly kind: "rule"; readonly id: string; readonly label: string }
  | { readonly kind: "beat"; readonly id: string; readonly label: string }
  | { readonly kind: "gmButton"; readonly id: string; readonly label: string }
  | { readonly kind: "dialogueNode"; readonly id: string; readonly nodeId: string; readonly label: string }
  | { readonly kind: "exodusStep"; readonly id: string; readonly label: string }
  | { readonly kind: "object"; readonly id: string; readonly label: string };

export interface Reference {
  readonly owner: ReferenceOwner;
  /** Where in the owner: "When", "If", "Then", "Reply", "Orbit", "Order"… */
  readonly where: string;
  /** The record that holds it (`spawn_group`, `group_destroyed`, `order_attack`…), or "" when there is none. */
  readonly via: string;
}

const KEYS: Readonly<Record<ReferenceTarget, readonly string[]>> = {
  object: OBJECT_ID_KEYS,
  group: GROUP_ID_KEYS,
  marker: MARKER_ID_KEYS,
};

/** Walk `value`, calling `hit` for every field in `keys` that equals `id`. `via` is the nearest enclosing `kind`. */
function walk(
  value: unknown,
  keys: readonly string[],
  id: string,
  path: readonly string[],
  via: string,
  hit: (path: readonly string[], via: string) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, keys, id, path, via, hit));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const here = typeof record["kind"] === "string" ? (record["kind"] as string) : via;
  for (const [key, item] of Object.entries(record)) {
    if (keys.includes(key) && item === id) hit([...path, key], here);
    else walk(item, keys, id, [...path, key], here, hit);
  }
}

const SLOT_WORDS: Readonly<Record<string, string>> = {
  when: "When",
  conditions: "If",
  actions: "Then",
  replies: "Reply",
  alternative: "Without EXODUS",
  success: "On success",
  onSuccess: "On success",
};

function whereOf(path: readonly string[], fallback: string): string {
  for (const segment of path) {
    const word = SLOT_WORDS[segment];
    if (word !== undefined) return word;
  }
  return fallback;
}

/** Every record that names `id` in the namespace `target`, in document order, one entry per (owner, where, via). */
export function findReferences(project: EEProject, target: ReferenceTarget, id: string): readonly Reference[] {
  const keys = KEYS[target];
  const found: Reference[] = [];
  const seen = new Set<string>();
  const add = (owner: ReferenceOwner, where: string, via: string): void => {
    const key = `${owner.kind}:${owner.id}:${"nodeId" in owner ? owner.nodeId : ""}:${where}:${via}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ owner, where, via });
  };

  const { logic } = project;
  for (const rule of logic.rules) {
    walk(rule, keys, id, [], "", (path, via) => add({ kind: "rule", id: rule.id, label: rule.label }, whereOf(path, "When"), via));
  }
  for (const beat of logic.beats) {
    walk(beat, keys, id, [], "", (path, via) => add({ kind: "beat", id: beat.id, label: beat.label }, whereOf(path, "Then"), via));
  }
  for (const button of logic.gmButtons) {
    walk(button, keys, id, [], "", (path, via) => add({ kind: "gmButton", id: button.id, label: button.label }, whereOf(path, "Then"), via));
  }
  for (const dialogue of logic.dialogues ?? []) {
    for (const node of dialogue.nodes) {
      walk(node, keys, id, [], "", (path, via) =>
        add({ kind: "dialogueNode", id: dialogue.id, nodeId: node.id, label: `${dialogue.label} · ${node.id}` }, whereOf(path, "Reply"), via),
      );
    }
  }
  for (const step of logic.exodusSteps ?? []) {
    walk(step, keys, id, [], "", (path, via) => add({ kind: "exodusStep", id: step.id, label: step.id }, whereOf(path, "Without EXODUS"), via));
  }
  // Other objects: an orbit, a formation leader, a defend/attack order, a marker used as a destination.
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      if (target === "object" && object.id === id) continue;
      const label = ("callsign" in object && object.callsign !== null ? object.callsign : object.id) as string;
      walk(object, keys, id, [], "", (path) => {
        const where = path.includes("orbit") ? "Orbit" : path.includes("order") ? "Order" : "Reference";
        add({ kind: "object", id: object.id, label }, where, "");
      });
    }
  }
  return found;
}

/** The rules, beats and buttons whose actions spawn this group — what makes an "on call" group appear. */
export function groupSpawners(project: EEProject, groupId: string): readonly Reference[] {
  return findReferences(project, "group", groupId).filter((ref) => ref.via === "spawn_group");
}

/** "spawn_group" → "spawns the group" is the UI's job; this is the neutral reading: "spawn group". */
export function describeVia(via: string): string {
  return via === "" ? "" : via.replace(/_/g, " ");
}
