/* Isolated per-note immutable revisions. A small catalog is the sole commit point.
 * Every mutation uses the inherited collection token, including catalog publication.
 * No generic HTTP owner/share endpoint is exposed by the fixture harness.
 */
import https from 'node:https';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createDav,nativeTransport,hash,lockXml,validToken} from './storage.mjs';
export class StoreError extends Error{constructor(status,code){super(code);this.status=status;}}
const check=(v,status,code)=>{if(!v)throw new StoreError(status,code);};
const clone=x=>JSON.parse(JSON.stringify(x));
const ok=r=>[200,201,204].includes(r.status);
export const validNoteId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export const ownerContext=Object.freeze({owner:true});
export const noteId=slot=>'00000000-0000-4000-8000-'+String(slot).padStart(12,'0');
export const folders=['Công việc','Gia đình','日本語 😀','Riêng tư'];
export function fixtureNote(slot){return {id:noteId(slot),title:'Ghi chú '+slot+' — Tiếng Việt 😀',text:'Dữ liệu giả '+slot+'\n日本語 Unicode\n'+'Nội dung kiểm thử. '.repeat(30),checklist:[{id:'a',text:'Đã làm '+slot,checked:true},{id:'b',text:'Chưa làm '+slot,checked:false}],pinned:slot%10===0,folder:folders[Math.floor(slot/25)%4]};}
function folderName(s){check(typeof s==='string'&&s.trim()&&s.length<=80,400,'INVALID_FOLDER');return s.trim();}
export function noteInput(v){
 check(v&&typeof v.title==='string'&&v.title.trim()&&v.title.length<=200&&typeof v.text==='string'&&v.text.length<=1000000,400,'INVALID_NOTE');
 check(Array.isArray(v.checklist)&&v.checklist.length<=200,400,'INVALID_CHECKLIST');const ids=new Set();
 const checklist=v.checklist.map(x=>{check(x&&typeof x.id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(x.id)&&!ids.has(x.id)&&typeof x.text==='string'&&x.text.length<=2000&&typeof x.checked==='boolean',400,'INVALID_CHECKLIST');ids.add(x.id);return {id:x.id,text:x.text,checked:x.checked};});
 check(Buffer.byteLength(v.text)+Buffer.byteLength(JSON.stringify(checklist))<=1000000,413,'NOTE_TOO_LARGE');
 return {title:v.title,text:v.text,checklist,pinned:v.pinned===true};
}
export function newCapability(){const id=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex');return {id,token:id+'.'+secret,tokenHash:hash(secret)};}
function capability(cat,token){
 check(typeof token==='string'&&/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token),403,'CAPABILITY_DENIED');
 const [id,secret]=token.split('.'),s=cat.shares[id];
 check(s&&!s.revoked&&typeof s.tokenHash==='string'&&/^[a-f0-9]{64}$/.test(s.tokenHash)&&timingSafeEqual(Buffer.from(hash(secret),'hex'),Buffer.from(s.tokenHash,'hex')),403,'CAPABILITY_DENIED');return {id,...s};
}
function can(cat,actor,id,write=false){if(actor?.owner)return null;const s=capability(cat,actor?.token);check(!write||s.permission==='edit',403,'READ_ONLY_SHARE');const e=cat.entries[id];check(e&&!e.deleted&&(s.scope==='note'?s.target===id:s.scope==='folder'&&s.target===e.folder),404,'NOTE_OUTSIDE_SHARE');return s;}
export function parseCatalog(text){let j;try{j=JSON.parse(text);}catch{throw new StoreError(503,'INVALID_CATALOG');}check(j?.schema===1&&typeof j.epoch==='string'&&Number.isSafeInteger(j.version)&&j.entries&&j.folders&&j.shares&&Array.isArray(j.receipts),503,'INVALID_CATALOG');return j;}
export function parseNote(text){let j;try{j=JSON.parse(text);}catch{throw new StoreError(503,'INVALID_NOTE_RECORD');}check(j?.schema===2&&j.value&&hash(JSON.stringify(j.value))===j.valueHash&&Array.isArray(j.value.history),503,'INVALID_NOTE_RECORD');noteInput(j.value);return j;}
function summary(n){return {title:n.title,text:n.text.slice(0,100),pinned:n.pinned,updatedAt:n.updatedAt};}
export async function pool(values,fn,limit=2){let next=0;const out=[];const results=await Promise.allSettled(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const i=next++;out[i]=await fn(values[i],i);}}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return out;}
export class NoteStore{
 // Live run39002374539 rejected inherited-token writes on parallel sockets.
 // Preserve per-session maxSockets=1 unless fresh collection/ACL/100-Note tests pass.
 constructor(input,{makeDav=createDav,wire,lease=60,beforePublish,now=()=>new Date().toISOString()}={}){this.input={...input,transport:'pooled'};this.makeDav=makeDav;this.wire=wire;this.agent=new https.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1,timeout:15000});this.transport=(url,opts,ctx)=>(this.wire??nativeTransport)(url,opts,{...ctx,connectionAgent:this.agent});this.lease=lease;this.beforePublish=beforePublish;this.now=now;this.clients=new Map();this.metrics=[];}
 dav(file='catalog.json'){if(!this.clients.has(file))this.clients.set(file,this.makeDav(this.input,{file,nativeRequest:this.transport}));return this.clients.get(file);}
 get calls(){return [...this.clients.values()].flatMap(d=>d.calls);}
 async readCatalog(){const r=await this.dav().call('catalog-read','GET');check(r.status===200,503,'CATALOG_READ_FAILED');return parseCatalog(r.text);}
 async readRecord(e){const r=await this.dav(e.head).call('immutable-note-read','GET');check(r.status===200&&hash(r.text)===e.headHash,503,'NOTE_HASH_MISMATCH');const n=parseNote(r.text);check(n.value.id===e.id,503,'NOTE_ID_MISMATCH');return n.value;}
 view(cat,e,n){return {...n,folder:e.folder,revision:cat.epoch+':'+e.version};}
 async immutable(file,payload,token,{requestHash}={}){
  const d=this.dav(file),old=await d.call('immutable-check-existing','GET');
  if(old.status===200){if(old.text!==payload&&requestHash){const prior=parseNote(old.text);check(prior.requestHash===requestHash,409,'IMMUTABLE_COLLISION');return old.text;}check(old.text===payload,409,'IMMUTABLE_COLLISION');return old.text;}
  check(old.status===404,503,'IMMUTABLE_LOOKUP_FAILED');
  let put;try{put=await d.call('immutable-create','PUT',payload,{If:'('+token+')'});}catch{const read=await d.call('immutable-reconcile','GET');check(read.status===200&&read.text===payload,503,'IMMUTABLE_OUTCOME_UNKNOWN');return payload;}
  check(ok(put),put.status===412?409:503,'IMMUTABLE_WRITE_REJECTED');const r=await d.call('immutable-verify','GET');check(r.status===200&&r.text===payload,503,'IMMUTABLE_VERIFY_FAILED');return payload;
 }
 async locked(operation,fn){
  const started=performance.now(),callStart=this.calls.length;let token,out,committed=false,code='OK',cleanupWarning;
  try{
   const d=this.dav(),l=await d.call('collection-lock','LOCK',lockXml,{Depth:'infinity',Timeout:'Second-'+this.lease},true);
   check(l.status!==423,423,'BUSY');check([200,201].includes(l.status)&&validToken(l.token),503,'COLLECTION_LOCK_FAILED');token=l.token;
   const cat=await this.readCatalog(),original=JSON.stringify(cat);out=await fn(cat,token);
   if(JSON.stringify(cat)!==original){
    cat.version++;const payload=JSON.stringify(cat);check(Buffer.byteLength(payload)<=240000,413,'CATALOG_TOO_LARGE');
    if(this.beforePublish)await this.beforePublish({token,catalog:cat});
    let put;try{put=await d.call('catalog-publish','PUT',payload,{If:'('+token+')'});}catch{const r=await d.call('catalog-reconcile','GET');check(r.status===200&&r.text===payload,503,'CATALOG_OUTCOME_UNKNOWN');committed=true;}
    if(put){check(ok(put),put.status===412?409:503,'LEASE_OR_PUBLICATION_REJECTED');const r=await d.call('catalog-verify','GET');check(r.status===200&&r.text===payload,503,'CATALOG_OUTCOME_UNKNOWN');committed=true;}
   }
   return out;
  }catch(e){code=e.message;throw e;}
  finally{
   if(token){try{const r=await this.dav().call('collection-unlock','UNLOCK',undefined,{'Lock-Token':token},true);if(![200,204,409].includes(r.status))cleanupWarning='LOCK_RELEASE_UNVERIFIED';}catch{cleanupWarning='LOCK_RELEASE_UNVERIFIED';}}
   this.metrics.push({operation,code,committed,ms:performance.now()-started,providerCalls:this.calls.length-callStart,...(cleanupWarning?{cleanupWarning}:{})});
  }
 }
 async init(){const r=await this.dav().call('new-store','MKCOL',undefined,{},true);check(r.status===201,409,'STORE_ALREADY_EXISTS');const cat={schema:1,epoch:randomUUID(),version:0,restoring:false,folders:Object.fromEntries(folders.map(f=>[f,true])),entries:{},shares:{},receipts:[]};const payload=JSON.stringify(cat);check(ok(await this.dav().call('seed-catalog','PUT',payload)),503,'CATALOG_SEED_FAILED');check((await this.dav().call('seed-catalog-verify','GET')).text===payload,503,'CATALOG_SEED_VERIFY_FAILED');return cat;}
 async seedBatch(start,count=10){return this.locked('seed-batch',async(cat,token)=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');const ids=Array.from({length:count},(_,i)=>start+i);const records=await pool(ids,async slot=>{
   const id=noteId(slot),old=cat.entries[id];if(old)return old;
   const {folder,...core}=fixtureNote(slot),value={...core,updatedAt:this.now(),history:[]},payload=JSON.stringify({schema:2,value,valueHash:hash(JSON.stringify(value))}),head='note-'+String(slot).padStart(3,'0')+'-'+randomUUID()+'.json';await this.immutable(head,payload,token);return {id,slot,head,headHash:hash(payload),folder,version:1,deleted:false,summary:summary(value)};
  });for(const e of records)cat.entries[e.id]=e;return {created:records.length,total:Object.keys(cat.entries).length};});}
 async get(id,actor=ownerContext){return this.locked('get-note',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');can(cat,actor,id);const e=cat.entries[id];check(e&&!e.deleted,404,'NOTE_NOT_FOUND');return this.view(cat,e,await this.readRecord(e));});}
 async list(actor=ownerContext){return this.locked('list-notes',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');const s=actor?.owner?null:capability(cat,actor?.token);const entries=Object.values(cat.entries).filter(e=>!e.deleted&&(!s||(s.scope==='note'?s.target===e.id:s.target===e.folder)));return entries.map(e=>({id:e.id,folder:e.folder,...e.summary,revision:cat.epoch+':'+e.version}));});}
 async save(slot,patch,expected,opId,actor=ownerContext){check(((Number.isInteger(slot)&&slot>=0&&slot<=127)||validNoteId(slot))&&validNoteId(opId),400,'INVALID_OPERATION');return this.locked('save-note',async(cat,token)=>{
  check(!cat.restoring,503,'RESTORE_INCOMPLETE');const id=typeof slot==='number'?noteId(slot):slot,old=cat.entries[id];let share;
  if(actor?.owner){}else{share=capability(cat,actor?.token);check(share.permission==='edit',403,'READ_ONLY_SHARE');if(old)can(cat,actor,id,true);else check(share.scope==='folder',403,'NOTE_SHARE_CANNOT_CREATE');}
  check(!old?.deleted,409,'NOTE_DELETED');
  const requestHash=hash(JSON.stringify({slot,patch,expected,actor:share?.id??'owner'}));const replay=cat.receipts.find(r=>r.opId===opId);if(replay){check(replay.requestHash===requestHash,409,'OP_ID_REUSE');return {id,revision:replay.revision,replay:true};}
  check(old?expected===cat.epoch+':'+old.version:expected===null,409,'REVISION_CONFLICT');
  const current=old?await this.readRecord(old):null;
  let folder=actor?.owner?(patch.folder??old?.folder??''):(old?.folder??share.target);if(folder)folder=folderName(folder);if(folder&&actor?.owner&&!Object.hasOwn(cat.folders,folder))Object.defineProperty(cat.folders,folder,{value:true,enumerable:true,writable:true,configurable:true});check(!folder||Object.hasOwn(cat.folders,folder),400,'FOLDER_NOT_FOUND');
  if(!actor?.owner)check(patch.folder===undefined||patch.folder===folder,403,'SHARE_CANNOT_MOVE');
  const incoming=noteInput({...current,...patch,pinned:actor?.owner?(patch.pinned??current?.pinned):current?.pinned??false,checklist:patch.checklist??current?.checklist??[]});
  const history=current?[{title:current.title,text:current.text,checklist:current.checklist,folder:old.folder,updatedAt:current.updatedAt},...current.history].slice(0,5):[];
  const value={id,...incoming,updatedAt:this.now(),history};while(Buffer.byteLength(JSON.stringify(value))>3000000&&history.length)history.pop();check(Buffer.byteLength(JSON.stringify(value))<=3000000,413,'NOTE_RECORD_TOO_LARGE');
  const payload=JSON.stringify({schema:2,opId,requestHash,value,valueHash:hash(JSON.stringify(value))}),head='note-'+(typeof slot==='number'?String(slot).padStart(3,'0'):slot)+'-'+opId+'.json';const actual=await this.immutable(head,payload,token,{requestHash}),published=parseNote(actual).value;
  const e={id,...(typeof slot==='number'?{slot}:{}),head,headHash:hash(actual),folder,version:(old?.version??0)+1,deleted:false,summary:summary(published)};cat.entries[id]=e;
  const revision=cat.epoch+':'+e.version;cat.receipts=[...cat.receipts,{opId,requestHash,revision}].slice(-24);return {id,revision,replay:false};
 });}
 async remove(id,expected,actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('soft-delete',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');const e=cat.entries[id];check(e,404,'NOTE_NOT_FOUND');if(e.deleted)return {deleted:true};check(expected===cat.epoch+':'+e.version,409,'REVISION_CONFLICT');e.deleted=true;e.version++;return {deleted:true};});}
 async createFolder(name,actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');name=folderName(name);return this.locked('create-folder',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');Object.defineProperty(cat.folders,name,{value:true,enumerable:true,writable:true,configurable:true});return {folder:name};});}
 async deleteFolder(name,deleteNotes=false,actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('delete-folder',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');check(typeof deleteNotes==='boolean',400,'INVALID_FOLDER_DELETE_MODE');check(Object.hasOwn(cat.folders,name),404,'FOLDER_NOT_FOUND');check(!Object.values(cat.shares).some(s=>!s.revoked&&s.scope==='folder'&&s.target===name),409,'FOLDER_STILL_SHARED');for(const e of Object.values(cat.entries))if(!e.deleted&&e.folder===name){e.folder='';e.deleted=deleteNotes;e.version++;}delete cat.folders[name];return {deleted:true};});}
 async share(scope,target,permission='edit',actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('create-share',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');check(['note','folder'].includes(scope)&&['view','edit'].includes(permission),400,'INVALID_SHARE');check(scope==='note'?cat.entries[target]&&!cat.entries[target].deleted:Object.hasOwn(cat.folders,target)&&Object.values(cat.entries).some(e=>!e.deleted&&e.folder===target),404,'SHARE_TARGET_MISSING');const c=newCapability();cat.shares[c.id]={scope,target,permission,tokenHash:c.tokenHash,revoked:false,epoch:1};return {id:c.id,token:c.token};});}
 async revoke(id,actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('revoke-share',async cat=>{const s=cat.shares[id];check(s,404,'SHARE_NOT_FOUND');if(!s.revoked){s.revoked=true;s.epoch++;}return {revoked:true};});}
 async linkInfo(actor){return this.locked('share-info',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');const s=capability(cat,actor?.token);return {scope:s.scope,target:s.target,permission:s.permission};});}
 async links(scope,target,actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('list-shares',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');return Object.entries(cat.shares).filter(([,s])=>s.scope===scope&&s.target===target).map(([id,s])=>({id,revoked:s.revoked,permission:s.permission}));});}
 async folderNames(actor=ownerContext){check(actor?.owner,403,'OWNER_REQUIRED');return this.locked('list-folders',async cat=>{check(!cat.restoring,503,'RESTORE_INCOMPLETE');return Object.keys(cat.folders).sort((a,b)=>a.localeCompare(b,'vi'));});}
 async loginAttempt(key,now=Date.now()){
  check(/^[a-f0-9]{64}$/.test(key),400,'INVALID_LOGIN_BUCKET');return this.locked('login-attempt',async cat=>{
   const bucket=Math.floor(now/900000),old=cat.loginBuckets?.bucket===bucket?cat.loginBuckets:{bucket,global:0,clients:{}};
   check(old.global<30&&(old.clients[key]??0)<5,429,'LOGIN_RATE_LIMITED');
   cat.loginBuckets={bucket,global:old.global+1,clients:{...old.clients,[key]:(old.clients[key]??0)+1}};return {allowed:true};
  });
 }
 async capture(){return this.locked('capture-snapshot',async cat=>clone(cat));}
 async verifyAll(){const cat=await this.capture();const records=await pool(Object.values(cat.entries),async e=>({id:e.id,record:await this.readRecord(e)}));return {cat,records};}
}
