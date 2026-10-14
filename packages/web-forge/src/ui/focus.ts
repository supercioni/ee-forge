/**
 * Keyboard focus rules for a modal dialog, kept free of the DOM so they can be tested.
 *
 * A dialog that says `aria-modal` has to keep its promise: Tab never reaches what is behind it, Escape means
 * the same thing as Cancel, and closing hands the focus back to whatever opened it. `Modal` does the DOM work;
 * this module answers the one question that is pure arithmetic — where does Tab go next?
 */

/** What a person can reach with Tab inside a dialog. Disabled controls and `tabindex="-1"` are not stops. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where the dialog must move focus by hand on a Tab press, or `null` when the browser's own step is right.
 *
 * `count` is the number of tab stops in the dialog and `current` the index of the focused one (`-1` when
 * focus is somewhere else). Wrapping is done by hand only at the two ends — everywhere else the native order
 * (which respects `tabindex` and radio groups) is left alone.
 */
export function wrapTarget(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (!shift && current === count - 1) return 0;
  if (shift && current === 0) return count - 1;
  return null;
}
