import { describe, expect, it } from "vitest";
import {
  PALETTE_COLUMNS,
  PALETTE_ROWS,
  fromScale,
  hslToRgb,
  paletteColor,
  paletteSwatches,
  sameColor,
  toCss,
  toScale,
} from "../src/ui/palette-colors.js";

/**
 * The picker replaced three numeric boxes, so what it can express — and
 * what it writes back in each of EE's two colour scales — is pinned here.
 */

describe("the grid", () => {
  it("offers 1024 colours", () => {
    expect(PALETTE_ROWS * PALETTE_COLUMNS).toBe(1024);
    expect(paletteSwatches()).toHaveLength(1024);
  });

  it("puts pure black and pure white in the greyscale column", () => {
    expect(paletteColor(0, 0)).toEqual([0, 0, 0]);
    expect(paletteColor(PALETTE_ROWS - 1, 0)).toEqual([255, 255, 255]);
  });

  it("keeps the greyscale column grey all the way up", () => {
    for (let row = 0; row < PALETTE_ROWS; row += 1) {
      const [r, g, b] = paletteColor(row, 0);
      expect([r, g, b], `row ${row}`).toEqual([r, r, r]);
    }
  });

  it("contains a true primary, not an approximation of one", () => {
    // Row 15 is exactly 50% lightness at full saturation, which is what
    // makes #ff0000 reachable rather than nearly reachable.
    expect(paletteColor(15, 1)).toEqual([255, 0, 0]);
  });

  it("spans the hue circle across the colour columns", () => {
    const hues = new Set<string>();
    for (let column = 1; column < PALETTE_COLUMNS; column += 1) {
      hues.add(toCss(paletteColor(15, column)));
    }
    expect(hues.size).toBe(PALETTE_COLUMNS - 1);
  });

  it("darkens upward and lightens downward", () => {
    const sum = (row: number): number =>
      paletteColor(row, 5).reduce((total, channel) => total + channel, 0);
    expect(sum(0)).toBeLessThan(sum(15));
    expect(sum(15)).toBeLessThan(sum(PALETTE_ROWS - 1));
  });
});

describe("hsl conversion", () => {
  it("hits the corners", () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
    expect(hslToRgb(0, 0, 1)).toEqual([255, 255, 255]);
    expect(hslToRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it("wraps the hue circle", () => {
    expect(hslToRgb(360, 1, 0.5)).toEqual(hslToRgb(0, 1, 0.5));
    expect(hslToRgb(-60, 1, 0.5)).toEqual(hslToRgb(300, 1, 0.5));
  });
});

describe("EE's two colour scales", () => {
  it("reads a 0..255 triple as itself", () => {
    expect(fromScale([255, 128, 0], 255)).toEqual([255, 128, 0]);
  });

  it("reads a 0..1 triple — the planet atmosphere scale", () => {
    expect(fromScale([1, 0.5, 0], 1)).toEqual([255, 128, 0]);
  });

  it("writes back in the field's own scale", () => {
    expect(toScale([255, 128, 0], 255)).toEqual([255, 128, 0]);
    expect(toScale([255, 128, 0], 1)).toEqual([1, 0.502, 0]);
  });

  it("survives the round trip in both scales", () => {
    for (const rgb of paletteSwatches()) {
      expect(fromScale(toScale(rgb, 255), 255), toCss(rgb)).toEqual(rgb);
      expect(fromScale(toScale(rgb, 1), 1), toCss(rgb)).toEqual(rgb);
    }
  });

  it("clamps a value a hand-edited project put out of range", () => {
    expect(fromScale([300, -20, 0], 255)).toEqual([255, 0, 0]);
    expect(fromScale([2, -1, 0.5], 1)).toEqual([255, 0, 128]);
  });

  it("refuses a triple that isn't one", () => {
    expect(fromScale([1, 2], 255)).toBeNull();
  });
});

describe("display and comparison", () => {
  it("formats as hex", () => {
    expect(toCss([0, 0, 0])).toBe("#000000");
    expect(toCss([255, 128, 0])).toBe("#ff8000");
  });

  it("compares, treating unset as its own value", () => {
    expect(sameColor([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(sameColor([1, 2, 3], [1, 2, 4])).toBe(false);
    expect(sameColor(null, null)).toBe(true);
    expect(sameColor(null, [0, 0, 0])).toBe(false);
  });
});
