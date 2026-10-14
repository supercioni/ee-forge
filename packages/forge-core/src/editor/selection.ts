import type { EEMapGroup, EEMarker, Vec2 } from "@forge/contracts";

/**
 * Rubber-band selection.
 *
 * The rule is **centre-in-rectangle**: an object is caught when its own
 * position falls inside the band, not when its footprint overlaps it. That
 * is the predictable answer — dragging a band across a belt takes exactly
 * the rocks whose centres you swept — and it avoids the surprise of a
 * 30 U planet joining the selection because the band clipped its edge
 * twenty screens away.
 *
 * Lives here rather than in the canvas component because it is a rule, and
 * a rule implemented only in a React component is a rule the tests cannot
 * see (`packages/web-forge/CLAUDE.md`).
 */

export interface WorldRect {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Normalised rectangle between two dragged corners, in world units. */
export function rectBetween(a: Vec2, b: Vec2): WorldRect {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
  };
}

/**
 * Ids of every object whose centre lies in `rect`.
 *
 * Searches all groups, not just the active one: the band selects what the
 * author can see, and the canvas draws every group.
 */
export function objectsInRect(
  groups: readonly EEMapGroup[],
  rect: WorldRect,
): readonly string[] {
  const found: string[] = [];
  for (const group of groups) {
    for (const object of group.objects) {
      const { x, y } = object.position;
      if (x >= rect.min.x && x <= rect.max.x && y >= rect.min.y && y <= rect.max.y) {
        found.push(object.id);
      }
    }
  }
  return found;
}

/**
 * Ids of every marker whose position lies in `rect`.
 *
 * Separate from {@link objectsInRect} because markers live beside the
 * groups, not in one (ADR-0038) — and because the canvas has to know which
 * of the two a caught id belongs to before it can move or delete it.
 */
export function markersInRect(
  markers: readonly EEMarker[],
  rect: WorldRect,
): readonly string[] {
  return markers
    .filter(
      (marker) =>
        marker.position.x >= rect.min.x &&
        marker.position.x <= rect.max.x &&
        marker.position.y >= rect.min.y &&
        marker.position.y <= rect.max.y,
    )
    .map((marker) => marker.id);
}

/**
 * The selection a band produces: its catch, or the union with what was
 * already selected when the author held Shift.
 */
export function applyMarquee(
  current: readonly string[],
  caught: readonly string[],
  additive: boolean,
): readonly string[] {
  if (!additive) return caught;
  return [...new Set([...current, ...caught])];
}
