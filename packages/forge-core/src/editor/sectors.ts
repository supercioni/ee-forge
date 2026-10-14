import type { EEMapGroup, EEMarker, EEProject, EESector } from "@forge/contracts";
import { sectorReferences, startSectorOf } from "../sector-runtime.js";
import { uniqueObjectId } from "./factories.js";

/**
 * Sectors: how an author organises a map into parts — a star system, a place reached by a jump (ADR-0055).
 *
 * **Sector → Group → Object.** A sector holds groups and markers; "Shared" (sector `null`) holds what several
 * sectors have in common, such as the player ship. This is authoring organisation and nothing more: it adds no game
 * rule, never changes when a group spawns, and never touches the exported Lua. Every operation here is pure and keeps
 * what matters — the ids of groups, objects and markers, their coordinates and properties, every reference from
 * rules and dialogues, `At mission start` / `When a rule spawns it`, and **the order of `map.groups`** (which is the
 * order groups are generated in; the order the editor *shows* them in is derived from it and never written back).
 */

/** The id Forge gives the first sector of a project it migrates or creates. */
export const INITIAL_SECTOR_ID = "sector-1";
export const INITIAL_SECTOR_LABEL = "Sector 1";

/** The place a group or marker is filed under: a sector id, or null for Shared. */
export type SectorRef = string | null;

export const SHARED_LABEL = "Shared";

export function sectorLabel(project: EEProject, sector: SectorRef): string {
  if (sector === null) return SHARED_LABEL;
  return project.map.sectors.find((s) => s.id === sector)?.label ?? sector;
}

export function sectorById(project: EEProject, id: string): EESector | undefined {
  return project.map.sectors.find((s) => s.id === id);
}

export function groupsOfSector(project: EEProject, sector: SectorRef): readonly EEMapGroup[] {
  return project.map.groups.filter((g) => g.sector === sector);
}

export function markersOfSector(project: EEProject, sector: SectorRef): readonly EEMarker[] {
  return project.map.markers.filter((m) => m.sector === sector);
}

export interface SectorCounts {
  readonly groups: number;
  readonly objects: number;
  readonly markers: number;
}

export function countsOfSector(project: EEProject, sector: SectorRef): SectorCounts {
  const groups = groupsOfSector(project, sector);
  return {
    groups: groups.length,
    objects: groups.reduce((n, g) => n + g.objects.length, 0),
    markers: markersOfSector(project, sector).length,
  };
}

/** The sector an object's group is filed under (undefined when the object does not exist). */
export function sectorOfObject(project: EEProject, objectId: string): SectorRef | undefined {
  return project.map.groups.find((g) => g.objects.some((o) => o.id === objectId))?.sector;
}

export function sectorOfMarker(project: EEProject, markerId: string): SectorRef | undefined {
  return project.map.markers.find((m) => m.id === markerId)?.sector;
}

export function sectorOfGroup(project: EEProject, groupId: string): SectorRef | undefined {
  return project.map.groups.find((g) => g.id === groupId)?.sector;
}

/** A label no other sector uses (case-insensitive), or the reason it cannot be used. */
export function checkSectorLabel(project: EEProject, label: string, ignoreId?: string): string | null {
  const name = label.trim();
  if (name === "") return "A sector needs a name.";
  if (name.toLowerCase() === SHARED_LABEL.toLowerCase()) return "“Shared” is the name of the area for shared content.";
  const clash = project.map.sectors.find((s) => s.id !== ignoreId && s.label.trim().toLowerCase() === name.toLowerCase());
  return clash === undefined ? null : `A sector called “${clash.label}” already exists.`;
}

/** Adds a sector at the end of the list. Returns the new project and the id given to it, or the reason it was refused. */
export function addSector(
  project: EEProject,
  label: string,
): { readonly ok: true; readonly project: EEProject; readonly id: string } | { readonly ok: false; readonly reason: string } {
  const problem = checkSectorLabel(project, label);
  if (problem !== null) return { ok: false, reason: problem };
  const id = uniqueObjectId(new Set(project.map.sectors.map((s) => s.id)), label.trim());
  return {
    ok: true,
    id,
    project: { ...project, map: { ...project.map, sectors: [...project.map.sectors, { id, label: label.trim() }] } },
  };
}

export function renameSector(
  project: EEProject,
  id: string,
  label: string,
): { readonly ok: true; readonly project: EEProject } | { readonly ok: false; readonly reason: string } {
  if (sectorById(project, id) === undefined) return { ok: false, reason: "That sector no longer exists." };
  const problem = checkSectorLabel(project, label, id);
  if (problem !== null) return { ok: false, reason: problem };
  return {
    ok: true,
    project: {
      ...project,
      map: { ...project.map, sectors: project.map.sectors.map((s) => (s.id === id ? { ...s, label: label.trim() } : s)) },
    },
  };
}

