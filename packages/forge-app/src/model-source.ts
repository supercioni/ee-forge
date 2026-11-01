import { extname } from "node:path";
import type { ForgeInstallation, ForgeModelSourceReport } from "@forge/contracts";
import { modelResourceReader } from "@forge/core";
import { notFound } from "./errors.js";
import type { InstallationService } from "./installations.js";
import type { ResolvedAsset } from "./assets.js";

const TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".obj": "text/plain; charset=utf-8",
  ".model": "application/octet-stream",
};

/** At most this many resources are described per request: one model never needs more than five. */
export const MAX_REPORT_PATHS = 40;

/**
 * Model meshes and textures of ONE chosen installation, read live from its `resources/` and `packs/`.
 *
 * The chosen installation is always named in the request. There is no "active" or "newest scan" fallback: an
 * installation that is not registered is an error, one whose folder has gone is reported unavailable, and a
 * resource it does not hold is not found — never answered from some other installation or from a cache.
 */
export class ModelSourceService {
  constructor(private readonly installations: InstallationService) {}

  private summary(installation: ForgeInstallation): ForgeModelSourceReport["installation"] {
    return { id: installation.id, label: installation.label, target: installation.target, verified: installation.verified };
  }

  /** Why the installation cannot be read right now, or null when it can. */
  private problem(installation: ForgeInstallation): string | null {
    try {
      this.installations.assertStillIdentical(installation);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  report(installId: string, paths: readonly string[]): ForgeModelSourceReport {
    const installation = this.installations.get(installId);
    if (installation === null) throw notFound(`no registered installation "${installId}"`, "install");
    const problem = this.problem(installation);
    if (problem !== null) return { installation: this.summary(installation), available: false, problem, resources: [] };
    const reader = modelResourceReader(installation.path);
    const unique = [...new Set(paths)].slice(0, MAX_REPORT_PATHS);
    return { installation: this.summary(installation), available: true, problem: null, resources: unique.map((path) => reader.resolve(path)) };
  }

  file(installId: string, path: string): ResolvedAsset {
    const installation = this.installations.get(installId);
    if (installation === null) throw notFound(`no registered installation "${installId}"`, "install");
    const problem = this.problem(installation);
    if (problem !== null) throw notFound(problem, "install");
    const reader = modelResourceReader(installation.path);
    const found = reader.resolve(path);
    if (found.state !== "ok") throw notFound(`${path}: ${found.detail ?? found.state}`, "path");
    try {
      return { bytes: reader.read(found), contentType: TYPES[extname(path).toLowerCase()] ?? "application/octet-stream", source: "install" };
    } catch (error) {
      throw notFound(`${path}: ${error instanceof Error ? error.message : String(error)}`, "path");
    }
  }
}
