import { useMemo } from "react";
import { create } from "zustand";
import { resetIconAvailability } from "../canvas/icon-availability.js";
import { bumpAssetEpoch } from "../api/transport.js";
import type { MissionTabId } from "../ui/glossary.js";
import { clampPanelWidth, PANEL_DEFAULT } from "../ui/split.js";
import {
  type EEBeat,
  type EECatalog,
  type EEGmButton,
  type EELibrary,
  type EELogic,
  type EEDialogue,
  type EEDmxRig,
  type EEDmxTriggerReading,
  type EEDialogueNode,
  type EEDialogueReply,
  type EEMapGroup,
  type EEMarker,
  type EEPointRef,
  type EEObject,
  type EEProject,
  type EERule,
  type EETemplateDef,
  type EEVariable,
  type ForgeBuildMode,
  type ForgeBuildResult,
  type ForgeInstallation,
  type ForgeProjectSummary,
  type SpawnableClass,
  type Vec2,
} from "@forge/contracts";
import {
  DEFAULT_SIZE_RANGE,
  brushAt,
  brushSubCode,
  createMarker,
  createObject,
  emptyDialogue,
  emptyNode,
  emptyReply,
  mapDialogues,
  referencesToNode,
  renameNode as renameNodeInDialogue,
  uniqueDialogueId,
  uniqueNodeId,
  createTemplate,
  danglingMarkerIds,
  emptyPredicate,
  projectIdFor,
  existingCallsigns,
  generateBrush,
  nextCallsign,
  objectsUsingTemplate,
  renameMarker as renameMarkerInProject,
  renameObject as renameInProject,
  retargetTemplate,
  setField,
  stockTemplateNamed,
  templateFromStock,
  uniqueObjectId,
  type Brush,
  type BrushSpec,
  type LogicPath,
  NO_FILTER,
  NO_VIEW_PREFS,
  type ViewPrefs,
  addSector as addSectorTo,
  assignGroupToSector,
  assignMarkerToSector,
  describeBlock,
  describeCounts,
  dropUnshown,
  groupsInView,
  inSector,
  removeSector as removeSectorFrom,
  renameSector as renameSectorIn,
  sectorLabel,
  setOpenSector as setOpenSectorPrefs,
  setStartSector as setStartSectorIn,
  exitIsolation as exitViewIsolation,
  firstBlock,
  isGroupLocked,
  isGroupShown,
  isolate as isolateInView,
  parseViewPrefs,
  pruneViewPrefs,
  showAll as showAllInView,
  toggleHidden,
  toggleLocked,
  type ReferenceOwner,
  TEMPLATE_FIELDS,
  type ProblemLocation,
  type SceneFilter,
  type TemplateSectionId,
  sectionOfField,
} from "@forge/core/editor";
import {
  buildDmxRig,
  buildProjectOnBridge,
  createProject,
  fetchCatalog,
  fetchLibrary,
  fetchLibrarySource,
  fetchProject,
  fetchDmxRig,
  fetchDmxTriggers,
  fetchProjects,
  importDmxRig,
  rescanLibrary as rescanLibraryOnBridge,
  saveDmxRig,
  saveProject,
} from "../api/client.js";
import { getDesktop } from "../api/desktop.js";
import { setAssetInstall, setAssetTarget } from "../api/transport.js";
import { outcomeFromBuild, type VerificationRecord } from "../ui/verification.js";
import { DEFAULT_CAMERA, type Camera } from "../canvas/geometry.js";

/**
 * Editor state.
 *
 * The project document is the single source of truth here exactly as it is
 * on disk (ADR-0034 §1) — every mutation produces a new `EEProject` that
 * would round-trip through the schema unchanged. Nothing derived is stored
 * alongside it, so "what you see" and "what gets built" cannot drift.
 */

/**
 * What the next click on the map does.
 *
 * `scatter` carries no settings of its own: the brush lives beside it in
 * the store, so the armed tool and the panel's controls cannot disagree —
 * change the radius with the brush armed and the preview under the cursor
 * changes with it.
 */
export type Tool =
  | { kind: "select" }
  | { kind: "place"; type: SpawnableClass }
  /**
   * A marker is not a `SpawnableClass` and never will be — it is not an EE
   * class (ADR-0038) — so it gets its own tool rather than a fifteenth
   * entry in a list that means "things EmptyEpsilon can construct".
   */
  | { kind: "marker" }
  | { kind: "scatter" };

/** A belt of fourteen asteroids at 15 U — the shape most maps start from. */
const DEFAULT_BRUSH: BrushSpec = {
  kind: "belt",
  seed: "belt-01",
  count: 14,
  radius: 15000,
  sizeRange: DEFAULT_SIZE_RANGE,
};

export interface EditorState {
  catalog: EECatalog | null;
  library: EELibrary | null;
  /**
   * Where EmptyEpsilon is installed.
   *
   * Remembered rather than retyped: three separate actions need it — the
   * DMX import, the DMX install, and re-indexing the library — and an
   * author should say where their game lives once.
   */
  eeDir: string;
  projects: readonly ForgeProjectSummary[];
  project: EEProject | null;
  dirty: boolean;

  activeGroupId: string | null;
  selection: readonly string[];
  /**
   * Selected markers, kept apart from the objects because the two are
   * different namespaces: an object and a marker may share an id, and
   * every operation has to know which of the two it is holding.
   */
  markerSelection: readonly string[];
  tool: Tool;
  /** Settings for the scatter brush; its centre comes from the map click. */
  brush: BrushSpec;
  brushType: SpawnableClass;
  camera: Camera;
  /** Snap step in game units; 0 disables snapping. */
  snap: number;

  status: string | null;
  error: string | null;
  lastBuild: ForgeBuildResult | null;

  /**
   * Edits to the document since it was opened. Every result (a check, an install, an export) is stamped with the
   * revision it was made from, so a result that no longer describes the document can say so. `savedRevision` is
   * the revision on disk: when they differ the document has unsaved changes.
   */
  revision: number;
  savedRevision: number;
  /** Counts the documents that have been put on screen (open, new, projects folder changed). An answer to a request made for an earlier one is dropped. */
  session: number;
  /** The last Verify or Install, and what it was about. Null until one has run for the open project. */
  verification: VerificationRecord | null;
  /** The installation whose scan the library (and so every reference check) comes from; null = none scanned. */
  libraryInstall: ForgeInstallation | null;
  /** Use another installation's scan of the project's engine (null = the active one). */
  useInstallLibrary: (installId: string | null) => Promise<void>;
  problemsOpen: boolean;
  setProblemsOpen: (open: boolean) => void;
  /** Go to what a problem is about: the view, the section and, where there is one, the field. */
  openProblem: (where: ProblemLocation) => void;
  /** A field the Fleet form should move to when it next renders (consumed by the form). */
  shipJump: string | null;
  clearShipJump: () => void;

  bootstrap: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  /** Create a scenario from scratch and open it. */
  newProject: (name: string) => Promise<void>;
  save: () => Promise<void>;
  /** `install` also copies the bundle into the EE directory in `eeDir`. */
  /** `mode: "vanilla"` exports without any EXODUS code, whatever the host could do. */
  build: (install?: boolean, mode?: ForgeBuildMode, overwrite?: boolean) => Promise<VerificationRecord | null>;

  setTool: (tool: Tool) => void;
  setBrush: (patch: Partial<BrushSpec>) => void;
  setBrushType: (type: SpawnableClass) => void;
  setCamera: (camera: Camera) => void;
  setSnap: (snap: number) => void;
  setActiveGroup: (groupId: string) => void;
  /**
   * How the map is looked at: which groups are hidden, locked or isolated. Editor state, not the document — it
   * never marks the project unsaved, never reaches the Lua, and is remembered per project (see `readViewPrefs`).
   */
  viewPrefs: ViewPrefs;
  /** A line of explanation shown over the map after a jump to something in another sector ("Opened System B to show…"). */
  viewNotice: string | null;
  dismissViewNotice: () => void;
  /** Open a sector (null = All sectors). What was selected and is no longer in it is deselected, and it says so. */
  setOpenSector: (sector: string | null) => void;
  /** Create a sector and open it. Returns the reason it was refused, or null. */
  addSector: (label: string) => string | null;
  renameSector: (id: string, label: string) => string | null;
  /** Delete a sector; a non-empty one needs `destination` (another sector id, or null for Shared). Returns the reason it was refused, or null. */
  deleteSector: (id: string, destination?: string | null) => string | null;
  /** File a group under a sector (null = Shared). Nothing else about it changes — not its objects, its rules, its order. */
  moveGroupToSector: (groupId: string, sector: string | null) => void;
  moveMarkerToSector: (markerId: string, sector: string | null) => void;
  /** Where the next marker goes when the map shows All sectors (undefined = not chosen yet). */
  markerSector: string | null | undefined;
  setMarkerSector: (sector: string | null | undefined) => void;
  /** The sector the GAME starts in (document), not the one open in the editor; null = the legacy behaviour (ADR-0056). */
  setStartSector: (sector: string | null) => void;
  /** Campaign saves (ADR-0058): turn the project's opt-in on or off. */
  setCampaignPersistence: (enabled: boolean) => void;
  /** Go to a group (making it the active one), opening its sector. */
  focusGroup: (groupId: string) => void;
  /** Go to a marker, opening its sector. */
  focusMarker: (markerId: string) => void;
  toggleGroupHidden: (groupId: string) => void;
  toggleGroupLocked: (groupId: string) => void;
  isolateGroup: (groupId: string) => void;
  exitIsolation: () => void;
  showAllGroups: () => void;
  /** Select one object wherever it lives: its group becomes the active one, the selection is exactly it. */
  focusObject: (id: string) => void;
  /** The scene search, remembered across views: filtering only changes what the list shows, never the selection. */
  sceneFilter: SceneFilter;
  setSceneFilter: (patch: Partial<SceneFilter>) => void;
  /** Groups whose object list is folded away in the scene panel (UI state, not part of the project). */
  collapsedGroups: readonly string[];
  toggleGroupCollapsed: (groupId: string, collapsed?: boolean) => void;
  /** Which section of the Mission view is showing (UI state only; kept when switching views). */
  missionTab: MissionTabId;
  /** Fleet: the section of the ship form on show. A view concern, kept across template switches. */
  shipSection: TemplateSectionId;
  setShipSection: (section: TemplateSectionId) => void;
  /**
   * Where "back" goes after opening something from another view (an instance of a template, from Fleet). Set only
   * by {@link EditorState.openInstance}; any other view change clears it, so it never offers a stale way back.
   */
  returnTo: { readonly view: EditorView; readonly label: string } | null;
  openInstance: (objectId: string, from: { readonly view: EditorView; readonly label: string }) => void;
  returnToPrevious: () => void;
  setMissionTab: (tab: MissionTabId) => void;
  /** Go to a rule, beat, button, dialogue node or object that holds a reference ("Used by"). */
  openReference: (owner: ReferenceOwner) => void;
  select: (ids: readonly string[]) => void;
  selectMarkers: (ids: readonly string[]) => void;

