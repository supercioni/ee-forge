/**
 * What a half-typed number means.
 *
 * A native `<input type="number">` cannot hold the states a person passes
 * through while typing one: `-`, `1e`, `1.` all read back as the empty
 * string, indistinguishable from a cleared field. Coercing that with
 * `Number(e.target.value)` turns every keystroke toward a negative number
 * into a `0` — which is exactly what made negative coordinates untypable
 * in the inspector.
 *
 * So the field keeps the author's text as a draft and asks this module
 * what, if anything, to commit to the document. Three answers, and the
 * third is the one that matters: **hold** — the text isn't a number yet,
 * keep it on screen and leave the document alone.
 */

export type NumberEdit =
  /** The text is a complete number; write it to the document. */
  | { readonly kind: "commit"; readonly value: number }
  /** The field was emptied and the field may hold nothing. */
  | { readonly kind: "clear" }
  /** Not a number (yet). Keep the draft, change nothing. */
  | { readonly kind: "hold" };

/**
 * Decide what a field's text should do to the document.
 *
 * Deliberately stricter than `Number()`, which reads `""` as 0 and would
 * silently accept `Infinity`. Note that no locale handling happens here:
 * `1,5` holds rather than committing 1.5, because the same rule would read
 * a plausible `13,000` as 13 — a wrong value is worse than a rejected one.
 */
export function editFor(text: string, nullable: boolean): NumberEdit {
  const trimmed = text.trim();
  if (trimmed === "") return nullable ? { kind: "clear" } : { kind: "hold" };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { kind: "hold" };
  return { kind: "commit", value: parsed };
}

/**
 * The value an arrow key should produce.
 *
 * Stepping is the one genuinely useful thing `type="number"` gave us, so
 * the draft-based field keeps it by hand. Shift multiplies by ten, which
 * is what makes a 1 GU step usable on a map measured in thousands.
 */
export function stepBy(
  value: number | null,
  direction: 1 | -1,
  options: {
    readonly step?: number | undefined;
    readonly magnify?: boolean | undefined;
    readonly min?: number | undefined;
    readonly max?: number | undefined;
  } = {},
): number {
  const step = (options.step ?? 1) * (options.magnify === true ? 10 : 1);
  const base = value ?? options.min ?? 0;
  const next = base + step * direction;
  // Floating-point steps (0.05 on a colour channel) otherwise drift into
  // 0.15000000000000002 after three presses.
  const rounded = Number(next.toPrecision(12));
  return clamp(rounded, options.min, options.max);
}

export function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined,
): number {
  const low = min === undefined ? value : Math.max(value, min);
  return max === undefined ? low : Math.min(low, max);
}

/**
 * Whether a committed value falls outside the field's declared bounds.
 *
 * The field shows this rather than preventing it: a value the schema will
 * reject should be visible while it is being written, not discovered when
 * a save fails.
 */
export function isOutOfRange(
  value: number | null,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (value === null) return false;
  if (min !== undefined && value < min) return true;
  return max !== undefined && value > max;
}

/** The text a field shows for a document value when nothing is being typed. */
export function displayText(value: number | null): string {
  return value === null ? "" : String(value);
}
