import { describe, expect, it } from "vitest";
import { wrapTarget } from "../src/ui/focus.js";

describe("wrapTarget — where Tab goes inside a dialog", () => {
  it("leaves the browser's own step alone in the middle", () => {
    expect(wrapTarget(5, 2, false)).toBeNull();
    expect(wrapTarget(5, 2, true)).toBeNull();
  });
  it("wraps forward from the last stop to the first", () => {
    expect(wrapTarget(5, 4, false)).toBe(0);
  });
  it("wraps backward from the first stop to the last", () => {
    expect(wrapTarget(5, 0, true)).toBe(4);
  });
  it("pulls focus back in when it is somewhere else", () => {
    expect(wrapTarget(5, -1, false)).toBe(0);
    expect(wrapTarget(5, -1, true)).toBe(4);
  });
  it("a single stop wraps onto itself in both directions", () => {
    expect(wrapTarget(1, 0, false)).toBe(0);
    expect(wrapTarget(1, 0, true)).toBe(0);
  });
  it("has nothing to do when there are no stops", () => {
    expect(wrapTarget(0, -1, false)).toBeNull();
  });
});
