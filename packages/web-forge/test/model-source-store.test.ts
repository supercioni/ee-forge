import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { starterProject } from "@forge/core/editor";
import { setTransport, type ForgeTransport } from "../src/api/transport.js";
import { chosenModelSourceId, useModelSource } from "../src/store/model-source.js";
import { useEditor } from "../src/store/editor.js";

/** The model source is a third choice, apart from the project and the install destination. */
const install = (id: string, target: string, label = id) => ({ id, path: `/ee/${id}`, label, target, verified: true, evidence: null, addedAt: "2026-01-01T00:00:00Z", scannedAt: "2026-01-02T00:00:00Z" });
const INSTALLS = [install("a", "EE-2024.12.08"), install("b", "EE-2026.09.22PR"), install("c", "EE-2026.09.22PR")];
const library = (id: string) => ({ eeVersion: "x", installPath: `/ee/${id}`, scannedAt: "t", templates: [], factions: [], models: [], resources: { radarTraces: [], planetTextures: [], meshes: [], textures: [], sounds: [], packs: [] }, warnings: [] });
const libraryJson = (id: string) => ({ library: { ...library(id), models: [] }, installation: INSTALLS.find((i) => i.id === id) ?? null });

function transport(delays: Record<string, number> = {}, installs = INSTALLS): ForgeTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    label: "test", calls, assetUrl: () => "", modelFileUrl: () => "",
    async send(method, path) {
      calls.push(`${method} ${path}`);
      if (path === "/forge/installations") return { status: 200, body: { installations: installs } };
      if (/\/model-source\/[^/]+\/report/.test(path)) {
        const id = decodeURIComponent(/model-source\/([^/]+)\/report/.exec(path)![1]!);
        return { status: 200, body: { installation: { id, label: id, target: "x", verified: true }, available: !gone.has(id), problem: gone.has(id) ? "gone" : null, resources: [] } };
      }
      const m = /install=([^&]+)/.exec(path);
      if (path.startsWith("/forge/library") && m) {
        const id = decodeURIComponent(m[1]!);
        await new Promise((r) => setTimeout(r, delays[id] ?? 0));
        return { status: 200, body: libraryJson(id) };
      }
      return { status: 404, body: { error: "no", path: null } };
    },
  };
}
const gone = new Set<string>();
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear(); gone.clear();
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) } };
});
afterEach(() => {
  setTransport(null);
  delete (globalThis as { window?: unknown }).window;
  useModelSource.setState({ projectId: null, target: null, chosenId: null, installation: null, library: null, phase: "idle", problem: null, remembered: false });
  useEditor.setState({ project: null, dirty: false });
});

describe("model source choice", () => {
  it("starts from the project's engine installation only when it is unambiguous", async () => {
    setTransport(transport());
    await useModelSource.getState().open("p", "EE-2024.12.08");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "a", remembered: false, phase: "ready" });
    await useModelSource.getState().open("q", "EE-2026.09.22PR"); // two 2026 installations: no silent pick
    expect(useModelSource.getState()).toMatchObject({ chosenId: null, installation: null, phase: "unchosen" });
    expect(useModelSource.getState().problem).toContain("2 registered installations");
  });

  it("choosing a source does not touch the document", async () => {
    setTransport(transport());
    const project = starterProject("p", "P");
    useEditor.setState({ project, dirty: false, revision: 3, savedRevision: 3 });
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    await useModelSource.getState().choose("b");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "b", remembered: true, phase: "ready" });
    await useModelSource.getState().choose("a");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "a", remembered: true, phase: "ready" });
    expect(useEditor.getState()).toMatchObject({ project, dirty: false, revision: 3, savedRevision: 3 });
    expect(project.eeVersion).not.toBe("EE-2024.12.08"); // the target did not follow the source
    expect(chosenModelSourceId("p")).toBe("a");
    expect(chosenModelSourceId("other")).toBeNull();
  });

  it("remembers the choice per project, outside the shareable document", async () => {
    setTransport(transport());
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    await useModelSource.getState().choose("c");
    await useModelSource.getState().open("q", "EE-2026.09.22PR");
    expect(useModelSource.getState().chosenId).toBeNull();
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "c", remembered: true });
    expect(JSON.stringify(starterProject("p", "P"))).not.toContain("/ee/");
    expect([...memory.values()].join()).not.toContain("/ee/");
  });

  it("reports a remembered installation that is gone and does not substitute another", async () => {
    memory.set("forge.modelSource.v1", JSON.stringify({ p: "gone" }));
    setTransport(transport());
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "gone", installation: null, library: null, phase: "unavailable" });
    expect(useModelSource.getState().problem).toContain("no longer registered");
  });

  it("reports an installation whose folder has gone, keeping it chosen", async () => {
    gone.add("c");
    setTransport(transport());
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    await useModelSource.getState().choose("c");
    expect(useModelSource.getState()).toMatchObject({ chosenId: "c", phase: "unavailable" });
    expect(useModelSource.getState().problem).toContain("cannot be read");
  });

  it("with no installation registered says so instead of picking something", async () => {
    setTransport(transport({}, []));
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    expect(useModelSource.getState()).toMatchObject({ chosenId: null, phase: "unchosen" });
  });

  it("drops a load that finishes after a newer choice", async () => {
    setTransport(transport({ a: 60, c: 0 }));
    await useModelSource.getState().open("p", "EE-2026.09.22PR");
    const slow = useModelSource.getState().choose("a");
    await new Promise((r) => setTimeout(r, 5));
    await useModelSource.getState().choose("c");
    await slow;
    expect(useModelSource.getState().chosenId).toBe("c");
    expect(useModelSource.getState().installation?.id).toBe("c");
    expect(useModelSource.getState().library?.installPath).toBe("/ee/c");
  });
});