  placeAt: (position: Vec2) => void;
  moveSelection: (delta: Vec2) => void;
  updateObject: (id: string, patch: Partial<EEObject>) => void;
  updateMarker: (id: string, patch: Partial<Omit<EEMarker, "id">>) => void;
  /** Change a marker's id, carrying every place that names it along. */
  renameMarker: (from: string, to: string) => void;
  /** Change an object's id, carrying every reference to it along. */
  renameObject: (from: string, to: string) => void;
  deleteSelection: () => void;
  applyBrush: (brush: Brush, type: SpawnableClass) => void;
  /** Run the armed scatter tool at a point on the map. */
  scatterAt: (center: Vec2) => void;

  /** `sector` is where the group is filed (null = Shared); the panel asks when the map shows All sectors. */
  addGroup: (label: string, when: EEMapGroup["when"], sector: string | null) => void;
  updateGroup: (id: string, patch: Partial<Pick<EEMapGroup, "label" | "when">>) => void;
  deleteGroup: (id: string) => void;

  // --- narrative -----------------------------------------------------------
  /** Which half of the editor is on screen. */
  view: EditorView;
  setView: (view: EditorView) => void;
  /** The beat, rule or GM button being edited, or null. */
  logicSelection: LogicSelection | null;
  selectLogic: (selection: LogicSelection | null) => void;
  /**
   * A pending request to choose something by clicking the map — set by a
   * narrative form, answered by the canvas. The form never has to know how
   * the map works, and the author never types an id.
   */
  pick: PickRequest | null;
  /** The view that asked for the pick, so answering or cancelling returns there (Mission or Dialogues). */
  pickFrom: EditorView;
  requestPick: (request: PickRequest) => void;
  cancelPick: () => void;
  /** Answer a pending pick; ignored when nothing is pending. */
  resolvePick: (value: PickAnswer) => void;

  /**
   * Apply any transform to the narrative. Every control in the narrative
   * panels goes through this with a helper from the toolkit, so no panel
   * assembles its own copy of the document.
   */
  applyLogic: (fn: (logic: EELogic) => EELogic) => void;
  /** Which action row is expanded; purely a view concern. */
  openActionIndex: number | null;
  setOpenActionIndex: (index: number | null) => void;

  addBeat: (at: number) => void;
  updateBeat: (id: string, patch: Partial<Omit<EEBeat, "id">>) => void;
  deleteBeat: (id: string) => void;
  addRule: () => void;
  updateRule: (id: string, patch: Partial<Omit<EERule, "id">>) => void;
  deleteRule: (id: string) => void;
  addGmButton: () => void;
  updateGmButton: (id: string, patch: Partial<Omit<EEGmButton, "id">>) => void;
  deleteGmButton: (id: string) => void;
  setVariables: (variables: readonly EEVariable[]) => void;

  // --- dialogues (ADR-0039) -----------------------------------------------
  addDialogue: (label: string) => void;
  updateDialogue: (id: string, patch: Partial<Omit<EEDialogue, "id" | "nodes">>) => void;
  deleteDialogue: (id: string) => void;
  addNode: (dialogueId: string) => void;
  updateNode: (dialogueId: string, nodeId: string, patch: Partial<Omit<EEDialogueNode, "id">>) => void;
  renameNode: (dialogueId: string, from: string, to: string) => void;
  deleteNode: (dialogueId: string, nodeId: string) => void;
  addReply: (dialogueId: string, nodeId: string) => void;
  updateReply: (
    dialogueId: string,
    nodeId: string,
    index: number,
    patch: Partial<EEDialogueReply>,
  ) => void;
  removeReply: (dialogueId: string, nodeId: string, index: number) => void;

  // --- DMX (ADR-0040) ------------------------------------------------------
  /**
   * The rig, and the live trigger reading behind the preview.
   *
   * Deliberately *not* part of `project`: `hardware.ini` describes the
   * room's lights, and every DMX trigger is ship telemetry, so there is
   * nothing scenario-specific to put in a project document. It is loaded
   * and saved on its own, beside `ee-library.json`.
   */
  rig: EEDmxRig | null;
  rigDirty: boolean;
  dmxTriggers: EEDmxTriggerReading | null;
  /** What an import could not read, kept until the author has seen it. */
  dmxWarnings: readonly string[];

  loadRig: () => Promise<void>;
  saveRig: () => Promise<void>;
  setEeDir: (eeDir: string) => void;
  rescanLibrary: () => Promise<void>;
  importRig: (eeDir: string) => Promise<void>;
  buildRig: (install: string | null) => Promise<void>;
  refreshDmxTriggers: () => Promise<void>;
  /** Any change to the rig, mirroring `applyLogic` for the narrative. */
  applyRig: (fn: (rig: EEDmxRig) => EEDmxRig) => void;

  // --- ship templates ------------------------------------------------------
  /**
   * Width of the Ship view's diagram column, in px.
   *
   * The arcs, the deck plan and the likeness are all drawn from a
   * `viewBox`, so this is the zoom control for all three.
   */
  shipPanelWidth: number;
  setShipPanelWidth: (width: number) => void;
  /** Which template the Ship view is editing, or null. */
  selectedTemplateId: string | null;
  /**
   * Which **stock** hull the Ship view is showing, by name.
   *
   * A separate slot from `selectedTemplateId` because the two are different
   * things: one is a document the author edits, the other is a reading of
   * the install shown read-only. Selecting either clears the other.
   */
  selectedStockTemplate: string | null;
  /**
   * A copy that left map objects behind, and the offer to move them.
   *
   * Null once accepted or dismissed. Held in the store rather than in the
   * panel so it survives switching views — an author who copies a hull and
   * goes back to the map should still be told.
   */
  pendingRetarget: { readonly from: string; readonly to: string } | null;
  selectTemplate: (id: string | null) => void;
  selectStockTemplate: (name: string | null) => void;
  addTemplate: (name: string) => void;
  /** A variant that starts as `ShipTemplate("<base>"):copy(...)`. */
  copyTemplate: (id: string) => void;
  /** Materialise a stock hull as a project template of its own (ADR-0041). */
  copyStockTemplate: (stockName: string) => void;
  applyRetarget: () => void;
  dismissRetarget: () => void;
  updateTemplate: (id: string, patch: Partial<EETemplateDef>) => void;
  deleteTemplate: (id: string) => void;
}

export type EditorView = "map" | "narrative" | "ship" | "dialogues" | "dmx";

/** What the narrative panels are editing right now. */
export type LogicSelection =
  | { readonly kind: "beat"; readonly id: string }
  | { readonly kind: "rule"; readonly id: string }
  | { readonly kind: "gmButton"; readonly id: string }
  /** One node of one dialogue — what the conversation editor edits. */
  | { readonly kind: "dialogueNode"; readonly id: string; readonly nodeId: string };

/**
 * A form asking the map a question.
 *
 * The answer is applied through the same `LogicPath` the form edits with,
 * so the store needs no case per field and the panel needs no knowledge of
 * how the canvas works. The author never types an object id.
 */
export interface PickRequest {
  readonly want: "object" | "zone" | "point";
  readonly path: LogicPath;
  readonly key: string;
  /** Shown on the canvas so the author knows what they are choosing. */
  readonly prompt: string;
}

export type PickAnswer =
  | { readonly kind: "object"; readonly objectId: string }
  | { readonly kind: "point"; readonly position: Vec2 };

/**
 * What the toolbar says after a delete.
 *
 * Deleting a marker is quiet in a way deleting an object is not: the
 * records that named it are in another view, they still look complete, and
 * only the build would object. So the count is not enough — the message
 * names the references that just broke.
 */
/**
 * What a build says when it is done.
 *
 * The restart is the part an author loses an evening to: EE reads ship
 * templates once, at launch, so a hull installed into a running game does
 * not exist no matter how many times the scenario is reloaded. It is said
 * last, in the status line, in those words.
 */
/** The status bar holds one line; the whole message is in the Problems panel's last-check record. */
const shortForStatusBar = (message: string): string => (message.length > 160 ? `${message.slice(0, 157)}… — see Problems` : message);

const TEMPLATE_FIELD_LOOKUP = (key: string): TemplateSectionId | null => {
  const spec = TEMPLATE_FIELDS.find((f) => f.key === key);
  return spec === undefined ? null : sectionOfField(spec);
};

