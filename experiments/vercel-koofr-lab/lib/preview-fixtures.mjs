import {randomUUID} from 'node:crypto';
import {NoteStore,StoreError,noteId} from './store.mjs';
import {nativeTransport} from './storage.mjs';
import {exportStore,initRestore,restoreBatch} from './store-backup.mjs';
import {createPreviewHandler} from './preview-api.mjs';
const must=(v,c)=>{if(!v)throw new StoreError(503,c);};
export async function previewFixture(input,{makeStore=(x,opts)=>new NoteStore(x,opts),wire=nativeTransport}={}){
 const start=performance.now(),sessions=[],checks={},details={};
 const fresh=(namespace=input.namespace,opts)=>{const s=makeStore({...input,namespace},opts);sessions.push(s);return s;};
 try{
  if(input.stage.startsWith('restore-')){
   must(typeof input.sourceNamespace==='string'&&input.sourceNamespace!==input.namespace,'SOURCE_NAMESPACE_REQUIRED');const source=fresh(input.sourceNamespace),target=fresh();await source.init();
   if(input.stage!=='restore-empty')await source.seedBatch(0,input.stage==='restore-partial'?11:2);await exportStore(source);
   if(input.stage==='restore-empty'){
    const first=await initRestore(target,source),before=await target.capture();must(!first.restoring&&first.count===0,'EMPTY_RESTORE_NOT_COMPLETE');must((await target.list()).length===0,'EMPTY_RESTORE_NOT_READABLE');
    const puts=target.calls.filter(x=>x.method==='PUT').length;must((await initRestore(target,source)).replay&&(await restoreBatch(target,source,0)).replay,'EMPTY_RESTORE_REPLAY_FAILED');must((await target.capture()).epoch===before.epoch&&target.calls.filter(x=>x.method==='PUT').length===puts,'EMPTY_RETRY_CHANGED_STATE');checks.emptyRestoreCompleteAndReplayReadOnly=true;
   }else if(['restore-marker-loss','restore-catalog-loss','restore-catalog-verify-loss'].includes(input.stage)){
    const label={'restore-marker-loss':'restore-marker-write-verify','restore-catalog-loss':'restore-initial-catalog-write','restore-catalog-verify-loss':'restore-initial-catalog-write-verify'}[input.stage],phase=input.stage==='restore-catalog-loss'?'before-send':'after-response-headers';let injected=false;
    const faulty=fresh(input.namespace,{wire:(u,o,c)=>wire(u,o,{...c,...(!injected&&c.label===label?{fault:phase,onInjected:()=>{injected=true;}}:{})})});
    let failed=false;try{await initRestore(faulty,source);}catch(e){must(e.status===503,'UNEXPECTED_INIT_ERROR');failed=true;}must(failed&&injected,'INIT_FAULT_NOT_OBSERVED');
    const resumed=await initRestore(target,source);await restoreBatch(target,source,0);must((await target.list()).length===2,'INIT_RESUME_FAILED');checks.initializationResumesAfterFault=true;details.resumeWasReplay=resumed.replay;
   }else if(input.stage==='restore-unowned'){
    await target.init();await target.seedBatch(0,1);const before=await target.capture();let denied=false;try{await initRestore(target,source);}catch(e){denied=e.status===409&&e.message==='RESTORE_RESERVATION_MISSING';}must(denied&&JSON.stringify(await target.capture())===JSON.stringify(before),'UNOWNED_TARGET_CHANGED');checks.unownedTargetPreserved=true;
   }else if(input.stage==='restore-mkcol-loss'){
    let injected=false;const faulty=fresh(input.namespace,{wire:(u,o,c)=>wire(u,o,{...c,...(!injected&&c.label==='restore-new-root'?{fault:'after-response-headers',onInjected:()=>{injected=true;}}:{})})});let denied=false;
    try{await initRestore(faulty,source);}catch(e){denied=e.status===409&&e.message==='RESTORE_RESERVATION_MISSING';}must(injected&&denied&&!faulty.calls.some(x=>x.method==='PUT'),'AMBIGUOUS_ROOT_ADOPTED');
    const recovery=fresh(input.namespace.slice(0,-36)+randomUUID());await initRestore(recovery,source);await restoreBatch(recovery,source,0);must((await recovery.list()).length===2,'FRESH_TARGET_RECOVERY_FAILED');checks.unmarkedAmbiguousRootFailsClosed=true;checks.newTargetRecoveryVerified=true;
   }else if(input.stage==='restore-partial'){
    await initRestore(target,source);await restoreBatch(target,source,0);const before=await target.capture();must(before.restoring&&Object.keys(before.entries).length===10,'PARTIAL_SETUP_FAILED');await initRestore(target,source);must(JSON.stringify(await target.capture())===JSON.stringify(before),'REINIT_RESET_PARTIAL_RESTORE');
    await restoreBatch(target,source,1);const n=await target.get(noteId(0));await target.save(0,{text:'Fresh edit after completion'},n.revision,randomUUID());await initRestore(target,source);must((await target.get(n.id)).text==='Fresh edit after completion','REINIT_ROLLED_BACK_FRESH_EDIT');checks.partialResumeAndPostRestoreEditPreserved=true;
   }else throw new StoreError(400,'INVALID_FIXTURE_STAGE');
  }else if(input.stage==='prepare-browser-preview'){
   const store=fresh();await store.init();checks.freshSyntheticPreviewRoot=true;details.namespace=input.namespace;
  }else if(['api-owner','api-sharing'].includes(input.stage)){
   await fresh().init();const events=[],cfg={NOTES_PREVIEW_ENABLED:'synthetic-only-v1',VERCEL_ENV:'preview',PREVIEW_BASE_URL:'https://fixture.invalid',PREVIEW_SESSION_PASSWORD:randomUUID()+randomUUID(),PREVIEW_PORTAL_PASSWORD:'synthetic-'+randomUUID(),KOOFR_NOTES_USER:input.user,KOOFR_NOTES_APP_PASSWORD:input.password,KOOFR_NOTES_NAMESPACE:input.namespace};
   const handler=createPreviewHandler({env:()=>cfg,makeStore:()=>fresh(),observe:x=>events.push(x)});let session;
   const call=async(route,{method='GET',data,cap,cookie=session,origin=cfg.PREVIEW_BASE_URL,query=''}={})=>{const response=await handler(new Request(cfg.PREVIEW_BASE_URL+'/api/preview?route='+route+query,{method,headers:{...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(cap?{Authorization:'Bearer '+cap}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})}));return {status:response.status,value:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
   must((await call('notes')).status===401,'OWNER_ANONYMOUS_ACCESS');const auth=await call('auth',{method:'POST',data:{password:cfg.PREVIEW_PORTAL_PASSWORD}});must(auth.status===200&&auth.cookie,'LOGIN_FAILED');session=auth.cookie;
   if(input.stage==='api-owner'){
    const op=randomUUID(),payload={action:'save',clientOpId:op,title:'API Unicode 日本語',text:'đ😀'.repeat(12000),checklist:[{id:'done',text:'Đã làm',checked:true}],folder:'API thư mục',pinned:true};
    const saved=await call('notes-save',{method:'POST',data:payload});must(saved.status===200&&saved.value.id===op&&saved.value.text===payload.text,'API_UUID_LARGE_NOTE_FAILED');
    const replay=await call('notes-save',{method:'POST',data:payload});must(replay.status===200&&replay.value.replay&&replay.value.revision===saved.value.revision,'API_RETRY_DUPLICATED');
    const get=await call('notes',{query:'&id='+op+'&revision='+encodeURIComponent(saved.value.revision)});must(get.value.notModified,'API_CONDITIONAL_FETCH_FAILED');
    const delta=await call('notes',{query:'&known='+encodeURIComponent(JSON.stringify([[op,saved.value.revision]]))});must(delta.value.delta&&delta.value.notes.length===0,'API_DELTA_FAILED');
    must((await call('notes-save',{method:'POST',origin:'https://attacker.invalid',data:payload})).status===403,'API_ORIGIN_BYPASS');
    must((await call('notes-save',{method:'POST',data:{...payload,id:op,revision:'old',clientOpId:randomUUID()}})).status===409,'API_STALE_SAVE_ACCEPTED');
    const deleted=await call('notes',{method:'POST',data:{action:'delete',id:op,revision:saved.value.revision}});must(deleted.status===200&&(await call('notes',{query:'&id='+op})).status===404,'API_DELETE_FAILED');checks.uuidLargeUnicodeCrudIdempotency=true;checks.originRevisionAndDelta=true;details.noteUtf8Bytes=Buffer.byteLength(payload.text);
   }else{
    const op=randomUUID(),saved=await call('notes-save',{method:'POST',data:{action:'save',clientOpId:op,title:'Shared',text:'Owner body',folder:'API chia sẻ'}});must(saved.status===200,'API_SHARE_SETUP_FAILED');
    const link=await call('note-share',{method:'POST',data:{action:'create',noteId:op}}),cap=link.value.token,view=await call('note-share',{method:'POST',data:{action:'create',noteId:op,permission:'view'}});must(typeof cap==='string','API_LINK_FAILED');
    const edit={action:'save',clientOpId:randomUUID(),revision:saved.value.revision,title:'Shared',text:'Shared edit Unicode 😀'};const edited=await call('shared-note',{method:'POST',cap,data:edit,cookie:undefined});must(edited.status===200&&edited.value.text===edit.text&&!('history' in edited.value),'API_SHARED_EDIT_FAILED');
    must((await call('shared-note',{method:'POST',cap:view.value.token,data:{...edit,revision:edited.value.revision,clientOpId:randomUUID()}})).status===403,'API_VIEW_ESCALATION');
    must((await call('shared-note',{method:'POST',cap,data:{...edit,pinned:true,clientOpId:randomUUID()}})).status===403,'API_SHARED_PIN_ESCALATION');
    must((await call('shared-folder',{cap})).status===403,'API_NOTE_AS_FOLDER_ALLOWED');
    await call('note-share',{method:'POST',data:{action:'revoke',noteId:op,id:link.value.id}});must((await call('shared-note',{method:'POST',cap,data:edit})).status===403,'API_REVOKED_REPLAY_ACCEPTED');
    const folder=await call('note-share',{method:'POST',data:{action:'create',folder:'API chia sẻ'}});const create=await call('shared-folder',{method:'POST',cap:folder.value.token,data:{action:'save',clientOpId:randomUUID(),title:'Workspace created',text:'日本語'}});must(create.status===200,'API_FOLDER_CREATE_FAILED');const listed=await call('shared-folder',{cap:folder.value.token});must(listed.value.notes.length===2&&listed.value.notes.every(n=>n.folder==='API chia sẻ'),'API_FOLDER_SCOPE_LEAK');
    checks.noteFolderShareViewEditAndRevoke=true;checks.noPrivilegeEscalationOrRevokedReplay=true;
   }
   details.httpContractChecks=events.length;details.apiEvents=events;
   // Never return response bodies, cookie/seal keys or capability tokens to the driver.
  }else throw new StoreError(400,'INVALID_FIXTURE_STAGE');
  return {status:200,code:'PREVIEW_QUALIFICATION_VERIFIED',passed:true,stage:input.stage,checks,details,ms:performance.now()-start,metrics:sessions.flatMap(s=>s.metrics),calls:sessions.flatMap(s=>s.calls)};
 }catch(e){return {status:503,code:'PREVIEW_QUALIFICATION_FAILED',passed:false,stage:input.stage,checks,details,ms:performance.now()-start,errors:[{code:/^[A-Z_0-9]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED',status:e.status??503}],metrics:sessions.flatMap(s=>s.metrics),calls:sessions.flatMap(s=>s.calls)};}
 finally{for(const s of sessions)s.agent.destroy();}
}
