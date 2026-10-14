import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EECatalogSchema, type EECatalog } from "@forge/contracts";
import { supplementEcsSources } from "./ecs-source.js";
import { parseScriptReference } from "./parse.js";

/**
 * Generates `catalog.generated.json` from a pinned EE install.
 *
 * The catalog is committed so the toolchain works without an EE install
 * present (CI, a fresh clone, the editor UI). Re-run it when EE is
 * upgraded: the JSON diff is the upgrade impact report (ADR-0034 §2).
 */

export const CATALOG_FILENAME = "catalog.generated.json";

export interface GenerateCatalogInput {
  /** Root of the EE install, e.g. `/mnt/c/…/EmptyEpsilon`. */
  eeInstall: string;
  /** EE build identifier recorded in the artifact. */
  eeVersion: string;
  /** Directory the JSON is written to. */
  outDir: string;
  /** Output file name; defaults to CATALOG_FILENAME. */
  fileName?: string;
  /** Injected in tests so output is byte-stable. */
  generatedAt?: string;
}

export interface GenerateCatalogResult {
  catalog: EECatalog;
  outPath: string;
  classCount: number;
  methodCount: number;
  globalCount: number;
  enumCount: number;
}

export function generateCatalog(input: GenerateCatalogInput): GenerateCatalogResult {
  const source = join(input.eeInstall, "script_reference.html");
  const html = readFileSync(source, "utf8");

  const parsed = parseScriptReference(html, {
    eeVersion: input.eeVersion,
    source,
    ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
  });

  supplementEcsSources(parsed, join(input.eeInstall, "scripts", "api"));

  // Validate our own artifact before writing it: a parser regression that
  // produced a malformed catalog would otherwise only surface much later,
  // as a confusing codegen failure.
  const catalog = EECatalogSchema.parse(parsed);

  if (Object.keys(catalog.classes).length === 0 || catalog.globals.length === 0 ||
      !Object.values(catalog.classes).some((cls) => cls.methods.length > 0)) {
    throw new Error(`Unrecognized or empty EE reference: ${source}. Existing catalog was not overwritten.`);
  }

  const outPath = join(input.outDir, input.fileName ?? CATALOG_FILENAME);
  writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

  const methodCount = Object.values(catalog.classes).reduce(
    (n, c) => n + c.methods.length,
    0,
  );

  return {
    catalog,
    outPath,
    classCount: Object.keys(catalog.classes).length,
    methodCount,
    globalCount: catalog.globals.length,
    enumCount: Object.keys(catalog.enums).length,
  };
}
