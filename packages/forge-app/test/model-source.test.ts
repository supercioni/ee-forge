import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EEModelDefSchema, ForgeModelSourceReportSchema, emptyEEProject } from "@forge/contracts";
import { cleanup, fakeInstall, haveReferences, sandbox, tmp } from "./helpers.js";
import { createForgeRouter } from "../src/router.js";

afterEach(cleanup);

function pack(entries: Record<string, Buffer>): Buffer {
  let head = 8; for (const n of Object.keys(entries)) head += 1 + Buffer.byteLength(n) + 8;
  const index = Buffer.alloc(head); index.writeUInt32BE(0, 0); index.writeUInt32BE(Object.keys(entries).length, 4);
  let cursor = 8, offset = head; const parts: Buffer[] = [];
  for (const [n, v] of Object.entries(entries)) {
    index[cursor++] = Buffer.byteLength(n); index.write(n, cursor); cursor += Buffer.byteLength(n);
    index.writeUInt32BE(offset, cursor); index.writeUInt32BE(v.length, cursor + 4); cursor += 8; offset += v.length; parts.push(v);
  }
  return Buffer.concat([index, ...parts]);
}
function withModels(dir: string, models: string, entries: Record<string, Buffer>): string {
  writeFileSync(join(dir, "scripts", "model_data.lua"), models);
  mkdirSync(join(dir, "packs"), { recursive: true });
  writeFileSync(join(dir, "packs", "p.pack"), pack(entries));
  return dir;
}
const model = (mesh: string, texture: string | null = null) => EEModelDefSchema.parse({ id: "m1", name: "Copy", mesh, texture, specular: null, illumination: null, scale: null, radius: null, collisionBox: null, renderOffset: null, beamPositions: [], tubePositions: [], engineEmitters: [] });

describe.skipIf(!haveReferences)("model source service", () => {
  it("answers only from the installation it is asked about — two installs of one version stay apart", async () => {
    const { services } = sandbox();
    const a = services.installations.register({ path: withModels(fakeInstall("EE-2026.09.22PR", "x"), "", { "ship/hull.model": Buffer.from("AAAA") }) });
    const b = services.installations.register({ path: withModels(fakeInstall("EE-2026.09.22PR", "x"), "", { "ship/hull.model": Buffer.from("BBBB") }) });
    expect(a.id).not.toBe(b.id);
    const router = createForgeRouter(services);
    const get = (id: string) => router.handle({ method: "GET", path: `/forge/model-source/${id}/file/ship/hull.model` });
    expect(Buffer.from((await get(a.id)).bytes!).toString()).toBe("AAAA");
    expect(Buffer.from((await get(b.id)).bytes!).toString()).toBe("BBBB");
    const report = ForgeModelSourceReportSchema.parse((await router.handle({ method: "GET", path: `/forge/model-source/${a.id}/report`, query: { paths: JSON.stringify(["ship/hull.model", "ship/none.png"]) } })).body);
    expect(report.available).toBe(true);
    expect(report.resources.map(r => [r.path, r.state])).toEqual([["ship/hull.model", "ok"], ["ship/none.png", "missing"]]);
    expect(report.resources[0]!.origin).toMatchObject({ kind: "pack", pack: "packs/p.pack", length: 4 });
  });

  it("never falls back: unknown id is 404, a vanished folder is reported unavailable, a vanished resource is 404", async () => {
    const { services } = sandbox();
    const dir = withModels(fakeInstall("EE-2026.09.22PR", "x"), "", { "m.obj": Buffer.from("mesh") });
    const other = services.installations.register({ path: withModels(fakeInstall("EE-2026.09.22PR", "x"), "", { "m.obj": Buffer.from("other") }) });
    const mine = services.installations.register({ path: dir });
    const router = createForgeRouter(services);
    expect((await router.handle({ method: "GET", path: "/forge/model-source/nope/report", query: { paths: "[]" } })).status).toBe(404);
    rmSync(join(dir, "packs", "p.pack"));
    expect((await router.handle({ method: "GET", path: `/forge/model-source/${mine.id}/file/m.obj` })).status).toBe(404);
    rmSync(dir, { recursive: true, force: true });
    const gone = (await router.handle({ method: "GET", path: `/forge/model-source/${mine.id}/report`, query: { paths: JSON.stringify(["m.obj"]) } })).body as { available: boolean; problem: string };
    expect(gone.available).toBe(false);
    expect(gone.problem).toContain("gone");
    expect((await router.handle({ method: "GET", path: `/forge/model-source/${mine.id}/file/m.obj` })).status).toBe(404);
    expect(Buffer.from((await router.handle({ method: "GET", path: `/forge/model-source/${other.id}/file/m.obj` })).bytes!).toString()).toBe("other");
  });

  it("refuses traversal and malformed path lists", async () => {
    const { services } = sandbox();
    const inst = services.installations.register({ path: withModels(fakeInstall("EE-2026.09.22PR", "x"), "", {}) });
    const router = createForgeRouter(services);
    expect((await router.handle({ method: "GET", path: `/forge/model-source/${inst.id}/file/%2e%2e/scripts/model_data.lua` })).status).toBe(404);
    expect((await router.handle({ method: "GET", path: `/forge/model-source/${inst.id}/report`, query: { paths: "{" } })).status).toBe(400);
    expect((await router.handle({ method: "GET", path: `/forge/model-source/${inst.id}/report`, query: { paths: "[1]" } })).status).toBe(400);
  });

  it("blocks an install whose models cannot load, lets a complete one through, and exports with nothing claimed", async () => {
    const { services } = sandbox();
    const stock = withModels(fakeInstall("EE-2026.09.22PR", "x"), 'ModelData():setName("s")', { "ship/m.model": Buffer.from("M") });
    const dest = withModels(fakeInstall("EE-2026.09.22PR", "x"), 'ModelData():setName("s")', { "ship/m.model": Buffer.from("M2") });
    const source = services.installations.register({ path: stock });
    const bare = fakeInstall("EE-2026.09.22PR", "x"); mkdirSync(join(bare, "scripts", "shiptemplates"), { recursive: true });
    const bareReg = services.installations.register({ path: bare });
    const destReg = services.installations.register({ path: dest });
    const project = { ...emptyEEProject("mp", "Model project"), eeVersion: "EE-2026.09.22PR", models: [model("ship/m.model", "ship/m.png")] };
    services.projects.save("mp", project);
    const missing = services.projects.installPreview("mp", { install: bareReg.id, modelSource: source.id });
    expect(missing.blocked).toContain("ship/m.model");
    expect(() => services.projects.build("mp", { install: bareReg.id })).toThrow(/cannot load/);
    const noTexture = services.projects.installPreview("mp", { install: destReg.id, modelSource: source.id });
    expect(noTexture.blocked).toContain("ship/m.png");
    services.projects.save("mp", { ...project, models: [model("ship/m.model")] });
    const differing = services.projects.installPreview("mp", { install: destReg.id, modelSource: source.id });
    expect(differing.blocked).toBeNull();
    expect(differing.warnings.join("\n")).toContain("different content");
    const out = tmp("export-");
    const exported = services.projects.exportBundle("mp", { targets: ["EE-2026.09.22PR"], mode: "vanilla", outRoot: out });
    expect(exported.targets[0]!.warnings.join("\n")).toContain("could not be checked");
    const notes = (await import("node:fs")).readFileSync(exported.targets[0]!.instructionsFile!, "utf8");
    expect(notes).toContain("REQUIREMENTS NOT VERIFIED");
    expect(notes).toContain("ship/m.model");
  });
});
