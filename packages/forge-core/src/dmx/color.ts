import type { EEDmxFixture, EEDmxValue } from "@forge/contracts";

/**
 * Colour as a projection of a fixture's channel levels (ADR-0040).
 *
 * `hardware.ini` has no notion of colour. It has a list of levels, and EE
 * hands the Nth of them to the Nth channel of the target —
 * `values[idx % values.size()]`, so a one-element list means "the same
 * everywhere". A colour is nothing more than three of those levels lined
 * up with the channels an author labelled red, green and blue.
 *
 * So the colour is **never stored**. It is read out of the levels and
 * written back into them, which is why picking a swatch and typing the
 * three numbers cannot drift apart: they are two views of one array.
 */

/** 0-255 per component — the scale `ColorPicker` works in. */
export type DmxRgb = readonly [number, number, number];

/** Which component of a colour a role carries, if any. */
const ROLE_COMPONENT: Readonly<Record<string, 0 | 1 | 2 | undefined>> = {
  red: 0,
  green: 1,
  blue: 2,
};

/**
 * EE's per-channel split: the Nth channel gets the Nth entry, wrapping.
 *
 * The one place that modulo lives. A shorter list is not a list padded
 * with darkness — `value = 1` on an RGB fixture lights all three.
 */
export function slotEntry<T>(list: readonly T[], index: number): T {
  // `.min(1)` on every level list in the schema is what makes this total.
  return list[index % list.length] as T;
}

/** A tagged value as the fraction EE puts on the wire. */
export function dmxLevel(value: EEDmxValue): number {
  return value.format === "float" ? value.value : value.value / 255;
}

/**
 * A fraction back into a value of the given format.
 *
 * Floats are rounded to three decimals: 1/255 is about 0.004, so three
 * decimals round-trip a byte exactly while keeping the ini readable.
 */
export function dmxValueOf(level: number, format: EEDmxValue["format"]): EEDmxValue {
  const clamped = Math.min(Math.max(level, 0), 1);
  if (format === "float") return { format, value: Math.round(clamped * 1000) / 1000 };
  return { format, value: Math.round(clamped * 255) };
}

/** One entry per slot, following EE's wrap — the shape an editor edits. */
export function expandLevels(levels: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => slotEntry(levels, i));
}

/** The same for tagged values, so each slot keeps a format to write back into. */
export function expandValues(values: readonly EEDmxValue[], count: number): EEDmxValue[] {
  return Array.from({ length: count }, (_, i) => slotEntry(values, i));
}

/**
 * Back to the shortest list that means the same thing.
 *
 * Only the all-equal case collapses. Detecting longer repeats would be
 * clever and would rewrite an author's `1, 0, 1, 0` as `1, 0`; it means
 * the same to EE, but it is not what they wrote.
 */
export function collapseLevels(levels: readonly number[]): number[] {
  const first = levels[0];
  if (first === undefined) return [0];
  return levels.every((level) => level === first) ? [first] : [...levels];
}

export function collapseValues(values: readonly EEDmxValue[]): EEDmxValue[] {
  const first = values[0];
  if (first === undefined) return [{ format: "float", value: 0 }];
  const same = values.every(
    (value) => value.format === first.format && value.value === first.value,
  );
  return same ? [first] : [...values];
}

/** Whether a colour can be shown at all — a fixture with no primaries cannot. */
export function hasColorRoles(fixture: EEDmxFixture): boolean {
  return fixture.slots.some((slot) => ROLE_COMPONENT[slot.role] !== undefined);
}

/**
 * The colour a fixture's levels make.
 *
 * A primary no slot carries reads as 0, so an R/G fixture with both up is
 * yellow rather than nothing. Null only when there is no primary at all.
 */
export function fixtureColor(fixture: EEDmxFixture, levels: readonly number[]): DmxRgb | null {
  if (!hasColorRoles(fixture)) return null;
  const rgb: [number, number, number] = [0, 0, 0];
  fixture.slots.forEach((slot, index) => {
    const component = ROLE_COMPONENT[slot.role];
    if (component === undefined) return;
    rgb[component] = Math.round(slotEntry(levels, index) * 255);
  });
  return rgb;
}

/**
 * A colour written into the primaries, leaving every other slot alone.
 *
 * White and intensity are real channels but not part of the mix, so
 * picking a colour never touches them — they keep their own control.
 */
export function withFixtureColor(
  fixture: EEDmxFixture,
  levels: readonly number[],
  rgb: DmxRgb,
): number[] {
  const next = expandLevels(levels, fixture.slots.length);
  fixture.slots.forEach((slot, index) => {
    const component = ROLE_COMPONENT[slot.role];
    if (component === undefined) return;
    next[index] = Math.min(Math.max(rgb[component] / 255, 0), 1);
  });
  return collapseLevels(next);
}

/** The colour of a static effect's tagged values. */
export function fixtureValueColor(
  fixture: EEDmxFixture,
  values: readonly EEDmxValue[],
): DmxRgb | null {
  return fixtureColor(fixture, expandValues(values, fixture.slots.length).map(dmxLevel));
}

/** The same colour write, each slot keeping the format the author chose. */
export function withFixtureValueColor(
  fixture: EEDmxFixture,
  values: readonly EEDmxValue[],
  rgb: DmxRgb,
): EEDmxValue[] {
  const expanded = expandValues(values, fixture.slots.length);
  const levels = withFixtureColor(fixture, expanded.map(dmxLevel), rgb);
  return collapseValues(
    expanded.map((value, index) => dmxValueOf(slotEntry(levels, index), value.format)),
  );
}

/**
 * `virtual_types` for EE's on-screen renderer, derived from the roles.
 *
 * One letter per DMX channel from 1 up to the highest any fixture claims;
 * anything that is not a primary is `W`, which is EE's own default. Empty
 * when no fixture has a colour role, so the line is simply not written.
 */
export function virtualTypesFor(fixtures: readonly EEDmxFixture[]): string {
  const letters = new Map<number, string>();
  let highest = 0;
  for (const fixture of fixtures) {
    for (const slot of fixture.slots) {
      highest = Math.max(highest, slot.channel);
      const component = ROLE_COMPONENT[slot.role];
      if (component !== undefined) letters.set(slot.channel, "RGB"[component] as string);
    }
  }
  if (letters.size === 0) return "";
  return Array.from({ length: highest }, (_, i) => letters.get(i + 1) ?? "W").join("");
}

/** The role a `virtual_types` letter means, for the import path. */
export function roleOfVirtualType(letter: string): "red" | "green" | "blue" | "white" {
  switch (letter.toUpperCase()) {
    case "R":
      return "red";
    case "G":
      return "green";
    case "B":
      return "blue";
    default:
      return "white";
  }
}
