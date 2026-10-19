/* Controlled socket loss and recovery in the isolated Vercel lab. No secret output. */
import {credentials} from './koofr_webdav_probe.mjs';
import {createDav,lockXml,validToken} from '../experiments/vercel-koofr-lab/lib/storage.mjs';
import {audience} from '../experiments/vercel-koofr-lab/lib/oidc.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const endpoint='https://homepage-koofr-5yjqqz0lp-hunghvt.vercel.app/api/bench';
const modes=process.env.RESILIENCE_CASES==='expiry'?['expiry']:['expiry','faults','restore'];
const report={kind:'VERCEL_KOOFR_LIVE_CONTROLLED_RESILIENCE',at:new Date().toISOString(),deployedCode:'ff2244f590362b5eadbdf177211c207d0da52bbe',deploymentId:'dpl_2esQBipQVaY5axo4QkjvKTvensFP',endpoint,passed:false,completed:false,cases:[],errors:[]};
const must=(v,code)=>{if(!v)throw Error(code);};
async function oidc(){const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);must(u.protocol==='https:'&&u.hostname.endsWith('.githubusercontent.com'),'OIDC_ENDPOINT_INVALID');u.searchParams.set('audience',audience);const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});must(r.ok,'OIDC_FAILED');const j=await r.json();must(typeof j.value==='string','OIDC_FAILED');return j.value;}
try{
 must(process.env.KOOFR_WEBDAV_PROBE==='ISOLATED_SYNTHETIC_ONLY'&&/^\d+$/.test(process.env.GITHUB_RUN_ID),'TEST_DISABLED');
 const c=credentials(process.env);report.credentialSource=c.source;
 const health=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(15000)});must(health.ok,'HEALTH_FAILED');const h=await health.json();must(h.active&&h.region==='fra1','REGION_OR_EXPIRY_MISMATCH');report.region=h.region;
 for(const mode of modes){
  const namespace='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID(),token=await oidc(),start=performance.now();
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({mode,transport:'pooled',namespace,user:c.user,password:c.password}),redirect:'error',signal:AbortSignal.timeout(115000)});
   const result=await r.json();report.cases.push({mode,namespace,httpStatus:r.status,wallMs:performance.now()-start,...result});
   console.log(JSON.stringify({case:mode,passed:result.passed,checks:result.checks,errors:result.errors,waitedMs:result.waitedMs,advertisedTimeout:result.advertisedTimeout,possibleOutstandingLock:result.possibleOutstandingLock}));
  }catch{report.cases.push({mode,namespace,passed:false,wallMs:performance.now()-start,errors:[{code:'REQUEST_OUTCOME_UNVERIFIED'}]});}
 }
 // Reconcile ONLY the exact synthetic namespace from the initial short-lease failure.
 if(process.env.RESILIENCE_CASES==='expiry'){
  const prior=createDav({user:c.user,password:c.password,transport:'pooled',namespace:'Homepage-Notes-Vercel-Probe-39001007775-1e85a400-cb73-44bb-906a-55ea272dce35'});
  const lock=await prior.call('prior-expiry-lock-reconciliation','LOCK',lockXml,{Timeout:'Second-60',Depth:'0'});
  report.priorLockReconciliation={scope:'GitHub runner -> exact retained synthetic file only',acquisitionStatus:lock.status,noOutstandingLockAtCheck:false};
  if([200,201].includes(lock.status)&&validToken(lock.token)){
   const un=await prior.call('prior-expiry-release-own-new-token','UNLOCK',undefined,{'Lock-Token':lock.token});
   report.priorLockReconciliation.unlockStatus=un.status;report.priorLockReconciliation.noOutstandingLockAtCheck=[200,204].includes(un.status);
  }
 }
 report.completed=report.cases.length===modes.length;report.passed=report.completed&&report.cases.every(r=>r.passed&&!r.possibleOutstandingLock)&&(!report.priorLockReconciliation||report.priorLockReconciliation.noOutstandingLockAtCheck);
}catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'REQUEST_FAILED'});}
finally{
 await writeFile('koofr-vercel-resilience.local.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({kind:report.kind,passed:report.passed,completed:report.completed,region:report.region,priorLockReconciliation:report.priorLockReconciliation,cases:report.cases.map(c=>({mode:c.mode,passed:c.passed,checks:c.checks,errors:c.errors,ms:c.ms,waitedMs:c.waitedMs,advertisedTimeout:c.advertisedTimeout,finalRevision:c.finalRevision,restore:c.restore,faults:c.faults?.map(f=>({name:f.name,initial:f.initial,injections:f.injections,retry:f.retry}))})),errors:report.errors}));
 if(!report.passed)process.exitCode=1;
}
