import type { EECatalog } from "@forge/contracts";
import type { FieldSpec } from "./fields.js";
import { TEMPLATE_FIELDS, templateFieldDoc } from "./template-fields.js";

/**
 * The ship form in five sections.
 *
 * The descriptors already say which block a field belongs to (`group`): eight of them, which is what the
 * emitted file is organised by but more than a form needs as navigation. This folds them into the five an
 * author thinks in — what it is, what it is made of, how it moves, what it shoots, what is inside — without
 * touching the descriptors, so a field added to `TEMPLATE_FIELDS` appears in the form with no change here:
 * a group this table does not name lands in the last section, never nowhere (a test asserts every field is
 * reachable).
 */
export type TemplateSectionId = "identity" | "hull" | "movement" | "weapons" | "interior";

export interface TemplateSection {
  readonly id: TemplateSectionId;
  readonly label: string;
  /** Descriptor groups shown in this section, in form order. */
  readonly groups: readonly string[];
}

export const TEMPLATE_SECTIONS: readonly TemplateSection[] = [
  { id: "identity", label: "Identity", groups: ["Identity"] },
  { id: "hull", label: "Hull", groups: ["Hull", "Sensors"] },
  { id: "movement", label: "Movement", groups: ["Movement"] },
  { id: "weapons", label: "Weapons", groups: ["Weapons"] },
  { id: "interior", label: "Interior", groups: ["Deck plan", "Docking", "Crew abilities"] },
];

const FALLBACK: TemplateSectionId = "interior";

export function sectionOfGroup(group: string): TemplateSectionId {
  return TEMPLATE_SECTIONS.find((s) => s.groups.includes(group))?.id ?? FALLBACK;
}

export function sectionOfField(spec: FieldSpec): TemplateSectionId {
  return sectionOfGroup(spec.group ?? "");
}

/** A section with its descriptor groups, each holding its fields in form order. */
export interface TemplateSectionContent extends TemplateSection {
  readonly blocks: readonly (readonly [string, readonly FieldSpec[]])[];
}

export function templateSections(): readonly TemplateSectionContent[] {
  const blocks = new Map<TemplateSectionId, Map<string, FieldSpec[]>>();
  for (const spec of TEMPLATE_FIELDS) {
    const id = sectionOfField(spec);
    const group = spec.group ?? "";
    const byGroup = blocks.get(id) ?? new Map<string, FieldSpec[]>();
    byGroup.set(group, [...(byGroup.get(group) ?? []), spec]);
    blocks.set(id, byGroup);
  }
  return TEMPLATE_SECTIONS.map((section) => {
    const byGroup = blocks.get(section.id) ?? new Map<string, FieldSpec[]>();
    // The table's order for the groups it names; any other group after them.
    const named = section.groups.filter((g) => byGroup.has(g));
    const rest = [...byGroup.keys()].filter((g) => !section.groups.includes(g));
    return { ...section, blocks: [...named, ...rest].map((g) => [g, byGroup.get(g) ?? []] as const) };
  });
}

export interface TemplateFieldMatch {
  readonly spec: FieldSpec;
  readonly section: TemplateSectionId;
  readonly group: string;
  /** What matched: the field's own names, or only its help text (offered when no name matches). */
  readonly via: "name" | "help";
}

/**
 * Find fields by what an author would type: part of the label, the key, the section or group, or the EE method
 * (`setRadarTrace`). Every word has to match somewhere (so "beam arc" finds Beams). Only when no field is named
 * like that does the help text count — a word that a paragraph happens to contain should not bury the field the
 * author meant under fields that merely mention it.
 *
 * Pure and read-only — it looks at descriptors, never at a template's values — which is what lets the search
 * move the view without being able to change a document.
 */
export function searchTemplateFields(query: string, catalog: EECatalog | null): readonly TemplateFieldMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return [];
  const sectionLabel = (id: TemplateSectionId): string => TEMPLATE_SECTIONS.find((x) => x.id === id)?.label ?? "";
  const named: TemplateFieldMatch[] = [];
  const helped: TemplateFieldMatch[] = [];
  for (const spec of TEMPLATE_FIELDS) {
    const section = sectionOfField(spec);
    const names = [spec.label, spec.key, spec.group ?? "", sectionLabel(section), spec.ee?.method ?? ""].join(" ").toLowerCase();
    const doc = (catalog === null ? spec.hint ?? "" : templateFieldDoc(catalog, spec) ?? "").toLowerCase();
    const group = spec.group ?? "";
    if (words.every((w) => names.includes(w))) named.push({ spec, section, group, via: "name" });
    else if (words.every((w) => names.includes(w) || doc.includes(w))) helped.push({ spec, section, group, via: "help" });
  }
  return named.length > 0 ? named : helped;
}
