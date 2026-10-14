import type { EEAction, EECatalog, EEProject, ForgeCompatEntry } from "@forge/contracts";
import type { RuntimeNames } from "./codegen/logic.js";

/**
 * Forge extensions: optional capabilities layered over vanilla EmptyEpsilon.
 *
 * The core knows nothing about what an extension does. It knows only that
 * some actions (`owns`) belong to one, and that an exported scenario is in
 * one of two modes:
 *
 * - **vanilla** — those actions are replaced by the author's recorded
 *   alternatives. The output requires no extension file, no process, nothing.
 * - **integrated** — the extension emits its own code for those actions,
 *   guarded so the scenario still completes when the extension's service is
 *   missing, incompatible or lost (the alternative takes over).
 *
 * An extension declares the protocol version its emitted code speaks and the
 * capabilities its actions need; the emitted code checks them against what
 * the running service announces rather than trusting that a file exists.
 */

export type BuildMode = "vanilla" | "integrated";

/** What the extension needs to know about the action being emitted. */
export interface ExtensionActionSite {
  /** The step recording this action's alternative, or null when undecided. */
  readonly stepId: string | null;
  /** Unique within the project: the action's position in the document. */
  readonly siteKey: string;
}

export interface ExtensionContext {
  readonly catalog: EECatalog;
  readonly project: EEProject;
  readonly names: RuntimeNames;
}

export interface ForgeExtension {
  readonly id: string;
  readonly label: string;
  /** Semver of the service protocol the emitted code speaks. */
  readonly protocol: string;
  /** Capability names the service may announce and actions may need. */
  readonly capabilities: readonly string[];
  /**
   * What has been shown to work with this extension on an engine target. Evidence, not a guess:
   * leave it out (or answer `unverified`) when nothing was run. An integrated export for a target
   * that is not `engine-tested` carries a warning; a vanilla export is never affected.
   */
  compatibility?(target: string): ForgeCompatEntry;
  /** Does this action belong to the extension? */
  owns(action: EEAction): boolean;
  /**
   * What the action needs from the service, and whether the service reports an
   * outcome. `hasOutcome: false` means the extension can only hand the request
   * over: the step settles as a *handoff*, never as confirmed by the service.
   */
  describe(action: EEAction): { readonly capability: string; readonly hasOutcome: boolean };
  /** Lua at the top of the scenario, before the logic: requires and the gate runtime. */
  scenarioPrelude(context: ExtensionContext): string;
  /** Statements for `init()`. */
  initStatements(context: ExtensionContext): string;
  /** Statements for `update(delta)`, run every tick. */
  updateStatements(context: ExtensionContext): string;
  /** Lua for one owned action in an integrated build. */
  emitAction(action: EEAction, site: ExtensionActionSite, context: ExtensionContext): string;
}

/** The extension owning an action, if any is registered. */
export function extensionFor(
  extensions: readonly ForgeExtension[],
  action: EEAction,
): ForgeExtension | null {
  return extensions.find((extension) => extension.owns(action)) ?? null;
}

/** Names of the projects' extension requirements: `requires` entries that are not built in. */
export function requiredExtensionIds(project: EEProject): readonly string[] {
  return project.requires;
}

/** An action that belongs to an extension (today: the `exodus_*` family). */
export type ExodusAction = Extract<EEAction, { kind: `exodus_${string}` }>;

export function isExtensionAction(action: EEAction): action is ExodusAction {
  return action.kind.startsWith("exodus_");
}

/** An action together with where the author wrote it, for messages that name a place. */
export interface ActionSite {
  readonly where: string;
  readonly action: EEAction;
}

/**
 * Every action the project's narrative can run, with its place. Step
 * alternatives are plain-EE by schema and are not listed: they cannot hold an
 * extension action.
 */
export function collectActionSites(project: EEProject): ActionSite[] {
  const sites: ActionSite[] = [];
  const add = (where: string, actions: readonly EEAction[]): void => {
    for (const action of actions) sites.push({ where, action });
  };
  for (const beat of project.logic.beats) add(`beat "${beat.id}"`, beat.actions);
  for (const rule of project.logic.rules) add(`rule "${rule.id}"`, rule.actions);
  for (const button of project.logic.gmButtons) add(`GM button "${button.id}"`, button.actions);
  for (const dialogue of project.logic.dialogues) {
    for (const node of dialogue.nodes) {
      node.replies.forEach((reply, index) => {
        add(`dialogue "${dialogue.id}" node "${node.id}" reply ${index + 1}`, reply.actions);
      });
    }
  }
  return sites;
}

