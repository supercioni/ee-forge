import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fakeInstall, haveReferences, sandbox, tmp } from "./helpers.js";

afterEach(cleanup);

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const T26 = "EE-2026.09.22PR";
const T24 = "EE-2024.12.08";

function imported() {
  const sb = sandbox();
  const dir = tmp("src-");
  cpSync(join(repo, "projects", "exodus_optional_demo"), dir, { recursive: true });
  return { sb, id: sb.services.projects.importCopy(dir).id };
}

/** An install of `target` whose scan declares one model, so two installs of one engine can differ. */
function installWithModel(target: string, model: string): string {
  const dir = fakeInstall(target, "x");
  writeFileSync(join(dir, "scripts", "model_data.lua"), `ModelData():setName("${model}"):setMesh("m.model"):setTexture("t.png"):setRadius(10)\n`);
  mkdirSync(join(dir, "scripts", "shiptemplates"), { recursive: true });
  return dir;
}

describe.skipIf(!haveReferences)("a result says which installation it looked at", () => {
  it("names the installation of the scan, and tells two installs of one engine apart", () => {
    const { sb, id } = imported();
    const a = sb.services.installations.register({ path: installWithModel(T26, "model_a") });
    const b = sb.services.installations.register({ path: installWithModel(T26, "model_b") });
    sb.services.libraries.rescan(a.id);
    sb.services.libraries.rescan(b.id);
    const onA = sb.services.projects.build(id, { libraryInstall: a.id });
    const onB = sb.services.projects.build(id, { libraryInstall: b.id });
    expect(onA.target).toBe(T26);
    expect(onA.library).toMatchObject({ installId: a.id, eeVersion: T26 });
    expect(onB.library).toMatchObject({ installId: b.id, eeVersion: T26 });
    expect(onA.library!.path).not.toBe(onB.library!.path);
  });

  it("without a scan the result has no library, so nothing is claimed about the install", () => {
    const { sb, id } = imported();
    expect(sb.services.projects.build(id, {}).library).toBeNull();
  });

  it("refuses a scan of another engine as evidence", () => {
    const { sb, id } = imported();
    const other = sb.services.installations.register({ path: installWithModel(T24, "m24") });
    sb.services.libraries.rescan(other.id);
    expect(() => sb.services.projects.build(id, { libraryInstall: other.id })).toThrow(/scan says nothing about this engine/);
  });

  it("records the library per target of an export, each from its own engine's install", () => {
    const { sb, id } = imported();
    const a = sb.services.installations.register({ path: installWithModel(T26, "m26") });
    const b = sb.services.installations.register({ path: installWithModel(T24, "m24") });
    sb.services.libraries.rescan(a.id);
    sb.services.libraries.rescan(b.id);
    const out = tmp("out-");
    const result = sb.services.projects.exportBundle(id, { targets: [T24, T26], mode: "vanilla", outRoot: out });
    const by = Object.fromEntries(result.targets.map((t) => [t.target, t.library?.installId]));
    expect(by).toEqual({ [T24]: b.id, [T26]: a.id });
  });
});

describe.skipIf(!haveReferences)("an export checks against the installation the author chose", () => {
  it("uses the chosen one of two installations of the same engine, and the newest scan when none is chosen or the choice is another engine's", () => {
    const { sb, id } = imported();
    const a = sb.services.installations.register({ path: installWithModel(T26, "model_a") });
    const b = sb.services.installations.register({ path: installWithModel(T26, "model_b") });
    const other = sb.services.installations.register({ path: installWithModel(T24, "m24") });
    sb.services.libraries.rescan(a.id);
    sb.services.libraries.rescan(other.id);
    sb.services.libraries.rescan(b.id); // b is the newest scan of the engine
    const run = (libraryInstalls?: Record<string, string>) =>
      sb.services.projects.exportBundle(id, { targets: [T26], mode: "vanilla", outRoot: tmp("out-"), ...(libraryInstalls !== undefined ? { libraryInstalls } : {}) }).targets[0]!.library?.installId;
    expect(run()).toBe(b.id);
    expect(run({ [T26]: a.id })).toBe(a.id);
    expect(run({ [T26]: other.id })).toBe(b.id); // another engine's installation is not evidence here
  });
});

describe.skipIf(!haveReferences)("the install preview", () => {
  it("lists what would be created, writes nothing, and says the engine does not match", () => {
    const { sb, id } = imported();
    const install = installWithModel(T26, "m");
    const preview = sb.services.projects.installPreview(id, { install });
    expect(preview.blocked).toBeNull();
    expect(preview.files.every((f) => f.action === "create")).toBe(true);
    expect(preview.clear).toBe(true);
    const wrong = sb.services.projects.installPreview(id, { install: installWithModel(T24, "m") });
    expect(wrong.blocked).toMatch(/targets/);
    expect(wrong.files).toEqual([]);
  });

  it("finds a collision the install would refuse, with the same file named", () => {
    const { sb, id } = imported();
    const install = installWithModel(T26, "m");
    writeFileSync(join(install, "scripts", `scenario_${id}.lua`), "-- not ours\n");
    const preview = sb.services.projects.installPreview(id, { install });
    expect(preview.collisions).toEqual([join(install, "scripts", `scenario_${id}.lua`)]);
    expect(preview.clear).toBe(false);
    const done = sb.services.projects.build(id, { install }).install!;
    expect(done.collisions).toEqual(preview.collisions);
  });
});
