/**
 * The 1024 colours an author picks from.
 *
 * Three numeric boxes are a poor way to choose a colour: nobody knows what
 * `(0.35, 0.55, 1)` looks like until it is on screen, and EE's own fields
 * disagree about the scale — a faction or zone colour is 0..255, a planet's
 * atmosphere is 0..1. A grid of swatches removes both problems at once: you
 * point at the colour you want, and the scale is the picker's business.
 *
 * The grid is 32 × 32, laid out so it can be read rather than scanned:
 * column 0 is a greyscale ramp (pure black to pure white), and columns
 * 1..31 are evenly spaced hues, each darkening upward and lightening
 * downward from a fully saturated middle row. Row 15 is therefore the pure
 * hue — `#ff0000` is in the grid exactly, not approximated.
 */

export const PALETTE_COLUMNS = 32;
export const PALETTE_ROWS = 32;

/** A colour in the only representation both EE scales convert through. */
export type Rgb = readonly [number, number, number];

/** Row index whose hues are fully saturated at 50% lightness. */
const PURE_ROW = 15;

/**
 * The colour at one cell.
 *
 * Lightness is deliberately piecewise so that `PURE_ROW` lands on exactly
 * 0.5: a ramp fitted across the whole column would miss it by a hair and
 * put no true primary anywhere in the grid.
 */
export function paletteColor(row: number, column: number): Rgb {
  const lightness =
    row <= PURE_ROW
      ? 0.08 + (row / PURE_ROW) * 0.42
      : 0.5 + ((row - PURE_ROW) / (PALETTE_ROWS - 1 - PURE_ROW)) * 0.45;

  if (column === 0) {
    // The greyscale column spans the full range instead of the hues' —
    // an author asking for black or white means those exactly.
    const level = Math.round((row / (PALETTE_ROWS - 1)) * 255);
    return [level, level, level];
  }

  const hue = ((column - 1) * 360) / (PALETTE_COLUMNS - 1);
  // Saturation holds at full through the dark half and softens toward the
  // light end, where fully saturated pastels read as garish.
  const saturation = lightness <= 0.5 ? 1 : 1 - ((lightness - 0.5) / 0.45) * 0.5;
  return hslToRgb(hue, saturation, lightness);
}

/** Every swatch, row-major — the order the grid renders in. */
export function paletteSwatches(): readonly Rgb[] {
  const swatches: Rgb[] = [];
  for (let row = 0; row < PALETTE_ROWS; row += 1) {
    for (let column = 0; column < PALETTE_COLUMNS; column += 1) {
      swatches.push(paletteColor(row, column));
    }
  }
  return swatches;
}

export function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  // Clamped, not merely rounded: floating-point drift otherwise yields a
  // `-0` for an empty channel, which would reach the generated Lua as one.
  const byte = (channel: number): number =>
    Math.min(255, Math.max(0, Math.round((channel + offset) * 255)));
  return [byte(r), byte(g), byte(b)];
}

export function toCss(rgb: Rgb): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A document value read as bytes.
 *
 * `scale` is the field's own: 255 for the integer triples EE takes for
 * factions, zones and radar traces, 1 for the floats it takes for a
 * planet's atmosphere.
 */
export function fromScale(value: readonly number[], scale: 1 | 255): Rgb | null {
  if (value.length < 3) return null;
  const byte = (index: number): number => {
    const raw = value[index] ?? 0;
    return Math.round(Math.min(1, Math.max(0, raw / scale)) * 255);
  };
  return [byte(0), byte(1), byte(2)];
}

/** A picked colour written back in the field's own scale. */
export function toScale(rgb: Rgb, scale: 1 | 255): [number, number, number] {
  if (scale === 255) return [rgb[0], rgb[1], rgb[2]];
  // Three decimals: enough to survive the round trip through bytes, short
  // enough that the generated Lua stays readable.
  const unit = (c: number): number => Math.round((c / 255) * 1000) / 1000;
  return [unit(rgb[0]), unit(rgb[1]), unit(rgb[2])];
}

export function sameColor(a: Rgb | null, b: Rgb | null): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
