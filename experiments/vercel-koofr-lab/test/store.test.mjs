import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NoteStore,noteId,fixtureNote} from '../lib/store.mjs';
import {storeFixture} from '../lib/store-fixtures.mjs';
import {createDav} from '../lib/storage.mjs';
function backend(){
 let clock=0,tokenCounter=0;const files=new Map(),folders=new Set(),locks=new Map(),requests=[];
 function held(path){for(const [root,l] of locks){if(l.until<=clock){locks.delete(root);continue;}if(path===root||path.startsWith(root))return l;}return null;}
 async function wire(url,options,{fault,onInjected=()=>{}}={}){
  if(fault==='before-send'){onInjected({phase:fault,requestBodySubmitted:false,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  const path=new URL(url).pathname,method=options.method,l=held(path);requests.push({path,method});let r={status:500,text:''};
  if(method==='MKCOL'){r.status=folders.has(path)?405:201;folders.add(path);}
  if(method==='GET')r=files.has(path)?{status:200,text:files.get(path)}:{status:404,text:''};
  if(method==='LOCK'){if(l)r.status=423;else{const token='<fake-lock-'+(++tokenCounter)+'>',seconds=Number(options.headers.Timeout.match(/Second-(\d+)/)[1]);locks.set(path,{token,until:clock+seconds*1000});r={status:200,token,text:'<d:timeout>Second-'+seconds+'</d:timeout>'};}}
  if(method==='UNLOCK'){if(l&&l.token===options.headers['Lock-Token']){locks.delete(path);r.status=204;}else r.status=409;}
  if(method==='PUT'){if(l&&options.headers.If!=='('+l.token+')')r.status=options.headers.If?412:423;else if(!l&&options.headers.If)r.status=412;else{files.set(path,options.body);r.status=201;}}
  if(fault==='after-response-headers'){onInjected({phase:fault,observedStatus:r.status,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  return {...r,timing:{ttfbMs:0,reusedSocket:true}};
 }
 const makeDav=(input,opts={})=>createDav({...input,transport:'pooled'},{nativeRequest:wire,...opts});
 const makeStore=x=>new NoteStore(x,{makeDav,lease:x.testLease??60,beforePublish:x.testBeforePublish,wire:x.testWire,now:x.testNow});
 return {makeStore,wire,makeDav,files,requests,wait:async ms=>{clock+=ms;},locks};
}
const input=()=>({mode:'store100',transport:'pooled',user:'fake',password:'synthetic-secret',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()});
async function run(b,i,stage,extra={}){const r=await storeFixture({...i,stage,...extra},b);assert.equal(r.passed,true,JSON.stringify({stage,errors:r.errors,checks:r.checks}));return r;}
async function seeded(b,i){await run(b,i,'init');for(let chunk=0;chunk<10;chunk++)await run(b,i,'seed',{chunk});}
test('100 distinct per-note files preserve Unicode/checklist/folder/pinned fields and small catalog',async()=>{
 const b=backend(),i=input();await seeded(b,i);for(let chunk=0;chunk<10;chunk++)await run(b,i,'verify',{chunk});const s=b.makeStore(i);assert.equal((await s.list()).length,100);const cat=await s.capture();assert.ok(Buffer.byteLength(JSON.stringify(cat))<100000);assert.equal([...b.files.keys()].filter(p=>p.includes('/note-')).length,100);
});
test('owner CRUD, idempotency, history and both folder-delete policies',async()=>{const b=backend(),i=input();await seeded(b,i);await run(b,i,'owner');await run(b,i,'history');});
test('note edit/view scopes, fresh tokens and revocation precede replay authorization',async()=>{const b=backend(),i=input();await seeded(b,i);await run(b,i,'note-share');});
test('folder workspace cannot escape its scope; moves, revoke and deletion guard stay live',async()=>{const b=backend(),i=input();await seeded(b,i);await run(b,i,'folder-share');});
test('concurrent same-base root transactions have exactly one winner',async()=>{const b=backend(),i=input();await seeded(b,i);await run(b,i,'concurrency');});
test('revocation after lease expiry fences orphan writes and catalog publication',async()=>{const b=backend(),i=input();await seeded(b,i);const r=await run(b,i,'revoke-expiry');assert.equal(r.checks.orphanRevisionIgnored,true);assert.equal(b.locks.size,0);});
test('failed catalog publication never exposes orphan; exact op retry reuses immutable file despite changed clock',async()=>{
 const b=backend(),i=input();await seeded(b,i);let once=true;
 const s=b.makeStore({...i,testWire:(url,opts,ctx)=>b.wire(url,opts,{...ctx,...(ctx.label==='catalog-publish'&&once?(once=false,{fault:'before-send'}):{})}),testNow:()=> '2026-10-17T00:00:00Z'});
 const n=await s.get(noteId(0)),op=randomUUID(),patch={text:'Retry retained draft'};await assert.rejects(s.save(0,patch,n.revision,op),e=>e.status===503);
 assert.equal((await b.makeStore(i).get(n.id)).text,n.text);const originalWrites=b.requests.filter(r=>r.method==='PUT'&&r.path.includes(op)).length;
 const retried=await b.makeStore({...i,testNow:()=> '2026-10-18T00:00:00Z'}).save(0,patch,n.revision,op);assert.ok(retried.revision!==n.revision);assert.equal(b.requests.filter(r=>r.method==='PUT'&&r.path.includes(op)).length,originalWrites);assert.equal(originalWrites,1);
});
test('lost catalog response reconciles once and replay cannot advance revision',async()=>{
 const b=backend(),i=input();await seeded(b,i);let once=true;
 const s=b.makeStore({...i,testWire:(url,opts,ctx)=>b.wire(url,opts,{...ctx,...(ctx.label==='catalog-publish'&&once?(once=false,{fault:'after-response-headers'}):{})})});
 const n=await s.get(noteId(0)),op=randomUUID(),patch={text:'Lost publish reply'};const first=await s.save(0,patch,n.revision,op),second=await s.save(0,patch,n.revision,op);assert.equal(second.replay,true);assert.equal(first.revision,second.revision);
});
test('100 active Notes +4 tombstones restore with folder/history/checklist data; old links/epochs rejected; interrupted chunk resumes',async()=>{
 const b=backend(),i=input();await seeded(b,i);for(const stage of ['owner','history','note-share','folder-share','concurrency','revoke-expiry'])await run(b,i,stage);
 const exported=await run(b,i,'export'),target={...i,namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID(),sourceNamespace:i.namespace};assert.equal(exported.details.count,104);await run(b,target,'restore-init');
 for(let chunk=0;chunk<11;chunk++)await run(b,target,'restore-chunk',{chunk});const verified=await run(b,target,'restore-verify',{probe:exported.privateProbe});assert.equal(verified.details.active,100);assert.equal(verified.details.byteExact,104);assert.equal(b.locks.size,0);
});
test('record filenames are constrained to synthetic slots and immutable op UUIDs',()=>{const i=input();for(const file of ['../../notes.json','note-999-'+randomUUID()+'.json','note-001-../../secret.json'])assert.throws(()=>createDav(i,{file}));});
