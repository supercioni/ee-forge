import type { EELibrary, EEObject } from "@forge/contracts";
import { assetUrl } from "../api/transport.js";

/**
 * EmptyEpsilon's own radar sprites, reused as the editor's map icons.
 *
 * A ship template names its sprite through `ShipTemplate:setRadarTrace`
 * and the install scan records it, so the editor can draw a Phobos T3
 * exactly as Relay will draw it. Inventing a second visual language for
 * the same objects would mean an author learning two.
 *
 * The sprites live in `assets/radar/` (copied from the install, GPLv2,
 * attribution in that directory's README) and are served by the bridge's
 * existing `/assets/` mount. They are white on transparent — EE's own
 * requirement for the setter — which is what lets the canvas tint them
 * per faction with an SVG mask rather than shipping a coloured copy. The
 * colour itself comes from `factionColors` in `geometry.ts`: EE's own
 * `setGMColor`, project overriding install.
 *
 * Types EE draws geometrically rather than as a sprite (planets, nebulae,
 * asteroids, zones) deliberately get **no** icon: the canvas already
 * renders those at their true radius, which carries more information than
 * a glyph would.
 */

/** EE's documented defaults when a template sets no trace of its own. */
const DEFAULT_SHIP_TRACE = "ship.png";
const DEFAULT_STATION_TRACE = "blip.png";

const FIXED_TRACES: Partial<Record<EEObject["type"], string>> = {
  Mine: "mine.png",
  ScanProbe: "probe.png",
  BlackHole: "blackHole.png",
  WormHole: "wormHole.png",
};

/** Sprite filename for an object, or null when a shape says more. */
export function radarIconFor(object: EEObject, library: EELibrary | null): string | null {
  const fixed = FIXED_TRACES[object.type];
  if (fixed !== undefined) return fixed;

  if (object.type === "Artifact") {
    // Artifacts only have a trace when the author gave them one.
    return object.radarTraceIcon;
  }

  if (
    object.type === "CpuShip" ||
    object.type === "PlayerSpaceship" ||
    object.type === "SpaceStation"
  ) {
    const template = library?.templates.find((t) => t.name === object.template);
    return (
      template?.radarTrace ??
      (object.type === "SpaceStation" ? DEFAULT_STATION_TRACE : DEFAULT_SHIP_TRACE)
    );
  }

  return null;
}

/** Icon size in screen pixels — fixed, so markers stay usable at any zoom. */
export function iconSize(object: EEObject): number {
  switch (object.type) {
    case "PlayerSpaceship":
      return 26;
    case "SpaceStation":
      return 24;
    case "CpuShip":
      return 20;
    case "BlackHole":
    case "WormHole":
      return 22;
    default:
      return 14;
  }
}

/**
 * EE renders a ship's trace rotated with the hull, but leaves stationary
 * furniture (stations, wormholes, mines) upright. Matching that keeps the
 * editor legible for the same reason EE does it.
 */
export function iconRotates(object: EEObject): boolean {
  return object.type === "CpuShip" || object.type === "PlayerSpaceship";
}

export function radarIconUrl(file: string): string {
  return assetUrl(`radar/${file}`);
}

/** Stable, CSS-safe id for the mask that tints one sprite. */
export function iconMaskId(file: string): string {
  return `radar-${file.replace(/[^a-zA-Z0-9]/g, "-")}`;
}
