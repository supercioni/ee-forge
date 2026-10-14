import type { EEProject } from "@forge/contracts";

/**
 * Sectors in play (ADR-0056) — the questions both the emitter and the editor's problem list ask of a project.
 *
 * Kept above `codegen/` and `editor/` for the reason `points.ts` gives: the build and Problems must agree, and a
 * check implemented twice is two checks that drift. The build throws on the first error and returns warnings as
 * sentences; the problem list shows every issue with where to go. Both read this one list.
 */

/** A record carrying `kind`, found anywhere in the narrative (rules, beats, buttons, dialogue replies, step alternatives). */
function walkKinds(value: unknown, kind: string, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) walkKinds(item, kind, out);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record["kind"] === kind) out.push(record);
  for (const item of Object.values(record)) walkKinds(item, kind, out);
}

/** Every record of this `kind` in the project's narrative. */
export function foundKind(project: EEProject, kind: string): Record<string, unknown>[] {
  return found(project, kind);
}

function found(project: EEProject, kind: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  walkKinds(project.logic, kind, out);
  return out;
}

/** The sector the game starts in, or null (tolerant of a hand-built map with no such field). */
export function startSectorOf(project: EEProject): string | null {
  return typeof project.map.startSector === "string" ? project.map.startSector : null;
}

/** True when the project asks for sectors to mean something during play. Otherwise the generated Lua is exactly what it always was. */
export function usesSectorRuntime(project: EEProject): boolean {
  return (
    startSectorOf(project) !== null ||
    // Campaign saves (ADR-0058) keep sectors, so they need the sector runtime (read directly: persistence.ts imports this file).
    (project as { campaign?: { persistence?: boolean } }).campaign?.persistence === true ||
    found(project, "change_sector").length > 0 ||
    found(project, "current_sector").length > 0
  );
}

/**
 * True when the project can leave a sector during play (it holds a Change sector action). Only then does the generated Lua carry the
 * registry and the sweep of the crew's mines, probes and missiles (ADR-0057); a project that merely names a start sector never jumps.
 */
export function usesSectorJumps(project: EEProject): boolean {
  return found(project, "change_sector").length > 0;
}

export interface SectorIssue {
  readonly severity: "error" | "warning";
  readonly code:
    | "start-sector-unknown"
    | "sector-needs-start"
    | "change-sector-unknown"
    | "change-sector-marker"
    | "current-sector-unknown"
    | "spawn-other-sector"
    | "player-outside-start";
  /** What it is about, in the author's words. */
  readonly subject: string;
  readonly title: string;
  readonly message: string;
  readonly action: string;
  /** A group or marker the problem list can open, when there is one. */
  readonly where: { readonly kind: "group" | "marker"; readonly id: string } | null;
  /** Stable key for the problem id. */
  readonly key: string;
}

const q = (s: string): string => `“${s}”`;

