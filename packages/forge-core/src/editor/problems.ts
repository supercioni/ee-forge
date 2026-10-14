import type { EELibrary, EEProject, EETemplateDef } from "@forge/contracts";
import { danglingMarkerIds } from "../points.js";
import { danglingSectors, duplicateSectorIds } from "./sectors.js";
import { sectorIssues } from "../sector-runtime.js";
import { persistenceIssues } from "../persistence.js";
import type { ReferenceOwner } from "./references.js";

/**
 * What is wrong with a project, as a list an author can work through.
 *
 * The build (`validateProject`, `validateExodusSteps`) is the authority on what **blocks** an export, but it
 * throws on the first structural error and returns warnings as bare sentences — fine as a gate, no use as a
 * to-do list. This reads the same document and answers the same questions, once, completely, with for each
 * problem: how serious it is, what it is about, what that means in plain words, what to do, and where to go.
 *
 * It does not replace the build and does not run it: `diagnose` is offline and pure, and a test builds every
 * fixture to prove that "no errors here" and "the build accepts it" agree. A refusal this list did not foresee
 * (an emitter's own complaint) is still reported — by the build, as such — never hidden.
 */

export type ProblemSeverity = "error" | "warning";

/** Where a problem lives, in terms the editor can navigate to. */
export type ProblemLocation =
  | { readonly kind: "owner"; readonly owner: ReferenceOwner }
  | { readonly kind: "object"; readonly id: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "marker"; readonly id: string }
  | { readonly kind: "template"; readonly name: string; readonly field?: string }
  | { readonly kind: "dialogue"; readonly id: string; readonly nodeId?: string }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "step"; readonly id: string };

export interface Problem {
  /** Stable for the same problem across edits, so a list can keep its place. */
  readonly id: string;
  readonly severity: ProblemSeverity;
  readonly code: string;
  /** What it is about, in the author's words ("Template Corsair Mk1", "Rule Spawn the wing"). */
  readonly subject: string;
  /** One line. */
  readonly title: string;
  /** What it means. */
  readonly message: string;
  /** What to do about it. */
  readonly action: string;
  readonly where: ProblemLocation | null;
  /** Which export it decides: every one, or only a vanilla (without EXODUS) / integrated one. */
  readonly scope: "all" | "vanilla" | "integrated";
}

export interface DiagnoseOptions {
  /** The scanned install of the project's engine, when there is one. Without it, references are "unchecked". */
  readonly library?: EELibrary | null;
  /** How EXODUS actions are treated. Default `vanilla`: the baseline every project has to reach. */
  readonly mode?: "vanilla" | "integrated";
  /** Whether an extension is registered that could build an integrated export. */
  readonly extensionAvailable?: boolean;
}

const q = (s: string): string => `“${s}”`;

