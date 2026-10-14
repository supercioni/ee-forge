/**
 * How wide a side panel is allowed to be.
 *
 * The Ship view's right column holds the firing arcs, the deck plan and
 * the 3D likeness — all three drawn from a `viewBox`, so they are exactly
 * as readable as the column is wide. Making that column draggable is the
 * whole point, and the only thing a drag must not be allowed to do is
 * leave nothing behind: a form squeezed to nothing is a worse tool than a
 * small diagram, and a panel dragged past the window edge cannot be
 * dragged back.
 *
 * Pure and tested, like `popover-position.ts`, because the clamping is the
 * behaviour and a pointer-move handler can only be clicked at.
 */

/** Narrower than this and the arc diagram stops being a diagram. */
export const PANEL_MIN = 240;

/** What the drag must always leave for the lists and the form. */
export const PANEL_RESERVED = 260 + 300;

/** The width the column opens at, and returns to on a double-click. */
export const PANEL_DEFAULT = 340;

/**
 * Clamp a proposed width into what the window can actually hold.
 *
 * On a viewport too narrow to satisfy both bounds the minimum wins: a
 * cramped diagram beside a cramped form is recoverable, a column of zero
 * width has no handle left to grab.
 */
export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN, viewportWidth - PANEL_RESERVED);
  return Math.round(Math.min(Math.max(width, PANEL_MIN), max));
}

/**
 * A resizable side column: how narrow it may get, where it opens (and returns to on a double-click), and how much of the
 * window the rest of the view needs. Every view's columns (map, narrative, ship, DMX) are described this way, so one
 * clamp — and one test — covers them all.
 */
export interface ColumnSpec {
  readonly min: number;
  readonly default: number;
  /** What the other columns and the centre need, in px. */
  readonly reserved: number;
}

/** Same rule as {@link clampPanelWidth}: the minimum wins on a window too narrow for both bounds. */
export function clampColumn(width: number, spec: ColumnSpec, viewportWidth: number): number {
  const max = Math.max(spec.min, viewportWidth - spec.reserved);
  return Math.round(Math.min(Math.max(width, spec.min), max));
}

export const SHIP_DIAGRAMS: ColumnSpec = { min: PANEL_MIN, default: PANEL_DEFAULT, reserved: PANEL_RESERVED };
export const SHIP_LISTS: ColumnSpec = { min: 180, default: 260, reserved: 340 + 300 };
export const MAP_LEFT: ColumnSpec = { min: 180, default: 300, reserved: 320 + 6 + 6 + 320 };
export const MAP_RIGHT: ColumnSpec = { min: 220, default: 320, reserved: 300 + 6 + 6 + 320 };
export const NARRATIVE_RIGHT: ColumnSpec = { min: 240, default: 380, reserved: 360 };
export const DMX_PREVIEW: ColumnSpec = { min: 260, default: 360, reserved: 420 };
