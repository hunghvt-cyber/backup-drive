import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {backend} from './helpers/collection.mjs';
import {NoteStore,noteId} from '../lib/store.mjs';
import {faultPlans,reliabilityFixture,racePatch} from '../lib/store-reliability.mjs';
function setup(){const b=backend(),input={user:'fake',password:'synthetic-secret',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()},makeStore=(x,opts={})=>new NoteStore(x,{makeDav:b.makeDav,wire:b.wire,...opts});return {b,input,makeStore};}
for(const name of Object.keys(faultPlans))test('full store fault/retry: '+name,async()=>{
 const {b,input,makeStore}=setup(),s=makeStore(input);await s.init();await s.seedBatch(0,10);
 const r=await reliabilityFixture({...input,stage:'fault',case:name},{makeStore,wire:b.wire,wait:b.wait});assert.equal(r.passed,true,JSON.stringify({errors:r.errors,details:r.details}));assert.equal(b.locks.size,0);assert.equal(r.checks.exactlyOnePublication,true);assert.ok(!JSON.stringify(r).includes('synthetic-secret'));assert.ok(!JSON.stringify(r).includes('fake-lock-'));
});
test('missing fault injection fails instead of claiming coverage',async()=>{
 const {b,input,makeStore}=setup(),s=makeStore(input);await s.init();await s.seedBatch(0,1);
 const r=await reliabilityFixture({...input,stage:'fault',case:'before-publish'},{makeStore,wire:(u,o,c)=>b.wire(u,o,{...c,fault:undefined}),wait:b.wait});assert.equal(r.passed,false);assert.equal(r.errors[0].code,'FAULT_NOT_INJECTED');
});
test('separate fixture invocations race on same/different Note with final HEAD assertions',async()=>{
 const {b,input,makeStore}=setup(),s=makeStore(input);await s.init();await s.seedBatch(0,10);const opts={makeStore,wire:b.wire,wait:b.wait};
 for(const kind of ['same','different']){
  const base=await reliabilityFixture({...input,stage:'race-base',kind,round:0},opts),ops=[randomUUID(),randomUUID()];
  const write=writer=>reliabilityFixture({...input,stage:'race-write',kind,round:0,writer,expectedRevision:base.details.revisions[writer],opId:ops[writer]},opts);
  const rows=await Promise.all([write(0),write(1)]);for(let i=0;i<2;i++)if(rows[i].details.outcome.status===423)rows[i]=await write(i);
  const wins=rows.map((r,i)=>r.details.outcome.status===200?i:-1).filter(x=>x>=0);assert.equal(wins.length,kind==='same'?1:2);
  const revs=rows.map(r=>r.details.outcome.result?.revision??null),winner=wins[0];const checked=await reliabilityFixture({...input,stage:'race-verify',kind,round:0,winner,expectedRevisions:revs},opts);assert.equal(checked.passed,true,JSON.stringify(checked.errors));
 }
});
test('revocation from another invocation fences expired paused full-store publication',async()=>{
 const {b,input,makeStore}=setup(),s=makeStore(input);await s.init();await s.seedBatch(0,10);const opts={makeStore,wire:b.wire,wait:b.wait};
 const prepared=await reliabilityFixture({...input,stage:'acl-prepare'},opts),extra={probe:prepared.privateProbe,opId:randomUUID(),expectedRevision:prepared.details.revision};
 const paused=await reliabilityFixture({...input,...extra,stage:'acl-paused'},{...opts,wait:async ms=>{await b.wait(ms);const r=await reliabilityFixture({...input,...extra,stage:'acl-revoke'},opts);assert.equal(r.details.outcome.status,200);}});assert.equal(paused.passed,true,JSON.stringify(paused.errors));
 const checked=await reliabilityFixture({...input,...extra,stage:'acl-verify'},opts);assert.equal(checked.passed,true,JSON.stringify(checked.errors));
});
