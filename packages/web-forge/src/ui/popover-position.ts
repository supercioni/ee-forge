/**
 * Where a popover goes when it is positioned against the viewport.
 *
 * Pulled out of `ColorPicker` because the two panels it opens in are hard
 * to reproduce by hand — one is 920px wide with room to the right, the
 * other is a 320px inspector flush against the window edge — and the
 * arithmetic is the whole behaviour. A pure function can be pinned; a
 * layout effect can only be clicked at.
 *
 * Both panels scroll, and a box that scrolls on one axis clips on the
 * other, so an absolutely positioned popover was trapped inside the
 * narrow one. Fixed coordinates escape that, at the price of having to
 * do this clamping ourselves.
 */

export interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Kept clear of every window edge. */
const MARGIN = 8;

/** Gap between the field and the popover. */
const GAP = 4;

export function placePopover(
  field: Rect,
  popover: { readonly width: number; readonly height: number },
  viewport: Viewport,
): { top: number; left: number } {
  // Grows rightward from the field's left edge, then slides back in when
  // that would run off — which is what happens in the 320px inspector.
  const left = clamp(field.left, viewport.width - popover.width);

  // Below by preference; above when the bottom of the window is closer.
  const below = field.bottom + GAP;
  const preferred =
    below + popover.height > viewport.height - MARGIN
      ? field.top - popover.height - GAP
      : below;

  // Clamped like `left`: an anchor scrolled out of view must not take the
  // popover off screen with it.
  return { top: clamp(preferred, viewport.height - popover.height), left };
}

/**
 * Into `[MARGIN, limit]`, and pinned to `MARGIN` when the popover is
 * larger than the window — better a visible top-left corner than a
 * centred nothing.
 */
function clamp(value: number, limit: number): number {
  return Math.min(Math.max(MARGIN, value), Math.max(MARGIN, limit - MARGIN));
}
