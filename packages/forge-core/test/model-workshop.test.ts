import { describe, it, expect } from "vitest";
import { EEModelDefSchema, EEProjectSchema, emptyEEProject } from "@forge/contracts";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readModelDefinitions } from "../src/scan/model-definitions.js";
import { modelResourceReader, packResourceRanges } from "../src/scan/model-resources.js";
import { mirrorInstallAssets } from "../src/scan/assets.js";
import { buildProject, type BuildFile } from "../src/codegen/build.js";
import { loadCatalog } from "../src/catalog/load.js";
import { buildFileBytes, installFilePath, modelResourceFiles } from "../src/model-assets.js";
import { installBuild, previewInstall } from "../src/install.js";
import { manualInstallNotes } from "../src/install-notes.js";
const source = `model=ModelData():setName("probe"):setMesh("probe.obj"):setTexture("probe.png")
model:setScale(2.5):setRadius(77):setCollisionBox(60,30):setRenderOffset(1,-2,3)
model:addEngineEmitter(-9,2,1,0.25,0.6,1,3):addBeamPosition(4,5,6):addTubePosition(7,8,9)
other=ModelData():setName("second"):setMesh("other.obj")
model:addEngineEmitor(-8,-2,1,1,0,0,2)`;
const model = () => readModelDefinitions(source).get("probe")!.definition;
function project(target = "EE-2026.09.22PR") {
  return EEProjectSchema.parse({ ...emptyEEProject("models", "Models"), eeVersion: target, models: [model()] });
}
function pack(name: string, value: Buffer): Buffer {
  const offset = 8 + 1 + Buffer.byteLength(name) + 8;
  const b = Buffer.alloc(offset + value.length); b.writeUInt32BE(0,0); b.writeUInt32BE(1,4); b[8]=Buffer.byteLength(name); b.write(name,9); b.writeUInt32BE(offset,9+name.length); b.writeUInt32BE(value.length,13+name.length); value.copy(b,offset); return b;
}
describe("editable ModelData", () => {
  it("scans complete definitions and aliases without mixing reassigned variables", () => {
    const parsed = readModelDefinitions(source);
    expect(parsed.get("probe")!.warnings).toEqual([]);
    expect(model()).toMatchObject({ scale:2.5,radius:77,collisionBox:[60,30],renderOffset:[1,-2,3],beamPositions:[[4,5,6]],tubePositions:[[7,8,9]] });
    expect(model().engineEmitters).toHaveLength(2);
    expect(model().engineEmitters[0]!.color).toEqual([.25,.6,1]);
    expect(parsed.get("second")!.definition.engineEmitters).toEqual([]);
    expect(EEModelDefSchema.parse(model())).toEqual(model());
  });
  it("reports expressions instead of pretending to have copied their values", () => {
    const parsed = readModelDefinitions('m=ModelData():setName("x"):setMesh("x.obj"):setScale(size*2)');
    expect(parsed.get("x")!.warnings.join()).toContain("setScale");
  });
  for (const target of ["EE-2024.12.08", "EE-2026.09.22PR"]) it(`emits all model geometry for ${target}`, () => {
    const built = buildProject(loadCatalog(target), project(target), {sourceHash:"test"});
    const lua = built.files.find(f => f.install === "shiptemplates")!.contents;
    for (const text of [':setScale(2.5)',':setRadius(77)',':setCollisionBox(60, 30)',':setRenderOffset(1, -2, 3)',':addEngineEmitter(-9, 2, 1, 0.25, 0.6, 1, 3)',':addBeamPosition(4, 5, 6)',':addTubePosition(7, 8, 9)']) expect(lua).toContain(text);
  });
  it("rejects a 2026 normal map on 2024 instead of silently dropping it", () => {
    const p=project("EE-2024.12.08"); p.models[0]!.normalMap="normal.png";
    expect(() => buildProject(loadCatalog(p.eeVersion),p,{sourceHash:"test"})).toThrow(/setNormalMap/);
  });
  it("keeps portable bytes through project parsing and rejects conflicting or missing resources", () => {
    const p=project(); const bytes=Buffer.from([0,255,128,13,10]);
    p.models[0]!.resources=[{path:"forge-models/test/mesh.obj",base64:bytes.toString("base64")}]; p.models[0]!.mesh="forge-models/test/mesh.obj";
    const restored=EEProjectSchema.parse(JSON.parse(JSON.stringify(p)));
    expect(buildFileBytes(modelResourceFiles(restored)[0]!)).toEqual(bytes);
    const missing=structuredClone(p); missing.models[0]!.texture="forge-models/test/missing.png";
    expect(()=>modelResourceFiles(missing)).toThrow(/Missing imported/);
    p.models.push({...model(),id:"different",name:"Different",resources:[{path:"forge-models/test/mesh.obj",base64:"YQ=="}]});
    expect(()=>modelResourceFiles(p)).toThrow(/Conflicting/);
    expect(()=>installFilePath('/tmp/ee',{name:'../../outside.obj',install:'resources'})).toThrow(/Unsafe/);
  });
});
describe("resource install and mirror", () => {
  it("writes binary assets, detects collisions, and rolls bytes back after a partial failure", () => {
    const root=mkdtempSync(join(tmpdir(),'model-install-'));
    try {
      mkdirSync(join(root,'scripts')); writeFileSync(join(root,'scripts','shipTemplates.lua'),'-- originals\n');
      const binary:BuildFile={name:'forge-models/test/texture.png',install:'resources',encoding:'base64',contents:Buffer.from([0,255,128,13,10]).toString('base64')};
      const initial=installBuild(root,[binary],f=>f.contents);
      expect(initial.ok).toBe(true); expect(initial.needsRestart).toBe(true);
      expect(readFileSync(installFilePath(root,binary))).toEqual(buildFileBytes(binary));
      expect(previewInstall(root,[binary],f=>f.contents).files[0]!.action).toBe('unchanged');
      const changed={...binary,contents:Buffer.from([4,5,6]).toString('base64')};
      const failed=installBuild(root,[changed,{name:'scenario_test.lua',install:'scripts',contents:'x'}],f=>f.contents,{writeFile:(path,contents)=>{if(path.endsWith('scenario_test.lua'))throw new Error('injected failure');writeFileSync(path,contents);}});
      expect(failed.status).toBe('rolled-back'); expect(readFileSync(installFilePath(root,binary))).toEqual(buildFileBytes(binary));
      expect(existsSync(join(root,'scripts','scenario_test.lua'))).toBe(false);
      writeFileSync(installFilePath(root,binary),'foreign');
      expect(previewInstall(root,[binary],f=>f.contents).clear).toBe(false);
      expect(installBuild(root,[binary],f=>f.contents).status).toBe('refused');
      expect(manualInstallNotes({projectId:'test',target:'2024',files:[binary,{name:'test_templates.lua',install:'shiptemplates'}]})).toContain('resources/');
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("reads packed resources by range and reports a vanished resource as missing, with no cache to go stale", () => {
    const root=mkdtempSync(join(tmpdir(),'model-mirror-'));
    try {
      mkdirSync(join(root,'scripts'));mkdirSync(join(root,'packs'));
      const packed=pack('x.obj',Buffer.from('mesh'));
      writeFileSync(join(root,'packs','test.pack'),packed);
      expect(packResourceRanges(packed).get('x.obj')!.length).toBe(4);
      const reader=modelResourceReader(root);
      const found=reader.resolve('x.obj');
      expect(found).toMatchObject({state:'ok',origin:{kind:'pack',pack:'packs/test.pack',length:4}});
      expect(reader.read(found).toString()).toBe('mesh');
      rmSync(join(root,'packs','test.pack'));
      expect(modelResourceReader(root).resolve('x.obj').state).toBe('missing');
      writeFileSync(join(root,'packs','test.pack'),packed.subarray(0,packed.length-1));
      expect(modelResourceReader(root).resolve('x.obj').state).toBe('archive-unreadable');
      expect(()=>packResourceRanges(packed.subarray(0,packed.length-1))).toThrow(/bounds/);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("follows EmptyEpsilon precedence, refuses unsafe names and flags unsupported formats", () => {
    const root=mkdtempSync(join(tmpdir(),'model-order-'));
    try {
      mkdirSync(join(root,'packs'));mkdirSync(join(root,'resources','mesh'),{recursive:true});
      writeFileSync(join(root,'resources','mesh','a.obj'),'loose');
      writeFileSync(join(root,'packs','a.pack'),pack('mesh/a.obj',Buffer.from('packed')));
      writeFileSync(join(root,'packs','b.pack'),pack('only.tga',Buffer.from('tga')));
      const reader=modelResourceReader(root);
      const a=reader.resolve('mesh/a.obj');
      expect(a.origin).toEqual({kind:'file',file:'resources/mesh/a.obj'});
      expect(a.detail).toContain('Also present in packs/a.pack');
      expect(reader.read(a).toString()).toBe('loose');
      expect(reader.resolve('only.tga').state).toBe('unsupported-format');
      for(const bad of ['../x.obj','/etc/passwd','a\\b.obj','','C:/x.png','a//b.png']) expect(reader.resolve(bad).state).toBe('refused');
      expect(reader.hash('mesh/a.obj')).toMatch(/^[0-9a-f]{64}$/);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
  it("does not copy stock resources into the cache and removes the old copy on rescan", () => {
    const root=mkdtempSync(join(tmpdir(),'model-nocopy-'));const assets=join(root,'assets');
    try {
      mkdirSync(join(root,'resources'),{recursive:true});writeFileSync(join(root,'resources','x.obj'),'mesh');
      mkdirSync(join(assets,'model-resources'),{recursive:true});writeFileSync(join(assets,'model-resources','x.obj'),'old');
      mirrorInstallAssets(root,assets);
      expect(existsSync(join(assets,'model-resources'))).toBe(false);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
});

it("enumerates colour and numeric model families without executing Lua", () => {
  const definitions=readModelDefinitions(`for idx, color in ipairs({"Red", "Blue"}) do
    model=ModelData():setName("ship_"..color):setMesh("hull.obj"):setTexture("skin_"..color..".png")
  end
  for kind=1,2 do
    for count=1,3 do
      model=ModelData():setName("transport_"..kind.."_"..count):setMesh("ship.obj"):setRadius(100+count*50)
    end
  end`);
  expect(definitions.size).toBe(8);
  expect(definitions.get("ship_Blue")!.definition.texture).toBe("skin_Blue.png");
  expect(definitions.get("transport_2_3")!.definition.radius).toBe(250);
});
