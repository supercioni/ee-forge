import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EELibrarySchema,
  type EELibrary,
  type ForgeInstallation,
  type ForgeLibraryRescanResult,
} from "@forge/contracts";
import { mirrorInstallAssets, scanInstall } from "@forge/core";
import type { ForgeContext } from "./context.js";
import { unprocessable } from "./errors.js";
import type { InstallationService } from "./installations.js";

export const LEGACY_LIBRARY_FILE = "ee-library.json";

export interface LibraryLookup {
  readonly installId?: string | null;
  readonly target?: string | null;
}

export interface LibrarySelection {
  readonly library: EELibrary | null;
  readonly installation: ForgeInstallation | null;
}

/**
 * Per-installation libraries and the asset caches that go with them.
 *
 * Everything an install teaches Forge is stored under that install's id:
 * `libraries/<id>.json` and `cache/<id>/assets/`. Scanning one install can
 * therefore never overwrite another's names or images, and nothing here
 * writes to the application's bundled assets.
 */
export class LibraryService {
  constructor(
    private readonly ctx: ForgeContext,
    private readonly installations: InstallationService,
  ) {}

  libraryPath(installId: string): string {
    return join(this.ctx.librariesDir, `${installId}.json`);
  }

  cacheAssetsDir(installId: string): string {
    return join(this.ctx.cacheDir, installId, "assets");
  }

  private read(path: string): EELibrary | null {
    if (!existsSync(path)) return null;
    try {
      return EELibrarySchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      // A malformed or older-shaped scan degrades the editor to free-text
      // entry rather than failing the request; rescanning rebuilds it.
      this.ctx.logger.warn({ err: error, path }, "forge: ignoring unreadable EE library — rescan the install to rebuild it");
      return null;
    }
  }

  /**
   * Which library applies. An explicit install wins; then the active install
   * of the target; then libraries written before installs were registered
   * (`libraries/<target>.json`, `ee-library.json`), which count only when they
   * were scanned from the same target — never as evidence about another.
   */
  select(lookup: LibraryLookup = {}): LibrarySelection {
    if (lookup.installId !== undefined && lookup.installId !== null) {
      const installation = this.installations.get(lookup.installId);
      return { library: installation === null ? null : this.read(this.libraryPath(installation.id)), installation };
    }
    const target = lookup.target ?? null;
    if (target !== null) {
      const installation = this.installations.activeFor(target);
      if (installation !== null) {
        const library = this.read(this.libraryPath(installation.id));
        if (library !== null) return { library, installation };
      }
      const legacy =
        this.read(join(this.ctx.librariesDir, `${target}.json`)) ?? this.read(join(this.ctx.stateDir, LEGACY_LIBRARY_FILE));
      return { library: legacy !== null && legacy.eeVersion === target ? legacy : null, installation };
    }
    // No target: the most recently scanned install, else the old single file.
    const scanned = this.installations
      .list()
      .filter((candidate) => candidate.scannedAt !== null)
      .sort((a, b) => (b.scannedAt ?? "").localeCompare(a.scannedAt ?? ""))[0];
    if (scanned !== undefined) {
      const library = this.read(this.libraryPath(scanned.id));
      if (library !== null) return { library, installation: scanned };
    }
    return { library: this.read(join(this.ctx.stateDir, LEGACY_LIBRARY_FILE)), installation: null };
  }

  /** Index an installation: library + asset mirror, both stored under its id. */
  rescan(installId: string): ForgeLibraryRescanResult {
    const installation = this.installations.require(installId);
    this.installations.assertStillIdentical(installation);

    let library: EELibrary;
    try {
      library = scanInstall({ eeInstall: installation.path, eeVersion: installation.target });
    } catch (error) {
      throw unprocessable(`could not scan ${installation.path}: ${error instanceof Error ? error.message : String(error)}`, "eeDir");
    }
    mkdirSync(this.ctx.librariesDir, { recursive: true });
    writeFileSync(this.libraryPath(installation.id), `${JSON.stringify(library, null, 2)}\n`, "utf8");

    // Indexing alone would teach the editor a texture's name and leave the
    // canvas asking for an image nobody copied. The copy goes to this
    // install's own cache.
    const mirror = mirrorInstallAssets(installation.path, this.cacheAssetsDir(installation.id));
    const scanned = this.installations.markScanned(installation.id);
    this.ctx.logger.info(
      { id: installation.id, templates: library.templates.length, copied: mirror.copied.length },
      "forge: rescanned EE install",
    );
    return {
      library,
      copied: [...mirror.copied],
      warnings: [...library.warnings, ...mirror.warnings],
      target: scanned.target,
      verified: scanned.verified,
      installation: scanned,
    };
  }
}
