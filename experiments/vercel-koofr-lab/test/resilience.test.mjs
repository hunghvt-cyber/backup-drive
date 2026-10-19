import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resilience,makeBackup,readBackup} from '../lib/resilience.mjs';
import {createDav,hash} from '../lib/storage.mjs';
function fixture({neverExpire=false,acceptExpired=false,badUnlock=false,noFault=false,perCallMs=0}={}){
 let clock=0,counter=0;const files=new Map(),folders=new Set(),locks=new Map();
 function held(path){const l=locks.get(path);if(l&&!neverExpire&&l.until<=clock){locks.delete(path);return undefined;}return l;}
 async function wire(url,options,{fault,onInjected=()=>{}}={}){
  clock+=perCallMs;
  if(fault==='before-send'&&!noFault){onInjected({phase:fault,requestBodySubmitted:false,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  const path=new URL(url).pathname,method=options.method,lock=held(path);let r={status:500,text:''};
  if(method==='MKCOL'){r.status=folders.has(path)?405:201;folders.add(path);}
  if(method==='GET')r=files.has(path)?{status:200,text:files.get(path)}:{status:404,text:''};
  if(method==='LOCK'){
   if(lock)r.status=423;else{const token='<simulated-private-token-'+(++counter)+'>';const seconds=Number(options.headers.Timeout?.match(/Second-(\d+)/)?.[1]??60);locks.set(path,{token,until:clock+seconds*1000});r={status:200,token,text:'<d:timeout xmlns:d="DAV:">Second-'+seconds+'</d:timeout>'};}
  }
  if(method==='UNLOCK'){
   if(lock&&(options.headers['Lock-Token']===lock.token||badUnlock)){locks.delete(path);r.status=204;}else r.status=409;
  }
  if(method==='PUT'){
   const supplied=options.headers.If;
   if(lock&&supplied!=='('+lock.token+')')r.status=423;
   else if(!lock&&supplied&&!acceptExpired)r.status=412;
   else{files.set(path,options.body);r.status=201;}
  }
  if(fault==='after-response-headers'&&!noFault){onInjected({phase:fault,observedStatus:r.status,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  return {...r,timing:{ttfbMs:0,reusedSocket:true}};
 }
 const makeDav=(input,options={})=>createDav({...input,transport:'pooled'},{nativeRequest:wire,...options});
 return {wire,makeDav,now:()=>clock,wait:async ms=>{clock+=ms;},files,locks};
}
function input(mode){return {mode,transport:'pooled',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID(),user:'fake@example.invalid',password:'fake-secret'};}
test('actual expiry must be observed by acquiring another lock; expired writes and unlock cannot affect new owner',async()=>{
 const f=fixture(),r=await resilience(input('expiry'),f);assert.equal(r.passed,true,JSON.stringify({errors:r.errors,faults:r.faults,checks:r.checks}));assert.equal(r.waitedMs,6000);assert.equal(r.checks.expiryObservedWithoutUnlock,true);assert.equal(r.checks.pausedEditorConflict,true);assert.equal(f.locks.size,0);assert.ok(!JSON.stringify(r).includes('simulated-private-token'));assert.ok(!JSON.stringify(r).includes('fake-secret'));
});
test('server ignoring requested lease stays a failed gate after bounded observation, with own lock cleanup',async()=>{
 const f=fixture({neverExpire:true}),r=await resilience(input('expiry'),f);assert.equal(r.passed,false);assert.equal(r.errors[0].code,'EXPIRY_NOT_OBSERVED_WITHIN_BOUND');assert.equal(r.possibleOutstandingLock,false);assert.equal(f.locks.size,0);
});
test('expired token accepted on unlocked file fails safety gate',async()=>{
 const r=await resilience(input('expiry'),fixture({acceptExpired:true}));assert.equal(r.passed,false);assert.equal(r.errors[0].code,'EXPIRED_TOKEN_ACCEPTED_WITHOUT_OWNER');
});
test('expired token UNLOCK that releases another owner fails safety gate',async()=>{
 const r=await resilience(input('expiry'),fixture({badUnlock:true}));assert.equal(r.passed,false);assert.equal(r.errors[0].code,'EXPIRED_UNLOCK_REMOVED_NEW_OWNER');
});
test('six distinct wire faults reconcile once, distinguish uncertainty and survive receipt eviction',async()=>{
 const f=fixture(),r=await resilience(input('faults'),f);assert.equal(r.passed,true,JSON.stringify({errors:r.errors,faults:r.faults,checks:r.checks}));assert.equal(r.faults.length,6);assert.equal(r.finalRevision,15);assert.equal(r.checks.evictedReceiptFailsClosed,true);assert.equal(f.locks.size,0);assert.equal(r.faults[4].lockBusyObserved,true);
});
test('missing fault injection cannot be reported as a successful network-fault experiment',async()=>{
 const r=await resilience(input('faults'),fixture({noFault:true}));assert.equal(r.passed,false);assert.equal(r.errors[0].code,'FAULT_NOT_INJECTED');
});
test('durable backup restores byte-exact to new identity after source corruption and response loss',async()=>{
 const f=fixture(),r=await resilience(input('restore'),f);assert.equal(r.passed,true,JSON.stringify({errors:r.errors,faults:r.faults,checks:r.checks}));assert.equal(r.restore.sha256,r.restore.restoredSha256);assert.equal(r.restore.restorePutCount,1);assert.equal(r.checks.corruptSourceRejected,true);assert.equal(r.checks.corruptBackupRejected,true);assert.equal(f.locks.size,0);
});
test('backup integrity guards accidental corruption before import',()=>{
 const text=JSON.stringify({schema:1,revision:5,body:'Tiếng Việt 😀\n- [x] x',bodyHash:hash('Tiếng Việt 😀\n- [x] x'),receipts:[]});const backup=makeBackup(text);assert.equal(readBackup(backup),text);
 const bad=JSON.parse(backup);bad.sourceText+='x';assert.throws(()=>readBackup(JSON.stringify(bad)),/INVALID_BACKUP/);assert.throws(()=>readBackup('garbage'),/INVALID_BACKUP/);assert.throws(()=>makeBackup('{}'),/INVALID_STORED_RECORD/);
});

test('new owner has a longer lease so slow validation does not invalidate the expiry test',async()=>{
 const f=fixture({perCallMs:1000}),r=await resilience(input('expiry'),f);assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.newOwnerAdvertisedTimeout,'Second-60');assert.equal(r.newOwnerHeldBeforeUnlockMs>=5000,true);
});
