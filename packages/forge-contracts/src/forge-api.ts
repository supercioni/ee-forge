import { z } from "zod";
import { EELibrarySchema } from "./ee-library.js";
import { EEDmxRigSchema } from "./ee-dmx.js";
import { EEIdSchema, EEProjectSchema } from "./ee-project.js";

/**
 * Wire shapes for the editor ↔ bridge HTTP surface (`/forge/*`).
 *
 * Defined here rather than inline in the bridge because
 * `packages/bridge/CLAUDE.md` is explicit: no untyped JSON crosses a
 * process boundary. The editor validates every response against these,
 * so a bridge/editor version skew surfaces as a schema error instead of
 * an undefined field three components deep.
 */

export const ForgeProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  groupCount: z.number().int().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  templateCount: z.number().int().nonnegative(),
  /** File mtime, ISO-8601. */
  updatedAt: z.string(),
});
export type ForgeProjectSummary = z.infer<typeof ForgeProjectSummarySchema>;

export const ForgeProjectListSchema = z.object({
  projects: z.array(ForgeProjectSummarySchema),
  /** Absolute path of the directory holding the projects. */
  projectsDir: z.string(),
});
export type ForgeProjectList = z.infer<typeof ForgeProjectListSchema>;

/**
 * An EmptyEpsilon install Forge knows about. `target` is the engine build;
 * `verified` says whether that came from evidence (the install's own
 * script reference matched a known build) or from the author declaring it.
 * A path alone never proves a version.
 */
export const ForgeInstallationSchema = z.object({
  /** Stable id: target + short hash of the path. */
  id: z.string().min(1),
  path: z.string().min(1),
  label: z.string(),
  target: z.string().min(1),
  verified: z.boolean(),
  /** SHA-256 of `script_reference.html` when it was readable. */
  evidence: z.string().nullable(),
  addedAt: z.string(),
  /** Last successful scan, ISO-8601; null until the first. */
  scannedAt: z.string().nullable(),
});
export type ForgeInstallation = z.infer<typeof ForgeInstallationSchema>;

export const ForgeInstallationListSchema = z.object({
  installations: z.array(ForgeInstallationSchema),
});
export type ForgeInstallationList = z.infer<typeof ForgeInstallationListSchema>;

export const ForgeRegisterInstallationSchema = z.object({
  path: z.string().min(1),
  /** Only honoured for an install the toolkit cannot recognise. */
  eeVersion: z.string().min(1).optional(),
  label: z.string().optional(),
});
export type ForgeRegisterInstallation = z.infer<typeof ForgeRegisterInstallationSchema>;

export const ForgeLibraryResponseSchema = z.object({
  /**
   * Null when no scan has been run — the editor then falls back to
   * free-text template/faction entry and says so, rather than pretending
   * the install is empty.
   */
  library: EELibrarySchema.nullable(),
  /** The install the library was scanned from, when known. */
  installation: ForgeInstallationSchema.nullable().default(null),
});
export type ForgeLibraryResponse = z.infer<typeof ForgeLibraryResponseSchema>;

/**
 * Re-indexing the install also mirrors its drawable resources, so the
 * result says what moved: a name in a list is no use if the image behind
 * it was never copied.
 */
export const ForgeLibraryRescanResultSchema = z.object({
  library: EELibrarySchema,
  /** Asset paths written to this install's own cache, e.g. `planets/ice-planet.png`. */
  copied: z.array(z.string()),
  warnings: z.array(z.string()),
  /** Engine the install was identified (or declared) as. */
  target: z.string().nullable().default(null),
  /** True when the engine was recognised from evidence. */
  verified: z.boolean().default(false),
  installation: ForgeInstallationSchema.nullable().default(null),
});
export type ForgeLibraryRescanResult = z.infer<typeof ForgeLibraryRescanResultSchema>;

/**
 * Create a new project. The id is the directory name; the bridge refuses
 * one that already exists rather than overwriting it, which is the whole
 * reason this is its own route instead of the PUT that saves a document.
 */
