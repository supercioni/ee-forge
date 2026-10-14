import type { EEProject } from "@forge/contracts";
import { describeAction } from "../logic/simulate.js";
import { describePredicate } from "./logic-forms.js";
import { collectRecords } from "./records.js";
import { findReferences, type ReferenceOwner } from "./references.js";

/**
 * The mission's shape, as a graph derived from the project — and nothing else.
 *
 * Every edge is a relation the project actually states; there is no layout hint, no inferred causality and no
 * second model of the logic:
 *
 *  - **spawns** — an action `spawn_group` names a group. The action may sit in a rule, a timed event, a GM
 *    control, a dialogue reply or an EXODUS step's fallback: all of them can bring a group in, so all are found
 *    (this used to look only at timed events, rules and GM buttons).
 *  - **wiped** — a condition `group_destroyed` names a group, in a rule's trigger or guard or a dialogue reply's condition.
 *  - **variable** — one record sets a variable (`set_variable`/`add_variable`, or the object variants) and another
 *    reads that same variable (`variable_equals`/`variable_at_least`, or the object variants).
 *  - **destroys** — an action `destroy` names an object that another record's `object_destroyed` condition waits for.
 *
 * Two timed events are *not* joined: being earlier on the clock is not a cause. They sit in clock order in the
 * list, with their time on them.
 */

export type DiagramNodeKind = "timed" | "rule" | "gm" | "reply" | "step" | "group";

export interface DiagramNode {
  /** `timed:<id>`, `rule:<id>`, `gm:<id>`, `reply:<dialogue>:<node>`, `step:<id>`, `group:<id>`. */
  readonly id: string;
  readonly kind: DiagramNodeKind;
  readonly label: string;
  /** One line saying what it is (`T+120s`, the rule's trigger, "spawned when called"…). */
  readonly detail: string;
  /** What opens it in the editor; groups have none (they are on the map). */
  readonly owner: ReferenceOwner | null;
  /** For timed events: seconds from the start, so lists can be in clock order. */
  readonly at?: number;
}

export type DiagramEdgeKind = "spawns" | "wiped" | "variable" | "destroys";

export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: DiagramEdgeKind;
  /** What the project says: "spawns", "wiped", "sets ambushed", "destroys sentry". */
  readonly label: string;
}

export interface DiagramModel {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
}

const nodeIdOf = (owner: ReferenceOwner): string =>
  owner.kind === "dialogueNode" ? `reply:${owner.id}:${owner.nodeId}` : owner.kind === "beat" ? `timed:${owner.id}` : owner.kind === "gmButton" ? `gm:${owner.id}` : owner.kind === "exodusStep" ? `step:${owner.id}` : owner.kind === "rule" ? `rule:${owner.id}` : `object:${owner.id}`;

const WRITES = new Set(["set_variable", "add_variable", "set_object_variable", "add_object_variable"]);
const READS = new Set(["variable_equals", "variable_at_least", "object_variable_equals", "object_variable_at_least"]);

/** `name` for a scenario variable, `objectId.name` for an object's. */
function variableKey(record: Record<string, unknown>): string | null {
  const name = record["name"];
  if (typeof name !== "string") return null;
  const target = record["target"] as { ref?: string; objectId?: string } | undefined;
  const objectId = typeof record["objectId"] === "string" ? (record["objectId"] as string) : target?.ref === "object" ? target.objectId : undefined;
  return String(record["kind"]).includes("object_variable") ? `${objectId ?? "?"}.${name}` : name;
}