/** Files a group under a sector (or Shared). Position in `map.groups` — and so spawn order — does not change. */
export function assignGroupToSector(project: EEProject, groupId: string, sector: SectorRef): EEProject {
  const group = project.map.groups.find((g) => g.id === groupId);
  if (group === undefined || group.sector === sector) return project;
  if (sector !== null && sectorById(project, sector) === undefined) return project;
  return {
    ...project,
    map: { ...project.map, groups: project.map.groups.map((g) => (g.id === groupId ? { ...g, sector } : g)) },
  };
}

export function assignMarkerToSector(project: EEProject, markerId: string, sector: SectorRef): EEProject {
  const marker = project.map.markers.find((m) => m.id === markerId);
  if (marker === undefined || marker.sector === sector) return project;
  if (sector !== null && sectorById(project, sector) === undefined) return project;
  return {
    ...project,
    map: { ...project.map, markers: project.map.markers.map((m) => (m.id === markerId ? { ...m, sector } : m)) },
  };
}

/**
 * Deletes a sector. It never deletes what is in it: a sector that holds groups or markers needs a destination
 * (another sector, or Shared) and they move there, whole. An empty one needs none.
 */
export function removeSector(
  project: EEProject,
  id: string,
  destination?: SectorRef,
): { readonly ok: true; readonly project: EEProject; readonly moved: SectorCounts } | { readonly ok: false; readonly reason: string } {
  if (sectorById(project, id) === undefined) return { ok: false, reason: "That sector no longer exists." };
  // A sector the game starts in, or that a rule jumps to or tests for, cannot vanish from under it (ADR-0056).
  const held = sectorHeldBy(project, id);
  if (held !== null) return { ok: false, reason: held };
  const counts = countsOfSector(project, id);
  const empty = counts.groups === 0 && counts.markers === 0;
  if (!empty) {
    if (destination === undefined) {
      return { ok: false, reason: `“${sectorLabel(project, id)}” still holds ${describeCounts(counts)}. Choose where they go; nothing is deleted with a sector.` };
    }
    if (destination === id) return { ok: false, reason: "Choose a different place for its contents." };
    if (destination !== null && sectorById(project, destination) === undefined) {
      return { ok: false, reason: "The place chosen for its contents does not exist." };
    }
  }
  const to = destination ?? null;
  return {
    ok: true,
    moved: counts,
    project: {
      ...project,
      map: {
        ...project.map,
        sectors: project.map.sectors.filter((s) => s.id !== id),
        groups: project.map.groups.map((g) => (g.sector === id ? { ...g, sector: to } : g)),
        markers: project.map.markers.map((m) => (m.sector === id ? { ...m, sector: to } : m)),
      },
    },
  };
}

export function describeCounts(counts: SectorCounts): string {
  const parts: string[] = [];
  if (counts.groups > 0) parts.push(`${counts.groups} group${counts.groups === 1 ? "" : "s"}`);
  if (counts.markers > 0) parts.push(`${counts.markers} marker${counts.markers === 1 ? "" : "s"}`);
  return parts.length === 0 ? "nothing" : parts.join(" and ");
}

/** Sector ids that two or more sectors share (a hand-edited document). */
export function duplicateSectorIds(project: EEProject): readonly string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const s of project.map.sectors) {
    if (seen.has(s.id)) twice.add(s.id);
    seen.add(s.id);
  }
  return [...twice];
}

export interface DanglingSector {
  readonly kind: "group" | "marker";
  readonly id: string;
  readonly label: string;
  readonly sector: string;
}

/** Groups and markers filed under a sector that does not exist (a hand-edited document). */
export function danglingSectors(project: EEProject): readonly DanglingSector[] {
  const known = new Set(project.map.sectors.map((s) => s.id));
  const out: DanglingSector[] = [];
  for (const g of project.map.groups) if (typeof g.sector === "string" && !known.has(g.sector)) out.push({ kind: "group", id: g.id, label: g.label, sector: g.sector });
  for (const m of project.map.markers) if (typeof m.sector === "string" && !known.has(m.sector)) out.push({ kind: "marker", id: m.id, label: m.label, sector: m.sector });
  return out;
}

/** Why a sector must stay (the game starts in it, or rules use it), in plain words — or null when nothing holds it. */
export function sectorHeldBy(project: EEProject, id: string): string | null {
  const name = sectorLabel(project, id);
  if (startSectorOf(project) === id) return `“${name}” is the sector the game starts in. Choose another starting sector (or none) before deleting it.`;
  if (!sectorReferences(project).sectors.has(id)) return null;
  const rule = [...project.logic.rules.map((r) => ({ label: r.label, text: JSON.stringify(r) })), ...project.logic.beats.map((b) => ({ label: b.label, text: JSON.stringify(b) }))].find(
    (x) => x.text.includes(`"sectorId":${JSON.stringify(id)}`),
  );
  return `A rule still uses “${name}” (Change sector or Current sector is${rule === undefined ? "" : `: “${rule.label}”`}). Change that first.`;
}

/** Sets (or clears, with null) the sector the game starts in. Not the sector open in the editor. */
export function setStartSector(project: EEProject, sector: string | null): EEProject {
  if (project.map.startSector === sector) return project;
  if (sector !== null && sectorById(project, sector) === undefined) return project;
  return { ...project, map: { ...project.map, startSector: sector } };
}
