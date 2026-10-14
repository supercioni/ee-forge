import { z } from "zod";
import { DesktopExportRequestSchema } from "@forge/contracts";

/**
 * The whole IPC surface between the editor (renderer) and the shell (main), in one place.
 *
 * Channels are fixed strings; the preload exposes one function per channel and nothing else. There is
 * no generic `invoke(channel, …)`, no `send(channel, …)`, and no channel that takes a file path, a
 * command line or a script.
 */
export const CHANNEL = {
  /** renderer → main, invoke: a Forge service request (validated by the guard). */
  request: "forge:request",
  info: "desktop:info",
  chooseProjectsFolder: "desktop:choose-projects-folder",
  addInstallation: "desktop:add-installation",
  declareInstallation: "desktop:declare-installation",
  importProject: "desktop:import-project",
  chooseExportFolder: "desktop:choose-export-folder",
  exportProject: "desktop:export-project",
  revealLastExport: "desktop:reveal-last-export",
  chooseExtension: "desktop:choose-extension",
  setExtensionEnabled: "desktop:set-extension-enabled",
  forgetExtension: "desktop:forget-extension",
  /** renderer → main, send: the open project's unsaved state. */
  dirty: "desktop:dirty",
  /** renderer → main, send: the answer to a close request. */
  closeDecision: "desktop:close-decision",
  /** main → renderer: the user asked to close the window. */
  closeRequested: "desktop:close-requested",
} as const;

export const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

/** Shape of a Forge service request as it leaves the renderer. Further rules live in the guard. */
export const RawForgeRequestSchema = z
  .object({
    method: z.enum(METHODS),
    path: z.string().min(1).max(512),
    query: z.record(z.string().max(2048)).optional(),
    body: z.unknown().optional(),
  })
  .strict();
export type RawForgeRequest = z.infer<typeof RawForgeRequestSchema>;

export const DeclareInstallationArgsSchema = z.object({ token: z.string().min(8).max(100), eeVersion: z.string().min(1).max(100) }).strict();
export const ImportKindSchema = z.enum(["folder", "file"]);
export const ExportArgsSchema = DesktopExportRequestSchema.strict();
export const EnabledArgSchema = z.boolean();
export const DirtyArgSchema = z.boolean();
export const CloseDecisionSchema = z.enum(["close", "cancel"]);

/** The scheme the editor is served from, and the only origin the shell's IPC answers. */
export const APP_SCHEME = "forge-app";
export const APP_ORIGIN = `${APP_SCHEME}://app`;
