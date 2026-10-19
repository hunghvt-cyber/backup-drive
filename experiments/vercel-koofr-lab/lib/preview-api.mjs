/* Synthetic-only HTTP adapter. Never selects or falls back to production Blob. */
import {sealData,unsealData} from 'iron-session';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {NoteStore,StoreError,validNoteId} from './store.mjs';
const cookieName='__Host-homepage-koofr-preview',ttl=7*86400,labProject='prj_ZJDuwQOKVSzqfs3z0IMLAOrlNudX';
const digest=s=>createHash('sha256').update(s).digest('hex');
const need=(v,status,code)=>{if(!v)throw new StoreError(status,code);};
const publicNote=n=>({id:n.id,title:n.title,text:n.text,checklist:n.checklist,revision:n.revision,updatedAt:n.updatedAt});
const jsonHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export function previewConfig(env=process.env){
 need(env.NOTES_PREVIEW_ENABLED==='synthetic-only-v1'&&env.VERCEL_ENV!=='production'&&(!env.VERCEL_PROJECT_ID||env.VERCEL_PROJECT_ID===labProject),503,'PREVIEW_DISABLED');
 const origin=env.PREVIEW_BASE_URL||(env.VERCEL_URL?'https://'+env.VERCEL_URL:'');let u;try{u=new URL(origin);}catch{}need(u&&u.protocol==='https:'&&u.origin===origin,503,'PREVIEW_ORIGIN_MISSING');
 need(typeof env.PREVIEW_SESSION_PASSWORD==='string'&&env.PREVIEW_SESSION_PASSWORD.length>=32&&typeof env.PREVIEW_PORTAL_PASSWORD==='string'&&env.PREVIEW_PORTAL_PASSWORD.length>=12,503,'PREVIEW_AUTH_MISSING');
 need(typeof env.KOOFR_NOTES_USER==='string'&&env.KOOFR_NOTES_USER.length>0&&env.KOOFR_NOTES_USER.length<300&&!/[:\r\n]/.test(env.KOOFR_NOTES_USER)&&typeof env.KOOFR_NOTES_APP_PASSWORD==='string'&&env.KOOFR_NOTES_APP_PASSWORD.length>0&&!/[\r\n]/.test(env.KOOFR_NOTES_APP_PASSWORD),503,'PREVIEW_STORAGE_MISSING');
 need(/^Homepage-Notes-Vercel-Probe-\d{1,20}-[a-f0-9-]{36}$/.test(env.KOOFR_NOTES_NAMESPACE??''),503,'PREVIEW_NAMESPACE_FORBIDDEN');
 return {origin,sessionPassword:env.PREVIEW_SESSION_PASSWORD,portalPassword:env.PREVIEW_PORTAL_PASSWORD,namespace:env.KOOFR_NOTES_NAMESPACE,user:env.KOOFR_NOTES_USER,password:env.KOOFR_NOTES_APP_PASSWORD};
}
async function body(request){const reader=request.body?.getReader();need(reader,400,'INVALID_JSON');const decoder=new TextDecoder();let text='',bytes=0;try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>3000000){await reader.cancel();throw new StoreError(413,'REQUEST_TOO_LARGE');}text+=decoder.decode(value,{stream:true});}const b=JSON.parse(text+decoder.decode());need(b&&typeof b==='object'&&!Array.isArray(b),400,'INVALID_JSON');return b;}catch(e){throw e.status?e:new StoreError(400,'INVALID_JSON');}}
function sameOrigin(request,cfg){need(request.headers.get('origin')===cfg.origin,403,'ORIGIN_DENIED');need((request.headers.get('content-type')??'').startsWith('application/json'),415,'JSON_REQUIRED');need(request.headers.get('sec-fetch-site')!=='cross-site',403,'ORIGIN_DENIED');}
async function authenticated(request,cfg){
 const parts=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));if(parts.length!==1)return false;
 try{const s=await unsealData(parts[0].slice(cookieName.length+1),{password:cfg.sessionPassword,ttl});return s.scope==='koofr-notes-synthetic-preview-v1'&&s.authVersion===digest(cfg.portalPassword)&&s.namespaceHash===digest(cfg.namespace);}catch{return false;}
}
function cookie(value,maxAge=ttl){return cookieName+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;}
const id=value=>{need(validNoteId(value),400,'INVALID_NOTE_ID');return value;};
const operation=b=>{need(validNoteId(b.clientOpId),400,'CLIENT_OP_ID_REQUIRED');return b.clientOpId;};
function input(b,{shared=false}={}){if(shared)need(b.folder===undefined&&b.pinned===undefined,403,'SHARE_CANNOT_MOVE_OR_PIN');return Object.fromEntries(['title','text','checklist',...(shared?[]:['pinned','folder'])].filter(k=>b[k]!==undefined).map(k=>[k,b[k]]));}
function delta(notes,known){if(known===null)return {notes};need(known.length<=6000,400,'INVALID_KNOWN_REVISIONS');let pairs;try{pairs=JSON.parse(known);}catch{throw new StoreError(400,'INVALID_KNOWN_REVISIONS');}need(Array.isArray(pairs)&&pairs.length<=500&&pairs.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string'&&v.length<=200)),400,'INVALID_KNOWN_REVISIONS');const old=new Map(pairs),ids=new Set(notes.map(n=>n.id));return {delta:true,notes:notes.filter(n=>old.get(n.id)!==n.revision),removed:[...old.keys()].filter(k=>!ids.has(k))};}
export function createPreviewHandler({env=()=>process.env,makeStore=({user,password,namespace})=>new NoteStore({user,password,namespace}),observe=x=>console.info(JSON.stringify(x))}={}){
 return async request=>{
  const reference='KP-'+randomUUID().slice(0,8),started=performance.now();let store,route='unknown',stage='configure',mutating=request.method!=='GET';
  const reply=(status,value,headers={})=>{
   try{observe({kind:'koofr-api-preview',reference,route,method:request.method,stage,status,ms:performance.now()-started,...(store?{storageMetrics:store.metrics.map(({operation,code,committed,ms,cleanupWarning})=>({operation,code,committed,ms,...(cleanupWarning?{cleanupWarning}:{})}))}:{})});}catch{}
   return Response.json(value,{status,headers:{...jsonHeaders,'X-Notes-Request':reference,...headers}});
  };
  try{
   const url=new URL(request.url);route=url.searchParams.get('route')??'health';
   need(['health','auth','notes','notes-save','folders','note-share','shared-note','shared-folder'].includes(route),404,'ROUTE_NOT_FOUND');
   if(route==='health'){need(request.method==='GET',405,'METHOD_NOT_ALLOWED');let configured=false;try{previewConfig(env());configured=true;}catch{}return reply(200,{kind:'koofr-notes-synthetic-api-preview',configured,production:false});}
   const cfg=previewConfig(env());need(url.origin===cfg.origin,403,'HOST_DENIED');
   stage='method';need(['GET','POST','DELETE'].includes(request.method),405,'METHOD_NOT_ALLOWED');
   if(mutating)sameOrigin(request,cfg);
   const shared=route==='shared-note'||route==='shared-folder';stage='authorize';
   if(!shared&&route!=='auth')need(await authenticated(request,cfg),401,'LOGIN_REQUIRED');
   if(route==='auth'&&request.method==='GET')return reply(200,{authenticated:await authenticated(request,cfg)});
   if(route==='auth'&&request.method==='DELETE')return reply(200,{authenticated:false},{'Set-Cookie':cookie('',0)});
   need(request.method!=='DELETE',405,'METHOD_NOT_ALLOWED');
   stage='validate';const b=request.method==='POST'?await body(request):null;store=makeStore(cfg);
   if(route==='auth'){
    // The provider-side counter shares the root lock across all function instances.
    const ip=(request.headers.get('x-vercel-forwarded-for')??'unknown').split(',')[0].trim();await store.loginAttempt(createHmac('sha256',cfg.sessionPassword).update(ip).digest('hex'));
    const valid=typeof b.password==='string'&&b.password.length<=256&&timingSafeEqual(Buffer.from(digest(b.password),'hex'),Buffer.from(digest(cfg.portalPassword),'hex'));need(valid,401,'INVALID_PASSWORD');
    const value=await sealData({scope:'koofr-notes-synthetic-preview-v1',authVersion:digest(cfg.portalPassword),namespaceHash:digest(cfg.namespace)},{password:cfg.sessionPassword,ttl});return reply(200,{authenticated:true},{'Set-Cookie':cookie(value)});
   }
   let actor={owner:true},link;
   if(shared){const token=request.headers.get('authorization')?.replace(/^Bearer /,'');need(typeof token==='string'&&/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token),403,'CAPABILITY_DENIED');actor={token};link=await store.linkInfo(actor);need(link.scope===(route==='shared-note'?'note':'folder'),403,'WRONG_SHARE_SCOPE');}
   stage='storage';
   if(route==='notes'||route==='notes-save'){
    if(request.method==='GET'){
     need(route==='notes',405,'METHOD_NOT_ALLOWED');const noteId=url.searchParams.get('id');if(noteId){const n=await store.get(id(noteId),actor);return reply(200,url.searchParams.get('revision')===n.revision?{notModified:true,revision:n.revision}:n);}
     const notes=await store.list(actor);notes.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));return reply(200,{...delta(notes,url.searchParams.get('known')),previewOnly:true,fullTextSearchAvailable:false});
    }
    need(b.action==='save'||(route==='notes'&&['delete','folderDelete'].includes(b.action)),400,'INVALID_ACTION');
    if(b.action==='delete')return reply(200,await store.remove(id(b.id),b.revision,actor));
    if(b.action==='folderDelete')return reply(200,await store.deleteFolder(b.folder,b.deleteNotes,actor));
    const op=operation(b),noteId=b.id?id(b.id):op,expected=b.revision??null;need(expected===null||typeof expected==='string',400,'INVALID_REVISION');const result=await store.save(noteId,input(b),expected,op,actor);const n=await store.get(noteId,actor);
    // Replay may refer to an older commit; return live content + its own revision.
    return reply(200,{...n,clientOpId:op,replay:result.replay,acknowledgedRevision:result.revision});
   }
   if(route==='folders'){if(request.method==='GET')return reply(200,{folders:await store.folderNames(actor)});need(b.action==='create',400,'INVALID_ACTION');return reply(200,await store.createFolder(b.folder,actor));}
   if(route==='note-share'){
    const data=b??Object.fromEntries(url.searchParams),scope=data.folder?'folder':'note',target=data.folder??id(data.noteId);
    if(request.method==='GET')return reply(200,{links:await store.links(scope,target,actor)});
    need(['create','revoke'].includes(b.action),400,'INVALID_ACTION');if(b.action==='create')return reply(200,await store.share(scope,target,b.permission??'edit',actor));
    need(typeof b.id==='string'&&/^[a-f0-9]{32}$/.test(b.id),400,'INVALID_SHARE_ID');const links=await store.links(scope,target,actor);need(links.some(l=>l.id===b.id),404,'SHARE_NOT_FOUND');return reply(200,await store.revoke(b.id,actor));
   }
   if(shared){
    const noteId=route==='shared-note'?link.target:(b?.id??url.searchParams.get('id'));
    if(request.method==='GET'){
     if(!noteId)return reply(200,{folder:link.target,notes:await store.list(actor),previewOnly:true});return reply(200,publicNote(await store.get(id(noteId),actor)));
    }
    need(b.action==='save',400,'INVALID_ACTION');const op=operation(b),target=noteId?id(noteId):op;const result=await store.save(target,input(b,{shared:true}),b.revision??null,op,actor);const n=await store.get(target,actor);return reply(200,{...publicNote(n),clientOpId:op,replay:result.replay,acknowledgedRevision:result.revision});
   }
   throw new StoreError(404,'ROUTE_NOT_FOUND');
  }catch(e){const status=e.status??503,code=e.status&&/^[A-Z_0-9]{1,80}$/.test(e.message)?e.message:'STORAGE_UNAVAILABLE';return reply(status,{code,error:status===409?'Note đã thay đổi; giữ bản nháp để đối chiếu.':status===503?'Chưa xác minh được kết quả; giữ bản nháp và mã thao tác để thử lại.':'Yêu cầu chưa được chấp nhận.',reference,...(status===503&&mutating?{outcome:stage==='configure'?'not-started':'unconfirmed'}:{})},status===423||status===429?{'Retry-After':status===429?'900':'1'}:{});}
  finally{store?.agent.destroy();}
 };
}
