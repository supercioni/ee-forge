import { describe, expect, it } from "vitest";
import {
  clamp,
  displayText,
  editFor,
  isOutOfRange,
  stepBy,
} from "../src/ui/number-field.js";

/**
 * The rule that makes a negative coordinate typable: a field must be able
 * to hold text that is not a number yet, without writing anything to the
 * document.
 */

describe("what a field's text commits", () => {
  it("commits a complete number", () => {
    expect(editFor("13000", false)).toEqual({ kind: "commit", value: 13000 });
    expect(editFor("-13000", false)).toEqual({ kind: "commit", value: -13000 });
    expect(editFor("0.5", false)).toEqual({ kind: "commit", value: 0.5 });
    expect(editFor("  42  ", false)).toEqual({ kind: "commit", value: 42 });
  });

  it("holds the states you pass through on the way to one", () => {
    // This is the bug: `Number("-")` is NaN and `Number("")` is 0, so the
    // old field turned the first keystroke of -13000 into a zero.
    for (const partial of ["-", "+", ".", "1e", "-.", "1.2.3", "abc"]) {
      expect(editFor(partial, false), partial).toEqual({ kind: "hold" });
    }
  });

  it("keeps a trailing dot typable", () => {
    // "1." is a number to JS, and holding the draft is what lets the next
    // keystroke make it 1.5 instead of the field snapping back to 1.
    expect(editFor("1.", false)).toEqual({ kind: "commit", value: 1 });
  });

  it("clears only where a field may hold nothing", () => {
    expect(editFor("", true)).toEqual({ kind: "clear" });
    expect(editFor("   ", true)).toEqual({ kind: "clear" });
    // A required field keeps its last value instead of becoming 0.
    expect(editFor("", false)).toEqual({ kind: "hold" });
  });

  it("refuses infinities rather than writing them to the document", () => {
    expect(editFor("Infinity", false)).toEqual({ kind: "hold" });
    expect(editFor("-Infinity", false)).toEqual({ kind: "hold" });
  });

  it("does not read a comma as a decimal point", () => {
    // Tempting for an Italian keyboard, but the same rule would read a
    // plausible "13,000" as 13 — a wrong value is worse than a held one.
    expect(editFor("1,5", false)).toEqual({ kind: "hold" });
  });
});

describe("arrow-key stepping", () => {
  it("steps by the field's own step", () => {
    expect(stepBy(1000, 1, { step: 100 })).toBe(1100);
    expect(stepBy(1000, -1, { step: 100 })).toBe(900);
  });

  it("magnifies with shift, so a map measured in thousands stays usable", () => {
    expect(stepBy(1000, 1, { step: 100, magnify: true })).toBe(2000);
  });

  it("crosses zero into negatives", () => {
    expect(stepBy(50, -1, { step: 100 })).toBe(-50);
  });

  it("starts from the floor when the field is unset", () => {
    expect(stepBy(null, 1, { step: 1 })).toBe(1);
    expect(stepBy(null, 1, { step: 1, min: 10 })).toBe(11);
  });

  it("does not drift on fractional steps", () => {
    // Three presses of 0.05 otherwise land on 0.15000000000000002.
    let value = 0;
    for (let i = 0; i < 3; i += 1) value = stepBy(value, 1, { step: 0.05 });
    expect(value).toBe(0.15);
  });

  it("respects the declared bounds", () => {
    expect(stepBy(1, 1, { step: 0.05, max: 1 })).toBe(1);
    expect(stepBy(0, -1, { step: 1, min: 0 })).toBe(0);
  });
});

describe("bounds", () => {
  it("clamps", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, undefined)).toBe(0);
    expect(clamp(-5, undefined, undefined)).toBe(-5);
  });

  it("flags a typed value the schema would refuse", () => {
    expect(isOutOfRange(-3, 0, undefined)).toBe(true);
    expect(isOutOfRange(2, 0, 1)).toBe(true);
    expect(isOutOfRange(0.5, 0, 1)).toBe(false);
    // An unset nullable field is not an error.
    expect(isOutOfRange(null, 0, 1)).toBe(false);
  });
});

describe("display", () => {
  it("shows an unset field as empty, not as zero", () => {
    expect(displayText(null)).toBe("");
    expect(displayText(0)).toBe("0");
    expect(displayText(-13000)).toBe("-13000");
  });
});
