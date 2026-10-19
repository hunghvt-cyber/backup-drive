/* GitHub OIDC -> isolated Vercel fixture -> new synthetic Koofr stores only. */
import {credentials} from './koofr_webdav_probe.mjs';
import {NoteStore} from '../experiments/vercel-koofr-lab/lib/store.mjs';
import {lockXml,validToken} from '../experiments/vercel-koofr-lab/lib/storage.mjs';
import {audience} from '../experiments/vercel-koofr-lab/lib/oidc.mjs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const endpoint='https://homepage-koofr-6e6rdsffp-hunghvt.vercel.app/api/bench';
const report={kind:'KOOFR_RESTORE_API_PREVIEW_LIVE',at:new Date().toISOString(),deployedCode:'8e4d4af37de24cd30bc6b6603593626299ca5c3c',deploymentId:'dpl_EzLBLjkgH3d4SnV8QoMBrtM2rZ4U',endpoint,driverCode:process.env.GITHUB_SHA,passed:false,completed:false,stages:[],errors:[]};
const must=(v,c)=>{if(!v)throw Error(c);};
async function oidc(){const u=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);must(u.protocol==='https:'&&u.hostname.endsWith('.githubusercontent.com'),'OIDC_ENDPOINT_INVALID');u.searchParams.set('audience',audience);const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(10000)});must(r.ok,'OIDC_FAILED');const j=await r.json();must(typeof j.value==='string','OIDC_FAILED');return j.value;}
try{
 must(process.env.KOOFR_WEBDAV_PROBE==='ISOLATED_SYNTHETIC_ONLY'&&/^\d+$/.test(process.env.GITHUB_RUN_ID),'TEST_DISABLED');const c=credentials(process.env);report.credentialSource=c.source;
 const source='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID(),target='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID();report.sourceNamespace=source;report.restoreNamespace=target;
 const health=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(15000)});must(health.ok,'HEALTH_FAILED');const h=await health.json();must(h.active&&h.region==='fra1','REGION_OR_EXPIRY_MISMATCH');report.region=h.region;
 let probe;
 async function stage(name,extra={},mode='store100',names={}){
  const token=await oidc(),start=performance.now(),namespace=names.namespace??(name.startsWith('restore-')?target:source);
  const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({user:c.user,password:c.password,namespace,mode,transport:'pooled',stage:name,...extra,...(name.startsWith('restore-')?{sourceNamespace:names.sourceNamespace??source}:{}),...(name==='restore-verify'?{probe}:{})}),redirect:'error',signal:AbortSignal.timeout(115000)});
  const result=await r.json();if(result.privateProbe){probe=result.privateProbe;delete result.privateProbe;}
  const row={...result,httpStatus:r.status,wallMs:performance.now()-start};report.stages.push(row);
  await writeFile('koofr-preview-qualification.local.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({stage:name,chunk:extra.chunk,passed:result.passed,checks:result.checks,details:result.details,errors:result.errors,serverMs:result.ms,wallMs:row.wallMs}));
  must(result.passed&&r.status===200&&result.region==='fra1','STAGE_FAILED_'+name.toUpperCase().replaceAll('-','_'));return result;
 }
 const previewEndpoint=endpoint.replace('/api/bench','/api/preview');
 const hp=await fetch(previewEndpoint+'?route=health',{redirect:'error',signal:AbortSignal.timeout(15000)}),hpj=await hp.json();must(hp.status===200&&!hpj.configured,'STANDALONE_PREVIEW_NOT_CLOSED');
 const denied=await fetch(previewEndpoint+'?route=notes',{redirect:'error',signal:AbortSignal.timeout(15000)});must(denied.status===503,'UNCONFIGURED_OWNER_ROUTE_NOT_CLOSED');report.standaloneHttpSmoke={healthStatus:hp.status,configured:hpj.configured,ownerStatus:denied.status};
 for(const name of ['restore-empty','restore-marker-loss','restore-catalog-loss','restore-catalog-verify-loss','restore-unowned','restore-mkcol-loss','restore-partial','api-owner','api-sharing','prepare-browser-preview']){
  const ns='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID(),ss='Homepage-Notes-Vercel-Probe-'+process.env.GITHUB_RUN_ID+'-'+randomUUID();const r=await stage(name,{},'preview-qualify',{namespace:ns,sourceNamespace:ss});if(name==='prepare-browser-preview')report.browserPreviewNamespace=ns;
 }
 await stage('init');for(let chunk=0;chunk<10;chunk++)await stage('seed',{chunk});for(let chunk=0;chunk<10;chunk++)await stage('verify',{chunk});
 for(const name of ['owner','history','note-share','folder-share','concurrency','revoke-expiry'])await stage(name);
 const exported=await stage('export');must(exported.details.active===100,'SOURCE_ACTIVE_COUNT_FAILED');await stage('restore-init');for(let chunk=0;chunk<Math.ceil(exported.details.count/10);chunk++)await stage('restore-chunk',{chunk});await stage('restore-verify');
 probe=undefined;report.completed=true;report.passed=true;
}catch(e){report.errors.push({code:/^[A-Z_0-9]{1,90}$/.test(e.message)?e.message:'REQUEST_OUTCOME_UNVERIFIED'});}
finally{
 const stats=vs=>{vs=vs.sort((a,b)=>a-b);const p=q=>vs[Math.max(0,Math.ceil(q*vs.length)-1)]??null;return {n:vs.length,p50:p(.5),p95:p(.95),max:vs.at(-1)??null};};
 const metrics=report.stages.flatMap(s=>s.metrics??[]);report.summary={};
 for(const op of ['save-note','list-notes','get-note','create-share','revoke-share','seed-batch','restore-batch']){
  const rows=metrics.filter(m=>m.operation===op);report.summary[op]={attempted:rows.length,successful:stats(rows.filter(r=>r.code==='OK').map(r=>r.ms)),committedOnly:stats(rows.filter(r=>r.code==='OK'&&r.committed).map(r=>r.ms)),codes:Object.fromEntries([...new Set(rows.map(r=>r.code))].map(c=>[c,rows.filter(r=>r.code===c).length]))};
 }
 report.verifiedOriginalNotes=report.stages.filter(s=>s.stage==='verify'&&s.passed).reduce((n,s)=>n+s.details.verified,0);report.restoreResult=report.stages.find(s=>s.stage==='restore-verify')?.details;
 await writeFile('koofr-preview-qualification.local.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({kind:report.kind,passed:report.passed,completed:report.completed,region:report.region,verifiedOriginalNotes:report.verifiedOriginalNotes,restoreResult:report.restoreResult,browserPreviewNamespace:report.browserPreviewNamespace,standaloneHttpSmoke:report.standaloneHttpSmoke,summary:report.summary,stages:report.stages.map(s=>({stage:s.stage,passed:s.passed,checks:s.checks,errors:s.errors})),errors:report.errors}));if(!report.passed)process.exitCode=1;
}
