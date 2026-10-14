import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDmxRig } from "@forge/contracts";
import { cleanup, fakeInstall, haveReferences, sandbox, tmp } from "./helpers.js";

afterEach(cleanup);

const T24 = "EE-2024.12.08";
const T26 = "EE-2026.09.22PR";

describe("projects without EXODUS", () => {
  it("creates, saves, lists, reopens and refuses to overwrite", () => {
    const { services, projectsDir } = sandbox();
    const created = services.projects.create({ id: "ghost", name: "Ghost Fleet", description: "" });
    expect(created.project.id).toBe("ghost");
    expect(() => services.projects.create({ id: "ghost", name: "Again", description: "" })).toThrow(/already exists/);

    const project = { ...services.projects.get("ghost"), name: "Ghost Fleet II" };
    const saved = services.projects.save("ghost", project);
    expect(saved.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(services.projects.get("ghost").name).toBe("Ghost Fleet II");
    expect(services.projects.list().projects.map((p) => p.id)).toEqual(["ghost"]);
    expect(services.projects.list().projectsDir).toBe(projectsDir);
    expect(() => services.projects.save("other", project)).toThrow(/does not match/);
    expect(() => services.projects.get("nope")).toThrow(/no project/);
  });

  it("builds a bundle for each target without any scan or library", () => {
    const { services, projectsDir } = sandbox();
    for (const target of [T24, T26]) {
      const id = target === T24 ? "p24" : "p26";
      services.projects.create({ id, name: id, description: "" });
      services.projects.save(id, { ...services.projects.get(id), eeVersion: target });
      const built = services.projects.build(id);
      expect(built.files.map((f) => f.name)).toContain(`scenario_${id}.lua`);
      expect(readFileSync(join(projectsDir, id, "build", `scenario_${id}.lua`), "utf8")).toContain(`-- target  ${target}`);
      expect(built.install).toBeNull();
    }
  });

  it("rejects a project from a newer schema and an unverified engine", () => {
    const { services, projectsDir } = sandbox();
    services.projects.create({ id: "x", name: "x", description: "" });
    services.projects.save("x", { ...services.projects.get("x"), eeVersion: "EE-2099.01.01" });
    expect(() => services.projects.build("x")).toThrow(/not a verified EmptyEpsilon target/);
    mkdirSync(join(projectsDir, "future"), { recursive: true });
    writeFileSync(join(projectsDir, "future", "project.json"), JSON.stringify({ schemaVersion: 99 }));
    expect(() => services.projects.get("future")).toThrow(/newer than/);
  });

  it.skipIf(!haveReferences)("installs only into an install of the project's own engine", () => {
    const { services } = sandbox();
    services.projects.create({ id: "m", name: "m", description: "" });
    services.projects.save("m", { ...services.projects.get("m"), eeVersion: T24 });
    const wrong = fakeInstall(T26, "x");
    expect(() => services.projects.build("m", { install: wrong })).toThrow(/targets EE-2024\.12\.08 but .* is EE-2026\.09\.22PR/);
    expect(existsSync(join(wrong, "scripts", "scenario_m.lua"))).toBe(false);

    const right = fakeInstall(T24, "x");
    const entry = services.installations.register({ path: right });
    const done = services.projects.build("m", { install: entry.id });
    expect(done.install?.installed.some((file) => file.endsWith("scenario_m.lua"))).toBe(true);
    expect(done.install?.warnings.join()).not.toContain("not a recognised build");
    expect(existsSync(join(right, "scripts", "scenario_m.lua"))).toBe(true);
  });

  it("installs into an unrecognised directory but says it was not verified", () => {
    const { services } = sandbox();
    services.projects.create({ id: "u", name: "u", description: "" });
    const dir = fakeInstall(null, "x");
    const done = services.projects.build("u", { install: dir });
    expect(done.install?.warnings.join()).toContain("not a recognised build");
  });
});

describe("DMX without EXODUS", () => {
  const rigOf = () => emptyDmxRig();

  it("saves, reloads, builds and imports offline", () => {
    const { services, projectsDir } = sandbox();
    expect(services.dmx.rig()).toBeNull();
    expect(() => services.dmx.build({})).toThrow(/no DMX rig/);
    services.dmx.save(rigOf());
    expect(services.dmx.rig()).not.toBeNull();
    const built = services.dmx.build({});
    expect(existsSync(built.outPath)).toBe(true);
    expect(built.outPath.startsWith(projectsDir)).toBe(true);

    const eeDir = tmp("dmx-ee-");
    expect(() => services.dmx.importFrom({ eeDir })).toThrow(/no hardware\.ini/);
    writeFileSync(join(eeDir, "hardware.ini"), readFileSync(built.outPath, "utf8"));
    expect(services.dmx.importFrom({ eeDir }).rig).toBeDefined();
    expect(() => services.dmx.save({ nonsense: true })).toThrow(ForgeErr);
  });

  it("backs up an existing hardware.ini before replacing it", () => {
    const { services } = sandbox();
    services.dmx.save(rigOf());
    const eeDir = tmp("dmx-ee-");
    writeFileSync(join(eeDir, "hardware.ini"), "; hand-wired rig\n");
    const built = services.dmx.build({ install: eeDir });
    expect(built.backedUpTo).toBe(join(eeDir, "hardware.ini.bak"));
    expect(readFileSync(built.backedUpTo!, "utf8")).toBe("; hand-wired rig\n");
  });

  it("reports telemetry per engine, and none when no adapter is registered", async () => {
    const none = sandbox();
    expect((await none.services.dmx.triggers(null)).live).toBe(false);

    const withSource = sandbox({
      dmxTelemetry: [{ target: T26, read: async () => null }],
    });
    expect((await withSource.services.dmx.triggers(T24)).live).toBe(false);
    const failing = sandbox({
      dmxTelemetry: [{ target: T26, read: async () => { throw new Error("EE down"); } }],
    });
    expect((await failing.services.dmx.triggers(T26)).live).toBe(false);
  });
});

import { ForgeServiceError as ForgeErr } from "../src/index.js";
