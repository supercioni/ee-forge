import { z } from "zod";
import {
  ForgeBuildModeSchema,
  ForgeExportResultSchema,
  ForgeImportResultSchema,
  ForgeInstallationSchema,
} from "./forge-api.js";

/**
 * What the desktop shell offers the editor besides the Forge services (increment 5, ADR-0051).
 *
 * The editor never holds a file path it did not receive from the shell, and never sends one back:
 * every operation that needs a file or folder opens the operating system's own dialog in the main
 * process and acts on the answer there. What crosses the preload boundary is only what is below.
 */

export const DesktopExtensionStateSchema = z.object({
  /** A module the shell could register was found or chosen. */
  available: z.boolean(),
  /** The user opted in. Off by default: Forge exports vanilla scenarios without it. */
  enabled: z.boolean(),
  loaded: z.boolean(),
  id: z.string().nullable(),
  label: z.string().nullable(),
  source: z.enum(["none", "bundled", "user"]),
  /** Why it could not be loaded, when it could not. */
  error: z.string().nullable(),
});
export type DesktopExtensionState = z.infer<typeof DesktopExtensionStateSchema>;

export const DesktopInfoSchema = z.object({
  app: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  electron: z.string(),
  /** Where projects live. Chosen by the user; the default is under the user's Documents folder. */
  projectsDir: z.string(),
  /** Forge's own state: installation registry, libraries, image caches, DMX rig. */
  stateDir: z.string(),
  /** Settings file location. */
  settingsPath: z.string(),
  extension: DesktopExtensionStateSchema,
  /** Where the last export went, for "show in folder". */
  lastExportDir: z.string().nullable(),
});
export type DesktopInfo = z.infer<typeof DesktopInfoSchema>;

/** A dialog the user dismissed is an answer, not an error. */
export const DesktopCanceledSchema = z.object({ status: z.literal("canceled") });
export const DesktopErrorSchema = z.object({ status: z.literal("error"), message: z.string() });

export const DesktopProjectsDirResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), info: DesktopInfoSchema }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);

export const DesktopAddInstallationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("added"), installation: ForgeInstallationSchema }),
  /**
   * The folder is not a build Forge can identify. `token` stands for that folder in the shell, so the
   * author can declare its version (`declareInstallation`) without the editor ever handling the path.
   */
  z.object({ status: z.literal("unrecognised"), token: z.string(), message: z.string() }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);

export const DesktopImportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("imported"), result: ForgeImportResultSchema }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);

export const DesktopExportRequestSchema = z.object({
  projectId: z.string().min(1).max(200),
  /** One or both engines; two targets give two separate bundles. */
  targets: z.array(z.string().min(1).max(100)).min(1).max(2),
  mode: ForgeBuildModeSchema,
  /**
   * A destination the author already chose (`chooseExportFolder`). The shell keeps the path; the editor holds
   * only this token. Without one the shell asks for a folder when the export starts.
   */
  destinationToken: z.string().min(8).max(100).optional(),
  /**
   * Which registered installation's scan each engine's references are checked against, by engine. An engine
   * that is not named uses the newest scan of that engine. Ids only — never paths.
   */
  libraryInstalls: z.record(z.string().min(1).max(100), z.string().min(1).max(100)).optional(),
});
export type DesktopExportRequest = z.infer<typeof DesktopExportRequestSchema>;

export const DesktopExportFolderResultSchema = z.discriminatedUnion("status", [
  /** `path` is for showing to the author; only `token` can be used to export there. */
  z.object({ status: z.literal("chosen"), token: z.string(), path: z.string() }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);
export type DesktopExportFolderResult = z.infer<typeof DesktopExportFolderResultSchema>;

export const DesktopExportResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("exported"), result: ForgeExportResultSchema }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);

export const DesktopExtensionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), info: DesktopInfoSchema }),
  DesktopCanceledSchema,
  DesktopErrorSchema,
]);

export type DesktopProjectsDirResult = z.infer<typeof DesktopProjectsDirResultSchema>;
export type DesktopAddInstallationResult = z.infer<typeof DesktopAddInstallationResultSchema>;
export type DesktopImportResult = z.infer<typeof DesktopImportResultSchema>;
export type DesktopExportResult = z.infer<typeof DesktopExportResultSchema>;
export type DesktopExtensionResult = z.infer<typeof DesktopExtensionResultSchema>;

/** What a close request from the shell asks of the editor, and what the editor answers. */
export type DesktopCloseDecision = "close" | "cancel";

/**
 * The object the preload exposes as `window.forgeDesktop`. Every method is a fixed, validated IPC
 * call; none takes a path, a channel name or a script.
 */
export interface ForgeDesktopApi {
  info(): Promise<DesktopInfo>;
  chooseProjectsFolder(): Promise<DesktopProjectsDirResult>;
  addInstallation(): Promise<DesktopAddInstallationResult>;
  declareInstallation(token: string, eeVersion: string): Promise<DesktopAddInstallationResult>;
  importProject(kind: "folder" | "file"): Promise<DesktopImportResult>;
  /** Ask for the folder an export will go to, so it can be shown before anything is written. */
  chooseExportFolder(): Promise<DesktopExportFolderResult>;
  exportProject(request: DesktopExportRequest): Promise<DesktopExportResult>;
  revealLastExport(): Promise<boolean>;
  chooseExtension(): Promise<DesktopExtensionResult>;
  setExtensionEnabled(enabled: boolean): Promise<DesktopExtensionResult>;
  forgetExtension(): Promise<DesktopExtensionResult>;
  /** Tell the shell whether the open project has unsaved changes, so closing the window can ask first. */
  reportDirty(dirty: boolean): void;
  /** Register the editor's answer to "the window wants to close"; returns an unsubscribe. */
  onCloseRequested(handler: () => void): () => void;
  /** Answer a close request: `close` lets the window go, `cancel` keeps it. */
  answerClose(decision: DesktopCloseDecision): void;
}
