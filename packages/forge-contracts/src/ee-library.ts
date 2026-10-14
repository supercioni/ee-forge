import { z } from "zod";
import { EE_SHIP_TEMPLATE_FIELDS } from "./ee-project.js";

/**
 * Index of what a given EmptyEpsilon install already contains: ship
 * templates, models, factions, and the loose resource files an author can
 * reference by path.
 *
 * Why it is scanned rather than queried: EE-2024.12.08 exposes **no Lua
 * enumeration API**. There is no "list ship templates" or "list factions"
 * — only `getFactionInfo(name)` by exact name. So the library is built by
 * parsing the install's own data scripts (`scripts/shiptemplates/*.lua`,
 * `scripts/model_data.lua`, `scripts/factionInfo.lua`) plus a directory
 * walk of `resources/`. See ADR-0034 §Context.
 *
 * The scan is best-effort and tolerant: EE data scripts are plain chained
 * setter calls, but they are hand-written and occasionally irregular. A
 * template we fail to fully parse is still listed by name rather than
 * dropped — a name is enough to reference it from `setTemplate`.
 *
 * What a partial parse costs went up, though. The library used to be an
 * index of names; it now holds each stock ship whole, because an author
 * copying one into a project gets exactly what was read here (ADR-0041).
 * So a setter argument the reader cannot resolve becomes a **warning**
 * rather than a quiet default: a copy that admits a hole is worth more
 * than one that invents a value.
 */

/**
 * A stock ship, read whole.
 *
 * Exactly `EE_SHIP_TEMPLATE_FIELDS` — the same shape a project's own
 * template has, minus the id the project assigns — plus where it came
 * from. Deliberately not a thinner "reference" type: an author has to be
 * able to *copy a stock hull and edit it*, and EE offers no way to do that
 * at runtime (ADR-0041), so the only faithful copy is one made from
 * everything the install's Lua declares. A second, thinner shape would be
 * a mapping layer that could drift from the form doing the editing.
 */
export const EETemplateRefSchema = z.object({
  ...EE_SHIP_TEMPLATE_FIELDS,
  /** Install-relative path of the file that declared it. */
  sourceFile: z.string(),
  /**
   * The template this one was written as `base:copy("name")` of, when it
   * was — EE's stock files lean on that idiom heavily. Provenance only:
   * every field is already resolved, so a copy needs nothing from the base.
   */
  copiedFrom: z.string().nullable(),
});
export type EETemplateRef = z.infer<typeof EETemplateRefSchema>;

export const EEModelRefSchema = z.object({
  /** `ModelData:setName` — the string `ShipTemplate:setModel` expects. */
  name: z.string().min(1),
  mesh: z.string().nullable(),
  texture: z.string().nullable(),
  specular: z.string().nullable(),
  illumination: z.string().nullable(),
  scale: z.number().nullable(),
  /**
   * `setRadius` in EE game units. The only authoritative source for an
   * object's collision size — no Lua getter exposes it at runtime (see
   * `docs/ee-api-reference.md` §3).
   */
  radius: z.number().nullable(),
  sourceFile: z.string(),
});
export type EEModelRef = z.infer<typeof EEModelRefSchema>;

export const EEFactionRefSchema = z.object({
  name: z.string().min(1),
  /** `setGMColor` as [r, g, b] in 0..255, or null when never set. */
  gmColor: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  /** Faction names this one declares hostile / friendly (EE reciprocates). */
  enemies: z.array(z.string()),
  friends: z.array(z.string()),
  sourceFile: z.string(),
});
export type EEFactionRef = z.infer<typeof EEFactionRefSchema>;

/**
 * Resource paths usable as string arguments to EE setters. Paths are
 * stored the way EE wants them — relative to `resources/` — so they can
 * be dropped straight into `setPlanetSurfaceTexture("planets/gas-2.png")`.
 *
 * Meshes live mostly inside `packs/*.pack` archives; `meshes` therefore
 * merges loose `resources/**` geometry with the pack contents, and
 * `packs` records which archives were read.
 */
export const EEResourceIndexSchema = z.object({
  radarTraces: z.array(z.string()),
  planetTextures: z.array(z.string()),
  meshes: z.array(z.string()),
  textures: z.array(z.string()),
  sounds: z.array(z.string()),
  packs: z.array(z.string()),
});
export type EEResourceIndex = z.infer<typeof EEResourceIndexSchema>;

export const EELibrarySchema = z.object({
  eeVersion: z.string().min(1),
  installPath: z.string(),
  scannedAt: z.string(),
  templates: z.array(EETemplateRefSchema),
  models: z.array(EEModelRefSchema),
  factions: z.array(EEFactionRefSchema),
  resources: EEResourceIndexSchema,
  /**
   * Non-fatal parse complaints (a file that could not be read, a setter
   * shape the scanner did not recognise). Surfaced in the editor rather
   * than swallowed, so a stale scanner is visible instead of silently
   * producing a thinner library.
   */
  warnings: z.array(z.string()),
});
export type EELibrary = z.infer<typeof EELibrarySchema>;
