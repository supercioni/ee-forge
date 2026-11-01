import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {emptyEEProject,EEProjectSchema} from '../../../packages/forge-contracts/dist/index.js';
import {createObject} from '../../../packages/forge-core/dist/editor/factories.js';
import {buildProject,loadCatalog,installBuild,scanInstall} from '../../../packages/forge-core/dist/index.js';
const saved=JSON.parse(readFileSync(new URL('./model-fixture-project.json', import.meta.url)));
const report=[];
for(const [version,clone] of [['EE-2024.12.08','e24'],['EE-2026.09.22PR','e26']]) {
 const p=emptyEEProject('model_workshop_trial','Model Workshop Trial');p.eeVersion=version;
 p.models=saved.models.filter(m=>m.name==='model_trial_model_2');
 const stock=scanInstall({eeInstall:'/mnt/c/ForgeCollaudo/T/'+clone,eeVersion:version}).templates.find(t=>t.name==='Atlantis');
 p.templates=[{...stock,id:'model_ship',name:'Model Workshop Ship',kind:'playership',copyOf:null,model:p.models[0].name}];
 const player={...createObject('PlayerSpaceship','player',{x:0,y:0},{template:'Model Workshop Ship',callsign:'MODEL-TRIAL'}),rotation:0};
 p.map.groups=[{id:'start',label:'Model test',when:'on_start',sector:null,objects:[player]}];
 const project=EEProjectSchema.parse(p);
 const built=buildProject(loadCatalog(version),project,{sourceHash:createHash('sha256').update(JSON.stringify(p)).digest('hex')});
 const root='/mnt/c/ForgeCollaudo/T/'+clone;
 const installed=installBuild(root,built.files,f=>f.contents,{patchShipTemplates:true});
 if(!installed.ok)throw new Error(JSON.stringify(installed));
 report.push({version,clone,files:built.files.map(f=>({name:f.name,install:f.install})),installed});
 mkdirSync('/tmp/forge-model-trial/engine',{recursive:true});writeFileSync('/tmp/forge-model-trial/engine/'+clone+'-project.json',JSON.stringify(project,null,2));
}
writeFileSync('/tmp/forge-model-trial/engine/install.json',JSON.stringify(report,null,2));console.log(report.map(r=>({version:r.version,status:r.installed.status,files:r.files.length,restart:r.installed.needsRestart})));