export function extensionSites(project: EEProject): ActionSite[] {
  return collectActionSites(project).filter((site) => isExtensionAction(site.action));
}

/** True when the generated scenario needs the without-EXODUS step runtime. */
export function usesExodusSteps(project: EEProject): boolean {
  return project.logic.exodusSteps.length > 0 || extensionSites(project).length > 0;
}

/**
 * The without-EXODUS record, checked as a whole (ADR-0049).
 *
 * Returns every problem at once: an author told about one undecided step per
 * build would fix them one export at a time. Errors stop the build; warnings
 * ride with the result. Nothing here guesses what an undecided step should
 * do — it reports it as something left to complete.
 */
export function validateExodusSteps(
  project: EEProject,
  mode: BuildMode,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps = new Map<string, EEProject["logic"]["exodusSteps"][number]>();
  for (const step of project.logic.exodusSteps) {
    if (steps.has(step.id)) errors.push(`two EXODUS steps are both called "${step.id}"`);
    steps.set(step.id, step);
  }

  const used = new Set<string>();
  const answered = new Set<string>(); // steps whose action waits for the service's answer
  const handedOver = new Set<string>(); // steps whose action is only handed to the service
  const undecided: string[] = [];
  for (const { where, action } of extensionSites(project)) {
    if (!isExtensionAction(action)) continue;
    if (action.stepId === null) {
      undecided.push(`${where}: ${action.kind} has no without-EXODUS step`);
      continue;
    }
    const step = steps.get(action.stepId);
    if (step === undefined) {
      errors.push(`${where}: ${action.kind} names step "${action.stepId}", which does not exist`);
      continue;
    }
    used.add(step.id);
    if (action.kind !== "exodus_puzzle") handedOver.add(step.id);
    if (action.kind === "exodus_puzzle") {
      answered.add(step.id);
      if (step.answerWithinS !== null && action.timeoutS !== null && step.answerWithinS < action.timeoutS) {
        warnings.push(
          `${where}: step "${step.id}" gives up on the service after ${step.answerWithinS}s, before the puzzle's own ${action.timeoutS}s limit — ` +
            `the alternative will start while the crew may still be playing it`,
        );
      }
    }
    if (step.alternative === null) {
      undecided.push(`${where}: step "${step.id}" (${action.kind}) has no alternative recorded yet`);
    }
  }
  for (const step of steps.values()) {
    if (!used.has(step.id)) warnings.push(`EXODUS step "${step.id}" is not used by any action`);
    const alternative = step.alternative;
    if (step.essential) {
      const gives =
        alternative !== null && alternative.kind !== "none" && alternative.actions.length > 0;
      if (!gives) {
        errors.push(
          `step "${step.id}" is essential to the mission but its alternative gives the crew no way forward — ` +
            `choose "immediate", "wait" or "GM button" and give it at least one action`,
        );
      }
    }
    if (step.essential && handedOver.has(step.id)) {
      warnings.push(
        `step "${step.id}" is essential, but its EXODUS action is only handed to the service, which confirms nothing — ` +
          `"when it succeeds" runs as soon as it is sent, not when EXODUS has done it`,
      );
    }
    if (step.essential && answered.has(step.id) && step.answerWithinS === null) {
      warnings.push(
        `step "${step.id}" is essential and waits for the service's answer with no deadline — ` +
          `a running service that never answers would hold the mission; set "answer within"`,
      );
    }
    if (alternative !== null && alternative.kind === "gm" && alternative.actions.length === 0) {
      warnings.push(`step "${step.id}": the GM button has no actions, so pressing it does nothing`);
    }
  }
  if (mode === "vanilla") {
    if (undecided.length > 0) {
      errors.push(
        `${undecided.length} EXODUS step${undecided.length === 1 ? "" : "s"} still to complete before this can be exported without EXODUS:\n` +
          undecided.map((line) => `  - ${line}`).join("\n"),
      );
    }
  } else {
    for (const line of undecided) warnings.push(`${line} — without EXODUS nothing replaces it`);
  }
  return { errors, warnings };
}

