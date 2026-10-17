/* Test the advertised lock implementation on ONE retained synthetic file only. */
import {credentials} from './koofr_webdav_probe.mjs';
import {writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const namespace='Homepage-Notes-WebDAV-Probe-6fedd63c-5f5a-40e2-988d-ac017ace2cd9';
const url='https://app.koofr.net/dav/Koofr/'+namespace+'/note.md';
export async function lockProbe({env=process.env,fetcher=fetch}={}){
const report={kind:'KOOFR_WEBDAV_ADVERTISED_LOCK_DIAGNOSTIC',at:new Date().toISOString(),namespace,completed:false,passed:false,calls:[],checks:{},errors:[]};
const digest=s=>createHash('sha256').update(s).digest('hex');
const xml='<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>Homepage synthetic probe</D:owner></D:lockinfo>';
let token,release;
try{
 if(env.KOOFR_WEBDAV_PROBE!=='ISOLATED_SYNTHETIC_ONLY')throw Error('PROBE_DISABLED');
 const c=credentials(env),auth='Basic '+Buffer.from(c.user+':'+c.password).toString('base64');report.credentialSource=c.source;
 async function call(label,method,body,headers={}){
  const start=performance.now();const r=await fetcher(url,{method,headers:{Authorization:auth,...(body===undefined?{}:{'Content-Type':method==='LOCK'?'application/xml; charset=utf-8':'text/markdown; charset=utf-8'}),...headers},...(body===undefined?{}:{body}),redirect:'error',signal:AbortSignal.timeout(12000)});const text=await r.text();report.calls.push({label,method,status:r.status,ms:performance.now()-start});return {status:r.status,text,token:r.headers.get('lock-token'),timeout:r.headers.get('timeout')};
 }
 release=()=>call('cleanup-own-lock','UNLOCK',undefined,{'Lock-Token':token});
 function must(value,code){if(!value)throw Error(code);}
 const before=await call('read-before','GET');must(before.status===200,'READ_FAILED');
 const lock=await call('exclusive-lock','LOCK',xml,{Timeout:'Second-60',Depth:'0'});report.lockStatus=lock.status;report.advertisedTimeout=lock.timeout;
 must([200,201].includes(lock.status),'ADVERTISED_LOCK_NOT_USABLE');token=lock.token;
 must(typeof token==='string'&&/^<[^<>\r\n]+>$/.test(token),'LOCK_TOKEN_MISSING');
 const duplicate=await call('competing-lock','LOCK',xml,{Timeout:'Second-60',Depth:'0'});must(duplicate.status===423,'EXCLUSIVE_LOCK_NOT_ENFORCED');report.checks.exclusiveLock=true;
 const deniedBody='SYNTHETIC MUST NOT WRITE '+randomUUID();const denied=await call('write-without-lock-token','PUT',deniedBody);report.deniedWriterStatus=denied.status;
 const unchanged=await call('verify-denied-write','GET');report.deniedWriterContentPreserved=unchanged.status===200&&unchanged.text===before.text;must(denied.status===423,'LOCK_DOES_NOT_PROTECT_CONTENT');must(report.deniedWriterContentPreserved,'LOCKED_CONTENT_CHANGED');report.checks.uncredentialedWriterBlocked=true;
 const ownBody='# SYNTHETIC locked Notes\nTiếng Việt 日本語 😀\n- [x] Xong\n'+randomUUID();const own=await call('write-with-lock-token','PUT',ownBody,{If:'('+token+')'});must([200,201,204].includes(own.status),'LOCKED_WRITE_FAILED');
 const verified=await call('verify-locked-write','GET');must(verified.status===200&&verified.text===ownBody,'LOCKED_WRITE_READBACK_FAILED');report.checks.lockedWrite=true;
 const old=token;const unlock=await call('release-lock','UNLOCK',undefined,{'Lock-Token':token});must([200,204].includes(unlock.status),'UNLOCK_FAILED');token=undefined;
 const stale=await call('stale-lock-token-write','PUT','SYNTHETIC MUST NOT WRITE stale '+randomUUID(),{If:'('+old+')'});report.staleWriterStatus=stale.status;
 const final=await call('verify-stale-token-preserved','GET');report.staleWriterContentPreserved=final.status===200&&final.text===ownBody;must([412,423].includes(stale.status),'STALE_LOCK_TOKEN_NOT_FENCED');must(final.status===200&&final.text===ownBody,'STALE_LOCK_OVERWROTE_CONTENT');report.checks.staleLockTokenRejected=true;report.final={bytes:Buffer.byteLength(final.text),sha256:digest(final.text)};
 report.completed=true;report.passed=true;
}catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'NETWORK_OR_REQUEST_FAILED'});}
finally{
 // Release only our token on our synthetic file; otherwise let short lock expire.
 if(token&&release){try{const r=await release();report.cleanupUnlockStatus=r.status;if([200,204].includes(r.status))token=undefined;}catch{report.cleanupUnlockStatus='UNVERIFIED';}}
 report.possibleOutstandingLock=!!token;token=undefined;

}
return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const report=await lockProbe();await writeFile('koofr-webdav-lock.local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
