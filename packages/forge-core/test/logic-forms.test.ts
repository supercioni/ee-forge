import { describe, expect, it } from "vitest";
import {
  EEActionSchema,
  EEPredicateSchema,
  type EEAction,
  type EEPredicate,
} from "@forge/contracts";
import {
  ACTION_SPECS,
  PREDICATE_SPECS,
  describePredicate,
  describeTargetRef,
  emptyAction,
  emptyPredicate,
  isExodusAction,
} from "../src/editor/logic-forms.js";
import { describeAction } from "../src/logic/simulate.js";

/**
 * The narrative editor renders its forms from these descriptors, so a kind
 * the schema has and the descriptors don't is a kind nobody can author.
 * These tests are the mechanical version of remembering to add one.
 */

/** Every `kind` literal the union accepts, read off the schema itself. */
function unionKinds(schema: typeof EEPredicateSchema | typeof EEActionSchema): string[] {
  return schema.options.map((option) => {
    const shape = option.shape as { kind: { value: string } };
    return shape.kind.value;
  });
}

describe("descriptor coverage", () => {
  it("describes every predicate the schema accepts, and no more", () => {
    expect([...PREDICATE_SPECS.map((s) => s.kind)].sort()).toEqual(
      unionKinds(EEPredicateSchema).sort(),
    );
  });

  it("describes every action the schema accepts, and no more", () => {
    expect([...ACTION_SPECS.map((s) => s.kind)].sort()).toEqual(
      unionKinds(EEActionSchema).sort(),
    );
  });

  it("gives every kind a human label and a palette group", () => {
    for (const spec of [...PREDICATE_SPECS, ...ACTION_SPECS]) {
      expect(spec.label, spec.kind).not.toBe("");
      expect(spec.group, spec.kind).not.toBe("");
    }
  });

  it("names only fields the record actually has", () => {
    // A descriptor for a key the schema doesn't carry would render a
    // control that writes into nothing.
    for (const spec of PREDICATE_SPECS) {
      const value = emptyPredicate(spec.kind) as unknown as Record<string, unknown>;
      for (const field of spec.fields) {
        expect(Object.keys(value), `${spec.kind}.${field.key}`).toContain(field.key);
      }
    }
    for (const spec of ACTION_SPECS) {
      const value = emptyAction(spec.kind) as unknown as Record<string, unknown>;
      for (const field of spec.fields) {
        expect(Object.keys(value), `${spec.kind}.${field.key}`).toContain(field.key);
      }
    }
  });

  it("covers every field of the record, so nothing is unreachable", () => {
    for (const spec of PREDICATE_SPECS) {
      const keys = Object.keys(emptyPredicate(spec.kind)).filter((k) => k !== "kind");
      expect(spec.fields.map((f) => f.key).sort(), spec.kind).toEqual(keys.sort());
    }
    for (const spec of ACTION_SPECS) {
      const keys = Object.keys(emptyAction(spec.kind)).filter((k) => k !== "kind");
      expect(spec.fields.map((f) => f.key).sort(), spec.kind).toEqual(keys.sort());
    }
  });
});

describe("factories", () => {
  it("produces a schema-valid predicate for every kind", () => {
    for (const spec of PREDICATE_SPECS) {
      const parsed = EEPredicateSchema.safeParse(emptyPredicate(spec.kind));
      expect(parsed.success, `${spec.kind}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });

  it("produces a schema-valid action for every kind", () => {
    for (const spec of ACTION_SPECS) {
      const parsed = EEActionSchema.safeParse(emptyAction(spec.kind));
      expect(parsed.success, `${spec.kind}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });

  it("gives every EE order its own action, and no more", () => {
    // One action per `CpuShip:order*` method. A method added to EE — or an
    // action added here — shows up as a mismatch rather than as an order
    // nobody can give.
    const orders = ACTION_SPECS.filter((s) => s.group === "Orders").map((s) => s.kind);
    expect(orders.sort()).toEqual(
      [
        "order_attack",
        "order_defend_location",
        "order_defend_target",
        "order_dock",
        "order_fly_formation",
        "order_fly_towards",
        "order_fly_towards_blind",
        "order_idle",
        "order_retreat",
        "order_roaming",
        "order_roaming_at",
        "order_stand_ground",
      ].sort(),
    );
  });

  it("keeps the one order that needs both an object and a point expressible", () => {
    // orderFlyFormation(object, offset_x, offset_y) is what the old flat
    // shape could not say: it offered a position OR an object.
    const formation = emptyAction("order_fly_formation") as Extract<
      EEAction,
      { kind: "order_fly_formation" }
    >;
    expect(formation.leaderId).not.toBe("");
    expect(formation.offset).toEqual({ x: 800, y: 0 });
    expect(EEActionSchema.safeParse(formation).success).toBe(true);
  });
});

describe("the exodus tier stays opt-in", () => {
  it("flags exactly the actions that need the capability", () => {
    for (const spec of ACTION_SPECS) {
      expect(isExodusAction(spec.kind), spec.kind).toBe(spec.group === "EXODUS");
    }
  });

  // The build's refusal of an undeclared exodus action is pinned in
  // codegen.test.ts ("refuses an exodus action when the tier is not
  // declared"); the editor greys them out on top of that, not instead.
});

describe("one-line readings", () => {
  it("says something for every predicate", () => {
    for (const spec of PREDICATE_SPECS) {
      expect(describePredicate(emptyPredicate(spec.kind)), spec.kind).not.toBe("");
    }
  });

  it("says something for every action", () => {
    for (const spec of ACTION_SPECS) {
      expect(describeAction(emptyAction(spec.kind)), spec.kind).not.toBe("");
    }
  });

  it("names an empty reference rather than rendering a blank", () => {
    expect(describeTargetRef({ ref: "player" })).toContain("player");
    expect(describeTargetRef({ ref: "object", objectId: "" })).toBe("(no object)");
    expect(describeTargetRef({ ref: "group", groupId: "" })).toBe("(no group)");
    expect(describePredicate({ kind: "object_destroyed", objectId: "" })).toContain("(no object)");
  });
});

describe("predicates carry sane starting values", () => {
  it("never starts a distance or a time at something meaningless", () => {
    const near = emptyPredicate("player_near_object") as Extract<
      EEPredicate,
      { kind: "player_near_object" }
    >;
    expect(near.distance).toBeGreaterThan(0);
    const elapsed = emptyPredicate("elapsed") as Extract<EEPredicate, { kind: "elapsed" }>;
    expect(elapsed.seconds).toBeGreaterThan(0);
  });
});
