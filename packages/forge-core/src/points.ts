import type { EEMarker, EEPointRef, EEProject, Vec2 } from "@forge/contracts";

/**
 * Resolving a place to coordinates (ADR-0038).
 *
 * A `EEPointRef` is either literal coordinates or the id of a marker that
 * holds them. Markers exist only in the project document — EmptyEpsilon
 * has no such class — so every reference is resolved to numbers before a
 * single line of Lua is written.
 *
 * Lives above both `codegen/` and `logic/` because the emitter and the
 * simulator must agree about where a point is. They are two executors of
 * one model (`packages/forge-core/CLAUDE.md`), and a marker that resolved
 * one way in a dry run and another in the generated scenario would make
 * the simulator worse than useless.
 */

/** Marker id → position, for repeated lookups over one document. */
export function markerIndex(markers: readonly EEMarker[]): ReadonlyMap<string, Vec2> {
  return new Map(markers.map((marker) => [marker.id, marker.position]));
}

/**
 * The coordinates a ref names, or null when it names a marker that does
 * not exist.
 *
 * Null rather than a throw: the emitter turns it into a `CodegenError`
 * naming the marker, while the simulator reports it as a dangling
 * reference and carries on, and neither behaviour belongs to the other.
 */
export function resolvePoint(
  markers: ReadonlyMap<string, Vec2>,
  ref: EEPointRef,
): Vec2 | null {
  return ref.ref === "point" ? ref.position : markers.get(ref.markerId) ?? null;
}

/**
 * Every marker id referenced anywhere in the document that no marker
 * defines.
 *
 * A deep walk keyed on the tagged shape rather than a case per record, for
 * the reason `rename.ts` gives: a field added to the model later is
 * covered the day it is added, and a test walks the schema to prove the
 * list of point-carrying fields is still complete.
 */
export function danglingMarkerIds(project: EEProject): readonly string[] {
  const defined = new Set(project.map.markers.map((marker) => marker.id));
  const missing = new Set<string>();

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["ref"] === "marker" && typeof record["markerId"] === "string") {
      if (!defined.has(record["markerId"])) missing.add(record["markerId"]);
      return;
    }
    for (const item of Object.values(record)) walk(item);
  };

  walk(project.map);
  walk(project.logic);
  return [...missing].sort();
}
