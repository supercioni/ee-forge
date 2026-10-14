import { describe, expect, it } from "vitest";
import type { AssetManifest, EELibrary, EETemplateDef } from "@forge/contracts";
import { describePreview, describeTemplateResources, instancesOfTemplate } from "../src/editor/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EEProjectSchema } from "@forge/contracts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const demoProject = () => EEProjectSchema.parse(JSON.parse(readFileSync(join(repo, "projects/forge_demo/project.json"), "utf8")));

const library = (over: Partial<EELibrary> = {}): EELibrary => ({
  eeVersion: "EE-2026.09.22PR",
  installPath: "/ee",
  scannedAt: "2026-10-01T10:00:00Z",
  templates: [],
  models: [{ name: "small_frigate_1", mesh: "m.model", texture: null, specular: null, illumination: null, scale: null, radius: null, sourceFile: "scripts/model_data.lua" }],
  factions: [],
  resources: { radarTraces: ["radar/cruiser.png"], planetTextures: [], meshes: [], textures: [], sounds: [], packs: [] },
  warnings: [],
  ...over,
});
const needs = { name: "Mk1", model: "small_frigate_1", radarTrace: "radar/cruiser.png" };
const ctx = { projectModels: [] as string[], library: library(), target: "EE-2026.09.22PR" };

describe("what a hull needs from outside the project", () => {
  it("names the file of the install that declares a model and a trace", () => {
    const [model, radar] = describeTemplateResources(needs, ctx);
    expect(model).toMatchObject({ state: "available", source: "EE-2026.09.22PR install · scripts/model_data.lua" });
    expect(radar?.state).toBe("available");
  });
  it("names the installation when asked, so two installs of one engine are told apart", () => {
    const [model] = describeTemplateResources(needs, { ...ctx, installLabel: "Juegos/2026 B" });
    expect(model?.summary).toMatch(/declared by Juegos\/2026 B/);
    expect(model?.source).toMatch(/^Juegos\/2026 B · /);
    const [missing] = describeTemplateResources({ ...needs, model: "nope" }, { ...ctx, installLabel: "Juegos/2026 B" });
    expect(missing?.summary).toMatch(/in Juegos\/2026 B scanned/);
  });
  it("says missing only against a scan that ran, and gives an action", () => {
    const [model, radar] = describeTemplateResources({ ...needs, model: "nope", radarTrace: "radar/nope.png" }, ctx);
    expect(model?.state).toBe("missing");
    expect(radar?.state).toBe("missing");
    expect(model?.action).toMatch(/rescan/);
  });
  it("does not claim a model is missing when there is no scan to look in", () => {
    const [model, radar] = describeTemplateResources(needs, { ...ctx, library: null });
    expect(model?.state).toBe("unverified");
    expect(radar?.state).toBe("unverified");
    expect(model?.action).toMatch(/Installations/);
  });
  it("prefers the project's own model", () => {
    const [model] = describeTemplateResources({ ...needs, model: "mine" }, { ...ctx, projectModels: ["mine"] });
    expect(model).toMatchObject({ state: "available", source: "this project (Models)" });
  });
});

const tpl = (over: Partial<EETemplateDef>): EETemplateDef => ({ ...(demoProject().templates[0] as EETemplateDef), ...over });
const entry = { model: "ee-ships/x.glb", scale: 1, rotationOffset: [0, 0, 0] } as unknown as AssetManifest[string];
const base = { templates: [] as EETemplateDef[], manifest: {} as AssetManifest, manifestError: null, library: library(), target: "EE-2026.09.22PR", file: "loaded" as const, failure: null };

describe("the 3D preview", () => {
  it("is a generic stand-in when the manifest is empty, and says so", () => {
    const r = describePreview({ ...base, template: tpl({ name: "Mk1" }) });
    expect(r.state).toBe("generic");
    expect(r.summary).toMatch(/lists no 3D model at all/);
  });
  it("is a generic stand-in when only this hull has no entry", () => {
    const r = describePreview({ ...base, manifest: { "CpuShip:Other": entry }, template: tpl({ name: "Mk1", copyOf: null }) });
    expect(r.state).toBe("generic");
    expect(r.summary).toMatch(/no 3D model for “Mk1”/);
  });
  it("is available, with its path, when listed and declared", () => {
    const lib = library({ templates: [{ name: "Corsair" } as never] });
    const t = tpl({ name: "Mk1", copyOf: "Corsair", kind: "ship" });
    const r = describePreview({ ...base, library: lib, manifest: { "CpuShip:Corsair": entry }, template: t, templates: [t] });
    expect(r).toMatchObject({ state: "available", source: "ee-ships/x.glb" });
    expect(r.summary).toMatch(/a likeness, not this hull's own mesh/);
  });
  it("does not call a listed model the selected engine's when its install does not declare the ship", () => {
    const t = tpl({ name: "Mk1", copyOf: "Corsair", kind: "ship" });
    const r = describePreview({ ...base, manifest: { "CpuShip:Corsair": entry }, template: t, templates: [t] });
    expect(r.state).toBe("other-source");
    expect(r.summary).toMatch(/does not say which/);
  });
  it("does not say it shows a model before the file has loaded", () => {
    const lib = library({ templates: [{ name: "Corsair" } as never] });
    const t = tpl({ name: "Mk1", copyOf: "Corsair", kind: "ship" });
    const r = describePreview({ ...base, library: lib, manifest: { "CpuShip:Corsair": entry }, template: t, templates: [t], file: "loading" });
    expect(r.state).toBe("unverified");
    expect(r.summary).toMatch(/^Loading/);
  });
  it("is missing when the file fails to load", () => {
    const lib = library({ templates: [{ name: "Corsair" } as never] });
    const t = tpl({ name: "Mk1", copyOf: "Corsair", kind: "ship" });
    const r = describePreview({ ...base, library: lib, manifest: { "CpuShip:Corsair": entry }, template: t, templates: [t], file: "failed", failure: "assets/x.glb is missing" });
    expect(r).toMatchObject({ state: "missing", summary: "assets/x.glb is missing" });
  });
});

describe("instances of a template", () => {
  it("names each object that spawns the template, with its group", () => {
    const p = demoProject();
    const name = p.templates[0]!.name;
    const objects = p.map.groups.flatMap((g) => g.objects).filter((o) => "template" in o && (o as { template: string }).template === name);
    expect(instancesOfTemplate(p, name).map((i) => i.id)).toEqual(objects.map((o) => o.id));
    expect(instancesOfTemplate(p, "no such ship")).toEqual([]);
  });
});
