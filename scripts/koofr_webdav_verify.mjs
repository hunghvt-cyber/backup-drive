/* Diagnostic restricted to the exact retained synthetic namespace from attempt1.
 * No backup paths, no credentials in report, no arbitrary destination or redirect.
 */
import {credentials} from './koofr_webdav_probe.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const namespace='Homepage-Notes-WebDAV-Probe-6fedd63c-5f5a-40e2-988d-ac017ace2cd9';
const root='https://app.koofr.net/dav/Koofr/'+namespace+'/';
const report={kind:'KOOFR_WEBDAV_RETAINED_PRECONDITION_DIAGNOSTIC',at:new Date().toISOString(),namespace,completed:false,checks:{},calls:[],errors:[]};
const hash=s=>createHash('sha256').update(s).digest('hex');
function body(label){return '# SYNTHETIC Notes\n\nTiếng Việt 日本語 😀\n- [x] Đã làm\n- [ ] Chưa làm\n\n'+label+'\n'+'Synthetic text. '.repeat(120);}
try{
 if(process.env.KOOFR_WEBDAV_PROBE!=='ISOLATED_SYNTHETIC_ONLY')throw Error('PROBE_DISABLED');
 const c=credentials(process.env),auth='Basic '+Buffer.from(c.user+':'+c.password).toString('base64');report.credentialSource=c.source;
 async function call(label,method,path='note.md',data,headers={}){
  if(!['','note.md'].includes(path))throw Error('PATH_FORBIDDEN');
  const start=performance.now();const r=await fetch(root+path,{method,headers:{Authorization:auth,...(data===undefined?{}:{'Content-Type':'text/markdown; charset=utf-8'}),...headers},...(data===undefined?{}:{body:data}),redirect:'error',signal:AbortSignal.timeout(12000)}),text=await r.text();report.calls.push({label,method,status:r.status,ms:performance.now()-start});return {status:r.status,text,etag:r.headers.get('etag'),dav:r.headers.get('dav'),allow:r.headers.get('allow')};
 }
 const before=await call('retained-read','GET');if(before.status!==200)throw Error('RETAINED_READ_FAILED');
 report.checks.createGuardActuallyOverwrote=before.text===body('MUST NOT OVERWRITE');report.before={bytes:Buffer.byteLength(before.text),sha256:hash(before.text),strongETag:!!before.etag&&!before.etag.startsWith('W/')};
 const options=await call('server-capabilities','OPTIONS','');report.capabilities={status:options.status,dav:options.dav,allow:options.allow};
 const invalid=body('INVALID-ETAG-'+randomUUID()),put=await call('invalid-if-match','PUT','note.md',invalid,{'If-Match':'"never-match-'+randomUUID()+'"'});
 const after=await call('invalid-if-match-readback','GET');if(after.status!==200)throw Error('READBACK_FAILED');
 report.checks.invalidIfMatchRejected=put.status===412;report.checks.invalidIfMatchPreserved=after.text===before.text;report.checks.invalidIfMatchActuallyOverwrote=after.text===invalid;
 report.after={bytes:Buffer.byteLength(after.text),sha256:hash(after.text),etagChanged:before.etag!==after.etag};
 report.completed=true;report.safeForConditionalNotes=report.checks.invalidIfMatchRejected&&report.checks.invalidIfMatchPreserved&&!report.checks.createGuardActuallyOverwrote;
}catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'NETWORK_OR_REQUEST_FAILED'});}
await writeFile('koofr-webdav-verify.local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.completed||!report.safeForConditionalNotes)process.exitCode=1;
