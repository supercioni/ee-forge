import { join, resolve } from "node:path";

/** Logging port. The host decides where lines go; the services never import a logger. */
export interface ForgeLogger {
  info(fields: Record<string, unknown> | string, message?: string): void;
  warn(fields: Record<string, unknown> | string, message?: string): void;
  debug(fields: Record<string, unknown> | string, message?: string): void;
}

export const silentLogger: ForgeLogger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
};

export interface ForgeOptions {
  /**
   * Where projects live: `<projectsDir>/<id>/project.json`. Chosen by the
   * user; never inside the installed application.
   */
  readonly projectsDir: string;
  /**
   * Where Forge keeps its own state (installation registry, per-install
   * libraries and asset caches, the DMX rig). Defaults to `projectsDir`,
   * which is the layout the bridge has always used.
   */
  readonly stateDir?: string;
  /**
   * Read-only assets shipped with Forge (3D models, the manifest, stock
   * radar sprites). Never written to: scanning an install fills that
   * install's own cache instead.
   */
  readonly bundledAssetsDir?: string | null;
  readonly logger?: ForgeLogger;
}

/** Resolved, absolute locations derived from {@link ForgeOptions}. */
export interface ForgeContext {
  readonly projectsDir: string;
  readonly stateDir: string;
  readonly bundledAssetsDir: string | null;
  readonly logger: ForgeLogger;
  /** `installations.json` */
  readonly registryPath: string;
  readonly librariesDir: string;
  readonly cacheDir: string;
  readonly dmxRigPath: string;
}

export function createContext(options: ForgeOptions): ForgeContext {
  const projectsDir = resolve(options.projectsDir);
  const stateDir = resolve(options.stateDir ?? options.projectsDir);
  return {
    projectsDir,
    stateDir,
    bundledAssetsDir: options.bundledAssetsDir === undefined || options.bundledAssetsDir === null ? null : resolve(options.bundledAssetsDir),
    logger: options.logger ?? silentLogger,
    registryPath: join(stateDir, "installations.json"),
    librariesDir: join(stateDir, "libraries"),
    cacheDir: join(stateDir, "cache"),
    dmxRigPath: join(stateDir, "dmx-rig.json"),
  };
}
