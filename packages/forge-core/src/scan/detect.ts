import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogProvenance } from "../catalog/load.js";
import { EE_TARGETS } from "../targets.js";

/**
 * Which registered target an install is, judged by evidence rather than by
 * where the folder lives or what the caller says it is.
 *
 * The evidence is the SHA-256 of the install's own `script_reference.html`,
 * the file the catalog was generated from. A match is proof the reference
 * is byte-identical to the one a catalog was built from; no match returns
 * `null` and the caller must treat the install as unverified — a new
 * prerelease is a target to verify, not one to assume compatible.
 */
export function detectInstallTarget(eeInstall: string): string | null {
  const digest = installEvidence(eeInstall);
  if (digest === null) return null;
  for (const target of EE_TARGETS) {
    if (catalogProvenance(target.id).scriptReferenceSha256 === digest) return target.id;
  }
  return null;
}

/** SHA-256 of the install's `script_reference.html`, or null when it has none. */
export function installEvidence(eeInstall: string): string | null {
  const reference = join(eeInstall, "script_reference.html");
  if (!existsSync(reference)) return null;
  return createHash("sha256").update(readFileSync(reference)).digest("hex");
}
