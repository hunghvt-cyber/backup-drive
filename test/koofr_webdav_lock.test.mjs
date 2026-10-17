import test from 'node:test';
import assert from 'node:assert/strict';
import {lockProbe} from '../scripts/koofr_webdav_lock_probe.mjs';
const env={KOOFR_WEBDAV_PROBE:'ISOLATED_SYNTHETIC_ONLY',KOOFR_WEBDAV_USER:'fake@example.invalid',KOOFR_WEBDAV_APP_PASSWORD:'fake-password'};
function server({unsupported=false,ignoreLock=false,ignoreStale=false}={}){let held=false,content='SYNTHETIC initial';const secret='<opaquelocktoken:fake-token>';
 return async(url,o)=>{
  assert.ok(url.includes('/Homepage-Notes-WebDAV-Probe-6fedd63c-5f5a-40e2-988d-ac017ace2cd9/note.md'));assert.equal(o.redirect,'error');
  if(o.method==='GET')return new Response(content,{status:200});
  if(o.method==='LOCK'){if(unsupported)return new Response('',{status:405});if(held)return new Response('',{status:423});held=true;return new Response('<lock/>',{status:200,headers:{'lock-token':secret,timeout:'Second-60'}});}
  if(o.method==='UNLOCK'){assert.equal(o.headers['Lock-Token'],secret);held=false;return new Response(null,{status:204});}
  if(o.method==='PUT'){
   if(held&&o.headers.If!=='('+secret+')'&&!ignoreLock)return new Response('',{status:423});
   if(!held&&o.headers.If&&!ignoreStale)return new Response('',{status:412});content=o.body;return new Response('',{status:201});
  }
  throw Error('unexpected');
 };
}
test('exclusive lock blocks other writes and stale token is fenced after unlock',async()=>{const r=await lockProbe({env,fetcher:server()});assert.equal(r.passed,true);assert.equal(r.checks.staleLockTokenRejected,true);assert.equal(r.possibleOutstandingLock,false);assert.ok(!JSON.stringify(r).includes('fake-token'));assert.ok(!JSON.stringify(r).includes('fake-password'));});
test('advertised but unusable lock is detected',async()=>{const r=await lockProbe({env,fetcher:server({unsupported:true})});assert.equal(r.passed,false);assert.equal(r.errors[0].code,'ADVERTISED_LOCK_NOT_USABLE');});
test('lock that does not protect content fails before authorized write',async()=>{const r=await lockProbe({env,fetcher:server({ignoreLock:true})});assert.equal(r.passed,false);assert.equal(r.errors[0].code,'LOCK_DOES_NOT_PROTECT_CONTENT');});
test('a stale lock token that can overwrite content is rejected as unsafe',async()=>{const r=await lockProbe({env,fetcher:server({ignoreStale:true})});assert.equal(r.passed,false);assert.equal(r.errors[0].code,'STALE_LOCK_TOKEN_NOT_FENCED');});
