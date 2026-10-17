/* Runner -> dedicated Vercel lab -> fixed synthetic Koofr namespace.
 * Credentials and short-lived OIDC token are transmitted over HTTPS only and never logged.
 */
import {credentials} from './koofr_webdav_probe.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {audience} from '../experiments/vercel-koofr-lab/lib/oidc.mjs';
const endpoints={iad1:'https://homepage-koofr-5mktrpckb-hunghvt.vercel.app/api/bench',fra1:'https://homepage-koofr-5hfjox8ll-hunghvt.vercel.app/api/bench'};
const region=process.env.BENCH_REGION,endpoint=endpoints[region];
const report={kind:'GITHUB_DRIVER_VERCEL_KOOFR_SYNTHETIC_BENCHMARK',at:new Date().toISOString(),region,endpoint,deployedCode:'4a5a5b2ade3a8c47a44ab74520e74f968b434e4c',completed:false,passed:false,samples:[],checks:{},errors:[]};
let token,tokenUntil=0;
const must=(v,code)=>{if(!v)throw Error(code);};
async function oidc(){
 if(token&&Date.now()<tokenUntil)return token;
 const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);must(u.protocol==='https:'&&u.hostname.endsWith('.githubusercontent.com'),'OIDC_ENDPOINT_INVALID');u.searchParams.set('audience',audience);
 const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});must(r.ok,'OIDC_REQUEST_FAILED');
 token=(await r.json()).value;must(typeof token==='string','OIDC_REQUEST_FAILED');tokenUntil=Date.now()+180000;return token;
}
try{
 must(endpoint&&process.env.KOOFR_WEBDAV_PROBE==='ISOLATED_SYNTHETIC_ONLY'&&/^\d+$/.test(process.env.GITHUB_RUN_ID),'BENCH_DISABLED');
 const c=credentials(process.env),namespace='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID();report.namespace=namespace;report.credentialSource=c.source;
 const health=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(20000)});must(health.ok,'HEALTH_FAILED');const h=await health.json();report.actualRegion=h.region;must(h.region===region,'REGION_MISMATCH');
 const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});must(denied.status===401,'UNAUTHENTICATED_REQUEST_NOT_BLOCKED');report.checks.unauthenticatedBlocked=true;
 async function call(mode,transport,extra={}){
  const jwt=await oidc(),start=performance.now();let row={mode,transport};
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt},body:JSON.stringify({user:c.user,password:c.password,namespace,mode,transport,...extra}),redirect:'error',signal:AbortSignal.timeout(60000)});
   const j=await r.json();row={...row,...j,httpStatus:r.status,wallMs:performance.now()-start};report.samples.push(row);
   must(j.region===region,'REGION_CHANGED');must(!j.possibleOutstandingLock&&!j.cleanupWarning,'LOCK_CLEANUP_UNVERIFIED');return row;
  }catch(e){if(!report.samples.includes(row))report.samples.push({...row,wallMs:performance.now()-start,error:'REQUEST_OR_NETWORK_FAILED'});throw e;}
 }
 const seed=await call('seed','fetch');must(seed.code==='SEEDED','SEED_FAILED');let revision=0,last;
 // Alternate transport order each round, same payload size, same namespace and verified save contract.
 for(let round=0;round<20;round++){
  for(const transport of round%2?['pooled','fetch']:['fetch','pooled']){
   const read=await call('read',transport);must(read.code==='READ'&&read.revision===revision,'READ_REVISION_MISMATCH');
   const op={baseRevision:revision,opId:randomUUID()},r=await call('save',transport,op);r.benchmark=true;must(r.code==='VERIFIED'&&r.revision===revision+1&&r.committed,'SAVE_NOT_VERIFIED');revision=r.revision;last=op;
  }
 }
 const beforeReplay=revision,replay=await call('save','pooled',last);must(replay.code==='REPLAY'&&replay.revision===beforeReplay,'IDEMPOTENCY_FAILED');report.checks.replayWithoutNewRevision=true;
 const stale=await call('save','pooled',{baseRevision:0,opId:randomUUID()});must(stale.httpStatus===409&&stale.code==='CONFLICT'&&!stale.committed,'STALE_WRITER_NOT_BLOCKED');report.checks.staleConflict=true;
 for(let i=0;i<5;i++){
  const ops=[{baseRevision:revision,opId:randomUUID()},{baseRevision:revision,opId:randomUUID()}];
  const rs=await Promise.all(ops.map(op=>call('save','pooled',op))),wins=rs.map((r,k)=>({r,k})).filter(x=>x.r.code==='VERIFIED');
  must(wins.length===1&&rs.filter(r=>[409,423].includes(r.httpStatus)).length===1,'CONCURRENT_WRITE_NOT_EXCLUSIVE');revision++;
  const loser=1-wins[0].k;const retry=await call('save','pooled',ops[loser]);must(retry.code==='CONFLICT'&&!retry.committed,'LOSER_RETRY_NOT_CONFLICT');
  const receipt=await call('save','pooled',ops[wins[0].k]);must(receipt.code==='REPLAY'&&receipt.revision===revision,'WINNER_RETRY_DOUBLE_COMMITTED');report.racePairsVerified=i+1;
 }
 const final=await call('read','pooled');must(final.revision===revision,'FINAL_REVISION_MISMATCH');report.finalRevision=revision;report.completed=true;report.passed=true;
}catch(e){report.errors.push({code:/^[A-Z_]{1,80}$/.test(e.message)?e.message:'NETWORK_OR_BENCH_FAILED'});}
finally{
 token=undefined;report.summary={};
 const stat=vs=>{vs=vs.sort((a,b)=>a-b);const p=q=>vs[Math.max(0,Math.ceil(q*vs.length)-1)]??null;return {n:vs.length,p50:p(.5),p95:p(.95),max:vs.at(-1)??null};};
 for(const transport of ['fetch','pooled']){
  const rows=report.samples.filter(s=>s.mode==='save'&&s.transport===transport&&s.benchmark);
  report.summary[transport]={attempted:rows.length,verified:rows.filter(s=>s.code==='VERIFIED').length,serverMs:stat(rows.filter(s=>s.code==='VERIFIED').map(s=>s.ms)),wallMs:stat(rows.filter(s=>s.code==='VERIFIED').map(s=>s.wallMs)),phases:{}};
  for(const label of ['lock','base-under-lock','locked-put','readback','unlock'])report.summary[transport].phases[label]=stat(rows.flatMap(s=>s.calls??[]).filter(c=>c.label===label).map(c=>c.ms));
  const reads=report.samples.filter(s=>s.mode==='read'&&s.transport===transport&&s.code==='READ');report.summary[transport].readServerMs=stat(reads.map(s=>s.ms));
 }
 await writeFile('koofr-vercel-'+(region??'unknown')+'.local.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({kind:report.kind,passed:report.passed,region,actualRegion:report.actualRegion,namespace:report.namespace,summary:report.summary,checks:report.checks,racePairsVerified:report.racePairsVerified,finalRevision:report.finalRevision,errors:report.errors}));
 if(!report.passed)process.exitCode=1;
}
