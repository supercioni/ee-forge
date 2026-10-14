/**
 * @forge/core — EmptyEpsilon content toolkit (ADR-0034, ADR-0047).
 *
 * Depends only on `zod` and `@forge/contracts`, so the bridge can mount it
 * today and a standalone distribution stays a packaging exercise rather
 * than a rewrite.
 */

export { parseScriptReference, type ParseOptions } from "./catalog/parse.js";
export { generateCatalog, CATALOG_FILENAME } from "./catalog/generate.js";
export type { GenerateCatalogInput, GenerateCatalogResult } from "./catalog/generate.js";
export { loadCatalog, catalogProvenance, type CatalogProvenance } from "./catalog/load.js";
export {
  EE_TARGETS,
  TARGET_2024,
  TARGET_2026,
  findTarget,
  requireTarget,
  type EETarget,
  type DialogueRestore,
} from "./targets.js";
export {
  PROJECT_MIGRATIONS,
  ProjectImportError,
  documentVersion,
  importProject,
  preserveUnmodelled,
  migrateProjectDocument,
  serializeProject,
  type MigratedDocument,
  type MigrationStep,
  type ProjectImport,
} from "./project/migrate.js";
export { detectInstallTarget, installEvidence } from "./scan/detect.js";

export {
  scanInstall,
  listPackEntries,
  DEFAULT_EE_VERSION,
  type ScanOptions,
} from "./scan/install.js";
export { mirrorInstallAssets, type MirrorResult } from "./scan/assets.js";

// Putting a build where EE will find it. Node-only, like the scanner: the
// editor reaches it through the bridge, never from the browser.
export {
  installBuild,
  previewInstall,
  type InstallFileAction,
  type InstallPreview,
  requireShipTemplates,
  type InstallOptions,
  type InstallResult,
  type InstallStatus,
  type RequireResult,
} from "./install.js";
export {
  parseStatements,
  splitStatements,
  stripComments,
  type LuaArg,
  type LuaCall,
  type LuaStatement,
} from "./scan/lua-data.js";

export {
  CodegenError,
  renderChain,
  renderGlobalCall,
  validateCall,
  luaString,
  luaTable,
  jsonToLua,
  renderValue,
  str,
  num,
  type LuaValue,
} from "./codegen/lua.js";
export { emitMap } from "./codegen/map.js";
export { emitContent, emitTemplates } from "./codegen/content.js";
export {
  extensionFor,
  extensionSites,
  isExtensionAction,
  usesExodusSteps,
  collectActionSites,
  type ActionSite,
  type BuildMode,
  type ExodusAction,
  type ExtensionActionSite,
  type ExtensionContext,
  type ForgeExtension,
} from "./extensions.js";
export {
  emitLogic,
  makeBuildContext,
  type BuildContext,
  emitAction,
  emitPredicate,
  luaRuntime,
  runtimeNames,
  type RuntimeNames,
} from "./codegen/logic.js";
export {
  buildProject,
  assertTargetsAgree,
  validateExodusSteps,
  validateProject,
  type BuildFile,
  type BuildOptions,
  type BuildResult,
} from "./codegen/build.js";

export {
  CALLSIGN_PATTERN,
  TYPE_CODES,
  FORMATION_CODES,
  ROLE_CODES,
  callsignPrefix,
  nextCallsign,
  memberCallsign,
  existingCallsigns,
  groupByCallsignPrefix,
  type CallsignOptions,
} from "./editor/callsigns.js";
export {
  generateBrush,
  brushAt,
  brushSubCode,
  type Brush,
  type BrushSpec,
  type BeltBrush,
  type ClusterBrush,
  type FieldBrush,
  type ScatterPoint,
} from "./editor/brushes.js";
export { createObject, uniqueObjectId, type CreateObjectOptions } from "./editor/factories.js";
export {
  ACTION_SPECS,
  PREDICATE_SPECS,
  describePredicate,
  describeTargetRef,
  emptyAction,
  emptyPredicate,
  isExodusAction,
  isUnsetRef,
  UNSET_REF,
  type ActionKind,
  type LogicFieldSpec,
  type LogicKindSpec,
  type LogicWidget,
  type RefDefaults,
  type PredicateKind,
} from "./editor/logic-forms.js";
export {
  addAction,
  addCondition,
  moveAction,
  readRecord,
  removeAction,
  removeCondition,
  replaceRecord,
  setActions,
  setField,
  writeRecord,
  type LogicOwner,
  type LogicPath,
  type LogicSlot,
} from "./editor/logic-edits.js";
export { toMermaid } from "./editor/flowchart.js";

/**
 * DMX rigs (ADR-0040). Not codegen: EmptyEpsilon has no DMX Lua API, so a
 * rig renders to `hardware.ini` rather than to a scenario.
 */
export { writeHardwareIni, renderDmxValue } from "./dmx/write.js";
export { readHardwareIni, parseDmxValue, type DmxReadResult } from "./dmx/read.js";
export {
  evaluateRig,
  danglingDmxTargets,
  type DmxOutput,
  type DmxTriggerValues,
} from "./dmx/evaluate.js";
export {
  triggerValues,
  EE_TO_DMX_SYSTEM,
  DMX_TRIGGER_CAVEATS,
  DMX_UNREADABLE_TRIGGERS,
} from "./dmx/triggers.js";
export {
  collapseLevels,
  dmxLevel,
  dmxValueOf,
  expandLevels,
  expandValues,
  fixtureColor,
  fixtureValueColor,
  hasColorRoles,
  slotEntry,
  virtualTypesFor,
  withFixtureColor,
  withFixtureValueColor,
  type DmxRgb,
} from "./dmx/color.js";

export {
  FIELD_SPECS,
  fieldsFor,
  fieldDoc,
  type FieldSpec,
  type FieldWidget,
  type OptionSource,
} from "./editor/fields.js";

export {
  simulate,
  describeAction,
  type SimEvent,
  type SimExodus,
  type SimExodusEvent,
  type SimOutcome,
  type SimFiring,
  type SimOptions,
  type SimResult,
} from "./logic/simulate.js";

export {
  VANILLA_COMPATIBILITY,
  describeCompatibility,
  extensionCompatibility,
  vanillaCompatibility,
} from "./compatibility.js";
