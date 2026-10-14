import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { ForgeContext } from "./context.js";
import { notFound } from "./errors.js";
import type { InstallationService } from "./installations.js";
import type { LibraryService } from "./libraries.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
};

export interface ResolvedAsset {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Which store answered: an install's cache or the bundled set. */
  readonly source: "install" | "bundled";
}

/**
 * Serves images, models and the asset manifest to the editor.
 *
 * Lookup order: the requested install's cache (or the active install of the
 * requested target), then the assets bundled with Forge. A name present in
 * both stores therefore resolves to the engine the project targets, and an
 * install that was never scanned falls back to the stock set instead of to
 * another engine's files.
 */
export class AssetService {
  constructor(
    private readonly ctx: ForgeContext,
    private readonly installations: InstallationService,
    private readonly libraries: LibraryService,
  ) {}

  private within(root: string, relative: string): string | null {
    const target = normalize(join(root, relative));
    return target === root || target.startsWith(root + sep) ? target : null;
  }

  resolve(relative: string, scope: { installId?: string | null; target?: string | null } = {}): ResolvedAsset {
    const clean = relative.replace(/^\/+/, "");
    if (clean === "" || clean.split(/[\\/]/).includes("..")) throw notFound(`no asset "${relative}"`);

    let install =
      scope.installId !== undefined && scope.installId !== null && scope.installId !== ""
        ? this.installations.get(scope.installId)
        : scope.target !== undefined && scope.target !== null
          ? this.installations.activeFor(scope.target)
          : null;

    // An installation of another engine than the one asked for says nothing about it: its images are not served as its own.
    if (install !== null && scope.target !== undefined && scope.target !== null && install.target !== scope.target) install = null;

    const roots: Array<{ root: string; source: ResolvedAsset["source"] }> = [];
    if (install !== null) roots.push({ root: this.libraries.cacheAssetsDir(install.id), source: "install" });
    if (this.ctx.bundledAssetsDir !== null) roots.push({ root: this.ctx.bundledAssetsDir, source: "bundled" });

    for (const { root, source } of roots) {
      const file = this.within(root, clean);
      if (file !== null && existsSync(file) && statSync(file).isFile()) {
        return {
          bytes: readFileSync(file),
          contentType: CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
          source,
        };
      }
    }
    throw notFound(`no asset "${relative}"`);
  }
}
