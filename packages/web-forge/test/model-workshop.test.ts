import { describe, it, expect } from 'vitest';
import { emptyEEProject, EEModelDefSchema } from '@forge/contracts';
import { createTemplate } from '@forge/core/editor';
import { attachModel, replaceModel, effectiveModelName, commitModelEdit } from '../src/store/model-editing.js';
import { useEditor } from '../src/store/editor.js';
import { normaliseObj, readObjNative, readNativeModel } from '../src/panels/model-geometry.js';
import { Mesh } from 'three';
const model=()=>EEModelDefSchema.parse({id:'stock',name:'Stock',mesh:'ship.obj',texture:null,specular:null,illumination:null,scale:1,radius:10,renderOffset:null,collisionBox:null,engineEmitters:[{position:[-4,2,1],color:[.2,.5,1],scale:2}],beamPositions:[],tubePositions:[]});
describe('model workshop document changes',()=>{
 it('copies the complete model, assigns only the chosen template, and preserves the source',()=>{
  const p=emptyEEProject('test','Test');const t=createTemplate('ship','Ship'); p.templates=[t,{...t,id:'other',name:'Other'}];
  const original=model();const next=attachModel(p,t.id,original);
  expect(next.models[0]!.name).not.toBe(original.name); expect(next.templates[1]!.model).toBe(p.templates[1]!.model);
  expect(next.models[0]!.engineEmitters[0]!.color).toEqual([.2,.5,1]);
  expect(p.models).toHaveLength(0);expect(original.name).toBe('Stock');
  const again=attachModel(next,t.id,original);expect(again.models[0]!.name).not.toBe(again.models[1]!.name);
 });
 it('renames model references atomically, handles inherited models and refuses duplicate names',()=>{
  const p=emptyEEProject('test','Test');p.templates=[createTemplate('ship','Ship')];
  const copied=attachModel(p,'ship',model());const m=copied.models[0]!;
  copied.templates.push({...copied.templates[0]!,id:'variant',name:'Variant',copyOf:'Ship',model:null});
  const changed=replaceModel(copied,m.id,{name:'Custom',scale:2});
  expect(effectiveModelName(changed.templates[1]!,changed)).toBe('Custom');
  expect(changed.models[0]!.scale).toBe(2);
  expect(()=>replaceModel({...changed,models:[...changed.models,{...m,id:'taken',name:'Taken'}]},m.id,{name:'Taken'})).toThrow(/Another/);
 });
 it('refuses an async import after changing projects and marks successful edits dirty',()=>{
  const p=emptyEEProject('test','Test');p.templates=[createTemplate('ship','Ship')];useEditor.setState({project:p,dirty:false});
  expect(()=>commitModelEdit('old',x=>x)).toThrow(/Project changed/);expect(useEditor.getState().dirty).toBe(false);
  commitModelEdit('test',x=>attachModel(x,'ship',model()));expect(useEditor.getState().dirty).toBe(true);
 });
});
describe('mesh formats',()=>{
 it('triangulates OBJ and supplies positive v/vt/vn indices, then matches the EE Y/Z and V transforms',()=>{
  const input='v 1 2 3\nv 4 5 6\nv 7 8 9\nvt .2 .3\nvt .4 .5\nvt .6 .7\nf -3/-3 -2/-2 -1/-1';
  const canonical=normaliseObj(input);expect(canonical).toContain('f 1/1/1 2/2/2 3/3/3');
  const mesh=readObjNative(canonical).children[0] as Mesh;
  const p=mesh.geometry.getAttribute('position'),uv=mesh.geometry.getAttribute('uv');
  expect([p.getX(0),p.getY(0),p.getZ(0)]).toEqual([1,3,2]);expect(uv.getY(0)).toBeCloseTo(.7);
  expect(()=>normaliseObj('# empty')).toThrow(/triangles/);
 });
 it('reads binary EE vertices without swapping them twice and rejects truncated files',()=>{
  const b=new ArrayBuffer(4+3*32),v=new DataView(b);v.setUint32(0,3,false);
  for(let i=0;i<3;i++)for(let j=0;j<8;j++)v.setFloat32(4+i*32+j*4,j+1,true);
  const g=readNativeModel(b);expect(g.getAttribute('position').getY(0)).toBe(2);
  expect(()=>readNativeModel(b.slice(0,-1))).toThrow(/count/);
 });
});
