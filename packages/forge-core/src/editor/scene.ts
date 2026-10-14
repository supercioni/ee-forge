import type { EEProject } from "@forge/contracts";
import { sectorLabel } from "./sectors.js";

/**
 * The scene as a searchable list.
 *
 * The map draws every object; the author often needs to find one by what they remember — its callsign, its kind, the
 * id a rule shows — and to tell two with the same name apart. This is the pure half of that: an index of the
 * project's objects and markers, a filter, and the checks that keep a filter from changing what is selected.
 * Nothing here mutates a project.
 */

export interface SceneEntry {
  readonly kind: "object" | "marker";
  readonly id: string;
  /** The engine class (`PlayerSpaceship`), or `Marker`. */
  readonly type: string;
  /** What the map labels it with: callsign (or marker label), else the id. */
  readonly name: string;
  readonly groupId: string | null;
  readonly groupLabel: string | null;
  /** The sector the object's group (or the marker) is filed under; null is Shared. Searched, so "System B" finds its contents. */
  readonly sectorId: string | null;
  readonly sectorLabel: string;
  readonly when: "on_start" | "on_call" | null;
  readonly description: string;
}

export function sceneEntries(project: EEProject): readonly SceneEntry[] {
  const entries: SceneEntry[] = [];
  const sectorName = (sector: string | null): string => sectorLabel(project, sector);
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      const callsign = "callsign" in object ? object.callsign : null;
      const description = "description" in object && typeof object.description === "string" ? object.description : "";
      entries.push({
        kind: "object",
        id: object.id,
        type: object.type,
        name: callsign !== null && callsign !== "" ? callsign : object.id,
        groupId: group.id,
        groupLabel: group.label,
        sectorId: group.sector,
        sectorLabel: sectorName(group.sector),
        when: group.when,
        description,
      });
    }
  }
  for (const marker of project.map.markers) {
    entries.push({
      kind: "marker",
      id: marker.id,
      type: "Marker",
      name: marker.label !== "" ? marker.label : marker.id,
      groupId: null,
      groupLabel: null,
      sectorId: marker.sector,
      sectorLabel: sectorName(marker.sector),
      when: null,
      description: marker.notes ?? "",
    });
  }
  return entries;
}

export interface SceneFilter {
  /** Free text; every word must match somewhere (id, name, type, group, description). */
  readonly query: string;
  /** An engine class to keep, or "" for all. */
  readonly type: string;
}

export const NO_FILTER: SceneFilter = { query: "", type: "" };

export function isFiltering(filter: SceneFilter): boolean {
  return filter.query.trim() !== "" || filter.type !== "";
}

/**
 * Entries that pass the filter. `typeLabel` is the editor's friendly name for a class ("Player ship"), so
 * the author can search for the word they see as well as the engine's.
 */
export function filterScene(
  entries: readonly SceneEntry[],
  filter: SceneFilter,
  typeLabel: (type: string) => string = (type) => type,
): readonly SceneEntry[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  return entries.filter((entry) => {
    if (filter.type !== "" && entry.type !== filter.type) return false;
    if (words.length === 0) return true;
    const haystack = [entry.id, entry.name, entry.type, typeLabel(entry.type), entry.groupLabel ?? "", entry.groupId ?? "", entry.sectorLabel, entry.description]
      .join("\n")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Names shown more than once, in any group: those rows must always carry their id and group so they can be told apart. */
export function duplicateNames(entries: readonly SceneEntry[]): ReadonlySet<string> {
  const count = new Map<string, number>();
  for (const entry of entries) count.set(entry.name, (count.get(entry.name) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name));
}

/** Selected ids that the filter is hiding — a filter must say so rather than silently drop them from view. */
export function hiddenSelected(
  selected: readonly string[],
  visible: readonly SceneEntry[],
  kind: SceneEntry["kind"],
): readonly string[] {
  const shown = new Set(visible.filter((e) => e.kind === kind).map((e) => e.id));
  return selected.filter((id) => !shown.has(id));
}

/** Engine classes present in the scene, for the type filter, in first-seen order. */
export function typesInScene(entries: readonly SceneEntry[]): readonly string[] {
  return [...new Set(entries.map((e) => e.type))];
}
