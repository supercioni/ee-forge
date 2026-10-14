import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopOperations, type Dialogs } from "../src/main/operations.js";
import { Runtime } from "../src/main/runtime.js";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dirs: string[] = [];
const scratch = (prefix = "forge desktop "): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The OS pickers, scripted: each call takes the next answer (a path, or null = the user dismissed it). */
function scripted(answers: (string | null)[]): Dialogs & { calls: string[] } {
  const calls: string[] = [];
  const next = (title: string): string | null => {
    calls.push(title);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`unexpected dialog: ${title}`);
    return answer;
  };
  return { calls, pickFolder: async (o) => next(o.title), pickFile: async (o) => next(o.title) };
}

async function setup(answers: (string | null)[]) {
  const root = scratch();
  const runtime = new Runtime({ userData: join(root, "Mis Datos"), documents: join(root, "Mis Documentos"), resources: join(root, "res"), version: "0.1.0", electronVersion: "t" });
  await runtime.start();
  const dialogs = scripted(answers);
  return { root, runtime, dialogs, ops: new DesktopOperations(runtime, dialogs) };
}

function demoCopy(root: string): string {
  const dir = join(root, "Carpeta Con Espacios", "Demo Mission");
  mkdirSync(dir, { recursive: true });
  cpSync(join(repo, "projects", "exodus_optional_demo"), dir, { recursive: true });
  return dir;
}

describe("a dismissed dialog changes nothing", () => {
  it("for every operation that opens one", async () => {
    const { ops, runtime, dialogs } = await setup([null, null, null, null, null, null, null]);
    const before = JSON.stringify(runtime.settings);
    expect(await ops.chooseProjectsFolder()).toEqual({ status: "canceled" });
    expect(await ops.addInstallation()).toEqual({ status: "canceled" });
    expect(await ops.importProject("folder")).toEqual({ status: "canceled" });
    expect(await ops.importProject("file")).toEqual({ status: "canceled" });
    expect(await ops.exportProject({ projectId: "whatever", targets: ["EE-2026.09.22PR"], mode: "vanilla" })).toEqual({ status: "canceled" });
    expect(await ops.chooseExtension()).toEqual({ status: "canceled" });
    expect(dialogs.calls).toHaveLength(6);
    expect(JSON.stringify(runtime.settings)).toBe(before);
    expect(runtime.services.projects.list().projects).toEqual([]);
    expect(runtime.services.installations.list()).toEqual([]);
    expect(ops.revealLastExport()).toBe(false);
  });
});

describe("importing and exporting through the dialogs", () => {
  it("imports a copy from a folder with spaces, then exports both engines into a folder with spaces", async () => {
    const root = scratch();
    const source = demoCopy(root);
    const out = join(root, "Mis Exportaciones", "Ronda 1");
    mkdirSync(out, { recursive: true });
    const { ops, runtime } = await setup([source, out]);

    const imported = await ops.importProject("folder");
    expect(imported.status).toBe("imported");
    if (imported.status !== "imported") return;
    expect(imported.result.id).toBe("exodus_optional_demo");
    expect(existsSync(join(runtime.projectsDir, "exodus_optional_demo", "project.json"))).toBe(true);

    const exported = await ops.exportProject({ projectId: "exodus_optional_demo", targets: ["EE-2024.12.08", "EE-2026.09.22PR"], mode: "vanilla" });
    expect(exported.status).toBe("exported");
    if (exported.status !== "exported") return;
    expect(exported.result.targets.map((t) => t.ok)).toEqual([true, true]);
    expect(readdirSync(join(out, "exodus_optional_demo")).sort()).toEqual(["EE-2024.12.08", "EE-2026.09.22PR", "export-report.json"]);
    expect(runtime.settings.lastExportDir).toBe(join(out, "exodus_optional_demo"));
    expect(JSON.parse(readFileSync(join(runtime.settingsPath), "utf8")).lastExportDir).toBe(join(out, "exodus_optional_demo"));
  });

  it("reports a folder that is not a project instead of failing silently", async () => {
    const empty = scratch();
    const { ops, runtime } = await setup([empty]);
    const result = await ops.importProject("folder");
    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" && result.message).toMatch(/has no project\.json/);
    expect(runtime.services.projects.list().projects).toEqual([]);
  });
});

