import {randomUUID} from 'node:crypto';
import {createDav,nativeTransport,operate,parseRecord,hash,lockXml,validToken} from './storage.mjs';
const must=(v,code)=>{if(!v)throw Error(code);};
const success=r=>[200,201,204].includes(r.status);
export function makeBackup(sourceText){parseRecord(sourceText);return JSON.stringify({format:'homepage-koofr-note-backup-v1',sha256:hash(sourceText),sourceText});}
export function readBackup(raw){let j;try{j=JSON.parse(raw);}catch{throw Error('INVALID_BACKUP');}must(j.format==='homepage-koofr-note-backup-v1'&&typeof j.sourceText==='string'&&j.sourceText.length<16000&&hash(j.sourceText)===j.sha256,'INVALID_BACKUP');parseRecord(j.sourceText);return j.sourceText;}
export async function resilience(input,{makeDav=createDav,wire=nativeTransport,now=()=>performance.now(),wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const start=now(),clean=makeDav({...input,transport:'pooled'}),report={kind:'KOOFR_VERCEL_CONTROLLED_RESILIENCE',mode:input.mode,passed:false,checks:{},faults:[],errors:[]};
 const active=new Set();
 async function acquire(dav,label,seconds=60){const r=await dav.call(label,'LOCK',lockXml,{Timeout:'Second-'+seconds,Depth:'0'});if([200,201].includes(r.status)&&validToken(r.token))active.add(r.token);return r;}
 async function release(dav,label,token){const r=await dav.call(label,'UNLOCK',undefined,{'Lock-Token':token});must([200,204].includes(r.status),'UNLOCK_FAILED');active.delete(token);return r;}
 const injected=[];
 function faultDav(plan,file='note.json'){
  const remaining={...plan},d=makeDav({...input,transport:'pooled'},{file,nativeRequest:(url,options,{label})=>{
   const fault=remaining[label];delete remaining[label];return wire(url,options,{fault,onInjected:e=>injected.push({label,...e})});
  }});return d;
 }
 try{
  must(['expiry','faults','restore'].includes(input.mode),'INVALID_MODE');
  const seed=await operate({...input,mode:'seed',transport:'pooled'},{dav:clean});must(seed.code==='SEEDED','ISOLATED_NAMESPACE_NOT_CREATED');report.checks.isolatedSeed=true;
  if(input.mode==='expiry'){
   const a=await acquire(clean,'expiry-original-lock',5);must([200,201].includes(a.status)&&validToken(a.token),'INITIAL_LOCK_FAILED');
   report.requestedSeconds=5;report.advertisedTimeout=a.timeout??a.text.match(/<(?:[\w-]+:)?timeout\b[^>]*>\s*(Second-\d+|Infinite)\s*</i)?.[1]??null;
   const busy=await clean.call('expiry-initial-contender','LOCK',lockXml,{Timeout:'Second-5',Depth:'0'});must(busy.status===423,'INITIAL_EXCLUSION_FAILED');
   const heldAt=now();let b,newOwnerAt;
   // Bounded independent observation: never unlock A or infer expiry from a client clock.
   while(now()-heldAt<75000){
    await wait(2000);const candidate=await acquire(clean,'expiry-contender-poll',60);
    if([200,201].includes(candidate.status)&&validToken(candidate.token)){b=candidate;newOwnerAt=now();break;}
    must(candidate.status===423,'EXPIRY_POLL_FAILED');
   }
   report.waitedMs=now()-heldAt;must(b,'EXPIRY_NOT_OBSERVED_WITHIN_BOUND');must(b.token!==a.token,'LOCK_TOKEN_REUSED');active.delete(a.token);
   report.checks.expiryObservedWithoutUnlock=true;report.newOwnerAdvertisedTimeout=b.timeout??b.text.match(/<(?:[\w-]+:)?timeout\b[^>]*>\s*(Second-\d+|Infinite)\s*</i)?.[1]??null;
   const before=await clean.call('expiry-read-new-owner','GET');must(before.status===200,'READ_FAILED');const current=parseRecord(before.text);
   const body='# SYNTHETIC expiry winner\nTiếng Việt 日本語 😀\n- [x] recovered ownership\n'+randomUUID();
   const payload=JSON.stringify({...current,revision:current.revision+1,body,bodyHash:hash(body),receipts:[]});
   must(success(await clean.call('expiry-new-owner-write','PUT',payload,{If:'('+b.token+')'})),'NEW_OWNER_WRITE_FAILED');
   const stale=await clean.call('expiry-stale-writer-active-owner','PUT','SYNTHETIC MUST NOT OVERWRITE',{If:'('+a.token+')'});report.expiredWriterWithNewOwnerStatus=stale.status;must([412,423].includes(stale.status),'EXPIRED_TOKEN_OVERWROTE_NEW_OWNER');
   const un=await clean.call('expiry-stale-unlock','UNLOCK',undefined,{'Lock-Token':a.token});report.expiredUnlockStatus=un.status;
   const checkLock=await acquire(clean,'expiry-check-new-owner-still-held',60);must(checkLock.status===423,'EXPIRED_UNLOCK_REMOVED_NEW_OWNER');
   const after=await clean.call('expiry-verify-new-owner-content','GET');must(after.status===200&&after.text===payload,'EXPIRED_TOKEN_CHANGED_CONTENT');report.checks.staleTokenFencedWithNewOwner=true;
   report.newOwnerHeldBeforeUnlockMs=now()-newOwnerAt;await release(clean,'expiry-new-owner-unlock',b.token);
   const staleFree=await clean.call('expiry-stale-writer-no-owner','PUT','SYNTHETIC MUST NOT OVERWRITE',{If:'('+a.token+')'});report.expiredWriterWithoutOwnerStatus=staleFree.status;must([412,423].includes(staleFree.status),'EXPIRED_TOKEN_ACCEPTED_WITHOUT_OWNER');
   const final=await clean.call('expiry-final-read','GET');must(final.status===200&&final.text===payload,'EXPIRED_TOKEN_CHANGED_RELEASED_CONTENT');report.checks.staleTokenFencedWithoutOwner=true;
   const next=await operate({...input,mode:'save',baseRevision:0,opId:randomUUID()},{dav:clean});must(next.code==='CONFLICT'&&!next.committed,'PAUSED_EDITOR_BASE_NOT_RECHECKED');report.checks.pausedEditorConflict=true;
  }else if(input.mode==='faults'){
   let revision=0,first;
   const plans=[
    ['before-put',{'locked-put':'before-send'}],
    ['lost-put-reply',{'locked-put':'after-response-headers'}],
    ['lost-readback',{'readback':'after-response-headers'}],
    ['lost-put-and-reconciliation',{'locked-put':'after-response-headers','reconcile-ambiguous-put':'after-response-headers'}],
    ['lost-unlock-request',{'unlock':'before-send'}],
    ['lost-unlock-reply',{'unlock':'after-response-headers'}]
   ];
   for(const [name,plan] of plans){
    const op={...input,mode:'save',baseRevision:revision,opId:randomUUID()},faulty=faultDav(plan),begin=injected.length;let ownToken;
    const realCall=faulty.call;faulty.call=async(...args)=>{if(args[1]==='UNLOCK')ownToken=args[3]?.['Lock-Token'];return realCall(...args);};
    const r=await operate(op,{dav:faulty});
    if(r.possibleOutstandingLock&&validToken(ownToken))active.add(ownToken);
    const row={name,initial:{status:r.status,code:r.code,committed:r.committed,uncertain:r.uncertain??false,cleanupWarning:r.cleanupWarning??null},calls:r.calls,injections:injected.slice(begin)};
    must(row.injections.length===Object.keys(plan).length,'FAULT_NOT_INJECTED');
    if(name==='lost-unlock-request'){
     must(r.committed&&r.cleanupWarning&&validToken(ownToken),'UNLOCK_LOSS_NOT_REPORTED');active.add(ownToken);
     const blocked=await operate(op,{dav:clean});must(blocked.code==='BUSY','LOST_UNLOCK_DID_NOT_LEAVE_LOCK');row.lockBusyObserved=true;
     await release(clean,'fault-cleanup-known-own-token',ownToken);
    }
    const read=await operate({...input,mode:'read'},{dav:clean});must(read.code==='READ','FAULT_READ_FAILED');
    if(name==='before-put'){must(read.revision===revision&&!r.committed&&r.uncertain,'PREWRITE_FAULT_CHANGED_CONTENT');}
    else must(read.revision===revision+1,'COMMITTED_FAULT_REVISION_MISMATCH');
    if(['lost-readback','lost-put-and-reconciliation'].includes(name))must(!r.committed&&r.uncertain,'AMBIGUOUS_WRITE_FALSELY_CONFIRMED');
    if(name==='lost-put-reply')must(r.code==='RECONCILED'&&r.committed,'LOST_PUT_REPLY_NOT_RECONCILED');
    const retry=await operate(op,{dav:clean});must(retry.committed&&retry.revision===revision+1,'FAULT_RETRY_FAILED');must(retry.code===(name==='before-put'?'VERIFIED':'REPLAY'),'FAULT_RETRY_DOUBLE_COMMIT');
    revision++;active.delete(ownToken);row.retry={code:retry.code,revision:retry.revision};report.faults.push(row);if(!first)first=op;
   }
   // Receipt eviction must fail closed instead of silently treating an old draft as new.
   for(let i=0;i<9;i++){const r=await operate({...input,mode:'save',baseRevision:revision,opId:randomUUID()},{dav:clean});must(r.code==='VERIFIED','RECEIPT_EVICTION_SETUP_FAILED');revision++;}
   const old=await operate(first,{dav:clean});must(old.code==='CONFLICT'&&!old.committed&&!old.calls.some(c=>c.method==='PUT'),'EVICTED_RECEIPT_DOUBLE_COMMIT');report.checks.evictedReceiptFailsClosed=true;
   report.finalRevision=revision;report.checks.noDuplicateCommit=true;report.checks.ambiguousNotFalselyConfirmed=true;
  }else{
   const original=await clean.call('backup-source-read','GET');must(original.status===200,'SOURCE_READ_FAILED');const exported=makeBackup(original.text),backup=makeDav({...input,transport:'pooled'},{file:'backup.json'});
   must(success(await backup.call('backup-create','PUT',exported)),'BACKUP_WRITE_FAILED');const disk=await backup.call('backup-readback','GET');must(disk.status===200&&disk.text===exported,'BACKUP_READBACK_FAILED');must(readBackup(disk.text)===original.text,'BACKUP_VERIFY_FAILED');report.checks.durableBackupVerified=true;
   const changed=await operate({...input,mode:'save',baseRevision:0,opId:randomUUID()},{dav:clean});must(changed.code==='VERIFIED','SOURCE_ADVANCE_FAILED');
   const lock=await acquire(clean,'corrupt-synthetic-source-lock');must(validToken(lock.token)&&[200,201].includes(lock.status),'CORRUPTION_LOCK_FAILED');
   must(success(await clean.call('corrupt-synthetic-source','PUT','SYNTHETIC CORRUPT JSON',{If:'('+lock.token+')'})),'CORRUPTION_FIXTURE_FAILED');await release(clean,'corruption-unlock',lock.token);
   const invalid=await operate({...input,mode:'save',baseRevision:1,opId:randomUUID()},{dav:clean});must(invalid.code==='INVALID_STORED_RECORD'&&!invalid.calls.some(c=>c.method==='PUT'),'CORRUPT_SOURCE_NOT_FAIL_CLOSED');report.checks.corruptSourceRejected=true;
   const tampered=JSON.parse(disk.text);tampered.sourceText+='tampered';let rejected=false;try{readBackup(JSON.stringify(tampered));}catch{rejected=true;}must(rejected,'CORRUPT_BACKUP_NOT_REJECTED');report.checks.corruptBackupRejected=true;
   const recovered=makeDav({...input,transport:'pooled'},{file:'recovered.json'}),absent=await recovered.call('recovery-target-must-be-absent','GET');must(absent.status===404,'RECOVERY_TARGET_ALREADY_EXISTS');
   // New identity only. Never roll back the revision of an existing/corrupted note.
   const source=readBackup((await backup.call('restore-fetch-durable-backup','GET')).text),restorer=faultDav({'restore-copy':'after-response-headers'},'recovered.json'),begin=injected.length;
   let lost=false;try{await restorer.call('restore-copy','PUT',source);}catch{lost=true;}must(lost&&injected.length===begin+1,'RESTORE_RESPONSE_FAULT_NOT_INJECTED');
   const verify=await recovered.call('restore-reconcile-read','GET');must(verify.status===200&&verify.text===source,'RESTORE_CONTENT_MISMATCH');parseRecord(verify.text);
   const retryRead=await recovered.call('restore-retry-reconcile-no-put','GET');must(retryRead.status===200&&retryRead.text===source,'RESTORE_RETRY_MISMATCH');
   const quarantined=await clean.call('verify-corrupt-source-retained','GET');must(quarantined.status===200&&quarantined.text==='SYNTHETIC CORRUPT JSON','SOURCE_QUARANTINE_CHANGED');
   report.restore={sourceRevision:parseRecord(source).revision,bytes:Buffer.byteLength(source),sha256:hash(source),restoredSha256:hash(verify.text),newFileIdentity:true,restorePutCount:restorer.calls.filter(c=>c.method==='PUT').length,injections:injected.slice(begin)};
   report.checks.byteExactRestore=true;report.checks.restoreReplyLossReconciled=true;report.checks.sourceRetained=true;
   report.extraCalls={backup:backup.calls,recovered:recovered.calls,restore:restorer.calls};
  }
  report.passed=true;
 }catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'REQUEST_OR_NETWORK_FAILED'});}
 finally{
  report.cleanup=[];for(const token of active){try{const r=await clean.call('resilience-cleanup-own-lock','UNLOCK',undefined,{'Lock-Token':token});report.cleanup.push({status:r.status});if([200,204].includes(r.status))active.delete(token);}catch{report.cleanup.push({status:'UNVERIFIED'});}}
  report.possibleOutstandingLock=active.size>0;report.calls=clean.calls;report.ms=now()-start;
 }
 return {status:report.passed?200:503,code:report.passed?'RESILIENCE_VERIFIED':'RESILIENCE_GATE_FAILED',...report};
}
