import { z } from "zod";

/**
 * Asset manifest — maps EE `(typeName, template)` pairs to a glTF
 * model + render-time adjustments. The runtime is specified in
 * [ADR-0020](../../../docs/adr/0020-asset-pipeline-runtime.md);
 * the author-time conventions live in
 * [docs/authoring/assets.md](../../../docs/authoring/assets.md).
 *
 * Manifest file path: `assets/manifest.json` (repo root). The
 * bridge serves it at `/assets/manifest.json` on bridge.httpPort
 * and broadcasts a `manifest/updated` WS event on every save.
 *
 * Keys follow the `${typeName}:${template}` convention, same as
 * `ContactSchema` (the rendering surface that consumes them). EE
 * classes don't include `:` characters so the separator is safe.
 *
 * Field set is intentionally small. KTX2/DRACO toggles, LOD entries,
 * animation clip names, and wildcards are explicit non-goals — extend
 * the schema additively when a consumer asks.
 *
 * `engineEmitters` landed in STEP 22 to anchor the engine trail to
 * the model's actual thruster nozzles instead of the bounding-box
 * centre. Sourced from EE's `model:addEngineEmitter(x, y, z, ...)`
 * calls in `scripts/model_data.lua`.
 */

export const AssetManifestEntrySchema = z.object({
  /** Path under `/assets/` (e.g. "ships/atlantis.glb"). Leading
   *  slash is allowed but stripped server-side. */
  model: z.string().min(1),
  /**
   * Uniform render scale applied to the loaded mesh. Defaults to
   * 1.0. Treated as a manual override — for ships and stations,
   * prefer `radius` (below), which auto-derives the right scale
   * from the glTF's own bounding box so the model occupies the
   * same in-game footprint as its EE collision radius.
   */
  scale: z.number().positive().default(1),
  /**
   * EE collision radius for this asset, in **game units** (the
   * same convention EE itself uses in `scripts/model_data.lua`
   * via `model:setRadius(N)`). When present, the viewer ignores
   * `scale` and computes the Three.js scale automatically so the
   * rendered model's bounding-sphere radius lands on
   * `radius / RENDER_SCALE` world units — i.e. strict 1:1 with
   * what EE shows on its 2D top-down view.
   *
   * Use `scale` (and omit `radius`) only for cosmetic / non-EE-
   * typed assets where no canonical collision radius exists
   * (e.g. a BlackHole glTF — EE has no per-instance radius getter
   * for BlackHole).
   */
  radius: z.number().positive().optional(),
  /**
   * Static Euler rotation (radians, XYZ order) applied BEFORE the
   * EE heading rotation. Use when the source model's forward axis
   * doesn't align with EE's `0 = +X` convention. Defaults to no
   * offset.
   */
  rotationOffset: z
    .tuple([z.number(), z.number(), z.number()])
    .default([0, 0, 0]),
  /**
   * Named material preset (lives in `web-viewer`'s
   * `src/scene/materials.ts`). `null` keeps the glTF's own
   * embedded materials. Unknown names fall back to the default
   * preset with a one-time console warn.
   */
  material: z.string().nullable().default(null),
  /**
   * Engine thruster positions in the **model's local frame**,
   * already multiplied by EE's `setScale` so the values are in EE
   * game units (same convention as `radius`). Sourced from
   * `model:addEngineEmitter(x, y, z, r, g, b, scale)` in
   * `scripts/model_data.lua` — the `(x, y, z)` triple is captured;
   * the colour/scale args are ignored (the viewer owns the look).
   *
   * EE model axes:
   *   `+x` = forward / heading direction (thrusters sit at negative x)
   *   `+y` = port-to-starboard (sideways)
   *   `+z` = up (vertical)
   *
   * The viewer's TrailsLayer reads this list, takes the centroid,
   * rotates by the ship's heading and adds it to the contact
   * position so each engine plume anchors behind the nozzle bank
   * instead of through the model's centre.
   *
   * Empty (default) means "trail emits from the contact centre" —
   * the fallback for ships without addEngineEmitter calls.
   */
  engineEmitters: z
    .array(z.tuple([z.number(), z.number(), z.number()]))
    .default([]),
});
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

/** Key pattern: `EeClassName:TemplateName`. The left half is the
 *  alphabetic typeName EE assigns (`PlayerSpaceship`, `CpuShip`,
 *  `SpaceStation`, `BlackHole`, …). The right half is the EE
 *  template name as authored — EE templates routinely include
 *  spaces, dots, hyphens, parens, and apostrophes ("Medium
 *  Station", "Atlantis X23", "Adv. Striker"), so we accept any
 *  non-empty run of characters that doesn't itself contain the
 *  `:` separator. */
export const ASSET_MANIFEST_KEY_PATTERN = /^[A-Za-z]+:[^:]+$/;

export const AssetManifestSchema = z.record(
  z.string().regex(ASSET_MANIFEST_KEY_PATTERN),
  AssetManifestEntrySchema,
);
export type AssetManifest = z.infer<typeof AssetManifestSchema>;

/** WS channel name for hot-reload notifications (ADR-0020). */
export const MANIFEST_UPDATED_CHANNEL = "manifest/updated";
