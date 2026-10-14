import type { SpawnableClass } from "@forge/contracts";
import { fieldsFor, type FieldSpec } from "./fields.js";

/**
 * How an object's properties are sectioned in the inspector.
 *
 * The descriptors in `fields.ts` are one flat list per class (and the ship editor groups its own through
 * `FieldSpec.group`). The map inspector wants a few plain headings, so this maps each field key to one. It is a table
 * here, not a switch in the panel, and the test proves two things: every field of every class lands in a section
 * (nothing becomes unreachable), and a key this table has not heard of falls into "More" rather than disappearing.
 */

export const SECTION_ORDER = ["Identity", "Position & shape", "Behavior", "Story", "Appearance", "More"] as const;
export type FieldSection = (typeof SECTION_ORDER)[number];

const SECTION_OF: Readonly<Record<string, FieldSection>> = {
  callsign: "Identity",
  description: "Identity",
  faction: "Identity",
  label: "Identity",
  position: "Position & shape",
  rotation: "Position & shape",
  size: "Position & shape",
  radius: "Position & shape",
  points: "Position & shape",
  range: "Position & shape",
  targetPosition: "Position & shape",
  distanceFromMovementPlane: "Position & shape",
  template: "Behavior",
  ai: "Behavior",
  order: "Behavior",
  orbit: "Behavior",
  speed: "Behavior",
  spin: "Behavior",
  axialRotationTime: "Behavior",
  lifetime: "Behavior",
  target: "Behavior",
  energy: "Behavior",
  hull: "Behavior",
  weaponStorage: "Behavior",
  ownedByPlayer: "Behavior",
  allowPickup: "Behavior",
  dialogueId: "Story",
  variables: "Story",
  surfaceTexture: "Appearance",
  cloudTexture: "Appearance",
  atmosphereTexture: "Appearance",
  atmosphereColor: "Appearance",
  model: "Appearance",
  radarTraceIcon: "Appearance",
  radarTraceScale: "Appearance",
  radarTraceColor: "Appearance",
  color: "Appearance",
};

export function sectionOf(key: string): FieldSection {
  return SECTION_OF[key] ?? "More";
}

export interface FieldSectionGroup {
  readonly section: FieldSection;
  readonly fields: readonly FieldSpec[];
}

/** The class's fields, sectioned in `SECTION_ORDER`, each keeping its descriptor order; empty sections are omitted. */
export function sectionedFields(type: SpawnableClass): readonly FieldSectionGroup[] {
  const fields = fieldsFor(type);
  return SECTION_ORDER.map((section) => ({ section, fields: fields.filter((f) => sectionOf(f.key) === section) })).filter(
    (group) => group.fields.length > 0,
  );
}
