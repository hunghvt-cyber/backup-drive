/* Existing Actions credential -> two pinned isolated previews -> fresh synthetic root. */
import {credentials} from './koofr_webdav_probe.mjs';
import {audience} from '../experiments/vercel-koofr-lab/lib/oidc.mjs';
import {faultPlans} from '../experiments/vercel-koofr-lab/lib/store-reliability.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const deployments=[
 {id:'dpl_mrCmHu8KPKKf5a5i1Q23AXNaGR1x',endpoint:'https://homepage-koofr-2i5e7wjjx-hunghvt.vercel.app/api/bench'},
 {id:'dpl_FztSSFaAZYbY76WKQL5znRx6hiy3',endpoint:'https://homepage-koofr-92oxf6bgh-hunghvt.vercel.app/api/bench'}
];
const report={kind:'KOOFR_FULL_STORE_RELIABILITY_LIVE',at:new Date().toISOString(),deployedCode:'1245e4c27bebbe1960ab0494a7e34fd09c44d786',driverCode:process.env.GITHUB_SHA,deployments,passed:false,completed:false,requests:[],faults:[],races:[],errors:[]};
const must=(v,c)=>{if(!v)throw Error(c);};const wait=ms=>new Promise(r=>setTimeout(r,ms));let writes=Promise.resolve();
function persist(){writes=writes.then(()=>writeFile('koofr-store-reliability.local.json',JSON.stringify(report,null,2)+'\n'));return writes;}
async function oidc(){const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);must(u.protocol==='https:'&&u.hostname.endsWith('.githubusercontent.com'),'OIDC_ENDPOINT_INVALID');u.searchParams.set('audience',audience);const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});must(r.ok,'OIDC_FAILED');const j=await r.json();must(typeof j.value==='string','OIDC_FAILED');return j.value;}
let c,namespace;
async function request(which,stage,extra={},mode='store-reliability',auth){
 const token=auth??await oidc(),start=performance.now();let row;
 try{
  const r=await fetch(deployments[which].endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user:c.user,password:c.password,namespace,mode,transport:'pooled',stage,...extra}),redirect:'error',signal:AbortSignal.timeout(115000)});
  const result=await r.json();let privateProbe=result.privateProbe;delete result.privateProbe;
  row={endpoint:which,stage,...(extra.case?{case:extra.case}:{}),...(extra.kind?{kind:extra.kind,round:extra.round,writer:extra.writer}:{}),httpStatus:r.status,wallMs:performance.now()-start,...result};report.requests.push(row);await persist();return {row,privateProbe};
 }catch{row={endpoint:which,stage,wallMs:performance.now()-start,passed:false,errors:[{code:'HTTP_OUTCOME_UNKNOWN'}]};report.requests.push(row);await persist();return {row};}
}
const busy=r=>r?.details?.outcome?.status===423||r?.errors?.some(e=>e.code==='BUSY');
async function bounded(which,stage,extra={},mode='store-reliability'){
 const start=performance.now();let attempts=0,last;
 do{last=await request(which,stage,extra,mode);attempts++;if(!busy(last.row))return {...last,attempts,totalMs:performance.now()-start};await wait(Math.min(2000,200*attempts));}while(performance.now()-start<75000);
 throw Error('BUSY_RECOVERY_BOUND_EXCEEDED');
}
try{
 must(process.env.KOOFR_WEBDAV_PROBE==='ISOLATED_SYNTHETIC_ONLY'&&/^\d+$/.test(process.env.GITHUB_RUN_ID),'TEST_DISABLED');c=credentials(process.env);report.credentialSource=c.source;
 namespace='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID();report.namespace=namespace;
 report.health=[];for(const d of deployments){const r=await fetch(d.endpoint,{redirect:'error',signal:AbortSignal.timeout(15000)});must(r.ok,'HEALTH_FAILED');const h=await r.json();must(h.active&&h.region==='fra1'&&typeof h.runtimeId==='string','REGION_OR_EXPIRY_MISMATCH');report.health.push(h);}
 must(deployments[0].id!==deployments[1].id,'DEPLOYMENTS_NOT_DISTINCT');
 must((await request(0,'init',{},'store100')).row.passed,'INIT_FAILED');for(let chunk=0;chunk<10;chunk++)must((await request(0,'seed',{chunk},'store100')).row.passed,'SEED_FAILED');
 for(const name of Object.keys(faultPlans)){
  const r=await request(0,'fault',{case:name});report.faults.push({case:name,passed:r.row.passed,checks:r.row.checks,details:r.row.details,errors:r.row.errors});
  console.log(JSON.stringify({phase:'full-store-fault',case:name,passed:r.row.passed,checks:r.row.checks,initial:r.row.details?.initial,errors:r.row.errors}));await persist();
  // Re-establish availability under a fresh lock before another independent case.
  const clean=await bounded(1,'race-base',{kind:'same',round:0});must(clean.row.passed,'POST_FAULT_STORE_UNAVAILABLE');
 }
 for(const kind of ['same','different'])for(let round=0;round<50;round++){
  const base=await bounded(round%2,'race-base',{kind,round});must(base.row.passed,'RACE_BASE_FAILED');const ops=[randomUUID(),randomUUID()],auth=await oidc(),began=performance.now();
  const extra=writer=>({kind,round,writer,opId:ops[writer],expectedRevision:base.row.details.revisions[writer]});
  let rows=await Promise.all([request(0,'race-write',extra(0),'store-reliability',auth),request(1,'race-write',extra(1),'store-reliability',auth)]);const initial=rows.map(r=>r.row.details?.outcome?.status);const retryAttempts=[0,0];
  for(let writer=0;writer<2;writer++)if(busy(rows[writer].row)){const r=await bounded(writer,'race-write',extra(writer));rows[writer]=r;retryAttempts[writer]=r.attempts;}
  must(rows.every(r=>r.row.passed),'RACE_REQUEST_FAILED');const outcomes=rows.map(r=>r.row.details.outcome),winners=outcomes.map((r,i)=>r.status===200?i:-1).filter(i=>i>=0);
  must(winners.length===(kind==='same'?1:2),'RACE_WINNER_COUNT_FAILED');if(kind==='same')must(outcomes[1-winners[0]].status===409,'STALE_WRITER_NOT_CONFLICTED');
  const expectedRevisions=outcomes.map(r=>r.result?.revision??null),verified=await bounded(1,'race-verify',{kind,round,winner:winners[0],expectedRevisions});must(verified.row.passed,'RACE_VERIFY_FAILED');
  // Replay from the opposite deployment, preserving operation identity and original base.
  for(const winner of winners){const replay=await bounded(1-winner,'race-write',extra(winner));must(replay.row.passed&&replay.row.details.outcome.status===200&&replay.row.details.outcome.result.replay&&replay.row.details.outcome.result.revision===expectedRevisions[winner],'CROSS_DEPLOYMENT_RETRY_DOUBLE_COMMIT');}
  report.races.push({kind,round,initial,outcomes:outcomes.map(r=>r.status),retryAttempts,wallMs:performance.now()-began,verified:true});if(round%10===9)console.log(JSON.stringify({phase:'cross-deployment-race',kind,completed:round+1,passed:true}));await persist();
 }
 const prepared=await bounded(1,'acl-prepare');must(prepared.row.passed&&prepared.privateProbe,'ACL_PREPARE_FAILED');let probe=prepared.privateProbe;const extra={probe,opId:randomUUID(),expectedRevision:prepared.row.details.revision};
 const paused=request(0,'acl-paused',extra);let observed=false;
 for(let i=0;i<25;i++){const r=await request(1,'acl-observe',extra);must(r.row.passed,'ACL_OBSERVE_FAILED');if(r.row.details.orphanReady){observed=true;break;}await wait(200);}must(observed,'PAUSED_ORPHAN_NOT_OBSERVED');
 const revoked=await bounded(1,'acl-revoke',extra);must(revoked.row.passed&&revoked.row.details.outcome.status===200,'CROSS_DEPLOYMENT_REVOKE_FAILED');
 const stale=await paused;must(stale.row.passed,'CROSS_DEPLOYMENT_STALE_PUBLISH_NOT_FENCED');must((await bounded(1,'acl-verify',extra)).row.passed,'CROSS_DEPLOYMENT_ACL_VERIFY_FAILED');probe=undefined;extra.probe=undefined;
 report.crossDeploymentRevoke={passed:true,unpublishedOrphanObserved:true,expiredPublicationFenced:true,revokedRetryDenied:true};
 const final=await bounded(1,'final');must(final.row.passed,'FINAL_INTEGRITY_FAILED');report.final=final.row.details;
 report.completed=true;report.passed=report.faults.every(r=>r.passed)&&report.races.length===100;
}catch(e){report.errors.push({code:/^[A-Z_0-9]{1,90}$/.test(e.message)?e.message:'REQUEST_OUTCOME_UNVERIFIED'});}
finally{
 report.runtimeIds=[...new Set(report.requests.map(r=>r.runtimeId).filter(Boolean))];report.requestIdsVerifiedUnique=report.requests.filter(r=>r.requestId).length===new Set(report.requests.map(r=>r.requestId).filter(Boolean)).size;
 report.summary={faultCases:report.faults.length,faultPassed:report.faults.filter(r=>r.passed).length,samePairs:report.races.filter(r=>r.kind==='same').length,differentPairs:report.races.filter(r=>r.kind==='different').length,busyResponses:report.requests.filter(busy).length,invocations:report.requests.length,runtimes:report.runtimeIds.length};
 await persist();console.log(JSON.stringify({kind:report.kind,passed:report.passed,completed:report.completed,summary:report.summary,final:report.final,crossDeploymentRevoke:report.crossDeploymentRevoke,errors:report.errors}));if(!report.passed)process.exitCode=1;
}