export const ForgeCreateRequestSchema = z.object({
  id: EEIdSchema,
  name: z.string().min(1),
  description: z.string(),
});
export type ForgeCreateRequest = z.infer<typeof ForgeCreateRequestSchema>;

export const ForgeCreateResultSchema = z.object({
  /** The document as written, so the editor can open it without a re-fetch. */
  project: EEProjectSchema,
  /** Absolute path of the directory created. */
  dir: z.string(),
});
export type ForgeCreateResult = z.infer<typeof ForgeCreateResultSchema>;

export const ForgeSaveResultSchema = z.object({
  saved: z.literal(true),
  /** ISO-8601 timestamp of the write. */
  savedAt: z.string(),
  /** SHA-256 of the written document, matching what a build would stamp. */
  sourceHash: z.string(),
});
export type ForgeSaveResult = z.infer<typeof ForgeSaveResultSchema>;

export const ForgeBuildFileSchema = z.object({
  name: z.string(),
  /** Where the file belongs in the EE install. See ADR-0034 §3. */
  install: z.enum(["scripts", "shiptemplates"]),
  bytes: z.number().int().nonnegative(),
});
export type ForgeBuildFile = z.infer<typeof ForgeBuildFileSchema>;

/** How EXODUS actions were treated in a build (ADR-0049). */
export const ForgeBuildModeSchema = z.enum(["vanilla", "integrated"]);
export type ForgeBuildMode = z.infer<typeof ForgeBuildModeSchema>;

/**
 * How far a combination of engine and feature has actually been shown to work. Never inferred from
 * a version string: `engine-tested` means a generated scenario was run in that engine (and what
 * exactly is in `note`); `offline` means generated and checked without running the engine;
 * `unverified` means neither; `incompatible` means a known failure.
 */
export const ForgeCompatLevelSchema = z.enum(["engine-tested", "offline", "unverified", "incompatible"]);
export type ForgeCompatLevel = z.infer<typeof ForgeCompatLevelSchema>;

export const ForgeCompatEntrySchema = z.object({
  level: ForgeCompatLevelSchema,
  note: z.string(),
});
export type ForgeCompatEntry = z.infer<typeof ForgeCompatEntrySchema>;

/** An extension this Forge can build with, and what its emitted code expects of the running service. */
export const ForgeExtensionInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  /** Service protocol version the emitted code speaks. */
  protocol: z.string(),
  capabilities: z.array(z.string()),
  /** What has been shown to work, per engine target. A target missing here is `unverified`. */
  compatibility: z.record(z.string(), ForgeCompatEntrySchema).default({}),
});
export type ForgeExtensionInfo = z.infer<typeof ForgeExtensionInfoSchema>;

export const ForgeExtensionListSchema = z.object({ extensions: z.array(ForgeExtensionInfoSchema) });
export type ForgeExtensionList = z.infer<typeof ForgeExtensionListSchema>;

/**
 * What the transactional install did (ADR-0052). `status` is the answer; `ok` is true only for a complete
 * install. A caller must never say "installed" on anything else.
 */
export const ForgeInstallOutcomeSchema = z.object({
  status: z.enum(["installed", "installed-pending", "refused", "rolled-back", "rollback-failed"]),
  ok: z.boolean(),
  /** Absolute paths written (created or replaced). Empty unless the bundle went in. */
  installed: z.array(z.string()),
  /** Already identical to the build: left alone. */
  unchanged: z.array(z.string()),
  /** Paths a running EE holds open; one of them refuses the whole install before anything is written. */
  locked: z.array(z.string()),
  /** Existing files EE FORGE did not install (or that were edited since): refused unless overwrite was asked. */
  collisions: z.array(z.string()),
  /** Where the originals of replaced files were copied before writing. */
  backupDir: z.string().nullable(),
  restore: z.object({ restored: z.array(z.string()), unrestored: z.array(z.string()) }),
  error: z.string().nullable(),
  needsRestart: z.boolean(),
  /** The templates file(s) EE only loads at launch. */
  restartFiles: z.array(z.string()),
  /** The line `shipTemplates.lua` needs, when the build produced one. */
  requireLine: z.string().nullable(),
  /** Whether that line is present now — patched by us or already there. */
  required: z.boolean(),
  warnings: z.array(z.string()),
});
export type ForgeInstallOutcome = z.infer<typeof ForgeInstallOutcomeSchema>;

