import type { EEColor, EELibrary, EEObject, EEProject, Vec2 } from "@forge/contracts";

/**
 * Map-canvas geometry.
 *
 * EE's world is planar and measured in **game units**; 1 U = 1000 GU is
 * the unit crews actually talk in, so the grid and the readouts use U
 * while the document keeps game units.
 *
 * Screen mapping is deliberately 1:1 with EE's axes — x right, y "south"
 * (down), matching `Zone:setPoints`' documented convention. An editor that
 * silently flipped y would produce maps that mirror in game.
 */

export const GAME_UNITS_PER_U = 1000;

/** Camera: world position at the viewport centre, plus a zoom factor. */
export interface Camera {
  readonly center: Vec2;
  /** Screen pixels per game unit. */
  readonly scale: number;
}

export const DEFAULT_CAMERA: Camera = {
  center: { x: 0, y: 0 },
  // ~40 U across a 1000 px viewport — the scale a small system fits in.
  scale: 1000 / (40 * GAME_UNITS_PER_U),
};

export function worldToScreen(camera: Camera, viewport: Vec2, world: Vec2): Vec2 {
  return {
    x: (world.x - camera.center.x) * camera.scale + viewport.x / 2,
    y: (world.y - camera.center.y) * camera.scale + viewport.y / 2,
  };
}

export function screenToWorld(camera: Camera, viewport: Vec2, screen: Vec2): Vec2 {
  return {
    x: (screen.x - viewport.x / 2) / camera.scale + camera.center.x,
    y: (screen.y - viewport.y / 2) / camera.scale + camera.center.y,
  };
}

export function formatU(gameUnits: number): string {
  return `${(gameUnits / GAME_UNITS_PER_U).toFixed(1)}U`;
}

/**
 * Footprint radius in game units — the extent an object actually occupies
 * in EE, drawn to scale so an author can see overlaps before EE does.
 *
 * Sources for the constants (`docs/ee-api-reference.md`):
 *  - Nebula: fixed 5 U radius, no getter, stated in EE's own class docs.
 *  - Mine: trigger range is internal; EE's source uses ~1.2 U.
 *  - BlackHole: event horizon defaults to 5000 GU.
 *  - WarpJammer: `setRange`, EE's default is 7 U when unset.
 *
 * Returns null for objects with no meaningful extent — those are drawn as
 * fixed-size icons instead, so they stay clickable at any zoom.
 */
export function footprintRadius(object: EEObject): number | null {
  switch (object.type) {
    case "Planet":
      return object.radius;
    case "Nebula":
      return 5000;
    case "BlackHole":
      return 5000;
    case "Mine":
      return 1200;
    case "WarpJammer":
      return object.range ?? 7000;
    case "Asteroid":
    case "VisualAsteroid":
      return object.size ?? 120;
    default:
      return null;
  }
}

/**
 * Faction name → CSS colour, from EmptyEpsilon's own `setGMColor`.
 *
 * The project's own factions win over the scanned install, exactly as
 * `validateProject` resolves a faction reference: a project may redefine a
 * stock name, and the editor has to show what will actually load.
 *
 * Built once per render rather than per object — a belt is hundreds of
 * objects and this would otherwise be a linear scan each.
 */
export function factionColors(
  project: EEProject | null,
  library: EELibrary | null,
): ReadonlyMap<string, string> {
  const colors = new Map<string, string>();
  const put = (name: string, gmColor: EEColor | readonly number[] | null): void => {
    if (gmColor === null) return;
    const [r, g, b] = gmColor;
    if (r === undefined || g === undefined || b === undefined) return;
    colors.set(name, `rgb(${r}, ${g}, ${b})`);
  };
  // Library first, then the project overwrites — last write wins.
  for (const faction of library?.factions ?? []) put(faction.name, faction.gmColor);
  for (const faction of project?.factions ?? []) put(faction.name, faction.gmColor);
  return colors;
}

/**
 * What colour an object draws in.
 *
 * **A factioned object takes its faction's colour**, because on the map
 * the question an author is asking is "whose is that?" — and EE already
 * answers it, through the `setGMColor` its own `factionInfo.lua` declares
 * and the install scan records. Colouring by type instead made every
 * CpuShip red whatever its allegiance, so changing a faction in the
 * inspector changed nothing on the canvas.
 *
 * The per-type palette below stays as the fallback: it covers everything
 * with no faction (planets, asteroids, zones) and a faction name neither
 * the project nor the install knows — which is a typo the build will warn
 * about, and showing it in the type's colour is better than inventing one.
 */
export function objectColor(
  object: EEObject,
  factions?: ReadonlyMap<string, string>,
): string {
  if ("faction" in object) {
    const color = factions?.get(object.faction);
    if (color !== undefined) return color;
  }
  switch (object.type) {
    case "PlayerSpaceship":
      return "#4fc3f7";
    case "CpuShip":
      return "#ef5350";
    case "SpaceStation":
      return "#ffb74d";
    case "Planet":
      return "#7e9cd8";
    case "Nebula":
      return "#9575cd";
    case "BlackHole":
      return "#b0bec5";
    case "WormHole":
      return "#4dd0e1";
    case "Mine":
      return "#e57373";
    case "Asteroid":
      return "#8d8d8d";
    case "VisualAsteroid":
      return "#6d6d6d";
    case "Artifact":
      return "#ba68c8";
    case "SupplyDrop":
      return "#aed581";
    case "ScanProbe":
      return "#4db6ac";
    case "WarpJammer":
      return "#f06292";
    case "Zone":
      return "#ffa726";
  }
}

/** Nice round grid step (in game units) for the current zoom. */
export function gridStep(scale: number): number {
  // Aim for a line every ~80 screen px, snapped to a 1-2-5 sequence.
  const target = 80 / scale;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const factor of [1, 2, 5, 10]) {
    if (magnitude * factor >= target) return magnitude * factor;
  }
  return magnitude * 10;
}

export function snapTo(value: number, step: number): number {
  return step <= 0 ? value : Math.round(value / step) * step;
}

/** Axis-aligned bounds of every object in a set, for zoom-to-fit. */
export function boundsOf(objects: readonly EEObject[]): {
  min: Vec2;
  max: Vec2;
} | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const object of objects) {
    const points =
      object.type === "Zone" ? object.points : [object.position];
    const radius = footprintRadius(object) ?? 0;
    for (const p of points) {
      minX = Math.min(minX, p.x - radius);
      minY = Math.min(minY, p.y - radius);
      maxX = Math.max(maxX, p.x + radius);
      maxY = Math.max(maxY, p.y + radius);
    }
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
