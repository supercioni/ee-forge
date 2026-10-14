import { describe, expect, it } from "vitest";
import { clampColumn, clampPanelWidth, DMX_PREVIEW, MAP_LEFT, MAP_RIGHT, NARRATIVE_RIGHT, PANEL_DEFAULT, PANEL_MIN, PANEL_RESERVED, SHIP_DIAGRAMS, SHIP_LISTS } from "../src/ui/split.js";

/**
 * The Ship view's diagram column is draggable because the arcs, the deck
 * plan and the 3D likeness are all `viewBox`-drawn — the column's width is
 * their zoom. The clamp is what stops a drag from making the view
 * unusable, in either direction.
 */
describe("clampPanelWidth", () => {
  const WIDE = 1920;

  it("leaves a sensible width alone", () => {
    expect(clampPanelWidth(PANEL_DEFAULT, WIDE)).toBe(PANEL_DEFAULT);
    expect(clampPanelWidth(700, WIDE)).toBe(700);
  });

  it("never lets the diagrams shrink below readable", () => {
    expect(clampPanelWidth(10, WIDE)).toBe(PANEL_MIN);
    expect(clampPanelWidth(-500, WIDE)).toBe(PANEL_MIN);
  });

  it("always leaves room for the lists and the form", () => {
    // Dragging the handle past the left edge must not swallow the form.
    expect(clampPanelWidth(5000, WIDE)).toBe(WIDE - PANEL_RESERVED);
    expect(clampPanelWidth(5000, WIDE)).toBeLessThan(WIDE);
  });

  it("keeps the panel grabbable on a window too narrow for both bounds", () => {
    // 700px cannot satisfy min-width AND the reserved space. A panel of
    // zero width has no handle left to drag back, so the minimum wins.
    const narrow = clampPanelWidth(PANEL_DEFAULT, 700);
    expect(narrow).toBe(PANEL_MIN);
    expect(narrow).toBeGreaterThan(0);
  });

  it("returns whole pixels", () => {
    expect(clampPanelWidth(340.7, WIDE)).toBe(341);
    expect(Number.isInteger(clampPanelWidth(500.5, WIDE))).toBe(true);
  });
});

describe("clampColumn — the columns of every view", () => {
  const WIDE = 1920;
  it("keeps each column within its own limits", () => {
    for (const spec of [MAP_LEFT, MAP_RIGHT, NARRATIVE_RIGHT, SHIP_LISTS, DMX_PREVIEW, SHIP_DIAGRAMS]) {
      expect(clampColumn(1, spec, WIDE), "min").toBe(spec.min);
      expect(clampColumn(spec.default, spec, WIDE), "default").toBe(spec.default);
      expect(clampColumn(99999, spec, WIDE), "max").toBe(WIDE - spec.reserved);
    }
  });
  it("leaves every column grabbable on a narrow window (the minimum wins)", () => {
    for (const spec of [MAP_LEFT, MAP_RIGHT, NARRATIVE_RIGHT, SHIP_LISTS, DMX_PREVIEW]) expect(clampColumn(500, spec, 600)).toBe(spec.min);
  });
  it("is the same rule as the ship's original clamp", () => {
    for (const w of [10, 340, 700, 5000]) expect(clampColumn(w, SHIP_DIAGRAMS, WIDE)).toBe(clampPanelWidth(w, WIDE));
  });
});
