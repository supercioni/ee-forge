import type {
  EEAction,
  EECatalog,
  EEDialogue,
  EEDialogueNode,
  EEPredicate,
  EEProject,
} from "@forge/contracts";
import { CodegenError, luaString, raw, renderGlobalCall, str } from "./lua.js";
import type { RuntimeNames } from "./logic.js";

/**
 * Emits the comms dialogues (ADR-0039).
 *
 * A dialogue becomes one Lua function per node, hung off a global table.
 * `setCommsFunction` receives the entry node's function; a reply that jumps
 * calls another node's function directly. That is exactly the shape
 * EmptyEpsilon's own comms scripts have — `addCommsReply(_("Back"),
 * commsStationMainMenu)` — and it is why the model is a graph rather than a
 * tree.
 *
 * ## Every callback closes over `_ENV` and nothing else
 *
 * `setCommsFunction` converts its callback through
 * `convert<ScriptSimpleCallback>`, the same conversion `addGMFunction`
 * uses, and it reads the closure's **first upvalue and requires a table**.
 * Probed live on 2026-08-16:
 *
 *   local captured = 42
 *   obj:setCommsFunction(function() return captured end)
 *   --> ??[convert<ScriptSimpleCallback>::param] Upvalue 1 of function is not a table
 *
 *   obj:setCommsFunction(function() setCommsMessage("hi") end)   --> accepted
 *
 * So no emitted callback may capture a local. Node functions are addressed
 * by their full global name and every reply body does the same. `comms_source`
 * and `comms_target` arrive as **parameters**, which are not upvalues —
 * EE's docs say the callback "can optionally take two equivalent
 * parameters", and taking them beats reading the globals.
 *
 * The same rule is why `logic.ts` keeps the runtime and the state in two
 * prefixed globals; see its module docstring for the original finding.
 */

/** Lua global holding a project's node functions: `<rt>.dlg.<id>.<node>`. */
function nodeRef(names: RuntimeNames, dialogueId: string, nodeId: string): string {
  return `${names.rt}.dlg[${luaString(dialogueId)}][${luaString(nodeId)}]`;
}

/**
 * True when any reply hands off to EmptyEpsilon's stock station menu.
 *
 * The scenario then loads `comms_station.lua` once, which is the only
 * place this emitter names a Lua function the catalog cannot check — see
 * {@link emitDialogues}.
 */
export function usesStationServices(project: EEProject): boolean {
  return project.logic.dialogues.some((dialogue) =>
    dialogue.nodes.some((node) =>
      node.replies.some((reply) => reply.target.kind === "services"),
    ),
  );
}

/**
 * How a dialogue reaches the rest of the narrative emitter.
 *
 * Passed in rather than imported: `logic.ts` owns `emitPredicate` and
 * `emitActions`, and importing them here would make the two modules
 * circular. The indirection is the price of the dialogue emitter being its
 * own file.
 */
export interface DialogueEmitters {
  /** A predicate as a boolean Lua expression. */
  readonly predicate: (predicate: EEPredicate) => string;
  /** A list of actions as statements, one per line. */
  readonly actions: (actions: readonly EEAction[]) => string;
}

/** Emit every dialogue as one Lua function per node. */
export function emitDialogues(
  catalog: EECatalog,
  project: EEProject,
  names: RuntimeNames,
  emit: DialogueEmitters,
): string {
  if (project.logic.dialogues.length === 0) return "-- (none)";

  const chunks: string[] = [`${names.rt}.dlg = ${names.rt}.dlg or {}`];

  for (const dialogue of project.logic.dialogues) {
    chunks.push(
      `${names.rt}.dlg[${luaString(dialogue.id)}] = ${names.rt}.dlg[${luaString(dialogue.id)}] or {}`,
    );
    for (const node of dialogue.nodes) {
      chunks.push(emitNode(catalog, names, dialogue, node, emit));
    }
  }

  return chunks.join("\n\n");
}

function emitNode(
  catalog: EECatalog,
  names: RuntimeNames,
  dialogue: EEDialogue,
  node: EEDialogueNode,
  emit: DialogueEmitters,
): string {
  const lines: string[] = [
    `${nodeRef(names, dialogue.id, node.id)} = function(comms_source, comms_target)`,
    // setCommsMessage in a reply's callback clears the replies that were
    // showing, which is exactly what a new node wants: say the line, then
    // offer this node's buttons.
    `  ${renderGlobalCall(catalog, "setCommsMessage", [str(node.text)])}`,
  ];

  node.replies.forEach((reply, index) => {
    const label = `dlg:${dialogue.id}/${node.id}#${index}`;
    const target = reply.target;
    const body: string[] = [];

    if (reply.actions.length > 0) {
      body.push(`    ${names.rt}.run(${luaString(label)}, function()`);
      body.push(indent(emit.actions(reply.actions), "      "));
      body.push("    end)");
    }

    switch (target.kind) {
      case "node":
        if (!dialogue.nodes.some((candidate) => candidate.id === target.nodeId)) {
          throw new CodegenError(
            `dialogue "${dialogue.id}" reply "${reply.text}" jumps to node "${target.nodeId}", which it does not define`,
          );
        }
        body.push(
          `    ${nodeRef(names, dialogue.id, target.nodeId)}(comms_source, comms_target)`,
        );
        break;
      case "gm":
        body.push(`    ${renderGlobalCall(catalog, "commsSwitchToGM", [])}`);
        break;
      case "services":
        // The one call in this emitter the catalog cannot vouch for:
        // `commsStationMainMenu` belongs to EE's `comms_station.lua`, not
        // to its scripting API. The scenario loads that file (see
        // `stationServicesPrelude`) and this hands the conversation over.
        body.push("    commsStationMainMenu(comms_source, comms_target)");
        break;
    }

    const callback = [
      `function(comms_source, comms_target)`,
      ...body,
      `  end`,
    ].join("\n");

    const call = `  ${renderGlobalCall(catalog, "addCommsReply", [
      str(reply.text),
      raw(callback),
    ])}`;

    if (reply.conditions.length === 0) {
      lines.push(call);
      return;
    }
    // A guarded reply is simply not offered. EE has no "disabled button",
    // and a visible option that answers "you cannot do that" teaches the
    // crew the option exists — sometimes wanted, but that is a node, not a
    // condition.
    const guard = reply.conditions.map((condition) => `(${emit.predicate(condition)})`).join(" and ");
    lines.push(`  if ${guard} then`);
    lines.push(indent(call, "  "));
    lines.push("  end");
  });

  lines.push("end");
  return lines.join("\n");
}

/**
 * The `require` a project needs when a reply hands off to EE's own station
 * menu.
 *
 * `comms_station.lua` is a **comms script**, and a comms script's body is
 * its own entry point: the file ends with
 * `commsStationMainMenu(comms_source, comms_target)`. Loading it from a
 * scenario therefore defines every function it declares and *then* raises
 * on that trailing call, because those globals are nil outside a hail
 * (probed 2026-08-16). The `pcall` swallows exactly that, and the
 * definitions are already in place because the call is the last line.
 */
export function stationServicesPrelude(): string {
  return `-- EE's stock station menu, for replies that hand off to it.
-- comms_station.lua is a comms script: its body ends by calling
-- commsStationMainMenu(comms_source, comms_target), which fails outside a
-- hail. The pcall absorbs that; the definitions above it have already run.
pcall(require, "comms_station.lua")`;
}

function indent(block: string, pad: string): string {
  return block
    .split("\n")
    .map((line) => (line === "" ? line : `${pad}${line}`))
    .join("\n");
}
