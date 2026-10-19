import {randomUUID} from 'node:crypto';
import {NoteStore,StoreError,parseCatalog,parseNote,pool} from './store.mjs';
import {hash,lockXml,validToken} from './storage.mjs';
const check=(x,code)=>{if(!x)throw new StoreError(503,code);};
export function encodeSnapshot(catalog,records){const data={format:'homepage-koofr-store-backup-v1',catalog,records};return JSON.stringify({data,sha256:hash(JSON.stringify(data))});}
export function decodeSnapshot(text){let j;try{j=JSON.parse(text);}catch{throw new StoreError(400,'INVALID_SNAPSHOT');}check(j?.data?.format==='homepage-koofr-store-backup-v1'&&j.sha256===hash(JSON.stringify(j.data)),'INVALID_SNAPSHOT');const cat=parseCatalog(JSON.stringify(j.data.catalog));check(j.data.records&&Object.keys(j.data.records).length===Object.keys(cat.entries).length,'SNAPSHOT_COUNT_MISMATCH');for(const e of Object.values(cat.entries)){const raw=j.data.records[e.head];check(typeof raw==='string'&&hash(raw)===e.headHash,'SNAPSHOT_NOTE_HASH_MISMATCH');const n=parseNote(raw);check(n.value.id===e.id,'SNAPSHOT_ID_MISMATCH');}return j.data;}
export async function exportStore(store){const catalog=await store.capture(),records={};check(!catalog.restoring,'RESTORE_INCOMPLETE');await pool(Object.values(catalog.entries),async e=>{const r=await store.dav(e.head).call('snapshot-source-read','GET');check(r.status===200&&hash(r.text)===e.headHash,'EXPORT_SOURCE_HASH_MISMATCH');records[e.head]=r.text;});const text=encodeSnapshot(catalog,records);check(Buffer.byteLength(text)<=2000000,'SNAPSHOT_TOO_LARGE');decodeSnapshot(text);await store.locked('export-snapshot',async(_cat,token)=>{const d=store.dav('store-backup.json'),old=await d.call('snapshot-check-existing','GET');check(old.status===404,'SNAPSHOT_ALREADY_EXISTS');let put;try{put=await d.call('snapshot-write','PUT',text,{If:'('+token+')'});}catch{}if(put)check([200,201,204].includes(put.status),'SNAPSHOT_WRITE_FAILED');const r=await d.call('snapshot-verify','GET');check(r.status===200&&r.text===text,'SNAPSHOT_READBACK_FAILED');});return {count:Object.keys(records).length,active:Object.values(catalog.entries).filter(e=>!e.deleted).length,bytes:Buffer.byteLength(text),sha256:hash(text)};}
export async function loadSnapshot(store){const r=await store.dav('store-backup.json').call('durable-snapshot-read','GET');check(r.status===200,'SNAPSHOT_READ_FAILED');return decodeSnapshot(r.text);}
const snapshotIdentity=s=>hash(JSON.stringify(s));
const success=r=>[200,201,204].includes(r.status);
const conflict=(ok,code)=>{if(!ok)throw new StoreError(409,code);};
async function verifiedPut(d,label,payload,token){
 let put;try{put=await d.call(label,'PUT',payload,{If:'('+token+')'});}catch{}
 if(put)check(success(put),'RESTORE_INIT_WRITE_REJECTED');
 const r=await d.call(label+'-verify','GET');check(r.status===200&&r.text===payload,'RESTORE_INIT_OUTCOME_UNKNOWN');
}
// A durable marker proves ownership before a retry may initialize an existing root.
// An unmarked pre-existing root is NEVER adopted, even after an ambiguous MKCOL.
export async function initRestore(target,source){
 conflict(target.input.namespace!==source.input.namespace,'RESTORE_SOURCE_IS_TARGET');
 const snapshot=await loadSnapshot(source),snapshotHash=snapshotIdentity(snapshot),d=target.dav(),marker=target.dav('restore-control.json');
 const expected={format:'homepage-restore-reservation-v1',snapshotHash,sourceEpoch:snapshot.catalog.epoch};const payload=JSON.stringify(expected);
 let created;try{created=await d.call('restore-new-root','MKCOL',undefined,{},true);}catch{}
 if(created)check([201,405,409].includes(created.status),'RESTORE_ROOT_CREATE_FAILED');
 const started=performance.now();let token,code='OK',cleanupWarning;
 try{
  const l=await d.call('restore-init-lock','LOCK',lockXml,{Depth:'infinity',Timeout:'Second-60'},true);
  if(l.status===423)throw new StoreError(423,'BUSY');
  check([200,201].includes(l.status)&&validToken(l.token),'RESTORE_INIT_LOCK_FAILED');token=l.token;
  const reservation=await marker.call('restore-marker-read','GET');
  if(reservation.status===404){
   conflict(created?.status===201,'RESTORE_RESERVATION_MISSING');
   // Do not adopt a root that has a catalog from another writer, even after MKCOL201.
   const old=await d.call('restore-empty-target-check','GET');conflict(old.status===404,'RESTORE_TARGET_OCCUPIED');
   await verifiedPut(marker,'restore-marker-write',payload,token);
  }else{
   check(reservation.status===200,'RESTORE_MARKER_READ_FAILED');
   conflict(reservation.text===payload,'RESTORE_RESERVATION_MISMATCH');
  }
  const current=await d.call('restore-initial-catalog-read','GET');let cat,replay=false;
  if(current.status===200){
   cat=parseCatalog(current.text);conflict(cat.restoreSnapshotHash===snapshotHash&&cat.sourceEpoch===snapshot.catalog.epoch,'RESTORE_TARGET_OCCUPIED');replay=true;
  }else{
   check(current.status===404,'RESTORE_INITIAL_CATALOG_READ_FAILED');
   const count=Object.keys(snapshot.catalog.entries).length;
   cat={schema:1,epoch:randomUUID(),version:0,restoring:count>0,sourceEpoch:snapshot.catalog.epoch,restoreSnapshotHash:snapshotHash,expectedCount:count,folders:snapshot.catalog.folders,entries:{},shares:Object.fromEntries(Object.entries(snapshot.catalog.shares).map(([id,s])=>[id,{...s,revoked:true,epoch:s.epoch+1}])),receipts:[]};
   await verifiedPut(d,'restore-initial-catalog-write',JSON.stringify(cat),token);
  }
  return {count:cat.expectedCount,restored:Object.keys(cat.entries).length,restoring:cat.restoring,replay,active:Object.values(snapshot.catalog.entries).filter(e=>!e.deleted).length,sharesRevoked:Object.keys(snapshot.catalog.shares).length,newEpoch:cat.epoch!==snapshot.catalog.epoch};
 }catch(e){code=e.status?e.message:'RESTORE_INIT_OUTCOME_UNKNOWN';throw e.status?e:new StoreError(503,code);}
 finally{
  if(token){try{const r=await d.call('restore-init-unlock','UNLOCK',undefined,{'Lock-Token':token},true);if(![200,204,409].includes(r.status))cleanupWarning='LOCK_RELEASE_UNVERIFIED';}catch{cleanupWarning='LOCK_RELEASE_UNVERIFIED';}}
  target.metrics.push({operation:'restore-initialize',code,ms:performance.now()-started,...(cleanupWarning?{cleanupWarning}:{})});
 }
}
export async function restoreBatch(target,source,chunk){
 const snapshot=await loadSnapshot(source),snapshotHash=snapshotIdentity(snapshot),all=Object.values(snapshot.catalog.entries).sort((a,b)=>a.id.localeCompare(b.id));
 check(Number.isInteger(chunk)&&chunk>=0,'RESTORE_CHUNK_INVALID');const entries=all.slice(chunk*10,chunk*10+10);
 check(entries.length>0||(all.length===0&&chunk===0),'RESTORE_CHUNK_INVALID');
 return target.locked('restore-batch',async(cat,token)=>{
  check(cat.sourceEpoch===snapshot.catalog.epoch&&cat.restoreSnapshotHash===snapshotHash,'RESTORE_SOURCE_CHANGED');
  if(!cat.restoring){if(!entries.every(e=>JSON.stringify(cat.entries[e.id])===JSON.stringify(e)))throw new StoreError(409,'RESTORE_ALREADY_COMPLETED_AND_EDITED');return {count:Object.keys(cat.entries).length,restoring:false,chunk,replay:true};}
  await pool(entries,async e=>{await target.immutable(e.head,snapshot.records[e.head],token);cat.entries[e.id]=e;});
  const count=Object.keys(cat.entries).length;if(count===cat.expectedCount)cat.restoring=false;return {count,restoring:cat.restoring,chunk};
 });
}
