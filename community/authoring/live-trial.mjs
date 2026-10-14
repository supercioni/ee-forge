import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const [year,port,out]=process.argv.slice(2);const checks=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
const pre=`local p=getPlayerShip(-1); local function find(n) for _,o in pairs(getAllObjects()) do if o and o:isValid() and o:getCallSign()==n then return o end end end; `;
async function lua(s){const r=await fetch(`http://windows.host:${port}/exec.lua`,{method:'POST',body:pre+'local function run() '+s+' end; local v=run(); if type(v)=="boolean" then return v and "__BOOL_TRUE__" or "__BOOL_FALSE__" else return v end',signal:AbortSignal.timeout(8000)});const t=await r.text();if(!r.ok)throw Error(t);let v=t;try{v=JSON.parse(t)}catch{}if(v==='__BOOL_TRUE__')return true;if(v==='__BOOL_FALSE__')return false;return v}
const cmd=(n,args='')=>year==='2024'?`p:${n}(${args})`:`${n}(p${args?','+args:''})`;
async function waitFor(name,s,limit=20){for(let i=0;i<limit;i++){try{if(await lua(s)){checks.push({name,passed:true});console.log('PASS '+name);return}}catch{}await delay(1000)}throw Error(name);}
async function hail(name){await lua(cmd('commandCloseTextComm'));await lua(cmd('commandOpenTextComm',`find(${JSON.stringify(name)})`));for(let i=0;i<20;i++){if(await lua('return p:isCommsScriptOpen()'))return;await delay(500)}throw Error('Comms did not open');}
async function reply(i){await lua(cmd('commandSendComm',String(i)));await delay(1500);}
function launch(){execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','C:\\ForgeCommunityTrial\\launch.ps1',year,port]);}
try{
await waitFor('Initial ship and home station',`return p~=nil and find('PORT LANTERN')~=nil and find('ECHO RELAY')==nil`);
await hail('PORT LANTERN');await reply(0);await reply(0);await reply(1);
await waitFor('Dialogue opens Echo sector and spawns two raiders',`return find('ECHO RELAY')~=nil and find('PORT LANTERN')==nil and find('RAIDER-1')~=nil and find('RAIDER-2')~=nil`);
await lua(cmd('commandCloseTextComm')+';'+cmd('commandSetShields','true'));
for(const name of ['RAIDER-1','RAIDER-2']){
 for(let i=0;i<100;i++){
  const data=await lua(`local t=find('${name}'); if not t then return 'dead' end; local x,y=p:getPosition(); local tx,ty=t:getPosition(); return tostring(tx-x)..','..tostring(ty-y)..','..tostring(t:getHull())`);
  if(data==='dead')break;const [dx,dy]=String(data).split(',').map(Number);const angle=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
  await lua(`local t=find('${name}'); if t then ${cmd('commandSetTarget','t')}; ${cmd('commandTargetRotation',String(angle))}; ${cmd('commandImpulse',Math.hypot(dx,dy)>1050?'0.7':'0')}; end`);
  if(i%25===0)await lua(cmd('commandLoadTube',`0,'Homing'`)+';'+cmd('commandLoadTube',`1,'Homing'`));
  if(i%25===13)await lua(`local t=find('${name}'); if t then ${cmd('commandFireTubeAtTarget','0,t')};${cmd('commandFireTubeAtTarget','1,t')};end`);
  await delay(1000);
 }
 await waitFor(name+' destroyed by native weapons',`return find('${name}')==nil`,2);
}
await lua(cmd('commandImpulse','0'));
await hail('ECHO RELAY');await reply(0);
const storePath=`/mnt/c/ForgeCommunityTrial/${year}/scriptstorage.json`;
const save=fs.readFileSync(storePath,'utf8');if(!save.includes('lantern_route'))throw Error('No disk checkpoint');checks.push({name:'Checkpoint exists in actual disk file',passed:true});
await reply(0);await waitFor('Return corridor restores home without false victory',`return find('PORT LANTERN')~=nil and find('ECHO RELAY')==nil and p:getHull()>0`);
// Prove revisit retains destroyed enemies, then return home again.
await hail('PORT LANTERN');await reply(1);await waitFor('Revisit: dead raiders stay dead',`return find('ECHO RELAY')~=nil and find('RAIDER-1')==nil and find('RAIDER-2')==nil`);
await hail('ECHO RELAY');await reply(1);await waitFor('Second return home',`return find('PORT LANTERN')~=nil`);
// Graceful process stop is limited to this private clone; checkpoint already written by transit.
execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id (Get-Content 'C:\\ForgeCommunityTrial\\${year}\\trial-pid.txt'); if ($p.Path -ne 'C:\\ForgeCommunityTrial\\${year}\\EmptyEpsilon.exe') {throw 'Unexpected process'}; Stop-Process -Id $p.Id`]);
await delay(2500);launch();await waitFor('Actual process restart resumes at home',`return p~=nil and find('PORT LANTERN')~=nil`,30);
await hail('PORT LANTERN');await reply(2);
const t=await lua('return getScenarioTime()');await delay(2500);const t2=await lua('return getScenarioTime()');if(t!==t2)throw Error('Delivery did not end scenario');checks.push({name:'Persisted archive delivered through comms; scenario ends',passed:true});
console.log('PASS mission complete');
}catch(e){checks.push({name:'trial failure',passed:false,error:String(e)});process.exitCode=1;}
finally{fs.mkdirSync(out,{recursive:true});fs.writeFileSync(`${out}/live-${year}.json`,JSON.stringify({year,method:'Native comms, helm and weapons commands through HTTP on an isolated headless engine. No forced kills, flags or victory callbacks. Restart by stopping only the clone process.',checks},null,2)+'\n');}
