import type { EEMapGroup, EEMarker, EEProject } from "@forge/contracts";

/**
 * How the map is *looked at*, as opposed to what the scenario *is*.
 *
 * Hiding a group, isolating it, locking it and choosing the sector to work in are the author's working state:
 * they never touch `project.json`, are not an edit (the project is not "unsaved" because of them), and change
 * nothing in the exported Lua — a hidden group still spawns in the game. They are remembered per project by
 * the editor, outside the document.
 *
 * Everything here is pure, so the rules ("what is drawn", "what may be touched", "what happens to a selection")
 * are testable without a canvas.
 */

export interface ViewPrefs {
  /** Group ids the author hid. */
  readonly hidden: readonly string[];
  /** Group ids whose objects can be looked at but not changed. */
  readonly locked: readonly string[];
  /**
   * The one group shown on its own, or null. Isolation is an overlay: it never edits `hidden`, so leaving it
   * restores exactly the visibility that was there before.
   */
  readonly isolated: string | null;
  /**
   * The sector being worked in: its groups, its markers and the Shared ones are drawn. Null is "All sectors". (Which
   * sector a group is filed under is the document's business; which one is *open* is not.)
   */
  readonly sector: string | null;
}

export const NO_VIEW_PREFS: ViewPrefs = { hidden: [], locked: [], isolated: null, sector: null };

const ids = (value: unknown): readonly string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];

/** Reads whatever storage returned. Anything that is not the expected shape falls back to "nothing set". */
export function parseViewPrefs(raw: unknown): ViewPrefs {
  if (typeof raw !== "object" || raw === null) return NO_VIEW_PREFS;
  const record = raw as Record<string, unknown>;
  return {
    hidden: ids(record["hidden"]),
    locked: ids(record["locked"]),
    isolated: typeof record["isolated"] === "string" ? record["isolated"] : null,
    sector: typeof record["sector"] === "string" ? record["sector"] : null,
  };
}

/** Whether something filed under `sector` (null = Shared) is in the part of the map that is open (null = all of it). */
export function inSector(sector: string | null, open: string | null): boolean {
  return open === null || sector === null || sector === open;
}

/**
 * Drops ids that no longer exist, and an isolation that no longer makes sense. Returns the same
 * object when nothing had to go, so a store can compare by reference.
 */
export function pruneViewPrefs(prefs: ViewPrefs, project: EEProject): ViewPrefs {
  const groups = new Map(project.map.groups.map((g) => [g.id, g] as const));
  const hidden = prefs.hidden.filter((id) => groups.has(id));
  const locked = prefs.locked.filter((id) => groups.has(id));
  const sector = prefs.sector !== null && project.map.sectors.some((s) => s.id === prefs.sector) ? prefs.sector : null;
  const isolatedGroup = prefs.isolated === null ? undefined : groups.get(prefs.isolated);
  const isolated = isolatedGroup !== undefined && inSector(isolatedGroup.sector, sector) ? prefs.isolated : null;
  if (
    hidden.length === prefs.hidden.length &&
    locked.length === prefs.locked.length &&
    sector === prefs.sector &&
    isolated === prefs.isolated
  ) {
    return prefs;
  }
  return { hidden, locked, isolated, sector };
}

/** Whether the canvas draws the group (and so lets it be clicked, swept, fitted and operated on). */
export function isGroupShown(prefs: ViewPrefs, group: Pick<EEMapGroup, "id" | "sector">): boolean {
  if (!inSector(group.sector, prefs.sector)) return false;
  if (prefs.isolated !== null) return group.id === prefs.isolated;
  return !prefs.hidden.includes(group.id);
}

export function isGroupLocked(prefs: ViewPrefs, groupId: string): boolean {
  return prefs.locked.includes(groupId);
}

/** The groups the canvas draws. */
export function shownGroups(project: EEProject, prefs: ViewPrefs): readonly EEMapGroup[] {
  return project.map.groups.filter((group) => isGroupShown(prefs, group));
}

/**
 * Markers on the canvas: those of the open sector and the Shared ones. A marker has no show/hide of its own, but
 * isolating a group means looking at that group alone, so the places (which belong to no group) step aside while it
 * lasts.
 */
export function shownMarkers(project: EEProject, prefs: ViewPrefs): readonly EEMarker[] {
  return prefs.isolated === null ? project.map.markers.filter((m) => inSector(m.sector, prefs.sector)) : [];
}

/** The groups of the open part of the map — what "Show all" works on and what the scene list lists. */
export function groupsInView(project: EEProject, prefs: ViewPrefs): readonly EEMapGroup[] {
  return project.map.groups.filter((group) => inSector(group.sector, prefs.sector));
}

