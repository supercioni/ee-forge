import type { EEProject, EEVariableValue } from "@forge/contracts";
import { collectRecords } from "./records.js";
import type { ReferenceOwner } from "./references.js";

/**
 * Variables, as the project uses them.
 *
 * A scenario variable is declared once (`logic.variables`, a name and a starting value) and then set by actions and
 * read by conditions; an object variable is declared on one object and addressed by that object. This lists both with
 * who writes and who reads each — derived from the project every time, never stored — so the author can see a
 * variable nothing reads, or one a condition waits for that nothing ever sets.
 */

export interface VariableUse {
  readonly owner: ReferenceOwner;
  /** "sets", "adds to", "equals", "at least": the record that touches it. */
  readonly how: string;
}

export interface VariableInfo {
  readonly scope: "scenario" | "object";
  /** The name as written in records. */
  readonly name: string;
  /** For an object variable, the object that declares it. */
  readonly objectId: string | null;
  /** Declared starting value; null for a name used but never declared. */
  readonly initial: EEVariableValue | null;
  readonly declared: boolean;
  /**
   * What a declaration would start as, read from how records use the name: a record that sets or compares it to a
   * flag or a text means it is one, anything else is a number. Only a suggestion — the author can change it.
   */
  readonly suggestedInitial: EEVariableValue;
  readonly writers: readonly VariableUse[];
  readonly readers: readonly VariableUse[];
}

const HOW: Readonly<Record<string, string>> = {
  set_variable: "sets",
  add_variable: "adds to",
  set_object_variable: "sets",
  add_object_variable: "adds to",
  variable_equals: "waits for it to equal",
  variable_at_least: "waits for at least",
  object_variable_equals: "waits for it to equal",
  object_variable_at_least: "waits for at least",
};
const WRITE_KINDS = new Set(["set_variable", "add_variable", "set_object_variable", "add_object_variable"]);

export function variableInfos(project: EEProject): readonly VariableInfo[] {
  interface Slot {
    writers: VariableUse[];
    readers: VariableUse[];
    suggestedInitial: EEVariableValue;
    typed: boolean;
  }
  const uses = new Map<string, Slot>();
  const slot = (key: string): Slot => {
    let entry = uses.get(key);
    if (entry === undefined) {
      entry = { writers: [], readers: [], suggestedInitial: 0, typed: false };
      uses.set(key, entry);
    }
    return entry;
  };
  const players = project.map.groups.flatMap((g) => g.objects).filter((o) => o.type === "PlayerSpaceship").map((o) => o.id);
  const objectsReached = (record: Record<string, unknown>): readonly string[] => {
    const target = record["target"] as { ref?: string; objectId?: string; groupId?: string } | undefined;
    if (typeof record["objectId"] === "string") return [record["objectId"]];
    if (target?.ref === "object" && target.objectId !== undefined) return [target.objectId];
    if (target?.ref === "group") return project.map.groups.find((g) => g.id === target.groupId)?.objects.map((o) => o.id) ?? [];
    if (target?.ref === "player") return players;
    return [];
  };
  const noteType = (entry: Slot, value: unknown): void => {
    if (!entry.typed && (typeof value === "boolean" || typeof value === "string")) {
      entry.typed = true;
      entry.suggestedInitial = typeof value === "boolean" ? false : "";
    }
  };
  const scan = (owner: ReferenceOwner, subtree: unknown): void => {
    for (const record of collectRecords(subtree)) {
      const kind = String(record["kind"]);
      const how = HOW[kind];
      if (how === undefined || typeof record["name"] !== "string") continue;
      const isObjectKind = kind.includes("object_variable");
      const name = record["name"] as string;
      // An object variable is addressed by an object, or written through a target that is a group (every member) or
      // the player ship; each object it reaches is one row, so a variable declared on the members is matched to the
      // record that writes it instead of to a placeholder.
      const keys = isObjectKind ? objectsReached(record).map((id) => `object:${id}:${name}`) : [`scenario:${name}`];
      for (const key of keys) {
        const entry = slot(key);
        (WRITE_KINDS.has(kind) ? entry.writers : entry.readers).push({ owner, how });
        noteType(entry, record["value"]);
      }
    }
  };
  const { logic } = project;
  for (const beat of logic.beats) scan({ kind: "beat", id: beat.id, label: beat.label }, beat);
  for (const rule of logic.rules) scan({ kind: "rule", id: rule.id, label: rule.label }, rule);
  for (const button of logic.gmButtons) scan({ kind: "gmButton", id: button.id, label: button.label }, button);
  for (const dialogue of logic.dialogues ?? []) {
    for (const node of dialogue.nodes) scan({ kind: "dialogueNode", id: dialogue.id, nodeId: node.id, label: `${dialogue.label} · ${node.id}` }, node);
  }
  for (const step of logic.exodusSteps ?? []) scan({ kind: "exodusStep", id: step.id, label: step.id }, step);

  const infos: VariableInfo[] = [];
  const seen = new Set<string>();
  for (const variable of logic.variables) {
    const key = `scenario:${variable.name}`;
    seen.add(key);
    infos.push({ scope: "scenario", name: variable.name, objectId: null, initial: variable.initial, declared: true, suggestedInitial: declaredKind(variable.initial), ...pickUses(uses.get(key)) });
  }
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      for (const variable of object.variables) {
        const key = `object:${object.id}:${variable.name}`;
        seen.add(key);
        infos.push({ scope: "object", name: variable.name, objectId: object.id, initial: variable.initial, declared: true, suggestedInitial: declaredKind(variable.initial), ...pickUses(uses.get(key)) });
      }
    }
  }
  // Used but never declared: a typo, or a variable the author means to declare.
  for (const [key, use] of uses) {
    if (seen.has(key)) continue;
    const [scope, ...rest] = key.split(":");
    const name = rest[rest.length - 1] ?? "";
    infos.push({ scope: scope === "object" ? "object" : "scenario", name, objectId: scope === "object" ? (rest[0] ?? null) : null, initial: null, declared: false, suggestedInitial: use.suggestedInitial, writers: use.writers, readers: use.readers });
  }
  return infos;
}

const declaredKind = (value: EEVariableValue): EEVariableValue => (typeof value === "boolean" ? false : typeof value === "string" ? "" : 0);
const pickUses = (use: { writers: VariableUse[]; readers: VariableUse[] } | undefined): { writers: readonly VariableUse[]; readers: readonly VariableUse[] } => ({
  writers: use?.writers ?? [],
  readers: use?.readers ?? [],
});
