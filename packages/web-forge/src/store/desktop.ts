import { create } from "zustand";
import { bumpAssetEpoch } from "../api/transport.js";
import { resetIconAvailability } from "../canvas/icon-availability.js";
import type {
  DesktopAddInstallationResult,
  DesktopInfo,
  ForgeBuildMode,
  ForgeCompatibility,
  ForgeExportResult,
  ForgeInstallation,
} from "@forge/contracts";
import { fetchCompatibility, fetchInstallations, fetchProjects, rescanInstallation, removeInstallation } from "../api/client.js";
import { getDesktop } from "../api/desktop.js";
import { useEditor } from "./editor.js";

/**
 * Desktop-only state: the shell's information, the registered installations, the open dialog, and
 * the "unsaved changes" question. In a browser none of it is used (`getDesktop()` is null) and the
 * editor behaves as before.
 *
 * Nothing here holds a file path the shell did not hand over for display: the editor refers to an
 * installation by id and asks the shell to open every file or folder dialog.
 */

export type DesktopDialog = "installations" | "export" | "settings" | null;

export type UnsavedChoice = "save" | "discard" | "cancel";

export interface PendingInstall {
  readonly token: string;
  readonly message: string;
}

interface DesktopState {
  info: DesktopInfo | null;
  installations: readonly ForgeInstallation[];
  compatibility: ForgeCompatibility | null;
  dialog: DesktopDialog;
  /** The pending "you have unsaved changes" question; resolves with the author's choice. */
  unsaved: { resolve: (choice: UnsavedChoice) => void; reason: string } | null;
  pendingInstall: PendingInstall | null;
  lastExport: ForgeExportResult | null;
  /** What the last export was made from: revision, content mode and when — so it can say if it is out of date. */
  lastExportMeta: { readonly projectId: string; readonly projectName: string; readonly revision: number; readonly mode: ForgeBuildMode; readonly at: string } | null;
  /** The folder chosen for the next export (the shell keeps the path; this is its token and a name to show). */
  exportDestination: { readonly token: string; readonly path: string } | null;
  busy: boolean;
  message: string | null;

