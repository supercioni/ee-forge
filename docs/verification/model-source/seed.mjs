// Seed an isolated Forge state (never the user's): register installations through the real service, rescan, create a project.
import { mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createForgeServices } from "../../../packages/forge-app/dist/index.js";
import { starterProject } from "../../../packages/forge-core/dist/editor/index.js";

export const INSTALLS = {
  e24: "/mnt/c/Win32_EmptyEpsilon_EE-2024.12.08/EmptyEpsilon",
  e26: "/mnt/c/EE_2026/EmptyEpsilon",
};

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "ascii"); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; }
/** A 16x16 solid-colour PNG: the only thing that tells the fixture installations apart. */
export function solidPng([r, g, b]) {
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 16 }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const CUBE = "v -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\nf 1/1/1 3/3/1 4/4/1\nf 5/1/1 6/2/1 7/3/1\nf 5/1/1 7/3/1 8/4/1\nf 1/1/1 2/2/1 6/3/1\nf 1/1/1 6/3/1 5/4/1\nf 3/1/1 4/2/1 8/3/1\nf 3/1/1 8/3/1 7/4/1\n";
export function packFile(entries) {
  let head = 8; for (const n of Object.keys(entries)) head += 1 + Buffer.byteLength(n) + 8;
  const index = Buffer.alloc(head); index.writeUInt32BE(0, 0); index.writeUInt32BE(Object.keys(entries).length, 4);
  let cursor = 8, offset = head; const parts = [];
  for (const [n, v] of Object.entries(entries)) { index[cursor++] = Buffer.byteLength(n); index.write(n, cursor); cursor += Buffer.byteLength(n); index.writeUInt32BE(offset, cursor); index.writeUInt32BE(v.length, cursor + 4); cursor += 8; offset += v.length; parts.push(v); }
  return Buffer.concat([index, ...parts]);
}
function skeleton(root, name, models) {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "scripts"), { recursive: true }); mkdirSync(join(dir, "resources"), { recursive: true }); mkdirSync(join(dir, "packs"), { recursive: true });
  copyFileSync(join(INSTALLS.e26, "script_reference.html"), join(dir, "script_reference.html"));
  writeFileSync(join(dir, "scripts", "model_data.lua"), models);
  return dir;
}
/** Small stand-ins for a second EE 2026 installation (identified by the real script reference). Same model name, different bytes. */
export function makeTwin(root, name, colour) {
  const dir = skeleton(root, name, 'ModelData():setName("probe"):setMesh("probe.obj"):setTexture("probe.png"):setScale(25):setRadius(60)\n');
  writeFileSync(join(dir, "resources", "probe.obj"), CUBE);
  writeFileSync(join(dir, "packs", "probe.pack"), packFile({ "probe.png": solidPng(colour) })); // texture ONLY inside an archive
  return dir;
}
/** A fixture whose models each break in a different way. */
export function makeFaulty(root, name) {
  const dir = skeleton(root, name, [
    'ModelData():setName("okmodel"):setMesh("probe.obj"):setTexture("ok.png")',
    'ModelData():setName("nomesh"):setMesh("absent.obj"):setTexture("ok.png")',
    'ModelData():setName("notex"):setMesh("probe.obj"):setTexture("absent.png")',
    'ModelData():setName("badpack"):setMesh("inpack.obj"):setTexture("ok.png")',
    'ModelData():setName("tgafmt"):setMesh("probe.obj"):setTexture("skin.tga")',
  ].join("\n") + "\n");
  writeFileSync(join(dir, "resources", "probe.obj"), CUBE);
  writeFileSync(join(dir, "resources", "ok.png"), solidPng([40, 200, 90]));
  writeFileSync(join(dir, "resources", "skin.tga"), Buffer.from("tga"));
  const broken = packFile({ "inpack.obj": Buffer.from(CUBE) });
  writeFileSync(join(dir, "packs", "broken.pack"), broken.subarray(0, broken.length - 5)); // truncated archive
  return dir;
}

export async function seed({ userData, documents, twins = null, scan = true }) {
  const stateDir = join(userData, "state");
  const projectsDir = join(documents, "EE FORGE", "Projects");
  mkdirSync(projectsDir, { recursive: true });
  const services = createForgeServices({ projectsDir, stateDir });
  const registered = {};
  // Stand-ins first, so the real installations are the most recently scanned ones (the editor's reference scan follows that order).
  const all = { ...(twins ?? {}), ...Object.fromEntries(Object.entries(INSTALLS).map(([k, path]) => [k, { path }])) };
  for (const [key, { path, label }] of Object.entries(all)) {
    registered[key] = services.installations.register({ path, ...(label ? { label } : {}) });
    if (scan) services.libraries.rescan(registered[key].id);
  }
  return { services, registered, projectsDir, stateDir };
}

export function createProject(services, id, eeVersion) {
  const base = starterProject(id, id);
  const project = { ...base, eeVersion };
  mkdirSync(join(services.context.projectsDir, id), { recursive: true });
  writeFileSync(join(services.context.projectsDir, id, "project.json"), JSON.stringify(project, null, 2));
  return project;
}