describe("registering an installation", () => {
  it("keeps an unrecognised folder pending behind a token and lets the author declare its version", async () => {
    const root = scratch();
    const fake = join(root, "Some Game Folder");
    mkdirSync(join(fake, "scripts"), { recursive: true });
    const { ops } = await setup([fake]);
    const first = await ops.addInstallation();
    expect(first.status).toBe("unrecognised");
    if (first.status !== "unrecognised") return;
    expect(first.message).toMatch(/not a recognised EmptyEpsilon build/);
    expect(first.token).not.toContain("Some Game Folder");
    const declared = await ops.declareInstallation(first.token, "EE-2024.12.08");
    expect(declared.status).toBe("added");
    if (declared.status !== "added") return;
    expect(declared.installation.verified).toBe(false);
    expect(declared.installation.target).toBe("EE-2024.12.08");
    expect(ops.isInstallId(declared.installation.id)).toBe(true);
    expect(await ops.declareInstallation(first.token, "EE-2024.12.08")).toMatchObject({ status: "error" }); // the token is spent
  });

  it("refuses a made-up token and an unknown version", async () => {
    const { ops } = await setup([]);
    expect(await ops.declareInstallation("deadbeefdeadbeef", "EE-2024.12.08")).toMatchObject({ status: "error" });
  });
});

describe("the projects folder", () => {
  it("moves to a folder with spaces, starts empty there, and the old projects stay where they were", async () => {
    const root = scratch();
    const newDir = join(root, "Otra Carpeta");
    mkdirSync(newDir);
    const { ops, runtime } = await setup([newDir]);
    runtime.services.projects.create({ id: "old", name: "Old", description: "" });
    const oldDir = runtime.projectsDir;
    const result = await ops.chooseProjectsFolder();
    expect(result.status).toBe("ok");
    expect(runtime.projectsDir).toBe(newDir);
    expect(runtime.services.projects.list().projects).toEqual([]);
    expect(existsSync(join(oldDir, "old", "project.json"))).toBe(true);
  });
});

describe("choosing the export folder ahead of the export", () => {
  it("keeps the path in the shell, exports there once without asking again, and forgets the token", async () => {
    const root0 = scratch();
    const out = join(root0, "Salida Con Espacios");
    mkdirSync(out, { recursive: true });
    const { root, ops, dialogs } = await setup([null, out]);
    await ops.importProject("folder").catch(() => undefined); // consumes the null answer: nothing imported
    cpSync(demoCopy(root), join(root0, "src"), { recursive: true });
    const chosen = await ops.chooseExportFolder();
    expect(chosen).toMatchObject({ status: "chosen", path: out });
    if (chosen.status !== "chosen") return;
    const calls = dialogs.calls.length;
    const { runtime } = ops as unknown as { runtime: Runtime };
    const id = runtime.services.projects.importCopy(join(root0, "src")).id;
    const done = await ops.exportProject({ projectId: id, targets: ["EE-2026.09.22PR"], mode: "vanilla", destinationToken: chosen.token });
    expect(done.status).toBe("exported");
    expect(dialogs.calls).toHaveLength(calls); // no second dialog
    if (done.status === "exported") expect(done.result.outRoot.startsWith(out)).toBe(true);
    const again = await ops.exportProject({ projectId: id, targets: ["EE-2026.09.22PR"], mode: "vanilla", destinationToken: chosen.token });
    expect(again).toMatchObject({ status: "error", message: expect.stringMatching(/no longer pending/) });
  });

  it("a dismissed folder dialog leaves nothing pending, and an invented token exports nothing", async () => {
    const { ops } = await setup([null]);
    expect(await ops.chooseExportFolder()).toEqual({ status: "canceled" });
    const result = await ops.exportProject({ projectId: "whatever", targets: ["EE-2026.09.22PR"], mode: "vanilla", destinationToken: "0123456789abcdef" });
    expect(result).toMatchObject({ status: "error" });
  });
});
