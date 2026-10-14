import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Runtime } from "../src/main/runtime.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/main/settings.js";

const dirs: string[] = [];
const scratch = (prefix = "forge desktop "): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const paths = (root: string) => ({
  userData: join(root, "User Data"),
  documents: join(root, "My Documents"),
  resources: join(root, "resources"),
  version: "0.1.0",
  electronVersion: "test",
});

describe("settings", () => {
  it("round-trips, and falls back to the defaults for a missing, damaged or foreign file", () => {
    const file = join(scratch(), "settings.json");
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS);
    saveSettings(file, { ...DEFAULT_SETTINGS, projectsDir: "D:\\Mis Proyectos", lastExportDir: "D:\\Export Dir" });
    expect(loadSettings(file).projectsDir).toBe("D:\\Mis Proyectos");
    const warnings: string[] = [];
    writeFileSync(file, "{broken");
    expect(loadSettings(file, (m) => warnings.push(m))).toEqual(DEFAULT_SETTINGS);
    writeFileSync(file, JSON.stringify({ version: 2, projectsDir: "x" }));
    expect(loadSettings(file, (m) => warnings.push(m))).toEqual(DEFAULT_SETTINGS);
    expect(warnings).toHaveLength(2);
    expect(readFileSync(file, "utf8")).toContain('"version":2'); // the unreadable file is left alone
  });
});

describe("runtime", () => {
  it("keeps projects and state under the user's folders by default, with spaces in the path", async () => {
    const root = scratch();
    const runtime = new Runtime(paths(root));
    await runtime.start();
    expect(runtime.projectsDir).toBe(join(root, "My Documents", "EE FORGE", "Projects"));
    expect(runtime.stateDir).toBe(join(root, "User Data", "state"));
    const created = runtime.services.projects.create({ id: "first", name: "First", description: "" });
    expect(created.dir.startsWith(join(root, "My Documents"))).toBe(true);
    expect(runtime.services.extensions).toEqual([]);
  });

  it("starts with no extension, and the vanilla path needs none", async () => {
    const runtime = new Runtime(paths(scratch()));
    await runtime.start();
    expect(runtime.info().extension).toMatchObject({ available: false, enabled: false, loaded: false, source: "none", error: null });
    const response = await runtime.router.handle({ method: "GET", path: "/forge/compatibility" });
    const body = response.body as { targets: { vanilla: { level: string }; extensions: unknown[] }[] };
    expect(body.targets.every((t) => t.vanilla.level === "engine-tested" && t.extensions.length === 0)).toBe(true);
  });

  const writeExtension = (dir: string, body: string): string => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "ext.mjs");
    writeFileSync(file, body);
    return file;
  };
  const stub = `export const forgeExtension = { id: "x", label: "Stub", protocol: "1.0.0", capabilities: [], owns: () => false, describe: () => ({ capability: "x", hasOutcome: false }), scenarioPrelude: () => "", initStatements: () => "", updateStatements: () => "", emitAction: () => "" };`;

  it("loads an extension only after the user opts in, and survives a broken one", async () => {
    const root = scratch();
    const runtime = new Runtime(paths(root));
    // vitest's module loader mishandles %20 in dynamic imports (real Node and Electron do not): the
    // extension sits in a space-free folder here, and the Electron run covers a path with spaces.
    const file = writeExtension(join(scratch("forgeext-"), "ext"), stub);
    runtime.update({ extension: { path: file, enabled: false } });
    await runtime.start();
    expect(runtime.info().extension).toMatchObject({ available: true, enabled: false, loaded: false, source: "user" });
    runtime.update({ extension: { path: file, enabled: true } });
    await runtime.start();
    expect(runtime.info().extension, JSON.stringify(runtime.info().extension)).toMatchObject({ loaded: true, id: "x", label: "Stub" });

    const bad = writeExtension(join(scratch("forgebad-"), "bad"), "export const nothing = 1;");
    runtime.update({ extension: { path: bad, enabled: true } });
    await runtime.start(); // does not throw: the app still starts
    expect(runtime.info().extension.loaded).toBe(false);
    expect(runtime.info().extension.error).toMatch(/does not export a Forge extension/);
    expect(runtime.services.extensions).toEqual([]);
  });

  it("offers the bundled optional module without enabling it", async () => {
    const root = scratch();
    const p = paths(root);
    // The bundled module has a fixed name.
    mkdirSync(join(p.resources, "optional"), { recursive: true });
    writeFileSync(join(p.resources, "optional", "exodus-extension.mjs"), stub);
    const runtime = new Runtime(p);
    await runtime.start();
    expect(runtime.info().extension).toMatchObject({ available: true, enabled: false, loaded: false, source: "bundled" });
  });
});