  init: () => Promise<void>;
  openDialog: (dialog: DesktopDialog) => void;
  closeDialog: () => void;
  refreshInstallations: () => Promise<void>;
  /** Ask whether to keep unsaved work before doing `reason`; true = go ahead (saved or discarded). */
  confirmUnsaved: (reason: string) => Promise<boolean>;
  answerUnsaved: (choice: UnsavedChoice) => void;
  addInstallation: () => Promise<void>;
  declareInstallation: (eeVersion: string) => Promise<void>;
  rescan: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  selectInstallation: (id: string) => void;
  chooseProjectsFolder: () => Promise<void>;
  importProject: (kind: "folder" | "file") => Promise<void>;
  chooseExportFolder: () => Promise<void>;
  exportProject: (targets: readonly string[], mode: ForgeBuildMode) => Promise<void>;
  revealExport: () => Promise<void>;
  chooseExtension: () => Promise<void>;
  setExtensionEnabled: (enabled: boolean) => Promise<void>;
  forgetExtension: () => Promise<void>;
}

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const useDesktop = create<DesktopState>((set, get) => {
  const say = (message: string): void => {
    set({ message });
    useEditor.setState({ status: message, error: null });
  };
  const fail = (message: string): void => {
    set({ message });
    useEditor.setState({ error: message });
  };

  const handleInstall = async (result: DesktopAddInstallationResult): Promise<void> => {
    switch (result.status) {
      case "added":
        set({ pendingInstall: null });
        await get().refreshInstallations();
        get().selectInstallation(result.installation.id);
        say(`Registered ${result.installation.label} (${result.installation.target}${result.installation.verified ? ", verified" : ", version declared — not verified"}). Scanning it for images and templates…`);
        // The app carries no stock images: they come from this folder, so a registration that stopped here would leave
        // the map without textures until the author thought of pressing Rescan.
        await get().rescan(result.installation.id);
        return;
      case "unrecognised":
        set({ pendingInstall: { token: result.token, message: result.message } });
        say("That folder is not a build Forge recognises — declare its version below, or cancel.");
        return;
      case "canceled":
        say("No folder chosen — nothing changed.");
        return;
      case "error":
        fail(result.message);
        return;
    }
  };

  return {
    info: null,
    installations: [],
    compatibility: null,
    dialog: null,
    unsaved: null,
    pendingInstall: null,
    lastExport: null,
    lastExportMeta: null,
    exportDestination: null,
    busy: false,
    message: null,

    init: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      try {
        const [info, installations, compatibility] = await Promise.all([desktop.info(), fetchInstallations(), fetchCompatibility()]);
        set({ info, installations, compatibility });
        // The remembered install must still exist; otherwise pick a registered one for the project's engine.
        const { eeDir, setEeDir, project } = useEditor.getState();
        if (!installations.some((i) => i.id === eeDir)) {
          const fit = installations.find((i) => i.target === project?.eeVersion) ?? installations[0];
          setEeDir(fit?.id ?? "");
        }
        // A registered installation that was never scanned has no images to show: scan it now.
        const chosen = installations.find((i) => i.id === useEditor.getState().eeDir);
        if (chosen !== undefined && chosen.scannedAt === null) void get().rescan(chosen.id);
      } catch (error) {
        fail(text(error));
      }
    },

    openDialog: (dialog) => set({ dialog, pendingInstall: null, lastExport: null, exportDestination: null, message: null }),
    closeDialog: () => set({ dialog: null, pendingInstall: null }),

    refreshInstallations: async () => {
      try {
        set({ installations: await fetchInstallations() });
      } catch (error) {
        fail(text(error));
      }
    },

    confirmUnsaved: async (reason) => {
      if (!useEditor.getState().dirty) return true;
      const choice = await new Promise<UnsavedChoice>((resolve) => set({ unsaved: { resolve, reason } }));
      set({ unsaved: null });
      if (choice === "cancel") return false;
      if (choice === "save") {
        await useEditor.getState().save();
        // A failed save leaves the project dirty: do not proceed and lose it.
        return !useEditor.getState().dirty;
      }
      return true;
    },
    answerUnsaved: (choice) => get().unsaved?.resolve(choice),

    addInstallation: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      set({ busy: true });
      try {
        await handleInstall(await desktop.addInstallation());
      } catch (error) {
        fail(text(error));
      } finally {
        set({ busy: false });
      }
    },

    declareInstallation: async (eeVersion) => {
      const desktop = getDesktop();
      const pending = get().pendingInstall;
      if (desktop === null || pending === null) return;
      try {
        await handleInstall(await desktop.declareInstallation(pending.token, eeVersion));
      } catch (error) {
        fail(text(error));
      }
    },

    rescan: async (id) => {
      set({ busy: true });
      try {
        const result = await rescanInstallation(id);
        bumpAssetEpoch();
        resetIconAvailability();
        await get().refreshInstallations();
        // The project's own engine may be the one just indexed: reload its lists.
        const { project, openProject, dirty, eeDir, libraryInstall, useInstallLibrary } = useEditor.getState();
        const sameEngine = project !== null && project.eeVersion === (result.target ?? result.library.eeVersion);
        if (project !== null && sameEngine && !dirty) await openProject(project.id);
        // Unsaved work must not be reloaded under the author's hands, but the lists and checks still need the scan that just
        // finished — taken as the editor's references only when it is the installation chosen (or none is in use yet).
        else if (sameEngine && (eeDir === id || libraryInstall === null)) await useInstallLibrary(id);
        say(
          `Rescanned ${result.target ?? result.library.eeVersion}: ${result.library.templates.length} templates, ${result.library.resources.planetTextures.length} planet textures` +
            `${result.copied.length > 0 ? `; copied ${result.copied.length} image(s) into the app's cache` : "; images already current"}.`,
        );
      } catch (error) {
        fail(`Rescan failed: ${text(error)}`);
      } finally {
        set({ busy: false });
      }
    },

    remove: async (id) => {
      try {
        await removeInstallation(id);
        await get().refreshInstallations();
        if (useEditor.getState().eeDir === id) useEditor.getState().setEeDir(get().installations[0]?.id ?? "");
        say("Installation forgotten (its files were not touched).");
      } catch (error) {
        fail(text(error));
      }
    },

    selectInstallation: (id) => useEditor.getState().setEeDir(id),

    chooseProjectsFolder: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      if (!(await get().confirmUnsaved("switch to another projects folder"))) return;
      try {
        const result = await desktop.chooseProjectsFolder();
        if (result.status === "canceled") return say("No folder chosen — nothing changed.");
        if (result.status === "error") return fail(result.message);
        set({ info: result.info });
        const list = await fetchProjects();
        useEditor.setState({ projects: list.projects, project: null, dirty: false, session: useEditor.getState().session + 1 });
        if (list.projects[0] !== undefined) await useEditor.getState().openProject(list.projects[0].id);
        say(`Projects folder: ${result.info.projectsDir}`);
      } catch (error) {
        fail(text(error));
      }
    },

    importProject: async (kind) => {
      const desktop = getDesktop();
      if (desktop === null) return;
      if (!(await get().confirmUnsaved("import a project"))) return;
      set({ busy: true });
      try {
        const result = await desktop.importProject(kind);
        if (result.status === "canceled") return say("No project chosen — nothing imported.");
        if (result.status === "error") return fail(result.message);
        const list = await fetchProjects();
        useEditor.setState({ projects: list.projects });
        await useEditor.getState().openProject(result.result.id);
        const r = result.result;
        say(
          `Imported a copy as “${r.id}”${r.renamedFrom !== null ? ` (“${r.renamedFrom}” was taken)` : ""}` +
            `${r.lost.length > 0 ? ` — WARNING: ${r.lost.length} field(s) did not survive: ${r.lost.join(", ")}` : ""}. The original was not modified.`,
        );
      } catch (error) {
        fail(text(error));
      } finally {
        set({ busy: false });
      }
    },

    chooseExportFolder: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      const result = await desktop.chooseExportFolder();
      if (result.status === "canceled") {
        // Dismissing the chooser keeps the previous choice, if there was one — and says nothing was changed.
        return say(get().exportDestination === null ? "No folder chosen — nothing will be exported until you choose one." : "No folder chosen — the earlier choice stands.");
      }
      if (result.status === "error") return fail(result.message);
      set({ exportDestination: { token: result.token, path: result.path }, message: null });
    },

    exportProject: async (targets, mode) => {
      const desktop = getDesktop();
      const { project, dirty, save } = useEditor.getState();
      const destination = get().exportDestination;
      if (desktop === null || project === null) return;
      if (destination === null) return say("Choose the folder to export to first.");
      set({ busy: true, lastExport: null });
      try {
        // The export reads the saved project: save first rather than export the previous version.
        if (dirty) await save();
        if (useEditor.getState().dirty) return fail("The project could not be saved, so it was not exported.");
        const revision = useEditor.getState().revision;
        // The installation picked in the toolbar is the one its engine's references are checked against.
        const picked = get().installations.find((i) => i.id === useEditor.getState().eeDir);
        const result = await desktop.exportProject({
          projectId: project.id,
          targets: [...targets],
          mode,
          destinationToken: destination.token,
          ...(picked !== undefined ? { libraryInstalls: { [picked.target]: picked.id } } : {}),
        });
        // The token is used up whatever happened: the next export asks for its folder again.
        set({ exportDestination: null });
        if (result.status === "canceled") return say("No destination chosen — nothing exported.");
        if (result.status === "error") return fail(result.message);
        set({ lastExport: result.result, lastExportMeta: { projectId: project.id, projectName: project.name, revision, mode, at: new Date().toISOString() }, info: await desktop.info() });
        const ok = result.result.targets.filter((t) => t.ok).length;
        say(`${ok === result.result.targets.length ? "Exported" : "PARTLY exported —"} ${ok} of ${result.result.targets.length} target(s) to ${result.result.outRoot}`);
      } catch (error) {
        fail(text(error));
      } finally {
        set({ busy: false });
      }
    },

    revealExport: async () => {
      const desktop = getDesktop();
      if (desktop !== null && !(await desktop.revealLastExport())) say("There is no export folder to show yet.");
    },

    chooseExtension: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      const result = await desktop.chooseExtension();
      if (result.status === "canceled") return say("No file chosen — nothing changed.");
      if (result.status === "error") return fail(result.message);
      set({ info: result.info, compatibility: await fetchCompatibility() });
      say(`EXODUS extension: ${result.info.extension.label ?? "loaded"}.`);
    },

    setExtensionEnabled: async (enabled) => {
      const desktop = getDesktop();
      if (desktop === null) return;
      const result = await desktop.setExtensionEnabled(enabled);
      if (result.status === "error") {
        set({ info: await desktop.info() });
        return fail(result.message);
      }
      if (result.status === "ok") {
        set({ info: result.info, compatibility: await fetchCompatibility() });
        say(enabled ? "EXODUS extension on: exports can include it." : "EXODUS extension off: exports are vanilla.");
      }
    },

    forgetExtension: async () => {
      const desktop = getDesktop();
      if (desktop === null) return;
      const result = await desktop.forgetExtension();
      if (result.status === "ok") {
        set({ info: result.info, compatibility: await fetchCompatibility() });
        say("EXODUS extension forgotten.");
      }
    },
  };
});