export function diagnose(project: EEProject, options: DiagnoseOptions = {}): readonly Problem[] {
  const mode = options.mode ?? "vanilla";
  const library = options.library ?? null;
  const out: Problem[] = [];
  const add = (p: Omit<Problem, "id" | "scope"> & { scope?: Problem["scope"]; key?: string }): void => {
    const { key, scope, ...rest } = p;
    out.push({ ...rest, scope: scope ?? "all", id: `${p.code}:${key ?? p.subject}` });
  };

  // --- identities that must be unique
  const dupes = <T>(items: readonly T[], idOf: (item: T) => string): string[] => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const item of items) {
      const id = idOf(item);
      if (seen.has(id)) twice.add(id);
      seen.add(id);
    }
    return [...twice];
  };
  for (const id of dupes(project.map.groups, (g) => g.id)) {
    add({ severity: "error", code: "duplicate-group", subject: `Group ${q(id)}`, key: id, title: "Two groups share an id", message: `Two map groups are both called ${q(id)}. The scenario cannot tell them apart.`, action: "Rename one of them in the scene list.", where: { kind: "group", id } });
  }
  for (const id of dupes(project.map.markers, (m) => m.id)) {
    add({ severity: "error", code: "duplicate-marker", subject: `Marker ${q(id)}`, key: id, title: "Two markers share an id", message: `Two markers are both called ${q(id)}.`, action: "Rename one of them.", where: { kind: "marker", id } });
  }
  for (const id of duplicateSectorIds(project)) {
    add({ severity: "error", code: "duplicate-sector", subject: `Sector ${q(id)}`, key: id, title: "Two sectors share an id", message: `Two sectors are both called ${q(id)}. The editor cannot tell which one a group belongs to.`, action: "Delete or rename one of them in the scene list.", where: null });
  }
  for (const d of danglingSectors(project)) {
    add({
      severity: "error",
      code: "dangling-sector",
      subject: `${d.kind === "group" ? "Group" : "Marker"} ${q(d.label)}`,
      key: `${d.kind}:${d.id}`,
      title: `A ${d.kind} is filed under a sector that does not exist`,
      message: `${q(d.label)} is filed under the sector ${q(d.sector)}, which is not in this project.`,
      action: "Open it in the scene list and move it to an existing sector, or to Shared.",
      where: { kind: d.kind, id: d.id },
    });
  }
  const objects = project.map.groups.flatMap((g) => g.objects.map((o) => ({ o, group: g })));
  for (const id of dupes(objects, (x) => x.o.id)) {
    add({ severity: "error", code: "duplicate-object", subject: `Object ${q(id)}`, key: id, title: "Two objects share an id", message: `Two map objects are both called ${q(id)}. A reference to that id would be ambiguous.`, action: "Rename one of them in the inspector (ID).", where: { kind: "object", id } });
  }

  // --- sectors in play (ADR-0056)
  for (const issue of sectorIssues(project)) {
    add({ severity: issue.severity, code: issue.code, subject: issue.subject, key: issue.key, title: issue.title, message: issue.message, action: issue.action, where: issue.where });
  }

  // --- campaign saves (ADR-0058)
  for (const issue of persistenceIssues(project)) {
    add({ severity: issue.severity, code: issue.code, subject: issue.subject, key: issue.key, title: issue.title, message: issue.message, action: issue.action, where: issue.where === null ? null : { kind: "owner", owner: issue.where } });
  }

  // --- markers that were deleted but are still used
  for (const id of danglingMarkerIds(project)) {
    add({ severity: "error", code: "dangling-marker", subject: `Marker ${q(id)}`, key: id, title: "A deleted marker is still used", message: `Something points at the marker ${q(id)}, which no longer exists.`, action: "Recreate the marker, or point that record at a position instead.", where: { kind: "marker", id } });
  }

  // --- ship templates
  const byName = new Map(project.templates.map((t) => [t.name, t]));
  for (const template of project.templates) {
    const seen = new Set<string>();
    let current: EETemplateDef | undefined = template;
    let model: string | null = null;
    while (current !== undefined && !seen.has(current.name)) {
      seen.add(current.name);
      if (current.model !== null) {
        model = current.model;
        break;
      }
      current = current.copyOf === null ? undefined : byName.get(current.copyOf);
    }
    if (model === null) {
      add({ severity: "error", code: "template-no-model", subject: `Template ${q(template.name)}`, key: template.name, title: "A ship template has no model", message: "EmptyEpsilon quits while loading its ship templates when one never sets a model — with no error and nothing in the log.", action: "Choose a model in Fleet → Hull, or copy a template that has one.", where: { kind: "template", name: template.name, field: "model" } });
    }
  }

  // --- dialogues
  const dialogueIds = new Set<string>();
  for (const dialogue of project.logic.dialogues) {
    if (dialogueIds.has(dialogue.id)) {
      add({ severity: "error", code: "duplicate-dialogue", subject: `Dialogue ${q(dialogue.label)}`, key: dialogue.id, title: "Two dialogues share an id", message: `Two dialogues are both called ${q(dialogue.id)}.`, action: "Rename one of them.", where: { kind: "dialogue", id: dialogue.id } });
    }
    dialogueIds.add(dialogue.id);
    const nodeIds = new Set<string>();
    for (const node of dialogue.nodes) {
      if (nodeIds.has(node.id)) {
        add({ severity: "error", code: "duplicate-node", subject: `Dialogue ${q(dialogue.label)} · ${node.id}`, key: `${dialogue.id}/${node.id}`, title: "Two lines share an id", message: `The dialogue has two nodes called ${q(node.id)}.`, action: "Rename one of them.", where: { kind: "dialogue", id: dialogue.id, nodeId: node.id } });
      }
      nodeIds.add(node.id);
    }
    if (!nodeIds.has(dialogue.entry)) {
      add({ severity: "error", code: "dialogue-no-entry", subject: `Dialogue ${q(dialogue.label)}`, key: dialogue.id, title: "A dialogue opens on a line that does not exist", message: `It opens on ${q(dialogue.entry)}, which it does not define.`, action: "Choose an existing line as the entry, or add the missing one.", where: { kind: "dialogue", id: dialogue.id } });
    }
    for (const node of dialogue.nodes) {
      node.replies.forEach((reply, index) => {
        if (reply.target.kind === "node" && !nodeIds.has(reply.target.nodeId)) {
          add({ severity: "error", code: "dialogue-broken-jump", subject: `Dialogue ${q(dialogue.label)} · ${node.id} · reply ${index + 1}`, key: `${dialogue.id}/${node.id}/${index}`, title: "A reply leads nowhere", message: `Reply ${index + 1} of ${q(node.id)} goes to ${q(reply.target.nodeId)}, which does not exist.`, action: "Point the reply at an existing line, or add that line.", where: { kind: "dialogue", id: dialogue.id, nodeId: node.id } });
        }
      });
    }
    const reachable = new Set<string>([dialogue.entry]);
    const queue = [dialogue.entry];
    while (queue.length > 0) {
      const id = queue.shift();
      const current = dialogue.nodes.find((n) => n.id === id);
      for (const reply of current?.replies ?? []) {
        if (reply.target.kind === "node" && !reachable.has(reply.target.nodeId)) {
          reachable.add(reply.target.nodeId);
          queue.push(reply.target.nodeId);
        }
      }
    }
    for (const node of dialogue.nodes) {
      if (!reachable.has(node.id)) {
        add({ severity: "warning", code: "dialogue-unreachable", subject: `Dialogue ${q(dialogue.label)} · ${node.id}`, key: `${dialogue.id}/${node.id}`, title: "No reply leads to this line", message: `Nothing leads from ${q(dialogue.entry)} to ${q(node.id)}, so the crew can never reach it.`, action: "Add a reply that goes there, or delete the line if it is a leftover.", where: { kind: "dialogue", id: dialogue.id, nodeId: node.id } });
      }
    }
  }
  for (const { o } of objects) {
    if (!("dialogueId" in o) || o.dialogueId === null) continue;
    const label = o.callsign ?? o.id;
    if (!dialogueIds.has(o.dialogueId)) {
      add({ severity: "error", code: "object-unknown-dialogue", subject: `Object ${q(label)}`, key: o.id, title: "An object answers with a dialogue that does not exist", message: `${q(label)} answers hails with the dialogue ${q(o.dialogueId)}, which this project does not define.`, action: "Choose another dialogue in the object's inspector, or clear it.", where: { kind: "object", id: o.id } });
      continue;
    }
    const dialogue = project.logic.dialogues.find((d) => d.id === o.dialogueId);
    const services = dialogue?.nodes.some((n) => n.replies.some((r) => r.target.kind === "services")) === true;
    if (services && o.type !== "SpaceStation") {
      add({ severity: "warning", code: "services-not-station", subject: `Object ${q(label)}`, key: o.id, title: "Station services offered by something that is not a station", message: `${q(label)} is a ${o.type}, but its dialogue hands over to EmptyEpsilon's station services menu, which expects a space station.`, action: "Use that dialogue on a station, or remove the services reply.", where: { kind: "object", id: o.id } });
    }
  }

  // --- orbits
  const objectIds = new Set(objects.map((x) => x.o.id));
  for (const { o } of objects) {
    if (o.type === "Planet" && o.orbit !== null && !objectIds.has(o.orbit.targetId)) {
      add({ severity: "error", code: "orbit-unknown", subject: `Planet ${q(o.callsign ?? o.id)}`, key: o.id, title: "A planet orbits something that does not exist", message: `It orbits ${q(o.orbit.targetId)}, which is not in the scene.`, action: "Choose what it orbits again, or clear the orbit.", where: { kind: "object", id: o.id } });
    }
  }

  // --- references to the install (warnings: the install may well have them)
  const known = {
    factions: new Set([...project.factions.map((f) => f.name), ...(library?.factions.map((f) => f.name) ?? [])]),
    templates: new Set([...project.templates.map((t) => t.name), ...(library?.templates.map((t) => t.name) ?? [])]),
    models: new Set([...project.models.map((m) => m.name), ...(library?.models.map((m) => m.name) ?? [])]),
  };
  const unchecked = (what: string): string => ` Nothing could be checked: no install of ${project.eeVersion} is scanned, so ${what} may be fine.`;
  for (const { o } of objects) {
    const label = o.callsign ?? o.id;
    if ("faction" in o && !known.factions.has(o.faction)) {
      add({ severity: "warning", code: library === null ? "faction-unchecked" : "faction-unknown", subject: `Object ${q(label)}`, key: o.id, title: library === null ? "Faction not checked" : "Faction not found", message: library === null ? `${q(label)} uses the faction ${q(o.faction)}.${unchecked("it")}` : `${q(label)} uses the faction ${q(o.faction)}, which this project does not define and the scanned ${library.eeVersion} install does not have.`, action: library === null ? "Register and scan an install (Installations…), or ignore this if the faction is stock." : "Choose another faction, define it in the project, or rescan the install if it was added since.", where: { kind: "object", id: o.id } });
    }
    if ("template" in o && !known.templates.has(o.template)) {
      add({ severity: "warning", code: library === null ? "template-unchecked" : "template-unknown", subject: `Object ${q(label)}`, key: o.id, title: library === null ? "Ship template not checked" : "Ship template not found", message: library === null ? `${q(label)} spawns the template ${q(o.template)}.${unchecked("it")}` : `${q(label)} spawns the template ${q(o.template)}, which this project does not define and the scanned ${library.eeVersion} install does not have.`, action: library === null ? "Register and scan an install (Installations…)." : "Choose a template that exists (Inspector → Template), or add it in Fleet.", where: { kind: "object", id: o.id } });
    }
  }
  for (const template of project.templates) {
    if (template.model !== null && !known.models.has(template.model)) {
      add({ severity: "warning", code: library === null ? "model-unchecked" : "model-unknown", subject: `Template ${q(template.name)}`, key: template.name, title: library === null ? "Model not checked" : "Model not found", message: library === null ? `The template uses the model ${q(template.model)}.${unchecked("it")}` : `The template uses the model ${q(template.model)}, which this project does not define and the scanned ${library.eeVersion} install does not provide.`, action: library === null ? "Register and scan an install (Installations…)." : "Choose another model in Fleet → Hull, or rescan the install if it was added since.", where: { kind: "template", name: template.name, field: "model" } });
    }
  }
  for (const faction of project.factions) {
    for (const other of [...faction.enemies, ...faction.friends]) {
      if (!known.factions.has(other)) {
        add({ severity: "warning", code: "faction-relation-unknown", subject: `Faction ${q(faction.name)}`, key: `${faction.name}/${other}`, title: "A faction relation names an unknown faction", message: `${q(faction.name)} lists ${q(other)} as friend or enemy, but that faction is neither defined here nor in the scanned install.`, action: "Define that faction in the project, or remove the relation.", where: null });
      }
    }
  }

  // --- variables
  const declared = new Set(project.logic.variables.map((v) => v.name));
  for (const rule of project.logic.rules) {
    for (const predicate of [rule.when, ...rule.conditions]) {
      if ((predicate.kind === "variable_equals" || predicate.kind === "variable_at_least") && !declared.has(predicate.name)) {
        add({ severity: "warning", code: "variable-undeclared", subject: `Rule ${q(rule.label)}`, key: `${rule.id}/${predicate.name}`, title: "A rule reads a variable nobody declared", message: `The rule reads ${q(predicate.name)}, which the project never declares, so it starts with no value.`, action: "Declare it under Mission → Variables (Declare).", where: { kind: "variable", name: predicate.name } });
      }
    }
  }

  // --- EXODUS: the alternatives that make a mission playable without it
  out.push(...exodusProblems(project, mode, options.extensionAvailable));
  return out;
}

