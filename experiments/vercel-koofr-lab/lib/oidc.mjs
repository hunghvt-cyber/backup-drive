import {createPublicKey,verify} from 'node:crypto';
export const audience='homepage-koofr-synthetic-benchmark-v1';
const issuer='https://token.actions.githubusercontent.com';
const repo='hunghvt-cyber/my-backup-gdrive-koofr';
const ref='refs/heads/experiment/homepage-koofr-webdav-20261017';
let cache;
async function keys(){
 if(cache&&cache.until>Date.now())return cache.keys;
 const r=await fetch(issuer+'/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('AUTH_UNAVAILABLE');
 const j=await r.json();if(!Array.isArray(j.keys)||j.keys.length>30)throw Error('AUTH_UNAVAILABLE');
 cache={until:Date.now()+300000,keys:j.keys};return j.keys;
}
export async function authorize(token,{getKeys=keys,now=Date.now()/1000}={}){
 try{
  if(typeof token!=='string'||token.length>16000)throw Error();
  const parts=token.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[\w-]+$/.test(p)))throw Error();
  const h=JSON.parse(Buffer.from(parts[0],'base64url')),c=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(h.alg!=='RS256'||typeof h.kid!=='string'||h.crit)throw Error();
  const k=(await getKeys()).find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(!k||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:k,format:'jwk'}),Buffer.from(parts[2],'base64url')))throw Error();
  if(c.iss!==issuer||c.aud!==audience||c.sub!=='repo:'+repo+':ref:'+ref||c.repository!==repo||String(c.repository_id)!=='1191594464'||c.ref!==ref||c.event_name!=='push'||c.workflow_ref!==repo+'/.github/workflows/koofr-vercel-bench.yml@'+ref)throw Error();
  if(!Number.isFinite(c.exp)||!Number.isFinite(c.iat)||c.exp<=now||c.iat>now+30||c.iat<now-600||c.exp-c.iat>600||(c.nbf!==undefined&&(!Number.isFinite(c.nbf)||c.nbf>now+30)))throw Error();
  if(!/^\d{1,20}$/.test(String(c.run_id)))throw Error();return {runId:String(c.run_id)};
 }catch{throw Error('UNAUTHORIZED');}
}
