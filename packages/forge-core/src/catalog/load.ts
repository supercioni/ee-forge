import { EECatalogSchema, type EECatalog } from "@forge/contracts";
import catalog2026 from "./catalog.generated.json" with { type: "json" };
import catalog2024 from "./targets/EE-2024.12.08.json" with { type: "json" };
import provenance from "./provenance.json" with { type: "json" };
import { TARGET_2024, TARGET_2026, requireTarget } from "../targets.js";

/**
 * The committed catalogs, one per target, parsed once per process.
 *
 * Imported as JSON rather than read from disk so every consumer — CLI,
 * bridge route, and eventually the editor bundle — gets the same artifact
 * with no filesystem assumptions. 2026 keeps its historical file name
 * (`catalog.generated.json`) so existing consumers and `ee:catalog` keep
 * working; other targets live under `targets/`.
 */
const SOURCES: Readonly<Record<string, unknown>> = {
  [TARGET_2026]: catalog2026,
  [TARGET_2024]: catalog2024,
};

const cache = new Map<string, EECatalog>();

/** Catalog of the given target; defaults to the 2026 pin for old callers. */
export function loadCatalog(target: string = TARGET_2026): EECatalog {
  requireTarget(target);
  let catalog = cache.get(target);
  if (catalog === undefined) {
    catalog = EECatalogSchema.parse(SOURCES[target]);
    if (catalog.eeVersion !== target) {
      throw new Error(
        `catalog registered for ${target} declares ${catalog.eeVersion} — registry and file disagree`,
      );
    }
    cache.set(target, catalog);
  }
  return catalog;
}

export interface CatalogProvenance {
  readonly catalogSha256: string;
  readonly scriptReferenceSha256: string;
  readonly generatedAt: string;
}

export function catalogProvenance(target: string): CatalogProvenance {
  requireTarget(target);
  const entry = (provenance as Record<string, CatalogProvenance | undefined>)[target];
  if (entry === undefined) throw new Error(`no provenance recorded for ${target}`);
  return entry;
}