export function toggleHidden(prefs: ViewPrefs, groupId: string): ViewPrefs {
  const hidden = prefs.hidden.includes(groupId) ? prefs.hidden.filter((id) => id !== groupId) : [...prefs.hidden, groupId];
  return { ...prefs, hidden };
}

export function toggleLocked(prefs: ViewPrefs, groupId: string): ViewPrefs {
  const locked = prefs.locked.includes(groupId) ? prefs.locked.filter((id) => id !== groupId) : [...prefs.locked, groupId];
  return { ...prefs, locked };
}

export function isolate(prefs: ViewPrefs, groupId: string): ViewPrefs {
  return { ...prefs, isolated: groupId };
}

export function exitIsolation(prefs: ViewPrefs): ViewPrefs {
  return prefs.isolated === null ? prefs : { ...prefs, isolated: null };
}

/** Shows every group of the open part of the map, and leaves isolation (it would hide them again). */
export function showAll(project: EEProject, prefs: ViewPrefs): ViewPrefs {
  const inView = new Set(groupsInView(project, prefs).map((g) => g.id));
  return { ...prefs, hidden: prefs.hidden.filter((id) => !inView.has(id)), isolated: null };
}

/** Opens a sector (null = all). Isolation is temporary and does not follow the author into another sector. */
export function setOpenSector(prefs: ViewPrefs, sector: string | null): ViewPrefs {
  return prefs.sector === sector ? prefs : { ...prefs, sector, isolated: null };
}

/** Where an object is: its group, and that group's state. */
export function groupOfObject(project: EEProject, objectId: string): EEMapGroup | undefined {
  return project.map.groups.find((group) => group.objects.some((o) => o.id === objectId));
}

export type ViewBlock =
  | { readonly kind: "locked"; readonly group: EEMapGroup }
  | { readonly kind: "hidden"; readonly group: EEMapGroup }
  | { readonly kind: "other-sector"; readonly group: EEMapGroup };

/** Why an object may not be changed right now, or null. Locked wins over hidden: it is the author's explicit act. */
export function blockOfObject(project: EEProject, prefs: ViewPrefs, objectId: string): ViewBlock | null {
  const group = groupOfObject(project, objectId);
  if (group === undefined) return null;
  if (isGroupLocked(prefs, group.id)) return { kind: "locked", group };
  if (!inSector(group.sector, prefs.sector)) return { kind: "other-sector", group };
  if (!isGroupShown(prefs, group)) return { kind: "hidden", group };
  return null;
}

/** The first reason any of `objectIds` may not be changed, or null when all may. */
export function firstBlock(project: EEProject, prefs: ViewPrefs, objectIds: Iterable<string>): ViewBlock | null {
  for (const id of objectIds) {
    const block = blockOfObject(project, prefs, id);
    if (block !== null) return block;
  }
  return null;
}

/** Plain-words version of {@link ViewBlock}, for a status line or an inspector note. */
export function describeBlock(block: ViewBlock): string {
  const name = `“${block.group.label}”`;
  switch (block.kind) {
    case "locked":
      return `Group ${name} is locked — unlock it to change its objects.`;
    case "hidden":
      return `Group ${name} is hidden on the map — show it to change its objects.`;
    case "other-sector":
      return `Group ${name} is in another sector — open that sector to change its objects.`;
  }
}

export interface PrunedSelection {
  readonly selection: readonly string[];
  readonly markerSelection: readonly string[];
  readonly droppedObjects: number;
  readonly droppedMarkers: number;
}

/**
 * Takes out of a selection what the canvas no longer shows. Hiding a group must not leave objects selected that
 * Delete or a drag could still reach unseen. A *locked* group's objects stay selected: they are still visible
 * and consultable, and every change refuses them.
 */
export function dropUnshown(
  project: EEProject,
  prefs: ViewPrefs,
  selection: readonly string[],
  markerSelection: readonly string[],
): PrunedSelection {
  const shown = new Set<string>();
  for (const group of shownGroups(project, prefs)) for (const o of group.objects) shown.add(o.id);
  const markers = new Set(shownMarkers(project, prefs).map((m) => m.id));
  const nextObjects = selection.filter((id) => shown.has(id));
  const nextMarkers = markerSelection.filter((id) => markers.has(id));
  return {
    selection: nextObjects,
    markerSelection: nextMarkers,
    droppedObjects: selection.length - nextObjects.length,
    droppedMarkers: markerSelection.length - nextMarkers.length,
  };
}

/** Groups to draw when a rubber band sweeps: shown and not locked, so a sweep never picks up what cannot be moved. */
export function sweepableGroups(project: EEProject, prefs: ViewPrefs): readonly EEMapGroup[] {
  return shownGroups(project, prefs)
    .filter((group) => !isGroupLocked(prefs, group.id));
}
