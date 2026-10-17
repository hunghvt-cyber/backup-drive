import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,randomBytes} from 'node:crypto';
import {credentials,probe} from '../scripts/koofr_webdav_probe.mjs';
const key=Buffer.from('9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638','hex');
function obscure(s){const iv=randomBytes(16),c=createCipheriv('aes-256-ctr',key,iv);return Buffer.concat([iv,c.update(s),c.final()]).toString('base64url');}
const env={KOOFR_WEBDAV_PROBE:'ISOLATED_SYNTHETIC_ONLY',KOOFR_WEBDAV_USER:'synthetic@example.invalid',KOOFR_WEBDAV_APP_PASSWORD:'synthetic-app-password'};
function server({ignoreUpdate=false,ignoreCreate=false,ignoreDelete=false,network=false,weak=false}={}){
 const files=new Map();let seq=0;const urls=[];
 const fetcher=async(url,o)=>{
  urls.push(url);assert.ok(url.startsWith('https://app.koofr.net/dav/Koofr/Homepage-Notes-WebDAV-Probe-'));assert.equal(o.redirect,'error');assert.equal(o.headers.Authorization,'Basic '+Buffer.from(env.KOOFR_WEBDAV_USER+':'+env.KOOFR_WEBDAV_APP_PASSWORD).toString('base64'));
  if(network)throw Error('sensitive raw network body');
  const old=files.get(url),method=o.method;
  if(method==='MKCOL')return new Response('',{status:201});
  if(method==='PROPFIND')return new Response('<d:multistatus xmlns:d="DAV:"/>',{status:207});
  if(method==='GET'){
   if(!old)return new Response('',{status:404});
   if(o.headers['If-None-Match']===old.etag)return new Response(null,{status:304});
   return new Response(old.body,{status:200,headers:{etag:weak?'W/'+old.etag:old.etag}});
  }
  if(method==='PUT'){
   if(old&&o.headers['If-None-Match']==='*'&&!ignoreCreate)return new Response('',{status:412});
   if(o.headers['If-Match']&&o.headers['If-Match']!==old?.etag&&!ignoreUpdate)return new Response('',{status:412});
   files.set(url,{body:o.body,etag:'"r'+(++seq)+'"'});return new Response(old?null:'',{status:old?204:201});
  }
  if(method==='DELETE'){
   if(o.headers['If-Match']!==old?.etag&&!ignoreDelete)return new Response('',{status:412});files.delete(url);return new Response(null,{status:204});
  }
  throw Error('unsupported');
 };
 return {fetcher,files,urls};
}
test('existing backup config is used in memory without unrelated remote access',()=>{
 const config='[gdrive]\ntype = drive\ntoken = DO_NOT_USE\n[koofr]\ntype = koofr\nprovider = koofr\nuser = '+env.KOOFR_WEBDAV_USER+'\npassword = '+obscure(env.KOOFR_WEBDAV_APP_PASSWORD)+'\n';
 const got=credentials({RCLONE_CONFIG_CONTENT:Buffer.from(config).toString('base64')});assert.equal(got.user,env.KOOFR_WEBDAV_USER);assert.equal(got.password,env.KOOFR_WEBDAV_APP_PASSWORD);assert.equal(got.source,'existing_koofr_remote');
});
test('alternate endpoints and external mounts cannot reuse existing credentials',()=>{
 for(const extra of ['endpoint = https://example.invalid/','mountid = external-drive']){
 const config='[koofr]\ntype = koofr\nuser = '+env.KOOFR_WEBDAV_USER+'\npassword = '+obscure(env.KOOFR_WEBDAV_APP_PASSWORD)+'\n'+extra;
 assert.throws(()=>credentials({RCLONE_CONFIG_CONTENT:Buffer.from(config).toString('base64')}),/EXISTING_REMOTE_NOT_COMPATIBLE/);
 }
});
test('full synthetic CRUD/concurrency/conditional read and discarded response pass without exposing credentials',async()=>{
 const s=server(),r=await probe({env,fetcher:s.fetcher,racePairs:12,samples:3});assert.equal(r.passed,true);assert.equal(r.racePairsVerified,12);assert.equal(r.checks.ifMatchUpdate,true);assert.equal(r.checks.ifNoneMatchCreate,true);assert.equal(r.checks.responseDiscardReconciled,true);assert.equal(r.checks.delete,true);assert.equal(s.files.size,1);assert.equal(r.summary['benchmark-put'].attempted,3);const serialized=JSON.stringify(r);assert.ok(!serialized.includes(env.KOOFR_WEBDAV_APP_PASSWORD));assert.ok(!serialized.includes(env.KOOFR_WEBDAV_USER));assert.ok(s.urls.every(x=>!x.includes('GoogleBackup')));
});
test('ignored create guard, ignored stale update and weak ETags fail closed',async()=>{
 for(const [options,code] of [[{ignoreCreate:true},'CREATE_PRECONDITION_NOT_ENFORCED'],[{ignoreUpdate:true},'STALE_PRECONDITION_NOT_ENFORCED'],[{weak:true},'STRONG_ETAG_REQUIRED']]){
  const s=server(options),r=await probe({env,fetcher:s.fetcher,racePairs:2,samples:2});assert.equal(r.passed,false);assert.equal(r.errors[0].code,code);assert.equal(r.summary['benchmark-put'].attempted,0);
 }
});
test('delete ignoring If-Match is detected; the retained Note is not deleted',async()=>{
 const s=server({ignoreDelete:true}),r=await probe({env,fetcher:s.fetcher,racePairs:2,samples:2});assert.equal(r.errors[0].code,'DELETE_PRECONDITION_NOT_ENFORCED');assert.ok([...s.files.keys()].some(x=>x.endsWith('/note.md')));
});
test('missing setup, disabled probe and raw network errors never disclose input',async()=>{
 const absent=await probe({env:{KOOFR_WEBDAV_PROBE:'ISOLATED_SYNTHETIC_ONLY'}});assert.equal(absent.errors[0].code,'ONE_TIME_SETUP_REQUIRED');assert.equal(absent.calls.length,0);
 const disabled=await probe({env:{...env,KOOFR_WEBDAV_PROBE:''}});assert.equal(disabled.errors[0].code,'PROBE_DISABLED');
 const r=await probe({env,fetcher:server({network:true}).fetcher});assert.equal(r.errors[0].code,'NETWORK_OR_TIMEOUT');assert.ok(!JSON.stringify(r).includes('sensitive raw'));
});
