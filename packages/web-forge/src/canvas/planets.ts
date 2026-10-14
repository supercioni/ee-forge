import { assetUrl } from "../api/transport.js";

/**
 * Planets, drawn with EE's own surface textures.
 *
 * A planet is one of the few objects whose size on the map is its size in
 * game (`Planet:setPlanetRadius`), so the canvas already draws it at true
 * radius. Filling that disc with the texture the project actually assigns
 * — the same file EE will hand to `setPlanetSurfaceTexture` — turns the
 * circle into a recognisable body: an author spots "that's the gas giant,
 * that's the moon" without reading a label.
 *
 * The textures live in `assets/planets/` (copied from the install, GPLv2,
 * attribution in that directory's README) and are served by the bridge's
 * existing `/assets/` mount, exactly like the radar sprites.
 *
 * The ring around the disc is the planet's **atmosphere colour**
 * (`Planet:setPlanetAtmosphereColor`, 0..1 floats), which is the only
 * per-planet colour EE renders from the edge of the body outward — so an
 * author tuning it sees it here rather than only in game.
 */

/** Where the copied textures live under the bridge's asset mount. */
const PLANET_DIR = "planets";

/**
 * Absolute URL for a project's texture value.
 *
 * EE resolves these relative to `resources/`, so a project stores
 * `planets/moon-1.png`. A bare filename is accepted too and assumed to be
 * a stock planet texture, since that is the whole set the inspector offers.
 */
export function planetTextureUrl(file: string): string {
  const clean = file.replace(/^\/+/, "");
  const path = clean.includes("/") ? clean : `${PLANET_DIR}/${clean}`;
  return assetUrl(path);
}

/** Stable, CSS-safe id for the clip that cuts one planet's texture to a disc. */
export function planetClipId(objectId: string): string {
  return `planet-${objectId.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/**
 * Id for the mask that turns a cloud texture into cloud.
 *
 * EE's cloud maps (`Planet:setPlanetCloudTexture`) are **greyscale with no
 * alpha channel** — white is cloud, black is clear sky. Painting the file
 * over the surface would therefore lay a black film across half the
 * planet. Used as an SVG mask instead, whose default is luminance, the
 * white becomes opaque and the black becomes nothing: exactly the layer EE
 * composites.
 */
export function planetCloudMaskId(objectId: string): string {
  return `planet-cloud-${objectId.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

/**
 * How solid the cloud layer is over the surface.
 *
 * Enough to read as weather, sheer enough that the continents underneath
 * still identify the body.
 */
export const CLOUD_OPACITY = 0.7;

/**
 * CSS colour for the atmosphere ring.
 *
 * EE takes the components as 0..1 floats; browsers want 0..255, and
 * rounding here (rather than at the schema) keeps the document holding
 * exactly what gets emitted to Lua. Planets with no atmosphere colour set
 * fall back to the palette tone so the disc still reads as a planet.
 */
export function atmosphereCss(
  color: readonly [number, number, number] | null,
  fallback: string,
): string {
  if (color === null) return fallback;
  const byte = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 255);
  return `rgb(${byte(color[0])}, ${byte(color[1])}, ${byte(color[2])})`;
}

/**
 * Thickness of the atmosphere ring, in screen pixels.
 *
 * The band is taken **out of** the disc rather than added around it: the
 * texture is clipped to `radius - band`, so the planet still ends exactly
 * at its true radius and the map keeps telling the truth about overlaps.
 * A hairline was too easy to miss against a busy surface, so it scales
 * with the body — floored so it survives at far zoom, capped so a gas
 * giant stays a planet instead of becoming a ring, and never allowed to
 * eat more than a third of the disc.
 */
export function atmosphereBand(radius: number): number {
  const share = Math.max(radius * 0.14, 1.5);
  return Math.min(share, 16, radius * 0.35);
}
