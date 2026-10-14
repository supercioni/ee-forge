import { describe, expect, it } from "vitest";
import { EELogicSchema, type EELogic } from "@forge/contracts";
import {
  addAction,
  addCondition,
  moveAction,
  readRecord,
  removeAction,
  removeCondition,
  setField,
  writeRecord,
  type LogicPath,
} from "../src/editor/logic-edits.js";
import { emptyAction, emptyPredicate } from "../src/editor/logic-forms.js";

/**
 * These are the operations every control in the narrative panels writes
 * through, including the "pick it on the map" flow. A wrong copy here
 * corrupts a document silently, which is exactly the failure a test is
 * worth having for.
 */

function logic(): EELogic {
  return {
    variables: [],
    beats: [
      {
        id: "trap",
        label: "The trap",
        at: 120,
        actions: [
          { kind: "banner", text: "Contacts" },
          { kind: "spawn_group", groupId: "ambush" },
        ],
      },
    ],
    rules: [
      {
        id: "cleared",
        label: "Cleared",
        when: { kind: "group_destroyed", groupId: "ambush" },
        conditions: [{ kind: "player_hull_below", fraction: 0.5 }],
        once: true,
        actions: [{ kind: "victory", faction: "Human Navy" }],
      },
    ],
    gmButtons: [{ id: "force", label: "Force", actions: [] }],
  };
}

const beatAction = (index: number): LogicPath => ({
  owner: { kind: "beat", id: "trap" },
  target: { slot: "action", index },
});
const ruleWhen: LogicPath = {
  owner: { kind: "rule", id: "cleared" },
  target: { slot: "when" },
};
const ruleCondition = (index: number): LogicPath => ({
  owner: { kind: "rule", id: "cleared" },
  target: { slot: "condition", index },
});

describe("reading a path", () => {
  it("finds an action, a trigger and a guard", () => {
    expect(readRecord(logic(), beatAction(1))).toEqual({ kind: "spawn_group", groupId: "ambush" });
    expect(readRecord(logic(), ruleWhen)).toEqual({ kind: "group_destroyed", groupId: "ambush" });
    expect(readRecord(logic(), ruleCondition(0))).toEqual({
      kind: "player_hull_below",
      fraction: 0.5,
    });
  });

  it("returns null rather than throwing for a path to nothing", () => {
    expect(readRecord(logic(), beatAction(9))).toBeNull();
    expect(
      readRecord(logic(), { owner: { kind: "beat", id: "trap" }, target: { slot: "when" } }),
    ).toBeNull();
    expect(
      readRecord(logic(), { owner: { kind: "rule", id: "gone" }, target: { slot: "when" } }),
    ).toBeNull();
  });
});

describe("writing a field", () => {
  it("changes only the field it was given", () => {
    const next = setField(logic(), beatAction(0), "text", "Contacts!");
    expect(readRecord(next, beatAction(0))).toEqual({ kind: "banner", text: "Contacts!" });
    // Its neighbour is untouched.
    expect(readRecord(next, beatAction(1))).toEqual(readRecord(logic(), beatAction(1)));
  });

  it("leaves the original document alone", () => {
    const before = logic();
    setField(before, ruleWhen, "groupId", "other");
    expect(before.rules[0]?.when).toEqual({ kind: "group_destroyed", groupId: "ambush" });
  });

  it("keeps the result schema-valid", () => {
    const next = setField(logic(), ruleCondition(0), "fraction", 0.25);
    expect(EELogicSchema.safeParse(next).success).toBe(true);
  });

  it("is a no-op for a path to nothing", () => {
    const before = logic();
    expect(setField(before, beatAction(9), "text", "x")).toEqual(before);
  });

  it("answers a map pick the same way any other edit is applied", () => {
    // This is the whole "click the object instead of typing its id" flow:
    // the form states the path, the canvas supplies the value.
    const next = setField(logic(), ruleWhen, "groupId", "second_wave");
    expect(readRecord(next, ruleWhen)).toEqual({
      kind: "group_destroyed",
      groupId: "second_wave",
    });
  });
});

describe("swapping a record's kind", () => {
  it("replaces the shape rather than merging it", () => {
    // A different kind is a different record; merging would leave the old
    // kind's keys behind and produce something the schema refuses.
    const next = writeRecord(logic(), ruleWhen, emptyPredicate("player_hull_below"));
    expect(readRecord(next, ruleWhen)).toEqual({ kind: "player_hull_below", fraction: 0.5 });
    expect(EELogicSchema.safeParse(next).success).toBe(true);
  });
});

describe("action lists", () => {
  it("appends, removes and keeps the rest in order", () => {
    const added = addAction(logic(), { kind: "beat", id: "trap" }, emptyAction("pause_game"));
    expect(added.beats[0]?.actions).toHaveLength(3);
    const removed = removeAction(added, { kind: "beat", id: "trap" }, 0);
    expect(removed.beats[0]?.actions.map((a) => a.kind)).toEqual(["spawn_group", "pause_game"]);
  });

  it("reorders, because order is meaning", () => {
    const moved = moveAction(logic(), { kind: "beat", id: "trap" }, 1, -1);
    expect(moved.beats[0]?.actions.map((a) => a.kind)).toEqual(["spawn_group", "banner"]);
  });

  it("refuses to move off either end", () => {
    const owner = { kind: "beat", id: "trap" } as const;
    expect(moveAction(logic(), owner, 0, -1)).toEqual(logic());
    expect(moveAction(logic(), owner, 1, 1)).toEqual(logic());
  });

  it("works the same for a GM button's actions", () => {
    const added = addAction(logic(), { kind: "gmButton", id: "force" }, emptyAction("banner"));
    expect(added.gmButtons[0]?.actions).toHaveLength(1);
  });
});

describe("rule guards", () => {
  it("adds and removes conditions without touching the trigger", () => {
    const added = addCondition(logic(), { kind: "rule", id: "cleared" }, emptyPredicate("always"));
    expect(added.rules[0]?.conditions).toHaveLength(2);
    expect(added.rules[0]?.when).toEqual(logic().rules[0]?.when);
    const removed = removeCondition(added, { kind: "rule", id: "cleared" }, 0);
    expect(removed.rules[0]?.conditions).toEqual([{ kind: "always" }]);
  });
});
