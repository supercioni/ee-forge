import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [root,out]=process.argv.slice(2);
const {emptyEEProject,EEProjectSchema}=await import(`${root}/packages/forge-contracts/dist/index.js`);
const {createObject,createMarker}=await import(`${root}/packages/forge-core/dist/editor/index.js`);
const {loadCatalog,buildProject,simulate}=await import(`${root}/packages/forge-core/dist/index.js`);
const p=emptyEEProject('lantern_route','The Lantern Route');
p.description='Recover the Echo Reach navigation archive. Hail PORT LANTERN, travel through its corridor, defeat two raiders, download the archive from ECHO RELAY and bring it home. One Atlantis crew; no GM or external service required. Choose Campaign = New for a fresh run.';
p.campaign.persistence=true;
p.map.sectors=[{id:'lantern',label:'Lantern Anchorage'},{id:'echo',label:'Echo Reach'}];p.map.startSector='lantern';
p.map.markers=[createMarker('lantern_arrival','Lantern arrival',{x:0,y:0},'lantern'),createMarker('echo_arrival','Echo arrival',{x:0,y:0},'echo')];
const obj=(type,id,x,y,options={},extra={})=>Object.assign(createObject(type,id,{x,y},options),extra);
const player=obj('PlayerSpaceship','player',0,0,{callsign:'LANTERN-1',faction:'Human Navy',template:'Atlantis'},{rotation:0,description:'Your ship. Relay handles mission progress through station comms.'});
const port=obj('SpaceStation','port',-2200,1500,{callsign:'PORT LANTERN',faction:'Human Navy',template:'Small Station'},{dialogueId:'port_comms'});
const relay=obj('SpaceStation','relay_station',-2200,1500,{callsign:'ECHO RELAY',faction:'Human Navy',template:'Small Station'},{dialogueId:'relay_comms'});
const group=(id,label,sector,objects,when='on_start')=>({id,label,sector,objects,when});
p.map.groups=[group('crew','Shared / player ship',null,[player]),group('home','Lantern / port','lantern',[port]),group('home_scenery','Lantern / asteroid field','lantern',[
obj('Asteroid','a1',-5000,-3500,{}, {size:110}),obj('Asteroid','a2',-5500,-4000,{}, {size:160}),obj('Asteroid','a3',-4300,-4300,{}, {size:85}),obj('Nebula','home_nebula',-14000,10000)]),
group('relay','Echo / archive relay','echo',[relay]),group('echo_scenery','Echo / navigation hazards','echo',[obj('Asteroid','e1',-4500,-4500,{}, {size:180}),obj('Asteroid','e2',-5300,-3800,{}, {size:95}),obj('Nebula','echo_nebula',10000,12000)]),
group('raiders','Echo / raiders on demand','echo',[obj('CpuShip','raider_1',900,-250,{callsign:'RAIDER-1',faction:'Kraylor',template:'MT52 Hornet'},{rotation:180,order:{kind:'idle'}}),obj('CpuShip','raider_2',1300,300,{callsign:'RAIDER-2',faction:'Kraylor',template:'MT52 Hornet'},{rotation:180,order:{kind:'idle'}})],'on_call')];
const log=text=>({kind:'ship_log',text,color:'white'}),msg=text=>({kind:'global_message',text,timeoutS:10}),set=(name,value)=>({kind:'set_variable',name,value}),eq=(name,value)=>({kind:'variable_equals',name,value}),jump=sectorId=>({kind:'change_sector',sectorId,arrivalMarkerId:sectorId+'_arrival',rotation:0});
const rule=(id,label,when,actions,sector=null)=>({id,label,when,conditions:[],once:true,sector,actions});
p.logic.variables=['briefed','raiders_cleared','archive','delivered'].map(name=>({name,initial:0}));
p.logic.beats=[{id:'welcome',label:'Opening briefing',at:2,sector:null,actions:[log('THE LANTERN ROUTE: Relay, hail PORT LANTERN for orders. Use station comms to travel. Protect both stations and your ship.'),msg('Relay: hail PORT LANTERN for orders.')]},{id:'echo_reminder',label:'Echo local reminder (clock freezes away)',at:90,sector:'echo',actions:[log('ECHO RELAY: Clear both raiders, then hail us and choose Download the archive. Return transit remains available if you need to regroup.')]}];
p.logic.rules=[rule('enter_echo','First visit: spawn the raiders',{kind:'current_sector',sectorId:'echo'},[{kind:'spawn_group',groupId:'raiders'},{kind:'order_stand_ground',target:{ref:'group',groupId:'raiders'}},log('Two Kraylor raiders guard the approach. Raise shields and engage. Protect ECHO RELAY.'),msg('Two raiders guard the relay. Protect ECHO RELAY.')]),rule('clear_raiders','Combat complete: unlock archive',{kind:'group_destroyed',groupId:'raiders'},[set('raiders_cleared',1),log('Raiders cleared. Relay: hail ECHO RELAY and choose Download the archive.'),msg('Raiders cleared. Download the archive from ECHO RELAY.')]),rule('win','Archive delivered: Human Navy victory',eq('delivered',1),[log('Archive delivered. The Lantern Route is secure. Mission complete.'),msg('Archive delivered. Mission complete.'),{kind:'victory',faction:'Human Navy'}]),...['port','relay_station','player'].map(id=>rule('lose_'+id,'Mission failure: '+id,{kind:'object_destroyed',objectId:id},[msg('A protected ship or station has been destroyed. Mission failed.'),{kind:'victory',faction:'Kraylor'}]))];
const reply=(text,nodeId,actions=[],conditions=[])=>({text,target:{kind:'node',nodeId},actions,conditions});
const services={text:'Station services (repairs / supplies)',target:{kind:'services'},actions:[],conditions:[]};
const node=(id,text,replies=[])=>({id,text,replies});
p.logic.dialogues=[{id:'port_comms',label:'PORT LANTERN mission control',entry:'welcome',nodes:[
node('welcome','PORT LANTERN: The Echo Reach archive has stopped updating. Read your orders, open the corridor, clear the raiders, recover the archive and deliver it here.',[reply('Read mission orders','orders',[set('briefed',1)]),reply('Open corridor to Echo Reach','depart',[log('Transit to Echo Reach authorised.'),jump('echo')],[eq('briefed',1)]),reply('Deliver the recovered archive','complete',[set('delivered',1)],[eq('archive',1),eq('delivered',0)]),services]),
node('orders','Your Atlantis is LANTERN-1. In Echo Reach, two Kraylor Hornets guard the relay. Destroy both, hail ECHO RELAY to download its archive, return here and deliver it. Protect both stations. You may return early to regroup.',[reply('Back to mission control','welcome')]),
node('depart','Corridor engaged. Close this comms window. You are now in Echo Reach: defend against the raiders, then hail ECHO RELAY.'),node('complete','Archive accepted. Thank you, LANTERN-1. The route is open again.')]},
{id:'relay_comms',label:'ECHO RELAY archive control',entry:'welcome',nodes:[node('welcome','ECHO RELAY: We can transmit the archive once both Kraylor raiders are destroyed. Return transit is available at any time. After a transit, close comms and hail the destination station.',[reply('Download the archive','download',[set('archive',1),log('Archive aboard. Return to PORT LANTERN and choose Deliver the recovered archive.'),{kind:'save_checkpoint'}],[eq('raiders_cleared',1),eq('archive',0)]),reply('Archive already aboard: check next step','aboard',[],[eq('archive',1)]),reply('Return to Lantern Anchorage','depart',[jump('lantern')]),services]),node('download','Transfer complete. Request return transit, then hail PORT LANTERN and deliver the archive.',[reply('Return to Lantern Anchorage','depart',[jump('lantern')])]),node('aboard','You have the archive. Return to PORT LANTERN and choose Deliver the recovered archive.',[reply('Back','welcome')]),node('depart','Return corridor engaged. Close this comms window and hail PORT LANTERN.')]}];
const report=[];
for(const [year,target,libfile] of [['2024','EE-2024.12.08','projects/libraries/EE-2024.12.08.json'],['2026','EE-2026.09.22PR','projects/ee-library.json']]){
 const project=EEProjectSchema.parse({...p,eeVersion:target});const source=JSON.stringify(project,null,2)+'\n';const hash=crypto.createHash('sha256').update(source).digest('hex');
 const library=JSON.parse(fs.readFileSync(path.join(root,libfile),'utf8'));
 const result=buildProject(loadCatalog(target),project,{sourceHash:hash,library,mode:'vanilla'});
 if(result.warnings.length)throw Error(JSON.stringify(result.warnings));
 const dir=path.join(out,'projects',year,p.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'project.json'),source);
 const play=path.join(out,'play',year,'scripts');fs.mkdirSync(play,{recursive:true});
 for(const f of result.files){if(f.install!=='scripts'||/exodus|\/home\/ricca|C:\\/i.test(f.contents))throw Error('Nonportable bundle');fs.writeFileSync(path.join(play,f.name),f.contents);}
 const checks=[];const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
 check('Three portable Lua files, zero warnings',result.files.length===3);
 check('No extensions or custom assets',!project.requires.length&&!project.models.length&&!project.templates.length);
 const idle=simulate(project,{untilSeconds:120});check('No premature victory or raiders at home',idle.endedWith===null&&!idle.spawnedGroups.includes('raiders'));
 for(const objectId of ['port','player']){const r=simulate(project,{untilSeconds:5,events:[{at:1,kind:'destroy_object',objectId}]});check('Defeat when '+objectId+' destroyed',r.endedWith==='Kraylor');}
 report.push({target,sourceSha256:hash,warnings:result.warnings,checks,files:result.files.map(f=>({name:f.name,sha256:crypto.createHash('sha256').update(f.contents).digest('hex')}))});
}
fs.mkdirSync(path.join(out,'verification'),{recursive:true});fs.writeFileSync(path.join(out,'verification','build-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
