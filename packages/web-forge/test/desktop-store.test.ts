import { afterEach, describe, expect, it } from "vitest";
import { starterProject } from "@forge/core/editor";
import { setTransport, type ForgeTransport } from "../src/api/transport.js";
import { useDesktop } from "../src/store/desktop.js";
import { useEditor } from "../src/store/editor.js";

/**
 * The unsaved-changes question, as the toolbar, the importer and the window-close request all use it:
 * nothing is lost unless the author says "don't save", and a save that fails never lets go.
 */
const transport = (saved: boolean): ForgeTransport & { calls: string[] } => {
  const calls: string[] = [];
  return {
    label: "test",
    calls,
    assetUrl: () => "",
    async send(method, path) {
      calls.push(`${method} ${path}`);
      return saved
        ? { status: 200, body: { saved: true, savedAt: "2026-10-07T10:00:00.000Z", sourceHash: "h" } }
        : { status: 422, body: { error: "disk full", path: null } };
    },
  };
};

const open = (dirty: boolean): void => useEditor.setState({ project: starterProject("p", "P"), dirty, error: null });

afterEach(() => {
  setTransport(null);
  useDesktop.setState({ unsaved: null });
  useEditor.setState({ project: null, dirty: false });
});

describe("confirmUnsaved", () => {
  it("asks nothing when nothing is unsaved", async () => {
    open(false);
    expect(await useDesktop.getState().confirmUnsaved("do it")).toBe(true);
    expect(useDesktop.getState().unsaved).toBeNull();
  });

  it("Cancel stops the action and keeps the edit", async () => {
    open(true);
    const answer = useDesktop.getState().confirmUnsaved("do it");
    expect(useDesktop.getState().unsaved?.reason).toBe("do it");
    useDesktop.getState().answerUnsaved("cancel");
    expect(await answer).toBe(false);
    expect(useEditor.getState().dirty).toBe(true);
  });

  it("Don't save goes ahead without writing anything", async () => {
    const t = transport(true);
    setTransport(t);
    open(true);
    const answer = useDesktop.getState().confirmUnsaved("do it");
    useDesktop.getState().answerUnsaved("discard");
    expect(await answer).toBe(true);
    expect(t.calls).toEqual([]);
  });

  it("Save writes the project, then goes ahead", async () => {
    const t = transport(true);
    setTransport(t);
    open(true);
    const answer = useDesktop.getState().confirmUnsaved("do it");
    useDesktop.getState().answerUnsaved("save");
    expect(await answer).toBe(true);
    expect(t.calls).toEqual(["PUT /forge/projects/p"]);
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("a failed save does not let the edit go: the action is stopped and the error is shown", async () => {
    setTransport(transport(false));
    open(true);
    const answer = useDesktop.getState().confirmUnsaved("do it");
    useDesktop.getState().answerUnsaved("save");
    expect(await answer).toBe(false);
    expect(useEditor.getState().dirty).toBe(true);
    expect(useEditor.getState().error).toMatch(/disk full/);
  });
});

describe("what a build says about an install", () => {
  const base = {
    mode: "vanilla" as const, files: [{ name: "a.lua", install: "scripts" as const, bytes: 1 }], warnings: [], outDir: "x", needsLaunchInstall: true,
    launchItems: { templates: ["Hull A"], models: ["Mesh A"] },
  };
  const install = (over: Partial<NonNullable<import("@forge/contracts").ForgeBuildResult["install"]>>) => ({
    status: "installed" as const, ok: true, installed: ["a"], unchanged: [], locked: [], collisions: [], backupDir: null,
    restore: { restored: [], unrestored: [] }, error: null, needsRestart: true, restartFiles: ["t"], requireLine: null, required: true, warnings: [], ...over,
  });

  it("says Installed, with templates and models listed apart, only for a complete install", async () => {
    const { buildStatus } = await import("../src/store/editor.js");
    const text = buildStatus({ ...base, install: install({}) });
    expect(text).toContain("Installed 1 file");
    expect(text).toContain("ship templates (Hull A) and models (Mesh A)");
  });

  it.each([
    ["refused", "nothing was changed"],
    ["rolled-back", "put back"],
    ["rollback-failed", "partly restored"],
    ["installed-pending", "NOT active"],
  ] as const)("never says Installed for %s", async (status, fragment) => {
    const { buildStatus } = await import("../src/store/editor.js");
    const text = buildStatus({ ...base, install: install({ status, ok: false, installed: status === "installed-pending" ? ["a"] : [], error: `x: ${fragment}` }) });
    expect(text).not.toMatch(/\bInstalled \d/);
    expect(text).toContain(fragment);
  });
});
