import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Mirror the install's drawable resources into the repo's `assets/`.
 *
 * The editor draws a planet with EE's own texture, served from
 * `assets/planets/` through the bridge's `/assets/` mount — the browser
 * cannot reach the install directly. Indexing the install therefore only
 * does half the job: `ee-library.json` learns the new file's *name*, the
 * inspector offers it, and the canvas then asks for an image nobody
 * copied. What an author sees is a broken thumbnail inside the planet.
 *
 * So indexing and mirroring go together, and both the CLI and the
 * editor's Rescan call this.
 *
 * **Never deletes.** A texture dropped from a newer install would
 * otherwise take out a project that still refers to it, and the viewer
 * ships expecting the stock set to be present.
 */

/** What the canvas can actually draw. */
const IMAGE_EXT = [".png", ".jpg", ".jpeg"];

/**
 * The subdirectories worth mirroring: the ones something renders from.
 *
 * `meshes` are deliberately absent — the 3D viewer has its own pipeline
 * and its own manifest (ADR-0020), and a blind copy of every `.obj` would
 * fight it.
 */
const MIRRORED = ["planets", "radar"];

export interface MirrorResult {
  /** Repo-relative paths written, e.g. `planets/ice-planet.png`. */
  readonly copied: readonly string[];
  readonly warnings: readonly string[];
}

export function mirrorInstallAssets(eeInstall: string, assetsDir: string): MirrorResult {
  const copied: string[] = [];
  const warnings: string[] = [];

  for (const dir of MIRRORED) {
    const from = join(eeInstall, "resources", dir);
    if (!existsSync(from)) continue;
    const to = join(assetsDir, dir);

    let entries: string[];
    try {
      entries = readdirSync(from);
    } catch (error) {
      warnings.push(`resources/${dir}: unreadable (${String(error)})`);
      continue;
    }

    for (const name of entries) {
      const lower = name.toLowerCase();
      if (!IMAGE_EXT.some((ext) => lower.endsWith(ext))) continue;
      try {
        const source = readFileSync(join(from, name));
        const target = join(to, name);
        // Read before writing: an unchanged file should leave no trace in
        // `git status`, so a rescan reports what actually moved.
        if (existsSync(target) && readFileSync(target).equals(source)) continue;
        mkdirSync(to, { recursive: true });
        writeFileSync(target, source);
        copied.push(`${dir}/${name}`);
      } catch (error) {
        warnings.push(`resources/${dir}/${name}: could not copy (${String(error)})`);
      }
    }
  }


  // The nebula billboards sit directly in `resources/` (Nebula1.png …), and the map draws them from `nebula/`.
  const rootFrom = join(eeInstall, "resources");
  if (existsSync(rootFrom)) {
    for (const name of readdirSync(rootFrom)) {
      if (!/^nebula\d*\.png$/i.test(name)) continue;
      try {
        const source = readFileSync(join(rootFrom, name));
        const to = join(assetsDir, "nebula");
        const target = join(to, name);
        if (existsSync(target) && readFileSync(target).equals(source)) continue;
        mkdirSync(to, { recursive: true });
        writeFileSync(target, source);
        copied.push(`nebula/${name}`);
      } catch (error) {
        warnings.push(`resources/${name}: could not copy (${String(error)})`);
      }
    }
  }
  return { copied, warnings };
}