/** Names of the project's own ship templates and models: they exist only after EE restarts. */
export const ForgeLaunchItemsSchema = z.object({
  templates: z.array(z.string()),
  models: z.array(z.string()),
});
export type ForgeLaunchItems = z.infer<typeof ForgeLaunchItemsSchema>;

/**
 * Which installation's scan a result was checked against. The engine year is not enough: two copies of one
 * engine are two installations, with their own libraries, and a result must say which one it looked at.
 * Null means no scan existed — what could not be checked then is "not checked", not "missing".
 */
export const ForgeLibrarySourceSchema = z.object({
  installId: z.string().nullable(),
  label: z.string(),
  path: z.string(),
  eeVersion: z.string(),
  /** Whether the install's own files identified it as that engine (as opposed to the author declaring it). */
  verified: z.boolean(),
  scannedAt: z.string(),
});
export type ForgeLibrarySource = z.infer<typeof ForgeLibrarySourceSchema>;

export const ForgeBuildResultSchema = z.object({
  /** The engine the scenario was generated for. */
  target: z.string().default(""),
  /** The scan the build's reference checks used; null when there was none. */
  library: ForgeLibrarySourceSchema.nullable().default(null),
  /** `vanilla`: nothing of EXODUS in the output. `integrated`: guarded EXODUS code with the alternatives as fallback. */
  mode: ForgeBuildModeSchema.default("vanilla"),
  files: z.array(ForgeBuildFileSchema),
  warnings: z.array(z.string()),
  /** Absolute path the bundle was written to. */
  outDir: z.string(),
  /**
   * True when the project needs the launch-time install step (custom ship
   * templates or models) — the editor surfaces the extra file, the
   * `require` line, and the EE restart instead of letting an author
   * wonder why their new hull does not exist.
   */
  needsLaunchInstall: z.boolean(),
  /**
   * What the launch-time install did, when the request asked for one.
   *
   * Null when the build only wrote to `projects/<id>/build/`. Present means
   * files were copied into the EE install — and if `needsRestart` is true,
   * EmptyEpsilon has to be restarted before the templates exist, because
   * it only accepts `ShipTemplate()` during its launch-time phase.
   */
  install: ForgeInstallOutcomeSchema.nullable(),
  /** What EE reads only at launch, apart from the scenario files: the author's ship templates and models. */
  launchItems: ForgeLaunchItemsSchema,
});
export type ForgeBuildResult = z.infer<typeof ForgeBuildResultSchema>;

/** What an install would do, before it does it (the preflight as a list). */
export const ForgeInstallPreviewSchema = z.object({
  target: z.string(),
  mode: ForgeBuildModeSchema,
  installation: z.object({ id: z.string().nullable(), label: z.string(), path: z.string(), target: z.string().nullable(), verified: z.boolean() }),
  files: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(["scripts", "shiptemplates"]), action: z.enum(["create", "replace", "unchanged", "collision", "locked"]) })),
  collisions: z.array(z.string()),
  locked: z.array(z.string()),
  wouldBackUp: z.array(z.string()),
  requireLine: z.string().nullable(),
  requireState: z.enum(["not-needed", "present", "will-add", "by-hand", "no-index"]),
  needsRestart: z.boolean(),
  clear: z.boolean(),
  /** Why the install cannot go ahead at all (engine mismatch, install gone), when it cannot. */
  blocked: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type ForgeInstallPreview = z.infer<typeof ForgeInstallPreviewSchema>;

