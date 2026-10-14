import type { EEObject, EEProject } from "@forge/contracts";

/**
 * Moving map objects from one ship template to another.
 *
 * Copying a stock hull into a project makes a *new* template — EE offers
 * no way to copy one at runtime, so the copy carries a new name (ADR-0041)
 * — and every object that was flying the stock ship keeps flying it. The
 * build still succeeds, the scenario still runs, and the change an author
 * thought they had made is simply not in the game.
 *
 * So the copy is followed by an offer to move them, and this is the part
 * that has to be right: a template name is a plain string on three of the
 * object types and on nothing else.
 *
 * Deliberately not folded into `rename.ts`. That file rewrites **ids**,
 * the document's internal handles, by field name wherever they appear. A
 * template name is neither an id nor internal — it is a reference to
 * something EE owns, which a project may not define at all.
 */

/** Object types that carry a `template`. Nothing else in the model does. */
const TEMPLATED = ["PlayerSpaceship", "CpuShip", "SpaceStation"] as const;

function isTemplated(object: EEObject): object is Extract<EEObject, { template: string }> {
  return (TEMPLATED as readonly string[]).includes(object.type);
}

/** Ids of the objects flying `template`, in document order. */
export function objectsUsingTemplate(
  project: EEProject,
  template: string,
): readonly string[] {
  const found: string[] = [];
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      if (isTemplated(object) && object.template === template) found.push(object.id);
    }
  }
  return found;
}

/** One map object that spawns a template — enough to name it and to go to it. */
export interface TemplateInstance {
  readonly id: string;
  readonly callsign: string | null;
  readonly type: string;
  readonly groupId: string;
  readonly groupLabel: string;
}

/**
 * The objects flying `template`, with the group each is in, in document order.
 *
 * The same walk as {@link objectsUsingTemplate} — there is one definition of "uses a template" — carrying what a
 * list needs to show them, so "Used by" and the reassignment offer name the very objects a move would change.
 */
export function instancesOfTemplate(project: EEProject, template: string): readonly TemplateInstance[] {
  const found: TemplateInstance[] = [];
  for (const group of project.map.groups) {
    for (const object of group.objects) {
      if (isTemplated(object) && object.template === template) {
        found.push({ id: object.id, callsign: object.callsign ?? null, type: object.type, groupId: group.id, groupLabel: group.label });
      }
    }
  }
  return found;
}

/**
 * Point every object flying `from` at `to`.
 *
 * Returns the document unchanged when nothing referenced `from`, so a
 * caller can treat identity as "nothing to do" rather than counting first.
 */
export function retargetTemplate(project: EEProject, from: string, to: string): EEProject {
  if (from === to || objectsUsingTemplate(project, from).length === 0) return project;
  return {
    ...project,
    map: {
      ...project.map,
      groups: project.map.groups.map((group) => ({
        ...group,
        objects: group.objects.map((object) =>
          isTemplated(object) && object.template === from ? { ...object, template: to } : object,
        ),
      })),
    },
  };
}
