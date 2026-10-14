import type { ForgeExtension } from "@forge/core";
import { AssetService } from "./assets.js";
import { createContext, type ForgeContext, type ForgeOptions } from "./context.js";
import { DmxService, type DmxTelemetrySource } from "./dmx.js";
import { InstallationService } from "./installations.js";
import { LibraryService } from "./libraries.js";
import { ProjectService } from "./projects.js";

export interface ForgeServices {
  readonly context: ForgeContext;
  readonly projects: ProjectService;
  readonly installations: InstallationService;
  readonly libraries: LibraryService;
  readonly assets: AssetService;
  readonly dmx: DmxService;
  readonly extensions: readonly ForgeExtension[];
}

export interface ForgeServiceOptions extends ForgeOptions {
  /** Optional live-telemetry adapters (the EXODUS bridge supplies one for its engine). */
  readonly dmxTelemetry?: readonly DmxTelemetrySource[];
  /**
   * Extensions available to integrated builds. None by default: a Forge
   * started without any builds only vanilla scenarios, and says so when
   * asked to do more.
   */
  readonly extensions?: readonly ForgeExtension[];
}

/** Compose the services. Pure wiring: no network, no timers, no processes. */
export function createForgeServices(options: ForgeServiceOptions): ForgeServices {
  const context = createContext(options);
  const installations = new InstallationService(context);
  const libraries = new LibraryService(context, installations);
  return {
    context,
    installations,
    libraries,
    extensions: options.extensions ?? [],
    projects: new ProjectService(context, installations, libraries, options.extensions ?? []),
    assets: new AssetService(context, installations, libraries),
    dmx: new DmxService(context, installations, options.dmxTelemetry ?? []),
  };
}