interface Site {
  readonly owner: ReferenceOwner;
  readonly where: string;
  readonly kind: string;
  readonly stepId: string | null;
  readonly timeoutS: number | null;
}

function exodusSites(project: EEProject): Site[] {
  const sites: Site[] = [];
  const add = (owner: ReferenceOwner, where: string, actions: readonly unknown[]): void => {
    for (const a of actions) {
      const action = a as { kind: string; stepId?: string | null; timeoutS?: number | null };
      if (action.kind.startsWith("exodus_")) sites.push({ owner, where, kind: action.kind, stepId: action.stepId ?? null, timeoutS: action.timeoutS ?? null });
    }
  };
  for (const beat of project.logic.beats) add({ kind: "beat", id: beat.id, label: beat.label }, `timed event ${q(beat.label)}`, beat.actions);
  for (const rule of project.logic.rules) add({ kind: "rule", id: rule.id, label: rule.label }, `rule ${q(rule.label)}`, rule.actions);
  for (const button of project.logic.gmButtons) add({ kind: "gmButton", id: button.id, label: button.label }, `GM control ${q(button.label)}`, button.actions);
  for (const dialogue of project.logic.dialogues) {
    for (const node of dialogue.nodes) {
      node.replies.forEach((reply, index) => add({ kind: "dialogueNode", id: dialogue.id, nodeId: node.id, label: `${dialogue.label} · ${node.id}` }, `dialogue ${q(dialogue.label)}, ${node.id}, reply ${index + 1}`, reply.actions));
    }
  }
  return sites;
}

