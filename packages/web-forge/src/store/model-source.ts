import { create } from "zustand";
import type { EELibrary, ForgeInstallation } from "@forge/contracts";
import { fetchInstallations, fetchLibrarySource, fetchModelSourceReport, rescanInstallation } from "../api/client.js";

/**
 * Where the model workshop reads meshes and textures from ("Model source").
 *
 * This is deliberately a third thing, apart from the project's target engine and from the installation that
 * "Install scenario" writes to. Choosing a source changes none of the project, the document or the install
 * destination: the choice lives here and in this browser's local storage, keyed by project id, and never in the
 * shareable project file (an installation id is derived from a path on this machine).
 *
 * There is no silent fallback. A remembered installation that is gone stays chosen and is reported unavailable until
 * the author picks another. A project with no remembered choice starts from the registered installation of its own
 * engine only when exactly one exists; with several (or none) nothing is chosen for the author — "newest scan" is not
 * evidence of where the models should come from.
 */

export type ModelSourcePhase = "idle" | "loading" | "ready" | "unchosen" | "unscanned" | "unavailable";

const KEY = "forge.modelSource.v1";

function readPrefs(): Record<string, string> {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(KEY);
    const parsed = raw === null ? {} : (JSON.parse(raw) as unknown);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writePref(projectId: string, installId: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), [projectId]: installId }));
  } catch {
    /* private mode / quota: the choice then lasts for this session only */
  }
}

export interface ModelSourceState {
  readonly projectId: string | null;
  /** The engine the open project targets: only used to pick the starting source when none was ever chosen. */
  readonly target: string | null;
  readonly installs: readonly ForgeInstallation[];
  readonly chosenId: string | null;
  /** True when the author picked it (remembered); false for the starting default. */
  readonly remembered: boolean;
  readonly installation: ForgeInstallation | null;
  /** The chosen installation's scan: its model catalogue. */
  readonly library: EELibrary | null;
  readonly phase: ModelSourcePhase;
  readonly problem: string | null;
  /** Bumped by every rescan / reload of the source so anything fetched earlier is not reused. */
  readonly epoch: number;
  /** Open (or reopen) for a project. */
  open(projectId: string, target: string): Promise<void>;
  choose(installId: string): Promise<void>;
  /** Re-read the registry and the chosen source's scan (after a rescan, registration or removal). */
  refresh(): Promise<void>;
  rescanChosen(): Promise<void>;
}

/** The newest request wins: an answer to an older open/choose/refresh is dropped when it finally arrives. */
let ticket = 0;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const useModelSource = create<ModelSourceState>((set, get) => {
  const load = async (projectId: string, target: string | null, preferred: { id: string | null; remembered: boolean }, keepEpoch = false): Promise<void> => {
    const mine = ++ticket;
    const stale = (): boolean => mine !== ticket;
    set({ projectId, target, phase: "loading", problem: null, ...(keepEpoch ? {} : { epoch: get().epoch + 1 }) });
    let installs: ForgeInstallation[];
    try {
      installs = await fetchInstallations();
    } catch (error) {
      if (!stale()) set({ installs: [], installation: null, library: null, phase: "unavailable", problem: errorText(error) });
      return;
    }
    if (stale()) return;
    let id = preferred.id;
    let remembered = preferred.remembered;
    if (id === null && target !== null) {
      const fits = installs.filter((i) => i.target === target);
      if (fits.length === 1) {
        id = fits[0]!.id;
        remembered = false;
      } else {
        set({
          installs, chosenId: null, remembered: false, installation: null, library: null, phase: "unchosen",
          problem: fits.length === 0
            ? `No registered installation is ${target}. Choose any registered installation as the model source, or add one.`
            : `${fits.length} registered installations are ${target}. Choose which one to read models from; Forge does not pick one for you.`,
        });
        return;
      }
    }
    const installation = id === null ? null : (installs.find((i) => i.id === id) ?? null);
    if (id === null) {
      set({ installs, chosenId: null, remembered: false, installation: null, library: null, phase: "unavailable", problem: "No installation is registered yet. Add an EmptyEpsilon installation, then choose it as the model source." });
      return;
    }
    if (installation === null) {
      set({ installs, chosenId: id, remembered, installation: null, library: null, phase: "unavailable", problem: "The installation chosen for this project's models is no longer registered. Choose another model source; nothing was substituted." });
      return;
    }
    try {
      const [source, reachable] = await Promise.all([fetchLibrarySource(null, installation.id), fetchModelSourceReport(installation.id, [])]);
      if (stale()) return;
      // The registry remembers an installation after its folder is gone: ask the service whether it can be read now.
      if (!reachable.available) {
        set({ installs, chosenId: installation.id, remembered, installation, library: source.library, phase: "unavailable", problem: `${installation.label} cannot be read: ${reachable.problem ?? "unavailable"}. Choose another model source; nothing was substituted.` });
        return;
      }
      set({
        installs, chosenId: installation.id, remembered, installation,
        library: source.library,
        phase: source.library === null || installation.scannedAt === null ? "unscanned" : "ready",
        problem: source.library === null ? `${installation.label} has not been scanned yet, so its models are unknown. Rescan it.` : null,
      });
    } catch (error) {
      if (!stale()) set({ installs, chosenId: installation.id, remembered, installation, library: null, phase: "unavailable", problem: errorText(error) });
    }
  };

  return {
    projectId: null,
    target: null,
    installs: [],
    chosenId: null,
    remembered: false,
    installation: null,
    library: null,
    phase: "idle",
    problem: null,
    epoch: 0,

    open: async (projectId, target) => {
      const stored = readPrefs()[projectId];
      await load(projectId, target, { id: stored ?? null, remembered: stored !== undefined });
    },

    choose: async (installId) => {
      const { projectId, target } = get();
      if (projectId === null) return;
      writePref(projectId, installId);
      await load(projectId, target, { id: installId, remembered: true });
    },

    refresh: async () => {
      const { projectId, target, chosenId, remembered } = get();
      if (projectId === null) return;
      await load(projectId, target, { id: chosenId, remembered });
    },

    rescanChosen: async () => {
      const { chosenId } = get();
      if (chosenId === null) return;
      try {
        await rescanInstallation(chosenId);
      } catch (error) {
        set({ phase: "unavailable", problem: errorText(error) });
        return;
      }
      await get().refresh();
    },
  };
});

/** The installation id the author chose for models in the open project, for the checks that compare it with the destination. */
export function chosenModelSourceId(projectId: string): string | null {
  const state = useModelSource.getState();
  return state.projectId === projectId ? state.chosenId : null;
}
