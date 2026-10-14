import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createForgeRouter, createForgeServices, type ForgeLogger, type ForgeRouter, type ForgeServices } from "@forge/app";
import type { DesktopExtensionState, DesktopInfo } from "@forge/contracts";
import type { ForgeExtension } from "@forge/core";
import { loadSettings, saveSettings, type Settings } from "./settings.js";

/** Where things are. All of it is derived from the user's folders and the application's own resources. */
export interface RuntimePaths {
  /** Per-user application data (settings, state, logs). */
  readonly userData: string;
  /** The user's Documents folder; projects default to `<documents>/EE FORGE/Projects`. */
  readonly documents: string;
  /** Read-only resources shipped with the app: `assets/` and, optionally, `optional/exodus-extension.mjs`. */
  readonly resources: string;
  readonly version: string;
  readonly electronVersion: string;
}

export const BUNDLED_EXTENSION = "optional/exodus-extension.mjs";

/** The only things a module must export to be accepted as an extension. */
function isForgeExtension(value: unknown): value is ForgeExtension {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["label"] === "string" &&
    typeof v["protocol"] === "string" &&
    Array.isArray(v["capabilities"]) &&
    typeof v["owns"] === "function" &&
    typeof v["emitAction"] === "function"
  );
}

export async function loadExtensionModule(file: string): Promise<ForgeExtension> {
  const loaded = (await import(pathToFileURL(file).href)) as { forgeExtension?: unknown };
  if (!isForgeExtension(loaded.forgeExtension)) {
    throw new Error(`${file} does not export a Forge extension (forgeExtension)`);
  }
  return loaded.forgeExtension;
}

/**
 * The Forge services for this user, built from the settings. Rebuilt (not patched) when the projects
 * folder or the extension changes, so a service never holds a stale path.
 */
export class Runtime {
  settings: Settings;
  services!: ForgeServices;
  router!: ForgeRouter;
  private extensionError: string | null = null;
  private loadedExtension: ForgeExtension | null = null;

  constructor(readonly paths: RuntimePaths, private readonly log: (line: string) => void = () => undefined) {
    this.settingsPath = join(paths.userData, "settings.json");
    this.settings = loadSettings(this.settingsPath, (m) => this.log(`warn ${m}`));
  }

  readonly settingsPath: string;

  get projectsDir(): string {
    return this.settings.projectsDir ?? join(this.paths.documents, "EE FORGE", "Projects");
  }
  get stateDir(): string {
    return join(this.paths.userData, "state");
  }
  get bundledExtensionPath(): string | null {
    const file = join(this.paths.resources, BUNDLED_EXTENSION);
    return existsSync(file) ? file : null;
  }
  /** The module that would be registered if the user opts in: their pick, else the bundled one. */
  get extensionPath(): { path: string; source: "user" | "bundled" } | null {
    if (this.settings.extension.path !== null) return { path: this.settings.extension.path, source: "user" };
    const bundled = this.bundledExtensionPath;
    return bundled === null ? null : { path: bundled, source: "bundled" };
  }

  private logger(): ForgeLogger {
    const line = (level: string, fields: Record<string, unknown> | string, message?: string): void =>
      this.log(`${level} ${typeof fields === "string" ? fields : `${message ?? ""} ${JSON.stringify(fields)}`}`);
    return { info: (f, m) => line("info", f, m), warn: (f, m) => line("warn", f, m), debug: () => undefined };
  }

  /** (Re)create the services. Never throws for a bad extension: that is reported in {@link extensionState}. */
  async start(): Promise<void> {
    mkdirSync(this.projectsDir, { recursive: true });
    mkdirSync(this.stateDir, { recursive: true });
    this.loadedExtension = null;
    this.extensionError = null;
    const candidate = this.extensionPath;
    if (this.settings.extension.enabled && candidate !== null) {
      try {
        this.loadedExtension = await loadExtensionModule(candidate.path);
      } catch (error) {
        this.extensionError = error instanceof Error ? error.message : String(error);
        this.log(`warn extension not loaded: ${this.extensionError}`);
      }
    } else if (this.settings.extension.enabled) {
      this.extensionError = "the extension is enabled but no module is available";
    }
    const bundledAssets = join(this.paths.resources, "assets");
    this.services = createForgeServices({
      projectsDir: this.projectsDir,
      stateDir: this.stateDir,
      bundledAssetsDir: existsSync(bundledAssets) ? bundledAssets : null,
      extensions: this.loadedExtension === null ? [] : [this.loadedExtension],
      logger: this.logger(),
    });
    this.router = createForgeRouter(this.services);
  }

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settingsPath, this.settings);
  }

  extensionState(): DesktopExtensionState {
    const candidate = this.extensionPath;
    return {
      available: candidate !== null,
      enabled: this.settings.extension.enabled,
      loaded: this.loadedExtension !== null,
      id: this.loadedExtension?.id ?? null,
      label: this.loadedExtension?.label ?? null,
      source: candidate === null ? "none" : candidate.source,
      error: this.extensionError,
    };
  }

  info(): DesktopInfo {
    return {
      app: "EE FORGE",
      version: this.paths.version,
      platform: process.platform,
      arch: process.arch,
      electron: this.paths.electronVersion,
      projectsDir: this.projectsDir,
      stateDir: this.stateDir,
      settingsPath: this.settingsPath,
      extension: this.extensionState(),
      lastExportDir: this.settings.lastExportDir,
    };
  }
}

/** A file logger under the user's data directory; failures to log never break the app. */
export function fileLogger(userData: string): (line: string) => void {
  const dir = join(userData, "logs");
  return (line) => {
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "forge.log"), `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* logging is best effort */
    }
  };
}
