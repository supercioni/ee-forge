import { assetUrl } from "../api/transport.js";

/**
 * Nebulae, filled with EmptyEpsilon's own cloud billboards.
 *
 * A nebula is drawn at its true 5 U radius — the figure EE hardcodes and
 * the one that matters, since it is the interference range crews feel — so
 * the disc is already honest about size. Filling it with the game's own
 * texture makes it read as a nebula rather than as a purple circle.
 *
 * One difference from planets, and it is worth being straight about: a
 * planet's texture is stated by the project, so the editor draws what EE
 * will draw. A nebula's is not. EE assembles each nebula from billboards
 * it picks itself at spawn, and exposes no setter to choose them, so
 * nothing an author writes can decide this. The editor picks one
 * deterministically from the object's id: a map therefore looks the same
 * every time it is opened, but the particular cloud is indicative, not a
 * prediction.
 */

/** EE's three nebula billboards, copied into `assets/nebula/`. */
const NEBULA_TEXTURES = ["Nebula1.png", "Nebula2.png", "Nebula3.png"] as const;

/**
 * How solid the cloud is over the map.
 *
 * Blended with `screen` on the canvas' near-black ground, so the dark
 * parts of the billboard add nothing and the bright parts glow — which is
 * how EE composites them too. The grid stays legible through it.
 */
export const NEBULA_OPACITY = 0.9;

/** FNV-1a: same family as the scatter brushes' seed hash, stable per id. */
function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Which billboard this nebula wears — stable across reloads. */
export function nebulaTextureFor(objectId: string): string {
  const index = hashId(objectId) % NEBULA_TEXTURES.length;
  return NEBULA_TEXTURES[index] ?? NEBULA_TEXTURES[0];
}

export function nebulaTextureUrl(file: string): string {
  return assetUrl(`nebula/${file}`);
}

/** Stable, CSS-safe id for the clip that cuts one nebula's cloud to its disc. */
export function nebulaClipId(objectId: string): string {
  return `nebula-${objectId.replace(/[^a-zA-Z0-9]/g, "-")}`;
}