export const ForgeErrorSchema = z.object({
  error: z.string(),
  /** Present for validation failures: the offending path in the document. */
  path: z.string().nullable(),
});
export type ForgeError = z.infer<typeof ForgeErrorSchema>;

// ---------------------------------------------------------------------------
// DMX (ADR-0040)
// ---------------------------------------------------------------------------

export const ForgeDmxResponseSchema = z.object({
  /** Null until a rig has been saved or imported. */
  rig: EEDmxRigSchema.nullable(),
});
export type ForgeDmxResponse = z.infer<typeof ForgeDmxResponseSchema>;

export const ForgeDmxImportResultSchema = z.object({
  rig: EEDmxRigSchema,
  /**
   * What the reader could not understand. Shown rather than swallowed: an
   * import that quietly dropped a section would lose work the author can
   * still see in their own file.
   */
  warnings: z.array(z.string()),
  path: z.string(),
});
export type ForgeDmxImportResult = z.infer<typeof ForgeDmxImportResultSchema>;

export const ForgeDmxBuildResultSchema = z.object({
  outPath: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Where it was copied, when the caller asked for an install. */
  installedTo: z.string().nullable(),
  /** The backup taken first — `hardware.ini` is never overwritten blind. */
  backedUpTo: z.string().nullable(),
});
export type ForgeDmxBuildResult = z.infer<typeof ForgeDmxBuildResultSchema>;


// ---------------------------------------------------------------------------
// Compatibility, import and export (desktop shell, increment 5)
// ---------------------------------------------------------------------------

export const ForgeCompatibilitySchema = z.object({
  targets: z.array(
    z.object({
      target: z.string(),
      label: z.string(),
      /** A vanilla export: needs nothing of EXODUS. Never blocked by anything below. */
      vanilla: ForgeCompatEntrySchema,
      /** One entry per registered extension. Empty when none is installed. */
      extensions: z.array(z.object({ id: z.string(), label: z.string(), level: ForgeCompatLevelSchema, note: z.string() })),
    }),
  ),
});
export type ForgeCompatibility = z.infer<typeof ForgeCompatibilitySchema>;

/** A project copied into the projects directory from somewhere else; the source is never written. */
export const ForgeImportResultSchema = z.object({
  project: ForgeProjectSummarySchema,
  /** Id the copy was stored under (a free one: an existing project is never overwritten). */
  id: z.string(),
  /** The document's own id when it had to change. */
  renamedFrom: z.string().nullable(),
  sourceKind: z.enum(["directory", "file"]),
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  /** Keys kept but not interpreted. */
  preserved: z.array(z.string()),
  /** Source paths that did not survive; expected empty. */
  lost: z.array(z.string()),
});
export type ForgeImportResult = z.infer<typeof ForgeImportResultSchema>;

export const ForgeExportTargetResultSchema = z.object({
  target: z.string(),
  /** The scan this target's reference checks used; null when none existed for that engine. */
  library: ForgeLibrarySourceSchema.nullable().default(null),
  ok: z.boolean(),
  /** `<out>/<project>/<target>`; its `scripts/` mirrors the layout of an EE install. */
  outDir: z.string(),
  mode: ForgeBuildModeSchema.nullable(),
  files: z.array(ForgeBuildFileSchema),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  needsLaunchInstall: z.boolean(),
  launchItems: ForgeLaunchItemsSchema,
  compatibility: z.object({ vanilla: ForgeCompatEntrySchema, extensions: z.array(z.object({ id: z.string(), level: ForgeCompatLevelSchema, note: z.string() })) }),
});
export type ForgeExportTargetResult = z.infer<typeof ForgeExportTargetResultSchema>;

export const ForgeExportResultSchema = z.object({
  projectId: z.string(),
  /** `<out>/<project>`; holds one folder per target and `export-report.json`. */
  outRoot: z.string(),
  reportPath: z.string(),
  targets: z.array(ForgeExportTargetResultSchema),
});
export type ForgeExportResult = z.infer<typeof ForgeExportResultSchema>;