export function buildDiagram(project: EEProject): DiagramModel {
  const { beats, rules, gmButtons } = project.logic;
  // Older documents (and hand-built test projects) may lack the two newer lists.
  const dialogues = project.logic.dialogues ?? [];
  const exodusSteps = project.logic.exodusSteps ?? [];
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const addEdge = (edge: DiagramEdge): void => {
    if (edge.from === edge.to) return;
    if (!edges.some((e) => e.from === edge.from && e.to === edge.to && e.kind === edge.kind && e.label === edge.label)) edges.push(edge);
  };

  for (const beat of [...beats].sort((a, b) => a.at - b.at)) {
    nodes.set(`timed:${beat.id}`, { id: `timed:${beat.id}`, kind: "timed", label: beat.label || beat.id, detail: `T+${beat.at}s`, owner: { kind: "beat", id: beat.id, label: beat.label }, at: beat.at });
  }
  for (const rule of rules) {
    const when = [rule.when, ...rule.conditions].map(describePredicate).join(" AND ");
    nodes.set(`rule:${rule.id}`, { id: `rule:${rule.id}`, kind: "rule", label: rule.label || rule.id, detail: when, owner: { kind: "rule", id: rule.id, label: rule.label } });
  }
  for (const button of gmButtons) {
    nodes.set(`gm:${button.id}`, { id: `gm:${button.id}`, kind: "gm", label: button.label || button.id, detail: "pressed by the GM", owner: { kind: "gmButton", id: button.id, label: button.label } });
  }
  // Dialogue replies and EXODUS steps are only drawn when they take part in an edge: most replies change nothing here.
  const lazyNode = (owner: ReferenceOwner): string => {
    const id = nodeIdOf(owner);
    if (!nodes.has(id)) {
      if (owner.kind === "dialogueNode") nodes.set(id, { id, kind: "reply", label: owner.label, detail: "dialogue reply", owner });
      else if (owner.kind === "exodusStep") nodes.set(id, { id, kind: "step", label: owner.label, detail: "EXODUS step, without EXODUS", owner });
    }
    return id;
  };

  for (const group of project.map.groups) {
    const groupNode = `group:${group.id}`;
    const refs = findReferences(project, "group", group.id);
    const spawners = refs.filter((r) => r.via === "spawn_group");
    const waiters = refs.filter((r) => r.via === "group_destroyed");
    const involved = group.when === "on_call" || spawners.length > 0 || waiters.length > 0;
    if (!involved) continue;
    nodes.set(groupNode, { id: groupNode, kind: "group", label: group.label, detail: group.when === "on_call" ? "spawned when called" : "there from the start", owner: null });
    for (const ref of spawners) addEdge({ from: lazyNode(ref.owner), to: groupNode, kind: "spawns", label: "spawns" });
    for (const ref of waiters) addEdge({ from: groupNode, to: lazyNode(ref.owner), kind: "wiped", label: "wiped" });
  }

  // Variables and destroyed objects: writers and readers, matched by name / object id, across every owner.
  type Site = { readonly node: string };
  const writers = new Map<string, Site[]>();
  const readers = new Map<string, Site[]>();
  const destroyers = new Map<string, Site[]>();
  const watchers = new Map<string, Site[]>();
  const scan = (owner: ReferenceOwner, subtree: unknown): void => {
    const node = nodeIdOf(owner);
    for (const record of collectRecords(subtree)) {
      const kind = String(record["kind"]);
      const push = (map: Map<string, Site[]>, key: string): void => {
        const list = map.get(key) ?? [];
        list.push({ node });
        map.set(key, list);
      };
      if (WRITES.has(kind)) {
        const key = variableKey(record);
        if (key !== null) push(writers, key);
      } else if (READS.has(kind)) {
        const key = variableKey(record);
        if (key !== null) push(readers, key);
      } else if (kind === "destroy") {
        const target = record["target"] as { ref?: string; objectId?: string } | undefined;
        if (target?.ref === "object" && typeof target.objectId === "string") push(destroyers, target.objectId);
      } else if (kind === "object_destroyed" && typeof record["objectId"] === "string") {
        push(watchers, record["objectId"] as string);
      }
    }
  };
  for (const beat of beats) scan({ kind: "beat", id: beat.id, label: beat.label }, beat);
  for (const rule of rules) scan({ kind: "rule", id: rule.id, label: rule.label }, rule);
  for (const button of gmButtons) scan({ kind: "gmButton", id: button.id, label: button.label }, button);
  for (const dialogue of dialogues) {
    for (const node of dialogue.nodes) scan({ kind: "dialogueNode", id: dialogue.id, nodeId: node.id, label: `${dialogue.label} · ${node.id}` }, node);
  }
  for (const step of exodusSteps) scan({ kind: "exodusStep", id: step.id, label: step.id }, step);

  const ownerOfNode = (id: string): ReferenceOwner | null => {
    if (id.startsWith("timed:")) return { kind: "beat", id: id.slice(6), label: nodes.get(id)?.label ?? id };
    if (id.startsWith("rule:")) return { kind: "rule", id: id.slice(5), label: nodes.get(id)?.label ?? id };
    if (id.startsWith("gm:")) return { kind: "gmButton", id: id.slice(3), label: nodes.get(id)?.label ?? id };
    if (id.startsWith("step:")) return { kind: "exodusStep", id: id.slice(5), label: id.slice(5) };
    if (id.startsWith("reply:")) {
      const [, dialogueId = "", nodeId = ""] = id.split(":");
      const dialogue = dialogues.find((d) => d.id === dialogueId);
      return { kind: "dialogueNode", id: dialogueId, nodeId, label: `${dialogue?.label ?? dialogueId} · ${nodeId}` };
    }
    return null;
  };
  const connect = (from: Map<string, Site[]>, to: Map<string, Site[]>, kind: DiagramEdgeKind, label: (key: string) => string): void => {
    for (const [key, sources] of from) {
      for (const target of to.get(key) ?? []) {
        for (const source of sources) {
          if (source.node === target.node) continue;
          const a = ownerOfNode(source.node);
          const b = ownerOfNode(target.node);
          if (a === null || b === null) continue;
          addEdge({ from: lazyNode(a), to: lazyNode(b), kind, label: label(key) });
        }
      }
    }
  };
  connect(writers, readers, "variable", (key) => `sets ${key}`);
  connect(destroyers, watchers, "destroys", (key) => `destroys ${key}`);

  return { nodes: [...nodes.values()], edges };
}

/** The one-line reading of an edge, for the text list that goes with the picture. */
export function describeEdge(model: DiagramModel, edge: DiagramEdge): string {
  const name = (id: string): string => {
    const node = model.nodes.find((n) => n.id === id);
    const word = node === undefined ? "" : { timed: "Timed event", rule: "Rule", gm: "GM control", reply: "Dialogue reply", step: "EXODUS step", group: "Group" }[node.kind];
    return `${word} “${node?.label ?? id}”`;
  };
  switch (edge.kind) {
    case "spawns":
      return `${name(edge.from)} spawns ${name(edge.to)}`;
    case "wiped":
      return `${name(edge.to)} waits for ${name(edge.from)} to be wiped out`;
    case "variable":
      return `${name(edge.from)} ${edge.label}, which ${name(edge.to)} reads`;
    case "destroys":
      return `${name(edge.from)} ${edge.label}, which ${name(edge.to)} waits for`;
  }
}

/** Short text for actions, kept here so the mermaid and the list read the same. */
export function summarizeActions(actions: readonly Parameters<typeof describeAction>[0][]): string {
  if (actions.length === 0) return "(no actions)";
  const shown = actions.slice(0, 3).map(describeAction);
  const rest = actions.length - shown.length;
  return shown.join("; ") + (rest > 0 ? `; +${rest} more` : "");
}
