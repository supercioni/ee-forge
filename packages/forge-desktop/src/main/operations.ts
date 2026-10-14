import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ForgeServiceError } from "@forge/app";
import type {
  DesktopAddInstallationResult,
  DesktopExportFolderResult,
  DesktopExportRequest,
  DesktopExportResult,
  DesktopExtensionResult,
  DesktopImportResult,
  DesktopInfo,
  DesktopProjectsDirResult,
} from "@forge/contracts";
import type { Runtime } from "./runtime.js";

/** The operating system's pickers. `null` means the user dismissed the dialog. */
export interface Dialogs {
  pickFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
  pickFile(options: { title: string; defaultPath?: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
}

const message = (error: unknown): string => (error instanceof ForgeServiceError || error instanceof Error ? error.message : String(error));
const dirOf = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/**
 * Everything the editor can ask of the shell beyond Forge's own services. Each operation opens a native
 * dialog here, in the main process, and acts on the answer: the editor never supplies or receives a path
 * it could use. A dismissed dialog is `canceled`, never an error and never a half-done change.
 */
export class DesktopOperations {
  /** Folders that were chosen but not recognised, awaiting the author's declared version. */
  private readonly pending = new Map<string, string>();
  /** Export folders chosen ahead of the export, by token; a token is used once. */
  private readonly destinations = new Map<string, string>();

  constructor(
    private readonly runtime: Runtime,
    private readonly dialogs: Dialogs,
    private readonly reveal: (path: string) => void = () => undefined,
  ) {}

  info(): DesktopInfo {
    return this.runtime.info();
  }

  isInstallId(value: string): boolean {
    return this.runtime.services.installations.get(value) !== null;
  }

  async chooseProjectsFolder(): Promise<DesktopProjectsDirResult> {
    const picked = await this.dialogs.pickFolder({ title: "Choose the folder for your projects", defaultPath: this.runtime.projectsDir });
    if (picked === null) return { status: "canceled" };
    try {
      if (!dirOf(picked)) return { status: "error", message: `${picked} is not a folder` };
      mkdirSync(picked, { recursive: true });
      this.runtime.update({ projectsDir: picked });
      await this.runtime.start();
      return { status: "ok", info: this.runtime.info() };
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  }

  async addInstallation(): Promise<DesktopAddInstallationResult> {
    const picked = await this.dialogs.pickFolder({ title: "Choose the EmptyEpsilon folder (the one holding EmptyEpsilon.exe and scripts)" });
    if (picked === null) return { status: "canceled" };
    return this.register(picked, undefined);
  }

  async declareInstallation(token: string, eeVersion: string): Promise<DesktopAddInstallationResult> {
    const path = this.pending.get(token);
    if (path === undefined) return { status: "error", message: "that folder is no longer pending — choose it again" };
    const result = await this.register(path, eeVersion);
    if (result.status !== "unrecognised") this.pending.delete(token);
    return result;
  }

  private async register(path: string, eeVersion: string | undefined): Promise<DesktopAddInstallationResult> {
    try {
      const installation = this.runtime.services.installations.register({ path, ...(eeVersion !== undefined ? { eeVersion } : {}) });
      return { status: "added", installation };
    } catch (error) {
      // An unrecognised build is not a failure of the picker: offer to declare its version instead.
      if (error instanceof ForgeServiceError && error.status === 422 && eeVersion === undefined && /not a recognised/.test(error.message)) {
        const token = randomBytes(12).toString("hex");
        this.pending.set(token, path);
        return { status: "unrecognised", token, message: error.message };
      }
      return { status: "error", message: message(error) };
    }
  }

  async importProject(kind: "folder" | "file"): Promise<DesktopImportResult> {
    const picked =
      kind === "folder"
        ? await this.dialogs.pickFolder({ title: "Choose the project folder to import (it holds project.json)" })
        : await this.dialogs.pickFile({ title: "Choose a project.json to import", filters: [{ name: "Forge project", extensions: ["json"] }] });
    if (picked === null) return { status: "canceled" };
    try {
      return { status: "imported", result: this.runtime.services.projects.importCopy(picked) };
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  }

  /** Choose where an export will go, before it starts, so the editor can show it. The shell keeps the path. */
  async chooseExportFolder(): Promise<DesktopExportFolderResult> {
    const picked = await this.dialogs.pickFolder({
      title: "Choose where to put the export (a folder per engine is created inside)",
      defaultPath: this.runtime.settings.lastExportDir ?? join(this.runtime.paths.documents, "EE FORGE", "Exports"),
    });
    if (picked === null) return { status: "canceled" };
    if (!dirOf(picked)) return { status: "error", message: `${picked} is not a folder` };
    const token = randomBytes(12).toString("hex");
    this.destinations.clear(); // one pending destination: the last choice is the one that counts
    this.destinations.set(token, picked);
    return { status: "chosen", token, path: picked };
  }

  async exportProject(request: DesktopExportRequest): Promise<DesktopExportResult> {
    let picked: string | null;
    if (request.destinationToken !== undefined) {
      picked = this.destinations.get(request.destinationToken) ?? null;
      if (picked === null) return { status: "error", message: "that destination is no longer pending — choose the folder again" };
      this.destinations.delete(request.destinationToken);
    } else {
      picked = await this.dialogs.pickFolder({
        title: "Choose where to put the export (a folder per engine is created inside)",
        defaultPath: this.runtime.settings.lastExportDir ?? join(this.runtime.paths.documents, "EE FORGE", "Exports"),
      });
    }
    if (picked === null) return { status: "canceled" };
    try {
      const result = this.runtime.services.projects.exportBundle(request.projectId, {
        targets: request.targets,
        mode: request.mode,
        outRoot: picked,
        ...(request.libraryInstalls !== undefined ? { libraryInstalls: request.libraryInstalls } : {}),
      });
      this.runtime.update({ lastExportDir: result.outRoot });
      return { status: "exported", result };
    } catch (error) {
      return { status: "error", message: message(error) };
    }
  }

  revealLastExport(): boolean {
    const dir = this.runtime.settings.lastExportDir;
    if (dir === null || !existsSync(dir)) return false;
    this.reveal(dir);
    return true;
  }

  async chooseExtension(): Promise<DesktopExtensionResult> {
    const picked = await this.dialogs.pickFile({
      title: "Choose an EXODUS extension module (optional)",
      filters: [{ name: "JavaScript module", extensions: ["mjs", "js"] }],
    });
    if (picked === null) return { status: "canceled" };
    this.runtime.update({ extension: { path: picked, enabled: true } });
    await this.runtime.start();
    return this.extensionResult();
  }

  async setExtensionEnabled(enabled: boolean): Promise<DesktopExtensionResult> {
    this.runtime.update({ extension: { ...this.runtime.settings.extension, enabled } });
    await this.runtime.start();
    return this.extensionResult();
  }

  async forgetExtension(): Promise<DesktopExtensionResult> {
    this.runtime.update({ extension: { path: null, enabled: false } });
    await this.runtime.start();
    return this.extensionResult();
  }

  private extensionResult(): DesktopExtensionResult {
    const info = this.runtime.info();
    // Enabling something that could not be loaded is reported, with the reason, rather than looking like success.
    return info.extension.enabled && !info.extension.loaded
      ? { status: "error", message: info.extension.error ?? "the extension could not be loaded" }
      : { status: "ok", info };
  }
}
