import { describe, expect, it } from "vitest";
import { placePopover } from "../src/ui/popover-position.js";

/**
 * The two real contexts, measured in the running editor:
 *
 *  - the DMX rules panel, 920px wide with the field near the left edge
 *  - the map inspector, 320px wide and flush against the window's right
 *
 * Both scroll, so neither can be reproduced by an absolutely positioned
 * popover — and neither is convenient to click at, which is why the
 * arithmetic is pinned here instead.
 */

const VIEWPORT = { width: 1280, height: 577 };
const GRID = { width: 460, height: 480 };

const field = (left: number, top: number): Parameters<typeof placePopover>[0] => ({
  left,
  top,
  bottom: top + 25,
  width: 88,
  height: 25,
});

describe("placing the colour grid", () => {
  it("opens below and left-aligned when there is room", () => {
    const at = placePopover(field(76, 40), GRID, { width: 1280, height: 1200 });
    expect(at).toEqual({ top: 69, left: 76 });
  });

  it("flips above when the bottom of the window is closer", () => {
    // The DMX case: field at y=298 in a 577px window.
    const at = placePopover(field(76, 298), GRID, VIEWPORT);
    expect(at.top).toBe(8);
    expect(at.top + GRID.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("slides back in from the right edge, for the 320px inspector", () => {
    // A field at x=970 would put a 460px grid at 1430 — off the window.
    const at = placePopover(field(970, 120), GRID, VIEWPORT);
    expect(at.left).toBe(VIEWPORT.width - GRID.width - 8);
    expect(at.left + GRID.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it("stays on screen when its anchor has been scrolled out of view", () => {
    // What the first attempt got wrong: the field was at y=1165 in a
    // 577px window and the grid followed it off the bottom.
    const at = placePopover(field(76, 1165), GRID, VIEWPORT);
    expect(at.top).toBeGreaterThanOrEqual(8);
    expect(at.top + GRID.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it("pins to the corner rather than centring when it cannot fit at all", () => {
    const at = placePopover(field(76, 40), { width: 460, height: 900 }, VIEWPORT);
    expect(at.top).toBe(8);
  });

  it("never places anything against an edge", () => {
    for (const left of [0, 76, 640, 970, 1279]) {
      for (const top of [0, 120, 298, 560, 1165]) {
        const at = placePopover(field(left, top), GRID, VIEWPORT);
        expect(at.left, `left ${left}`).toBeGreaterThanOrEqual(8);
        expect(at.top, `top ${top}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
