import { setStepActions, stepActions } from "./exodus-steps.js";
import type {
  EEAction,
  EEBeat,
  EEDialogue,
  EEDialogueReply,
  EEGmButton,
  EELogic,
  EEPredicate,
  EERule,
} from "@forge/contracts";

/**
 * Editing operations on a project's narrative, as pure functions.
 *
 * Every control in the narrative panels writes through here rather than
 * assembling its own spread of the document. Two reasons, and the second
 * is the one that matters:
 *
 *  1. A predicate or an action is a tagged record inside a list inside a
 *     rule inside the logic — four levels of copying that would otherwise
 *     be written out at every call site, wrongly at least once.
 *  2. It gives the "pick this by clicking the map" flow somewhere to land.
 *     A form states *where* its value lives as a `LogicPath`; the canvas
 *     answers with a value; this applies it. Neither side has to know the
 *     other, and no field needs its own case in the store.
 */

/**
 * Which record in the narrative a control is editing.
 *
 * A dialogue reply is one of these on purpose (ADR-0039): its conditions
 * and actions are the same records a rule carries, so making it an owner
 * lets the whole narrative form machinery — the record editor, `setField`,
 * and the "pick it on the map" flow — work inside a conversation without a
 * line of new plumbing.
 */
export type LogicOwner =
  | { readonly kind: "beat"; readonly id: string }
  | { readonly kind: "rule"; readonly id: string }
  | { readonly kind: "gmButton"; readonly id: string }
  | {
      /**
       * The action list of an EXODUS step (ADR-0049): what replaces the
       * action without EXODUS (`alternative`) or what settling pays out
       * (`success`). Plain-EE actions only.
       */
      readonly kind: "exodusStep";
      readonly id: string;
      readonly list: "alternative" | "success";
    }
  | {
      /** `id` is the dialogue's, so every owner still has one. */
      readonly kind: "dialogueReply";
      readonly id: string;
      readonly nodeId: string;
      readonly index: number;
    };

/** Which slot inside that record: its trigger, a guard, or an action. */
export type LogicSlot =
  | { readonly slot: "when" }
  | { readonly slot: "condition"; readonly index: number }
  | { readonly slot: "action"; readonly index: number };

export interface LogicPath {
  readonly owner: LogicOwner;
  readonly target: LogicSlot;
}

type Record_ = EEPredicate | EEAction;

function mapBeats(logic: EELogic, id: string, fn: (beat: EEBeat) => EEBeat): EELogic {
  return { ...logic, beats: logic.beats.map((b) => (b.id === id ? fn(b) : b)) };
}

function mapRules(logic: EELogic, id: string, fn: (rule: EERule) => EERule): EELogic {
  return { ...logic, rules: logic.rules.map((r) => (r.id === id ? fn(r) : r)) };
}

function mapButtons(
  logic: EELogic,
  id: string,
  fn: (button: EEGmButton) => EEGmButton,
): EELogic {
  return { ...logic, gmButtons: logic.gmButtons.map((b) => (b.id === id ? fn(b) : b)) };
}

export function mapDialogues(
  logic: EELogic,
  id: string,
  fn: (dialogue: EEDialogue) => EEDialogue,
): EELogic {
  return { ...logic, dialogues: logic.dialogues.map((d) => (d.id === id ? fn(d) : d)) };
}

/** The reply an owner points at, or null. */
function readReply(logic: EELogic, owner: LogicOwner): EEDialogueReply | null {
  if (owner.kind !== "dialogueReply") return null;
  const dialogue = logic.dialogues.find((d) => d.id === owner.id);
  const node = dialogue?.nodes.find((n) => n.id === owner.nodeId);
  return node?.replies[owner.index] ?? null;
}

/** Rewrite the reply an owner points at. A path to nothing is a no-op. */
function mapReply(
  logic: EELogic,
  owner: LogicOwner,
  fn: (reply: EEDialogueReply) => EEDialogueReply,
): EELogic {
  if (owner.kind !== "dialogueReply") return logic;
  return mapDialogues(logic, owner.id, (dialogue) => ({
    ...dialogue,
    nodes: dialogue.nodes.map((node) =>
      node.id === owner.nodeId
        ? {
            ...node,
            replies: node.replies.map((reply, i) => (i === owner.index ? fn(reply) : reply)),
          }
        : node,
    ),
  }));
}

function ownerActions(logic: EELogic, owner: LogicOwner): readonly EEAction[] {
  switch (owner.kind) {
    case "beat":
      return logic.beats.find((b) => b.id === owner.id)?.actions ?? [];
    case "rule":
      return logic.rules.find((r) => r.id === owner.id)?.actions ?? [];
    case "gmButton":
      return logic.gmButtons.find((b) => b.id === owner.id)?.actions ?? [];
    case "dialogueReply":
      return readReply(logic, owner)?.actions ?? [];
    case "exodusStep":
      return stepActions(logic, owner.id, owner.list);
  }
}

/**
 * The guards an owner carries.
 *
 * Rules and dialogue replies both have them, and they mean the same thing:
 * ANDed predicates that decide whether the thing happens at all.
 */
