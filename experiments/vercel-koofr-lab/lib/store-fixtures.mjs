import {randomUUID} from 'node:crypto';
import {NoteStore,StoreError,noteId,fixtureNote,ownerContext} from './store.mjs';
import {exportStore,initRestore,restoreBatch,loadSnapshot,decodeSnapshot} from './store-backup.mjs';
import {nativeTransport,hash} from './storage.mjs';
const must=(x,c)=>{if(!x)throw new StoreError(503,c);};
async function denied(fn,status){try{await fn();}catch(e){must(e.status===status,'UNEXPECTED_DENIAL_'+(e.status??0));return e.message;}throw new StoreError(503,'EXPECTED_DENIAL_MISSING');}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export async function storeFixture(input,{makeStore=x=>new NoteStore(x,{lease:x.testLease??60,beforePublish:x.testBeforePublish,wire:x.testWire}),wait=ms=>new Promise(r=>setTimeout(r,ms)),wire=nativeTransport}={}){
 const store=makeStore(input),checks={},stage=input.stage;const start=performance.now();let details={},source,privateProbe;
 try{
  if(stage==='init'){await store.init();checks.freshIsolatedStore=true;}
  else if(stage==='seed'){
   must(Number.isInteger(input.chunk)&&input.chunk>=0&&input.chunk<10,'INVALID_CHUNK');details=await store.seedBatch(input.chunk*10);checks.chunkCommitted=true;
  }else if(stage==='verify'){
   must(Number.isInteger(input.chunk)&&input.chunk>=0&&input.chunk<10,'INVALID_CHUNK');const cat=await store.capture();let verified=0;
   for(let slot=input.chunk*10;slot<input.chunk*10+10;slot++){
    const e=cat.entries[noteId(slot)];must(e&&!e.deleted,'MISSING_SEEDED_NOTE');const n=await store.readRecord(e),f=fixtureNote(slot);
    must(n.id===f.id&&n.title===f.title&&n.text===f.text&&n.pinned===f.pinned&&same(n.checklist,f.checklist)&&e.folder===f.folder,'SEEDED_CONTENT_MISMATCH');verified++;
   }
   details={verified,total:Object.keys(cat.entries).length};checks.unicodeChecklistFolderVerified=true;
  }else if(stage==='owner'){
   const n=await store.get(noteId(0));await denied(()=>store.save(0,{text:'MUST NOT COMMIT'},'old',randomUUID()),409);
   const op=randomUUID(),patch={text:'Owner Unicode 日本語 😀',checklist:[{id:'done',text:'Hoàn tất',checked:true},{id:'todo',text:'Chờ',checked:false}]};const saved=await store.save(0,patch,n.revision,op);
   const replay=await store.save(0,patch,n.revision,op);must(replay.replay&&replay.revision===saved.revision,'SAVE_RETRY_DUPLICATE');await denied(()=>store.save(0,{text:'different'},n.revision,op),409);
   const now=await store.get(n.id);must(now.text===patch.text&&same(now.checklist,patch.checklist),'OWNER_UPDATE_MISMATCH');
   await denied(()=>store.save(0,{checklist:[{id:'dup',text:'x',checked:false},{id:'dup',text:'y',checked:true}]},now.revision,randomUUID()),400);
   const created=await store.save(100,{title:'CRUD giả',text:'Create/read/delete',checklist:[],folder:'Gia đình'},null,randomUUID());
   await denied(()=>store.remove(noteId(100),'stale'),409);await store.remove(noteId(100),created.revision);await store.remove(noteId(100),created.revision);await denied(()=>store.get(noteId(100)),404);await denied(()=>store.save(100,{text:'resurrect'},created.revision,randomUUID()),409);
   await store.createFolder('Thư mục rỗng');await denied(()=>store.share('folder','Thư mục rỗng'),404);await store.deleteFolder('Thư mục rỗng');
   await store.createFolder('Xoá thử');await store.save(102,{title:'Xoá theo thư mục',text:'Dữ liệu giả',checklist:[],folder:'Xoá thử'},null,randomUUID());await store.deleteFolder('Xoá thử',true);await denied(()=>store.get(noteId(102)),404);
   await store.createFolder('Giữ Note');await store.save(103,{title:'Bỏ thư mục vẫn giữ Note',text:'Dữ liệu giả',checklist:[],folder:'Giữ Note'},null,randomUUID());await store.deleteFolder('Giữ Note',false);const kept=await store.get(noteId(103));must(kept.folder==='','KEEP_NOTES_FOLDER_DELETE_FAILED');await store.remove(kept.id,kept.revision);
   checks.crudChecklistIdempotency=true;checks.deletedCannotResurrect=true;checks.folderDeleteAndUnfile=true;
  }else if(stage==='history'){
   let n=await store.get(noteId(1));for(let i=0;i<6;i++){await store.save(1,{text:'History '+i+' — tiếng Việt'},n.revision,randomUUID());n=await store.get(n.id);}must(n.history.length===5&&n.history[0].text==='History 4 — tiếng Việt','HISTORY_LIMIT_FAILED');checks.historyFiveVersions=true;
  }else if(stage==='note-share'){
   const n=await store.get(noteId(2)),link=await store.share('note',n.id),actor={token:link.token};const visible=await store.get(n.id,actor);must(visible.text===n.text,'SHARE_INITIAL_CONTENT_FAILED');
   await store.save(2,{text:'Owner latest — 日本語'},n.revision,randomUUID());const latest=await store.get(n.id,actor);must(latest.text==='Owner latest — 日本語','SHARE_NOT_LIVE');
   const op=randomUUID(),patch={text:'Shared edit — Tiếng Việt 😀',checklist:[{id:'shared',text:'Đã chia sẻ',checked:true}],pinned:!latest.pinned};const edited=await store.save(2,patch,latest.revision,op,actor);
   const after=await store.get(n.id);must(after.text===patch.text&&same(after.checklist,patch.checklist)&&after.pinned===latest.pinned,'SHARED_EDIT_FIELDS_FAILED');await denied(()=>store.save(2,{text:'stale'},latest.revision,randomUUID(),actor),409);
   await denied(()=>store.get(noteId(75),actor),404);await denied(()=>store.save(101,{title:'Invalid',text:'',checklist:[]},null,randomUUID(),actor),403);
   await denied(()=>store.save(2,{folder:'Riêng tư'},after.revision,randomUUID(),actor),403);await denied(()=>store.remove(n.id,after.revision,actor),403);await denied(()=>store.createFolder('forbidden',actor),403);await denied(()=>store.share('note',n.id,'edit',actor),403);
   const view=await store.share('note',n.id,'view');await store.get(n.id,{token:view.token});await denied(()=>store.save(2,{text:'forbidden'},after.revision,randomUUID(),{token:view.token}),403);
   await store.revoke(link.id);await denied(()=>store.get(n.id,actor),403);await denied(()=>store.save(2,patch,latest.revision,op,actor),403);
   const fresh=await store.share('note',n.id);must(fresh.token!==link.token,'SHARE_TOKEN_REUSED');await denied(()=>store.get(n.id,actor),403);await store.get(n.id,{token:fresh.token});await store.revoke(fresh.id);await store.revoke(view.id);
   checks.liveNoteShareEdit=true;checks.readOnlyAndCrossNoteDenied=true;checks.revokeAndFreshToken=true;checks.revokedRetryDeniedBeforeReceipt=true;
  }else if(stage==='folder-share'){
   const link=await store.share('folder','Công việc'),actor={token:link.token},list=await store.list(actor);must(list.length===25&&list.every(n=>n.folder==='Công việc'),'FOLDER_LIST_LEAK');
   await denied(()=>store.get(noteId(75),actor),404);const outside=await store.get(noteId(75));await denied(()=>store.save(75,{text:'forbidden'},outside.revision,randomUUID(),actor),404);
   await denied(()=>store.save(101,{title:'Escape',text:'',checklist:[],folder:'Riêng tư'},null,randomUUID(),actor),403);
   await store.save(101,{title:'Workspace tạo mới',text:'Tiếng Việt 😀',checklist:[]},null,randomUUID(),actor);must((await store.get(noteId(101),actor)).folder==='Công việc','WORKSPACE_CREATE_ESCAPED');
   let moving=await store.get(noteId(4));await store.save(4,{folder:'Gia đình'},moving.revision,randomUUID());await denied(()=>store.get(moving.id,actor),404);await denied(()=>store.save(4,{text:'outside'},moving.revision,randomUUID(),actor),404);
   moving=await store.get(moving.id);await store.save(4,{folder:'Công việc'},moving.revision,randomUUID());await store.get(moving.id,actor);
   await denied(()=>store.deleteFolder('Công việc'),409);await store.revoke(link.id);await denied(()=>store.list(actor),403);await denied(()=>store.get(noteId(0),actor),403);await denied(()=>store.save(104,{title:'revoked',text:'',checklist:[]},null,randomUUID(),actor),403);
   const fresh=await store.share('folder','Công việc');must(fresh.token!==link.token,'FOLDER_TOKEN_REUSED');await denied(()=>store.list(actor),403);must((await store.list({token:fresh.token})).length===26,'NEW_FOLDER_LINK_FAILED');await store.revoke(fresh.id);
   const created=await store.get(noteId(101));await store.remove(created.id,created.revision);checks.folderWorkspaceCreateEditIsolation=true;checks.movedNoteLosesFolderAccess=true;checks.sharedFolderDeleteGuard=true;checks.folderRevokeAndRenew=true;
  }else if(stage==='concurrency'){
   const original=await store.get(noteId(5)),ops=[randomUUID(),randomUUID()];
   const rs=await Promise.allSettled(ops.map((op,i)=>makeStore(input).save(5,{text:'Concurrent '+i},original.revision,op)));
   const winners=rs.map((r,i)=>({r,i})).filter(x=>x.r.status==='fulfilled');must(winners.length===1,'CONCURRENT_DOUBLE_COMMIT');const lose=1-winners[0].i;must([409,423].includes(rs[lose].reason.status),'UNEXPECTED_CONCURRENT_FAILURE');await denied(()=>store.save(5,{text:'Concurrent '+lose},original.revision,ops[lose]),409);
   checks.sameBaseOneWinner=true;
  }else if(stage==='revoke-expiry'){
   const n=await store.get(noteId(3)),link=await store.share('note',n.id),op=randomUUID();let memberFenced=false;
   const paused=makeStore({...input,testLease:5,testBeforePublish:async({token})=>{
    await wait(6500);await store.revoke(link.id);
    const file='note-003-'+op+'.json',before=await paused.dav(file).call('old-writer-orphan-read','GET');const attempt=await paused.dav(file).call('expired-collection-member-write','PUT','MUST NOT WRITE',{If:'('+token+')'});must([412,423].includes(attempt.status),'EXPIRED_COLLECTION_MEMBER_NOT_FENCED');const after=await paused.dav(file).call('verify-expired-member-preserved','GET');must(before.text===after.text,'EXPIRED_MEMBER_CHANGED');memberFenced=true;
   }});
   await denied(()=>paused.save(3,{text:'MUST NOT PUBLISH'},n.revision,op,{token:link.token}),409);
   const current=await store.get(n.id);must(current.revision===n.revision&&current.text===n.text,'PAUSED_REVOKED_WRITER_PUBLISHED');await denied(()=>store.get(n.id,{token:link.token}),403);
   const cat=await store.capture();must(cat.entries[n.id].head!=='note-003-'+op+'.json','ORPHAN_WAS_PUBLISHED');checks.expiredCollectionMemberFenced=memberFenced;checks.revokeWinsPausedWriter=true;checks.orphanRevisionIgnored=true;details.pausedMetrics=paused.metrics;
  }else if(stage==='export'){
   const probe=await store.share('folder','Công việc','view');privateProbe=probe.token;details=await exportStore(store);must(details.active===100&&details.count===104,'EXPORT_COUNT_MISMATCH');checks.fullSnapshotDurable=true;
  }else if(stage==='restore-init'){
   source=makeStore({...input,namespace:input.sourceNamespace});details=await initRestore(store,source);await denied(()=>store.list(),503);checks.partialRestoreHidden=true;checks.newEpochAndRevokedLinks=details.newEpoch&&details.sharesRevoked>0;
  }else if(stage==='restore-chunk'){
   source=makeStore({...input,namespace:input.sourceNamespace});must(Number.isInteger(input.chunk)&&input.chunk>=0&&input.chunk<11,'INVALID_CHUNK');
   if(input.chunk===3){
    let injected=false;const interrupted=makeStore({...input,testWire:(url,opts,ctx)=>wire(url,opts,{...ctx,...(ctx.label==='catalog-publish'&&!injected?{fault:'before-send',onInjected:()=>{injected=true;}}:{})})});
    const before=await store.capture();await denied(()=>restoreBatch(interrupted,source,input.chunk),503);const after=await store.capture();must(injected&&same(before.entries,after.entries),'PARTIAL_RESTORE_PUBLISHED');checks.interruptedRestoreNotPublished=true;
   }
   details=await restoreBatch(store,source,input.chunk);checks.restoreChunkVerified=true;
  }else if(stage==='restore-guards'){
   source=makeStore({...input,namespace:input.sourceNamespace});await source.init();await source.seedBatch(0,2);await exportStore(source);await initRestore(store,source);
   for(const fn of [()=>store.list(),()=>store.createFolder('forbidden'),()=>store.deleteFolder('Công việc'),()=>store.share('folder','Công việc'),()=>store.remove(noteId(0),'old')])await denied(fn,503);
   await restoreBatch(store,source,0);must((await restoreBatch(store,source,0)).replay,'RESTORE_REPLAY_FAILED');const n=await store.get(noteId(0));await store.save(0,{text:'Fresh post-restore edit'},n.revision,randomUUID());await denied(()=>restoreBatch(store,source,0),409);must((await store.get(n.id)).text==='Fresh post-restore edit','LATE_RESTORE_OVERWROTE_EDIT');
   checks.incompleteRestoreBlocksOwnerMutations=true;checks.lateRestoreRetryCannotOverwriteEdit=true;checks.completedChunkReplayWithoutWrite=true;details={notes:2};
  }else if(stage==='restore-verify'){
   source=makeStore({...input,namespace:input.sourceNamespace});const snapshot=await loadSnapshot(source),all=await store.verifyAll();must(!all.cat.restoring&&all.records.length===104,'RESTORE_COUNT_MISMATCH');
   for(const e of Object.values(snapshot.catalog.entries)){const dest=all.cat.entries[e.id];must(same(dest,e),'RESTORE_MEMBERSHIP_MISMATCH');const restored=all.records.find(r=>r.id===e.id);must(restored&&same(restored.record,JSON.parse(snapshot.records[e.head]).value),'RESTORE_BYTE_MISMATCH');}
   must(all.cat.epoch!==snapshot.catalog.epoch&&Object.values(all.cat.shares).every(s=>s.revoked),'RESTORE_ACCESS_NOT_RESET');await denied(()=>store.list({token:input.probe}),403);
   const old=Object.values(snapshot.catalog.entries).find(e=>!e.deleted);await denied(()=>store.save(old.slot,{text:'stale pre-restore revision'},snapshot.catalog.epoch+':'+old.version,randomUUID()),409);
   const bad={...snapshot,records:{...snapshot.records}};bad.records[old.head]+='corrupted';let rejected=false;try{decodeSnapshot(JSON.stringify({data:bad,sha256:hash(JSON.stringify(bad))}));}catch{rejected=true;}must(rejected,'CORRUPT_SNAPSHOT_ACCEPTED');
   details={stored:104,active:(await store.list()).length,byteExact:104};must(details.active===100,'RESTORED_ACTIVE_COUNT_MISMATCH');checks.fullRestoreByteExact=true;checks.restoreOldLinksAndRevisionsDenied=true;checks.corruptRecordRejected=true;
  }else throw new StoreError(400,'INVALID_STAGE');
  return {status:200,code:'STORE100_VERIFIED',passed:true,stage,checks,details,metrics:store.metrics,calls:store.calls,ms:performance.now()-start,...(privateProbe?{privateProbe}:{})};
 }catch(e){return {status:503,code:'STORE100_GATE_FAILED',passed:false,stage,checks,details,metrics:store.metrics,calls:store.calls,errors:[{code:/^[A-Z_0-9]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED',status:e.status??503}],ms:performance.now()-start};}
}
