import { emptyEEProject, type EEProject, type ForgeBuildResult } from "@forge/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Requests that are still on their way when the author moves to another document. */
const gate = vi.hoisted(() => {
  const waiting: { resolve: (value: unknown) => void }[] = [];
  const hold = <T>(value: T): Promise<T> => new Promise((resolve) => waiting.push({ resolve: (v) => resolve(v as T) })).then(() => value);
  return { waiting, hold, projects: {} as Record<string, unknown>, library: null as unknown };
});

vi.mock("../src/api/client.js", async (original) => {
  const real = await original<typeof import("../src/api/client.js")>();
  return {
    ...real,
    saveProject: vi.fn(() => gate.hold({ savedAt: "2026-10-10T10:00:00.000Z" })),
    buildProjectOnBridge: vi.fn(() => gate.hold({ ok: true, target: "EE-2026.09.22PR", mode: "vanilla", files: [], warnings: [], errors: [], install: null, library: null } as unknown as ForgeBuildResult)),
    fetchProject: vi.fn((id: string) => Promise.resolve(gate.projects[id])),
    fetchCatalog: vi.fn(() => Promise.resolve(null)),
    fetchLibrarySource: vi.fn(() => Promise.resolve({ library: gate.library, installation: null })),
    fetchLibrary: vi.fn(() => Promise.resolve(null)),
    fetchProjects: vi.fn(() => Promise.resolve({ projects: [], projectsDir: "/p" })),
    createProject: vi.fn((id: string) => Promise.resolve({ project: gate.projects[id] ?? gate.projects["a"] })),
  };
});

import { useEditor } from "../src/store/editor.js";

const doc = (id: string): EEProject => {
  const base = emptyEEProject(id, id);
  return { ...base, map: { sectors: [], markers: [], groups: [{ id: "g", label: "Start", when: "on_start", objects: [] }] } };
};
const release = (): void => {
  for (const w of gate.waiting.splice(0)) w.resolve(undefined);
};

beforeEach(() => {
  gate.waiting.length = 0;
  gate.projects = { a: doc("a"), b: doc("b") };
  useEditor.setState({ project: doc("a"), dirty: false, revision: 0, savedRevision: 0, verification: null, lastBuild: null, session: 0, catalog: null, library: null, eeDir: "" });
});

describe("answers that arrive after another document was opened", () => {
  it("a late Verify result is dropped, not shown as the open project's", async () => {
    const pending = useEditor.getState().build(false);
    await Promise.resolve();
    await useEditor.getState().openProject("b");
    release();
    expect(await pending).toBeNull();
    const s = useEditor.getState();
    expect(s.project?.id).toBe("b");
    expect(s.verification).toBeNull();
    expect(s.lastBuild).toBeNull();
  });

  it("a late save confirmation does not make the new document look unsaved, or saved", async () => {
    useEditor.getState().updateGroup("g", { label: "x" });
    expect(useEditor.getState().dirty).toBe(true);
    const saving = useEditor.getState().save();
    await Promise.resolve();
    await useEditor.getState().openProject("b");
    expect(useEditor.getState().dirty).toBe(false);
    release();
    await saving;
    const s = useEditor.getState();
    expect(s.project?.id).toBe("b");
    expect(s.dirty).toBe(false);
    expect(s.savedRevision).toBe(0);
  });

  it("an edit made while Verify is pending leaves the result out of date, tied to the revision it checked", async () => {
    const pending = useEditor.getState().build(false);
    await Promise.resolve();
    useEditor.getState().updateGroup("g", { label: "edited meanwhile" });
    release();
    const record = await pending;
    expect(record?.revision).toBe(0);
    expect(useEditor.getState().revision).toBe(1);
    expect(useEditor.getState().dirty).toBe(true);
  });

  it("a new scenario gets the scanned library of its engine, so the stock factions and ships can be chosen", async () => {
    gate.library = { eeVersion: "EE-2026.09.22PR", factions: [{ name: "Kraylor" }], templates: [], models: [], resources: {} };
    useEditor.setState({ library: null, catalog: null, projects: [] });
    await useEditor.getState().newProject("Fresh one");
    expect((useEditor.getState().library as { factions: unknown[] } | null)?.factions).toHaveLength(1);
    gate.library = null;
  });

  it("the first load does not overwrite a message the author's own action has already shown", async () => {
    useEditor.setState({ status: "", project: null });
    const loading = useEditor.getState().bootstrap();
    useEditor.setState({ status: "No project chosen — nothing imported." });
    await loading;
    expect(useEditor.getState().status).toBe("No project chosen — nothing imported.");
  });

  it("when two projects are opened one after the other, the earlier answer cannot win", async () => {
    const first = useEditor.getState().openProject("a");
    const second = useEditor.getState().openProject("b");
    await Promise.all([first, second]);
    expect(useEditor.getState().project?.id).toBe("b");
  });
});