function ownerConditions(logic: EELogic, owner: LogicOwner): readonly EEPredicate[] {
  if (owner.kind === "rule") {
    return logic.rules.find((r) => r.id === owner.id)?.conditions ?? [];
  }
  return readReply(logic, owner)?.conditions ?? [];
}

/** Replace an owner's whole condition list. */
export function setConditions(
  logic: EELogic,
  owner: LogicOwner,
  conditions: readonly EEPredicate[],
): EELogic {
  const next = [...conditions];
  if (owner.kind === "rule") {
    return mapRules(logic, owner.id, (rule) => ({ ...rule, conditions: next }));
  }
  return mapReply(logic, owner, (reply) => ({ ...reply, conditions: next }));
}

/** Replace an owner's whole action list. */
export function setActions(
  logic: EELogic,
  owner: LogicOwner,
  actions: readonly EEAction[],
): EELogic {
  const next = [...actions];
  switch (owner.kind) {
    case "beat":
      return mapBeats(logic, owner.id, (beat) => ({ ...beat, actions: next }));
    case "rule":
      return mapRules(logic, owner.id, (rule) => ({ ...rule, actions: next }));
    case "gmButton":
      return mapButtons(logic, owner.id, (button) => ({ ...button, actions: next }));
    case "dialogueReply":
      return mapReply(logic, owner, (reply) => ({ ...reply, actions: next }));
    case "exodusStep":
      return setStepActions(logic, owner.id, owner.list, next);
  }
}

export function addAction(logic: EELogic, owner: LogicOwner, action: EEAction): EELogic {
  return setActions(logic, owner, [...ownerActions(logic, owner), action]);
}

export function removeAction(logic: EELogic, owner: LogicOwner, index: number): EELogic {
  return setActions(
    logic,
    owner,
    ownerActions(logic, owner).filter((_, i) => i !== index),
  );
}

/**
 * Move an action within its list.
 *
 * Order is meaning here — "spawn the wave" then "order it to attack" is
 * not the same script as the reverse — so the panel offers it explicitly
 * rather than leaving authors to delete and re-add.
 */
export function moveAction(
  logic: EELogic,
  owner: LogicOwner,
  index: number,
  delta: number,
): EELogic {
  const actions = [...ownerActions(logic, owner)];
  const to = index + delta;
  const moved = actions[index];
  if (moved === undefined || to < 0 || to >= actions.length) return logic;
  actions.splice(index, 1);
  actions.splice(to, 0, moved);
  return setActions(logic, owner, actions);
}

export function addCondition(
  logic: EELogic,
  owner: LogicOwner,
  predicate: EEPredicate,
): EELogic {
  return setConditions(logic, owner, [...ownerConditions(logic, owner), predicate]);
}

export function removeCondition(logic: EELogic, owner: LogicOwner, index: number): EELogic {
  return setConditions(
    logic,
    owner,
    ownerConditions(logic, owner).filter((_, i) => i !== index),
  );
}

/** The record a path points at, or null when it points at nothing. */
export function readRecord(logic: EELogic, path: LogicPath): Record_ | null {
  const { owner, target } = path;
  if (target.slot === "action") return ownerActions(logic, owner)[target.index] ?? null;
  if (target.slot === "condition") return ownerConditions(logic, owner)[target.index] ?? null;
  // Only a rule has a trigger. A dialogue reply is *chosen*, not fired.
  if (owner.kind !== "rule") return null;
  return logic.rules.find((r) => r.id === owner.id)?.when ?? null;
}

/** Put a record back where a path points. A path to nothing is a no-op. */
export function writeRecord(logic: EELogic, path: LogicPath, record: Record_): EELogic {
  const { owner, target } = path;

  if (target.slot === "action") {
    const actions = [...ownerActions(logic, owner)];
    if (actions[target.index] === undefined) return logic;
    actions[target.index] = record as EEAction;
    return setActions(logic, owner, actions);
  }

  if (target.slot === "condition") {
    const conditions = [...ownerConditions(logic, owner)];
    if (conditions[target.index] === undefined) return logic;
    conditions[target.index] = record as EEPredicate;
    return setConditions(logic, owner, conditions);
  }

  if (owner.kind !== "rule") return logic;
  return mapRules(logic, owner.id, (rule) => ({ ...rule, when: record as EEPredicate }));
}

/**
 * Set one field of the record a path points at.
 *
 * Deliberately untyped in the value: the caller is a generic control
 * rendered from a descriptor, and the schema — not this function — is what
 * decides whether the result is legal. A save validates before it writes.
 */
export function setField(
  logic: EELogic,
  path: LogicPath,
  key: string,
  value: unknown,
): EELogic {
  const record = readRecord(logic, path);
  if (record === null) return logic;
  return writeRecord(logic, path, { ...record, [key]: value } as Record_);
}

/** Swap a record's kind, keeping nothing: a different kind is a different shape. */
export function replaceRecord(logic: EELogic, path: LogicPath, record: Record_): EELogic {
  return writeRecord(logic, path, record);
}
