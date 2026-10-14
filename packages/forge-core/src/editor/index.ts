/**
 * Browser-safe entry point: `@forge/core/editor`.
 *
 * The package root pulls in the catalog generator and the install
 * scanner, which are Node-only (`node:fs`, `node:path`) — bundling them
 * into the editor fails, and rightly so. Everything re-exported here is
 * pure: no filesystem, no process, no I/O.
 *
 * That split is also the honest boundary of the shared logic. Callsign
 * assignment, scatter brushes, object factories and field descriptors are
 * used by BOTH the editor UI and the tests that keep the emitters
 * truthful, so they live in the toolkit rather than being duplicated in
 * the React app.
 */

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
  type FormationCode,
  type RoleCode,
} from "./callsigns.js";

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
} from "./brushes.js";

export {
  createBeam,
  createObject,
  createTemplate,
  createTube,
  projectIdFor,
  stockTemplateNamed,
  templateFromStock,
  starterProject,
  createMarker,
  uniqueObjectId,
  type CreateObjectOptions,
} from "./factories.js";

export { blankPlace, shownPlace } from "./logic-forms.js";

export {
  REPLY_TARGET_KINDS,
  describeReplyTarget,
  emptyDialogue,
  emptyNode,
  emptyReply,
  referencesToNode,
  renameNode,
  uniqueDialogueId,
  uniqueNodeId,
} from "./dialogue-forms.js";

export { danglingMarkerIds, markerIndex, resolvePoint } from "../points.js";

export { writeHardwareIni, renderDmxValue } from "../dmx/write.js";
export { readHardwareIni, parseDmxValue, type DmxReadResult } from "../dmx/read.js";
export {
  evaluateRig,
  danglingDmxTargets,
  type DmxOutput,
  type DmxTriggerValues,
} from "../dmx/evaluate.js";
export {
  triggerValues,
  DMX_TRIGGER_CAVEATS,
  DMX_UNREADABLE_TRIGGERS,
} from "../dmx/triggers.js";
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
} from "../dmx/color.js";


export {
  FIELD_SPECS,
  SPAWN_ORDER_OPTIONS,
  blankSpawnOrder,
  fieldsFor,
  fieldDoc,
  type FieldSpec,
  type FieldWidget,
  type OptionSource,
} from "./fields.js";

export { DEFAULT_SIZE_RANGE } from "./brushes.js";

export {
  applyMarquee,
  markersInRect,
  objectsInRect,
  rectBetween,
  type WorldRect,
} from "./selection.js";

export {
  GROUP_ID_KEYS,
  SECTOR_ID_KEYS,
  MARKER_ID_KEYS,
  OBJECT_ID_KEYS,
  checkMarkerId,
  checkObjectId,
  describeIdProblem,
  renameMarker,
  renameObject,
  type IdProblem,
} from "./rename.js";

export { instancesOfTemplate, objectsUsingTemplate, retargetTemplate, type TemplateInstance } from "./retarget.js";

export {
  previewClassFor,
  resolveShipModel,
  type ShipPreviewModel,
} from "./ship-preview.js";

export { plannedBundle, type PlannedFile } from "./bundle.js";

export {
  diagnose,
  problemsFor,
  sortProblems,
  type DiagnoseOptions,
  type Problem,
  type ProblemLocation,
  type ProblemSeverity,
} from "./problems.js";

export {
  describePreview,
  describeTemplateResources,
  type ResourceReport,
  type ResourceState,
  type TemplateNeeds,
} from "./ship-resources.js";

export {
  TEMPLATE_SECTIONS,
  searchTemplateFields,
  sectionOfField,
  sectionOfGroup,
  templateSections,
  type TemplateFieldMatch,
  type TemplateSection,
  type TemplateSectionContent,
  type TemplateSectionId,
} from "./template-sections.js";

export {
  TEMPLATE_FIELDS,
  templateFieldDoc,
  templateFieldGroups,
} from "./template-fields.js";

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
} from "./logic-forms.js";
export {
  addAction,
  addCondition,
  mapDialogues,
  moveAction,
  readRecord,
  removeAction,
  removeCondition,
  replaceRecord,
  setActions,
  setConditions,
  setField,
  writeRecord,
  type LogicOwner,
  type LogicPath,
  type LogicSlot,
} from "./logic-edits.js";
export { toMermaid } from "./flowchart.js";

/**
 * The narrative dry-run. Pure model execution — no filesystem, no EE — so
 * the editor runs the very same executor the parity test uses as its
 * oracle. Two consumers, one semantics.
 */
export {
  describeAction,
  simulate,
  type SimEvent,
  type SimExodus,
  type SimExodusEvent,
  type SimOutcome,
  type SimFiring,
  type SimOptions,
  type SimResult,
} from "../logic/simulate.js";

export {
  ALTERNATIVE_CHOICES,
  addStep,
  alternativeFor,
  choiceOf,
  nextStepId,
  patchAlternative,
  removeStep,
  setStepActions,
  setStepChoice,
  setStepEssential,
  setStepAnswerWithin,
  stepActions,
  vanillaReadiness,
  type AlternativeChoice,
  type VanillaReadiness,
} from "./exodus-steps.js";

export {
  findReferences,
  groupSpawners,
  describeVia,
  type Reference,
  type ReferenceOwner,
  type ReferenceTarget,
} from "./references.js";

export {
  NO_FILTER,
  duplicateNames,
  filterScene,
  hiddenSelected,
  isFiltering,
  sceneEntries,
  typesInScene,
  type SceneEntry,
  type SceneFilter,
} from "./scene.js";

export {
  SECTION_ORDER,
  sectionOf,
  sectionedFields,
  type FieldSection,
  type FieldSectionGroup,
} from "./field-sections.js";

export {
  buildDiagram,
  describeEdge,
  summarizeActions,
  type DiagramEdge,
  type DiagramEdgeKind,
  type DiagramModel,
  type DiagramNode,
  type DiagramNodeKind,
} from "./diagram.js";

export { variableInfos, type VariableInfo, type VariableUse } from "./variables.js";

export {
  NO_VIEW_PREFS,
  blockOfObject,
  describeBlock,
  dropUnshown,
  exitIsolation,
  firstBlock,
  groupOfObject,
  groupsInView,
  inSector,
  isGroupLocked,
  isGroupShown,
  isolate,
  parseViewPrefs,
  pruneViewPrefs,
  setOpenSector,
  showAll,
  shownGroups,
  shownMarkers,
  sweepableGroups,
  toggleHidden,
  toggleLocked,
  type PrunedSelection,
  type ViewBlock,
  type ViewPrefs,
} from "./view-state.js";

export {
  INITIAL_SECTOR_ID,
  INITIAL_SECTOR_LABEL,
  SHARED_LABEL,
  addSector,
  assignGroupToSector,
  assignMarkerToSector,
  checkSectorLabel,
  countsOfSector,
  danglingSectors,
  describeCounts,
  duplicateSectorIds,
  groupsOfSector,
  markersOfSector,
  removeSector,
  sectorHeldBy,
  setStartSector,
  renameSector,
  sectorById,
  sectorLabel,
  sectorOfGroup,
  sectorOfMarker,
  sectorOfObject,
  type DanglingSector,
  type SectorCounts,
  type SectorRef,
} from "./sectors.js";

export { usesSectorRuntime, sectorIssues, sectorReferences, type SectorIssue } from "../sector-runtime.js";