/**
 * The same rules as `validateExodusSteps`, one problem each and with a place to go — in particular the steps
 * that have no alternative yet, which the build reports as one block of text and which are, together, the list
 * of what is left to do before a mission plays without EXODUS.
 */
function exodusProblems(project: EEProject, mode: "vanilla" | "integrated", extensionAvailable: boolean | undefined): Problem[] {
  const out: Problem[] = [];
  const add = (p: Omit<Problem, "id"> & { key: string }): void => {
    const { key, ...rest } = p;
    out.push({ ...rest, id: `${p.code}:${key}` });
  };
  const sites = exodusSites(project);
  const steps = new Map<string, EEProject["logic"]["exodusSteps"][number]>();
  for (const step of project.logic.exodusSteps) {
    if (steps.has(step.id)) {
      add({ severity: "error", code: "step-duplicate", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "Two EXODUS steps share an id", message: `Two steps are both called ${q(step.id)}.`, action: "Rename one of them.", where: { kind: "step", id: step.id }, scope: "all" });
    }
    steps.set(step.id, step);
  }
  if (mode === "integrated" && sites.length > 0 && extensionAvailable === false) {
    add({ severity: "error", code: "extension-missing", subject: "EXODUS extension", key: "extension", title: "No EXODUS extension is available", message: "This project uses EXODUS actions, but no EXODUS extension is registered, so an integrated export cannot be built.", action: "Turn the extension on in Settings, or export without EXODUS.", where: null, scope: "integrated" });
  }
  const used = new Set<string>();
  const answered = new Set<string>();
  const handedOver = new Set<string>();
  const undecidedSeverity = mode === "vanilla" ? "error" : "warning";
  for (const site of sites) {
    const owner = { kind: "owner", owner: site.owner } as const;
    if (site.stepId === null) {
      add({ severity: undecidedSeverity, code: "step-none", subject: `${site.where}`, key: `${site.owner.kind}:${site.owner.id}:${"nodeId" in site.owner ? site.owner.nodeId : ""}:${site.where}:${site.kind}`, title: "An EXODUS action has no without-EXODUS step", message: `The ${site.kind} action in ${site.where} says nothing about what happens when EXODUS is absent.`, action: "Open it and choose or create the step that replaces it (an alternative that gives the crew a way forward).", where: owner, scope: "all" });
      continue;
    }
    const step = steps.get(site.stepId);
    if (step === undefined) {
      add({ severity: "error", code: "step-missing", subject: site.where, key: `${site.where}:${site.stepId}`, title: "An EXODUS action names a step that does not exist", message: `The ${site.kind} action in ${site.where} names the step ${q(site.stepId)}, which is not defined.`, action: "Choose an existing step, or create it.", where: owner, scope: "all" });
      continue;
    }
    used.add(step.id);
    if (site.kind !== "exodus_puzzle") handedOver.add(step.id);
    if (site.kind === "exodus_puzzle") {
      answered.add(step.id);
      if (step.answerWithinS !== null && site.timeoutS !== null && step.answerWithinS < site.timeoutS) {
        add({ severity: "warning", code: "step-deadline-short", subject: `EXODUS step ${q(step.id)}`, key: `${site.where}:${step.id}`, title: "The alternative may start while the puzzle is still being played", message: `${site.where}: the step gives up on the service after ${step.answerWithinS}s, before the puzzle's own ${site.timeoutS}s limit.`, action: "Raise “answer within” to at least the puzzle's limit.", where: { kind: "step", id: step.id }, scope: "all" });
      }
    }
    if (step.alternative === null) {
      add({ severity: undecidedSeverity, code: "step-undecided", subject: `EXODUS step ${q(step.id)}`, key: `${site.where}:${step.id}`, title: "No alternative recorded yet", message: `${site.where}: step ${q(step.id)} (${site.kind}) has no alternative, so without EXODUS nothing replaces it.`, action: "Open the step and choose what happens without EXODUS: immediately, wait, or a GM control.", where: { kind: "step", id: step.id }, scope: "all" });
    }
  }
  for (const step of steps.values()) {
    const where = { kind: "step", id: step.id } as const;
    if (!used.has(step.id)) {
      add({ severity: "warning", code: "step-unused", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "A step is not used by any action", message: "No EXODUS action names this step, so it never runs.", action: "Delete it, or attach it to an action.", where, scope: "all" });
    }
    const alt = step.alternative;
    if (step.essential && !(alt !== null && alt.kind !== "none" && alt.actions.length > 0)) {
      add({ severity: "error", code: "step-essential-no-way", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "An essential step gives the crew no way forward", message: "The mission cannot continue without this step, but its alternative does nothing.", action: "Choose “immediate”, “wait” or “GM control” and give it at least one action.", where, scope: "all" });
    }
    if (step.essential && handedOver.has(step.id)) {
      add({ severity: "warning", code: "step-essential-handed-over", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "“When it succeeds” does not wait for EXODUS", message: "The action is only handed to the service, which confirms nothing: what follows runs as soon as it is sent, not when EXODUS has done it.", action: "Use an action the service answers (a puzzle), or accept that the next step does not wait.", where, scope: "all" });
    }
    if (step.essential && answered.has(step.id) && step.answerWithinS === null) {
      add({ severity: "warning", code: "step-no-deadline", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "An essential step waits for the service with no deadline", message: "A running service that never answers would hold the mission.", action: "Set “answer within” on the step.", where, scope: "all" });
    }
    if (alt !== null && alt.kind === "gm" && alt.actions.length === 0) {
      add({ severity: "warning", code: "step-gm-empty", subject: `EXODUS step ${q(step.id)}`, key: step.id, title: "The GM control has no actions", message: "Pressing the button would do nothing.", action: "Give the GM control at least one action.", where, scope: "all" });
    }
  }
  return out;
}

/** Errors first, then warnings; within each, the order the project lists them. */
export function sortProblems(problems: readonly Problem[]): readonly Problem[] {
  return [...problems].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

/** The problems that decide an export of this mode (the ones that apply to every export and to this one). */
export function problemsFor(problems: readonly Problem[], mode: "vanilla" | "integrated"): readonly Problem[] {
  return problems.filter((p) => p.scope === "all" || p.scope === mode);
}
