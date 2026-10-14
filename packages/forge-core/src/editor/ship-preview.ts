import type { AssetManifest, AssetManifestEntry, EETemplateDef } from "@forge/contracts";

/**
 * Which glTF, if any, stands in for a ship template.
 *
 * The asset manifest (ADR-0020) is keyed by `${eeClass}:${templateName}`,
 * because it was built for *contacts* — things EE reports at runtime, which
 * always have a stock template name. A template being authored generally
 * has no entry of its own, so the lookup walks the `copyOf` chain: a
 * variant of a stock hull looks like the hull it came from, which is what
 * an author wants to see while tuning its numbers.
 *
 * When nothing in the chain has an entry, the answer is null and the
 * editor says so. Guessing a mesh would be worse than showing none: the
 * preview would then be a picture of a different ship, silently.
 */

/** EE class a template of this kind is spawned as. */
export function previewClassFor(kind: EETemplateDef["kind"]): string {
  switch (kind) {
    case "playership":
      return "PlayerSpaceship";
    case "station":
      return "SpaceStation";
    case "ship":
      return "CpuShip";
  }
}

export interface ShipPreviewModel {
  readonly key: string;
  readonly entry: AssetManifestEntry;
  /** The template whose name matched — the one being edited, or an ancestor. */
  readonly viaTemplateName: string;
}

export function resolveShipModel(
  manifest: AssetManifest,
  template: EETemplateDef,
  templates: readonly EETemplateDef[],
): ShipPreviewModel | null {
  const byName = new Map(templates.map((t) => [t.name, t]));
  const eeClass = previewClassFor(template.kind);

  const seen = new Set<string>();
  let current: EETemplateDef | undefined = template;
  while (current !== undefined && !seen.has(current.name)) {
    seen.add(current.name);
    const key = `${eeClass}:${current.name}`;
    const entry = manifest[key];
    if (entry !== undefined) return { key, entry, viaTemplateName: current.name };
    current = current.copyOf === null ? undefined : byName.get(current.copyOf);
  }

  // Last resort: the chain ended at a name this project does not define,
  // which is exactly the "copies a stock hull" case the manifest can answer.
  const root = lastCopyName(template, byName);
  if (root !== null) {
    const key = `${eeClass}:${root}`;
    const entry = manifest[key];
    if (entry !== undefined) return { key, entry, viaTemplateName: root };
  }
  return null;
}

function lastCopyName(
  template: EETemplateDef,
  byName: ReadonlyMap<string, EETemplateDef>,
): string | null {
  const seen = new Set<string>();
  let current = template;
  while (current.copyOf !== null && !seen.has(current.name)) {
    seen.add(current.name);
    const base = byName.get(current.copyOf);
    if (base === undefined) return current.copyOf;
    current = base;
  }
  return null;
}
