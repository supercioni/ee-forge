import type { Vec2 } from "@forge/contracts";

/**
 * Scatter brushes for the map editor: belts, clusters and fields.
 *
 * Everything here is **seeded and resolved at authoring time** (ADR-0034
 * §6). The editor shows literal coordinates and the emitter writes literal
 * coordinates — no `math.random` ever reaches generated Lua, so the preview
 * cannot drift from what EmptyEpsilon loads.
 *
 * Same seed → same scatter, on any machine, forever. That is what makes a
 * committed project document reproducible.
 */

/**
 * mulberry32 — small, fast, and stable across engines. Chosen over
 * `Math.random` for the obvious reason (no seed) and over a hash-chain for
 * the boring one: 32-bit arithmetic here is exactly reproducible in
 * JavaScript, which is the only place it runs.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the seed string, so authors can use words instead of ints. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface ScatterPoint {
  readonly position: Vec2;
  /** Object size in EE game units, when the brush varies it. */
  readonly size: number;
}

interface BrushCommon {
  readonly seed: string;
  readonly count: number;
  /**
   * Inclusive size range in EE game units. Optional so a `Brush` can be
   * built directly without one; the panel always supplies it through
   * {@link BrushSpec}.
   */
  readonly sizeRange?: readonly [number, number];
}

export interface ClusterBrush extends BrushCommon {
  readonly kind: "cluster";
  readonly center: Vec2;
  /** Cluster radius in game units. */
  readonly radius: number;
}

export interface BeltBrush extends BrushCommon {
  readonly kind: "belt";
  readonly center: Vec2;
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Arc covered, in degrees. 360 is a full ring. */
  readonly arcDegrees?: number;
  /** Where the arc starts, in degrees. */
  readonly startDegrees?: number;
}

export interface FieldBrush extends BrushCommon {
  readonly kind: "field";
  /** Top-left corner in EE coordinates (y grows "south"). */
  readonly origin: Vec2;
  readonly width: number;
  readonly height: number;
}

export type Brush = ClusterBrush | BeltBrush | FieldBrush;

/**
 * EE's own asteroid band. Its scripts sit almost entirely in 112..128 and
 * it picks from this range itself when a script sets no size — so a
 * default that matches it makes a forged belt look like a stock one.
 *
 * Not a limit: `Asteroid:setSize(number size)` documents no bounds, and
 * EE's scripts go well outside this band deliberately.
 */
export const DEFAULT_SIZE_RANGE: readonly [number, number] = [110, 130];

function round(value: number): number {
  // EE positions are floats, but whole game units keep generated Lua
  // readable and diffable against hand-written scenarios.
  return Math.round(value);
}

export function generateBrush(brush: Brush): ScatterPoint[] {
  const random = mulberry32(hashSeed(brush.seed));
  // The range arrives from two free-typed boxes, so it is hardened here
  // rather than trusted: an inverted pair is swapped instead of producing
  // sizes below the floor, and the result never drops under 1 — the
  // project schema requires a positive size, and a scatter must not be
  // able to produce a document the save then refuses.
  const [lowSize, highSize] = brush.sizeRange ?? DEFAULT_SIZE_RANGE;
  const minSize = Math.min(lowSize, highSize);
  const maxSize = Math.max(lowSize, highSize);
  const points: ScatterPoint[] = [];

  for (let i = 0; i < brush.count; i += 1) {
    let x: number;
    let y: number;

    switch (brush.kind) {
      case "cluster": {
        // sqrt keeps the density uniform per unit area; without it the
        // centre bunches up and the edge looks empty.
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * brush.radius;
        x = brush.center.x + Math.cos(angle) * distance;
        y = brush.center.y + Math.sin(angle) * distance;
        break;
      }
      case "belt": {
        const arc = ((brush.arcDegrees ?? 360) * Math.PI) / 180;
        const start = ((brush.startDegrees ?? 0) * Math.PI) / 180;
        // Even spacing plus jitter: a purely random ring clumps visibly
        // at these counts, which reads as a mistake rather than a belt.
        const step = brush.count === 0 ? 0 : arc / brush.count;
        const angle = start + step * i + (random() - 0.5) * step * 0.8;
        const radius =
          brush.innerRadius + random() * (brush.outerRadius - brush.innerRadius);
        x = brush.center.x + Math.cos(angle) * radius;
        y = brush.center.y + Math.sin(angle) * radius;
        break;
      }
      case "field": {
        x = brush.origin.x + random() * brush.width;
        y = brush.origin.y + random() * brush.height;
        break;
      }
    }

    points.push({
      position: { x: round(x), y: round(y) },
      size: Math.max(1, round(minSize + random() * (maxSize - minSize))),
    });
  }

  return points;
}

/**
 * A brush as the editor's controls hold it: everything except where it
 * goes.
 *
 * The centre arrives separately because it is chosen by clicking the map,
 * which is the only way to place a scatter against the objects already
 * there. Keeping the shape maths here rather than in the React panel is
 * what lets a test assert that a belt straddles its nominal radius and a
 * field is centred on the point, instead of the UI being the only witness.
 */
export interface BrushSpec {
  readonly kind: Brush["kind"];
  readonly seed: string;
  readonly count: number;
  /** Nominal size in game units; each shape reads it its own way. */
  readonly radius: number;
  /**
   * Inclusive size band each scattered rock draws from, in game units.
   *
   * Only the two asteroid types carry a size, so the panel offers this
   * only for those; the other scatterable types have no `size` in the
   * schema and {@link generateBrush}'s answer is simply ignored for them.
   */
  readonly sizeRange: readonly [number, number];
}

/**
 * Resolve a spec against a point on the map.
 *
 * A belt straddles the nominal radius (±10%) because that is what a belt
 * is — a band, not a wire. A cluster reads the radius as a diameter-ish
 * spread and takes a quarter of it, so switching shapes at the same
 * setting does not produce something wildly larger. A field is a square
 * centred on the click, since anything else would put the cursor in a
 * corner and make placement guesswork.
 */
export function brushAt(spec: BrushSpec, center: Vec2): Brush {
  const { seed, count, radius, sizeRange } = spec;
  switch (spec.kind) {
    case "belt":
      return {
        kind: "belt",
        seed,
        count,
        sizeRange,
        center,
        innerRadius: radius * 0.9,
        outerRadius: radius * 1.1,
      };
    case "cluster":
      return { kind: "cluster", seed, count, sizeRange, center, radius: radius * 0.25 };
    case "field":
      return {
        kind: "field",
        seed,
        count,
        sizeRange,
        origin: { x: center.x - radius / 2, y: center.y - radius / 2 },
        width: radius,
        height: radius,
      };
  }
}

/** The naming-convention sub-code a brush's output should carry. */
export function brushSubCode(brush: Brush): "CL" | "BE" | "FL" {
  switch (brush.kind) {
    case "cluster":
      return "CL";
    case "belt":
      return "BE";
    case "field":
      return "FL";
  }
}