export function sectorIssues(project: EEProject): readonly SectorIssue[] {
  const issues: SectorIssue[] = [];
  if (!usesSectorRuntime(project)) return issues;
  const sectors = new Map(project.map.sectors.map((s) => [s.id, s.label] as const));
  const label = (id: string): string => sectors.get(id) ?? id;
  const markers = new Map(project.map.markers.map((m) => [m.id, m] as const));
  const groups = new Map(project.map.groups.map((g) => [g.id, g] as const));
  const start = startSectorOf(project);

  if (start !== null && !sectors.has(start)) {
    issues.push({
      severity: "error",
      code: "start-sector-unknown",
      subject: "Starting sector",
      title: "The starting sector does not exist",
      message: `The game is set to start in the sector ${q(start)}, which is not in this project.`,
      action: "Choose an existing sector as the starting one, or clear the choice.",
      where: null,
      key: start,
    });
  }
  const changes = found(project, "change_sector");
  const currents = found(project, "current_sector");
  if (start === null && changes.length + currents.length > 0) {
    issues.push({
      severity: "error",
      code: "sector-needs-start",
      subject: "Starting sector",
      title: "Change sector needs a starting sector",
      message: "Rules use Change sector or Current sector, but no sector is marked as the one the game starts in.",
      action: "Mark a sector as the starting one in the Scene list (Start here).",
      where: null,
      key: "none",
    });
  }
  for (const c of changes) {
    const id = String(c["sectorId"]);
    const marker = markers.get(String(c["arrivalMarkerId"]));
    if (!sectors.has(id)) {
      issues.push({
        severity: "error",
        code: "change-sector-unknown",
        subject: `Change sector → ${id}`,
        title: "A jump goes to a sector that does not exist",
        message: `Change sector names ${q(id)}, which is not a sector of this project. Nothing would be unloaded, but the jump could not happen.`,
        action: "Open the rule and choose an existing sector.",
        where: null,
        key: `${id}/${String(c["arrivalMarkerId"])}`,
      });
    } else if (marker === undefined || marker.sector !== id) {
      issues.push({
        severity: "error",
        code: "change-sector-marker",
        subject: `Change sector → ${label(id)}`,
        title: "The arrival marker is not in the destination sector",
        message:
          marker === undefined
            ? `The arrival marker ${q(String(c["arrivalMarkerId"]))} does not exist.`
            : `The arrival marker ${q(marker.label)} is filed under ${marker.sector === null ? "Shared" : label(marker.sector)}, not under ${label(id)}.`,
        action: `Choose a marker of ${label(id)}, or move the marker into that sector.`,
        where: marker === undefined ? null : { kind: "marker", id: marker.id },
        key: `${id}/${String(c["arrivalMarkerId"])}`,
      });
    }
  }
  for (const c of currents) {
    const id = String(c["sectorId"]);
    if (!sectors.has(id)) {
      issues.push({
        severity: "error",
        code: "current-sector-unknown",
        subject: `Current sector is ${id}`,
        title: "A condition names a sector that does not exist",
        message: `“Current sector is” names ${q(id)}, which is not a sector of this project, so it can never be true.`,
        action: "Open the rule and choose an existing sector.",
        where: null,
        key: id,
      });
    }
  }

  // A rule that only runs in sector X and spawns a group filed under sector Y: the run-time guard would refuse it.
  for (const rule of project.logic.rules) {
    const only = new Set<string>();
    for (const predicate of [rule.when, ...rule.conditions]) {
      if (predicate.kind === "current_sector") only.add(predicate.sectorId);
    }
    if (only.size === 0) continue;
    for (const action of rule.actions) {
      if (action.kind !== "spawn_group") continue;
      const group = groups.get(action.groupId);
      if (group === undefined || group.sector === null || only.has(group.sector)) continue;
      issues.push({
        severity: "warning",
        code: "spawn-other-sector",
        subject: `Rule ${q(rule.label)}`,
        title: "A rule spawns a group of a sector it does not run in",
        message: `The rule only runs in ${[...only].map(label).join(" / ")}, but spawns ${q(group.label)}, which is filed under ${label(group.sector)}. A group of an inactive sector is never created: the spawn would be refused at run time.`,
        action: `Spawn a group of the sector the rule runs in, or move ${q(group.label)}.`,
        where: { kind: "group", id: group.id },
        key: `${rule.id}/${group.id}`,
      });
    }
  }

  // The player ship is created at the start: if it is filed under another sector it will not exist.
  if (start !== null) {
    for (const group of project.map.groups) {
      if (group.sector === null || group.sector === start || group.when !== "on_start") continue;
      if (!group.objects.some((o) => o.type === "PlayerSpaceship")) continue;
      issues.push({
        severity: "warning",
        code: "player-outside-start",
        subject: `Group ${q(group.label)}`,
        title: "The player ship is not in the starting sector or Shared",
        message: `${q(group.label)} holds the player ship and is filed under ${label(group.sector)}, but the game starts in ${label(start)}: the ship would not be created at the start.`,
        action: "Move the group to Shared (the usual place for the player ship) or to the starting sector.",
        where: { kind: "group", id: group.id },
        key: group.id,
      });
    }
  }
  return issues;
}

/** The sector ids, and marker ids, that rules and the start choice hold — what must not vanish from under them. */
export function sectorReferences(project: EEProject): {
  readonly sectors: ReadonlySet<string>;
  readonly arrivalMarkers: ReadonlySet<string>;
} {
  const sectors = new Set<string>();
  const arrival = new Set<string>();
  const startId = startSectorOf(project);
  if (startId !== null) sectors.add(startId);
  for (const c of found(project, "change_sector")) {
    sectors.add(String(c["sectorId"]));
    arrival.add(String(c["arrivalMarkerId"]));
  }
  for (const c of found(project, "current_sector")) sectors.add(String(c["sectorId"]));
  return { sectors, arrivalMarkers: arrival };
}
