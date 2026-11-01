import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EEProjectSchema, emptyEEProject } from "@forge/contracts";
import { readModelDefinitions } from "../src/scan/model-definitions.js";
import { modelResourceReader } from "../src/scan/model-resources.js";
import { checkModelDependencies, modelDependencies } from "../src/model-compat.js";
import { manualInstallNotes } from "../src/install-notes.js";

function pack(entries: Record<string, Buffer>): Buffer {
  let head = 8; for (const n of Object.keys(entries)) head += 1 + Buffer.byteLength(n) + 8;
  const parts: Buffer[] = [], index = Buffer.alloc(head); index.writeUInt32BE(0, 0); index.writeUInt32BE(Object.keys(entries).length, 4);
  let cursor = 8, offset = head;
  for (const [n, v] of Object.entries(entries)) {
    index[cursor++] = Buffer.byteLength(n); index.write(n, cursor); cursor += Buffer.byteLength(n);
    index.writeUInt32BE(offset, cursor); index.writeUInt32BE(v.length, cursor + 4); cursor += 8; offset += v.length; parts.push(v);
  }
  return Buffer.concat([index, ...parts]);
}
function fake(models: string, entries: Record<string, Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "ee-fake-"));
  mkdirSync(join(root, "scripts"), { recursive: true }); mkdirSync(join(root, "packs"));
  writeFileSync(join(root, "scripts", "model_data.lua"), models);
  writeFileSync(join(root, "packs", "p.pack"), pack(entries));
  return root;
}
function project(over: Record<string, unknown> = {}) {
  return EEProjectSchema.parse({ ...emptyEEProject("m", "M"), eeVersion: "EE-2026.09.22PR", ...over });
}
const def = (name: string, mesh: string, texture: string | null = null) => ({ ...readModelDefinitions(`ModelData():setName("${name}"):setMesh("${mesh}")`).get(name)!.definition, texture });

describe("destination compatibility of models", () => {
  it("blocks a mesh the destination lacks, passes one in its archive, and warns on same name / different bytes", () => {
    const source = fake('ModelData():setName("m")', { "ship/m.model": Buffer.from("A"), "ship/m.png": Buffer.from("img") });
    const dest = fake('ModelData():setName("m")', { "ship/m.model": Buffer.from("B") });
    try {
      const p = project({ models: [def("copy", "ship/m.model", "ship/m.png")] });
      const report = checkModelDependencies(p, dest, source);
      expect(report.issues.map(i => [i.severity, i.dependency.name])).toEqual(expect.arrayContaining([["error", "ship/m.png"], ["warning", "ship/m.model"]]));
      expect(report.issues.find(i => i.severity === "error")!.message).toContain("would not load");
      const ok = checkModelDependencies(project({ models: [def("copy", "ship/m.model")] }), dest, null);
      expect(ok.issues).toEqual([]);
      expect(ok.verified).toBe(1);
    } finally { rmSync(source, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
  });
  it("does not claim compatibility without a destination, and says so in the bundle notes", () => {
    const p = project({ models: [def("copy", "ship/m.model")] });
    const report = checkModelDependencies(p, null, null);
    expect(report.issues.every(i => i.severity === "unverified")).toBe(true);
    const notes = manualInstallNotes({ projectId: "m", target: "EE-2026.09.22PR", files: [{ name: "t.lua", install: "shiptemplates" }], unverifiedRequirements: report.issues.map(i => i.message) });
    expect(notes).toContain("REQUIREMENTS NOT VERIFIED");
    expect(notes).toContain("ship/m.model");
    expect(modelDependencies(project({ models: [{ ...def("e", "forge-models/a/x.obj"), resources: [{ path: "forge-models/a/x.obj", base64: "YQ==" }] }] }))).toEqual([]);
  });
});

// Real installations: skipped where they are absent. These read the actual archives, no fakes.
const REAL: Record<string, string> = {
  "EE 2024.12.08": "/mnt/c/Win32_EmptyEpsilon_EE-2024.12.08/EmptyEpsilon",
  "EE 2026": "/mnt/c/EE_2026/EmptyEpsilon",
};
for (const [label, root] of Object.entries(REAL)) describe.skipIf(!existsSync(join(root, "scripts", "model_data.lua")))(`real archives — ${label}`, () => {
  it("resolves every referenced mesh and texture, and finds models that exist only in an archive", () => {
    const reader = modelResourceReader(root);
    const defs = [...readModelDefinitions(readFileSync(join(root, "scripts", "model_data.lua"), "utf8")).values()].map(v => v.definition);
    let packOnly = 0, missing: string[] = [];
    for (const d of defs) for (const path of [d.mesh, d.texture, d.specular, d.illumination, d.normalMap]) {
      if (!path) continue;
      const found = reader.resolve(path);
      if (found.state !== "ok") { missing.push(`${d.name}:${path}:${found.state}`); continue; }
      if (found.origin!.kind === "pack" && !existsSync(join(root, "resources", path))) packOnly++;
    }
    expect(missing).toEqual([]);
    expect(packOnly).toBeGreaterThan(0);
  });
  it("reads a pack-only mesh and texture by range with valid content", () => {
    const reader = modelResourceReader(root);
    const defs = [...readModelDefinitions(readFileSync(join(root, "scripts", "model_data.lua"), "utf8")).values()].map(v => v.definition);
    const pick = defs.find(d => d.texture && [d.mesh, d.texture].every(p => { const r = reader.resolve(p!); return r.state === "ok" && r.origin!.kind === "pack"; }))!;
    expect(pick).toBeDefined();
    const mesh = reader.read(reader.resolve(pick.mesh));
    if (pick.mesh.endsWith(".model")) expect(4 + mesh.readUInt32BE(0) * 32).toBe(mesh.length);
    const tex = reader.read(reader.resolve(pick.texture!));
    expect(tex.subarray(0, 4).toString("hex")).toMatch(/^(89504e47|ffd8ff)/);
  });
});
