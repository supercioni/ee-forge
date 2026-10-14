import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";
import {
  DesktopAddInstallationResultSchema,
  DesktopExportFolderResultSchema,
  DesktopExportResultSchema,
  DesktopExtensionResultSchema,
  DesktopImportResultSchema,
  DesktopInfoSchema,
  DesktopProjectsDirResultSchema,
  type DesktopCloseDecision,
  type ForgeDesktopApi,
} from "@forge/contracts";
import { APP_ORIGIN, CHANNEL, CloseDecisionSchema, DeclareInstallationArgsSchema, DirtyArgSchema, EnabledArgSchema, ExportArgsSchema, ImportKindSchema } from "../shared/ipc.js";

/**
 * The only door between the editor and the shell. It exposes two things to the page and nothing
 * else: a Forge transport (the editor's existing `ForgeTransport`) and `forgeDesktop`, a fixed set of
 * functions. No channel name, no `ipcRenderer`, no Node. Arguments are checked here and again in the
 * main process; results are checked before the page sees them.
 */

const ResponseSchema = z.object({ status: z.number().int(), body: z.unknown() }).transform((r) => ({ status: r.status, body: r.body as unknown }));

const invoke = async <T extends z.ZodTypeAny>(channel: string, schema: T, arg?: unknown): Promise<z.infer<T>> =>
  schema.parse(await ipcRenderer.invoke(channel, arg));

const transport = {
  label: "EE FORGE desktop",
  async send(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const url = new URL(path, "http://forge.local");
    // Images, models and the asset manifest are read through the app protocol, not this channel.
    if (method === "GET" && url.pathname.startsWith("/forge/assets/")) {
      const response = await fetch(`${APP_ORIGIN}${url.pathname}${url.search}`);
      return { status: response.status, body: await response.json().catch(() => null) };
    }
    return invoke(CHANNEL.request, ResponseSchema, {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ...(body !== undefined ? { body } : {}),
    });
  },
  assetUrl(path: string, target: string | null, install: string | null = null): string {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const query = [target === null ? "" : `target=${encodeURIComponent(target)}`, install === null ? "" : `install=${encodeURIComponent(install)}`].filter((q) => q !== "");
    return `${APP_ORIGIN}/forge/assets/${encoded}${query.length === 0 ? "" : `?${query.join("&")}`}`;
  },
};

const api: ForgeDesktopApi = {
  info: () => invoke(CHANNEL.info, DesktopInfoSchema),
  chooseProjectsFolder: () => invoke(CHANNEL.chooseProjectsFolder, DesktopProjectsDirResultSchema),
  addInstallation: () => invoke(CHANNEL.addInstallation, DesktopAddInstallationResultSchema),
  declareInstallation: (token, eeVersion) =>
    invoke(CHANNEL.declareInstallation, DesktopAddInstallationResultSchema, DeclareInstallationArgsSchema.parse({ token, eeVersion })),
  importProject: (kind) => invoke(CHANNEL.importProject, DesktopImportResultSchema, ImportKindSchema.parse(kind)),
  chooseExportFolder: () => invoke(CHANNEL.chooseExportFolder, DesktopExportFolderResultSchema),
  exportProject: (request) => invoke(CHANNEL.exportProject, DesktopExportResultSchema, ExportArgsSchema.parse(request)),
  revealLastExport: () => invoke(CHANNEL.revealLastExport, z.boolean()),
  chooseExtension: () => invoke(CHANNEL.chooseExtension, DesktopExtensionResultSchema),
  setExtensionEnabled: (enabled) => invoke(CHANNEL.setExtensionEnabled, DesktopExtensionResultSchema, EnabledArgSchema.parse(enabled)),
  forgetExtension: () => invoke(CHANNEL.forgetExtension, DesktopExtensionResultSchema),
  reportDirty: (dirty) => ipcRenderer.send(CHANNEL.dirty, DirtyArgSchema.parse(dirty)),
  onCloseRequested: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on(CHANNEL.closeRequested, listener);
    return () => {
      ipcRenderer.removeListener(CHANNEL.closeRequested, listener);
    };
  },
  answerClose: (decision: DesktopCloseDecision) => ipcRenderer.send(CHANNEL.closeDecision, CloseDecisionSchema.parse(decision)),
};

contextBridge.exposeInMainWorld("__FORGE_TRANSPORT__", transport);
contextBridge.exposeInMainWorld("forgeDesktop", api);
