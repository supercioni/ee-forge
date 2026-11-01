import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyEEProject, EEModelDefSchema, ForgeExportResultSchema } from '@forge/contracts';
import { createForgeServices } from '../src/services.js';
it('exports embedded binary resources intact for both vanilla engines, with manual install instructions',()=>{
 const root=mkdtempSync(join(tmpdir(),'forge-model-export-'));
 try {
  const project=emptyEEProject('model_export','Model export');
  const bytes=Buffer.from([137,80,78,71,0,128,255,13,10]);
  project.models=[EEModelDefSchema.parse({id:'custom',name:'Custom',mesh:'forge-models/test/hull.obj',texture:'forge-models/test/hull.png',specular:null,illumination:null,scale:2,radius:25,collisionBox:null,renderOffset:null,beamPositions:[],tubePositions:[],engineEmitters:[],resources:[{path:'forge-models/test/hull.obj',base64:Buffer.from('# model\nv 1 2 3\n').toString('base64')},{path:'forge-models/test/hull.png',base64:bytes.toString('base64')}]})];
  mkdirSync(join(root,'projects',project.id),{recursive:true});writeFileSync(join(root,'projects',project.id,'project.json'),JSON.stringify(project));
  const s=createForgeServices({projectsDir:join(root,'projects'),stateDir:join(root,'state')});
  const result=ForgeExportResultSchema.parse(s.projects.exportBundle(project.id,{targets:['EE-2024.12.08','EE-2026.09.22PR'],mode:'vanilla',outRoot:join(root,'export')}));
  for(const target of result.targets){
   expect(target.ok,target.error??'').toBe(true);
   expect(readFileSync(join(target.outDir,'resources','forge-models/test/hull.png'))).toEqual(bytes);
   expect(readFileSync(target.instructionsFile!,'utf8')).toContain('resources/');
   expect(target.files.find(f=>f.name.endsWith('hull.png'))).toMatchObject({install:'resources',bytes:bytes.length});
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
