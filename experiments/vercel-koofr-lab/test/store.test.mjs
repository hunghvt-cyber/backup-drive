import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NoteStore,noteId,fixtureNote,pool} from '../lib/store.mjs';
import {exportStore,initRestore,restoreBatch} from '../lib/store-backup.mjs';
import {storeFixture} from '../lib/store-fixtures.mjs';
import {createDav} from '../lib/storage.mjs';
import {backend} from './helpers/collection.mjs';

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

test('failed batch waits for in-flight workers before collection unlock cleanup',async()=>{
 let completed=false;await assert.rejects(pool([0,1],async n=>{if(n===0)throw Error('fixture failure');await new Promise(r=>setTimeout(r,10));completed=true;}));assert.equal(completed,true);
});

test('each store session binds all inherited-lock requests to its own single-socket agent',async()=>{
 const b=backend(),i=input(),seen=new Set(),s=new NoteStore(i,{makeDav:b.makeDav,wire:(url,opts,ctx)=>{seen.add(ctx.connectionAgent);assert.equal(ctx.connectionAgent.maxSockets,1);return b.wire(url,opts,ctx);}});await s.init();await s.seedBatch(0,2);assert.equal(seen.size,1);assert.notEqual(s.agent,new NoteStore(i).agent);
});

test('incomplete restore blocks normal owner mutations; late chunk retry cannot overwrite newer edits',async()=>{
 const b=backend(),i=input(),s=b.makeStore(i);await s.init();await s.seedBatch(0,2);await exportStore(s);const t=b.makeStore({...i,namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()});await initRestore(t,s);
 for(const fn of [()=>t.list(),()=>t.createFolder('forbidden'),()=>t.deleteFolder('Công việc'),()=>t.share('folder','Công việc'),()=>t.remove(noteId(0),'old')])await assert.rejects(fn(),e=>e.status===503);
 await restoreBatch(t,s,0);assert.equal((await restoreBatch(t,s,0)).replay,true);const n=await t.get(noteId(0));await t.save(0,{text:'Fresh post-restore edit'},n.revision,randomUUID());await assert.rejects(restoreBatch(t,s,0),e=>e.status===409);assert.equal((await t.get(n.id)).text,'Fresh post-restore edit');
});

test('narrow restore-guard fixture validates incomplete writes and delayed retry end to end',async()=>{const b=backend(),i=input();const r=await run(b,i,'restore-guards',{sourceNamespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()});assert.equal(r.checks.lateRestoreRetryCannotOverwriteEdit,true);});
