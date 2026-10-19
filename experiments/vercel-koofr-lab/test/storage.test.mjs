import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {operate,validateInput,createDav} from '../lib/storage.mjs';
function fixture({losePutReply=false,loseReadback=false,failUnlock=false}={}){
 let held,stored,lockCounter=0,puts=0;const calls=[];
 const dav={calls,async call(label,method,body,headers={}){
  calls.push({label,method});
  if(method==='MKCOL')return {status:201};
  if(method==='LOCK'){if(held)return {status:423};held='<fake-'+(++lockCounter)+'>';return {status:200,token:held};}
  if(method==='UNLOCK'){assert.equal(headers['Lock-Token'],held);if(failUnlock)throw Error();held=undefined;return {status:204};}
  if(method==='GET'){if(label==='readback'&&loseReadback)throw Error('NETWORK_OR_TIMEOUT');return {status:200,text:stored};}
  if(method==='PUT'){if(label!=='seed-note')assert.equal(headers.If,'('+held+')');stored=body;puts++;if(label==='locked-put'&&losePutReply)throw Error('NETWORK_OR_TIMEOUT');return {status:201};}
  throw Error('UNEXPECTED');
 }};return {dav,puts:()=>puts,held:()=>held};
}
const input=()=>({mode:'save',opId:randomUUID(),baseRevision:0});
test('every save checks base under exclusive lock, verifies content and releases',async()=>{
 const f=fixture();await operate({mode:'seed'},{dav:f.dav});f.dav.calls.length=0;
 const r=await operate(input(),{dav:f.dav});assert.equal(r.code,'VERIFIED');assert.equal(r.revision,1);assert.equal(r.committed,true);assert.equal(f.held(),undefined);
 assert.deepEqual(f.dav.calls.map(c=>c.method),['LOCK','GET','PUT','GET','UNLOCK']);
});
test('concurrent same-base saves produce one commit; loser retry is conflict',async()=>{
 const f=fixture();await operate({mode:'seed'},{dav:f.dav});const a=input(),b=input();const results=await Promise.all([operate(a,{dav:f.dav}),operate(b,{dav:f.dav})]);
 assert.equal(results.filter(r=>r.committed).length,1);assert.ok(results.some(r=>[409,423].includes(r.status)));
 const loser=results[0].committed?b:a;const r=await operate(loser,{dav:f.dav});assert.equal(r.code,'CONFLICT');assert.equal(f.puts(),2);
});
test('response loss after PUT reconciles exactly once; retry same op is replay',async()=>{
 const f=fixture({losePutReply:true});await operate({mode:'seed'},{dav:f.dav});const op=input();const r=await operate(op,{dav:f.dav});assert.equal(r.code,'RECONCILED');
 const replay=await operate(op,{dav:f.dav});assert.equal(replay.code,'REPLAY');assert.equal(replay.revision,1);assert.equal(f.puts(),2);
});
test('failed readback is uncertain and preserves operation for later reconciliation',async()=>{
 const f=fixture({loseReadback:true});await operate({mode:'seed'},{dav:f.dav});const op=input();const r=await operate(op,{dav:f.dav});assert.equal(r.status,503);assert.equal(r.uncertain,true);assert.equal(r.committed,false);assert.equal(f.held(),undefined);
 const replay=await operate(op,{dav:f.dav});assert.equal(replay.code,'REPLAY');assert.equal(f.puts(),2);
});
test('failed unlock does not turn verified commit into a false failed save',async()=>{
 const f=fixture({failUnlock:true});await operate({mode:'seed'},{dav:f.dav});const r=await operate(input(),{dav:f.dav});assert.equal(r.committed,true);assert.equal(r.possibleOutstandingLock,true);assert.equal(r.cleanupWarning,'LOCK_RELEASE_UNVERIFIED');
});
test('path/input constraints forbid private or arbitrary remote paths',()=>{
 const valid={user:'fake@example.invalid',password:'fake',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID(),mode:'read',transport:'fetch'};validateInput(valid,'123');
 for(const patch of [{namespace:'GoogleBackup/note'},{namespace:valid.namespace.replace('123','456')},{user:'bad:header'},{password:'bad\nheader'},{transport:'other'},{mode:'delete'},{mode:'save',opId:'bad',baseRevision:0}])assert.throws(()=>validateInput({...valid,...patch},'123'));
});
test('both transports use same fixed HTTPS endpoint and redact provider errors',async()=>{
 const x={user:'fake',password:'not-for-logs',namespace:'Homepage-Notes-Vercel-Probe-123-'+randomUUID()};
 for(const transport of ['fetch','pooled']){
  const fake=async(url,options)=>{assert.ok(url.startsWith('https://app.koofr.net/dav/Koofr/Homepage-Notes-Vercel-Probe-'));assert.equal(options.headers.Authorization,'Basic '+Buffer.from('fake:not-for-logs').toString('base64'));throw Error('SECRET not-for-logs');};
  const dav=createDav({...x,transport},{fetcher:fake,nativeRequest:fake});await assert.rejects(dav.call('read','GET'),/NETWORK_OR_TIMEOUT/);assert.ok(!JSON.stringify(dav.calls).includes('not-for-logs'));
 }
});
