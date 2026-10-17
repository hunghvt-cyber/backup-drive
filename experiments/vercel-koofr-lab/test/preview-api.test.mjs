import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {backend} from './helpers/collection.mjs';
import {NoteStore} from '../lib/store.mjs';
import {createPreviewHandler} from '../lib/preview-api.mjs';
function setup(){const b=backend(),namespace='Homepage-Notes-Vercel-Probe-123-'+randomUUID();const cfg={NOTES_PREVIEW_ENABLED:'synthetic-only-v1',VERCEL_ENV:'preview',PREVIEW_BASE_URL:'https://preview.example',PREVIEW_SESSION_PASSWORD:randomUUID()+randomUUID(),PREVIEW_PORTAL_PASSWORD:'synthetic-test-password',KOOFR_NOTES_USER:'fake',KOOFR_NOTES_APP_PASSWORD:'synthetic-secret',KOOFR_NOTES_NAMESPACE:namespace};const stores=[],logs=[];const makeStore=x=>{const s=new NoteStore(x,{makeDav:b.makeDav,wire:b.wire});stores.push(s);return s;};const handler=createPreviewHandler({env:()=>cfg,makeStore,observe:x=>logs.push(x)});return {b,cfg,logs,stores,makeStore,handler,async init(){await makeStore({user:'fake',password:'synthetic-secret',namespace}).init();}};}
async function call(s,route,{method='GET',data,session,cap,origin='https://preview.example',query=''}={}){
 const r=await s.handler(new Request('https://preview.example/api/preview?route='+route+query,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(session?{Cookie:session}:{}),...(cap?{Authorization:'Bearer '+cap}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})}));return {r,status:r.status,body:await r.json(),session:r.headers.get('set-cookie')?.split(';')[0]};
}
async function owner(s){const r=await call(s,'auth',{method:'POST',data:{password:s.cfg.PREVIEW_PORTAL_PASSWORD}});assert.equal(r.status,200);assert.match(r.r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);return r.session;}
test('preview defaults closed, refuses production/project/namespace config; no storage calls before owner auth',async()=>{
 const s=setup();delete s.cfg.NOTES_PREVIEW_ENABLED;assert.equal((await call(s,'notes')).status,503);assert.equal((await call(s,'health')).body.configured,false);
 s.cfg.NOTES_PREVIEW_ENABLED='synthetic-only-v1';assert.equal((await call(s,'notes')).status,401);assert.equal(s.b.requests.length,0);
 s.cfg.VERCEL_ENV='production';assert.equal((await call(s,'notes')).status,503);s.cfg.VERCEL_ENV='preview';s.cfg.KOOFR_NOTES_NAMESPACE='real-notes';assert.equal((await call(s,'notes')).status,503);
});
test('session login, Origin/JSON checks, tamper, logout and password rotation keep owner API private',async()=>{
 const s=setup();await s.init();const session=await owner(s);assert.equal((await call(s,'notes',{session})).status,200);
 assert.equal((await call(s,'notes-save',{method:'POST',session,origin:'https://attacker.example',data:{action:'save'}})).status,403);
 const [name,value]=session.split('='),at=value.indexOf('~')-5,tampered=name+'='+value.slice(0,at)+(value[at]==='A'?'B':'A')+value.slice(at+1);assert.equal((await call(s,'notes',{session:tampered})).status,401);assert.equal((await call(s,'notes',{session:session+'; '+session})).status,401);
 const raw=await s.handler(new Request('https://preview.example/api/preview?route=notes-save',{method:'POST',headers:{Cookie:session,Origin:s.cfg.PREVIEW_BASE_URL,'Content-Type':'text/plain'},body:'{}'}));assert.equal(raw.status,415);
 const out=await call(s,'auth',{method:'DELETE',session});assert.equal(out.status,200);assert.match(out.r.headers.get('set-cookie'),/Max-Age=0/);
 s.cfg.PREVIEW_PORTAL_PASSWORD='changed-test-password';assert.equal((await call(s,'notes',{session})).status,401);
});
test('UUID creation is stable across retry, handles >28KB Unicode, conditional fetch and list delta',async()=>{
 const s=setup();await s.init();const session=await owner(s),op=randomUUID(),data={action:'save',clientOpId:op,title:'UUID thật',text:'đ😀'.repeat(12000),checklist:[{id:'done',text:'Đã làm',checked:true}],folder:'Thư mục mới',pinned:true};
 const saved=await call(s,'notes-save',{method:'POST',session,data});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.id,op);assert.equal(saved.body.text,data.text);assert.equal(saved.body.folder,data.folder);
 const retry=await call(s,'notes-save',{method:'POST',session,data});assert.equal(retry.status,200);assert.equal(retry.body.replay,true);assert.equal(retry.body.revision,saved.body.revision);
 const unchanged=await call(s,'notes',{session,query:'&id='+op+'&revision='+encodeURIComponent(saved.body.revision)});assert.equal(unchanged.body.notModified,true);
 const list=await call(s,'notes',{session,query:'&known='+encodeURIComponent(JSON.stringify([[op,saved.body.revision]]))});assert.equal(list.body.delta,true);assert.deepEqual(list.body.notes,[]);assert.equal(list.body.previewOnly,true);
 const stale=await call(s,'notes-save',{method:'POST',session,data:{...data,id:op,clientOpId:randomUUID(),revision:'old',text:'do not overwrite'}});assert.equal(stale.status,409);
 assert.equal((await call(s,'notes-save',{method:'POST',session,data:{...data,clientOpId:undefined}})).status,400);
 assert.ok(!JSON.stringify(s.logs).includes(data.text));assert.ok(!JSON.stringify(s.logs).includes(s.cfg.PREVIEW_PORTAL_PASSWORD));assert.ok(!JSON.stringify(s.logs).includes('synthetic-secret'));
});
test('public note/folder edit and view scopes reject cross-scope access, pin/move and revoked retry',async()=>{
 const s=setup();await s.init();const session=await owner(s),op=randomUUID();const n=await call(s,'notes-save',{method:'POST',session,data:{action:'save',clientOpId:op,title:'Shared',text:'original',folder:'Shared folder'}});
 const create=permission=>call(s,'note-share',{method:'POST',session,data:{action:'create',noteId:op,permission}});const link=await create('edit'),view=await create('view');
 const cap=link.body.token;assert.equal((await call(s,'shared-note',{cap})).status,200);assert.equal((await call(s,'shared-folder',{cap})).status,403);
 const edit={action:'save',clientOpId:randomUUID(),revision:n.body.revision,title:'Shared',text:'edited'};const changed=await call(s,'shared-note',{method:'POST',cap,data:edit});assert.equal(changed.status,200);assert.ok(!('history' in changed.body));assert.ok(!('folder' in changed.body));
 assert.equal((await call(s,'shared-note',{method:'POST',cap,data:{...edit,clientOpId:randomUUID(),pinned:true}})).status,403);
 assert.equal((await call(s,'shared-note',{method:'POST',cap:view.body.token,data:{...edit,revision:changed.body.revision,clientOpId:randomUUID()}})).status,403);
 await call(s,'note-share',{method:'POST',session,data:{action:'revoke',noteId:op,id:link.body.id}});assert.equal((await call(s,'shared-note',{method:'POST',cap,data:edit})).status,403);
 const f=await call(s,'note-share',{method:'POST',session,data:{action:'create',folder:'Shared folder'}});const made=await call(s,'shared-folder',{method:'POST',cap:f.body.token,data:{action:'save',clientOpId:randomUUID(),title:'Folder created',text:'Unicode 日本語'}});assert.equal(made.status,200);
 const listed=await call(s,'shared-folder',{cap:f.body.token});assert.equal(listed.body.notes.length,2);assert.ok(listed.body.notes.every(x=>x.folder==='Shared folder'));
});
test('login rate limit is durable across handlers; no process-only IP limiter',async()=>{
 const s=setup();await s.init();for(let i=0;i<5;i++)assert.equal((await call(s,'auth',{method:'POST',data:{password:'wrong'}})).status,401);
 const next=await call(s,'auth',{method:'POST',data:{password:s.cfg.PREVIEW_PORTAL_PASSWORD}});assert.equal(next.status,429);assert.equal(next.r.headers.get('retry-after'),'900');
});
test('actual local HTTP server preserves route status, privacy headers, session cookie and CRUD roundtrip',async t=>{
 const s=setup();await s.init();const server=createServer(async(req,res)=>{const request=new Request(s.cfg.PREVIEW_BASE_URL+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const r=await s.handler(request);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port+'/api/preview?route=';
 const login=await fetch(base+'auth',{method:'POST',headers:{Origin:s.cfg.PREVIEW_BASE_URL,'Content-Type':'application/json'},body:JSON.stringify({password:s.cfg.PREVIEW_PORTAL_PASSWORD})});assert.equal(login.status,200);const session=login.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'notes-save',{method:'POST',headers:{Origin:s.cfg.PREVIEW_BASE_URL,'Content-Type':'application/json',Cookie:session},body:JSON.stringify({action:'save',clientOpId:randomUUID(),title:'HTTP test',text:'日本語'})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const n=await r.json();
 const read=await fetch(base+'notes&id='+n.id,{headers:{Cookie:session}});assert.equal(read.status,200);assert.equal((await read.json()).text,'日本語');
});
