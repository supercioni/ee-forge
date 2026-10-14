import { EEIdSchema, type EEObject, type EEProject } from "@forge/contracts";

/**
 * Renaming an object id.
 *
 * An object id is not a label: it is the only handle the rest of the
 * document has on that object. A planet's moon points at it through
 * `orbit.targetId`, a rule points at it through `objectId`, a formation
 * order through `leaderId`, and any action can address it through
 * `target: {ref:"object", objectId}`. Changing the id without rewriting
 * those turns them into references to nothing — which the build would
 * catch, but minutes later and in another view.
 *
 * The rewrite is a deep walk keyed on the *field names* that hold an
 * object id, rather than a case per predicate and action. That way an
 * action added to the model later is covered the day it is added; a test
 * walks the schema and fails if a new field holds an id under a name this
 * list does not know.
 */

/**
 * Field names whose value is the id of an *object*.
 *
 * `zoneId` belongs here: a Zone is an object like any other in this model
 * (`EEObjectSchema` has a `Zone` variant), so renaming one has to reach
 * `player_in_zone`. The schema-walking test found that; a hand-written
 * list would have missed it.
 */
export const OBJECT_ID_KEYS = ["objectId", "leaderId", "targetId", "zoneId"] as const;

/** Field names whose value is the id of a *group* — a separate namespace. */
export const GROUP_ID_KEYS = ["groupId"] as const;

/**
 * Field names whose value is the id of a *marker* (ADR-0038).
 *
 * Its own namespace, like groups: a marker and an object may share a name,
 * so {@link renameObject} deliberately leaves these alone and
 * {@link renameMarker} deliberately leaves object ids alone.
 */
export const MARKER_ID_KEYS = ["markerId", "arrivalMarkerId"] as const;

/** Field names whose value is the id of a *sector* (ADR-0056). Sector ids are never renamed, so nothing rewrites them; the list exists so a new id-holding field cannot go unnoticed. */
export const SECTOR_ID_KEYS = ["sectorId"] as const;

export type IdProblem = "empty" | "invalid" | "taken";

/**
 * Why `next` cannot be this object's id, or null when it can.
 *
 * Returning null for "unchanged" is deliberate: a control that reports the
 * current id as taken would flag every field it is attached to.
 */
export function checkObjectId(
  project: EEProject,
  currentId: string,
  next: string,
): IdProblem | null {
  if (next === currentId) return null;
  if (next.trim() === "") return "empty";
  if (!EEIdSchema.safeParse(next).success) return "invalid";
  const taken = project.map.groups.some((group) =>
    group.objects.some((object) => object.id === next),
  );
  return taken ? "taken" : null;
}

/** Human-readable reason, for the control that refused the edit. */
export function describeIdProblem(problem: IdProblem): string {
  switch (problem) {
    case "empty":
      return "an id cannot be empty";
    case "invalid":
      return "lowercase letters, digits, - and _ only, starting with a letter or digit";
    case "taken":
      return "another object already has this id";
  }
}

/**
 * Rename an object and every reference to it.
 *
 * A no-op when the id is unchanged or the new one is unusable — callers
 * are expected to have asked {@link checkObjectId} first, and a rename
 * that silently half-applied would be worse than one that did nothing.
 */
export function renameObject(project: EEProject, from: string, to: string): EEProject {
  if (from === to) return project;
  if (checkObjectId(project, from, to) !== null) return project;

  const renamed: EEProject = {
    ...project,
    map: {
      ...project.map,
      groups: project.map.groups.map((group) => ({
        ...group,
        objects: group.objects.map((object) =>
          object.id === from ? ({ ...object, id: to } as EEObject) : object,
        ),
      })),
    },
  };
  return rewriteIds(renamed, from, to) as EEProject;
}

/**
 * Why `next` cannot be this marker's id, or null when it can.
 *
 * Same three answers as {@link checkObjectId}, against the marker
 * namespace — an id already taken by an *object* is fine here.
 */
export function checkMarkerId(
  project: EEProject,
  currentId: string,
  next: string,
): IdProblem | null {
  if (next === currentId) return null;
  if (next.trim() === "") return "empty";
  if (!EEIdSchema.safeParse(next).success) return "invalid";
  return project.map.markers.some((marker) => marker.id === next) ? "taken" : null;
}

/**
 * Rename a marker and every place that names it.
 *
 * Without this, renaming a marker would break exactly the references the
 * marker exists to hold together — and the build would say so, but only
 * later and in another view.
 */
export function renameMarker(project: EEProject, from: string, to: string): EEProject {
  if (from === to) return project;
  if (checkMarkerId(project, from, to) !== null) return project;

  const renamed: EEProject = {
    ...project,
    map: {
      ...project.map,
      markers: project.map.markers.map((marker) =>
        marker.id === from ? { ...marker, id: to } : marker,
      ),
    },
  };
  return rewriteIds(renamed, from, to, MARKER_ID_KEYS) as EEProject;
}

/**
 * Replace `from` with `to` at every field in `keys`, however deep. The
 * other namespaces are left alone: an object, a group and a marker are all
 * allowed to share a name.
 */
function rewriteIds(
  value: unknown,
  from: string,
  to: string,
  keys: readonly string[] = OBJECT_ID_KEYS,
): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteIds(item, from, to, keys));
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    const holdsId = keys.includes(key);
    out[key] = holdsId && item === from ? to : rewriteIds(item, from, to, keys);
  }
  return out;
}
