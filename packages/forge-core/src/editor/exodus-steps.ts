import type {
  EEAction,
  EEExodusAlternative,
  EEExodusStep,
  EELogic,
  EEProject,
  EEVanillaAction,
} from "@forge/contracts";
import { extensionSites, isExtensionAction, validateExodusSteps } from "../extensions.js";

/**
 * Editing the without-EXODUS record (ADR-0049), as pure functions over the
 * logic document — the same shape as the rest of `logic-edits.ts`, so the
 * panel is a renderer and the tests can see every rule.
 */

/** What the author picks. `undecided` is a state, not an answer: it stores `null`. */
export type AlternativeChoice = "undecided" | "none" | "immediate" | "wait" | "gm";

export const ALTERNATIVE_CHOICES: readonly { readonly value: AlternativeChoice; readonly label: string; readonly hint: string }[] = [
  { value: "undecided", label: "Not decided yet", hint: "A vanilla export refuses this until you choose." },
  { value: "none", label: "Nothing", hint: "Fine for flavour. Not allowed for an essential step." },
  { value: "immediate", label: "Do this at once", hint: "Plain-EE actions: a message, a log line, a conversation to hail." },
  { value: "wait", label: "Do this after a delay", hint: "The same, N seconds later." },
  { value: "gm", label: "GM presses a button", hint: "The GM is told and gets a button; the actions run when it is pressed." },
];

export function choiceOf(alternative: EEExodusAlternative | null): AlternativeChoice {
  return alternative === null ? "undecided" : alternative.kind;
}

const isVanilla = (action: EEAction): action is EEVanillaAction => !isExtensionAction(action);

/** A new alternative of the given kind, carrying over any actions already written. */
export function alternativeFor(
  choice: AlternativeChoice,
  previous: EEExodusAlternative | null = null,
): EEExodusAlternative | null {
  const actions: EEVanillaAction[] =
    previous !== null && previous.kind !== "none" ? [...previous.actions] : [];
  switch (choice) {
    case "undecided":
      return null;
    case "none":
      return { kind: "none" };
    case "immediate":
      return { kind: "immediate", actions };
    case "wait":
      return { kind: "wait", seconds: previous?.kind === "wait" ? previous.seconds : 30, actions };
    case "gm":
      return {
        kind: "gm",
        label: previous?.kind === "gm" ? previous.label : "Resolve",
        message: previous?.kind === "gm" ? previous.message : "",
        actions,
      };
  }
}

/** First free `base`, `base_2`, … among the project's step ids. */
export function nextStepId(logic: EELogic, base: string): string {
  const taken = new Set(logic.exodusSteps.map((step) => step.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

export function addStep(logic: EELogic, id: string): EELogic {
  if (logic.exodusSteps.some((step) => step.id === id)) return logic;
  const step: EEExodusStep = { id, essential: false, alternative: null, answerWithinS: null, onSuccess: [] };
  return { ...logic, exodusSteps: [...logic.exodusSteps, step] };
}

function mapStep(logic: EELogic, id: string, fn: (step: EEExodusStep) => EEExodusStep): EELogic {
  return { ...logic, exodusSteps: logic.exodusSteps.map((step) => (step.id === id ? fn(step) : step)) };
}

export function setStepEssential(logic: EELogic, id: string, essential: boolean): EELogic {
  return mapStep(logic, id, (step) => ({ ...step, essential }));
}

/** Per-request deadline for the service's answer; null or a non-positive value clears it. */
export function setStepAnswerWithin(logic: EELogic, id: string, seconds: number | null): EELogic {
  const answerWithinS = seconds !== null && seconds > 0 ? seconds : null;
  return mapStep(logic, id, (step) => ({ ...step, answerWithinS }));
}

export function setStepChoice(logic: EELogic, id: string, choice: AlternativeChoice): EELogic {
  return mapStep(logic, id, (step) => ({ ...step, alternative: alternativeFor(choice, step.alternative) }));
}

/** Seconds / button label / GM message of the current alternative. A kind without that field is left alone. */
export function patchAlternative(
  logic: EELogic,
  id: string,
  patch: { readonly seconds?: number; readonly label?: string; readonly message?: string },
): EELogic {
  return mapStep(logic, id, (step) => {
    const alternative = step.alternative;
    if (alternative === null) return step;
    if (alternative.kind === "wait" && patch.seconds !== undefined && patch.seconds > 0) {
      return { ...step, alternative: { ...alternative, seconds: patch.seconds } };
    }
    if (alternative.kind === "gm") {
      return {
        ...step,
        alternative: {
          ...alternative,
          ...(patch.label !== undefined && patch.label !== "" ? { label: patch.label } : {}),
          ...(patch.message !== undefined ? { message: patch.message } : {}),
        },
      };
    }
    return step;
  });
}

/** Replace a step's action list (`alternative` actions or `onSuccess`). EXODUS actions are not allowed inside either. */
export function setStepActions(
  logic: EELogic,
  id: string,
  list: "alternative" | "success",
  actions: readonly EEAction[],
): EELogic {
  const vanilla = actions.filter(isVanilla);
  return mapStep(logic, id, (step) => {
    if (list === "success") return { ...step, onSuccess: vanilla };
    const alternative = step.alternative;
    if (alternative === null || alternative.kind === "none") return step;
    return { ...step, alternative: { ...alternative, actions: vanilla } };
  });
}

export function stepActions(logic: EELogic, id: string, list: "alternative" | "success"): readonly EEAction[] {
  const step = logic.exodusSteps.find((candidate) => candidate.id === id);
  if (step === undefined) return [];
  if (list === "success") return step.onSuccess;
  return step.alternative === null || step.alternative.kind === "none" ? [] : step.alternative.actions;
}

/** Delete a step and detach every action that pointed at it (they become undecided, not broken). */
export function removeStep(logic: EELogic, id: string): EELogic {
  const detach = (actions: readonly EEAction[]): EEAction[] =>
    actions.map((action) => (isExtensionAction(action) && action.stepId === id ? { ...action, stepId: null } : action));
  return {
    ...logic,
    exodusSteps: logic.exodusSteps.filter((step) => step.id !== id),
    beats: logic.beats.map((beat) => ({ ...beat, actions: detach(beat.actions) })),
    rules: logic.rules.map((rule) => ({ ...rule, actions: detach(rule.actions) })),
    gmButtons: logic.gmButtons.map((button) => ({ ...button, actions: detach(button.actions) })),
    dialogues: logic.dialogues.map((dialogue) => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => ({
        ...node,
        replies: node.replies.map((reply) => ({ ...reply, actions: detach(reply.actions) })),
      })),
    })),
  };
}

export interface VanillaReadiness {
  /** EXODUS actions in the narrative. */
  readonly exodusActions: number;
  /** Can this project be exported without EXODUS right now? */
  readonly ready: boolean;
  /** What stands in the way, one line each, as the build would report it. */
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

/** What a vanilla export would say about this project, without building it. */
export function vanillaReadiness(project: EEProject): VanillaReadiness {
  const { errors, warnings } = validateExodusSteps(project, "vanilla");
  return {
    exodusActions: extensionSites(project).length,
    ready: errors.length === 0,
    problems: errors.flatMap((error) => error.split("\n").filter((line) => line.trim() !== "")),
    warnings,
  };
}
