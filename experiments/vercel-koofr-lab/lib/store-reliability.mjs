/* Bounded fixtures only. Never expose this controller as a user-facing Notes API. */
import {randomUUID} from 'node:crypto';
import {NoteStore,StoreError,noteId} from './store.mjs';
import {nativeTransport} from './storage.mjs';
const must=(v,c)=>{if(!v)throw new StoreError(503,c);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const faultPlans=Object.freeze({
 'lost-lock-reply':{'collection-lock':'after-response-headers'},
 'lost-base-read':{'catalog-read':'after-response-headers'},
 'before-immutable':{'immutable-create':'before-send'},
 'lost-immutable-reply':{'immutable-create':'after-response-headers'},
 'lost-immutable-verify':{'immutable-verify':'after-response-headers'},
 'before-publish':{'catalog-publish':'before-send'},
 'lost-publish-reply':{'catalog-publish':'after-response-headers'},
 'lost-publish-verify':{'catalog-verify':'after-response-headers'},
 'lost-publish-and-reconcile':{'catalog-publish':'after-response-headers','catalog-reconcile':'after-response-headers'},
 'lost-unlock-request':{'collection-unlock':'before-send'},
 'lost-unlock-reply':{'collection-unlock':'after-response-headers'},
 'replace-socket-after-base':{'catalog-read':'replace-after-success'},
 'replace-socket-after-immutable':{'immutable-verify':'replace-after-success'}
});
const short=e=>({status:e.status??503,code:/^[A-Z_0-9]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED'});
async function attempt(fn){try{return {status:200,result:await fn()};}catch(e){return short(e);}}
export function racePatch(kind,round,writer){return {text:'SYNTHETIC FULL STORE '+kind+' round '+round+' writer '+writer+' — Tiếng Việt 日本語 😀'};}
export async function reliabilityFixture(input,{makeStore=(x,opts)=>new NoteStore(x,opts),wire=nativeTransport,wait=pause}={}){
 const started=performance.now(),sessions=[],checks={};let details={},privateProbe;
 const fresh=opts=>{const s=makeStore(input,opts);sessions.push(s);return s;};
 try{
  must(['fault','race-base','race-write','race-verify','acl-prepare','acl-observe','acl-paused','acl-revoke','acl-verify','final'].includes(input.stage),'INVALID_RELIABILITY_STAGE');
  if(input.stage==='fault'){
   must(Object.hasOwn(faultPlans,input.case),'INVALID_FAULT_CASE');const clean=fresh(),base=await clean.get(noteId(0)),op=randomUUID(),patch={text:'Synthetic fault '+input.case+' '+op};
   const plan={...faultPlans[input.case]},injections=[];let faulty,replacementPending=false,replacementObserved=false;
   faulty=fresh({lease:['lost-lock-reply','lost-unlock-request'].includes(input.case)?15:60,wire:async(url,opts,ctx)=>{
    const phase=plan[ctx.label];if(!phase){const r=await wire(url,opts,ctx);if(replacementPending){replacementObserved=r.timing?.reusedSocket===false;replacementPending=false;}return r;}delete plan[ctx.label];
    if(phase==='replace-after-success'){const r=await wire(url,opts,ctx);ctx.connectionAgent.destroy();replacementPending=true;injections.push({label:ctx.label,phase,socketDestroyed:true,observedStatus:r.status});return r;}
    return wire(url,opts,{...ctx,fault:phase,onInjected:x=>injections.push({label:ctx.label,...x})});
   }});
   const initial=await attempt(()=>faulty.save(0,patch,base.revision,op));
   must(injections.length===Object.keys(faultPlans[input.case]).length,'FAULT_NOT_INJECTED');
   details={case:input.case,initial,injections,initialMetrics:faulty.metrics};
   // LOST LOCK has no returned token; LOST UNLOCK leaves our own lease behind.
   if(['lost-lock-reply','lost-unlock-request'].includes(input.case)){
    const blocked=await attempt(()=>fresh().capture());must(blocked.status===423,'EXPECTED_OUTSTANDING_LOCK_NOT_OBSERVED');details.busyObserved=true;await wait(16000);
   }
   const cat=await clean.capture(),entry=cat.entries[base.id],publishedBeforeRetry=entry.version===Number(base.revision.split(':')[1])+1;
   must(entry.version===Number(base.revision.split(':')[1])+(publishedBeforeRetry?1:0),'REVISION_ADVANCED_MORE_THAN_ONCE');
   const current=await clean.get(base.id);must(current.text===(publishedBeforeRetry?patch.text:base.text),'WRONG_HEAD_AFTER_FAULT');
   if(initial.status===200)must(publishedBeforeRetry,'FALSE_SUCCESS_BEFORE_COMMIT');
   const expectedCommitted=['lost-immutable-reply','lost-publish-reply','lost-publish-verify','lost-publish-and-reconcile','lost-unlock-request','lost-unlock-reply','replace-socket-after-base','replace-socket-after-immutable'].includes(input.case);
   must(publishedBeforeRetry===expectedCommitted,'FAULT_COMMIT_STATE_UNEXPECTED');
   if(['lost-publish-verify','lost-publish-and-reconcile'].includes(input.case))must(initial.status===503,'UNKNOWN_OUTCOME_FALSELY_CONFIRMED');
   const retry=await clean.save(0,patch,base.revision,op),again=await clean.save(0,patch,base.revision,op),after=await clean.get(base.id);
   must(retry.replay===publishedBeforeRetry&&again.replay&&retry.revision===again.revision&&after.revision===retry.revision&&after.text===patch.text,'FAULT_RETRY_NOT_EXACTLY_ONCE');
   const recordCalls=sessions.flatMap(s=>s.calls),reconnected=recordCalls.some(c=>c.timing?.reusedSocket===false&&c.label!=='collection-lock');
   if(input.case.startsWith('replace-socket'))must(initial.status===200&&replacementObserved,'CONNECTION_REPLACEMENT_NOT_RECOVERED');
   details={...details,publishedBeforeRetry,retry:{replay:retry.replay,revision:retry.revision},reconnectedSocketObserved:reconnected,deliberateReplacementObserved:replacementObserved};checks.injectedRealTransportFault=true;checks.noFalseConfirmation=true;checks.exactlyOnePublication=true;checks.retainedDraftCanRetry=true;
  }else if(input.stage.startsWith('race-')){
   must(['same','different'].includes(input.kind)&&Number.isInteger(input.round)&&input.round>=0&&input.round<50,'INVALID_RACE');const s=fresh(),slots=input.kind==='same'?[5,5]:[6,7];
   if(input.stage==='race-base'){details={revisions:[(await s.get(noteId(slots[0]))).revision,(await s.get(noteId(slots[1]))).revision]};}
   else if(input.stage==='race-write'){
    must([0,1].includes(input.writer)&&/^[a-f0-9-]{36}$/.test(input.opId)&&typeof input.expectedRevision==='string'&&input.expectedRevision.length<100,'INVALID_RACE_OPERATION');
    const result=await attempt(()=>s.save(slots[input.writer],racePatch(input.kind,input.round,input.writer),input.expectedRevision,input.opId));
    must([200,409,423].includes(result.status),'UNEXPECTED_RACE_WRITE_FAILURE');details={outcome:result};
   }else{
    must(Array.isArray(input.expectedRevisions)&&input.expectedRevisions.length===2&&[0,1].includes(input.winner),'INVALID_RACE_VERIFY');
    for(const writer of input.kind==='same'?[input.winner]:[0,1]){const n=await s.get(noteId(slots[writer]));must(n.text===racePatch(input.kind,input.round,writer).text&&n.revision===input.expectedRevisions[writer],'RACE_HEAD_MISMATCH');}
    checks.exactWinnersVerified=true;
   }
  }else if(input.stage==='acl-prepare'){
   const s=fresh(),n=await s.get(noteId(3)),link=await s.share('note',n.id);privateProbe=link.token;details={revision:n.revision};
  }else if(['acl-observe','acl-paused','acl-revoke','acl-verify'].includes(input.stage)){
   must(/^[a-f0-9-]{36}$/.test(input.opId)&&typeof input.probe==='string'&&/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(input.probe)&&typeof input.expectedRevision==='string','INVALID_ACL_OPERATION');const s=fresh(),file='note-003-'+input.opId+'.json';
   if(input.stage==='acl-observe'){const r=await s.dav(file).call('observe-unpublished-orphan','GET');must([200,404].includes(r.status),'ORPHAN_OBSERVE_FAILED');details={orphanReady:r.status===200};}
   if(input.stage==='acl-paused'){
    const paused=fresh({lease:5,beforePublish:async()=>{await wait(10000);}});const result=await attempt(()=>paused.save(3,{text:'SYNTHETIC PAUSED MUST NOT PUBLISH'},input.expectedRevision,input.opId,{token:input.probe}));
    must(result.status===409&&result.code==='LEASE_OR_PUBLICATION_REJECTED','PAUSED_STALE_WRITER_NOT_FENCED');details={outcome:result};checks.stalePublishFenced=true;
   }
   if(input.stage==='acl-revoke'){const result=await attempt(()=>s.revoke(input.probe.split('.')[0]));must([200,423].includes(result.status),'CROSS_INVOCATION_REVOKE_FAILED');details={outcome:result};}
   if(input.stage==='acl-verify'){
    const n=await s.get(noteId(3));must(n.revision===input.expectedRevision&&n.text!=='SYNTHETIC PAUSED MUST NOT PUBLISH','REVOKED_PAUSED_WRITE_PUBLISHED');
    const r=await attempt(()=>s.save(3,{text:'SYNTHETIC PAUSED MUST NOT PUBLISH'},input.expectedRevision,input.opId,{token:input.probe}));must(r.status===403,'REVOKED_RETRY_ACCEPTED');const cat=await s.capture();must(cat.entries[n.id].head!==file,'ORPHAN_BECAME_HEAD');checks.revokedRetryDenied=true;checks.unpublishedOrphanIgnored=true;
   }
  }else{
   const s=fresh(),all=await s.verifyAll();must(all.records.length===100&&Object.values(all.cat.entries).every(e=>!e.deleted),'FINAL_100_NOTE_COUNT_MISMATCH');must(!all.cat.restoring,'FINAL_STORE_INCOMPLETE');checks.all100RecordsIntegrityVerified=true;details={stored:all.records.length,active:(await s.list()).length};
  }
  return {status:200,code:'STORE_RELIABILITY_VERIFIED',passed:true,stage:input.stage,checks,details,metrics:sessions.flatMap(s=>s.metrics),calls:sessions.flatMap(s=>s.calls),...(privateProbe?{privateProbe}:{})};
 }catch(e){return {status:503,code:'STORE_RELIABILITY_GATE_FAILED',passed:false,stage:input.stage,checks,details,metrics:sessions.flatMap(s=>s.metrics),calls:sessions.flatMap(s=>s.calls),errors:[short(e)]};}
 finally{for(const s of sessions)s.agent.destroy();}
}