export function buildStatus(result: ForgeBuildResult): string {
  const warnings =
    result.warnings.length > 0 ? ` — ${result.warnings.length} warning(s)` : "";
  const built = `Built ${result.files.length} file(s)${result.mode === "integrated" ? " (with EXODUS, alternatives as fallback)" : ""}${warnings}`;
  if (result.install === null) return built;
  const install = result.install;

  // "Installed" is said only for a complete install. A refusal, a rollback or a missing require line
  // is reported as what it is — never as a success with a footnote.
  switch (install.status) {
    case "refused":
      return `${built}. NOT installed — ${install.error ?? "refused"}`;
    case "rolled-back":
      return `${built}. NOT installed — ${install.error ?? "the install failed and was rolled back"}`;
    case "rollback-failed":
      return `${built}. INSTALL FAILED and the install is only partly restored — ${install.error ?? ""}`;
    case "installed-pending":
      return `${built}. Files copied (${install.installed.length}) but NOT active — ${install.error ?? "a manual step is missing"}`;
    case "installed": {
      const backup = install.backupDir !== null ? ` Originals backed up.` : "";
      const restart = launchSummary(result);
      return `${built}. Installed ${install.installed.length} file(s)${install.unchanged.length > 0 ? `, ${install.unchanged.length} already up to date` : ""}.${backup}${restart}`;
    }
  }
}

/** What exists only after EE restarts, said apart from the scenario files. */
export function launchSummary(result: ForgeBuildResult): string {
  const { templates, models } = result.launchItems;
  if (templates.length === 0 && models.length === 0) return "";
  const parts = [
    templates.length > 0 ? `ship templates (${templates.join(", ")})` : "",
    models.length > 0 ? `models (${models.join(", ")})` : "",
  ].filter((part) => part !== "");
  return ` Restart EmptyEpsilon: ${parts.join(" and ")} load at launch, not with the scenario.`;
}

function deleteStatus(
  next: EEProject,
  objects: number,
  markers: number,
  orphanedOrbit: boolean,
): string {
  const dangling = danglingMarkerIds(next);
  const parts: string[] = [];
  if (objects > 0) parts.push(`${objects} object(s)`);
  if (markers > 0) parts.push(`${markers} marker(s)`);
  const deleted = `Deleted ${parts.join(" and ")}`;
  if (dangling.length > 0) {
    return `${deleted} — still referenced: ${dangling.join(", ")}. Those records will not build.`;
  }
  if (orphanedOrbit) {
    return `${deleted} — an orbit pointed at a removed object; fix it before building.`;
  }
  return deleted;
}

function allObjects(project: EEProject): EEObject[] {
  return project.map.groups.flatMap((g) => g.objects);
}

function takenIds(project: EEProject): Set<string> {
  return new Set(allObjects(project).map((o) => o.id));
}

/** Apply a transform to the objects of one group, leaving the rest alone. */
function mapGroup(
  project: EEProject,
  groupId: string,
  fn: (objects: readonly EEObject[]) => EEObject[],
): EEProject {
  return {
    ...project,
    map: {
      ...project.map,
      groups: project.map.groups.map((group) =>
        group.id === groupId ? { ...group, objects: fn(group.objects) } : group,
      ),
    },
  };
}

function withLogic(project: EEProject, fn: (logic: EELogic) => EELogic): EEProject {
  return { ...project, logic: fn(project.logic) };
}

/**
 * The shape every narrative mutation shares: transform the logic, mark the
 * document dirty, and do nothing at all when no project is open.
 */
function patchLogic(
  state: { project: EEProject | null },
  fn: (logic: EELogic) => EELogic,
): { project: EEProject | null; dirty: boolean } {
  if (state.project === null) return { project: null, dirty: false };
  return { project: withLogic(state.project, fn), dirty: true };
}

function mapAllObjects(project: EEProject, fn: (object: EEObject) => EEObject): EEProject {
  return {
    ...project,
    map: {
      ...project.map,
      groups: project.map.groups.map((group) => ({
        ...group,
        objects: group.objects.map(fn),
      })),
    },
  };
}

/** A template name not already used in this project. */
function uniqueTemplateName(project: EEProject, base: string): string {
  const taken = new Set(project.templates.map((t) => t.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * Apply a template rename everywhere the old name was a reference.
 *
 * Templates are referenced by *name*, not by id — that is EE's own model,
 * since `setTemplate("Atlantis")` is a string. So a rename that only
 * touched the template itself would silently orphan the map objects and the
 * variants that copy it, and the break would surface as a build error much
 * later.
 */
function renameTemplate(project: EEProject, from: string, after: EETemplateDef): EEProject {
  const templates = project.templates.map((t) =>
    t.id === after.id ? after : t.copyOf === from ? { ...t, copyOf: after.name } : t,
  );
  return mapAllObjects({ ...project, templates }, (object) =>
    "template" in object && object.template === from
      ? { ...object, template: after.name }
      : object,
  );
}

/**
 * The install path survives a reload.
 *
 * The only thing in this editor that is a *preference* rather than
 * document state — where your copy of EmptyEpsilon lives does not belong
 * in a project, and retyping it every reload is what made it feel like
 * the editor had lost track of the install.
 */
const EE_DIR_KEY = "exodus.forge.eeDir";
const LAST_PROJECT_KEY = "exodus.forge.lastProject";

/** The project open when the editor was last used, so a restart returns to it rather than to the first in the list. */
function readLastProject(): string | null {
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}
function rememberProject(id: string): void {
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Not remembering is not worth failing the open over.
  }
}

/**
 * What the author hid, locked and isolated is remembered **per project**, beside (never inside) the document: a
 * view preference is not part of the scenario, so it must not travel with a copy, make the project "unsaved", or
 * reach the Lua. Keyed by the project id, so one project's state cannot colour another's.
 */
const VIEW_PREFS_KEY = "exodus.forge.view.";

export function readViewPrefs(projectId: string): ViewPrefs {
  try {
    const raw = window.localStorage.getItem(VIEW_PREFS_KEY + projectId);
    return raw === null ? NO_VIEW_PREFS : parseViewPrefs(JSON.parse(raw) as unknown);
  } catch {
    return NO_VIEW_PREFS;
  }
}

function writeViewPrefs(projectId: string, prefs: ViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY + projectId, JSON.stringify(prefs));
  } catch {
    // A view that is not remembered is a nuisance, not a failure.
  }
}

function readEeDir(): string {
  try {
    return window.localStorage.getItem(EE_DIR_KEY) ?? "";
  } catch {
    // Private-mode browsers throw on access rather than returning null.
    return "";
  }
}

/**
 * How wide the Ship view's diagram column is, remembered between sessions.
 *
 * Layout, not document — it belongs beside `eeDir` rather than in the
 * project, because it is a fact about this screen and not about the
 * scenario. Clamped on read as well as on write: the window it was stored
 * from may have been wider than the one it is being restored into.
 */
const SHIP_PANEL_KEY = "exodus.forge.shipPanelWidth";

function readShipPanelWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(SHIP_PANEL_KEY));
    if (!Number.isFinite(stored) || stored <= 0) return PANEL_DEFAULT;
    return clampPanelWidth(stored, window.innerWidth);
  } catch {
    return PANEL_DEFAULT;
  }
}

/**
 * The API catalog and the scanned library for a project's own engine, plus the asset engine the page draws from.
 * An opened project and a newly created one both need them: without it a new scenario offers no stock faction or
 * template and every reference reads "not checked", until something else happens to load them.
 */
