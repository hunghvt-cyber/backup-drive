import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {backend} from './helpers/collection.mjs';
import {NoteStore,noteId} from '../lib/store.mjs';
import {exportStore,initRestore,restoreBatch,encodeSnapshot,loadSnapshot} from '../lib/store-backup.mjs';
function setup(){const b=backend(),input={user:'fake',password:'synthetic-secret',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()},make=(x={},wire=b.wire)=>new NoteStore({...input,...x},{makeDav:b.makeDav,wire});return {b,input,make};}
async function source(s,count){await s.init();if(count)await s.seedBatch(0,count);await exportStore(s);}
const targetInput=()=>({namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()});
test('empty restore completes at initialization; repeated init/chunk are read-only and epoch stays stable',async()=>{
 const {b,make}=setup(),s=make();await source(s,0);const t=make(targetInput()),r=await initRestore(t,s);assert.equal(r.restoring,false);assert.deepEqual(await t.list(),[]);const cat=await t.capture(),puts=b.requests.filter(x=>x.method==='PUT').length;
 assert.equal((await initRestore(t,s)).replay,true);assert.equal((await restoreBatch(t,s,0)).replay,true);assert.equal((await t.capture()).epoch,cat.epoch);assert.equal(b.requests.filter(x=>x.method==='PUT').length,puts);
});
for(const [label,phase] of [['restore-marker-write','after-response-headers'],['restore-marker-write-verify','after-response-headers'],['restore-initial-catalog-write','before-send'],['restore-initial-catalog-write','after-response-headers'],['restore-initial-catalog-write-verify','after-response-headers']])test('restore init can reconcile/resume '+label+' '+phase,async()=>{
 const {b,make}=setup(),s=make();await source(s,2);const input=targetInput();let injected=false;const t=make(input,(u,o,c)=>b.wire(u,o,{...c,...(!injected&&c.label===label?(injected=true,{fault:phase}):{})}));
 const first=await initRestore(t,s).catch(e=>e);assert.ok(injected);if(first instanceof Error)assert.equal(first.status,503);
 const resumed=make(input);await initRestore(resumed,s);await restoreBatch(resumed,s,0);assert.equal((await resumed.list()).length,2);assert.equal(b.locks.size,0);
 const markerWrites=b.requests.filter(x=>x.method==='PUT'&&x.path.endsWith('restore-control.json'));assert.equal(markerWrites.length,1);
});
test('unmarked existing target is never adopted, nor is a normal live catalog overwritten',async()=>{
 const {b,make}=setup(),s=make();await source(s,1);const t=make(targetInput());await t.init();await t.seedBatch(0,1);const before=await t.capture(),puts=b.requests.filter(x=>x.method==='PUT').length;
 await assert.rejects(initRestore(t,s),e=>e.status===409&&e.message==='RESTORE_RESERVATION_MISSING');assert.deepEqual(await t.capture(),before);assert.equal(b.requests.filter(x=>x.method==='PUT').length,puts);
});
test('lost MKCOL response without ownership marker fails closed; fresh target recovers without overwriting old root',async()=>{
 const {b,make}=setup(),s=make();await source(s,0);let once=true;const t=make(targetInput(),(u,o,c)=>b.wire(u,o,{...c,...(once&&c.label==='restore-new-root'?(once=false,{fault:'after-response-headers'}):{})}));const puts=b.requests.filter(x=>x.method==='PUT').length;
 await assert.rejects(initRestore(t,s),e=>e.status===409&&e.message==='RESTORE_RESERVATION_MISSING');assert.equal(b.requests.filter(x=>x.method==='PUT').length,puts);
 assert.equal((await initRestore(make(targetInput()),s)).restoring,false);
});
test('repeat initialization preserves partial progress and cannot roll back a post-restore edit',async()=>{
 const {make}=setup(),s=make();await source(s,11);const t=make(targetInput());await initRestore(t,s);await restoreBatch(t,s,0);const mid=await t.capture();assert.equal(mid.restoring,true);assert.equal(Object.keys(mid.entries).length,10);
 const again=await initRestore(t,s);assert.equal(again.restored,10);assert.deepEqual(await t.capture(),mid);await restoreBatch(t,s,1);const n=await t.get(noteId(0));await t.save(0,{text:'Fresh edit after restore'},n.revision,randomUUID());await initRestore(t,s);assert.equal((await t.get(n.id)).text,'Fresh edit after restore');
});
test('snapshot changed inside same source epoch is rejected on init and on chunk',async()=>{
 const {b,make}=setup(),s=make();await source(s,1);const t=make(targetInput());await initRestore(t,s);const snap=await loadSnapshot(s);snap.catalog.folders['Changed source']=true;
 const path=[...b.files.keys()].find(x=>x.includes(s.input.namespace)&&x.endsWith('store-backup.json'));b.files.set(path,encodeSnapshot(snap.catalog,snap.records));
 await assert.rejects(initRestore(t,s),e=>e.status===409&&e.message==='RESTORE_RESERVATION_MISMATCH');await assert.rejects(restoreBatch(t,s,0),/RESTORE_SOURCE_CHANGED/);
});
