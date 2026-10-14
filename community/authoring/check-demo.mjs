import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const [root,pack]=process.argv.slice(2);
const {EEProjectSchema}=await import(`${root}/packages/forge-contracts/dist/index.js`);
const {buildProject,loadCatalog,simulate}=await import(`${root}/packages/forge-core/dist/index.js`);
const reports=[];let previous;
for(const year of ['2024','2026']){
 const checks=[];const pass=(name,fn)=>{fn();checks.push(name)};
 const raw=fs.readFileSync(path.join(pack,'projects',year,'lantern_route','project.json'),'utf8');const p=EEProjectSchema.parse(JSON.parse(raw));
 pass('Schema 5; exactly one shared player; two sectors',()=>{assert.equal(p.schemaVersion,5);assert.equal(p.map.sectors.length,2);assert.equal(p.map.groups.flatMap(g=>g.objects).filter(o=>o.type==='PlayerSpaceship').length,1);assert.equal(p.map.groups.find(g=>g.id==='crew').sector,null)});
 pass('Station conversations attached',()=>{assert.equal(p.map.groups.find(g=>g.id==='home').objects[0].dialogueId,'port_comms');assert.equal(p.map.groups.find(g=>g.id==='relay').objects[0].dialogueId,'relay_comms')});
 const library=JSON.parse(fs.readFileSync(path.join(root,year==='2024'?'projects/libraries/EE-2024.12.08.json':'projects/ee-library.json'),'utf8'));
 const build=buildProject(loadCatalog(p.eeVersion),p,{sourceHash:crypto.createHash('sha256').update(raw).digest('hex'),library,mode:'vanilla'});
 pass('Rebuild: zero warnings, three byte-identical portable Lua files',()=>{assert.equal(build.warnings.length,0);assert.equal(build.files.length,3);for(const f of build.files){assert.equal(f.install,'scripts');assert.equal(f.contents,fs.readFileSync(path.join(pack,'play',year,'scripts',f.name),'utf8'));assert.doesNotMatch(f.contents,/exodus|\/home\/ricca|C:\\/i)}});
 pass('No EXODUS, custom templates or models',()=>{assert.equal(p.requires.length+p.models.length+p.templates.length+p.logic.exodusSteps.length,0)});
 pass('Idle at home does not win or spawn raiders',()=>{const r=simulate(p,{untilSeconds:180});assert.equal(r.endedWith,null);assert.ok(!r.spawnedGroups.includes('raiders'))});
 for(const id of ['port','player'])pass(`Simulation: ${id} destruction causes defeat`,()=>{const r=simulate(p,{untilSeconds:5,events:[{at:1,kind:'destroy_object',objectId:id}]});assert.equal(r.endedWith,'Kraylor')});
 pass('Simulation: relay destruction in Echo causes defeat',()=>{const q=structuredClone(p);q.map.startSector='echo';assert.equal(simulate(q,{untilSeconds:5,events:[{at:1,kind:'destroy_object',objectId:'relay_station'}]}).endedWith,'Kraylor')});
 pass('Simulation: delivery action sets the flag that triggers victory',()=>{const q=structuredClone(p);const a=q.logic.dialogues[0].nodes[0].replies[2].actions;q.logic.beats.push({id:'test_delivery',label:'Test fixture: delivery actions',at:3,sector:null,actions:a});assert.equal(simulate(q,{untilSeconds:5}).endedWith,'Human Navy')});
 pass('Delivery is gated on archive; download gated on combat and not repeated',()=>{assert.deepEqual(p.logic.dialogues[0].nodes[0].replies[2].conditions,[{kind:'variable_equals',name:'archive',value:1},{kind:'variable_equals',name:'delivered',value:0}]);assert.deepEqual(p.logic.dialogues[1].nodes[0].replies[0].conditions,[{kind:'variable_equals',name:'raiders_cleared',value:1},{kind:'variable_equals',name:'archive',value:0}])});
 pass('Simulation: round trip preserves kills and does not cause false victory',()=>{const q=structuredClone(p);q.logic.beats.push({id:'test_out',label:'Test transit',at:3,sector:null,actions:[q.logic.dialogues[0].nodes[0].replies[1].actions[1]]},{id:'test_home',label:'Test return',at:8,sector:null,actions:q.logic.dialogues[1].nodes[0].replies[2].actions},{id:'test_revisit',label:'Test revisit',at:12,sector:null,actions:[q.logic.dialogues[0].nodes[0].replies[1].actions[1]]});q.logic.beats.sort((a,b)=>a.at-b.at);const r=simulate(q,{untilSeconds:15,events:[{at:5,kind:'destroy_group',groupId:'raiders'}]});assert.equal(r.endedWith,null);assert.equal(r.sector,'echo');assert.equal(r.firings.filter(f=>f.id==='clear_raiders').length,1);assert.ok(!r.aliveObjects.includes('raider_1'));assert.equal(r.variables.raiders_cleared,1)});
 const portable={...p,eeVersion:'TARGET'};if(previous)pass('Target variants differ only in eeVersion',()=>assert.deepEqual(portable,previous));previous=portable;
 reports.push({target:p.eeVersion,checks});
}
fs.writeFileSync(path.join(pack,'verification','offline-checks.json'),JSON.stringify(reports,null,2)+'\n');console.log(reports.map(r=>`${r.target}: ${r.checks.length} checks passed`).join('\n'));
