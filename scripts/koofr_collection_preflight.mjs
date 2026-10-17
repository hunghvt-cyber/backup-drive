/* Capability gate for a NEW synthetic folder only; existing backup paths are unreachable. */
import {NoteStore} from '../experiments/vercel-koofr-lab/lib/store.mjs';
import {credentials} from './koofr_webdav_probe.mjs';
import {nativeTransport,lockXml,validToken} from '../experiments/vercel-koofr-lab/lib/storage.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const namespace='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID(),root='https://app.koofr.net/dav/Koofr/'+namespace+'/';
const report={kind:'KOOFR_COLLECTION_LOCK_SYNTHETIC_PREFLIGHT',at:new Date().toISOString(),namespace,passed:false,calls:[],checks:{},errors:[]};
let token;
const must=(x,c)=>{if(!x)throw Error(c);};
try{
 must(process.env.KOOFR_WEBDAV_PROBE==='ISOLATED_SYNTHETIC_ONLY'&&/^\d+$/.test(process.env.GITHUB_RUN_ID),'PROBE_DISABLED');
 const c=credentials(process.env),auth='Basic '+Buffer.from(c.user+':'+c.password).toString('base64');report.credentialSource=c.source;
 async function call(label,method,file='',body,headers={}){
  must(['','note.json','catalog.json'].includes(file),'PATH_FORBIDDEN');const start=performance.now();
  try{const r=await nativeTransport(root+file,{method,headers:{Authorization:auth,...(body===undefined?{}:{'Content-Type':method==='LOCK'?'application/xml; charset=utf-8':'application/json; charset=utf-8'}),...headers},...(body===undefined?{}:{body})});report.calls.push({label,method,status:r.status,ms:performance.now()-start});return r;}catch{report.calls.push({label,method,error:'NETWORK_OR_TIMEOUT',ms:performance.now()-start});throw Error('NETWORK_OR_TIMEOUT');}
 }
 report.cleanup=async()=>{if(token){const r=await call('cleanup-own-collection-lock','UNLOCK','',undefined,{'Lock-Token':token});report.cleanupStatus=r.status;if([200,204,409].includes(r.status))token=undefined;}};
 must((await call('new-namespace','MKCOL')).status===201,'NEW_NAMESPACE_FAILED');
 const initial='{"synthetic":"Tiếng Việt 😀","revision":0}';must((await call('seed-member','PUT','note.json',initial)).status===201,'SEED_FAILED');
 const lock=await call('collection-lock','LOCK','',lockXml,{Depth:'infinity',Timeout:'Second-60'});must([200,201].includes(lock.status)&&validToken(lock.token),'COLLECTION_LOCK_UNSUPPORTED');token=lock.token;
 must((await call('collection-contender','LOCK','',lockXml,{Depth:'infinity',Timeout:'Second-60'})).status===423,'COLLECTION_EXCLUSION_FAILED');
 const denied=await call('tokenless-existing-member','PUT','note.json','MUST NOT WRITE');must(denied.status===423,'COLLECTION_DOES_NOT_PROTECT_MEMBER');must((await call('verify-existing-member-preserved','GET','note.json')).text===initial,'UNPROTECTED_MEMBER_OVERWRITE');report.checks.existingMemberProtected=true;
 const next='{"synthetic":"Tiếng Việt 😀","revision":1}';must([200,201,204].includes((await call('own-token-member-write','PUT','note.json',next,{If:'('+token+')'})).status),'COLLECTION_TOKEN_NOT_ACCEPTED_ON_MEMBER');must((await call('verify-member-write','GET','note.json')).text===next,'MEMBER_READBACK_FAILED');
 must((await call('tokenless-new-member','PUT','catalog.json','MUST NOT CREATE')).status===423,'COLLECTION_DOES_NOT_PROTECT_NEW_MEMBER');must((await call('verify-new-member-absent','GET','catalog.json')).status===404,'TOKENLESS_MEMBER_CREATED');
 const catalog='{"synthetic":true,"revision":0}';must([200,201,204].includes((await call('own-token-new-member','PUT','catalog.json',catalog,{If:'('+token+')'})).status),'LOCKED_MEMBER_CREATE_FAILED');must((await call('verify-new-member','GET','catalog.json')).text===catalog,'NEW_MEMBER_READBACK_FAILED');report.checks.newMemberProtected=true;
 const old=token;must([200,204].includes((await call('release-collection-lock','UNLOCK','',undefined,{'Lock-Token':token})).status),'UNLOCK_FAILED');token=undefined;
 must([412,423].includes((await call('stale-collection-token-member-write','PUT','note.json','MUST NOT WRITE',{If:'('+old+')'})).status),'STALE_COLLECTION_TOKEN_ACCEPTED');must((await call('verify-stale-member-preserved','GET','note.json')).text===next,'STALE_MEMBER_OVERWRITTEN');report.checks.staleCollectionTokenFenced=true;
 report.clientVariants=[];
 for(const variant of ['untagged-sequential','tagged-sequential','tagged-parallel']){
  const ns='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID(),base='https://app.koofr.net/dav/Koofr/'+ns+'/';let own;
  const observations=[];
  const wire=async(url,opts,ctx)=>{
   if(variant.startsWith('tagged')&&opts.headers.If)opts={...opts,headers:{...opts.headers,If:'<'+base+'> '+opts.headers.If}};
   if(variant.startsWith('tagged')&&opts.method==='UNLOCK'&&opts.headers['Lock-Token'])opts={...opts,headers:{...opts.headers,If:'<'+base+'> ('+opts.headers['Lock-Token']+')'}};
   const r=await nativeTransport(url,opts,ctx);observations.push({label:ctx.label,method:opts.method,status:r.status,root:url===base,...(opts.method==='LOCK'?{rootMentionedInBody:r.text.includes(base)}:{})});if(opts.method==='LOCK'&&r.token)own=r.token;if(opts.method==='UNLOCK'&&[200,204].includes(r.status))own=undefined;return r;
  };
  const s=new NoteStore({user:c.user,password:c.password,namespace:ns},{wire});let passed=false,error;
  try{await s.init();await s.seedBatch(0,variant==='tagged-parallel'?2:1);passed=true;}catch(e){error=/^[A-Z_]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED';}
  let cleanupStatus;if(own){const r=await nativeTransport(base,{method:'UNLOCK',headers:{Authorization:auth,'Lock-Token':own,If:'<'+base+'> ('+own+')'}});cleanupStatus=r.status;own=undefined;}
  report.clientVariants.push({variant,namespace:ns,passed,error,cleanupStatus,observations});
 }
 report.passed=report.clientVariants.some(x=>x.variant==='tagged-parallel'&&x.passed);
}catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED'});}
finally{if(report.cleanup){try{await report.cleanup();}catch{report.cleanupStatus='UNVERIFIED';}delete report.cleanup;}report.possibleOutstandingLock=!!token;await writeFile('koofr-collection-preflight.local.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed||token)process.exitCode=1;}
