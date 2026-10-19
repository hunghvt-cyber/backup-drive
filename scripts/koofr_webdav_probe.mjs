/* Isolated WebDAV conformance probe; no production/backup paths or raw logs.
 * Existing rclone credential stays inside Actions memory. No credential export.
 */
import {createDecipheriv,createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const ORIGIN='https://app.koofr.net';
const ROOT=ORIGIN+'/dav/Koofr/';
// Public format constant from rclone v1.73.0 fs/config/obscure/obscure.go.
// This is NOT an account secret or encryption boundary; rclone documents this format.
const FORMAT_KEY=Buffer.from('9c935b48730a554d6bfd7c63c886a92bd390198eb8128afbf4de162b8b95f638','hex');
const fail=code=>{throw new Error(code);};
export function revealObscured(value){
 if(typeof value!=='string'||!/^[\w-]+$/.test(value))fail('KOOFR_PASSWORD_FORMAT_UNSUPPORTED');
 const b=Buffer.from(value,'base64url');if(b.length<=16)fail('KOOFR_PASSWORD_FORMAT_UNSUPPORTED');
 const d=createDecipheriv('aes-256-ctr',FORMAT_KEY,b.subarray(0,16));return Buffer.concat([d.update(b.subarray(16)),d.final()]).toString('utf8');
}
export function credentials(env){
 if(env.KOOFR_WEBDAV_USER&&env.KOOFR_WEBDAV_APP_PASSWORD)return {user:env.KOOFR_WEBDAV_USER,password:env.KOOFR_WEBDAV_APP_PASSWORD,source:'dedicated_webdav_secret'};
 if(!env.RCLONE_CONFIG_CONTENT)fail('ONE_TIME_SETUP_REQUIRED');
 // The existing backup workflow uses base64 configuration. Only parse [koofr].
 const config=Buffer.from(env.RCLONE_CONFIG_CONTENT,'base64').toString('utf8');
 let selected=false;const remote={};for(const line of config.split(/\r?\n/)){const section=line.match(/^\s*\[([^\]]+)\]\s*$/);if(section){selected=section[1]==='koofr';continue;}if(selected){const field=line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(field)remote[field[1]]=field[2];}}
 if(!remote.user)fail('ONE_TIME_SETUP_REQUIRED');
 if(remote.type==='koofr'&&(!remote.provider||remote.provider==='koofr')&&(!remote.endpoint||new URL(remote.endpoint).origin===ORIGIN)&&!remote.mountid){return {user:remote.user,password:revealObscured(remote.password),source:'existing_koofr_remote'};}
 if(remote.type==='webdav'&&remote.url?.replace(/\/$/,'')===ROOT.replace(/\/$/,'')&&remote.pass)return {user:remote.user,password:revealObscured(remote.pass),source:'existing_webdav_remote'};
 fail('EXISTING_REMOTE_NOT_COMPATIBLE_USE_DEDICATED_SECRET');
}
const hash=s=>createHash('sha256').update(s).digest('hex');
const strong=e=>typeof e==='string'&&e.startsWith('"')&&e.endsWith('"')&&!e.startsWith('W/');
export async function probe({env=process.env,fetcher=fetch,persist=async()=>{},racePairs=10,samples=20,namespace='Homepage-Notes-WebDAV-Probe-'+randomUUID()}){
 const report={kind:'KOOFR_WEBDAV_SYNTHETIC_CONFORMANCE_NOT_HOMEPAGE_BENCHMARK',at:new Date().toISOString(),completed:false,passed:false,checks:{},calls:[],errors:[],namespace};
 let auth;
 async function call(label,method,file='',body,headers={}){
  if(!/^[a-zA-Z0-9-]+(?:\.md)?$/.test(file)&&file!=='')fail('PATH_FORBIDDEN');
  const url=ROOT+namespace+'/'+file;if(!url.startsWith(ROOT+'Homepage-Notes-WebDAV-Probe-'))fail('PATH_FORBIDDEN');
  const t=performance.now(),row={label,method};
  try{
   const r=await fetcher(url,{method,headers:{Authorization:auth,...(body!==undefined?{'Content-Type':method==='PROPFIND'?'application/xml; charset=utf-8':'text/markdown; charset=utf-8'}:{}),...headers},...(body!==undefined?{body}:{}),redirect:'error',signal:AbortSignal.timeout(12000)});
   row.status=r.status;const text=await r.text();row.ms=performance.now()-t;row.ok=r.status>=200&&r.status<300;return {status:r.status,text,etag:r.headers.get('etag')};
  }catch{row.ms=performance.now()-t;row.code='NETWORK_OR_TIMEOUT';throw new Error('NETWORK_OR_TIMEOUT');}
  finally{report.calls.push(row);await persist(report);}
 }
 function expect(r,status,code){if(!(Array.isArray(status)?status:[status]).includes(r.status))fail(code);return r;}
 async function read(label,file,expected){const r=expect(await call(label,'GET',file),200,'READ_FAILED');if(r.text!==expected)fail('CONTENT_MISMATCH');if(!strong(r.etag))fail('STRONG_ETAG_REQUIRED');return r;}
 const body=label=>'# SYNTHETIC Notes\n\nTiếng Việt 日本語 😀\n- [x] Đã làm\n- [ ] Chưa làm\n\n'+label+'\n'+'Synthetic text. '.repeat(120);
 try{
  if(env.KOOFR_WEBDAV_PROBE!=='ISOLATED_SYNTHETIC_ONLY')fail('PROBE_DISABLED');
  if(!/^Homepage-Notes-WebDAV-Probe-[a-f0-9-]{36}$/.test(namespace))fail('NAMESPACE_FORBIDDEN');
  const c=credentials(env);if(!c.password||/[\r\n]/.test(c.user+c.password))fail('CREDENTIAL_FORMAT_INVALID');auth='Basic '+Buffer.from(c.user+':'+c.password).toString('base64');report.credentialSource=c.source;
  const created=await call('new-isolated-folder','MKCOL');if(created.status===401||created.status===403)fail('WEBDAV_AUTH_REQUIRES_ONE_TIME_SETUP');expect(created,201,'NEW_NAMESPACE_NOT_CREATED');report.checks.privateNamespaceCreated=true;
  const file='note.md';let expected=body('initial');expect(await call('create','PUT',file,expected,{'If-None-Match':'*'}),201,'CREATE_FAILED');let current=await read('verify-create',file,expected);report.checks.unicodeChecklist=true;
  expect(await call('reject-duplicate-create','PUT',file,body('MUST NOT OVERWRITE'),{'If-None-Match':'*'}),412,'CREATE_PRECONDITION_NOT_ENFORCED');await read('verify-no-create-overwrite',file,expected);report.checks.ifNoneMatchCreate=true;
  const first=current.etag;expected=body('updated');expect(await call('conditional-update','PUT',file,expected,{'If-Match':first}),[200,204],'CONDITIONAL_UPDATE_FAILED');current=await read('verify-update',file,expected);if(current.etag===first)fail('ETAG_DID_NOT_CHANGE');
  expect(await call('reject-stale','PUT',file,body('MUST NOT OVERWRITE'),{'If-Match':first}),412,'STALE_PRECONDITION_NOT_ENFORCED');await read('verify-stale-preserved',file,expected);report.checks.ifMatchUpdate=true;
  expect(await call('reject-invalid-etag','PUT',file,body('MUST NOT OVERWRITE'),{'If-Match':'"never-match-'+randomUUID()+'"'}),412,'INVALID_PRECONDITION_NOT_ENFORCED');await read('verify-invalid-preserved',file,expected);
  for(let i=0;i<racePairs;i++){
   const tag=current.etag,payloads=[body('race-'+i+'-A'),body('race-'+i+'-B')];
   const rs=await Promise.allSettled(payloads.map((text,n)=>call('race-'+i+'-'+n,'PUT',file,text,{'If-Match':tag})));
   if(rs.some(r=>r.status==='rejected'))fail('RACE_RESPONSE_UNCERTAIN');
   const values=rs.map(r=>r.value),wins=values.map((r,n)=>[r.status,n]).filter(([s])=>[200,204].includes(s));
   if(wins.length!==1||values.filter(r=>r.status===412).length!==1)fail('CONCURRENT_WRITE_PRECONDITION_FAILED');
   expected=payloads[wins[0][1]];current=await read('verify-race-'+i,file,expected);if(current.etag===tag)fail('SAME_SIZE_ETAG_DID_NOT_CHANGE');
   report.racePairsVerified=i+1;
  }report.checks.sameRevisionOneWinner=true;
  // Discard response deliberately; GET verifies commit, retry uses exact old ETag/body.
  const old=current.etag;expected=body('discarded-response-'+randomUUID());await call('discard-write-response','PUT',file,expected,{'If-Match':old});current=await read('reconcile-discarded-response',file,expected);
  expect(await call('retry-same-precondition','PUT',file,expected,{'If-Match':old}),412,'RETRY_COULD_OVERWRITE');await read('verify-no-double-write',file,expected);report.checks.responseDiscardReconciled=true;
  const conditional=await call('conditional-read','GET',file,undefined,{'If-None-Match':current.etag});report.checks.conditionalGet304=conditional.status===304;
  for(let i=0;i<samples;i++){
   await read('benchmark-get',file,expected);const tag=current.etag;expected=body('benchmark-'+i+'-'+randomUUID());expect(await call('benchmark-put','PUT',file,expected,{'If-Match':tag}),[200,204],'BENCHMARK_WRITE_FAILED');current=await read('benchmark-readback',file,expected);
  }
  // Delete only one newly created synthetic file, never the folder or retained note.
  const trash='delete-sample.md';expect(await call('delete-fixture-create','PUT',trash,'SYNTHETIC delete',{'If-None-Match':'*'}),201,'DELETE_FIXTURE_FAILED');const tr=await read('delete-fixture-read',trash,'SYNTHETIC delete');
  const stale=await call('delete-stale','DELETE',trash,undefined,{'If-Match':'"never-match-'+randomUUID()+'"'});report.checks.deletePrecondition=stale.status===412;
  if(stale.status===412){await read('delete-stale-preserved',trash,'SYNTHETIC delete');expect(await call('delete-current','DELETE',trash,undefined,{'If-Match':tr.etag}),[200,204],'DELETE_FAILED');expect(await call('verify-delete','GET',trash),404,'DELETE_NOT_CONFIRMED');report.checks.delete=true;}else fail('DELETE_PRECONDITION_NOT_ENFORCED');
  const listing=await call('list-isolated-folder','PROPFIND','', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getlastmodified/></d:prop></d:propfind>',{Depth:'1'});expect(listing,207,'PROPFIND_FAILED');report.checks.list=true;
  report.final={bytes:Buffer.byteLength(expected),sha256:hash(expected),retainedSyntheticFileCount:1};report.completed=true;report.passed=true;
 }catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'PROBE_FAILED'});}
 finally{
  auth=undefined;
  report.summary={};for(const label of ['benchmark-get','benchmark-put','benchmark-readback']){const rows=report.calls.filter(x=>x.label===label),vs=rows.filter(x=>x.ok).map(x=>x.ms).sort((a,b)=>a-b);const q=p=>vs[Math.max(0,Math.ceil(p*vs.length)-1)]??null;report.summary[label]={attempted:rows.length,success:vs.length,p50:q(.5),p95:q(.95)};}
  report.scope='GitHub runner -> Koofr WebDAV; no Vercel/browser/100-Note backend benchmark';await persist(report);
 }
 return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 let chain=Promise.resolve();const path=process.env.KOOFR_PROBE_REPORT||'koofr-webdav-result.local.json';
 const r=await probe({persist:report=>{const json=JSON.stringify(report,null,2)+'\n';chain=chain.then(()=>writeFile(path,json));return chain;}});
 console.log(JSON.stringify({completed:r.completed,passed:r.passed,credentialSource:r.credentialSource,checks:r.checks,racePairsVerified:r.racePairsVerified,summary:r.summary,errors:r.errors}));if(!r.passed)process.exitCode=1;
}
