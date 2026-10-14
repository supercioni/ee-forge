import type { EEPointRef, EEProject, Vec2 } from "@forge/contracts";
import { markerIndex, resolvePoint } from "../points.js";
import { CodegenError } from "./lua.js";

/**
 * Turning a place into the coordinates the emitters write.
 *
 * Both generated files need this — the map emits wormhole exits, probe
 * targets and defend-location orders, the scenario emits proximity
 * triggers and order actions — so it lives beside neither of them.
 *
 * The rule (ADR-0038): a marker never reaches EmptyEpsilon. It is resolved
 * here and the Lua carries literal numbers, exactly as it did before
 * markers existed.
 */

export interface PlaceResolver {
  (ref: EEPointRef, where: string): Vec2;
}

/**
 * A resolver bound to one project's markers.
 *
 * Built once per file rather than per reference, and it takes `where` at
 * the call site so the error names the record that holds the bad
 * reference — "wormhole \"gate_a\" exit" is actionable, "unknown marker"
 * is a hunt.
 */
export function placeResolver(project: EEProject): PlaceResolver {
  const markers = markerIndex(project.map.markers);
  return (ref, where) => {
    const point = resolvePoint(markers, ref);
    if (point === null) {
      const id = ref.ref === "marker" ? ref.markerId : "?";
      throw new CodegenError(
        `${where} refers to marker "${id}", which this project does not define`,
      );
    }
    return point;
  };
}
