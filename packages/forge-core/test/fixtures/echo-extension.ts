import type { ForgeExtension } from "../../src/extensions.js";
import { jsonToLua, luaString, renderValue, str } from "../../src/codegen/lua.js";
import type { EEAction } from "@forge/contracts";

/**
 * A minimal extension for testing the core's extension plumbing without the
 * real one (which lives in `@forge/exodus` and cannot be imported here).
 * Emits plain `bridge:` calls, unguarded.
 */
const call = (method: string, ...args: string[]): string => `bridge:${method}(${args.join(", ")})`;

export const echoExtension: ForgeExtension = {
  id: "exodus",
  label: "echo",
  protocol: "0.0.0",
  capabilities: ["any"],
  owns: (action: EEAction) => action.kind.startsWith("exodus_"),
  describe: (action: EEAction) => ({ capability: "any", hasOutcome: action.kind === "exodus_puzzle" }),
  scenarioPrelude: () => `require("exodus_bridge.lua")`,
  initStatements: (context) => `  bridge:scenario_started(${luaString(context.project.id)})\n`,
  updateStatements: () => "",
  emitAction(action) {
    switch (action.kind) {
      case "exodus_event":
        return call("emit", renderValue(str(action.eventType)), renderValue(jsonToLua(action.payload)));
      case "exodus_lore":
        return call("lore_drop", renderValue(str(action.fragmentId)));
      case "exodus_puzzle":
        return call("request_puzzle", renderValue(str(action.puzzleId)));
      case "exodus_set_state":
        return call("set_state", renderValue(str(action.key)), renderValue(str(action.value)));
      case "exodus_complete_chapter":
        return call("complete_chapter");
      case "exodus_encrypted_comms":
        return call("emit_encrypted_comms", renderValue(str(action.channel)), renderValue(str(action.from)), renderValue(str(action.text)));
      default:
        return call("request_action", renderValue(str("x")));
    }
  },
};