async function loadReference(
  project: EEProject,
  get: () => EditorState,
  set: (partial: Partial<EditorState>) => void,
): Promise<{ reference: { catalog: EECatalog | null; library: EELibrary | null } | null; installation: ForgeInstallation | null }> {
  // Textures and models are served per engine; point asset URLs at the
  // engine this project targets before anything is drawn.
  setAssetTarget(project.eeVersion);
  const { catalog: current } = get();
  let reference: { catalog: EECatalog | null; library: EELibrary | null } | null = null;
  let installation: ForgeInstallation | null = null;
  if (current === null || current.eeVersion !== project.eeVersion) {
    try {
      // The API catalog and the scanned library must describe the
      // project's own engine, not whichever one the editor opened first.
      const [catalog, source] = await Promise.all([fetchCatalog(project.eeVersion), fetchLibrarySource(project.eeVersion)]);
      reference = { catalog, library: source.library };
      installation = source.installation;
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  } else if (get().library?.eeVersion !== project.eeVersion) {
    const source = await fetchLibrarySource(project.eeVersion);
    reference = { catalog: current, library: source.library };
    installation = source.installation;
  }
  // The installation the author picked in the toolbar (desktop: a registered id) is the one whose scan the
  // checks use, when it is an installation of this project's engine — not whichever scan happened to be newest.
  const picked = getDesktop() !== null && get().eeDir !== "" ? await fetchLibrarySource(project.eeVersion, get().eeDir).catch(() => null) : null;
  if (picked !== null && picked.installation !== null && picked.installation.target === project.eeVersion) {
    reference = { catalog: reference?.catalog ?? current, library: picked.library };
    installation = picked.installation;
  }
  return { reference, installation };
}

/** The newest request to open a project; an older one that answers later is ignored. */
let openTicket = 0;

export const useEditor = create<EditorState>((set, get) => ({
  catalog: null,
  library: null,
  eeDir: readEeDir(),
  revision: 0,
  savedRevision: 0,
  session: 0,
  verification: null,
  libraryInstall: null,
  problemsOpen: false,
  shipJump: null,
  clearShipJump: () => set({ shipJump: null }),
  setProblemsOpen: (problemsOpen) => set({ problemsOpen }),
  shipPanelWidth: readShipPanelWidth(),
  projects: [],
  project: null,
  dirty: false,
  activeGroupId: null,
  viewPrefs: NO_VIEW_PREFS,
  viewNotice: null,
  markerSector: undefined,
  selection: [],
  tool: { kind: "select" },
  markerSelection: [],
  brush: DEFAULT_BRUSH,
  brushType: "Asteroid",
  camera: DEFAULT_CAMERA,
  snap: 100,
  status: null,
  error: null,
  lastBuild: null,

  bootstrap: async () => {
    const statusAtStart = get().status;
    try {
      const [catalog, library, list] = await Promise.all([
        fetchCatalog(),
        fetchLibrary(),
        fetchProjects(),
      ]);
      set({
        catalog,
        library,
        projects: list.projects,
        error: null,
        // What the author did while the first answers were on their way (cancelling a dialog, say) is not overwritten.
        status:
          get().status !== statusAtStart
            ? get().status
            : library === null
            ? // Also what a library written by an older toolkit looks like:
              // it no longer parses, the bridge logs why and serves null,
              // and Rescan is one button away rather than a CLI trip.
              "No usable install scan — register an EmptyEpsilon install (Install… / Installations…) and Rescan to index it."
            : `Library: ${library.templates.length} templates, ${library.factions.length} factions.`,
      });
      const remembered = readLastProject();
      const first = list.projects.find((p) => p.id === remembered) ?? list.projects[0];
      if (first !== undefined && get().project === null) {
        await get().openProject(first.id);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  newProject: async (name) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const ticket = ++openTicket;
    try {
      // The id is derived here so the author never types one, but the
      // bridge is the authority on collisions: it refuses an id that
      // already has a project.json rather than overwriting it.
      const taken = new Set(get().projects.map((p) => p.id));
      const { project } = await createProject(projectIdFor(taken, trimmed), trimmed, "");
      const list = await fetchProjects();
      const { reference, installation } = await loadReference(project, get, (partial) => set(partial));
      if (ticket !== openTicket) return;
      set({
        ...(reference !== null ? { catalog: reference.catalog, library: reference.library, libraryInstall: installation } : {}),
        projects: list.projects,
        project,
        dirty: false,
        selection: [],
        lastBuild: null,
        revision: 0,
        savedRevision: 0,
        session: get().session + 1,
        verification: null,
        view: "map",
        selectedTemplateId: null,
        logicSelection: null,
        ...openedView(project),
        status: `Created ${project.name} — one group, one player ship. Place away.`,
        error: null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  openProject: async (id) => {
    const ticket = ++openTicket;
    try {
      const project = await fetchProject(id);
      if (ticket !== openTicket) return; // a later request to open something has been made: this answer is for a document nobody asked for any more
      const { reference, installation } = await loadReference(project, get, (partial) => set(partial));
      if (ticket !== openTicket) return;
      set({
        ...(reference !== null ? { catalog: reference.catalog, library: reference.library, libraryInstall: installation } : {}),
        project,
        dirty: false,
        revision: 0,
        savedRevision: 0,
        session: get().session + 1,
        verification: null,
        selection: [],
        lastBuild: null,
        ...openedView(project),
        status: `Opened ${project.name}`,
        error: null,
      });
      rememberProject(project.id);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  save: async () => {
    const { project } = get();
    if (project === null) return;
    const savedRevision = get().revision;
    const session = get().session;
    try {
      const result = await saveProject(project);
      // Another document was put on screen while this was on its way: the file is saved, but this is not that document's state.
      if (get().session !== session) return;
      // An edit made while the save was in flight is not on disk: only the revision that was sent is saved.
      set({ dirty: get().revision !== savedRevision, savedRevision, status: `Saved at ${result.savedAt.slice(11, 19)}`, error: null });
    } catch (error) {
      if (get().session === session) set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  build: async (install = false, mode, overwrite = false) => {
    const { project, dirty, eeDir } = get();
    if (project === null) return null;
    const at = new Date().toISOString();
    const session = get().session;
    try {
      // Build reads project.json from disk, so an unsaved edit would build
      // the previous version — save first rather than silently lying.
      if (dirty) await get().save();
      if (get().session !== session) return null; // the author moved to another document while it was being saved
      if (get().dirty) {
        // The save did not take: checking the old file would describe a document that is no longer on screen.
        set({ error: "The project could not be saved, so it was not checked." });
        return null;
      }
      const revision = get().revision;
      const result = await buildProjectOnBridge(
        project.id,
        // The require line is EE's own file; patching it is the whole
        // point of installing from here, so it is not a second question.
        install && eeDir !== "" ? { eeDir, patchShipTemplates: true, overwrite } : null,
        mode ?? null,
        get().libraryInstall?.id ?? null,
      );
      // The answer is about a document that is no longer open: it is dropped, not shown as the open one's result.
      if (get().session !== session) return null;
      const outcome = outcomeFromBuild(result);
      const record: VerificationRecord = {
        kind: install ? "install" : "verify",
        projectId: project.id,
        projectName: project.name,
        revision,
        target: result.target === "" ? project.eeVersion : result.target,
        mode: result.mode,
        at,
        outcome,
        message: result.install?.error ?? null,
        warnings: [...result.warnings, ...(result.install?.warnings ?? [])],
        files: result.files,
        library: result.library,
        install: result.install,
        installation: result.install === null ? null : { id: eeDir, label: eeDir },
      };
      const failed = outcome === "failed" || outcome === "partial";
      // Long results live in the Problems panel; the status bar keeps one short line.
      set({
        lastBuild: result,
        verification: record,
        error: failed ? shortForStatusBar(buildStatus(result)) : null,
        status: failed ? null : buildStatus(result),
        problemsOpen: failed ? true : get().problemsOpen,
      });
      return record;
    } catch (error) {
      if (get().session !== session) return null;
      const message = error instanceof Error ? error.message : String(error);
      const record: VerificationRecord = {
        kind: install ? "install" : "verify",
        projectId: project.id,
        projectName: project.name,
        revision: get().revision,
        target: project.eeVersion,
        mode: mode ?? null,
        at,
        outcome: "refused",
        message,
        warnings: [],
        files: [],
        library: get().library === null ? null : { installId: get().libraryInstall?.id ?? null, label: get().libraryInstall?.label ?? get().library!.installPath, path: get().library!.installPath, eeVersion: get().library!.eeVersion, verified: get().libraryInstall?.verified ?? false, scannedAt: get().library!.scannedAt },
        install: null,
        installation: null,
      };
      set({ error: message.length > 140 ? `${install ? "Install" : "Verify"} refused — see Problems.` : message, lastBuild: null, verification: record, problemsOpen: true });
      return record;
    }
  },

  useInstallLibrary: async (installId) => {
    const { project } = get();
    if (project === null) return;
    try {
      const source = await fetchLibrarySource(project.eeVersion, installId);
      // Another engine's installation says nothing about this project's: keep what is loaded and say why.
      if (source.installation !== null && source.installation.target !== project.eeVersion) {
        set({ status: `${source.installation.label} is ${source.installation.target}; this project targets ${project.eeVersion}, so its scan is not used for checking.` });
        return;
      }
      set({ library: source.library, libraryInstall: source.installation });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  openProblem: (where) => {
    const state = get();
    const project = state.project;
    if (project === null) return;
    switch (where.kind) {
      case "owner":
        state.openReference(where.owner);
        return;
      case "object":
        state.focusObject(where.id);
        set({ view: "map", pick: null, returnTo: null });
        return;
      case "group":
        state.focusGroup(where.id);
        set({ selection: [], markerSelection: [], view: "map", pick: null, returnTo: null });
        return;
      case "marker":
        state.focusMarker(where.id);
        set({ selection: [], view: "map", pick: null, returnTo: null });
        return;
      case "template": {
        const template = project.templates.find((t) => t.name === where.name);
        if (template === undefined) return;
        const field = where.field === undefined ? null : TEMPLATE_FIELD_LOOKUP(where.field);
        set({
          selectedTemplateId: template.id,
          selectedStockTemplate: null,
          view: "ship",
          pick: null,
          returnTo: null,
          ...(field === null ? {} : { shipSection: field, shipJump: where.field ?? null }),
        });
        return;
      }
      case "dialogue": {
        const dialogue = project.logic.dialogues.find((d) => d.id === where.id);
        if (dialogue === undefined) return;
        set({ view: "dialogues", pick: null, returnTo: null, logicSelection: { kind: "dialogueNode", id: dialogue.id, nodeId: where.nodeId ?? dialogue.entry }, openActionIndex: null });
        return;
      }
      case "variable":
        set({ view: "narrative", missionTab: "variables", pick: null, returnTo: null });
        return;
      case "step":
        set({ view: "narrative", missionTab: "rules", pick: null, returnTo: null });
        return;
    }
  },

  setTool: (tool) => set({ tool }),
  setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
  setBrushType: (brushType) => set({ brushType }),
  setCamera: (camera) => set({ camera }),
  setSnap: (snap) => set({ snap }),
  // Choosing where new objects go is not a request to forget what is selected: the selection is by id and
  // works across groups, so it is left alone.
  setActiveGroup: (activeGroupId) => set({ activeGroupId }),
  dismissViewNotice: () => set({ viewNotice: null }),
  setOpenSector: (sector) => {
    const { project, viewPrefs } = get();
    if (project === null) return;
    const next = setOpenSectorPrefs(viewPrefs, sector);
    if (next === viewPrefs) return;
    applyViewPrefs(next, sector === null ? "Showing all sectors." : `Opened ${sectorLabel(project, sector)} (and Shared).`, { viewNotice: null });
  },
  addSector: (label) => {
    const { project, viewPrefs } = get();
    if (project === null) return "Open a project first.";
    const result = addSectorTo(project, label);
    if (!result.ok) return result.reason;
    set({ project: result.project, dirty: true });
    applyViewPrefs(setOpenSectorPrefs(viewPrefs, result.id), `Created ${label.trim()} and opened it.`, { viewNotice: null });
    return null;
  },
  renameSector: (id, label) => {
    const { project } = get();
    if (project === null) return "Open a project first.";
    const result = renameSectorIn(project, id, label);
    if (!result.ok) return result.reason;
    set({ project: result.project, dirty: true, status: `Renamed the sector to ${label.trim()}.` });
    return null;
  },
  deleteSector: (id, destination) => {
    const { project } = get();
    if (project === null) return "Open a project first.";
    const name = sectorLabel(project, id);
    const result = removeSectorFrom(project, id, destination);
    if (!result.ok) return result.reason;
    const moved = describeCounts(result.moved);
    set({
      project: result.project,
      dirty: true,
      status: moved === "nothing" ? `Deleted the empty sector ${name}.` : `Deleted ${name}; its ${moved} moved to ${sectorLabel(result.project, destination ?? null)}. Nothing else changed.`,
    });
    return null;
  },
  moveGroupToSector: (groupId, sector) => {
    const { project, viewPrefs, selection, markerSelection, activeGroupId } = get();
    if (project === null) return;
    const group = project.map.groups.find((g) => g.id === groupId);
    const next = assignGroupToSector(project, groupId, sector);
    if (group === undefined || next === project) return;
    const where = sectorLabel(next, sector);
    const leaves = !inSector(sector, viewPrefs.sector);
    const kept = dropUnshown(next, viewPrefs, selection, markerSelection);
    set({
      project: next,
      dirty: true,
      selection: kept.selection,
      markerSelection: kept.markerSelection,
      activeGroupId: leaves && activeGroupId === groupId ? defaultActiveGroup(next, viewPrefs) : activeGroupId,
      status: leaves
        ? `Moved “${group.label}” to ${where}. It is not in the sector you have open — open ${where} to see it.`
        : `Moved “${group.label}” to ${where}. Its objects, coordinates, rules and spawn timing are unchanged.`,
    });
  },
  moveMarkerToSector: (markerId, sector) => {
    const { project, viewPrefs, markerSelection } = get();
    if (project === null) return;
    const marker = project.map.markers.find((m) => m.id === markerId);
    const next = assignMarkerToSector(project, markerId, sector);
    if (marker === undefined || next === project) return;
    const where = sectorLabel(next, sector);
    const leaves = !inSector(sector, viewPrefs.sector);
    set({
      project: next,
      dirty: true,
      markerSelection: leaves ? markerSelection.filter((id) => id !== markerId) : markerSelection,
      status: leaves ? `Moved the marker to ${where}. It is not in the sector you have open — open ${where} to see it.` : `Moved the marker to ${where}. Its id and position are unchanged.`,
    });
  },
  setMarkerSector: (markerSector) => set({ markerSector }),
  setStartSector: (sector) => {
    const { project } = get();
    if (project === null) return;
    const next = setStartSectorIn(project, sector);
    if (next === project) return;
    set({
      project: next,
      dirty: true,
      status:
        sector === null
          ? "No starting sector: every At mission start group is created at the start, as before."
          : `The game starts in ${sectorLabel(next, sector)}: only its At mission start groups and the Shared ones are created at the start.`,
    });
  },
  setCampaignPersistence: (enabled) => {
    const { project } = get();
    if (project === null || project.campaign.persistence === enabled) return;
    set({
      project: { ...project, campaign: { ...project.campaign, persistence: enabled } },
      dirty: true,
      status: enabled
        ? "Campaign saves are on: the running game keeps a checkpoint of every sector and of the campaign, and can resume it after EmptyEpsilon is closed."
        : "Campaign saves are off: a sector is rebuilt from its initial settings each time, and nothing is kept when EmptyEpsilon closes.",
    });
  },
  toggleGroupHidden: (groupId) => {
    const group = get().project?.map.groups.find((g) => g.id === groupId);
    if (group === undefined || get().viewPrefs.isolated !== null) return;
    const next = toggleHidden(get().viewPrefs, groupId);
    applyViewPrefs(next, next.hidden.includes(groupId) ? `Hid group “${group.label}” on the map.` : `Showing group “${group.label}”.`);
  },
  toggleGroupLocked: (groupId) => {
    const group = get().project?.map.groups.find((g) => g.id === groupId);
    if (group === undefined) return;
    const next = toggleLocked(get().viewPrefs, groupId);
    applyViewPrefs(next, isGroupLocked(next, groupId) ? `Locked group “${group.label}”: its objects can be inspected but not changed.` : `Unlocked group “${group.label}”.`);
  },
  isolateGroup: (groupId) => {
    const group = get().project?.map.groups.find((g) => g.id === groupId);
    if (group === undefined) return;
    applyViewPrefs(isolateInView(get().viewPrefs, groupId), `Showing only group “${group.label}”.`);
  },
  exitIsolation: () => {
    if (get().viewPrefs.isolated === null) return;
    applyViewPrefs(exitViewIsolation(get().viewPrefs), "Left isolation: the previous visibility is back.");
  },
  showAllGroups: () => {
    const { project, viewPrefs } = get();
    if (project === null) return;
    applyViewPrefs(showAllInView(project, viewPrefs), "Showing every group.");
  },
  focusObject: (id) => {
    const { project } = get();
    const group = project?.map.groups.find((g) => g.objects.some((o) => o.id === id));
    if (group === undefined) return;
    set({ activeGroupId: group.id, selection: [id], markerSelection: [], ...openSectorFor(group.sector, id) });
  },
  focusGroup: (groupId) => {
    const group = get().project?.map.groups.find((g) => g.id === groupId);
    if (group === undefined) return;
    set({ activeGroupId: group.id, ...openSectorFor(group.sector, `“${group.label}”`) });
  },
  focusMarker: (markerId) => {
    const marker = get().project?.map.markers.find((m) => m.id === markerId);
    if (marker === undefined) return;
    set({ markerSelection: [marker.id], selection: [], ...openSectorFor(marker.sector, marker.label || marker.id) });
  },
  sceneFilter: NO_FILTER,
  setSceneFilter: (patch) => set({ sceneFilter: { ...get().sceneFilter, ...patch } }),
  collapsedGroups: [],
  toggleGroupCollapsed: (groupId, collapsed) => {
    const now = get().collapsedGroups.includes(groupId);
    const want = collapsed ?? !now;
    if (want === now) return;
    set({ collapsedGroups: want ? [...get().collapsedGroups, groupId] : get().collapsedGroups.filter((g) => g !== groupId) });
  },
  shipSection: "identity",
  setShipSection: (shipSection) => set({ shipSection }),
  returnTo: null,
  openInstance: (objectId, from) => {
    get().focusObject(objectId);
    set({ view: "map", pick: null, returnTo: from });
  },
  returnToPrevious: () => {
    const { returnTo } = get();
    if (returnTo === null) return;
    set({ view: returnTo.view, returnTo: null, pick: null });
  },
  missionTab: "rules",
  setMissionTab: (missionTab) => set({ missionTab }),
  openReference: (owner) => {
    set({ returnTo: null });
    switch (owner.kind) {
      case "rule":
      case "beat":
      case "gmButton":
        set({
          view: "narrative",
          missionTab: owner.kind === "rule" ? "rules" : owner.kind === "beat" ? "timeline" : "gm",
          pick: null,
          logicSelection: { kind: owner.kind, id: owner.id },
          openActionIndex: null,
        });
        return;
      case "dialogueNode":
        set({ view: "dialogues", pick: null, logicSelection: { kind: "dialogueNode", id: owner.id, nodeId: owner.nodeId }, openActionIndex: null });
        return;
      case "object":
        get().focusObject(owner.id);
        set({ view: "map", pick: null });
        return;
      case "exodusStep":
        set({ view: "narrative", missionTab: "rules", pick: null });
        return;
    }
  },
  select: (selection) => set({ selection }),
  selectMarkers: (markerSelection) => set({ markerSelection }),

  placeAt: (position) => {
    const { project, tool, activeGroupId } = get();
    if (project === null) return;

    if (tool.kind === "marker") {
      const { viewPrefs, markerSector } = get();
      // Filed under the open sector unless the author chose otherwise; with All sectors open there is no sensible
      // default, so the author is asked rather than a sector being picked for them.
      const filed = markerSector !== undefined && inSector(markerSector, viewPrefs.sector) ? markerSector : viewPrefs.sector ?? undefined;
      if (filed === undefined) {
        set({ status: "Choose which sector this marker is filed under (or Shared) before placing it." });
        return;
      }
      const taken = new Set(project.map.markers.map((m) => m.id));
      const id = uniqueObjectId(taken, "marker");
      // The label starts as the id so the marker is recognisable in a
      // picker straight away; both are editable in the inspector.
      const marker = createMarker(id, id, position, filed);
      set({
        project: { ...project, map: { ...project.map, markers: [...project.map.markers, marker] } },
        dirty: true,
        selection: [],
        markerSelection: [id],
        status: `Placed marker ${id}`,
      });
      return;
    }

    if (tool.kind !== "place") return;
    if (activeGroupId === null) {
      set({ status: "Create a group in this sector first: objects are placed into a group." });
      return;
    }
    const refusedGroup = refuseGroup(activeGroupId);
    if (refusedGroup !== null) {
      set({ status: refusedGroup });
      return;
    }

    const id = uniqueObjectId(takenIds(project), tool.type.toLowerCase());
    const callsign = nextCallsign(existingCallsigns(project.map.groups), tool.type);
    const object = createObject(tool.type, id, position, { callsign });

    set({
      project: mapGroup(project, activeGroupId, (objects) => [...objects, object]),
      dirty: true,
      selection: [id],
      markerSelection: [],
      status: `Placed ${tool.type} ${callsign}`,
    });
  },

  moveSelection: (delta) => {
    const { project, selection, markerSelection } = get();
    if (project === null || (selection.length === 0 && markerSelection.length === 0)) return;
    const refused = viewBlockFor(selection);
    if (refused !== null) {
      set({ status: refused });
      return;
    }
    const selected = new Set(selection);
    const selectedMarkers = new Set(markerSelection);
    const withObjects = mapAllObjects(project, (object) => {
      if (!selected.has(object.id)) return object;
      const moved = {
        ...object,
        position: { x: object.position.x + delta.x, y: object.position.y + delta.y },
      };
      // A zone's polygon is its geometry — dragging the handle has to
      // carry the corners with it or the shape detaches from it.
      if (moved.type === "Zone") {
        return {
          ...moved,
          points: moved.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
        };
      }
      return moved;
    });
    // Dragging a marker is the whole point of markers: every place that
    // names it follows, because they hold the id rather than a copy of
    // these coordinates (ADR-0038).
    set({
      project: {
        ...withObjects,
        map: {
          ...withObjects.map,
          markers: withObjects.map.markers.map((marker) =>
            selectedMarkers.has(marker.id)
              ? {
                  ...marker,
                  position: {
                    x: marker.position.x + delta.x,
                    y: marker.position.y + delta.y,
                  },
                }
              : marker,
          ),
        },
      },
      dirty: true,
    });
  },

  updateMarker: (id, patch) => {
    const { project } = get();
    if (project === null) return;
    set({
      project: {
        ...project,
        map: {
          ...project.map,
          markers: project.map.markers.map((marker) =>
            marker.id === id ? { ...marker, ...patch } : marker,
          ),
        },
      },
      dirty: true,
    });
  },

  renameMarker: (from, to) => {
    const { project, markerSelection } = get();
    if (project === null) return;
    const renamed = renameMarkerInProject(project, from, to);
    if (renamed === project) return;
    set({
      project: renamed,
      dirty: true,
      markerSelection: markerSelection.map((id) => (id === from ? to : id)),
      status: `Renamed marker ${from} → ${to}`,
    });
  },

  updateObject: (id, patch) => {
    const { project } = get();
    if (project === null) return;
    const refused = viewBlockFor([id]);
    if (refused !== null) {
      set({ status: refused });
      return;
    }
    set({
      project: mapAllObjects(project, (object) =>
        object.id === id ? ({ ...object, ...patch } as EEObject) : object,
      ),
      dirty: true,
    });
  },

  renameObject: (from, to) => {
    const { project, selection } = get();
    if (project === null) return;
    const refused = viewBlockFor([from]);
    if (refused !== null) {
      set({ status: refused });
      return;
    }
    const renamed = renameInProject(project, from, to);
    // The toolkit returns the document unchanged when the id is
    // unusable; the control has already refused it, so this is a guard,
    // not the error path.
    if (renamed === project) return;
    set({
      project: renamed,
      dirty: true,
      selection: selection.map((id) => (id === from ? to : id)),
      status: `Renamed ${from} → ${to}`,
    });
  },

  deleteSelection: () => {
    const { project, selection, markerSelection } = get();
    if (project === null || (selection.length === 0 && markerSelection.length === 0)) return;
    const refused = viewBlockFor(selection);
    if (refused !== null) {
      set({ status: refused });
      return;
    }
    const selected = new Set(selection);
    const selectedMarkers = new Set(markerSelection);
    const orphanedOrbit = allObjects(project).some(
      (o) => o.type === "Planet" && o.orbit !== null && selected.has(o.orbit.targetId),
    );
    const next: EEProject = {
      ...project,
      map: {
        ...project.map,
        groups: project.map.groups.map((group) => ({
          ...group,
          objects: group.objects.filter((o) => !selected.has(o.id)),
        })),
        markers: project.map.markers.filter((m) => !selectedMarkers.has(m.id)),
      },
    };
    set({
      project: next,
      selection: [],
      markerSelection: [],
      dirty: true,
      status: deleteStatus(next, selected.size, selectedMarkers.size, orphanedOrbit),
    });
  },

  applyBrush: (brush, type) => {
    const { project, activeGroupId } = get();
    if (project === null || activeGroupId === null) return;
    const refusedGroup = refuseGroup(activeGroupId);
    if (refusedGroup !== null) {
      set({ status: refusedGroup });
      return;
    }

    const points = generateBrush(brush);
    // Every member of a scatter shares one TT-SS-NN callsign — the
    // convention's golden rule, and what makes downstream grouping work.
    const callsign = nextCallsign(existingCallsigns(project.map.groups), type, {
      subCode: brushSubCode(brush),
    });

    const taken = takenIds(project);
    const created: EEObject[] = [];
    for (const point of points) {
      const id = uniqueObjectId(taken, `${type.toLowerCase()}_${callsign.toLowerCase()}`);
      taken.add(id);
      const object = createObject(type, id, point.position, { callsign });
      created.push(
        object.type === "Asteroid" || object.type === "VisualAsteroid"
          ? { ...object, size: point.size }
          : object,
      );
    }

    set({
      project: mapGroup(project, activeGroupId, (objects) => [...objects, ...created]),
      dirty: true,
      selection: created.map((o) => o.id),
      status: `${brush.kind} brush: ${created.length} × ${type} as ${callsign}`,
    });
  },

  scatterAt: (center) => {
    const { tool, brush, brushType, applyBrush, setTool } = get();
    if (tool.kind !== "scatter") return;
    applyBrush(brushAt(brush, center), brushType);
    // Disarm after one drop. A stray second click would otherwise bury
    // another fourteen asteroids on top of the first fourteen, and a
    // scatter is a lot more to undo than a misplaced object.
    setTool({ kind: "select" });
  },

  // --- narrative -----------------------------------------------------------

  view: "map",
  setView: (view) => set({ view, pick: null, returnTo: null }),
  logicSelection: null,
  selectLogic: (logicSelection) => set({ logicSelection, openActionIndex: null }),

  pick: null,
  pickFrom: "narrative",
  requestPick: (request) => {
    const from = get().view;
    set({ pick: request, pickFrom: from === "map" ? "narrative" : from, view: "map" });
  },
  // Only a pick that is really pending sends the author back to the view that asked. With none pending (Esc on the Map
  // just deselects and disarms the tool) the view stays where it is.
  cancelPick: () => {
    if (get().pick === null) return;
    set({ pick: null, view: get().pickFrom });
  },
  resolvePick: (answer) => {
    const { pick, project } = get();
    if (pick === null || project === null) return;
    // A picked point becomes a tagged place, not bare coordinates: every
    // field that accepts a pick now holds an `EEPointRef` (ADR-0038).
    const value =
      answer.kind === "object"
        ? answer.objectId
        : ({ ref: "point", position: answer.position } satisfies EEPointRef);
    set({
      project: { ...project, logic: setField(project.logic, pick.path, pick.key, value) },
      dirty: true,
      pick: null,
      view: get().pickFrom,
      status: `Picked ${answer.kind === "object" ? answer.objectId : "a point"}`,
    });
  },

  applyLogic: (fn) => set(patchLogic(get(), fn)),
  openActionIndex: null,
  setOpenActionIndex: (openActionIndex) => set({ openActionIndex }),

  addBeat: (at) => {
    const { project } = get();
    if (project === null) return;
    const taken = new Set(project.logic.beats.map((b) => b.id));
    const id = uniqueObjectId(taken, "beat");
    const beat: EEBeat = { id, label: "New timed event", at, sector: null, actions: [] };
    set({
      project: withLogic(project, (logic) => ({ ...logic, beats: [...logic.beats, beat] })),
      dirty: true,
      logicSelection: { kind: "beat", id },
      status: `Beat at T+${at}s`,
    });
  },
  updateBeat: (id, patch) =>
    set(patchLogic(get(), (logic) => ({
      ...logic,
      beats: logic.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))),
  deleteBeat: (id) =>
    set({
      ...patchLogic(get(), (logic) => ({
        ...logic,
        beats: logic.beats.filter((b) => b.id !== id),
      })),
      logicSelection: null,
    }),

  addRule: () => {
    const { project } = get();
    if (project === null) return;
    const taken = new Set(project.logic.rules.map((r) => r.id));
    const id = uniqueObjectId(taken, "rule");
    const rule: EERule = {
      id,
      label: "New rule",
      sector: null,
      when: emptyPredicate("elapsed"),
      conditions: [],
      once: true,
      actions: [],
    };
    set({
      project: withLogic(project, (logic) => ({ ...logic, rules: [...logic.rules, rule] })),
      dirty: true,
      logicSelection: { kind: "rule", id },
      status: "Rule added",
    });
  },
  updateRule: (id, patch) =>
    set(patchLogic(get(), (logic) => ({
      ...logic,
      rules: logic.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }))),
  deleteRule: (id) =>
    set({
      ...patchLogic(get(), (logic) => ({
        ...logic,
        rules: logic.rules.filter((r) => r.id !== id),
      })),
      logicSelection: null,
    }),

  addGmButton: () => {
    const { project } = get();
    if (project === null) return;
    const taken = new Set(project.logic.gmButtons.map((b) => b.id));
    const id = uniqueObjectId(taken, "gm");
    const button: EEGmButton = { id, label: "New GM control", actions: [] };
    set({
      project: withLogic(project, (logic) => ({
        ...logic,
        gmButtons: [...logic.gmButtons, button],
      })),
      dirty: true,
      logicSelection: { kind: "gmButton", id },
      status: "GM button added",
    });
  },
  updateGmButton: (id, patch) =>
    set(patchLogic(get(), (logic) => ({
      ...logic,
      gmButtons: logic.gmButtons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))),
  deleteGmButton: (id) =>
    set({
      ...patchLogic(get(), (logic) => ({
        ...logic,
        gmButtons: logic.gmButtons.filter((b) => b.id !== id),
      })),
      logicSelection: null,
    }),

  setVariables: (variables) =>
    set(patchLogic(get(), (logic) => ({ ...logic, variables: [...variables] }))),

  // --- dialogues (ADR-0039) -----------------------------------------------
  // Every one goes through `applyLogic` with a toolkit helper, so no panel
  // assembles its own copy of the document.
  addDialogue: (label) => {
    const { project } = get();
    if (project === null) return;
    const id = uniqueDialogueId(project.logic, label);
    set({
      ...patchLogic(get(), (logic) => ({
        ...logic,
        dialogues: [...logic.dialogues, emptyDialogue(id, label)],
      })),
      logicSelection: { kind: "dialogueNode", id, nodeId: "start" },
      status: `Added dialogue ${label}`,
    });
  },

  updateDialogue: (id, patch) =>
    set(patchLogic(get(), (logic) => mapDialogues(logic, id, (d) => ({ ...d, ...patch })))),

  deleteDialogue: (id) => {
    const { project, logicSelection } = get();
    if (project === null) return;
    // Objects that answered with it are left pointing at nothing on
    // purpose: the build says so by name, and silently muting a station is
    // a worse surprise than a refused build.
    const stillUsed = project.map.groups
      .flatMap((g) => g.objects)
      .filter((o) => "dialogueId" in o && o.dialogueId === id)
      .map((o) => o.id);
    set({
      ...patchLogic(get(), (logic) => ({
        ...logic,
        dialogues: logic.dialogues.filter((d) => d.id !== id),
      })),
      logicSelection:
        logicSelection?.kind === "dialogueNode" && logicSelection.id === id
          ? null
          : logicSelection,
      status:
        stillUsed.length === 0
          ? `Deleted dialogue ${id}`
          : `Deleted dialogue ${id} — still answered with by ${stillUsed.join(", ")}. Those will not build.`,
    });
  },

  addNode: (dialogueId) => {
    const { project } = get();
    if (project === null) return;
    const dialogue = project.logic.dialogues.find((d) => d.id === dialogueId);
    if (dialogue === undefined) return;
    const nodeId = uniqueNodeId(dialogue, "node");
    set({
      ...patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({ ...d, nodes: [...d.nodes, emptyNode(nodeId)] })),
      ),
      logicSelection: { kind: "dialogueNode", id: dialogueId, nodeId },
    });
  },

  updateNode: (dialogueId, nodeId, patch) =>
    set(
      patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({
          ...d,
          nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
        })),
      ),
    ),

  renameNode: (dialogueId, from, to) => {
    const { logicSelection } = get();
    set({
      ...patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => renameNodeInDialogue(d, from, to)),
      ),
      logicSelection:
        logicSelection?.kind === "dialogueNode" && logicSelection.nodeId === from
          ? { ...logicSelection, nodeId: to }
          : logicSelection,
    });
  },

  deleteNode: (dialogueId, nodeId) => {
    const { project, logicSelection } = get();
    if (project === null) return;
    const dialogue = project.logic.dialogues.find((d) => d.id === dialogueId);
    const uses = dialogue === undefined ? [] : referencesToNode(dialogue, nodeId);
    set({
      ...patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({
          ...d,
          nodes: d.nodes.filter((n) => n.id !== nodeId),
        })),
      ),
      logicSelection:
        logicSelection?.kind === "dialogueNode" && logicSelection.nodeId === nodeId
          ? null
          : logicSelection,
      status:
        uses.length === 0
          ? `Deleted node ${nodeId}`
          : `Deleted node ${nodeId} — still reached from ${uses.join(", ")}. The build will refuse it.`,
    });
  },

  addReply: (dialogueId, nodeId) =>
    set(
      patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === nodeId ? { ...n, replies: [...n.replies, emptyReply(nodeId)] } : n,
          ),
        })),
      ),
    ),

  updateReply: (dialogueId, nodeId, index, patch) =>
    set(
      patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  replies: n.replies.map((r, i) => (i === index ? { ...r, ...patch } : r)),
                }
              : n,
          ),
        })),
      ),
    ),

  removeReply: (dialogueId, nodeId, index) =>
    set(
      patchLogic(get(), (logic) =>
        mapDialogues(logic, dialogueId, (d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === nodeId ? { ...n, replies: n.replies.filter((_, i) => i !== index) } : n,
          ),
        })),
      ),
    ),

  rig: null,
  rigDirty: false,
  dmxTriggers: null,
  dmxWarnings: [],

  loadRig: async () => {
    try {
      set({ rig: await fetchDmxRig(), rigDirty: false, dmxWarnings: [] });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  saveRig: async () => {
    const { rig } = get();
    if (rig === null) return;
    try {
      await saveDmxRig(rig);
      set({ rigDirty: false, status: "DMX rig saved" });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  setEeDir: (eeDir) => {
    set({ eeDir });
    // Choosing an installation also chooses whose scan the checks and the resource lists use.
    if (getDesktop() !== null && eeDir !== "") void get().useInstallLibrary(eeDir);
    try {
      window.localStorage.setItem(EE_DIR_KEY, eeDir);
    } catch {
      // Not being able to remember it is not worth failing the edit over.
    }
  },

  /**
   * Re-index the install, then keep the fresh lists.
   *
   * `ee-library.json` is a snapshot of the install, so a texture added to
   * EE is invisible here until this runs.
   */
  rescanLibrary: async () => {
    const eeDir = get().eeDir;
    if (eeDir === "") {
      set({ status: "Set the EmptyEpsilon directory first." });
      return;
    }
    try {
      const { library, copied, target, verified } = await rescanLibraryOnBridge(eeDir);
      bumpAssetEpoch();
      resetIconAvailability(); // the scan may have copied the sprites the map could not draw before
      // The copy count matters more than the totals: it is the half that
      // was silently missing, and the reason a new texture drew as a
      // broken thumbnail rather than not appearing at all.
      set({
        library,
        status:
          `Rescanned ${target ?? library.eeVersion}${verified ? "" : " (version declared, not verified)"}: ${library.templates.length} templates, ` +
          `${library.resources.planetTextures.length} planet textures. ` +
          (copied.length === 0
            ? "Images already current."
            : `Copied ${copied.length} image(s): ${copied.join(", ")}.`),
      });
    } catch (error) {
      set({ status: `Rescan failed: ${String(error)}` });
    }
  },

  importRig: async (eeDir) => {
    try {
      const result = await importDmxRig(eeDir);
      set({
        rig: result.rig,
        rigDirty: true,
        dmxWarnings: result.warnings,
        status: `Imported ${result.path}${
          result.warnings.length === 0 ? "" : ` — ${result.warnings.length} line(s) not understood`
        }`,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  buildRig: async (install) => {
    try {
      const result = await buildDmxRig(install);
      set({
        status:
          result.installedTo === null
            ? `Wrote ${result.outPath}`
            : `Installed ${result.installedTo}${
                result.backedUpTo === null ? "" : ` (backup: ${result.backedUpTo})`
              } — restart EmptyEpsilon to apply`,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  refreshDmxTriggers: async () => {
    try {
      set({ dmxTriggers: await fetchDmxTriggers(get().project?.eeVersion ?? null) });
    } catch {
      // The preview is allowed to be unavailable; a rig is editable with
      // the game shut down, and an error banner per poll would be noise.
      set({ dmxTriggers: null });
    }
  },

  applyRig: (fn) => {
    const { rig } = get();
    if (rig === null) return;
    set({ rig: fn(rig), rigDirty: true });
  },

  selectedTemplateId: null,
  selectedStockTemplate: null,
  pendingRetarget: null,
  setShipPanelWidth: (shipPanelWidth) => {
    set({ shipPanelWidth });
    try {
      window.localStorage.setItem(SHIP_PANEL_KEY, String(shipPanelWidth));
    } catch {
      // Same as `eeDir`: a browser that refuses storage still gets the
      // resize, it just does not remember it.
    }
  },

  selectTemplate: (selectedTemplateId) =>
    set({ selectedTemplateId, selectedStockTemplate: null }),

  addTemplate: (name) => {
    const { project } = get();
    if (project === null) return;
    const id = uniqueObjectId(new Set(project.templates.map((t) => t.id)), name);
    const template = createTemplate(id, uniqueTemplateName(project, name));
    set({
      project: { ...project, templates: [...project.templates, template] },
      selectedTemplateId: id,
      view: "ship",
      dirty: true,
    });
  },

  copyTemplate: (id) => {
    const { project } = get();
    if (project === null) return;
    const base = project.templates.find((t) => t.id === id);
    if (base === undefined) return;
    const name = uniqueTemplateName(project, `${base.name} B`);
    const nextId = uniqueObjectId(new Set(project.templates.map((t) => t.id)), name);
    // A variant, not a clone: EE's own idiom is copy() off the base, so the
    // two stay related and only the overridden setters are repeated.
    const variant: EETemplateDef = { ...base, id: nextId, name, copyOf: base.name };
    const flying = objectsUsingTemplate(project, base.name).length;
    set({
      project: { ...project, templates: [...project.templates, variant] },
      selectedTemplateId: nextId,
      dirty: true,
      // A variant is a new template; no object moves to it. Said once, so that is not a surprise later.
      status: `Duplicated "${base.name}" as the variant "${name}". The ${flying} object(s) using "${base.name}" still use it.`,
    });
  },

  /**
   * Bring a stock hull into the project as a template of its own.
   *
   * Not a `copy()`: EmptyEpsilon exposes no way to reference an existing
   * template from a scenario, so the whole definition the install declared
   * is materialised under a new name (ADR-0041). The default name is
   * suffixed rather than the stock one — redefining "Atlantis" is a real
   * capability, but it changes every scenario that spawns the name, so it
   * is something an author types, not something a button does.
   */
  copyStockTemplate: (stockName) => {
    const { project, library } = get();
    if (project === null) return;
    const stock = stockTemplateNamed(library, stockName);
    if (stock === null) {
      set({ error: `the scanned install has no template named "${stockName}"` });
      return;
    }
    const name = uniqueTemplateName(project, `${stock.name} (${project.id})`);
    const id = uniqueObjectId(new Set(project.templates.map((t) => t.id)), name);
    const copy = templateFromStock(stock, id, name);

    // The objects flying the stock hull keep flying it, and the author is
    // the one who decides whether that is what they wanted.
    const flying = objectsUsingTemplate(project, stock.name);
    set({
      project: { ...project, templates: [...project.templates, copy] },
      selectedTemplateId: id,
      selectedStockTemplate: null,
      view: "ship",
      dirty: true,
      error: null,
      status:
        flying.length === 0
          ? `Copied ${stock.name} into the project as "${name}".`
          : `Copied ${stock.name} as "${name}" — ${flying.length} object(s) still use "${stock.name}".`,
      pendingRetarget: flying.length === 0 ? null : { from: stock.name, to: name },
    });
  },

  /** Accept the offer left by {@link copyStockTemplate}. */
  applyRetarget: () => {
    const { project, pendingRetarget } = get();
    if (project === null || pendingRetarget === null) return;
    const { from, to } = pendingRetarget;
    const moved = objectsUsingTemplate(project, from).length;
    set({
      project: retargetTemplate(project, from, to),
      pendingRetarget: null,
      dirty: true,
      status: `Moved ${moved} object(s) from "${from}" to "${to}".`,
    });
  },

  dismissRetarget: () => set({ pendingRetarget: null }),

  selectStockTemplate: (selectedStockTemplate) =>
    set({ selectedStockTemplate, selectedTemplateId: null, view: "ship" }),

  updateTemplate: (id, patch) => {
    const { project } = get();
    if (project === null) return;
    const before = project.templates.find((t) => t.id === id);
    if (before === undefined) return;
    const after = { ...before, ...patch };
    // A rename has to travel: every variant copying this template names it
    // by string, and so does every map object that spawns it.
    const renamed = patch.name !== undefined && patch.name !== before.name;
    set({
      project: renamed ? renameTemplate(project, before.name, after) : {
        ...project,
        templates: project.templates.map((t) => (t.id === id ? after : t)),
      },
      dirty: true,
    });
  },

  deleteTemplate: (id) => {
    const { project, selectedTemplateId } = get();
    if (project === null) return;
    set({
      project: { ...project, templates: project.templates.filter((t) => t.id !== id) },
      selectedTemplateId: selectedTemplateId === id ? null : selectedTemplateId,
      dirty: true,
    });
  },

  addGroup: (label, when, sector) => {
    const { project } = get();
    if (project === null) return;
    const taken = new Set(project.map.groups.map((g) => g.id));
    const id = uniqueObjectId(taken, label);
    set({
      project: {
        ...project,
        // At the end of the list: a new group spawns after the ones already there, as it always did.
        map: { ...project.map, groups: [...project.map.groups, { id, label, when, objects: [], sector }] },
      },
      activeGroupId: id,
      dirty: true,
      status: `Created group “${label}” in ${sectorLabel(project, sector)}.`,
    });
  },

  updateGroup: (id, patch) => {
    const { project, viewPrefs } = get();
    if (project === null) return;
    if (isGroupLocked(viewPrefs, id)) {
      set({ status: "This group is locked — unlock it to rename it or change when it appears." });
      return;
    }
    set({
      project: {
        ...project,
        map: {
          ...project.map,
          groups: project.map.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        },
      },
      dirty: true,
    });
  },

  deleteGroup: (id) => {
    const { project, viewPrefs } = get();
    if (project === null) return;
    if (isGroupLocked(viewPrefs, id)) {
      set({ status: "This group is locked — unlock it to delete it." });
      return;
    }
    const groups = project.map.groups.filter((g) => g.id !== id);
    const next = { ...project, map: { ...project.map, groups } };
    set({
      project: next,
      activeGroupId: defaultActiveGroup(next, viewPrefs),
      selection: [],
      dirty: true,
    });
  },
}));

/**
 * Where new objects go by default: the first group of the open sector (its own before a Shared one), else the first
 * group in view, else nothing.
 */
function defaultActiveGroup(project: EEProject, prefs: ViewPrefs): string | null {
  const inView = groupsInView(project, prefs);
  return (inView.find((g) => g.sector !== null) ?? inView[0])?.id ?? null;
}

/** The view state a freshly opened project starts from: what was remembered for it (minus what no longer exists). */
function openedView(project: EEProject): Pick<EditorState, "viewPrefs" | "activeGroupId" | "viewNotice" | "markerSector"> {
  const viewPrefs = pruneViewPrefs(readViewPrefs(project.id), project);
  return { viewPrefs, activeGroupId: defaultActiveGroup(project, viewPrefs), viewNotice: null, markerSector: undefined };
}

/**
 * Going to something that lives in another sector opens that sector — and says so — instead of leaving the author
 * looking at a map that does not contain it. Nothing about the thing itself changes.
 */
function openSectorFor(sector: string | null, what: string): Partial<EditorState> {
  const { project, viewPrefs } = useEditor.getState();
  if (project === null || inSector(sector, viewPrefs.sector)) return {};
  return {
    viewPrefs: setOpenSectorPrefs(viewPrefs, sector),
    viewNotice: `Opened ${sectorLabel(project, sector)} to show ${what}.`,
  };
}

/** The view state the map is actually drawn with: while something is being picked, every sector is on screen so a reference can reach across them. */
export function effectiveViewPrefs(state: Pick<EditorState, "viewPrefs" | "pick">): ViewPrefs {
  return state.pick === null ? state.viewPrefs : { ...state.viewPrefs, sector: null, isolated: null };
}

/** {@link effectiveViewPrefs} as a hook, memoised so a component only re-renders when what it draws changes. */
export function useEffectivePrefs(): ViewPrefs {
  const viewPrefs = useEditor((s) => s.viewPrefs);
  const pick = useEditor((s) => s.pick);
  return useMemo(() => effectiveViewPrefs({ viewPrefs, pick }), [viewPrefs, pick]);
}

/**
 * Puts a new view state in place. A selection the new state hides is dropped *and said so* — Delete or a drag must
 * never be able to reach something the author can no longer see.
 */
function applyViewPrefs(next: ViewPrefs, message: string, extra: Partial<EditorState> = {}): void {
  const { project, selection, markerSelection, activeGroupId } = useEditor.getState();
  if (project === null) return;
  const kept = dropUnshown(project, next, selection, markerSelection);
  const dropped = kept.droppedObjects + kept.droppedMarkers;
  const stillActive = activeGroupId !== null && groupsInView(project, next).some((g) => g.id === activeGroupId);
  useEditor.setState({
    ...extra,
    viewPrefs: next,
    activeGroupId: stillActive ? activeGroupId : defaultActiveGroup(project, next),
    selection: kept.selection,
    markerSelection: kept.markerSelection,
    status: dropped > 0 ? `${message} ${dropped} selected ${dropped === 1 ? "item was" : "items were"} deselected because ${dropped === 1 ? "it is" : "they are"} no longer shown.` : message,
  });
}

/** Why new objects may not go into this group right now (locked, or not on the map), or null. */
function refuseGroup(groupId: string): string | null {
  const { project, viewPrefs } = useEditor.getState();
  const group = project?.map.groups.find((g) => g.id === groupId);
  if (group === undefined) return null;
  if (isGroupLocked(viewPrefs, groupId)) return `Group “${group.label}” is locked — unlock it to add objects to it.`;
  if (!isGroupShown(viewPrefs, group)) return `Group “${group.label}” is hidden on the map — show it to add objects to it.`;
  return null;
}

/** Why a change to these objects is refused right now, as a status line — or null when it may go ahead. */
function viewBlockFor(objectIds: Iterable<string>): string | null {
  const { project, viewPrefs } = useEditor.getState();
  if (project === null) return null;
  const block = firstBlock(project, viewPrefs, objectIds);
  return block === null ? null : describeBlock(block);
}

// What the author hid, locked and isolated follows the document's groups (a deleted group takes its entries with
// it) and is remembered per project.
useEditor.subscribe((state, previous) => {
  if (state.project === null) return;
  if (state.project !== previous.project) {
    const pruned = pruneViewPrefs(state.viewPrefs, state.project);
    if (pruned !== state.viewPrefs) {
      useEditor.setState({ viewPrefs: pruned });
      return;
    }
  }
  if (state.viewPrefs !== previous.viewPrefs || state.project?.id !== previous.project?.id) {
    writeViewPrefs(state.project.id, state.viewPrefs);
  }
});

// A revision is an edit. Opening or creating a project replaces the document with `dirty` false and resets the
// counters itself; every edit sets `dirty`, and that is what is counted — so a result can tell whether the document
// has changed since it was made, without anything having to remember to say so.
useEditor.subscribe((state, previous) => {
  if (state.project !== null && previous.project !== null && state.project !== previous.project && state.project.id === previous.project.id && state.dirty) {
    useEditor.setState({ revision: state.revision + 1 });
  }
});

// The images and models drawn come from the installation whose scan the lists and checks use — not from whichever
// installation of the same version happened to be scanned last.
useEditor.subscribe((state) => {
  const install = state.libraryInstall;
  setAssetInstall(state.project !== null && install !== null && install.target === state.project.eeVersion ? install.id : null);
});
